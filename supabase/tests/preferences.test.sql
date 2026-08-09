-- Preferences (#4).
--
-- Convention: supabase/tests/{module}.test.sql, mirroring RPC/table names
-- (.kiro/specs/testing.md). Preferences are flat rows the AI reads and
-- reasons with but the app never enforces — so this suite covers CRUD,
-- ordering and RLS, and deliberately nothing about the content of `body`.
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000020', 'preferences@example.com')
  on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';

-- --- Create -----------------------------------------------------------

insert into public.preferences (id, category, body) values
  ('20000000-0000-0000-0000-000000000001', 'variety', 'Don''t repeat a recipe within four weeks');

select ok(
  exists (select 1 from public.preferences where id = '20000000-0000-0000-0000-000000000001'),
  'an authenticated user can create a Preference row with a category'
);

insert into public.preferences (id, body) values
  ('20000000-0000-0000-0000-000000000002', 'Favour older stock');

select ok(
  (select category from public.preferences where id = '20000000-0000-0000-0000-000000000002') is null,
  'category is optional and defaults to null'
);

select throws_like(
  $$insert into public.preferences (id, body) values ('20000000-0000-0000-0000-000000000099', '   ')$$,
  '%preferences_body_not_blank%',
  'a blank body is rejected'
);

select throws_like(
  $$insert into public.preferences (id, category, body) values ('20000000-0000-0000-0000-000000000098', '   ', 'x')$$,
  '%preferences_category_not_blank%',
  'a blank (but non-null) category is rejected'
);

-- --- updated_at stamping -----------------------------------------------

select ok(
  (select updated_at from public.preferences where id = '20000000-0000-0000-0000-000000000001') is not null,
  'a newly created Preference carries a last-updated timestamp'
);

update public.preferences
set updated_at = now() - interval '10 days'
where id = '20000000-0000-0000-0000-000000000001';

update public.preferences
set body = 'Do not repeat a recipe within four weeks'
where id = '20000000-0000-0000-0000-000000000001';

select ok(
  (select updated_at from public.preferences where id = '20000000-0000-0000-0000-000000000001') > now() - interval '1 minute',
  'editing a Preference refreshes its updated_at automatically'
);

-- --- Edit ---------------------------------------------------------------

select is(
  (select body from public.preferences where id = '20000000-0000-0000-0000-000000000001'),
  'Do not repeat a recipe within four weeks',
  'a Preference''s body can be edited'
);

update public.preferences
set category = 'cadence'
where id = '20000000-0000-0000-0000-000000000002';

select is(
  (select category from public.preferences where id = '20000000-0000-0000-0000-000000000002'),
  'cadence',
  'a Preference''s category can be edited'
);

-- --- Ordering -------------------------------------------------------------
-- Stable, most-recently-updated-first listing, matching the app's default
-- read (order by updated_at desc, id asc as a tiebreaker) — this is a list
-- skimmed often, so the order must be deterministic.

insert into public.preferences (id, category, body, updated_at) values
  ('20000000-0000-0000-0000-000000000003', 'diet', 'Lactose free', '2026-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000004', 'diet', 'Prefer one new recipe per week', '2026-01-02T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000005', null, 'Max three cooks a week', '2026-01-03T00:00:00Z');

select is(
  (
    select array_agg(id order by updated_at desc, id asc)
    from public.preferences
    where id in (
      '20000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000005'
    )
  ),
  array[
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000003'
  ]::uuid[],
  'listing orders most-recently-updated first'
);

-- Two rows with the same updated_at still sort deterministically (by id),
-- so repeated loads of a list this small don't visibly reshuffle.
update public.preferences
set updated_at = '2026-01-10T00:00:00Z'
where id in ('20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004');

select is(
  (
    select array_agg(id order by updated_at desc, id asc)
    from public.preferences
    where id in (
      '20000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000004'
    )
  ),
  array[
    '20000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000004'
  ]::uuid[],
  'rows tied on updated_at fall back to a stable id tiebreaker'
);

-- --- Delete -----------------------------------------------------------

delete from public.preferences where id = '20000000-0000-0000-0000-000000000002';

select ok(
  not exists (select 1 from public.preferences where id = '20000000-0000-0000-0000-000000000002'),
  'a Preference row can be deleted'
);

reset role;

-- --- RLS: deny-all baseline still holds ------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.preferences'::regclass),
  'preferences has row level security enabled'
);

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.preferences'::regclass),
  'preferences forces row level security, including for the table owner'
);

set local "request.jwt.claims" to '';
set local role anon;

select is(
  (select count(*) from public.preferences)::int,
  0,
  'anon role reading preferences sees zero rows regardless of table contents'
);

select throws_ok(
  $$insert into public.preferences (body) values ('should not be writable by anon')$$,
  '42501',
  null,
  'anon role cannot insert a Preference row'
);

reset role;

select * from finish();
rollback;

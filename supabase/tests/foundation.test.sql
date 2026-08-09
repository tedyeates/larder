-- Foundation module: proves the deny-all RLS baseline actually denies.
--
-- Convention: supabase/tests/{module}.test.sql, mirroring RPC/table names
-- (.kiro/specs/testing.md).
begin;
select plan(4);

-- RLS must be enabled and forced on profiles — the table this migration
-- set introduced to exercise the baseline for real.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has row level security enabled'
);

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles forces row level security, including for the table owner'
);

-- Seed one profile as the service role (bypasses RLS), then assert an
-- unauthenticated anon-key session sees nothing — the acceptance criterion
-- "a test proves an unauthenticated anon-key query returns nothing".
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'seed@example.com')
  on conflict (id) do nothing;

set local role anon;

select is(
  (select count(*) from public.profiles)::int,
  0,
  'anon role reading profiles sees zero rows regardless of table contents'
);

reset role;

-- An authenticated user sees only their own row, not other users'.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'other@example.com')
  on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from public.profiles)::int,
  1,
  'authenticated user sees exactly their own profile row'
);

reset role;

select * from finish();
rollback;

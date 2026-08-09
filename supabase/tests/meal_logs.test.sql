-- Meal Log (#9): history imported from Cook Log rows must retain its date and
-- source identity, while ordinary authenticated users retain full CRUD access.
begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000090', 'meal-log@example.com')
  on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000090","role":"authenticated"}';

insert into public.meal_logs (occurred_on, kind, recipe_name, note, source_key)
values ('2026-06-08', 'eaten', 'Weeknight ramen', '×2 — fed friends', 'cook-log:ramen:9');

select is(
  (select occurred_on from public.meal_logs where source_key = 'cook-log:ramen:9'),
  '2026-06-08'::date,
  'historical Meal Log keeps Cook Log date'
);

select is(
  (select recipe_name from public.meal_logs where source_key = 'cook-log:ramen:9'),
  'Weeknight ramen',
  'historical Meal Log keeps Recipe name before Recipe import'
);

select is(
  (select note from public.meal_logs where source_key = 'cook-log:ramen:9'),
  '×2 — fed friends',
  'historical Meal Log keeps multiplier and note'
);

select throws_like(
  $$insert into public.meal_logs (occurred_on, kind, source_key) values ('2026-06-08', 'eaten', 'cook-log:ramen:9')$$,
  '%meal_logs_source_key_unique%',
  'an imported Cook Log source key cannot create a duplicate Meal Log'
);

insert into public.meal_logs (occurred_on, kind, recipe_name)
values ('2026-06-09', 'ate_out', 'Restaurant');

select is(
  (select kind from public.meal_logs where recipe_name = 'Restaurant'),
  'ate_out',
  'Meal Log supports an Ate Out entry'
);

select throws_like(
  $$insert into public.meal_logs (occurred_on, kind) values ('2026-06-09', 'cooked')$$,
  '%meal_logs_kind_valid%',
  'unknown Meal Log kinds are rejected'
);

set local "request.jwt.claims" to '';
set local role anon;

select throws_like(
  $$insert into public.meal_logs (occurred_on, kind) values ('2026-06-10', 'eaten')$$,
  '%row-level security%',
  'anonymous callers cannot write Meal Log rows'
);

select * from finish();
rollback;

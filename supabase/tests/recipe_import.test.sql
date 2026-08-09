-- Recipe import (#12): Draft source identity and mobile resolution queue.
begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000120', 'recipe-import@example.com')
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000120","role":"authenticated"}';

insert into public.ingredients (id, name, stock_unit)
values ('12000000-0000-0000-0000-000000000001', 'Leek', 'pieces');

insert into public.recipes (name, servings, status, source_key)
values ('Imported spring soup', 2, 'draft', 'recipe-import:spring-soup')
returning id as recipe_id \gset

select is(
  (select status from public.recipes where id = :'recipe_id'),
  'draft',
  'an imported Recipe can land as a readable Draft'
);

select throws_like(
  $$insert into public.recipes (name, servings, source_key) values ('Imported spring soup again', 2, 'recipe-import:spring-soup')$$,
  '%recipes_source_key_unique%',
  'the import source key prevents a rerun from duplicating a Recipe'
);

insert into public.recipe_lines (recipe_id, ingredient_id, raw_name, amount, unit, position)
values (:'recipe_id'::uuid, '12000000-0000-0000-0000-000000000001', 'Leek', 0.5, null, 0)
returning id as missing_unit_line \gset

select is(
  (select reason from public.recipe_line_inconsistencies where recipe_line_id = :'missing_unit_line'),
  'missing_unit',
  'an imported numeric fraction without a unit is retained and flagged as missing_unit'
);

select is(
  (select is_cookable from public.recipe_cookability where recipe_id = :'recipe_id'),
  false,
  'a Recipe with an Inconsistency cannot become Cookable for meal planning'
);

select is(
  (select line_label from public.recipe_resolution_queue where recipe_line_id = :'missing_unit_line'),
  'Leek',
  'the cross-Recipe resolution queue exposes the raw line label'
);

select is(
  (select recipe_name from public.recipe_resolution_queue where recipe_line_id = :'missing_unit_line'),
  'Imported spring soup',
  'the resolution queue names the readable Recipe containing the inconsistency'
);

select is(
  (select recipe_status from public.recipe_resolution_queue where recipe_line_id = :'missing_unit_line'),
  'draft',
  'the resolution queue includes Draft imports awaiting attention'
);

set local "request.jwt.claims" to '';
set local role anon;

select is(
  (select count(*)::int from public.recipe_resolution_queue),
  0,
  'anon cannot read the resolution queue through its security-invoker view'
);

select * from finish();
rollback;

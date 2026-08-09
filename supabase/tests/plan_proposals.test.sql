begin;
select plan(15);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000150', 'proposal@example.com') on conflict do nothing;
insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('15000000-0000-0000-0000-000000000001', 'Proposal flour', 'g', false)
on conflict (id) do update set status = 'active', proposal_id = null;
insert into public.recipes (id, name, servings, max_multiplier, status) values
  ('15000000-0000-0000-0000-000000000010', 'Proposal flatbread', 2, 2, 'confirmed'),
  ('15000000-0000-0000-0000-000000000011', 'Bad proposal recipe', 1, 1, 'confirmed')
on conflict (id) do update set servings = excluded.servings, max_multiplier = excluded.max_multiplier, status = 'confirmed', proposal_id = null;
delete from public.recipe_lines where recipe_id in ('15000000-0000-0000-0000-000000000010', '15000000-0000-0000-0000-000000000011');
insert into public.recipe_lines (recipe_id, ingredient_id, amount, unit, position) values
  ('15000000-0000-0000-0000-000000000010', '15000000-0000-0000-0000-000000000001', 100, 'g', 0),
  ('15000000-0000-0000-0000-000000000011', '15000000-0000-0000-0000-000000000001', 1, null, 0);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000150","role":"authenticated"}';

select jsonb_build_object(
  'planningHorizon', (current_date + 1)::text,
  'slots', jsonb_build_array(
    jsonb_build_object('slotDate', current_date::text, 'mealTime', 'breakfast', 'recipeId', '15000000-0000-0000-0000-000000000010', 'isCook', true, 'cookMultiplier', 1),
    jsonb_build_object('slotDate', current_date::text, 'mealTime', 'lunch', 'recipeId', '15000000-0000-0000-0000-000000000010', 'isCook', false)
  ), 'newRecipes', '[]'::jsonb, 'newIngredients', '[]'::jsonb, 'suggestedAliases', '[]'::jsonb
) as valid_bundle \gset

select ok(exists (
  select 1 from jsonb_array_elements(public.plan_proposal_check(jsonb_set(:'valid_bundle'::jsonb, '{slots}', (:'valid_bundle'::jsonb->'slots') - 1))->'failures') failure
  where failure->>'rule' = 'serving_coverage'
), 'Plan Check fails serving coverage individually');

select ok(exists (
  select 1 from jsonb_array_elements(public.plan_proposal_check(jsonb_build_object(
    'planningHorizon', (current_date + 1)::text,
    'slots', jsonb_build_array(
      jsonb_build_object('slotDate', current_date::text, 'mealTime','breakfast','recipeId','15000000-0000-0000-0000-000000000010','isCook',true,'cookMultiplier',3),
      jsonb_build_object('slotDate', current_date::text, 'mealTime','lunch','recipeId','15000000-0000-0000-0000-000000000010'),
      jsonb_build_object('slotDate', current_date::text, 'mealTime','dinner','recipeId','15000000-0000-0000-0000-000000000010'),
      jsonb_build_object('slotDate', (current_date + 1)::text, 'mealTime','breakfast','recipeId','15000000-0000-0000-0000-000000000010'),
      jsonb_build_object('slotDate', (current_date + 1)::text, 'mealTime','lunch','recipeId','15000000-0000-0000-0000-000000000010'),
      jsonb_build_object('slotDate', (current_date + 1)::text, 'mealTime','dinner','recipeId','15000000-0000-0000-0000-000000000010')
    ), 'newRecipes','[]'::jsonb,'newIngredients','[]'::jsonb,'suggestedAliases','[]'::jsonb
  ))->'failures') failure where failure->>'rule' = 'multiplier_limit'
), 'Plan Check fails multiplier limit individually');

select ok(exists (
  select 1 from jsonb_array_elements(public.plan_proposal_check(jsonb_build_object(
    'planningHorizon', current_date::text,
    'slots', jsonb_build_array(jsonb_build_object('slotDate',current_date::text,'mealTime','breakfast','recipeId','15000000-0000-0000-0000-000000000011','isCook',true,'cookMultiplier',1)),
    'newRecipes','[]'::jsonb,'newIngredients','[]'::jsonb,'suggestedAliases','[]'::jsonb
  ))->'failures') failure where failure->>'rule' = 'recipe_line_usable'
), 'Plan Check fails unusable Recipe Line individually');

select ok(exists (
  select 1 from jsonb_array_elements(public.plan_proposal_check(jsonb_build_object(
    'planningHorizon', current_date::text,
    'slots', jsonb_build_array(jsonb_build_object('slotDate',current_date::text,'mealTime','breakfast')),
    'newRecipes','[]'::jsonb,'newIngredients','[]'::jsonb,'suggestedAliases','[]'::jsonb
  ))->'failures') failure where failure->>'rule' = 'slot_completeness'
), 'Plan Check fails an unfilled Slot individually');

select ok(exists (
  select 1 from jsonb_array_elements(public.plan_proposal_check(jsonb_build_object(
    'planningHorizon', current_date::text,
    'slots', jsonb_build_array(jsonb_build_object('slotDate',(current_date + 1)::text,'mealTime','breakfast','empty',true)),
    'newRecipes','[]'::jsonb,'newIngredients','[]'::jsonb,'suggestedAliases','[]'::jsonb
  ))->'failures') failure where failure->>'rule' = 'slot_horizon'
), 'Plan Check fails Slot outside Planning Horizon individually');

select is((public.submit_plan_proposal(jsonb_set(:'valid_bundle'::jsonb, '{slots}', (:'valid_bundle'::jsonb->'slots') - 1))->>'accepted')::boolean, false, 'failed proposal returns structured rejection');
select is((select count(*)::int from public.plan_proposals where user_id = '00000000-0000-0000-0000-000000000150'), 0, 'failed proposal is not stored for review');

select jsonb_build_object(
  'planningHorizon', (current_date + 1)::text,
  'slots', jsonb_build_array(
    jsonb_build_object('slotDate',current_date::text,'mealTime','breakfast','recipeRef','new-soup','isCook',true,'cookMultiplier',1),
    jsonb_build_object('slotDate',current_date::text,'mealTime','lunch','recipeRef','new-soup')
  ),
  'newIngredients', jsonb_build_array(jsonb_build_object('ref','lentil','name','Proposal lentils','stockUnit','g')),
  'newRecipes', jsonb_build_array(jsonb_build_object('ref','new-soup','name','Proposal lentil soup','servings',2,'maxMultiplier',1,'tags',jsonb_build_array('soy'),'lines',jsonb_build_array(jsonb_build_object('ingredientRef','lentil','amount',100,'unit','g','position',0)))),
  'suggestedAliases', jsonb_build_array(jsonb_build_object('ingredientRef','lentil','alias','Red lentils'))
) as promotion_bundle \gset

select (public.submit_plan_proposal(:'promotion_bundle'::jsonb)->'proposal'->>'id') as proposal_id \gset
select set_config('request.agent_token', 'true', true);
select throws_like(
  format('select public.confirm_plan_proposal(%L::uuid)', :'proposal_id'),
  '%Agent Token%',
  'Agent Token cannot confirm a Plan Proposal'
);
select set_config('request.agent_token', 'false', true);
select is((select status from public.ingredients where name = 'Proposal lentils'), 'draft', 'submitted Ingredient is Draft and hidden before confirmation');
select is((select status from public.recipes where name = 'Proposal lentil soup'), 'draft', 'submitted Recipe is Draft before confirmation');
select public.add_stock_lot('15000000-0000-0000-0000-000000000001', 1, 'cupboard', current_date);
-- Newly proposed lentils have no Pantry, so all 100 g is required.
select public.confirm_plan_proposal(:'proposal_id'::uuid);
select is((select status from public.ingredients where name = 'Proposal lentils'), 'active', 'confirmation promotes Ingredient atomically');
select is((select status from public.recipes where name = 'Proposal lentil soup'), 'confirmed', 'confirmation promotes Recipe atomically');
select is((select required_amount from public.shopping_items join public.ingredients on ingredients.id = shopping_items.ingredient_id where ingredients.name = 'Proposal lentils'), 100::numeric, 'confirmation snapshots plan need minus Pantry into Shopping');
select public.confirm_plan_proposal(:'proposal_id'::uuid);
select is((select required_amount from public.shopping_items join public.ingredients on ingredients.id = shopping_items.ingredient_id where ingredients.name = 'Proposal lentils'), 100::numeric, 'confirming twice does not write Shopping again');
select public.set_meal_plan_slot(current_date, 'breakfast', null, 'Edited after confirmation', false, 1);
select public.confirm_plan_proposal(:'proposal_id'::uuid);
select is((select required_amount from public.shopping_items join public.ingredients on ingredients.id = shopping_items.ingredient_id where ingredients.name = 'Proposal lentils'), 100::numeric, 'editing later does not write Shopping again');

select * from finish();
rollback;

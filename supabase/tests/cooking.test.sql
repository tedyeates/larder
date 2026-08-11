-- Cooking and Meal Stock (#10): preview and commit share one database module.
begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000100', 'cooking@example.com')
on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('10000000-0000-0000-0000-000000000001', 'Chicken', 'pieces', false),
  ('10000000-0000-0000-0000-000000000002', 'Mirin', 'ml', false),
  ('10000000-0000-0000-0000-000000000003', 'Rice wine', 'ml', false),
  ('10000000-0000-0000-0000-000000000004', 'Soy sauce', 'bottle', true)
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000100","role":"authenticated"}';

insert into public.recipes (id, name, servings, max_multiplier)
values ('10000000-0000-0000-0000-000000000010', 'Chicken bowl', 2, 3)
on conflict (id) do update set name = excluded.name, servings = excluded.servings, max_multiplier = excluded.max_multiplier;

select (public.create_recipe_line('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', null, 5, 'pieces')).id as chicken_line \gset
select (public.create_recipe_line('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', null, 30, 'ml')).id as mirin_line \gset
insert into public.recipe_line_substitutes (recipe_line_id, ingredient_id)
values (:'mirin_line'::uuid, '10000000-0000-0000-0000-000000000003')
on conflict do nothing;

select public.add_stock_lot('10000000-0000-0000-0000-000000000001', 2, 'fridge', '2026-08-01');
select public.add_stock_lot('10000000-0000-0000-0000-000000000001', 2, 'fridge', '2026-08-02');
select public.add_stock_lot('10000000-0000-0000-0000-000000000003', 50, 'cupboard', '2026-08-01');

select public.preview_cook(
  '10000000-0000-0000-0000-000000000010', 1,
  jsonb_build_array(jsonb_build_object('recipe_line_id', :'mirin_line', 'substitute_ingredient_id', '10000000-0000-0000-0000-000000000003'))
) as preview \gset

select is(
  (:'preview'::jsonb #>> array['lines', '0', 'shortfall'])::numeric,
  1::numeric,
  'preview reports the chicken amount that will clamp after consuming across oldest Lots'
);

select is(
  (:'preview'::jsonb #>> array['lines', '1', 'substitute_ingredient_id'])::uuid,
  '10000000-0000-0000-0000-000000000003'::uuid,
  'preview records selected Substitute for its Recipe Line'
);

select public.commit_cook(
  '10000000-0000-0000-0000-000000000010', 1,
  jsonb_build_array(jsonb_build_object('recipe_line_id', :'mirin_line', 'substitute_ingredient_id', '10000000-0000-0000-0000-000000000003')),
  '2026-08-03'
) as committed \gset

select is(
  (:'committed'::jsonb #>> array['lines', '0', 'shortfall'])::numeric,
  (:'preview'::jsonb #>> array['lines', '0', 'shortfall'])::numeric,
  'commit returns exactly the same clamped discrepancy its preview calculated'
);

select is(
  (select count(*)::int from public.stock_lots where ingredient_id = '10000000-0000-0000-0000-000000000001'),
  0,
  'Cook drains all Chicken Lots oldest-first and floors the short Ingredient at zero'
);

select is(
  (select quantity from public.stock_lots where ingredient_id = '10000000-0000-0000-0000-000000000003'),
  20::numeric,
  'Cook consumes selected Substitute rather than unavailable named Ingredient'
);

select is(
  (select count(*)::int from public.cook_substitutions),
  1,
  'Cook records selected Substitute against Cook'
);

select is(
  (select portions_remaining from public.portion_batches where recipe_id = '10000000-0000-0000-0000-000000000010'),
  2,
  'Cook produces Recipe servings multiplied into one Fridge Portion Batch'
);

select public.commit_cook('10000000-0000-0000-0000-000000000010', 1, '[]'::jsonb, '2026-08-03');
select is(
  (select count(*)::int from public.portion_batches where recipe_id = '10000000-0000-0000-0000-000000000010' and cooked_on = '2026-08-03'),
  1,
  'same Recipe cooked twice on one day merges into one Portion Batch'
);
select is(
  (select portions_remaining from public.portion_batches where recipe_id = '10000000-0000-0000-0000-000000000010'),
  4,
  'same-day batch merge adds produced Portions'
);

select (public.add_portion_batch(null, 'Frozen pizza', 2, 'freezer', '2026-08-01')).id as ready_batch \gset
select is(
  (select display_name from public.meal_stock where label = 'Frozen pizza'),
  'Frozen pizza',
  'bought ready meal with no Recipe appears in Meal Stock'
);

select public.add_portion_batch('10000000-0000-0000-0000-000000000010', null, 1, 'fridge', '2026-08-01');
select (public.eat_portion(
  p_portion_batch_id => (select id from public.portion_batches where recipe_id = '10000000-0000-0000-0000-000000000010' order by cooked_on asc limit 1),
  p_occurred_on => '2026-08-04'
)).id as eaten_log \gset
select is(
  (select portions_remaining from public.portion_batches where recipe_id = '10000000-0000-0000-0000-000000000010' and cooked_on = '2026-08-01'),
  0,
  'eating a Portion decrements the oldest Portion Batch first'
);
select is(
  (select kind from public.meal_logs where id = :'eaten_log'::uuid),
  'eaten',
  'eating a Portion writes an eaten Meal Log row'
);

select (public.record_ate_out('Restaurant', '2026-08-04')).id as ate_out_log \gset
select is(
  (select kind from public.meal_logs where id = :'ate_out_log'::uuid),
  'ate_out',
  'Ate Out writes a Meal Log row without consuming a Portion'
);
select is(
  (select portions_remaining from public.portion_batches where id = :'ready_batch'::uuid),
  2,
  'Ate Out does not deplete any Portion Batch'
);

-- Eating without naming a Batch must pick the oldest non-empty Batch itself,
-- skipping the drained 2026-08-01 one.
select public.add_portion_batch('10000000-0000-0000-0000-000000000010', null, 2, 'fridge', '2026-08-02');
select public.eat_portion(p_recipe_id => '10000000-0000-0000-0000-000000000010', p_occurred_on => '2026-08-04');
select is(
  (select portions_remaining from public.portion_batches
   where recipe_id = '10000000-0000-0000-0000-000000000010' and cooked_on = '2026-08-02'),
  1,
  'eating by Recipe consumes the oldest Batch that still has Portions'
);
select is(
  (select portions_remaining from public.portion_batches
   where recipe_id = '10000000-0000-0000-0000-000000000010' and cooked_on = '2026-08-03'),
  4,
  'eating by Recipe leaves newer Batches untouched'
);

-- A Hand-Depleted Ingredient is never automatically consumed, and its presence
-- must not stop the Cook: the app never blocks a Cook.
select public.create_recipe_line(
  '10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000004', null, 0.2, 'bottle'
);
select public.set_hand_depleted_fraction(
  '10000000-0000-0000-0000-000000000004', 0.5, 'cupboard', '2026-08-01'
);
select public.commit_cook('10000000-0000-0000-0000-000000000010', 1, '[]'::jsonb, '2026-08-05');
select is(
  (select portions_remaining from public.portion_batches
   where recipe_id = '10000000-0000-0000-0000-000000000010' and cooked_on = '2026-08-05'),
  2,
  'a Cook with an empty Pantry and a Hand-Depleted line still produces its Portions'
);
select is(
  (select quantity from public.stock_lots where ingredient_id = '10000000-0000-0000-0000-000000000004'),
  0.5::numeric,
  'a Cook never depletes a Hand-Depleted Ingredient'
);

select * from finish();
rollback;

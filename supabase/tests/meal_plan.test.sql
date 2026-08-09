begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000130', 'plan@example.com')
on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('13000000-0000-0000-0000-000000000001', 'Chicken', 'pieces', false),
  ('13000000-0000-0000-0000-000000000002', 'Mirin', 'ml', false),
  ('13000000-0000-0000-0000-000000000003', 'Rice wine', 'ml', false)
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000130","role":"authenticated"}';

insert into public.recipes (id, name, servings, max_multiplier)
values ('13000000-0000-0000-0000-000000000010', 'Plan chicken bowl', 2, 3)
on conflict (id) do update set servings = excluded.servings, max_multiplier = excluded.max_multiplier;

select (public.create_recipe_line('13000000-0000-0000-0000-000000000010', '13000000-0000-0000-0000-000000000001', null, 3, 'pieces')).id as chicken_line \gset
select (public.create_recipe_line('13000000-0000-0000-0000-000000000010', '13000000-0000-0000-0000-000000000002', null, 20, 'ml')).id as mirin_line \gset
insert into public.recipe_line_substitutes (recipe_line_id, ingredient_id)
values (:'mirin_line'::uuid, '13000000-0000-0000-0000-000000000003') on conflict do nothing;
select public.add_stock_lot('13000000-0000-0000-0000-000000000003', 20, 'cupboard', current_date);

select (public.set_meal_plan_slot(current_date, 'breakfast', '13000000-0000-0000-0000-000000000010', null, false, 1)).id as breakfast_slot \gset
select (public.set_meal_plan_slot(current_date + 1, 'lunch', '13000000-0000-0000-0000-000000000010', null, false, 1)).id as lunch_slot \gset
select (public.set_meal_plan_slot(current_date + 2, 'dinner', '13000000-0000-0000-0000-000000000010', null, false, 1)).id as dinner_slot \gset
select (public.set_meal_plan_slot(current_date + 10, 'dinner', '13000000-0000-0000-0000-000000000010', null, true, 2)).id as cook_slot \gset

select ok(
  (select not is_cookable from public.meal_plan_slot_status where id = :'cook_slot'::uuid),
  'a plan slot is not Cookable when its direct Chicken line is missing'
);
select is(
  (select status from jsonb_to_recordset((select line_statuses from public.meal_plan_slot_status where id = :'cook_slot'::uuid))
    as line(recipe_line_id uuid, ingredient_name text, status text) where recipe_line_id = :'mirin_line'::uuid),
  'fulfilled_by_substitute',
  'covered alternative is shown as Fulfilled by Substitute'
);
select ok(
  (select shortfall from public.meal_plan_slot_status where id = :'dinner_slot'::uuid),
  'planned meal is short before any real Cook creates Portions'
);

select public.commit_cook('13000000-0000-0000-0000-000000000010', 2, '[]'::jsonb, current_date);
select ok(
  not (select shortfall from public.meal_plan_slot_status where id = :'dinner_slot'::uuid),
  'real Cook supplies planned Portions and clears shortfall'
);
select public.eat_meal_plan_slot(:'breakfast_slot'::uuid);
select public.eat_meal_plan_slot(:'lunch_slot'::uuid);
select is(
  (select count(*)::int from public.meal_logs where meal_plan_slot_id in (:'breakfast_slot'::uuid, :'lunch_slot'::uuid)),
  2,
  'eating plan slots writes linked Meal Log entries'
);
select public.eat_portion(p_recipe_id => '13000000-0000-0000-0000-000000000010');
select public.eat_portion(p_recipe_id => '13000000-0000-0000-0000-000000000010');
select ok(
  (select shortfall from public.meal_plan_slot_status where id = :'dinner_slot'::uuid),
  'real off-plan Meal Log entries consume Portions and recreate shortfall'
);

select public.top_up_meal_plan_slot(:'cook_slot'::uuid);
select is(
  (select required_amount from public.shopping_items where ingredient_id = '13000000-0000-0000-0000-000000000001'),
  6::numeric,
  'Top-Up deliberately adds scaled missing Ingredient amount once'
);
select is(
  (select count(*)::int from public.shopping_items where ingredient_id = '13000000-0000-0000-0000-000000000002'),
  0,
  'Top-Up excludes lines fulfilled by Substitute'
);

select throws_like(
  format($$select public.set_meal_plan_slot(%L::date, 'breakfast', null, 'Old toast', false, 1)$$, current_date - 1),
  '%future%',
  'past slots cannot be created'
);
reset role;
alter table public.meal_plan_slots disable trigger meal_plan_slots_reject_past;
insert into public.meal_plan_slots (slot_date, meal_time, label) values (current_date - 1, 'breakfast', 'Imported history');
alter table public.meal_plan_slots enable trigger meal_plan_slots_reject_past;
set local role authenticated;
select throws_like(
  $$update public.meal_plan_slots set label = 'Edited history' where label = 'Imported history'$$,
  '%Past%',
  'past slots are immutable even through direct table updates'
);
select throws_like(
  $$delete from public.meal_plan_slots where label = 'Imported history'$$,
  '%Past%',
  'past slots cannot be cleared'
);

select * from finish();
rollback;

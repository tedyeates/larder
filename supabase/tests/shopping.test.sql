begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000080', 'shopping@example.com')
on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('80000000-0000-0000-0000-000000000001', 'Udon noodles', 'g', false),
  ('80000000-0000-0000-0000-000000000002', 'Carrots', 'pieces', false),
  ('80000000-0000-0000-0000-000000000003', 'Kitchen towels', 'rolls', false);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000080","role":"authenticated"}';

-- --- Merge-on-add ----------------------------------------------------------

select public.add_shopping_item('80000000-0000-0000-0000-000000000001', 200);
select public.add_shopping_item('80000000-0000-0000-0000-000000000001', 100);

select is(
  (select count(*)::int from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000001'),
  1,
  'adding an Ingredient already on the list keeps one Shopping Item'
);

select is(
  (select required_amount from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000001'),
  300::numeric,
  'adding an already-listed Ingredient raises its Required Amount'
);

select public.add_shopping_item('80000000-0000-0000-0000-000000000003', 2);
select is(
  (select required_amount from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000003'),
  2::numeric,
  'a non-food Ingredient can be added by hand with an amount'
);

-- --- Shop/Aisle fixture ----------------------------------------------------

select public.create_shop('Lidl');
select public.create_shop('Asian Supermarket');
select public.create_aisle((select id from public.shops where name = 'Lidl'), 'Fruit & Veg', '🥬');
select public.create_aisle((select id from public.shops where name = 'Lidl'), 'Dry Goods', '🍚');
select public.create_aisle((select id from public.shops where name = 'Asian Supermarket'), 'Noodles & Rice', '🍜');

select public.set_placement(
  '80000000-0000-0000-0000-000000000001',
  (select id from public.aisles where name = 'Dry Goods')
);
select public.set_placement(
  '80000000-0000-0000-0000-000000000001',
  (select id from public.aisles where name = 'Noodles & Rice')
);
select public.add_shopping_item('80000000-0000-0000-0000-000000000002', 4);
select public.set_placement(
  '80000000-0000-0000-0000-000000000002',
  (select id from public.aisles where name = 'Fruit & Veg')
);

-- --- Sectioned per-Shop read ------------------------------------------------

select is(
  (select count(*)::int from public.shopping_list_by_shop
    where ingredient_id = '80000000-0000-0000-0000-000000000001'),
  2,
  'an Item appears in every Shop holding a Placement for it'
);

select is(
  (select count(*)::int from public.shopping_list_by_shop
    where ingredient_id = '80000000-0000-0000-0000-000000000003'),
  2,
  'an Item with no Placement appears under Unsorted in every Shop'
);

select results_eq(
  $$
    select section_name
    from public.shopping_list_by_shop
    where shop_name = 'Lidl'
    order by is_unsorted, section_position, ingredient_name
  $$,
  $$values ('Fruit & Veg'::text), ('Dry Goods'::text), ('Unsorted'::text)$$,
  'Lidl Items are sectioned by Aisle in walking order, then Unsorted'
);

select is(
  (select section_emoji from public.shopping_list_by_shop
   where shop_name = 'Lidl' and section_name = 'Fruit & Veg'),
  '🥬',
  'an Aisle section carries its emoji and name'
);

-- --- Buy / dismiss ---------------------------------------------------------

select public.buy_shopping_item(
  (select id from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000001'),
  250,
  'cupboard',
  '2026-08-09'
);

select is(
  (select count(*)::int from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000001'),
  0,
  'buying in one Shop removes the shared line from all Shops'
);

select is(
  (select quantity from public.stock_lots where ingredient_id = '80000000-0000-0000-0000-000000000001' and acquired_on = '2026-08-09'),
  250::numeric,
  'buying creates a Stock Lot immediately'
);

select public.add_shopping_item('80000000-0000-0000-0000-000000000001', 50);
select public.buy_shopping_item(
  (select id from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000001'),
  50,
  'cupboard',
  '2026-08-09'
);

select is(
  (select quantity from public.stock_lots where ingredient_id = '80000000-0000-0000-0000-000000000001' and acquired_on = '2026-08-09'),
  300::numeric,
  'buying the same Ingredient on the same day grows its Lot'
);

select public.dismiss_shopping_item(
  (select id from public.shopping_items where ingredient_id = '80000000-0000-0000-0000-000000000003')
);

select is(
  (select count(*)::int from public.stock_lots where ingredient_id = '80000000-0000-0000-0000-000000000003'),
  0,
  'dismissing removes the line without stocking anything'
);

reset role;
set local "request.jwt.claims" to '';
set local role anon;

select throws_like(
  $$select public.add_shopping_item('80000000-0000-0000-0000-000000000001'::uuid, 1)$$,
  '%requires an authenticated caller%',
  'add_shopping_item rejects anon callers'
);

reset role;
select * from finish();
rollback;

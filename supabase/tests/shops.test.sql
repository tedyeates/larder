-- Shops, Aisles and Placements (#6).
--
-- Convention: supabase/tests/{module}.test.sql, mirroring RPC/table names
-- (.kiro/specs/testing.md). Seed rows as the service role, exercise as an
-- authenticated user (single-user app, so any authenticated caller), and
-- assert observable state through tables/views/RPCs — never which
-- internal function ran.
begin;
select plan(27);

-- Seed as table owner (bypasses RLS) so fixtures aren't entangled with the
-- RLS assertions below.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000020', 'shops@example.com')
  on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('20000000-0000-0000-0000-000000000001', 'Udon noodles', 'g', false),
  ('20000000-0000-0000-0000-000000000002', 'Garlic', 'cloves', false);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';

-- --- create_shop / create_aisle: append at end of order -------------------

select is(
  (select position from public.create_shop('Lidl')),
  0,
  'the first Shop created gets position 0'
);

select is(
  (select position from public.create_shop('Asian Supermarket')),
  1,
  'the second Shop created is appended at position 1'
);

select is(
  (select count(*)::int from public.shops),
  2,
  'both Shops exist'
);

-- Aisles for Lidl.
select public.create_aisle(
  (select id from public.shops where name = 'Lidl'), 'Dry Goods', '🍚'
);
select public.create_aisle(
  (select id from public.shops where name = 'Lidl'), '🥬 Fruit & Veg', '🥬'
);

-- Aisle for the Asian Supermarket — deliberately different name/order.
select public.create_aisle(
  (select id from public.shops where name = 'Asian Supermarket'), 'Noodles & Rice', '🍜'
);
select public.create_aisle(
  (select id from public.shops where name = 'Asian Supermarket'), 'Fresh & Chilled', '🧊'
);

select is(
  (
    select position from public.aisles
    where shop_id = (select id from public.shops where name = 'Lidl')
      and name = 'Dry Goods'
  ),
  0,
  'Lidl''s first Aisle gets position 0'
);

select is(
  (
    select position from public.aisles
    where shop_id = (select id from public.shops where name = 'Lidl')
      and name = '🥬 Fruit & Veg'
  ),
  1,
  'Lidl''s second Aisle is appended at position 1'
);

select is(
  (
    select position from public.aisles
    where shop_id = (select id from public.shops where name = 'Asian Supermarket')
      and name = 'Noodles & Rice'
  ),
  0,
  'each Shop''s Aisle positions start over at 0 independently'
);

-- --- Aisle names/order are per-Shop, not aligned -------------------------

select ok(
  not exists (select 1 from public.aisles where name = '🥬 Fruit & Veg' and shop_id = (
    select id from public.shops where name = 'Asian Supermarket'
  )),
  'the Asian Supermarket has no Aisle named after Lidl''s Fruit & Veg — names never need to align across Shops'
);

-- --- reorder_aisles: full-set atomic reorder -------------------------------

-- Capture Lidl's Aisle ids by name before reordering, then pass them back
-- in reverse of their current (name asc) order — deliberately avoiding
-- any dependence on emoji-prefixed collation, which sorts unintuitively.
select public.reorder_aisles(
  (select id from public.shops where name = 'Lidl'),
  array[
    (select id from public.aisles where name = '🥬 Fruit & Veg'),
    (select id from public.aisles where name = 'Dry Goods')
  ]
);

select is(
  (
    select name from public.aisles
    where shop_id = (select id from public.shops where name = 'Lidl')
    order by position asc
    limit 1
  ),
  '🥬 Fruit & Veg',
  'reorder_aisles reassigns position by the order of the id array passed in'
);

select throws_like(
  $$select public.reorder_aisles(
      (select id from public.shops where name = 'Lidl'),
      array[gen_random_uuid()]
    )$$,
  '%requires every existing Aisle id%',
  'reorder_aisles rejects an array that does not contain every existing Aisle of the Shop exactly once'
);

-- --- reorder_shops: full-set atomic reorder --------------------------------

-- Lidl was created first (position 0), Asian Supermarket second (position
-- 1); explicitly reverse that so the assertion doesn't depend on name
-- collation matching creation order.
select public.reorder_shops(
  array[
    (select id from public.shops where name = 'Asian Supermarket'),
    (select id from public.shops where name = 'Lidl')
  ]
);

select is(
  (select name from public.shops order by position asc limit 1),
  'Asian Supermarket',
  'reorder_shops reassigns position by the order of the id array passed in'
);

select throws_like(
  $$select public.reorder_shops(array[gen_random_uuid()])$$,
  '%requires every existing Shop id%',
  'reorder_shops rejects an array that does not contain every existing Shop exactly once'
);

-- Restore a known order for the rest of the test (Lidl first).
select public.reorder_shops(
  array[
    (select id from public.shops where name = 'Lidl'),
    (select id from public.shops where name = 'Asian Supermarket')
  ]
);

-- --- Placements: one Ingredient, several Shops simultaneously -------------

select public.set_placement(
  '20000000-0000-0000-0000-000000000001',
  (select id from public.aisles where name = 'Dry Goods')
);

select public.set_placement(
  '20000000-0000-0000-0000-000000000001',
  (select id from public.aisles where name = 'Noodles & Rice')
);

select is(
  (select count(*)::int from public.placements where ingredient_id = '20000000-0000-0000-0000-000000000001'),
  2,
  'Udon noodles holds two Placements at once, one per Shop'
);

select ok(
  exists (
    select 1 from public.placements p
    join public.aisles a on a.id = p.aisle_id
    join public.shops s on s.id = a.shop_id
    where p.ingredient_id = '20000000-0000-0000-0000-000000000001'
      and s.name = 'Lidl' and a.name = 'Dry Goods'
  ),
  'Udon noodles has a Placement in Lidl''s Dry Goods'
);

select ok(
  exists (
    select 1 from public.placements p
    join public.aisles a on a.id = p.aisle_id
    join public.shops s on s.id = a.shop_id
    where p.ingredient_id = '20000000-0000-0000-0000-000000000001'
      and s.name = 'Asian Supermarket' and a.name = 'Noodles & Rice'
  ),
  'Udon noodles also has a Placement in the Asian Supermarket''s Noodles & Rice, both facts kept'
);

-- set_placement on an already-placed (ingredient, aisle) pair is a no-op,
-- not a duplicate-key error.
select lives_ok(
  $$select public.set_placement(
      '20000000-0000-0000-0000-000000000001',
      (select id from public.aisles where name = 'Dry Goods')
    )$$,
  'set_placement on an existing (ingredient, aisle) pair does not raise a duplicate-key error'
);

select is(
  (select count(*)::int from public.placements where ingredient_id = '20000000-0000-0000-0000-000000000001'),
  2,
  're-placing an Ingredient already in that Aisle does not create a duplicate row'
);

-- --- remove_placement only removes the one Placement asked for -----------

select public.remove_placement(
  '20000000-0000-0000-0000-000000000001',
  (select id from public.aisles where name = 'Dry Goods')
);

select is(
  (select count(*)::int from public.placements where ingredient_id = '20000000-0000-0000-0000-000000000001'),
  1,
  'removing one Placement leaves the Ingredient''s other Placement untouched'
);

select ok(
  exists (
    select 1 from public.placements p
    join public.aisles a on a.id = p.aisle_id
    where p.ingredient_id = '20000000-0000-0000-0000-000000000001'
      and a.name = 'Noodles & Rice'
  ),
  'the surviving Placement is the Asian Supermarket one, not the one removed'
);

-- --- Cascade behaviour: deleting an Aisle removes only its Placements ----

select public.set_placement(
  '20000000-0000-0000-0000-000000000002',
  (select id from public.aisles where name = 'Fresh & Chilled')
);

delete from public.aisles where name = 'Fresh & Chilled';

select is(
  (select count(*)::int from public.placements where ingredient_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'deleting an Aisle cascades to delete its Placements rather than orphaning them'
);

select is(
  (select count(*)::int from public.aisles where shop_id = (select id from public.shops where name = 'Asian Supermarket')),
  1,
  'deleting one Aisle leaves the Shop''s other Aisle intact'
);

-- --- Cascade behaviour: deleting a Shop removes its Aisles and Placements -

delete from public.shops where name = 'Asian Supermarket';

select is(
  (select count(*)::int from public.aisles where shop_id = (select id from public.shops where name = 'Asian Supermarket' limit 1)),
  0,
  'deleting a Shop cascades to delete its Aisles'
);

select is(
  (select count(*)::int from public.placements where ingredient_id = '20000000-0000-0000-0000-000000000001'),
  0,
  'deleting a Shop cascades through its Aisles to delete Placements, rather than orphaning them'
);

-- The Ingredient itself survives — only its Placement in the deleted
-- Shop's Aisle is gone, matching "a Shop never decides what an Ingredient
-- is" (Placements are a fact about the Ingredient x Shop pair, not the
-- Ingredient itself).
select ok(
  exists (select 1 from public.ingredients where id = '20000000-0000-0000-0000-000000000001'),
  'the Ingredient itself is unaffected by deleting a Shop that referenced it via a Placement'
);

-- --- shop_aisles view: placement_count -------------------------------------

select public.set_placement(
  '20000000-0000-0000-0000-000000000002',
  (select id from public.aisles where name = 'Dry Goods')
);

select is(
  (select placement_count::int from public.shop_aisles where aisle_id = (select id from public.aisles where name = 'Dry Goods')),
  1,
  'shop_aisles reports the Placement count for an Aisle with one Ingredient attached'
);

select is(
  (select placement_count::int from public.shop_aisles where name = '🥬 Fruit & Veg'),
  0,
  'shop_aisles reports zero for an Aisle with no Placements'
);

reset role;

-- --- RPCs reject unauthenticated (anon) callers ----------------------------
-- Clear the JWT claims set above before switching role — "set local"
-- scopes to the transaction, not the role, so the authenticated user's
-- claims would otherwise still be visible to auth.uid() here.
set local "request.jwt.claims" to '';
set local role anon;

select throws_like(
  $$select public.create_shop('Tesco')$$,
  '%requires an authenticated caller%',
  'create_shop rejects an anon-key caller'
);

select throws_like(
  $$select public.set_placement(
      '20000000-0000-0000-0000-000000000001'::uuid,
      (select id from public.aisles limit 1)
    )$$,
  '%requires an authenticated caller%',
  'set_placement rejects an anon-key caller'
);

reset role;

select * from finish();
rollback;

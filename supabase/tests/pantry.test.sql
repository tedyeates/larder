-- Pantry (#5).
--
-- Convention: supabase/tests/{module}.test.sql, mirroring RPC/table names
-- (.kiro/specs/testing.md). Seed as the service role (bypasses RLS),
-- exercise as an authenticated user, assert observable state through
-- add_stock_lot / consume_stock / set_hand_depleted_fraction and the
-- pantry_summary view — never which internal function ran.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000020', 'pantry@example.com')
  on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('20000000-0000-0000-0000-000000000001', 'Chicken thighs', 'pieces', false),
  ('20000000-0000-0000-0000-000000000002', 'Carrots', 'pieces', false),
  ('20000000-0000-0000-0000-000000000003', 'Soy sauce', 'bottle', true);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000020","role":"authenticated"}';

-- --- Same-day merge vs next-day new Lot -----------------------------------

select public.add_stock_lot(
  '20000000-0000-0000-0000-000000000001', 4, 'fridge', '2026-01-01'
);

select is(
  (select quantity from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and acquired_on = '2026-01-01'),
  4::numeric,
  'first add creates a Lot with the given quantity'
);

select public.add_stock_lot(
  '20000000-0000-0000-0000-000000000001', 2, 'fridge', '2026-01-01'
);

select is(
  (select count(*)::int from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and storage_location = 'fridge'),
  1,
  'same Ingredient, Storage Location and day merges into one Lot'
);

select is(
  (select quantity from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and acquired_on = '2026-01-01'),
  6::numeric,
  'same-day merge grows the existing Lot''s quantity rather than replacing it'
);

select public.add_stock_lot(
  '20000000-0000-0000-0000-000000000001', 3, 'fridge', '2026-01-02'
);

select is(
  (select count(*)::int from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and storage_location = 'fridge'),
  2,
  'a different day creates a separate Lot rather than merging'
);

select public.add_stock_lot(
  '20000000-0000-0000-0000-000000000001', 1, 'freezer', '2026-01-01'
);

select is(
  (select count(*)::int from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001'),
  3,
  'a different Storage Location on the same day also creates a separate Lot'
);

select throws_like(
  $$select public.add_stock_lot('20000000-0000-0000-0000-000000000001'::uuid, 0, 'fridge'::public.storage_location, '2026-01-03'::date)$$,
  '%positive quantity%',
  'adding a non-positive quantity is rejected rather than silently accepted'
);

-- --- Consumption oldest-first across multiple Lots of differing age ------
-- Chicken thighs now: 6 @ 2026-01-01 (fridge), 3 @ 2026-01-02 (fridge),
-- 1 @ 2026-01-01 (freezer). Oldest by acquired_on is the two 2026-01-01
-- Lots regardless of Storage Location, since age (not location) drives
-- FIFO order.

select is(
  (select consumed from public.consume_stock('20000000-0000-0000-0000-000000000001', 7)),
  7::numeric,
  'consuming 7 is fully satisfied by draining the oldest Lot(s) first'
);

-- After consuming 7 of (6 fridge@01-01 + 1 freezer@01-01 + 3 fridge@01-02),
-- both 2026-01-01 Lots (6 + 1 = 7 total) are fully drained before touching
-- 2026-01-02, leaving that newer Lot's 3 completely untouched.
select is(
  (select sum(quantity) from public.stock_lots where ingredient_id = '20000000-0000-0000-0000-000000000001'),
  3::numeric,
  'consumption spanning multiple Lots leaves exactly the untouched remainder'
);

select is(
  (select count(*)::int from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and acquired_on = '2026-01-01'),
  0,
  'both 2026-01-01 Lots (fridge and freezer) were fully drained, the oldest first'
);

select is(
  (select quantity from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and acquired_on = '2026-01-02'),
  3::numeric,
  'the newer Lot from a different day is left entirely untouched'
);

-- --- Empty Lots are removed ------------------------------------------------

select is(
  (select count(*)::int from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000001' and quantity = 0),
  0,
  'no Lot is ever left at zero quantity — emptied Lots are deleted, not kept'
);

-- --- Over-consumption clamps at zero and reports an accurate shortfall ---

select public.add_stock_lot('20000000-0000-0000-0000-000000000002', 3, 'fridge', '2026-01-01');

select results_eq(
  $$select requested, consumed, shortfall from public.consume_stock('20000000-0000-0000-0000-000000000002', 10)$$,
  $$values (10::numeric, 3::numeric, 7::numeric)$$,
  'requesting more than exists takes everything there is and reports the exact shortfall'
);

select is(
  (select count(*)::int from public.stock_lots where ingredient_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'over-consumption drains the Lot to zero and it is removed rather than left negative'
);

select ok(
  not exists (
    select 1 from public.stock_lots where ingredient_id = '20000000-0000-0000-0000-000000000002' and quantity < 0
  ),
  'quantity never goes negative'
);

-- --- Hand-Depleted exclusion ------------------------------------------------

select throws_like(
  $$select public.consume_stock('20000000-0000-0000-0000-000000000003'::uuid, 0.1)$$,
  '%Hand-Depleted%',
  'automatic consumption refuses a Hand-Depleted Ingredient outright'
);

select public.set_hand_depleted_fraction(
  '20000000-0000-0000-0000-000000000003', 1, 'cupboard', '2026-01-01'
);

select is(
  (select quantity from public.stock_lots where ingredient_id = '20000000-0000-0000-0000-000000000003'),
  1::numeric,
  'set_hand_depleted_fraction creates a Lot at the given fraction'
);

select public.set_hand_depleted_fraction(
  '20000000-0000-0000-0000-000000000003', 0.5, 'cupboard', '2026-01-01'
);

select is(
  (select quantity from public.stock_lots where ingredient_id = '20000000-0000-0000-0000-000000000003'),
  0.5::numeric,
  'set_hand_depleted_fraction sets (not adds to) the same day''s Lot — eyeballing half empty gives exactly 0.5'
);

select throws_like(
  $$select public.set_hand_depleted_fraction('20000000-0000-0000-0000-000000000001'::uuid, 1, 'fridge'::public.storage_location, '2026-01-01'::date)$$,
  '%not Hand-Depleted%',
  'set_hand_depleted_fraction refuses an Auto-Depleted Ingredient'
);

-- set_hand_depleted_fraction(0) removes the Lot rather than leaving a
-- zero-quantity row.
select public.set_hand_depleted_fraction(
  '20000000-0000-0000-0000-000000000003', 0, 'cupboard', '2026-01-01'
);

select is(
  (select count(*)::int from public.stock_lots where ingredient_id = '20000000-0000-0000-0000-000000000003'),
  0,
  'setting a Hand-Depleted fraction to zero removes the Lot'
);

-- --- pantry_summary groups by Storage Location with an age-bearing total -

-- Fridge currently holds the untouched 3 @ 2026-01-02 from the FIFO block
-- above; add two more dated Lots to prove the summary aggregates across
-- all of them, not just the newest.
insert into public.stock_lots (ingredient_id, quantity, storage_location, acquired_on) values
  ('20000000-0000-0000-0000-000000000001', 4, 'fridge', '2026-01-10'),
  ('20000000-0000-0000-0000-000000000001', 2, 'fridge', '2026-01-12');

select results_eq(
  $$
    select total_quantity, oldest_acquired_on, lot_count
    from public.pantry_summary
    where ingredient_id = '20000000-0000-0000-0000-000000000001' and storage_location = 'fridge'
  $$,
  $$values (9::numeric, '2026-01-02'::date, 3::bigint)$$,
  'pantry_summary totals quantity and surfaces the oldest Lot''s date per Ingredient+Storage Location'
);

-- --- Editing and deleting a Lot by hand ------------------------------------

select public.add_stock_lot('20000000-0000-0000-0000-000000000002', 5, 'counter', '2026-01-15');

update public.stock_lots set quantity = 9
where ingredient_id = '20000000-0000-0000-0000-000000000002' and storage_location = 'counter';

select is(
  (select quantity from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000002' and storage_location = 'counter'),
  9::numeric,
  'a Lot''s quantity can be edited directly by hand to correct drift'
);

delete from public.stock_lots
where ingredient_id = '20000000-0000-0000-0000-000000000002' and storage_location = 'counter';

select is(
  (select count(*)::int from public.stock_lots
     where ingredient_id = '20000000-0000-0000-0000-000000000002' and storage_location = 'counter'),
  0,
  'a Lot can be deleted directly by hand'
);

-- --- RLS: anon cannot read or write the Pantry -----------------------------

set local "request.jwt.claims" to '';
set local role anon;

select is(
  (select count(*)::int from public.stock_lots),
  0,
  'anon role reading stock_lots sees zero rows regardless of table contents'
);

select throws_ok(
  $$select public.add_stock_lot('20000000-0000-0000-0000-000000000001'::uuid, 1, 'fridge'::public.storage_location, '2026-03-01'::date)$$,
  'P0001',
  null,
  'add_stock_lot rejects an anon-key caller'
);

reset role;

select * from finish();
rollback;

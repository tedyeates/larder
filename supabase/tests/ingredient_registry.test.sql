-- Ingredient Registry (#3).
--
-- Convention: supabase/tests/{module}.test.sql, mirroring RPC/table names
-- (.kiro/specs/testing.md). Seed rows as the service role, exercise as an
-- authenticated user (single-user app, so any authenticated caller), and
-- assert observable state through resolve_ingredient_name and
-- convert_to_stock_unit — never which internal function ran.
begin;
select plan(22);

-- Seed as table owner (bypasses RLS) so fixtures aren't entangled with the
-- RLS assertions below.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000010', 'registry@example.com')
  on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('10000000-0000-0000-0000-000000000001', 'Leek', 'pieces', false),
  ('10000000-0000-0000-0000-000000000002', 'Chicken thighs', 'pieces', false),
  ('10000000-0000-0000-0000-000000000003', 'Oats', 'g', false),
  ('10000000-0000-0000-0000-000000000004', 'Garlic', 'cloves', false),
  ('10000000-0000-0000-0000-000000000005', 'Soy sauce', 'bottle', true),
  ('10000000-0000-0000-0000-000000000006', 'Flour', 'g', false);

insert into public.ingredient_aliases (ingredient_id, alias) values
  ('10000000-0000-0000-0000-000000000001', 'Leak'),
  ('10000000-0000-0000-0000-000000000002', 'Chicken');

insert into public.unit_conversions (ingredient_id, from_unit, factor_to_stock_unit) values
  ('10000000-0000-0000-0000-000000000006', 'cup', 120);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}';

-- --- Resolution: exact match ---------------------------------------------

select is(
  (select ingredient_id from public.resolve_ingredient_name('Leek') limit 1),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'exact match resolves "Leek" to the Leek Ingredient'
);

select is(
  (select match_kind::text from public.resolve_ingredient_name('Leek') limit 1),
  'exact',
  'exact match is reported as match_kind = exact'
);

select is(
  (select ingredient_id from public.resolve_ingredient_name('  leek  ') limit 1),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'exact match is case- and whitespace-insensitive'
);

select is(
  (select count(*)::int from public.resolve_ingredient_name('Leek')),
  1,
  'exact match short-circuits: exactly one candidate returned'
);

-- --- Resolution: alias match ----------------------------------------------

select is(
  (select ingredient_id from public.resolve_ingredient_name('Leak') limit 1),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'alias "Leak" resolves to the Leek Ingredient'
);

select is(
  (select match_kind::text from public.resolve_ingredient_name('Leak') limit 1),
  'alias',
  'alias match is reported as match_kind = alias'
);

select is(
  (select ingredient_id from public.resolve_ingredient_name('Chicken') limit 1),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'alias "Chicken" resolves to whichever Ingredient it is aliased to (Chicken thighs)'
);

-- --- Resolution: no match, ranked fuzzy candidates ------------------------

select ok(
  (select count(*)::int from public.resolve_ingredient_name('Chikken thighs')) >= 1,
  'a near-miss spelling returns at least one fuzzy candidate'
);

select is(
  (select match_kind::text from public.resolve_ingredient_name('Chikken thighs') limit 1),
  'fuzzy',
  'near-miss candidates are reported as match_kind = fuzzy'
);

select is(
  (select ingredient_id from public.resolve_ingredient_name('Chikken thighs') limit 1),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'the top fuzzy candidate for a near-miss spelling is the intended Ingredient'
);

select is(
  (select count(*)::int from public.resolve_ingredient_name('xyzzy nonsense ingredient')),
  0,
  'a name with nothing close returns zero candidates rather than a bad guess'
);

select ok(
  (
    select bool_and(candidates.score is not null and candidates.score between 0 and 1)
    from public.resolve_ingredient_name('Chikken thighs') candidates
  ),
  'fuzzy candidates carry a similarity score between 0 and 1'
);

-- --- Conversion: succeeds with a factor -----------------------------------

select is(
  public.convert_to_stock_unit('10000000-0000-0000-0000-000000000006', 1, 'cup'),
  120::numeric,
  '1 cup flour converts to 120 g via its Convertible Unit factor'
);

select is(
  public.convert_to_stock_unit('10000000-0000-0000-0000-000000000006', 2.5, 'cup'),
  300::numeric,
  'conversion scales linearly with amount'
);

select is(
  public.convert_to_stock_unit('10000000-0000-0000-0000-000000000006', 50, 'g'),
  50::numeric,
  'an amount already in the Stock Unit passes through unchanged with no factor lookup'
);

-- --- Conversion: fails loudly without a factor ----------------------------

select throws_ok(
  $$select public.convert_to_stock_unit('10000000-0000-0000-0000-000000000006'::uuid, 1, 'handful')$$,
  'P0001',
  null,
  'converting via a unit with no Convertible Unit factor raises rather than guessing'
);

select throws_like(
  $$select public.convert_to_stock_unit('10000000-0000-0000-0000-000000000006'::uuid, 1, 'handful')$$,
  '%No Convertible Unit factor%',
  'the failure names the missing factor so it is a clear reason, not a generic error'
);

-- --- Hand-Depleted flag behaviour ------------------------------------------

select ok(
  (select is_hand_depleted from public.ingredients where id = '10000000-0000-0000-0000-000000000005'),
  'Soy sauce is flagged Hand-Depleted'
);

update public.ingredients
set is_hand_depleted = true
where id = '10000000-0000-0000-0000-000000000001';

select ok(
  (select is_hand_depleted from public.ingredients where id = '10000000-0000-0000-0000-000000000001'),
  'any Ingredient can be flagged Hand-Depleted by an authenticated user'
);

-- Hand-Depleted is a flag on an otherwise ordinary Ingredient: it still
-- resolves normally and still requires a real factor to convert into its
-- Stock Unit if a Recipe ever states a quantity for it.
select is(
  (select ingredient_id from public.resolve_ingredient_name('Soy sauce') limit 1),
  '10000000-0000-0000-0000-000000000005'::uuid,
  'a Hand-Depleted Ingredient still resolves by name like any other'
);

reset role;

-- --- Both RPCs reject unauthenticated (anon) callers ----------------------
-- Clear the JWT claims set above before switching role — "set local" scopes
-- to the transaction, not the role, so the authenticated user's claims
-- would otherwise still be visible to auth.uid() here.
set local "request.jwt.claims" to '';
set local role anon;

select throws_like(
  $$select public.resolve_ingredient_name('Leek')$$,
  '%requires an authenticated caller%',
  'resolve_ingredient_name rejects an anon-key caller rather than resolving anything'
);

select throws_like(
  $$select public.convert_to_stock_unit('10000000-0000-0000-0000-000000000006'::uuid, 1, 'cup')$$,
  '%requires an authenticated caller%',
  'convert_to_stock_unit rejects an anon-key caller rather than converting anything'
);

reset role;

select * from finish();
rollback;

-- Recipes (#7).
--
-- Convention: supabase/tests/{module}.test.sql, mirroring RPC/table names
-- (.kiro/specs/testing.md). Seed as the service role (bypasses RLS),
-- exercise as an authenticated user, assert observable state through
-- create_recipe_line / resolve_recipe_line / reorder_recipe_lines and the
-- recipe_line_inconsistencies / recipe_status / recipe_cookability views —
-- never which internal function ran.
begin;
select plan(36);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000030', 'recipes@example.com')
  on conflict (id) do nothing;

insert into public.ingredients (id, name, stock_unit, is_hand_depleted) values
  ('30000000-0000-0000-0000-000000000001', 'Chicken thighs', 'pieces', false),
  ('30000000-0000-0000-0000-000000000002', 'Mirin', 'ml', false),
  ('30000000-0000-0000-0000-000000000003', 'Rice wine', 'ml', false),
  ('30000000-0000-0000-0000-000000000004', 'Soy sauce', 'bottle', true),
  ('30000000-0000-0000-0000-000000000005', 'Flour', 'g', false);

insert into public.unit_conversions (ingredient_id, from_unit, factor_to_stock_unit) values
  ('30000000-0000-0000-0000-000000000005', 'cup', 120);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}';

-- --- Recipe CRUD ------------------------------------------------------------

insert into public.recipes (name, servings, max_multiplier, prep_minutes, cook_minutes, source)
values ('Chicken Stir-fry', 4, 3, 10, 15, 'family recipe')
returning id as recipe_id \gset

select is(
  (select name from public.recipes where id = :'recipe_id'),
  'Chicken Stir-fry',
  'a Recipe can be created with name, servings, max multiplier, prep/cook time and source'
);

select throws_like(
  $$insert into public.recipes (name, servings) values ('', 4)$$,
  '%recipes_name_not_blank%',
  'a blank Recipe name is rejected'
);

select throws_like(
  $$insert into public.recipes (name, servings) values ('Bad servings', 0)$$,
  '%recipes_servings_positive%',
  'a non-positive servings count is rejected'
);

-- --- create_recipe_line: amount in Stock Unit or Convertible Unit ----------

select (public.create_recipe_line(
  :'recipe_id'::uuid, '30000000-0000-0000-0000-000000000001', null, 8, 'pieces', null, false
)).id is not null as ok \gset
select ok(:'ok', 'a line stating the amount in the Ingredient''s own Stock Unit is accepted');

select (public.create_recipe_line(
  :'recipe_id'::uuid, '30000000-0000-0000-0000-000000000005', null, 1, 'cup', '≈ half a bag', false
)).id is not null as ok \gset
select ok(:'ok', 'a line stating the amount in a Convertible Unit with a known factor is accepted');

select is(
  (
    select note from public.recipe_lines
    where recipe_id = :'recipe_id' and ingredient_id = '30000000-0000-0000-0000-000000000005'
  ),
  '≈ half a bag',
  'the optional human note is stored alongside the exact amount'
);

-- --- Non-convertible units are rejected, not stored -------------------------

select throws_like(
  $$select public.create_recipe_line(
      (select id from public.recipes where name = 'Chicken Stir-fry'),
      '30000000-0000-0000-0000-000000000001'::uuid, null, 1, 'handful', null, false
    )$$,
  '%No Convertible Unit factor%',
  'a non-convertible unit ("handful") is rejected at write time rather than stored'
);

select is(
  (select count(*)::int from public.recipe_lines where unit = 'handful'),
  0,
  'the rejected non-convertible-unit line was never persisted'
);

-- --- No quantity: legal only for a Hand-Depleted Ingredient -----------------

select (public.create_recipe_line(
  :'recipe_id'::uuid, '30000000-0000-0000-0000-000000000004', null, null, null, 'splash', false
)).id is not null as ok \gset
select ok(:'ok', 'a line with no quantity is accepted for a Hand-Depleted Ingredient');

select throws_like(
  $$select public.create_recipe_line(
      (select id from public.recipes where name = 'Chicken Stir-fry'),
      '30000000-0000-0000-0000-000000000001'::uuid, null, null, null, null, false
    )$$,
  '%only legal for a Hand-Depleted Ingredient%',
  'a line with no quantity is rejected for an Auto-Depleted Ingredient'
);

-- --- Unresolved Ingredient lines: no ingredient yet, raw_name kept ---------

select (public.create_recipe_line(
  :'recipe_id'::uuid, null, 'Leak', 2, 'pieces', null, false
)).id is not null as ok \gset
select ok(:'ok', 'a line naming an unmatched Ingredient by free text is accepted as Unresolved');

select is(
  (select raw_name from public.recipe_lines where raw_name = 'Leak'),
  'Leak',
  'an Unresolved line keeps its free-text raw_name'
);

-- --- Inconsistencies: one row per rule, with a reason -----------------------

select is(
  (
    select reason from public.recipe_line_inconsistencies
    where recipe_line_id = (select id from public.recipe_lines where raw_name = 'Leak')
  ),
  'unresolved_ingredient',
  'an Unresolved Ingredient line is listed with reason unresolved_ingredient'
);

-- Force a non-convertible-unit Inconsistency into existence by editing an
-- Ingredient's Convertible Units out from under an already-saved line,
-- proving the view re-derives live rather than trusting what create
-- validated at write time.
select (public.create_recipe_line(
  :'recipe_id'::uuid, '30000000-0000-0000-0000-000000000005', null, 1, 'cup', null, false
)).id is not null as ok \gset
select ok(:'ok', 'a second cup-of-flour line is accepted while the Convertible Unit factor still exists');

delete from public.unit_conversions
where ingredient_id = '30000000-0000-0000-0000-000000000005' and from_unit = 'cup';

select is(
  (
    select count(*)::int from public.recipe_line_inconsistencies
    where recipe_id = :'recipe_id' and reason = 'non_convertible_unit'
  ),
  2,
  'removing a Convertible Unit factor surfaces every previously-valid line using it as non_convertible_unit — live-derived, not stored'
);

insert into public.unit_conversions (ingredient_id, from_unit, factor_to_stock_unit) values
  ('30000000-0000-0000-0000-000000000005', 'cup', 120);

select is(
  (
    select count(*)::int from public.recipe_line_inconsistencies
    where recipe_id = :'recipe_id' and reason = 'non_convertible_unit'
  ),
  0,
  'restoring the Convertible Unit factor clears the non_convertible_unit Inconsistency without editing the line'
);

-- unmeasured_on_auto_depleted: flip an Ingredient's Hand-Depleted flag off
-- under an existing no-quantity line to prove that rule is live too.
select (public.create_recipe_line(
  :'recipe_id'::uuid, '30000000-0000-0000-0000-000000000004', null, null, null, 'a splash', false
)).id is not null as ok \gset

update public.ingredients set is_hand_depleted = false
where id = '30000000-0000-0000-0000-000000000004';

select ok(
  exists (
    select 1 from public.recipe_line_inconsistencies
    where recipe_id = :'recipe_id' and reason = 'unmeasured_on_auto_depleted'
  ),
  'a no-quantity line on an Ingredient later made Auto-Depleted is surfaced as unmeasured_on_auto_depleted'
);

update public.ingredients set is_hand_depleted = true
where id = '30000000-0000-0000-0000-000000000004';

-- --- resolve_recipe_line: maps an Unresolved name, remembers an Alias ------

select (public.resolve_recipe_line(
  (select id from public.recipe_lines where raw_name = 'Leak'),
  '30000000-0000-0000-0000-000000000001', -- resolve "Leak" to Chicken thighs for this test's purposes
  true
)).id is not null as ok \gset
select ok(:'ok', 'resolve_recipe_line maps an Unresolved line to an existing Ingredient');

select is(
  (select ingredient_id from public.recipe_lines where raw_name = 'Leak'),
  '30000000-0000-0000-0000-000000000001'::uuid,
  'after resolution the line carries the resolved ingredient_id'
);

select ok(
  exists (
    select 1 from public.ingredient_aliases
    where ingredient_id = '30000000-0000-0000-0000-000000000001' and lower(alias) = 'leak'
  ),
  'resolving a line creates an Alias so the same free text is never asked about twice'
);

select is(
  (
    select count(*)::int from public.recipe_line_inconsistencies
    where recipe_line_id = (select id from public.recipe_lines where raw_name = 'Leak')
  ),
  0,
  'a resolved line with a valid amount/unit no longer appears as an Inconsistency'
);

-- --- Essential suppresses Substitutes ---------------------------------------

insert into public.recipes (name, servings) values ('Sushi', 2) returning id as sushi_id \gset

select (public.create_recipe_line(
  :'sushi_id'::uuid, '30000000-0000-0000-0000-000000000002', null, 30, 'ml', null, true
)).id as line_id \gset

select throws_like(
  $$insert into public.recipe_line_substitutes (recipe_line_id, ingredient_id)
    values ((select id from public.recipe_lines where recipe_id = (select id from public.recipes where name = 'Sushi')),
            '30000000-0000-0000-0000-000000000003')$$,
  '%Essential%',
  'adding a Substitute to an Essential line is rejected'
);

-- --- Substitutes acceptable for one Recipe only ------------------------------

insert into public.recipes (name, servings) values ('Stir-fry', 4) returning id as stirfry_id \gset

select (public.create_recipe_line(
  :'stirfry_id'::uuid, '30000000-0000-0000-0000-000000000002', null, 30, 'ml', null, false
)).id as stirfry_mirin_line \gset

insert into public.recipe_line_substitutes (recipe_line_id, ingredient_id)
values (:'stirfry_mirin_line', '30000000-0000-0000-0000-000000000003');

select ok(
  exists (
    select 1 from public.recipe_line_substitutes where recipe_line_id = :'stirfry_mirin_line'
      and ingredient_id = '30000000-0000-0000-0000-000000000003'
  ),
  'rice wine is listed as an acceptable Substitute for mirin in the stir-fry Recipe'
);

select is(
  (select count(*)::int from public.recipe_line_substitutes
     where recipe_line_id = :'line_id'),
  0,
  'the sushi Recipe''s Essential mirin line carries no Substitutes even though another Recipe allows one'
);

-- --- Marking a line Essential after the fact clears its Substitutes --------

update public.recipe_lines set is_essential = true where id = :'stirfry_mirin_line';

select is(
  (select count(*)::int from public.recipe_line_substitutes where recipe_line_id = :'stirfry_mirin_line'),
  0,
  'flipping an existing line to Essential clears any Substitutes it already carried'
);

update public.recipe_lines set is_essential = false where id = :'stirfry_mirin_line';

-- Re-add the Substitute the essential-flip trigger just cleared — the
-- Cookable assertions below depend on it existing again.
insert into public.recipe_line_substitutes (recipe_line_id, ingredient_id)
values (:'stirfry_mirin_line', '30000000-0000-0000-0000-000000000003');

-- --- Cookable: with and without Substitutes, Essential suppressing it -----

-- Sushi: one Essential mirin line, Pantry empty -> missing -> not Cookable.
select is(
  (select is_cookable from public.recipe_cookability where recipe_id = :'sushi_id'),
  false,
  'Sushi is not Cookable while its Essential mirin line has no Pantry stock and no Substitute is ever offered'
);

-- Give the Pantry rice wine (the stir-fry's substitute) but not mirin.
select public.add_stock_lot('30000000-0000-0000-0000-000000000003', 500, 'cupboard', '2026-01-01');

select is(
  (select status from public.recipe_status where recipe_line_id = :'stirfry_mirin_line'),
  'fulfilled_by_substitute',
  'the stir-fry''s mirin line is Fulfilled by Substitute when rice wine is in stock but mirin is not'
);

select is(
  (select is_cookable from public.recipe_cookability where recipe_id = :'stirfry_id'),
  true,
  'the stir-fry Recipe is Cookable via its Substitute even though the named Ingredient itself is out of stock'
);

-- Sushi still is not Cookable: same Pantry state, but its Essential line
-- never looks at recipe_line_substitutes at all.
select is(
  (select status from public.recipe_status where recipe_line_id = :'line_id'),
  'missing',
  'Sushi''s Essential mirin line stays missing regardless of rice wine in stock, since Essential suppresses substitution entirely'
);

select is(
  (select is_cookable from public.recipe_cookability where recipe_id = :'sushi_id'),
  false,
  'Sushi remains not Cookable: Essential suppresses the very Substitute that makes the stir-fry Cookable'
);

-- Now stock mirin directly: Sushi becomes Cookable via direct stock, no
-- Substitute involved.
select public.add_stock_lot('30000000-0000-0000-0000-000000000002', 500, 'cupboard', '2026-01-01');

select is(
  (select status from public.recipe_status where recipe_line_id = :'line_id'),
  'available',
  'Sushi''s mirin line is available once mirin itself is stocked directly'
);

select is(
  (select is_cookable from public.recipe_cookability where recipe_id = :'sushi_id'),
  true,
  'Sushi is Cookable once every line is available or fulfilled by substitute'
);

-- --- reorder_recipe_lines: full-set atomic reorder --------------------------

insert into public.recipes (name, servings) values ('Reorder Test', 2) returning id as reorder_id \gset

select (public.create_recipe_line(:'reorder_id'::uuid, '30000000-0000-0000-0000-000000000001', null, 1, 'pieces', null, false)).id as line_a \gset
select (public.create_recipe_line(:'reorder_id'::uuid, '30000000-0000-0000-0000-000000000002', null, 1, 'ml', null, false)).id as line_b \gset

select public.reorder_recipe_lines(:'reorder_id'::uuid, array[:'line_b'::uuid, :'line_a'::uuid]);

select is(
  (select id from public.recipe_lines where recipe_id = :'reorder_id' order by position asc limit 1),
  :'line_b'::uuid,
  'reorder_recipe_lines reassigns position by the order of the id array passed in'
);

select throws_like(
  $$select public.reorder_recipe_lines(
      (select id from public.recipes where name = 'Reorder Test'),
      array[gen_random_uuid()]
    )$$,
  '%requires every existing Recipe Line id%',
  'reorder_recipe_lines rejects an array that does not contain every existing Line of the Recipe exactly once'
);

-- --- RLS: anon cannot read or write Recipes ---------------------------------

set local "request.jwt.claims" to '';
set local role anon;

select is(
  (select count(*)::int from public.recipes),
  0,
  'anon role reading recipes sees zero rows regardless of table contents'
);

select throws_ok(
  $$select public.create_recipe_line(
      '00000000-0000-0000-0000-000000000000'::uuid, '30000000-0000-0000-0000-000000000001'::uuid, null, 1, 'pieces', null, false
    )$$,
  'P0001',
  null,
  'create_recipe_line rejects an anon-key caller'
);

reset role;

select * from finish();
rollback;

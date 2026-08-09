-- Ingredient Registry (#3): the module every other part of the system
-- depends on for naming and units.
--
-- Per docs/adr/0003-recipes-measure-in-stock-units.md and
-- .kiro/specs/larder-core/design.md: Ingredients have exactly one Stock
-- Unit, Aliases resolve alternate wordings, Convertible Units carry exact
-- factors, and Hand-Depleted Ingredients may be stocked/consumed without
-- exact arithmetic. Resolution is exact-then-alias-then-fuzzy, and
-- conversion fails loudly when no factor exists — no other module performs
-- a conversion or a resolution.
--
-- Single-authenticated-user app (.kiro/specs/security.md): policies gate on
-- `auth.uid() is not null` rather than per-row ownership.
create extension if not exists pg_trgm;

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stock_unit text not null,
  is_hand_depleted boolean not null default false,
  last_purchased_amount numeric,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint ingredients_name_not_blank check (btrim(name) <> ''),
  constraint ingredients_stock_unit_not_blank check (btrim(stock_unit) <> ''),
  constraint ingredients_status_valid check (status in ('active', 'archived')),
  constraint ingredients_last_purchased_amount_nonnegative
    check (last_purchased_amount is null or last_purchased_amount >= 0)
);

comment on table public.ingredients is
  'Canonical, uniquely-named things a Recipe consumes and the Pantry stocks. Exactly one Stock Unit each. Referenced by ID everywhere else, never by name.';
comment on column public.ingredients.status is
  'active or archived. Archived ingredients are excluded from resolution but kept for referential integrity of old Recipes/Lots.';

-- Case-insensitive uniqueness on name — "Leek" and "leek" are the same
-- Ingredient, which also keeps exact-match resolution unambiguous.
create unique index ingredients_name_unique_ci on public.ingredients (lower(btrim(name)));

-- Trigram index backing fuzzy resolution candidates.
create index ingredients_name_trgm_idx on public.ingredients using gin (name gin_trgm_ops);

select public.apply_deny_all_rls('public.ingredients');

create policy "ingredients_select_authenticated"
  on public.ingredients for select
  to authenticated
  using (auth.uid() is not null);

create policy "ingredients_insert_authenticated"
  on public.ingredients for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "ingredients_update_authenticated"
  on public.ingredients for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "ingredients_delete_authenticated"
  on public.ingredients for delete
  to authenticated
  using (auth.uid() is not null);

-- Aliases: alternate wordings that resolve to one Ingredient. "Leak" and
-- "Chicken" are Aliases; they must not collide with each other or with any
-- Ingredient's own name, or resolution would be ambiguous about which
-- table to prefer.
create table public.ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  constraint ingredient_aliases_alias_not_blank check (btrim(alias) <> '')
);

comment on table public.ingredient_aliases is
  'Alternate spellings/wordings that resolve to one Ingredient, e.g. "Leak" -> Leek, "Chicken" -> a specific cut.';

create unique index ingredient_aliases_alias_unique_ci on public.ingredient_aliases (lower(btrim(alias)));
create index ingredient_aliases_ingredient_id_idx on public.ingredient_aliases (ingredient_id);
create index ingredient_aliases_alias_trgm_idx on public.ingredient_aliases using gin (alias gin_trgm_ops);

select public.apply_deny_all_rls('public.ingredient_aliases');

create policy "ingredient_aliases_select_authenticated"
  on public.ingredient_aliases for select
  to authenticated
  using (auth.uid() is not null);

create policy "ingredient_aliases_insert_authenticated"
  on public.ingredient_aliases for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "ingredient_aliases_update_authenticated"
  on public.ingredient_aliases for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "ingredient_aliases_delete_authenticated"
  on public.ingredient_aliases for delete
  to authenticated
  using (auth.uid() is not null);

-- An alias may not shadow any Ingredient's own name — otherwise "resolve
-- this name" would have two conflicting exact answers.
create or replace function public.ingredient_aliases_check_no_name_collision()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.ingredients
    where lower(btrim(name)) = lower(btrim(new.alias))
  ) then
    raise exception 'Alias "%" collides with an existing Ingredient name', new.alias
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger ingredient_aliases_no_name_collision
  before insert or update on public.ingredient_aliases
  for each row execute function public.ingredient_aliases_check_no_name_collision();

-- Convertible Units: a standard unit with a known exact factor to the
-- Ingredient's Stock Unit ("1 cup flour = 120 g"). One factor per
-- (ingredient, from_unit) pair.
create table public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  from_unit text not null,
  factor_to_stock_unit numeric not null,
  created_at timestamptz not null default now(),
  constraint unit_conversions_from_unit_not_blank check (btrim(from_unit) <> ''),
  constraint unit_conversions_factor_positive check (factor_to_stock_unit > 0)
);

comment on table public.unit_conversions is
  'Exact factor from one natural cooking measure to an Ingredient''s Stock Unit, e.g. from_unit=cup, factor_to_stock_unit=120 for an Ingredient stocked in g.';

create unique index unit_conversions_ingredient_unit_unique
  on public.unit_conversions (ingredient_id, lower(btrim(from_unit)));

select public.apply_deny_all_rls('public.unit_conversions');

create policy "unit_conversions_select_authenticated"
  on public.unit_conversions for select
  to authenticated
  using (auth.uid() is not null);

create policy "unit_conversions_insert_authenticated"
  on public.unit_conversions for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "unit_conversions_update_authenticated"
  on public.unit_conversions for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "unit_conversions_delete_authenticated"
  on public.unit_conversions for delete
  to authenticated
  using (auth.uid() is not null);

-- A from_unit equal to the Ingredient's own Stock Unit is redundant (factor
-- is trivially 1) and would just be a second way to say the same thing, so
-- it is rejected rather than silently accepted.
create or replace function public.unit_conversions_check_not_stock_unit()
returns trigger
language plpgsql
as $$
declare
  target_stock_unit text;
begin
  select stock_unit into target_stock_unit
  from public.ingredients
  where id = new.ingredient_id;

  if target_stock_unit is not null and lower(btrim(target_stock_unit)) = lower(btrim(new.from_unit)) then
    raise exception 'from_unit "%" is already this Ingredient''s Stock Unit', new.from_unit
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger unit_conversions_not_stock_unit
  before insert or update on public.unit_conversions
  for each row execute function public.unit_conversions_check_not_stock_unit();

-- ---------------------------------------------------------------------
-- Resolution: exact -> alias -> fuzzy, ranked candidates on failure.
-- ---------------------------------------------------------------------

create type public.ingredient_match_kind as enum ('exact', 'alias', 'fuzzy');

-- Returns ranked candidate Ingredients for a free-text name. `match_kind`
-- tells the caller how the match was made and `score` is 1.0 for exact and
-- alias matches, and pg_trgm similarity (0..1) for fuzzy ones. Exact and
-- alias matches short-circuit fuzzy search entirely, since design intends
-- fuzzy only for the case neither of the first two hit.
create or replace function public.resolve_ingredient_name(
  p_name text,
  p_limit integer default 5
)
returns table (
  ingredient_id uuid,
  name text,
  match_kind public.ingredient_match_kind,
  score real
)
language plpgsql
stable
as $$
declare
  v_name text := btrim(p_name);
begin
  if auth.uid() is null then
    raise exception 'resolve_ingredient_name requires an authenticated caller';
  end if;

  if v_name = '' then
    raise exception 'resolve_ingredient_name requires a non-blank name';
  end if;

  -- Exact match on the Ingredient's own name.
  return query
    select i.id, i.name, 'exact'::public.ingredient_match_kind, 1.0::real
    from public.ingredients i
    where i.status = 'active'
      and lower(btrim(i.name)) = lower(v_name)
    limit 1;

  if found then
    return;
  end if;

  -- Alias match.
  return query
    select i.id, i.name, 'alias'::public.ingredient_match_kind, 1.0::real
    from public.ingredient_aliases a
    join public.ingredients i on i.id = a.ingredient_id
    where i.status = 'active'
      and lower(btrim(a.alias)) = lower(v_name)
    limit 1;

  if found then
    return;
  end if;

  -- Fuzzy match over both Ingredient names and Aliases, ranked by
  -- similarity, deduplicated to one row per Ingredient (its best score).
  return query
    select ranked.ingredient_id, ranked.name, 'fuzzy'::public.ingredient_match_kind, ranked.score
    from (
      select distinct on (candidates.ingredient_id)
        candidates.ingredient_id,
        candidates.name,
        candidates.score
      from (
        select i.id as ingredient_id, i.name, similarity(i.name, v_name) as score
        from public.ingredients i
        where i.status = 'active'
        union all
        select i.id as ingredient_id, i.name, similarity(a.alias, v_name) as score
        from public.ingredient_aliases a
        join public.ingredients i on i.id = a.ingredient_id
        where i.status = 'active'
      ) candidates
      order by candidates.ingredient_id, candidates.score desc
    ) ranked
    where ranked.score > 0.2
    order by ranked.score desc
    limit p_limit;
end;
$$;

comment on function public.resolve_ingredient_name(text, integer) is
  'Resolves free text to an Ingredient: exact name match, then alias match, then ranked pg_trgm fuzzy candidates over names and aliases. Returns zero rows when nothing clears the fuzzy threshold, so callers show "no match" rather than a bad guess.';

-- Converts an amount in `p_unit` into the Ingredient's Stock Unit.
-- Succeeds only when `p_unit` IS the Stock Unit (factor 1, no lookup
-- needed) or a matching row exists in unit_conversions. Raises rather than
-- guessing when neither holds — that failure is what ticket #4 turns into
-- an Inconsistency. This is the only place in the system that converts
-- units; nothing else should duplicate this arithmetic.
create or replace function public.convert_to_stock_unit(
  p_ingredient_id uuid,
  p_amount numeric,
  p_unit text
)
returns numeric
language plpgsql
stable
as $$
declare
  v_stock_unit text;
  v_factor numeric;
begin
  if auth.uid() is null then
    raise exception 'convert_to_stock_unit requires an authenticated caller';
  end if;

  select stock_unit into v_stock_unit
  from public.ingredients
  where id = p_ingredient_id;

  if v_stock_unit is null then
    raise exception 'No Ingredient found for id %', p_ingredient_id;
  end if;

  if p_amount < 0 then
    raise exception 'Amount must be non-negative, got %', p_amount;
  end if;

  if lower(btrim(p_unit)) = lower(btrim(v_stock_unit)) then
    return p_amount;
  end if;

  select factor_to_stock_unit into v_factor
  from public.unit_conversions
  where ingredient_id = p_ingredient_id
    and lower(btrim(from_unit)) = lower(btrim(p_unit));

  if v_factor is null then
    raise exception
      'No Convertible Unit factor from "%" to Stock Unit "%" for this Ingredient', p_unit, v_stock_unit
      using errcode = 'P0001', hint = 'Add a Convertible Unit factor for this ingredient and unit.';
  end if;

  return p_amount * v_factor;
end;
$$;

comment on function public.convert_to_stock_unit(uuid, numeric, text) is
  'Converts p_amount in p_unit into the Ingredient''s Stock Unit. Succeeds when p_unit is the Stock Unit itself or a Convertible Unit factor exists; raises with a clear message otherwise rather than guessing. The only unit-conversion arithmetic in the system.';

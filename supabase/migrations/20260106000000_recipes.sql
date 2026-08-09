-- Recipes (#7): recipes, lines, per-line Substitutes and Essential flags,
-- tags, rating. Exposes per-line cookability and an Inconsistency list.
--
-- Per docs/adr/0003-recipes-measure-in-stock-units.md and
-- .kiro/specs/larder-core/design.md: every Recipe Line references an
-- Ingredient by ID and states its amount in that Ingredient's Stock Unit
-- or a Convertible Unit with a known factor — arithmetic never guesses.
-- The only exception is a Hand-Depleted Ingredient, which may carry no
-- quantity at all. A line can also carry no Ingredient yet (an Unresolved
-- Ingredient, `ingredient_id is null`, `raw_name` holds the free text
-- until resolved). Anything that blocks exact arithmetic is an
-- Inconsistency, computed live from current state rather than stored, so
-- it can never drift from the row it describes.
--
-- Single-authenticated-user app (.kiro/specs/security.md): policies gate
-- on `auth.uid() is not null`, matching every other module.
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  servings integer not null,
  max_multiplier integer not null default 1,
  rating integer,
  prep_minutes integer,
  cook_minutes integer,
  source text,
  steps text,
  created_at timestamptz not null default now(),
  constraint recipes_name_not_blank check (btrim(name) <> ''),
  constraint recipes_servings_positive check (servings > 0),
  constraint recipes_max_multiplier_positive check (max_multiplier > 0),
  constraint recipes_rating_range check (rating is null or rating between 1 and 5),
  constraint recipes_prep_minutes_nonnegative check (prep_minutes is null or prep_minutes >= 0),
  constraint recipes_cook_minutes_nonnegative check (cook_minutes is null or cook_minutes >= 0)
);

comment on table public.recipes is
  'A set of instructions producing servings Portions from a list of Ingredients. Rating is settable at any time, independent of cooking. max_multiplier caps how far a Cook may scale it.';
comment on column public.recipes.rating is
  '1-5, settable whenever, independent of cooking it. Null until rated.';
comment on column public.recipes.max_multiplier is
  'The largest multiplier a Cook may use to scale servings. Also enforced by Plan Check (#15) when a Meal Plan assigns a multiplier.';
comment on column public.recipes.steps is
  'Free-text method. Deliberately unstructured — steps are prose, not data the app reasons over.';

select public.apply_deny_all_rls('public.recipes');

create policy "recipes_select_authenticated"
  on public.recipes for select
  to authenticated
  using (auth.uid() is not null);

create policy "recipes_insert_authenticated"
  on public.recipes for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "recipes_update_authenticated"
  on public.recipes for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "recipes_delete_authenticated"
  on public.recipes for delete
  to authenticated
  using (auth.uid() is not null);

create index recipes_name_idx on public.recipes (name);

-- Tags: free text, sectioned client-side into Allergen Flags (a fixed
-- known vocabulary) versus everything else (cuisine, meal type). The
-- table itself carries no such distinction — recognising an allergen tag
-- is display logic, not a stored transition.
create table public.recipe_tags (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  tag text not null,
  constraint recipe_tags_tag_not_blank check (btrim(tag) <> '')
);

comment on table public.recipe_tags is
  'Free-text tags on a Recipe. Allergen Flags are a fixed known subset of tag values recognised client-side, not a separate column.';

create unique index recipe_tags_unique on public.recipe_tags (recipe_id, lower(btrim(tag)));
create index recipe_tags_recipe_id_idx on public.recipe_tags (recipe_id);

select public.apply_deny_all_rls('public.recipe_tags');

create policy "recipe_tags_select_authenticated"
  on public.recipe_tags for select
  to authenticated
  using (auth.uid() is not null);

create policy "recipe_tags_insert_authenticated"
  on public.recipe_tags for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "recipe_tags_delete_authenticated"
  on public.recipe_tags for delete
  to authenticated
  using (auth.uid() is not null);

-- Recipe Lines: one per Ingredient a Recipe needs. ingredient_id is
-- nullable — an Unresolved Ingredient keeps its free-text raw_name until
-- resolve_recipe_line maps it, exactly like the pre-resolution state the
-- Recipe Parser (#12) will also produce. amount/unit are nullable
-- together: a line may carry no quantity at all, but only legally for a
-- Hand-Depleted Ingredient, which create_recipe_line/update_recipe_line
-- enforce at write time so a bad line is never stored, while
-- recipe_line_inconsistencies (below) re-derives the same rules live for
-- display, since an Ingredient's Hand-Depleted flag or a Convertible
-- Unit factor can change after the line was written.
create table public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ingredient_id uuid references public.ingredients (id) on delete set null,
  raw_name text,
  amount numeric,
  unit text,
  note text,
  is_essential boolean not null default false,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint recipe_lines_has_name_or_ingredient
    check (ingredient_id is not null or (raw_name is not null and btrim(raw_name) <> '')),
  constraint recipe_lines_amount_unit_together
    check ((amount is null) = (unit is null)),
  constraint recipe_lines_amount_positive check (amount is null or amount > 0),
  constraint recipe_lines_unit_not_blank check (unit is null or btrim(unit) <> ''),
  constraint recipe_lines_note_not_blank check (note is null or btrim(note) <> '')
);

comment on table public.recipe_lines is
  'One Ingredient a Recipe needs. ingredient_id is null for an Unresolved Ingredient (raw_name holds the free text until resolve_recipe_line maps it). amount/unit are both-or-neither; a line with neither is only legal for a Hand-Depleted Ingredient, enforced by create_recipe_line/update_recipe_line and re-checked live by recipe_line_inconsistencies for display.';
comment on column public.recipe_lines.raw_name is
  'The free-text name as written, kept even after resolution so the Recipe still reads as authored. The only field that matters while ingredient_id is null.';
comment on column public.recipe_lines.unit is
  'The unit the amount was stated in — the Ingredient''s own Stock Unit or a Convertible Unit. Never stored unconverted amounts in a non-convertible unit; those are rejected at write time as an Inconsistency rather than saved.';
comment on column public.recipe_lines.is_essential is
  'No Substitute is ever offered for this line, regardless of what recipe_line_substitutes holds for it.';
comment on column public.recipe_lines.position is
  'Explicit display/step order, 0-based. Reordered as a full set via reorder_recipe_lines.';

alter table public.recipe_lines
  add constraint recipe_lines_position_unique unique (recipe_id, position) deferrable initially deferred;

create index recipe_lines_recipe_id_idx on public.recipe_lines (recipe_id);
create index recipe_lines_ingredient_id_idx on public.recipe_lines (ingredient_id);

select public.apply_deny_all_rls('public.recipe_lines');

create policy "recipe_lines_select_authenticated"
  on public.recipe_lines for select
  to authenticated
  using (auth.uid() is not null);

create policy "recipe_lines_insert_authenticated"
  on public.recipe_lines for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "recipe_lines_update_authenticated"
  on public.recipe_lines for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "recipe_lines_delete_authenticated"
  on public.recipe_lines for delete
  to authenticated
  using (auth.uid() is not null);

-- Substitutes: an alternative Ingredient acceptable for one specific
-- Recipe Line, never global to the Ingredient. Suppressed entirely when
-- the line is_essential — enforced here so an Essential line can never
-- carry rows that would silently be offered anyway if the flag were later
-- cleared and re-set.
create table public.recipe_line_substitutes (
  id uuid primary key default gen_random_uuid(),
  recipe_line_id uuid not null references public.recipe_lines (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.recipe_line_substitutes is
  'An Ingredient acceptable as a stand-in for one specific Recipe Line only — rice wine may replace mirin in a stir-fry and not in sushi. Never offered when the line is_essential.';

create unique index recipe_line_substitutes_unique
  on public.recipe_line_substitutes (recipe_line_id, ingredient_id);

create index recipe_line_substitutes_line_id_idx on public.recipe_line_substitutes (recipe_line_id);

select public.apply_deny_all_rls('public.recipe_line_substitutes');

create policy "recipe_line_substitutes_select_authenticated"
  on public.recipe_line_substitutes for select
  to authenticated
  using (auth.uid() is not null);

create policy "recipe_line_substitutes_insert_authenticated"
  on public.recipe_line_substitutes for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "recipe_line_substitutes_delete_authenticated"
  on public.recipe_line_substitutes for delete
  to authenticated
  using (auth.uid() is not null);

-- A substitute is meaningless on an Essential line — nothing would ever
-- read it, and a later is_essential toggle must not resurrect stale rows.
create or replace function public.recipe_line_substitutes_check_not_essential()
returns trigger
language plpgsql
as $$
declare
  v_is_essential boolean;
begin
  select is_essential into v_is_essential
  from public.recipe_lines
  where id = new.recipe_line_id;

  if v_is_essential then
    raise exception 'Cannot add a Substitute to an Essential Recipe Line'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger recipe_line_substitutes_not_essential
  before insert on public.recipe_line_substitutes
  for each row execute function public.recipe_line_substitutes_check_not_essential();

-- Marking a line Essential clears any Substitutes it already carries, so
-- "Essential" always genuinely means none are offered rather than merely
-- none being shown.
create or replace function public.recipe_lines_clear_substitutes_on_essential()
returns trigger
language plpgsql
as $$
begin
  if new.is_essential and not old.is_essential then
    delete from public.recipe_line_substitutes where recipe_line_id = new.id;
  end if;
  return new;
end;
$$;

create trigger recipe_lines_clear_substitutes_on_essential
  after update of is_essential on public.recipe_lines
  for each row execute function public.recipe_lines_clear_substitutes_on_essential();

-- ---------------------------------------------------------------------
-- create_recipe_line / update_recipe_line: the only write paths that
-- validate a line's amount/unit against the Ingredient it names, so a
-- bad line is rejected rather than stored as silent junk. Both delegate
-- unit arithmetic to convert_to_stock_unit (#3) — this module never
-- duplicates that logic. An Unresolved Ingredient (ingredient_id null)
-- skips validation entirely: nothing about units can be checked before a
-- name resolves, and that absence of ingredient_id is itself surfaced as
-- an Inconsistency by recipe_line_inconsistencies.
-- ---------------------------------------------------------------------
create or replace function public.create_recipe_line(
  p_recipe_id uuid,
  p_ingredient_id uuid,
  p_raw_name text,
  p_amount numeric,
  p_unit text,
  p_note text default null,
  p_is_essential boolean default false
)
returns public.recipe_lines
language plpgsql
as $$
declare
  v_line public.recipe_lines;
  v_next_position integer;
  v_is_hand_depleted boolean;
begin
  if auth.uid() is null then
    raise exception 'create_recipe_line requires an authenticated caller';
  end if;

  if p_ingredient_id is not null then
    select is_hand_depleted into v_is_hand_depleted
    from public.ingredients
    where id = p_ingredient_id;

    if v_is_hand_depleted is null then
      raise exception 'No Ingredient found for id %', p_ingredient_id;
    end if;

    if p_amount is null then
      if not v_is_hand_depleted then
        raise exception 'A line with no quantity is only legal for a Hand-Depleted Ingredient'
          using errcode = 'P0001',
                hint = 'State an amount and unit, or use a Hand-Depleted Ingredient.';
      end if;
    else
      -- Raises with a clear message (surfaced as an Inconsistency by
      -- callers that choose to catch it) when p_unit is neither the
      -- Stock Unit nor a Convertible Unit.
      perform public.convert_to_stock_unit(p_ingredient_id, p_amount, p_unit);
    end if;
  end if;

  select coalesce(max(position) + 1, 0) into v_next_position
  from public.recipe_lines
  where recipe_id = p_recipe_id;

  insert into public.recipe_lines (
    recipe_id, ingredient_id, raw_name, amount, unit, note, is_essential, position
  )
  values (
    p_recipe_id, p_ingredient_id, p_raw_name, p_amount, p_unit, p_note,
    coalesce(p_is_essential, false), v_next_position
  )
  returning * into v_line;

  return v_line;
end;
$$;

comment on function public.create_recipe_line(uuid, uuid, text, numeric, text, text, boolean) is
  'Appends a Recipe Line at the end of its Recipe''s order. Validates amount/unit against the named Ingredient via convert_to_stock_unit when both an ingredient and an amount are given; requires the Ingredient be Hand-Depleted when amount is omitted. Skips validation entirely for an Unresolved Ingredient (p_ingredient_id null) — that absence is itself an Inconsistency.';

create or replace function public.update_recipe_line(
  p_id uuid,
  p_ingredient_id uuid,
  p_raw_name text,
  p_amount numeric,
  p_unit text,
  p_note text,
  p_is_essential boolean
)
returns public.recipe_lines
language plpgsql
as $$
declare
  v_line public.recipe_lines;
  v_is_hand_depleted boolean;
begin
  if auth.uid() is null then
    raise exception 'update_recipe_line requires an authenticated caller';
  end if;

  if p_ingredient_id is not null then
    select is_hand_depleted into v_is_hand_depleted
    from public.ingredients
    where id = p_ingredient_id;

    if v_is_hand_depleted is null then
      raise exception 'No Ingredient found for id %', p_ingredient_id;
    end if;

    if p_amount is null then
      if not v_is_hand_depleted then
        raise exception 'A line with no quantity is only legal for a Hand-Depleted Ingredient'
          using errcode = 'P0001',
                hint = 'State an amount and unit, or use a Hand-Depleted Ingredient.';
      end if;
    else
      perform public.convert_to_stock_unit(p_ingredient_id, p_amount, p_unit);
    end if;
  end if;

  update public.recipe_lines
  set ingredient_id = p_ingredient_id,
      raw_name = p_raw_name,
      amount = p_amount,
      unit = p_unit,
      note = p_note,
      is_essential = coalesce(p_is_essential, is_essential)
  where id = p_id
  returning * into v_line;

  if v_line is null then
    raise exception 'No Recipe Line found for id %', p_id;
  end if;

  return v_line;
end;
$$;

comment on function public.update_recipe_line(uuid, uuid, text, numeric, text, text, boolean) is
  'Edits a Recipe Line in place, re-running the same amount/unit validation as create_recipe_line. The only write path for a line''s content besides resolve_recipe_line (name resolution) and reorder_recipe_lines (position).';

-- ---------------------------------------------------------------------
-- reorder_recipe_lines: the only write path for position, matching
-- reorder_shops/reorder_aisles (#6) — a deferred unique constraint so a
-- drag-and-drop swap never trips uniqueness mid-update.
-- ---------------------------------------------------------------------
create or replace function public.reorder_recipe_lines(p_recipe_id uuid, p_line_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'reorder_recipe_lines requires an authenticated caller';
  end if;

  select count(*) into v_count from public.recipe_lines where recipe_id = p_recipe_id;

  if v_count <> coalesce(array_length(p_line_ids, 1), 0) then
    raise exception 'reorder_recipe_lines requires every existing Recipe Line id for this Recipe exactly once, got % of %',
      coalesce(array_length(p_line_ids, 1), 0), v_count;
  end if;

  set constraints public.recipe_lines_position_unique deferred;

  update public.recipe_lines l
  set position = ordered.new_position
  from (
    select id, ordinality - 1 as new_position
    from unnest(p_line_ids) with ordinality as t(id, ordinality)
  ) ordered
  where l.id = ordered.id
    and l.recipe_id = p_recipe_id;

  if (select count(*) from public.recipe_lines where recipe_id = p_recipe_id) <> v_count then
    raise exception 'reorder_recipe_lines: one or more ids did not match an existing Recipe Line of this Recipe';
  end if;
end;
$$;

comment on function public.reorder_recipe_lines(uuid, uuid[]) is
  'Assigns display order 0..n-1 to one Recipe''s Lines by the order of p_line_ids, which must contain every existing Line id of that Recipe exactly once.';

-- ---------------------------------------------------------------------
-- resolve_recipe_line: the only way an Unresolved Ingredient becomes
-- resolved. p_create_alias true remembers raw_name as an Alias on the
-- target Ingredient via ingredient_aliases (#3), so the same free text is
-- never asked about twice across any Recipe. Re-validates amount/unit
-- against the now-known Ingredient exactly like create_recipe_line, since
-- a line with a quantity that looked fine as free text may turn out
-- non-convertible once a real Ingredient is behind it.
-- ---------------------------------------------------------------------
create or replace function public.resolve_recipe_line(
  p_line_id uuid,
  p_ingredient_id uuid,
  p_create_alias boolean default true
)
returns public.recipe_lines
language plpgsql
as $$
declare
  v_line public.recipe_lines;
  v_is_hand_depleted boolean;
begin
  if auth.uid() is null then
    raise exception 'resolve_recipe_line requires an authenticated caller';
  end if;

  select * into v_line from public.recipe_lines where id = p_line_id;

  if v_line is null then
    raise exception 'No Recipe Line found for id %', p_line_id;
  end if;

  select is_hand_depleted into v_is_hand_depleted
  from public.ingredients
  where id = p_ingredient_id;

  if v_is_hand_depleted is null then
    raise exception 'No Ingredient found for id %', p_ingredient_id;
  end if;

  if v_line.amount is null then
    if not v_is_hand_depleted then
      raise exception 'A line with no quantity is only legal for a Hand-Depleted Ingredient'
        using errcode = 'P0001',
              hint = 'State an amount and unit, or resolve to a Hand-Depleted Ingredient.';
    end if;
  else
    perform public.convert_to_stock_unit(p_ingredient_id, v_line.amount, v_line.unit);
  end if;

  if p_create_alias and v_line.raw_name is not null and btrim(v_line.raw_name) <> '' then
    insert into public.ingredient_aliases (ingredient_id, alias)
    values (p_ingredient_id, btrim(v_line.raw_name))
    on conflict (lower(btrim(alias))) do nothing;
  end if;

  update public.recipe_lines
  set ingredient_id = p_ingredient_id
  where id = p_line_id
  returning * into v_line;

  return v_line;
end;
$$;

comment on function public.resolve_recipe_line(uuid, uuid, boolean) is
  'Maps an Unresolved Recipe Line''s raw_name to an existing Ingredient, re-validating amount/unit against it. When p_create_alias (default true), remembers raw_name as an Alias on that Ingredient so the same free text resolves automatically next time. The only write path from Unresolved to resolved.';

-- ---------------------------------------------------------------------
-- recipe_line_inconsistencies: live-derived reasons a line blocks exact
-- arithmetic, re-checked from current state rather than stored, so it can
-- never drift when an Ingredient's Hand-Depleted flag or Convertible
-- Units change after the line was written. Per
-- docs/adr/0003-recipes-measure-in-stock-units.md: an Unresolved
-- Ingredient, a non-convertible unit, or an Unmeasured Quantity on an
-- Auto-Depleted Ingredient are the three kinds.
-- ---------------------------------------------------------------------
create or replace function public.recipe_line_has_conversion(
  p_ingredient_id uuid,
  p_amount numeric,
  p_unit text
)
returns boolean
language plpgsql
stable
as $$
begin
  perform public.convert_to_stock_unit(p_ingredient_id, p_amount, p_unit);
  return true;
exception
  when others then
    return false;
end;
$$;

comment on function public.recipe_line_has_conversion(uuid, numeric, text) is
  'True when p_unit converts to the Ingredient''s Stock Unit (itself or a Convertible Unit), false otherwise. A boolean-returning wrapper around convert_to_stock_unit for use inside the inconsistencies view, where a raised exception cannot be caught per-row.';

create or replace view public.recipe_line_inconsistencies as
select
  l.id as recipe_line_id,
  l.recipe_id,
  case
    when l.ingredient_id is null then 'unresolved_ingredient'
    when l.amount is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit)
      then 'non_convertible_unit'
    when l.amount is null and not i.is_hand_depleted then 'unmeasured_on_auto_depleted'
  end as reason,
  coalesce(l.raw_name, i.name) as line_label
from public.recipe_lines l
left join public.ingredients i on i.id = l.ingredient_id
where l.ingredient_id is null
   or (l.amount is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit))
   or (l.amount is null and not i.is_hand_depleted);

comment on view public.recipe_line_inconsistencies is
  'One row per Recipe Line currently blocking exact arithmetic, with a reason: unresolved_ingredient, non_convertible_unit, or unmeasured_on_auto_depleted. Live-derived so it never drifts from an Ingredient edited after the line was written. A Recipe with zero rows here has no Inconsistencies.';

-- ---------------------------------------------------------------------
-- recipe_line_pantry_status: per-line status against the Pantry —
-- available, fulfilled_by_substitute, or missing — the building block for
-- both the reading view's per-line badges and recipe_cookability below.
-- An Inconsistent line (unresolved, unconvertible, unmeasured) is always
-- missing: arithmetic that cannot run cannot be "available".
-- ---------------------------------------------------------------------
create or replace view public.recipe_line_pantry_status as
select
  l.id as recipe_line_id,
  l.recipe_id,
  l.ingredient_id,
  l.is_essential,
  case
    when l.ingredient_id is null then false
    when l.amount is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit)
      then false
    when l.amount is null and not coalesce(i.is_hand_depleted, false) then false
    when i.is_hand_depleted then true
    when coalesce(public.convert_to_stock_unit(l.ingredient_id, l.amount, l.unit), 0)
         <= coalesce(stock.total_quantity, 0)
      then true
    else false
  end as has_direct_stock,
  exists (
    select 1
    from public.recipe_line_substitutes sub
    join public.ingredients si on si.id = sub.ingredient_id
    left join (
      select ingredient_id, sum(total_quantity) as total_quantity
      from public.pantry_summary
      group by ingredient_id
    ) sub_stock on sub_stock.ingredient_id = sub.ingredient_id
    where sub.recipe_line_id = l.id
      and not l.is_essential
      and (
        si.is_hand_depleted
        or coalesce(sub_stock.total_quantity, 0) > 0
      )
  ) as has_substitute_stock
from public.recipe_lines l
left join public.ingredients i on i.id = l.ingredient_id
left join (
  select ingredient_id, sum(total_quantity) as total_quantity
  from public.pantry_summary
  group by ingredient_id
) stock on stock.ingredient_id = l.ingredient_id;

comment on view public.recipe_line_pantry_status is
  'Per-Line building block for Cookable: has_direct_stock (the named Ingredient itself, Hand-Depleted always true, Inconsistent lines always false) and has_substitute_stock (any non-Essential line''s listed Substitute that is in stock, ignored entirely when is_essential). recipe_status below turns these two booleans into available/fulfilled_by_substitute/missing.';

create or replace view public.recipe_status as
select
  recipe_line_id,
  recipe_id,
  ingredient_id,
  is_essential,
  case
    when has_direct_stock then 'available'
    when has_substitute_stock then 'fulfilled_by_substitute'
    else 'missing'
  end as status
from public.recipe_line_pantry_status;

comment on view public.recipe_status is
  'One row per Recipe Line with its status against the Pantry: available, fulfilled_by_substitute, or missing. The Recipe reading view''s per-line badge; recipe_cookability aggregates this to one Cookable boolean per Recipe.';

create or replace view public.recipe_cookability as
select
  r.id as recipe_id,
  r.name,
  not exists (
    select 1 from public.recipe_status rs
    where rs.recipe_id = r.id and rs.status = 'missing'
  ) as is_cookable
from public.recipes r;

comment on view public.recipe_cookability is
  'One row per Recipe: is_cookable is true only when every one of its Lines is available or fulfilled_by_substitute. A Recipe with zero Lines is vacuously Cookable.';

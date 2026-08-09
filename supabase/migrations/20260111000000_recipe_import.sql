-- Recipe import (#12): imported Recipes retain their source identity, land as
-- Drafts, and persist every parser Inconsistency for phone-first resolution.

alter table public.recipes
  add column status text not null default 'confirmed',
  add column source_key text;

alter table public.recipes
  add constraint recipes_status_valid check (status in ('draft', 'confirmed')),
  add constraint recipes_source_key_not_blank check (source_key is null or btrim(source_key) <> '');

create unique index recipes_source_key_unique
  on public.recipes (source_key)
  where source_key is not null;

comment on column public.recipes.status is
  'confirmed for ordinary manually-created Recipes; draft for imports awaiting review. Draft Recipes remain readable, but transitions such as Meal Plan selection must reject them.';
comment on column public.recipes.source_key is
  'Stable SHA-256 identity of an imported recipe markdown path. Makes the one-way recipe import idempotent.';

-- Parser input may contain a numeric amount with no stated unit ("1/2 leek").
-- Keep it so the user can see and correct the exact line, rather than erasing
-- the number or incorrectly pretending it is an unresolved Ingredient.
alter table public.recipe_lines
  drop constraint recipe_lines_amount_unit_together;

alter table public.recipe_lines
  add constraint recipe_lines_unit_requires_amount check (unit is null or amount is not null);

comment on column public.recipe_lines.unit is
  'The authored unit. Null with a non-null amount is an imported Missing Unit Inconsistency awaiting correction; null with a null amount is an Unmeasured Quantity.';

-- Hand-entered lines still reject unknown conversion factors. Import writes
-- parsed lines directly so non-convertible units can remain visible in the
-- resolution queue; a Missing Unit must also be storable for the same reason.
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
    select is_hand_depleted into v_is_hand_depleted from public.ingredients where id = p_ingredient_id;
    if v_is_hand_depleted is null then raise exception 'No Ingredient found for id %', p_ingredient_id; end if;
    if p_amount is null then
      if not v_is_hand_depleted then
        raise exception 'A line with no quantity is only legal for a Hand-Depleted Ingredient'
          using errcode = 'P0001', hint = 'State an amount and unit, or use a Hand-Depleted Ingredient.';
      end if;
    elsif p_unit is not null then
      perform public.convert_to_stock_unit(p_ingredient_id, p_amount, p_unit);
    end if;
  end if;

  select coalesce(max(position) + 1, 0) into v_next_position from public.recipe_lines where recipe_id = p_recipe_id;
  insert into public.recipe_lines (recipe_id, ingredient_id, raw_name, amount, unit, note, is_essential, position)
  values (p_recipe_id, p_ingredient_id, p_raw_name, p_amount, p_unit, p_note, coalesce(p_is_essential, false), v_next_position)
  returning * into v_line;
  return v_line;
end;
$$;

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
  if auth.uid() is null then raise exception 'update_recipe_line requires an authenticated caller'; end if;
  if p_ingredient_id is not null then
    select is_hand_depleted into v_is_hand_depleted from public.ingredients where id = p_ingredient_id;
    if v_is_hand_depleted is null then raise exception 'No Ingredient found for id %', p_ingredient_id; end if;
    if p_amount is null then
      if not v_is_hand_depleted then
        raise exception 'A line with no quantity is only legal for a Hand-Depleted Ingredient'
          using errcode = 'P0001', hint = 'State an amount and unit, or use a Hand-Depleted Ingredient.';
      end if;
    elsif p_unit is not null then
      perform public.convert_to_stock_unit(p_ingredient_id, p_amount, p_unit);
    end if;
  end if;

  update public.recipe_lines
  set ingredient_id = p_ingredient_id, raw_name = p_raw_name, amount = p_amount, unit = p_unit,
      note = p_note, is_essential = coalesce(p_is_essential, is_essential)
  where id = p_id
  returning * into v_line;
  if v_line is null then raise exception 'No Recipe Line found for id %', p_id; end if;
  return v_line;
end;
$$;

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
  if auth.uid() is null then raise exception 'resolve_recipe_line requires an authenticated caller'; end if;
  select * into v_line from public.recipe_lines where id = p_line_id;
  if v_line is null then raise exception 'No Recipe Line found for id %', p_line_id; end if;
  select is_hand_depleted into v_is_hand_depleted from public.ingredients where id = p_ingredient_id;
  if v_is_hand_depleted is null then raise exception 'No Ingredient found for id %', p_ingredient_id; end if;

  if v_line.amount is null then
    if not v_is_hand_depleted then
      raise exception 'A line with no quantity is only legal for a Hand-Depleted Ingredient'
        using errcode = 'P0001', hint = 'State an amount and unit, or resolve to a Hand-Depleted Ingredient.';
    end if;
  elsif v_line.unit is not null then
    perform public.convert_to_stock_unit(p_ingredient_id, v_line.amount, v_line.unit);
  end if;

  if p_create_alias and v_line.raw_name is not null and btrim(v_line.raw_name) <> ''
     and not exists (select 1 from public.ingredients where lower(btrim(name)) = lower(btrim(v_line.raw_name))) then
    insert into public.ingredient_aliases (ingredient_id, alias)
    values (p_ingredient_id, btrim(v_line.raw_name))
    on conflict (lower(btrim(alias))) do nothing;
  end if;

  update public.recipe_lines set ingredient_id = p_ingredient_id where id = p_line_id returning * into v_line;
  return v_line;
end;
$$;

create or replace view public.recipe_line_inconsistencies
with (security_invoker = on) as
select
  l.id as recipe_line_id,
  l.recipe_id,
  case
    when l.ingredient_id is null then 'unresolved_ingredient'
    when l.amount is not null and l.unit is null then 'missing_unit'
    when l.amount is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit)
      then 'non_convertible_unit'
    when l.amount is null and not i.is_hand_depleted then 'unmeasured_on_auto_depleted'
  end as reason,
  coalesce(l.raw_name, i.name) as line_label
from public.recipe_lines l
left join public.ingredients i on i.id = l.ingredient_id
where l.ingredient_id is null
   or (l.amount is not null and l.unit is null)
   or (l.amount is not null and l.unit is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit))
   or (l.amount is null and not i.is_hand_depleted);

create or replace view public.recipe_line_pantry_status
with (security_invoker = on) as
select
  l.id as recipe_line_id,
  l.recipe_id,
  l.ingredient_id,
  l.is_essential,
  case
    when l.ingredient_id is null then false
    when l.amount is not null and l.unit is null then false
    when l.amount is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit) then false
    when l.amount is null and not coalesce(i.is_hand_depleted, false) then false
    when l.amount is null then coalesce(stock.total_quantity, 0) > 0
    when coalesce(public.convert_to_stock_unit(l.ingredient_id, l.amount, l.unit), 0) <= coalesce(stock.total_quantity, 0) then true
    else false
  end as has_direct_stock,
  exists (
    select 1
    from public.recipe_line_substitutes sub
    left join (
      select ingredient_id, sum(total_quantity) as total_quantity from public.pantry_summary group by ingredient_id
    ) sub_stock on sub_stock.ingredient_id = sub.ingredient_id
    where sub.recipe_line_id = l.id and not l.is_essential and coalesce(sub_stock.total_quantity, 0) > 0
  ) as has_substitute_stock
from public.recipe_lines l
left join public.ingredients i on i.id = l.ingredient_id
left join (
  select ingredient_id, sum(total_quantity) as total_quantity from public.pantry_summary group by ingredient_id
) stock on stock.ingredient_id = l.ingredient_id;

-- One phone-sized cross-recipe read. Candidates remain deterministic parser
-- output or Registry RPC suggestions; this view lists the authoritative
-- unresolved work and links it back to its readable Draft Recipe.
create or replace view public.recipe_resolution_queue
with (security_invoker = on) as
select
  inconsistency.recipe_line_id,
  inconsistency.recipe_id,
  recipe.name as recipe_name,
  recipe.status as recipe_status,
  inconsistency.reason,
  inconsistency.line_label
from public.recipe_line_inconsistencies inconsistency
join public.recipes recipe on recipe.id = inconsistency.recipe_id;

comment on view public.recipe_resolution_queue is
  'Every outstanding Recipe Inconsistency across Draft and confirmed Recipes, with its Recipe title, for mobile resolution.';

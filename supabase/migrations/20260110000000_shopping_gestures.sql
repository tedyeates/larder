-- Shopping gestures (#11): Recipe-approved alternatives are projected with
-- each Shopping Item, and buying verifies then stocks whichever Ingredient the
-- user selected. Suggested Amount learning stays on the stocked Ingredient.

drop function public.buy_shopping_item(uuid, numeric, public.storage_location, date);

create function public.buy_shopping_item(
  p_shopping_item_id uuid,
  p_purchased_amount numeric,
  p_storage_location public.storage_location,
  p_acquired_on date default current_date,
  p_ingredient_id uuid default null
)
returns public.stock_lots
language plpgsql
as $$
declare
  v_list_ingredient_id uuid;
  v_purchased_ingredient_id uuid;
  v_lot public.stock_lots;
begin
  if auth.uid() is null then
    raise exception 'buy_shopping_item requires an authenticated caller';
  end if;

  if p_purchased_amount <= 0 then
    raise exception 'buy_shopping_item requires a positive purchased amount, got %', p_purchased_amount;
  end if;

  select ingredient_id into v_list_ingredient_id
  from public.shopping_items
  where id = p_shopping_item_id
  for update;

  if not found then
    raise exception 'No Shopping Item found for id %', p_shopping_item_id;
  end if;

  v_purchased_ingredient_id := coalesce(p_ingredient_id, v_list_ingredient_id);

  if v_purchased_ingredient_id <> v_list_ingredient_id and not exists (
    select 1
    from public.recipe_lines line
    join public.recipe_line_substitutes substitute
      on substitute.recipe_line_id = line.id
    where line.ingredient_id = v_list_ingredient_id
      and not line.is_essential
      and substitute.ingredient_id = v_purchased_ingredient_id
  ) then
    raise exception 'Ingredient % is not an allowed Substitute for Shopping Item %',
      v_purchased_ingredient_id, p_shopping_item_id;
  end if;

  v_lot := public.add_stock_lot(
    v_purchased_ingredient_id,
    p_purchased_amount,
    p_storage_location,
    p_acquired_on
  );

  update public.ingredients
  set last_purchased_amount = p_purchased_amount
  where id = v_purchased_ingredient_id;

  delete from public.shopping_items where id = p_shopping_item_id;

  return v_lot;
end;
$$;

comment on function public.buy_shopping_item(uuid, numeric, public.storage_location, date, uuid) is
  'Buys a Shopping Item atomically. The selected Ingredient is either its listed Ingredient or a non-Essential Recipe Line Substitute; it is stocked, learns its purchased Suggested Amount, then removes the shared List line.';

create or replace view public.shopping_list_by_shop
with (security_invoker = true)
as
with substitute_options as (
  -- One row per (listed Ingredient, acceptable stand-in). Drawn from every
  -- non-Essential Recipe Line naming that Ingredient: the shared List keeps no
  -- provenance back to the Recipe that added the line, so every Recipe that
  -- could have put it there contributes its own approved alternatives.
  select distinct
    line.ingredient_id as listed_ingredient_id,
    substitute_ingredient.id as ingredient_id,
    substitute_ingredient.name as ingredient_name,
    substitute_ingredient.stock_unit,
    substitute_ingredient.last_purchased_amount
  from public.recipe_lines line
  join public.recipe_line_substitutes substitute
    on substitute.recipe_line_id = line.id
  join public.ingredients substitute_ingredient
    on substitute_ingredient.id = substitute.ingredient_id
  where not line.is_essential
    and substitute.ingredient_id <> line.ingredient_id
),
substitutes_by_ingredient as (
  select
    listed_ingredient_id,
    jsonb_agg(jsonb_build_object(
      'ingredient_id', ingredient_id,
      'ingredient_name', ingredient_name,
      'stock_unit', stock_unit,
      'last_purchased_amount', last_purchased_amount
    ) order by ingredient_name) as substitutes
  from substitute_options
  group by listed_ingredient_id
),
item_sections as (
  select
    s.id as shop_id,
    a.id as section_id,
    a.name as section_name,
    a.emoji as section_emoji,
    a.position as section_position,
    false as is_unsorted,
    si.id as shopping_item_id,
    si.ingredient_id,
    i.name as ingredient_name,
    i.stock_unit,
    si.required_amount,
    i.last_purchased_amount,
    coalesce(sub.substitutes, '[]'::jsonb) as substitutes
  from public.shopping_items si
  join public.ingredients i on i.id = si.ingredient_id
  left join substitutes_by_ingredient sub on sub.listed_ingredient_id = si.ingredient_id
  join public.placements p on p.ingredient_id = si.ingredient_id
  join public.aisles a on a.id = p.aisle_id
  join public.shops s on s.id = a.shop_id
  union all
  select
    s.id as shop_id,
    null::uuid as section_id,
    'Unsorted'::text as section_name,
    null::text as section_emoji,
    2147483647 as section_position,
    true as is_unsorted,
    si.id as shopping_item_id,
    si.ingredient_id,
    i.name as ingredient_name,
    i.stock_unit,
    si.required_amount,
    i.last_purchased_amount,
    coalesce(sub.substitutes, '[]'::jsonb) as substitutes
  from public.shopping_items si
  join public.ingredients i on i.id = si.ingredient_id
  left join substitutes_by_ingredient sub on sub.listed_ingredient_id = si.ingredient_id
  cross join public.shops s
  where not exists (
    select 1 from public.placements p where p.ingredient_id = si.ingredient_id
  )
)
select
  s.id as shop_id,
  s.name as shop_name,
  s.position as shop_position,
  r.section_id,
  r.section_name,
  r.section_emoji,
  r.section_position,
  r.is_unsorted,
  r.shopping_item_id,
  r.ingredient_id,
  r.ingredient_name,
  r.stock_unit,
  r.required_amount,
  r.last_purchased_amount,
  r.substitutes
from public.shops s
left join item_sections r on r.shop_id = s.id;

comment on view public.shopping_list_by_shop is
  'The Shopping screen read: each listed Ingredient joined to Shop/Aisle projections, with Recipe-approved Substitutes and their Suggested Amounts. Uses security_invoker so querying role RLS applies to all underlying data.';

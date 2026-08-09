-- Shopping List (#8): one persistent, Ingredient-backed set of required
-- amounts. Shops only project this set through their Aisle Placements;
-- Shopping never assigns an Ingredient to one preferred Shop.
--
-- State transitions remain here so browser UI and future MCP callers share
-- atomic add/merge, buy/stock and dismiss behaviour.
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  required_amount numeric not null,
  added_at timestamptz not null default now(),
  constraint shopping_items_required_amount_positive check (required_amount > 0),
  constraint shopping_items_one_per_ingredient unique (ingredient_id)
);

comment on table public.shopping_items is
  'The one persistent Shopping List: one required amount per Ingredient. Lines remain until bought or dismissed; adding an already-listed Ingredient grows its amount instead of making a duplicate.';
comment on column public.shopping_items.required_amount is
  'Amount in the Ingredient''s Stock Unit. Written once by plan confirmation or by hand, then increased by further additions; never recalculated from Pantry state.';

select public.apply_deny_all_rls('public.shopping_items');

create policy "shopping_items_select_authenticated"
  on public.shopping_items for select
  to authenticated
  using (auth.uid() is not null);

create policy "shopping_items_insert_authenticated"
  on public.shopping_items for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "shopping_items_update_authenticated"
  on public.shopping_items for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "shopping_items_delete_authenticated"
  on public.shopping_items for delete
  to authenticated
  using (auth.uid() is not null);

-- Adds a manually entered or plan-derived amount. The unique constraint
-- makes merge-on-add race-safe; no caller has to read current amount first.
create or replace function public.add_shopping_item(
  p_ingredient_id uuid,
  p_required_amount numeric
)
returns public.shopping_items
language plpgsql
as $$
declare
  v_item public.shopping_items;
begin
  if auth.uid() is null then
    raise exception 'add_shopping_item requires an authenticated caller';
  end if;

  if p_required_amount <= 0 then
    raise exception 'add_shopping_item requires a positive Required Amount, got %', p_required_amount;
  end if;

  insert into public.shopping_items (ingredient_id, required_amount)
  values (p_ingredient_id, p_required_amount)
  on conflict (ingredient_id)
    do update set required_amount = public.shopping_items.required_amount + excluded.required_amount
  returning * into v_item;

  return v_item;
end;
$$;

comment on function public.add_shopping_item(uuid, numeric) is
  'Adds an Ingredient to the Shopping List, or atomically grows its Required Amount if it is already listed. Requires a positive amount in the Ingredient''s Stock Unit.';

-- Buys one line atomically: grow/create today''s Stock Lot through Inventory,
-- remember this amount as the Ingredient''s Suggested Amount, then remove the
-- shared line so it vanishes from every Shop projection immediately.
create or replace function public.buy_shopping_item(
  p_shopping_item_id uuid,
  p_purchased_amount numeric,
  p_storage_location public.storage_location,
  p_acquired_on date default current_date
)
returns public.stock_lots
language plpgsql
as $$
declare
  v_ingredient_id uuid;
  v_lot public.stock_lots;
begin
  if auth.uid() is null then
    raise exception 'buy_shopping_item requires an authenticated caller';
  end if;

  if p_purchased_amount <= 0 then
    raise exception 'buy_shopping_item requires a positive purchased amount, got %', p_purchased_amount;
  end if;

  select ingredient_id into v_ingredient_id
  from public.shopping_items
  where id = p_shopping_item_id
  for update;

  if not found then
    raise exception 'No Shopping Item found for id %', p_shopping_item_id;
  end if;

  v_lot := public.add_stock_lot(
    v_ingredient_id,
    p_purchased_amount,
    p_storage_location,
    p_acquired_on
  );

  update public.ingredients
  set last_purchased_amount = p_purchased_amount
  where id = v_ingredient_id;

  delete from public.shopping_items where id = p_shopping_item_id;

  return v_lot;
end;
$$;

comment on function public.buy_shopping_item(uuid, numeric, public.storage_location, date) is
  'Buys one Shopping Item atomically: creates or grows its same-day Stock Lot through add_stock_lot, learns the purchased amount as Suggested Amount, then removes the shared List line from every Shop.';

create or replace function public.dismiss_shopping_item(p_shopping_item_id uuid)
returns void
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'dismiss_shopping_item requires an authenticated caller';
  end if;

  delete from public.shopping_items where id = p_shopping_item_id;
end;
$$;

comment on function public.dismiss_shopping_item(uuid) is
  'Removes one Shopping Item without creating or changing any Stock Lot.';

-- This per-Shop projection exposes Aisle headed sections. An Ingredient with
-- at least one Placement appears only in every Shop where it is placed. An
-- Ingredient with no Placements at all appears in Unsorted in every Shop,
-- making it buyable wherever the user happens to be.
create or replace view public.shopping_list_by_shop
with (security_invoker = true)
as
select
  s.id as shop_id,
  s.name as shop_name,
  s.position as shop_position,
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
  i.last_purchased_amount
from public.shopping_items si
join public.ingredients i on i.id = si.ingredient_id
join public.placements p on p.ingredient_id = si.ingredient_id
join public.aisles a on a.id = p.aisle_id
join public.shops s on s.id = a.shop_id
union all
select
  s.id as shop_id,
  s.name as shop_name,
  s.position as shop_position,
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
  i.last_purchased_amount
from public.shopping_items si
join public.ingredients i on i.id = si.ingredient_id
cross join public.shops s
where not exists (
  select 1 from public.placements p where p.ingredient_id = si.ingredient_id
);

comment on view public.shopping_list_by_shop is
  'The Shopping screen read: each listed Ingredient joined to every Shop/Aisle Placement it has, plus every Shop''s Unsorted section for Ingredients with no Placement anywhere. View uses security_invoker so querying role RLS applies to all underlying data.';

-- Keep an empty tab visible for every Shop too. The first definition above
-- describes item sections; this final projection left-joins it to Shops so a
-- Shop without current lines is still usable and tells the user its list is
-- empty.
create or replace view public.shopping_list_by_shop
with (security_invoker = true)
as
with item_sections as (
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
    i.last_purchased_amount
  from public.shopping_items si
  join public.ingredients i on i.id = si.ingredient_id
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
    i.last_purchased_amount
  from public.shopping_items si
  join public.ingredients i on i.id = si.ingredient_id
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
  r.last_purchased_amount
from public.shops s
left join item_sections r on r.shop_id = s.id;

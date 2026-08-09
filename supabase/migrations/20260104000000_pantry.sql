-- Pantry (#5): the second deep module. Owns every rule about quantities
-- and is the only thing that touches Stock Lots.
--
-- Per .kiro/specs/larder-core/design.md ("Inventory" deep module) and the
-- Language section: a Stock Lot is a quantity of one Ingredient acquired
-- on one date, in one Storage Location. Same-day additions to the same
-- Ingredient and Storage Location merge into one Lot; a different day (or
-- a different Storage Location) makes a new one, so age stays honest.
-- Consumption is oldest-first, floors at zero, and reports the shortfall
-- rather than ever going negative. Hand-Depleted Ingredients are stocked
-- the same way (a fraction of a container in one Lot) but are never
-- touched by automatic depletion — only by hand.
--
-- Single-authenticated-user app (.kiro/specs/security.md): policies gate
-- on `auth.uid() is not null` rather than per-row ownership, matching the
-- Ingredient Registry and Preferences migrations.
create type public.storage_location as enum (
  'fridge',
  'freezer',
  'cupboard',
  'counter',
  'household',
  'medicine'
);

create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  quantity numeric not null,
  storage_location public.storage_location not null,
  acquired_on date not null,
  created_at timestamptz not null default now(),
  constraint stock_lots_quantity_nonnegative check (quantity >= 0)
);

comment on table public.stock_lots is
  'A quantity of one Ingredient acquired on one date, in one Storage Location. Same-day additions to the same Ingredient+Storage Location merge into this row; a different day or location makes a new one. Consumed oldest-first by acquired_on. The only table automatic depletion writes to for Auto-Depleted Ingredients.';
comment on column public.stock_lots.quantity is
  'In the Ingredient''s Stock Unit. Never negative — consumption clamps at zero rather than going negative, and an empty Lot (quantity = 0) is deleted rather than kept around.';
comment on column public.stock_lots.acquired_on is
  'The date this Lot was acquired, used both as the merge key and as the basis for the age badge. Editable by hand like every other quantity in the Pantry.';

-- The merge key: one Lot per (Ingredient, Storage Location, day). Adding
-- more of something already acquired that day grows this row via
-- add_stock_lot's upsert; a different day or location is a new row.
create unique index stock_lots_merge_key
  on public.stock_lots (ingredient_id, storage_location, acquired_on);

create index stock_lots_ingredient_id_idx on public.stock_lots (ingredient_id);
create index stock_lots_acquired_on_idx on public.stock_lots (acquired_on);

select public.apply_deny_all_rls('public.stock_lots');

create policy "stock_lots_select_authenticated"
  on public.stock_lots for select
  to authenticated
  using (auth.uid() is not null);

create policy "stock_lots_insert_authenticated"
  on public.stock_lots for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "stock_lots_update_authenticated"
  on public.stock_lots for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "stock_lots_delete_authenticated"
  on public.stock_lots for delete
  to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- add_stock_lot: the only way to add to the Pantry, whether that's the
-- Pantry screen's "add stock" form, buying a Shopping Item (#8) or an
-- import script (#9). Same-day-and-location merge is an upsert on
-- stock_lots_merge_key, not a read-then-write, so concurrent adds can't
-- race into two rows.
-- ---------------------------------------------------------------------
create or replace function public.add_stock_lot(
  p_ingredient_id uuid,
  p_quantity numeric,
  p_storage_location public.storage_location,
  p_acquired_on date default current_date
)
returns public.stock_lots
language plpgsql
as $$
declare
  v_lot public.stock_lots;
begin
  if auth.uid() is null then
    raise exception 'add_stock_lot requires an authenticated caller';
  end if;

  if p_quantity <= 0 then
    raise exception 'add_stock_lot requires a positive quantity, got %', p_quantity;
  end if;

  insert into public.stock_lots (ingredient_id, quantity, storage_location, acquired_on)
  values (p_ingredient_id, p_quantity, p_storage_location, p_acquired_on)
  on conflict (ingredient_id, storage_location, acquired_on)
    do update set quantity = public.stock_lots.quantity + excluded.quantity
  returning * into v_lot;

  return v_lot;
end;
$$;

comment on function public.add_stock_lot(uuid, numeric, public.storage_location, date) is
  'Adds quantity of an Ingredient to the Pantry. Same Ingredient+Storage Location+day merges into the existing Lot (grows it); any other combination creates a new Lot. The only write path onto stock_lots for additions.';

-- ---------------------------------------------------------------------
-- consume_stock: the only way anything (Cook, a hand adjustment, a
-- future Cook feature) removes quantity for an Auto-Depleted Ingredient.
-- Oldest Lot first by acquired_on, floors at zero, deletes emptied Lots,
-- and always reports what was actually taken against what was asked for
-- so callers (Cook's discrepancy warning) never have to re-derive it.
-- Explicitly refuses Hand-Depleted Ingredients — automatic depletion must
-- never touch them, only a hand edit may.
-- ---------------------------------------------------------------------
create type public.consume_stock_result as (
  ingredient_id uuid,
  requested numeric,
  consumed numeric,
  shortfall numeric
);

create or replace function public.consume_stock(
  p_ingredient_id uuid,
  p_quantity numeric
)
returns public.consume_stock_result
language plpgsql
as $$
declare
  v_is_hand_depleted boolean;
  v_remaining numeric := p_quantity;
  v_consumed numeric := 0;
  v_lot record;
  v_take numeric;
begin
  if auth.uid() is null then
    raise exception 'consume_stock requires an authenticated caller';
  end if;

  if p_quantity < 0 then
    raise exception 'consume_stock requires a non-negative quantity, got %', p_quantity;
  end if;

  select is_hand_depleted into v_is_hand_depleted
  from public.ingredients
  where id = p_ingredient_id;

  if v_is_hand_depleted is null then
    raise exception 'No Ingredient found for id %', p_ingredient_id;
  end if;

  if v_is_hand_depleted then
    raise exception 'Ingredient % is Hand-Depleted and cannot be automatically consumed', p_ingredient_id
      using hint = 'Adjust a Hand-Depleted Ingredient''s fraction by hand instead.';
  end if;

  for v_lot in
    select id, quantity
    from public.stock_lots
    where ingredient_id = p_ingredient_id
      and quantity > 0
    order by acquired_on asc, created_at asc
    for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_lot.quantity, v_remaining);

    if v_take >= v_lot.quantity then
      delete from public.stock_lots where id = v_lot.id;
    else
      update public.stock_lots set quantity = quantity - v_take where id = v_lot.id;
    end if;

    v_consumed := v_consumed + v_take;
    v_remaining := v_remaining - v_take;
  end loop;

  return (p_ingredient_id, p_quantity, v_consumed, v_remaining)::public.consume_stock_result;
end;
$$;

comment on function public.consume_stock(uuid, numeric) is
  'Consumes quantity of an Auto-Depleted Ingredient''s Stock Lots oldest-first, floors at zero rather than going negative, deletes any Lot it empties, and always returns requested/consumed/shortfall. Raises if the Ingredient is Hand-Depleted — automatic depletion never touches those.';

-- ---------------------------------------------------------------------
-- set_hand_depleted_fraction: the only intended write path for a
-- Hand-Depleted Ingredient's quantity, since it is adjusted by eye rather
-- than counted. Sets (not adds/subtracts) the quantity of the single Lot
-- for that Ingredient+Storage Location+day — "eyeball the soy sauce at
-- half empty and set 0.5" — creating the Lot if none exists yet, and
-- removing it if the set value is zero (empty Lots are removed).
-- ---------------------------------------------------------------------
create or replace function public.set_hand_depleted_fraction(
  p_ingredient_id uuid,
  p_quantity numeric,
  p_storage_location public.storage_location,
  p_acquired_on date default current_date
)
returns public.stock_lots
language plpgsql
as $$
declare
  v_is_hand_depleted boolean;
  v_lot public.stock_lots;
begin
  if auth.uid() is null then
    raise exception 'set_hand_depleted_fraction requires an authenticated caller';
  end if;

  if p_quantity < 0 then
    raise exception 'set_hand_depleted_fraction requires a non-negative quantity, got %', p_quantity;
  end if;

  select is_hand_depleted into v_is_hand_depleted
  from public.ingredients
  where id = p_ingredient_id;

  if v_is_hand_depleted is null then
    raise exception 'No Ingredient found for id %', p_ingredient_id;
  end if;

  if not v_is_hand_depleted then
    raise exception 'Ingredient % is not Hand-Depleted', p_ingredient_id
      using hint = 'Use add_stock_lot/consume_stock for Auto-Depleted Ingredients.';
  end if;

  if p_quantity = 0 then
    delete from public.stock_lots
    where ingredient_id = p_ingredient_id
      and storage_location = p_storage_location
      and acquired_on = p_acquired_on;
    return null;
  end if;

  insert into public.stock_lots (ingredient_id, quantity, storage_location, acquired_on)
  values (p_ingredient_id, p_quantity, p_storage_location, p_acquired_on)
  on conflict (ingredient_id, storage_location, acquired_on)
    do update set quantity = excluded.quantity
  returning * into v_lot;

  return v_lot;
end;
$$;

comment on function public.set_hand_depleted_fraction(uuid, numeric, public.storage_location, date) is
  'Sets (not adds) a Hand-Depleted Ingredient''s quantity for one Storage Location+day, e.g. 0.5 for a half-empty bottle. Zero deletes the Lot. Refuses Auto-Depleted Ingredients — those go through add_stock_lot/consume_stock instead.';

-- ---------------------------------------------------------------------
-- pantry_summary: the Pantry screen's one read. One row per Ingredient
-- per Storage Location it has stock in, with the total quantity and the
-- oldest acquired_on (the age badge is derived client-side from that
-- date, since the thresholds are advisory display logic, not a stored
-- transition).
-- ---------------------------------------------------------------------
create or replace view public.pantry_summary as
select
  l.ingredient_id,
  i.name as ingredient_name,
  i.stock_unit,
  i.is_hand_depleted,
  l.storage_location,
  sum(l.quantity) as total_quantity,
  min(l.acquired_on) as oldest_acquired_on,
  count(*) as lot_count
from public.stock_lots l
join public.ingredients i on i.id = l.ingredient_id
group by l.ingredient_id, i.name, i.stock_unit, i.is_hand_depleted, l.storage_location;

comment on view public.pantry_summary is
  'One row per Ingredient per Storage Location with stock: total quantity across its Lots and the oldest Lot''s acquired_on for the age badge. Backs the Pantry screen''s grouped view; expanding a row reads stock_lots directly for the individual Lots.';

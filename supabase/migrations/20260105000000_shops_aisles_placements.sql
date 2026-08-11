-- Shops, Aisles and Placements (#6): a Shop is a filter over the Shopping
-- List, not a destination — nothing here ever decides which Shop an
-- Ingredient "belongs" to.
--
-- Per .kiro/specs/larder-core/design.md ("Shop", "Aisle", "Placement" in
-- the Language section, and the SHOP/AISLE/PLACEMENT entities in the ERD):
-- a Shop has an ordered list of Aisles, each carrying an emoji, and an
-- Ingredient may hold a Placement (an Aisle-in-a-Shop) in any number of
-- Shops simultaneously. Aisle names and order are per-Shop and never need
-- to align across Shops.
--
-- Single-authenticated-user app (.kiro/specs/security.md): policies gate
-- on `auth.uid() is not null`, matching every other module.
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint shops_name_not_blank check (btrim(name) <> '')
);

comment on table public.shops is
  'A place you buy from. A view over the Shopping List, not a destination it routes to — nothing in the system decides which Shop an Ingredient "belongs" to.';
comment on column public.shops.position is
  'Explicit display order, 0-based. Reordered as a full set via reorder_shops, never by juggling individual values.';

-- One position per slot, so display order is always unambiguous. Deferred
-- so reorder_shops can swap a whole set inside one transaction without
-- tripping over itself mid-update — Postgres only allows deferrable
-- uniqueness via a table constraint, not a plain unique index.
alter table public.shops
  add constraint shops_position_unique unique (position) deferrable initially deferred;

select public.apply_deny_all_rls('public.shops');

create policy "shops_select_authenticated"
  on public.shops for select
  to authenticated
  using (auth.uid() is not null);

create policy "shops_insert_authenticated"
  on public.shops for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "shops_update_authenticated"
  on public.shops for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "shops_delete_authenticated"
  on public.shops for delete
  to authenticated
  using (auth.uid() is not null);

-- Aisles: a named, emoji-carrying section of one Shop, ordered to match
-- the walking route. Names and order are per-Shop on purpose — Lidl's
-- "🥬 Fruit & Veg" and the Asian Supermarket's "Fresh & Chilled" are both
-- correct for their own Shop and never need to line up.
create table public.aisles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  emoji text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint aisles_name_not_blank check (btrim(name) <> ''),
  constraint aisles_emoji_not_blank check (btrim(emoji) <> '')
);

comment on table public.aisles is
  'A named, emoji-carrying section of one Shop, ordered to match how you walk it. Names and order are per-Shop and never need to align across Shops.';
comment on column public.aisles.position is
  'Explicit display order within shop_id, 0-based. Reordered as a full set via reorder_aisles.';

-- One position per slot within a Shop; deferred for the same reason as
-- shops_position_unique.
alter table public.aisles
  add constraint aisles_shop_position_unique unique (shop_id, position) deferrable initially deferred;

create index aisles_shop_id_idx on public.aisles (shop_id);

select public.apply_deny_all_rls('public.aisles');

create policy "aisles_select_authenticated"
  on public.aisles for select
  to authenticated
  using (auth.uid() is not null);

create policy "aisles_insert_authenticated"
  on public.aisles for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "aisles_update_authenticated"
  on public.aisles for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "aisles_delete_authenticated"
  on public.aisles for delete
  to authenticated
  using (auth.uid() is not null);

-- Placements: the Aisle an Ingredient sits in at a given Shop. The whole
-- point of this table is that an Ingredient can hold more than one of
-- these at once — Udon noodles in Lidl's Dry Goods and in the Asian
-- Supermarket's Noodles & Rice, both true simultaneously. One Placement
-- per (Ingredient, Aisle) pair; an Ingredient may still have a second
-- Placement in a different Aisle of the very same Shop only if that's
-- genuinely where it sits, but the common case is one Aisle per Shop.
create table public.placements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  aisle_id uuid not null references public.aisles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.placements is
  'The Aisle an Ingredient sits in at a given Shop. An Ingredient may hold Placements in several Shops at once — Udon noodles in Lidl''s Dry Goods and in the Asian Supermarket''s Noodles & Rice are both kept. Cascades on delete of either its Ingredient or its Aisle, so removing either never leaves an orphaned row.';

create unique index placements_ingredient_aisle_unique
  on public.placements (ingredient_id, aisle_id);

create index placements_ingredient_id_idx on public.placements (ingredient_id);
create index placements_aisle_id_idx on public.placements (aisle_id);

select public.apply_deny_all_rls('public.placements');

create policy "placements_select_authenticated"
  on public.placements for select
  to authenticated
  using (auth.uid() is not null);

create policy "placements_insert_authenticated"
  on public.placements for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "placements_update_authenticated"
  on public.placements for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "placements_delete_authenticated"
  on public.placements for delete
  to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------
-- create_shop / create_aisle: append at the end of the existing order,
-- so callers never have to compute the next position themselves.
-- ---------------------------------------------------------------------
create or replace function public.create_shop(p_name text)
returns public.shops
language plpgsql
as $$
declare
  v_shop public.shops;
  v_next_position integer;
begin
  if auth.uid() is null then
    raise exception 'create_shop requires an authenticated caller';
  end if;

  select coalesce(max(position) + 1, 0) into v_next_position from public.shops;

  insert into public.shops (name, position)
  values (p_name, v_next_position)
  returning * into v_shop;

  return v_shop;
end;
$$;

comment on function public.create_shop(text) is
  'Creates a Shop appended at the end of the current display order. The only insert path for shops, so callers never compute position themselves.';

create or replace function public.create_aisle(
  p_shop_id uuid,
  p_name text,
  p_emoji text
)
returns public.aisles
language plpgsql
as $$
declare
  v_aisle public.aisles;
  v_next_position integer;
begin
  if auth.uid() is null then
    raise exception 'create_aisle requires an authenticated caller';
  end if;

  select coalesce(max(position) + 1, 0) into v_next_position
  from public.aisles
  where shop_id = p_shop_id;

  insert into public.aisles (shop_id, name, emoji, position)
  values (p_shop_id, p_name, p_emoji, v_next_position)
  returning * into v_aisle;

  return v_aisle;
end;
$$;

comment on function public.create_aisle(uuid, text, text) is
  'Creates an Aisle appended at the end of its Shop''s current display order. The only insert path for aisles, so callers never compute position themselves.';

-- ---------------------------------------------------------------------
-- reorder_shops / reorder_aisles: the only write path for position.
-- Takes the full ordered id list for the set being reordered and assigns
-- 0..n-1 by array order, inside one transaction with the unique index on
-- position deferred — so a plain drag-and-drop reorder (which usually
-- swaps values) never trips the uniqueness constraint mid-update.
-- ---------------------------------------------------------------------
create or replace function public.reorder_shops(p_shop_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'reorder_shops requires an authenticated caller';
  end if;

  select count(*) into v_count from public.shops;

  if v_count <> array_length(p_shop_ids, 1) then
    raise exception 'reorder_shops requires every existing Shop id exactly once, got % of %',
      array_length(p_shop_ids, 1), v_count;
  end if;

  set constraints public.shops_position_unique deferred;

  update public.shops s
  set position = ordered.new_position
  from (
    select id, ordinality - 1 as new_position
    from unnest(p_shop_ids) with ordinality as t(id, ordinality)
  ) ordered
  where s.id = ordered.id;

  if (select count(*) from public.shops) <> v_count then
    raise exception 'reorder_shops: one or more ids did not match an existing Shop';
  end if;
end;
$$;

comment on function public.reorder_shops(uuid[]) is
  'Assigns display order 0..n-1 to Shops by the order of p_shop_ids, which must contain every existing Shop id exactly once. The only write path for shops.position.';

create or replace function public.reorder_aisles(p_shop_id uuid, p_aisle_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'reorder_aisles requires an authenticated caller';
  end if;

  select count(*) into v_count from public.aisles where shop_id = p_shop_id;

  if v_count <> coalesce(array_length(p_aisle_ids, 1), 0) then
    raise exception 'reorder_aisles requires every existing Aisle id for this Shop exactly once, got % of %',
      coalesce(array_length(p_aisle_ids, 1), 0), v_count;
  end if;

  set constraints public.aisles_shop_position_unique deferred;

  update public.aisles a
  set position = ordered.new_position
  from (
    select id, ordinality - 1 as new_position
    from unnest(p_aisle_ids) with ordinality as t(id, ordinality)
  ) ordered
  where a.id = ordered.id
    and a.shop_id = p_shop_id;

  if (select count(*) from public.aisles where shop_id = p_shop_id) <> v_count then
    raise exception 'reorder_aisles: one or more ids did not match an existing Aisle of this Shop';
  end if;
end;
$$;

comment on function public.reorder_aisles(uuid, uuid[]) is
  'Assigns display order 0..n-1 to one Shop''s Aisles by the order of p_aisle_ids, which must contain every existing Aisle id of that Shop exactly once. The only write path for aisles.position.';

-- ---------------------------------------------------------------------
-- set_placement / remove_placement: attach/detach an Ingredient to an
-- Aisle in a Shop. set_placement is an upsert on the (ingredient, aisle)
-- unique key so re-placing an Ingredient already in that Aisle is a no-op
-- rather than a duplicate-key error.
-- ---------------------------------------------------------------------
create or replace function public.set_placement(
  p_ingredient_id uuid,
  p_aisle_id uuid
)
returns public.placements
language plpgsql
as $$
declare
  v_placement public.placements;
begin
  if auth.uid() is null then
    raise exception 'set_placement requires an authenticated caller';
  end if;

  insert into public.placements (ingredient_id, aisle_id)
  values (p_ingredient_id, p_aisle_id)
  on conflict (ingredient_id, aisle_id) do update set aisle_id = excluded.aisle_id
  returning * into v_placement;

  return v_placement;
end;
$$;

comment on function public.set_placement(uuid, uuid) is
  'Attaches an Ingredient to an Aisle in a Shop. An Ingredient may hold Placements in several Aisles/Shops at once; this only ever adds or no-ops on an existing (ingredient, aisle) pair, never removes another Placement for the same Ingredient elsewhere.';

create or replace function public.remove_placement(
  p_ingredient_id uuid,
  p_aisle_id uuid
)
returns void
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'remove_placement requires an authenticated caller';
  end if;

  delete from public.placements
  where ingredient_id = p_ingredient_id
    and aisle_id = p_aisle_id;
end;
$$;

comment on function public.remove_placement(uuid, uuid) is
  'Removes one Ingredient''s Placement in one Aisle, leaving any Placements it holds in other Aisles/Shops untouched.';

-- ---------------------------------------------------------------------
-- shop_aisles: the Shops screen's read for one Shop's Aisles in display
-- order, each with its Placement count so the manage screen can show
-- "3 items" without a second round trip.
-- ---------------------------------------------------------------------
create or replace view public.shop_aisles as
select
  a.id as aisle_id,
  a.shop_id,
  a.name,
  a.emoji,
  a.position,
  count(p.id) as placement_count
from public.aisles a
left join public.placements p on p.aisle_id = a.id
group by a.id, a.shop_id, a.name, a.emoji, a.position;

comment on view public.shop_aisles is
  'One row per Aisle with its Placement count, for the Shop management screen. Ordering by shop_id, position gives display order.';

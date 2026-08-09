-- Meal Plan (#13): an editable rolling guide. It owns planned slots only;
-- Cooking and Meal Logs remain the record of what actually happened.
create table public.meal_plan_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  meal_time text not null,
  recipe_id uuid references public.recipes (id) on delete restrict,
  label text,
  is_cook boolean not null default false,
  cook_multiplier integer not null default 1,
  cook_id uuid references public.cooks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_plan_slots_meal_time_valid check (meal_time in ('breakfast', 'lunch', 'dinner')),
  constraint meal_plan_slots_recipe_or_label check (
    recipe_id is not null or coalesce(btrim(label), '') <> ''
  ),
  constraint meal_plan_slots_cook_has_recipe check (not is_cook or recipe_id is not null),
  constraint meal_plan_slots_multiplier_positive check (cook_multiplier > 0),
  constraint meal_plan_slots_one_per_time unique (slot_date, meal_time) deferrable initially deferred
);

comment on table public.meal_plan_slots is
  'Sparse, rolling meal guide. A row fills one date+meal-time Slot; actual eating remains in Meal Log.';

select public.apply_deny_all_rls('public.meal_plan_slots');
create policy "meal_plan_slots_select_authenticated" on public.meal_plan_slots for select to authenticated using (auth.uid() is not null);
create policy "meal_plan_slots_insert_authenticated" on public.meal_plan_slots for insert to authenticated with check (auth.uid() is not null);
create policy "meal_plan_slots_update_authenticated" on public.meal_plan_slots for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "meal_plan_slots_delete_authenticated" on public.meal_plan_slots for delete to authenticated using (auth.uid() is not null);

create or replace function public.meal_plan_slots_reject_past()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.slot_date < current_date then
      raise exception 'Meal Plan Slots must be today or in the future';
    end if;
    return new;
  end if;
  if old.slot_date < current_date or (tg_op = 'UPDATE' and new.slot_date < current_date) then
    raise exception 'Past Meal Plan Slots are read-only';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger meal_plan_slots_reject_past
before insert or update or delete on public.meal_plan_slots
for each row execute function public.meal_plan_slots_reject_past();

alter table public.meal_logs add column meal_plan_slot_id uuid
  references public.meal_plan_slots (id) on delete set null;
create unique index meal_logs_meal_plan_slot_eaten_unique
  on public.meal_logs (meal_plan_slot_id)
  where meal_plan_slot_id is not null and kind = 'eaten';

create or replace function public.set_meal_plan_slot(
  p_slot_date date,
  p_meal_time text,
  p_recipe_id uuid default null,
  p_label text default null,
  p_is_cook boolean default false,
  p_cook_multiplier integer default 1
)
returns public.meal_plan_slots language plpgsql as $$
declare v_slot public.meal_plan_slots; v_recipe public.recipes;
begin
  if auth.uid() is null then raise exception 'set_meal_plan_slot requires an authenticated caller'; end if;
  if p_slot_date < current_date then raise exception 'Meal Plan Slots must be today or in the future'; end if;
  if p_meal_time not in ('breakfast', 'lunch', 'dinner') then raise exception 'Meal time must be Breakfast, Lunch or Dinner'; end if;
  if p_recipe_id is null and coalesce(btrim(p_label), '') = '' then raise exception 'A Meal Slot needs a Recipe or label'; end if;
  if p_is_cook and p_recipe_id is null then raise exception 'Only a Recipe Slot can be a Cook occasion'; end if;
  if p_cook_multiplier < 1 then raise exception 'Cook multiplier must be positive'; end if;
  if p_recipe_id is not null then
    select * into v_recipe from public.recipes where id = p_recipe_id;
    if v_recipe is null then raise exception 'No Recipe found for id %', p_recipe_id; end if;
    if p_cook_multiplier > v_recipe.max_multiplier then raise exception 'Cook multiplier must be between 1 and % for this Recipe', v_recipe.max_multiplier; end if;
    if exists (select 1 from public.recipe_line_inconsistencies where recipe_id = p_recipe_id) then
      raise exception 'A Recipe with Inconsistencies cannot enter Meal Plan';
    end if;
  end if;

  select * into v_slot from public.meal_plan_slots
  where slot_date = p_slot_date and meal_time = p_meal_time for update;
  if v_slot is null then
    insert into public.meal_plan_slots (slot_date, meal_time, recipe_id, label, is_cook, cook_multiplier)
    values (p_slot_date, p_meal_time, p_recipe_id, nullif(btrim(p_label), ''), p_is_cook, p_cook_multiplier)
    returning * into v_slot;
  else
    update public.meal_plan_slots set
      recipe_id = p_recipe_id,
      label = nullif(btrim(p_label), ''),
      is_cook = p_is_cook,
      cook_multiplier = p_cook_multiplier,
      cook_id = case when v_slot.recipe_id is distinct from p_recipe_id then null else v_slot.cook_id end
    where id = v_slot.id
    returning * into v_slot;
  end if;
  return v_slot;
end;
$$;

create or replace function public.move_meal_plan_slot(p_slot_id uuid, p_slot_date date, p_meal_time text)
returns public.meal_plan_slots language plpgsql as $$
declare v_source public.meal_plan_slots; v_target public.meal_plan_slots; v_result public.meal_plan_slots;
begin
  if auth.uid() is null then raise exception 'move_meal_plan_slot requires an authenticated caller'; end if;
  if p_slot_date < current_date then raise exception 'Meal Plan Slots must be today or in the future'; end if;
  if p_meal_time not in ('breakfast', 'lunch', 'dinner') then raise exception 'Meal time must be Breakfast, Lunch or Dinner'; end if;
  select * into v_source from public.meal_plan_slots where id = p_slot_id for update;
  if v_source is null then raise exception 'No Meal Slot found for id %', p_slot_id; end if;
  select * into v_target from public.meal_plan_slots where slot_date = p_slot_date and meal_time = p_meal_time for update;
  if v_target is not null and v_target.id <> v_source.id then
    update public.meal_plan_slots set slot_date = v_source.slot_date, meal_time = v_source.meal_time where id = v_target.id;
  end if;
  update public.meal_plan_slots set slot_date = p_slot_date, meal_time = p_meal_time where id = p_slot_id returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.clear_meal_plan_slot(p_slot_id uuid)
returns void language plpgsql as $$
begin
  if auth.uid() is null then raise exception 'clear_meal_plan_slot requires an authenticated caller'; end if;
  delete from public.meal_plan_slots where id = p_slot_id;
  if not found then raise exception 'No Meal Slot found for id %', p_slot_id; end if;
end;
$$;

-- Status stays derived from live Pantry state. The schedule contribution only
-- considers future unexecuted Cooks and uneaten Slots; it never writes List rows.
create or replace view public.meal_plan_slot_status
with (security_invoker = on) as
with future_recipe_slots as (
  select
    s.id,
    s.recipe_id,
    sum(case when s.is_cook and s.cook_id is null then r.servings * s.cook_multiplier else 0 end)
      over (partition by s.recipe_id order by s.slot_date, s.meal_time, s.id rows unbounded preceding) as planned_portions,
    sum(case when not exists (select 1 from public.meal_logs log where log.meal_plan_slot_id = s.id and log.kind = 'eaten') then 1 else 0 end)
      over (partition by s.recipe_id order by s.slot_date, s.meal_time, s.id rows unbounded preceding) as planned_eating
  from public.meal_plan_slots s
  join public.recipes r on r.id = s.recipe_id
  where s.slot_date >= current_date
), actual_portions as (
  select r.id as recipe_id,
    coalesce((select sum(c.multiplier * cooked_recipe.servings) from public.cooks c join public.recipes cooked_recipe on cooked_recipe.id = c.recipe_id where c.recipe_id = r.id), 0)
    - coalesce((select count(*) from public.meal_logs log where log.recipe_id = r.id and log.kind = 'eaten'), 0) as available_portions
  from public.recipes r
)
select
  s.id, s.slot_date, s.meal_time, s.recipe_id, s.label, s.is_cook, s.cook_multiplier, s.cook_id,
  r.name as recipe_name,
  case when s.recipe_id is null then null else rc.is_cookable end as is_cookable,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'recipe_line_id', rs.recipe_line_id,
      'ingredient_name', coalesce(i.name, line.raw_name),
      'status', rs.status
    ) order by line.position)
    from public.recipe_status rs
    join public.recipe_lines line on line.id = rs.recipe_line_id
    left join public.ingredients i on i.id = line.ingredient_id
    where rs.recipe_id = s.recipe_id
  ), '[]'::jsonb) as line_statuses,
  coalesce(
    s.slot_date >= current_date and s.recipe_id is not null
    and coalesce(actual.available_portions, 0) + coalesce(future.planned_portions, 0) - coalesce(future.planned_eating, 0) < 0,
    false
  ) as shortfall
from public.meal_plan_slots s
left join public.recipes r on r.id = s.recipe_id
left join public.recipe_cookability rc on rc.recipe_id = s.recipe_id
left join future_recipe_slots future on future.id = s.id
left join actual_portions actual on actual.recipe_id = s.recipe_id;

create or replace function public.top_up_meal_plan_slot(p_slot_id uuid)
returns void language plpgsql as $$
declare v_slot public.meal_plan_slots; v_line record; v_amount numeric;
begin
  if auth.uid() is null then raise exception 'top_up_meal_plan_slot requires an authenticated caller'; end if;
  select * into v_slot from public.meal_plan_slots where id = p_slot_id;
  if v_slot is null or v_slot.recipe_id is null then raise exception 'Top-Up requires a Recipe Meal Slot'; end if;
  for v_line in
    select line.ingredient_id, line.amount, line.unit, status.status
    from public.recipe_lines line
    join public.recipe_status status on status.recipe_line_id = line.id
    where line.recipe_id = v_slot.recipe_id
      and status.status = 'missing'
      and line.ingredient_id is not null
      and line.amount is not null
      and public.recipe_line_has_conversion(line.ingredient_id, line.amount, line.unit)
  loop
    v_amount := public.convert_to_stock_unit(v_line.ingredient_id, v_line.amount, v_line.unit)
      * case when v_slot.is_cook then v_slot.cook_multiplier else 1 end;
    if v_amount > 0 then perform public.add_shopping_item(v_line.ingredient_id, v_amount); end if;
  end loop;
end;
$$;

create or replace function public.preview_meal_plan_cook(p_slot_id uuid, p_substitutions jsonb default '[]'::jsonb)
returns jsonb language plpgsql as $$
declare v_slot public.meal_plan_slots;
begin
  if auth.uid() is null then raise exception 'preview_meal_plan_cook requires an authenticated caller'; end if;
  select * into v_slot from public.meal_plan_slots where id = p_slot_id;
  if v_slot is null or v_slot.recipe_id is null then raise exception 'Cook requires a Recipe Meal Slot'; end if;
  return public.preview_cook(v_slot.recipe_id, v_slot.cook_multiplier, p_substitutions);
end;
$$;

create or replace function public.commit_meal_plan_cook(p_slot_id uuid, p_substitutions jsonb default '[]'::jsonb)
returns jsonb language plpgsql as $$
declare v_slot public.meal_plan_slots; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'commit_meal_plan_cook requires an authenticated caller'; end if;
  select * into v_slot from public.meal_plan_slots where id = p_slot_id for update;
  if v_slot is null or v_slot.recipe_id is null then raise exception 'Cook requires a Recipe Meal Slot'; end if;
  if v_slot.cook_id is not null then raise exception 'This Meal Slot has already been Cooked'; end if;
  v_result := public.commit_cook(v_slot.recipe_id, v_slot.cook_multiplier, p_substitutions, v_slot.slot_date);
  update public.meal_plan_slots set cook_id = (v_result ->> 'cook_id')::uuid where id = v_slot.id;
  return v_result;
end;
$$;

create or replace function public.eat_meal_plan_slot(p_slot_id uuid)
returns public.meal_logs language plpgsql as $$
declare v_slot public.meal_plan_slots; v_log public.meal_logs;
begin
  if auth.uid() is null then raise exception 'eat_meal_plan_slot requires an authenticated caller'; end if;
  select * into v_slot from public.meal_plan_slots where id = p_slot_id for update;
  if v_slot is null or v_slot.recipe_id is null then raise exception 'Eating requires a Recipe Meal Slot'; end if;
  if exists (select 1 from public.meal_logs where meal_plan_slot_id = v_slot.id and kind = 'eaten') then raise exception 'This Meal Slot is already Eaten'; end if;
  v_log := public.eat_portion(null, v_slot.recipe_id, v_slot.slot_date, v_slot.meal_time, null);
  update public.meal_logs set meal_plan_slot_id = v_slot.id where id = v_log.id;
  select * into v_log from public.meal_logs where id = v_log.id;
  return v_log;
end;
$$;

create or replace function public.ate_out_meal_plan_slot(p_slot_id uuid)
returns public.meal_logs language plpgsql as $$
declare v_slot public.meal_plan_slots; v_log public.meal_logs;
begin
  if auth.uid() is null then raise exception 'ate_out_meal_plan_slot requires an authenticated caller'; end if;
  select * into v_slot from public.meal_plan_slots where id = p_slot_id for update;
  if v_slot is null then raise exception 'No Meal Slot found for id %', p_slot_id; end if;
  v_log := public.record_ate_out(coalesce((select name from public.recipes where id = v_slot.recipe_id), v_slot.label), v_slot.slot_date, v_slot.meal_time, null);
  update public.meal_logs set meal_plan_slot_id = v_slot.id where id = v_log.id;
  select * into v_log from public.meal_logs where id = v_log.id;
  return v_log;
end;
$$;

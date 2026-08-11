-- Cook and Meal Stock (#10): one transition module previews and commits
-- cooking, delegates Stock Lot depletion to Inventory, and owns Portion
-- Batches plus Meal Log writes for eating.

create table public.portion_batches (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references public.recipes (id) on delete set null,
  label text,
  portions_remaining integer not null,
  storage_location public.storage_location not null default 'fridge',
  cooked_on date not null default current_date,
  created_at timestamptz not null default now(),
  constraint portion_batches_portions_nonnegative check (portions_remaining >= 0),
  constraint portion_batches_recipe_or_label check (
    recipe_id is not null or (label is not null and btrim(label) <> '')
  )
);

comment on table public.portion_batches is
  'Meal Stock held as Portions. A Cook creates a Recipe Batch in the Fridge; bought ready meals carry a label and no Recipe. Same Recipe+location+day Cook outputs merge.';

create unique index portion_batches_recipe_day_location_unique
  on public.portion_batches (recipe_id, storage_location, cooked_on)
  where recipe_id is not null;
create index portion_batches_recipe_oldest_idx
  on public.portion_batches (recipe_id, cooked_on, created_at);

select public.apply_deny_all_rls('public.portion_batches');

create policy "portion_batches_select_authenticated"
  on public.portion_batches for select to authenticated
  using (auth.uid() is not null);
create policy "portion_batches_insert_authenticated"
  on public.portion_batches for insert to authenticated
  with check (auth.uid() is not null);
create policy "portion_batches_update_authenticated"
  on public.portion_batches for update to authenticated
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "portion_batches_delete_authenticated"
  on public.portion_batches for delete to authenticated
  using (auth.uid() is not null);

create table public.cooks (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete restrict,
  portion_batch_id uuid not null references public.portion_batches (id) on delete restrict,
  multiplier integer not null,
  cooked_at timestamptz not null default now(),
  constraint cooks_multiplier_positive check (multiplier > 0)
);

comment on table public.cooks is
  'A recorded act of making one Recipe. Several Cooks can contribute to one same-day merged Portion Batch.';

create index cooks_recipe_id_idx on public.cooks (recipe_id);
create index cooks_portion_batch_id_idx on public.cooks (portion_batch_id);

select public.apply_deny_all_rls('public.cooks');
create policy "cooks_select_authenticated" on public.cooks for select to authenticated using (auth.uid() is not null);
create policy "cooks_insert_authenticated" on public.cooks for insert to authenticated with check (auth.uid() is not null);

create table public.cook_substitutions (
  id uuid primary key default gen_random_uuid(),
  cook_id uuid not null references public.cooks (id) on delete cascade,
  recipe_line_id uuid not null references public.recipe_lines (id) on delete restrict,
  substitute_ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cook_substitutions_one_per_line unique (cook_id, recipe_line_id)
);

comment on table public.cook_substitutions is
  'The Substitute actually selected and used for a Recipe Line during one Cook.';

select public.apply_deny_all_rls('public.cook_substitutions');
create policy "cook_substitutions_select_authenticated" on public.cook_substitutions for select to authenticated using (auth.uid() is not null);
create policy "cook_substitutions_insert_authenticated" on public.cook_substitutions for insert to authenticated with check (auth.uid() is not null);

alter table public.meal_logs
  add constraint meal_logs_portion_batch_id_fkey
  foreign key (portion_batch_id) references public.portion_batches (id) on delete set null;

-- Private-in-practice shared planner for preview_cook and commit_cook. It
-- simulates Lines in Recipe order against a virtual per-Ingredient balance,
-- so duplicate Lines cannot over-promise the same Pantry quantity. Commit
-- locks relevant Lots, invokes this exact function, then delegates each
-- physical depletion to Inventory's consume_stock.
create or replace function public.cook_preview(
  p_recipe_id uuid,
  p_multiplier integer,
  p_substitutions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_recipe public.recipes;
  v_line record;
  v_selected_id uuid;
  v_target_id uuid;
  v_target_name text;
  v_target_hand_depleted boolean;
  v_requested numeric;
  v_available numeric;
  v_will_deplete numeric;
  v_shortfall numeric;
  v_issue text;
  v_substitutes jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_balances jsonb := '{}'::jsonb;
  v_choice_count integer;
begin
  if auth.uid() is null then
    raise exception 'cook_preview requires an authenticated caller';
  end if;
  if jsonb_typeof(coalesce(p_substitutions, '[]'::jsonb)) <> 'array' then
    raise exception 'p_substitutions must be a JSON array';
  end if;

  select * into v_recipe from public.recipes where id = p_recipe_id;
  if v_recipe is null then
    raise exception 'No Recipe found for id %', p_recipe_id;
  end if;
  if p_multiplier < 1 or p_multiplier > v_recipe.max_multiplier then
    raise exception 'Cook multiplier must be between 1 and % for this Recipe', v_recipe.max_multiplier;
  end if;

  for v_line in
    select l.*, i.name as ingredient_name, i.is_hand_depleted
    from public.recipe_lines l
    left join public.ingredients i on i.id = l.ingredient_id
    where l.recipe_id = p_recipe_id
    order by l.position asc
  loop
    select count(*) into v_choice_count
    from jsonb_array_elements(p_substitutions) choice
    where choice ->> 'recipe_line_id' = v_line.id::text;
    if v_choice_count > 1 then
      raise exception 'Only one Substitute may be selected for Recipe Line %', v_line.id;
    end if;

    select nullif(choice ->> 'substitute_ingredient_id', '')::uuid into v_selected_id
    from jsonb_array_elements(p_substitutions) choice
    where choice ->> 'recipe_line_id' = v_line.id::text;

    if v_selected_id is not null and (
      v_line.is_essential or not exists (
        select 1 from public.recipe_line_substitutes s
        where s.recipe_line_id = v_line.id and s.ingredient_id = v_selected_id
      )
    ) then
      raise exception 'Selected Ingredient is not an allowed Substitute for Recipe Line %', v_line.id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', s.ingredient_id,
      'ingredient_name', si.name,
      'available_quantity', coalesce((
        select sum(lot.quantity) from public.stock_lots lot where lot.ingredient_id = s.ingredient_id
      ), 0)
    ) order by si.name), '[]'::jsonb)
    into v_substitutes
    from public.recipe_line_substitutes s
    join public.ingredients si on si.id = s.ingredient_id
    where s.recipe_line_id = v_line.id and not v_line.is_essential;

    v_target_id := coalesce(v_selected_id, v_line.ingredient_id);
    v_target_name := null;
    v_target_hand_depleted := false;
    v_requested := 0;
    v_available := 0;
    v_will_deplete := 0;
    v_shortfall := 0;
    v_issue := null;

    if v_target_id is null then
      v_issue := 'unresolved_ingredient';
    else
      select name, is_hand_depleted into v_target_name, v_target_hand_depleted
      from public.ingredients where id = v_target_id;

      if v_target_hand_depleted or v_line.amount is null then
        -- Hand-Depleted lines are informative but never automatic depletion.
        v_issue := case when v_target_hand_depleted then 'hand_depleted' else 'unmeasured' end;
      else
        begin
          v_requested := public.convert_to_stock_unit(
            v_target_id, v_line.amount * p_multiplier, v_line.unit
          );
        exception when others then
          v_requested := 0;
          v_issue := 'not_convertible_for_selected_ingredient';
        end;

        if v_issue is null then
          if v_balances ? v_target_id::text then
            v_available := (v_balances ->> v_target_id::text)::numeric;
          else
            select coalesce(sum(quantity), 0) into v_available
            from public.stock_lots where ingredient_id = v_target_id;
          end if;
          v_will_deplete := least(v_requested, v_available);
          v_shortfall := greatest(v_requested - v_available, 0);
          v_balances := jsonb_set(
            v_balances, array[v_target_id::text], to_jsonb(v_available - v_will_deplete), true
          );
        end if;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'recipe_line_id', v_line.id,
      'ingredient_id', v_target_id,
      'ingredient_name', coalesce(v_target_name, v_line.ingredient_name, v_line.raw_name),
      'stock_unit', (select stock_unit from public.ingredients where id = v_target_id),
      'requested', v_requested,
      'available_quantity', v_available,
      'will_deplete', v_will_deplete,
      'shortfall', v_shortfall,
      'issue', v_issue,
      'substitute_ingredient_id', v_selected_id,
      'substitutes', v_substitutes
    ));
  end loop;

  return jsonb_build_object(
    'recipe_id', v_recipe.id,
    'recipe_name', v_recipe.name,
    'multiplier', p_multiplier,
    'portions_produced', v_recipe.servings * p_multiplier,
    'lines', v_lines
  );
end;
$$;

comment on function public.cook_preview(uuid, integer, jsonb) is
  'Shared Cook planner. Returns scaled per-Line depletion, shortfall and Substitute choices; commit_cook invokes this same function after locking Lots.';

create or replace function public.preview_cook(
  p_recipe_id uuid,
  p_multiplier integer,
  p_substitutions jsonb default '[]'::jsonb
)
returns jsonb
language sql
as $$ select public.cook_preview(p_recipe_id, p_multiplier, p_substitutions); $$;

create or replace function public.commit_cook(
  p_recipe_id uuid,
  p_multiplier integer,
  p_substitutions jsonb default '[]'::jsonb,
  p_cooked_on date default current_date
)
returns jsonb
language plpgsql
as $$
declare
  v_preview jsonb;
  v_batch public.portion_batches;
  v_cook public.cooks;
  v_item jsonb;
  v_target_id uuid;
  v_requested numeric;
  v_selected_id uuid;
  v_lock record;
begin
  if auth.uid() is null then
    raise exception 'commit_cook requires an authenticated caller';
  end if;

  -- Lock direct and possible Substitute Lots in stable order before deriving
  -- the shared preview, keeping concurrent Cooks from changing its clamp.
  for v_lock in
    select lot.id
    from public.stock_lots lot
    where lot.ingredient_id in (
      select ingredient_id from public.recipe_lines
      where recipe_id = p_recipe_id and ingredient_id is not null
      union
      select sub.ingredient_id
      from public.recipe_line_substitutes sub
      join public.recipe_lines line on line.id = sub.recipe_line_id
      where line.recipe_id = p_recipe_id
    )
    order by lot.id
    for update
  loop
    null;
  end loop;

  v_preview := public.cook_preview(p_recipe_id, p_multiplier, p_substitutions);

  insert into public.portion_batches (recipe_id, portions_remaining, storage_location, cooked_on)
  values (p_recipe_id, (v_preview ->> 'portions_produced')::integer, 'fridge', p_cooked_on)
  on conflict (recipe_id, storage_location, cooked_on) where recipe_id is not null
    do update set portions_remaining = public.portion_batches.portions_remaining + excluded.portions_remaining
  returning * into v_batch;

  insert into public.cooks (recipe_id, portion_batch_id, multiplier)
  values (p_recipe_id, v_batch.id, p_multiplier)
  returning * into v_cook;

  for v_item in select value from jsonb_array_elements(v_preview -> 'lines')
  loop
    v_target_id := nullif(v_item ->> 'ingredient_id', '')::uuid;
    v_requested := coalesce((v_item ->> 'requested')::numeric, 0);
    if v_target_id is not null and v_requested > 0 and v_item ->> 'issue' is null then
      perform public.consume_stock(v_target_id, v_requested);
    end if;

    v_selected_id := nullif(v_item ->> 'substitute_ingredient_id', '')::uuid;
    if v_selected_id is not null then
      insert into public.cook_substitutions (cook_id, recipe_line_id, substitute_ingredient_id)
      values (v_cook.id, (v_item ->> 'recipe_line_id')::uuid, v_selected_id);
    end if;
  end loop;

  return v_preview || jsonb_build_object('cook_id', v_cook.id, 'portion_batch_id', v_batch.id);
end;
$$;

comment on function public.commit_cook(uuid, integer, jsonb, date) is
  'Atomically locks Pantry Lots, calculates the same preview as preview_cook, depletes through Inventory, records selected Substitutes, and adds scaled Portions to a same-day Fridge Batch. Stock shortfalls never block a Cook.';

create or replace function public.add_portion_batch(
  p_recipe_id uuid,
  p_label text,
  p_portions integer,
  p_storage_location public.storage_location default 'fridge',
  p_cooked_on date default current_date
)
returns public.portion_batches
language plpgsql
as $$
declare v_batch public.portion_batches;
begin
  if auth.uid() is null then raise exception 'add_portion_batch requires an authenticated caller'; end if;
  if p_portions <= 0 then raise exception 'add_portion_batch requires a positive Portion count'; end if;
  if p_recipe_id is null and coalesce(btrim(p_label), '') = '' then
    raise exception 'A bought ready meal needs a label';
  end if;

  if p_recipe_id is not null then
    insert into public.portion_batches (recipe_id, portions_remaining, storage_location, cooked_on)
    values (p_recipe_id, p_portions, p_storage_location, p_cooked_on)
    on conflict (recipe_id, storage_location, cooked_on) where recipe_id is not null
      do update set portions_remaining = public.portion_batches.portions_remaining + excluded.portions_remaining
    returning * into v_batch;
  else
    insert into public.portion_batches (label, portions_remaining, storage_location, cooked_on)
    values (btrim(p_label), p_portions, p_storage_location, p_cooked_on)
    returning * into v_batch;
  end if;
  return v_batch;
end;
$$;

create or replace function public.eat_portion(
  p_portion_batch_id uuid default null,
  p_recipe_id uuid default null,
  p_occurred_on date default current_date,
  p_meal_time text default null,
  p_note text default null
)
returns public.meal_logs
language plpgsql
as $$
declare v_batch public.portion_batches; v_log public.meal_logs; v_recipe_name text;
begin
  if auth.uid() is null then raise exception 'eat_portion requires an authenticated caller'; end if;
  if p_portion_batch_id is not null then
    select * into v_batch from public.portion_batches where id = p_portion_batch_id for update;
  elsif p_recipe_id is not null then
    select * into v_batch from public.portion_batches
    where recipe_id = p_recipe_id and portions_remaining > 0
    order by cooked_on asc, created_at asc limit 1 for update;
  else
    raise exception 'eat_portion requires a Portion Batch or Recipe';
  end if;
  if v_batch is null or v_batch.portions_remaining <= 0 then
    raise exception 'No Portion available to eat';
  end if;

  update public.portion_batches set portions_remaining = portions_remaining - 1 where id = v_batch.id;
  select name into v_recipe_name from public.recipes where id = v_batch.recipe_id;
  insert into public.meal_logs (occurred_on, meal_time, kind, recipe_id, portion_batch_id, recipe_name, note)
  values (p_occurred_on, p_meal_time, 'eaten', v_batch.recipe_id, v_batch.id,
          coalesce(v_recipe_name, v_batch.label), p_note)
  returning * into v_log;
  return v_log;
end;
$$;

create or replace function public.record_ate_out(
  p_description text,
  p_occurred_on date default current_date,
  p_meal_time text default null,
  p_note text default null
)
returns public.meal_logs
language plpgsql
as $$
declare v_log public.meal_logs;
begin
  if auth.uid() is null then raise exception 'record_ate_out requires an authenticated caller'; end if;
  if coalesce(btrim(p_description), '') = '' then raise exception 'Ate Out needs a description'; end if;
  insert into public.meal_logs (occurred_on, meal_time, kind, recipe_name, note)
  values (p_occurred_on, p_meal_time, 'ate_out', btrim(p_description), p_note)
  returning * into v_log;
  return v_log;
end;
$$;

-- One row per Recipe (and labelled ready-meal group) with count and age from
-- its oldest non-empty Batch. security_invoker preserves RLS for anon calls.
create or replace view public.meal_stock
with (security_invoker = on) as
select
  b.recipe_id,
  b.label,
  coalesce(r.name, b.label) as display_name,
  sum(b.portions_remaining) as total_portions,
  min(b.cooked_on) as oldest_cooked_on,
  count(*) as batch_count
from public.portion_batches b
left join public.recipes r on r.id = b.recipe_id
where b.portions_remaining > 0
group by b.recipe_id, r.name, b.label;

comment on view public.meal_stock is
  'Meal Stock totals for each Recipe plus labelled bought ready meals. Uses oldest non-empty Portion Batch for age.';

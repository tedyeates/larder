-- Plan Proposals (#15): the Agent may prepare a whole proposed plan, but only
-- a browser-authenticated person may confirm its one write into Shopping.

create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  planning_horizon date not null,
  status text not null default 'review',
  bundle jsonb not null,
  rejection_comment text,
  rejected_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_proposals_status_valid check (status in ('review', 'rejected', 'confirmed')),
  constraint plan_proposals_rejection_consistent check (
    (status = 'rejected') = (rejected_at is not null)
  )
);

comment on table public.plan_proposals is
  'One AI Plan Proposal bundle awaiting human review. Its bundle is immutable after confirmation; rejected bundles may be resubmitted after correction.';

select public.apply_deny_all_rls('public.plan_proposals');
create policy "plan_proposals_select_owner" on public.plan_proposals for select to authenticated using (auth.uid() = user_id);
create policy "plan_proposals_insert_owner" on public.plan_proposals for insert to authenticated with check (auth.uid() = user_id);
create policy "plan_proposals_update_owner" on public.plan_proposals for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plan_proposals_delete_owner" on public.plan_proposals for delete to authenticated using (auth.uid() = user_id);

alter table public.ingredients drop constraint ingredients_status_valid;
alter table public.ingredients add constraint ingredients_status_valid check (status in ('active', 'archived', 'draft'));
alter table public.ingredients add column proposal_id uuid references public.plan_proposals (id) on delete cascade;
alter table public.ingredients add column proposal_ref text;
create unique index ingredients_proposal_ref_unique on public.ingredients (proposal_id, proposal_ref) where proposal_ref is not null;

alter table public.ingredient_aliases add column status text not null default 'active';
alter table public.ingredient_aliases add column proposal_id uuid references public.plan_proposals (id) on delete cascade;
alter table public.ingredient_aliases add constraint ingredient_aliases_status_valid check (status in ('active', 'draft'));

alter table public.recipes add column proposal_id uuid references public.plan_proposals (id) on delete cascade;
alter table public.recipes add column proposal_ref text;
create unique index recipes_proposal_ref_unique on public.recipes (proposal_id, proposal_ref) where proposal_ref is not null;

alter table public.meal_plan_slots add column confirmed_plan_proposal_id uuid references public.plan_proposals (id) on delete set null;

-- Proposal drafts must not leak into deterministic application reads. Imports
-- still use status=draft with proposal_id null and retain their existing review
-- flow; this filter applies only to drafts originating from a Plan Proposal.
create or replace function public.resolve_ingredient_name(
  p_name text,
  p_limit integer default 5
)
returns table (ingredient_id uuid, name text, match_kind public.ingredient_match_kind, score real)
language plpgsql stable as $$
declare v_name text := btrim(p_name);
begin
  if auth.uid() is null then raise exception 'resolve_ingredient_name requires an authenticated caller'; end if;
  if v_name = '' then raise exception 'resolve_ingredient_name requires a non-blank name'; end if;
  return query select i.id, i.name, 'exact'::public.ingredient_match_kind, 1.0::real
    from public.ingredients i where i.status = 'active' and i.proposal_id is null and lower(btrim(i.name)) = lower(v_name) limit 1;
  if found then return; end if;
  return query select i.id, i.name, 'alias'::public.ingredient_match_kind, 1.0::real
    from public.ingredient_aliases a join public.ingredients i on i.id = a.ingredient_id
    where a.status = 'active' and i.status = 'active' and i.proposal_id is null and lower(btrim(a.alias)) = lower(v_name) limit 1;
  if found then return; end if;
  return query
    select ranked.ingredient_id, ranked.name, 'fuzzy'::public.ingredient_match_kind, ranked.score
    from (
      select distinct on (candidates.ingredient_id) candidates.ingredient_id, candidates.name, candidates.score
      from (
        select i.id as ingredient_id, i.name, similarity(i.name, v_name) as score
          from public.ingredients i where i.status = 'active' and i.proposal_id is null
        union all
        select i.id, i.name, similarity(a.alias, v_name)
          from public.ingredient_aliases a join public.ingredients i on i.id = a.ingredient_id
          where a.status = 'active' and i.status = 'active' and i.proposal_id is null
      ) candidates order by candidates.ingredient_id, candidates.score desc
    ) ranked where ranked.score > 0.2 order by ranked.score desc limit p_limit;
end;
$$;

create or replace view public.recipe_line_inconsistencies
with (security_invoker = on) as
select l.id as recipe_line_id, l.recipe_id,
  case
    when l.ingredient_id is null then 'unresolved_ingredient'
    when l.amount is not null and l.unit is null then 'missing_unit'
    when l.amount is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit) then 'non_convertible_unit'
    when l.amount is null and not i.is_hand_depleted then 'unmeasured_on_auto_depleted'
  end as reason,
  coalesce(l.raw_name, i.name) as line_label
from public.recipe_lines l
join public.recipes r on r.id = l.recipe_id and r.proposal_id is null
left join public.ingredients i on i.id = l.ingredient_id
where l.ingredient_id is null
   or (l.amount is not null and l.unit is null)
   or (l.amount is not null and l.unit is not null and not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit))
   or (l.amount is null and not i.is_hand_depleted);

create or replace view public.recipe_line_pantry_status
with (security_invoker = on) as
select l.id as recipe_line_id, l.recipe_id, l.ingredient_id, l.is_essential,
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
    select 1 from public.recipe_line_substitutes sub
    left join (select ingredient_id, sum(total_quantity) as total_quantity from public.pantry_summary group by ingredient_id) sub_stock
      on sub_stock.ingredient_id = sub.ingredient_id
    where sub.recipe_line_id = l.id and not l.is_essential and coalesce(sub_stock.total_quantity, 0) > 0
  ) as has_substitute_stock
from public.recipe_lines l
join public.recipes r on r.id = l.recipe_id and r.proposal_id is null
left join public.ingredients i on i.id = l.ingredient_id
left join (select ingredient_id, sum(total_quantity) as total_quantity from public.pantry_summary group by ingredient_id) stock
  on stock.ingredient_id = l.ingredient_id;

create or replace view public.recipe_status
with (security_invoker = on) as
select recipe_line_id, recipe_id, ingredient_id, is_essential,
  case when has_direct_stock then 'available' when has_substitute_stock then 'fulfilled_by_substitute' else 'missing' end as status
from public.recipe_line_pantry_status;

create or replace view public.recipe_cookability
with (security_invoker = on) as
select r.id as recipe_id, r.name,
  not exists (select 1 from public.recipe_status rs where rs.recipe_id = r.id and rs.status = 'missing') as is_cookable
from public.recipes r
where r.proposal_id is null;

-- Proposal drafts cannot enter ordinary Meal Plan writes before human confirmation.
create or replace function public.meal_plan_slots_reject_proposal_draft()
returns trigger language plpgsql as $$
begin
  if new.recipe_id is not null and exists (select 1 from public.recipes where id = new.recipe_id and proposal_id is not null and status = 'draft') then
    raise exception 'Draft Plan Proposal Recipes cannot enter Meal Plan';
  end if;
  return new;
end;
$$;
create trigger meal_plan_slots_reject_proposal_draft
before insert or update of recipe_id on public.meal_plan_slots
for each row execute function public.meal_plan_slots_reject_proposal_draft();

-- Plan Check deliberately checks only hard arithmetic and boundary facts. It
-- returns a machine-fixable failure list instead of throwing so a Runner can
-- correct and resubmit without involving the user.
create or replace function public.plan_proposal_check(p_bundle jsonb)
returns jsonb language plpgsql stable as $$
declare
  v_failures jsonb := '[]'::jsonb;
  v_slots jsonb := '[]'::jsonb;
  v_new_recipes jsonb := '[]'::jsonb;
  v_new_ingredients jsonb := '[]'::jsonb;
  v_aliases jsonb := '[]'::jsonb;
  v_horizon date;
  v_slot jsonb; v_recipe jsonb; v_line jsonb; v_item jsonb;
  v_date date; v_ref text; v_recipe_id uuid; v_ingredient_id uuid;
  v_servings integer; v_max_multiplier integer; v_multiplier integer;
  v_count integer; v_cook_total integer; v_stock_unit text;
  v_has_recipe boolean; v_empty boolean; v_keep boolean;
  v_amount numeric; v_unit text; v_name text;
begin
  if auth.uid() is null then raise exception 'plan_proposal_check requires an authenticated caller'; end if;
  if jsonb_typeof(p_bundle) <> 'object' then
    return jsonb_build_object('accepted', false, 'failures', jsonb_build_array(jsonb_build_object('rule','bundle_shape','message','Plan Proposal must be an object')));
  end if;
  if jsonb_typeof(p_bundle->'slots') = 'array' then v_slots := p_bundle->'slots'; else
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','bundle_shape','path','slots','message','slots must be an array'));
  end if;
  if jsonb_typeof(p_bundle->'newRecipes') = 'array' then v_new_recipes := p_bundle->'newRecipes'; else
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','bundle_shape','path','newRecipes','message','newRecipes must be an array'));
  end if;
  if jsonb_typeof(p_bundle->'newIngredients') = 'array' then v_new_ingredients := p_bundle->'newIngredients'; else
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','bundle_shape','path','newIngredients','message','newIngredients must be an array'));
  end if;
  if jsonb_typeof(p_bundle->'suggestedAliases') = 'array' then v_aliases := p_bundle->'suggestedAliases'; else
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','bundle_shape','path','suggestedAliases','message','suggestedAliases must be an array'));
  end if;
  begin
    if coalesce(p_bundle->>'planningHorizon','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid'; end if;
    v_horizon := (p_bundle->>'planningHorizon')::date;
    if v_horizon < current_date then raise exception 'past'; end if;
  exception when others then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','planning_horizon','path','planningHorizon','message','Planning Horizon must be today or later'));
  end;

  -- Proposed names and aliases are checked before draft storage so a database
  -- uniqueness error never becomes an opaque Runner failure.
  for v_item in select value from jsonb_array_elements(v_new_ingredients) loop
    v_ref := coalesce(v_item->>'ref',''); v_name := btrim(coalesce(v_item->>'name',''));
    if v_ref = '' or v_name = '' or btrim(coalesce(v_item->>'stockUnit','')) = '' then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','ingredient_resolution','ingredientRef',v_ref,'message','New Ingredient needs ref, name and Stock Unit'));
    elsif exists (select 1 from public.ingredients where lower(btrim(name)) = lower(v_name))
       or exists (select 1 from jsonb_array_elements(v_new_ingredients) other where other <> v_item and lower(btrim(other->>'name')) = lower(v_name)) then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','ingredient_resolution','ingredientRef',v_ref,'message','New Ingredient name already exists'));
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(v_aliases) loop
    v_name := btrim(coalesce(v_item->>'alias',''));
    if v_name = '' then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','ingredient_resolution','message','Suggested Alias must be non-blank'));
    elsif exists (select 1 from public.ingredients where lower(btrim(name)) = lower(v_name))
       or exists (select 1 from public.ingredient_aliases where lower(btrim(alias)) = lower(v_name))
       or exists (select 1 from jsonb_array_elements(v_new_ingredients) i where lower(btrim(i->>'name')) = lower(v_name)) then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','ingredient_resolution','message','Suggested Alias collides with an Ingredient or Alias'));
    end if;
  end loop;

  -- Validate slot completeness/date and each selected Recipe's multiplier and
  -- usable lines. A recipeRef points into newRecipes; recipeId points to an
  -- already confirmed Recipe.
  for v_slot in select value from jsonb_array_elements(v_slots) loop
    v_empty := coalesce(v_slot->>'empty','false') = 'true';
    v_keep := coalesce(v_slot->>'keep','false') = 'true';
    v_has_recipe := coalesce(v_slot->>'recipeRef','') <> '' or coalesce(v_slot->>'recipeId','') <> '';
    if (case when v_empty then 1 else 0 end) + (case when v_keep then 1 else 0 end) + (case when v_has_recipe or btrim(coalesce(v_slot->>'label','')) <> '' then 1 else 0 end) <> 1 then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','slot_completeness','message','Every Slot must be filled, explicitly empty, or kept'));
    end if;
    begin
      if coalesce(v_slot->>'slotDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid'; end if;
      v_date := (v_slot->>'slotDate')::date;
      if v_date < current_date or v_horizon is null or v_date > v_horizon then raise exception 'outside'; end if;
    exception when others then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','slot_horizon','slotDate',v_slot->>'slotDate','message','Slot must fall between today and Planning Horizon'));
    end;
    if not v_has_recipe then continue; end if;

    v_recipe := null; v_recipe_id := null; v_servings := null; v_max_multiplier := null;
    if coalesce(v_slot->>'recipeRef','') <> '' then
      select value into v_recipe from jsonb_array_elements(v_new_recipes) where value->>'ref' = v_slot->>'recipeRef' limit 1;
      if v_recipe is not null then
        begin v_servings := (v_recipe->>'servings')::integer; v_max_multiplier := coalesce((v_recipe->>'maxMultiplier')::integer, 1); exception when others then null; end;
      end if;
    elsif coalesce(v_slot->>'recipeId','') ~ '^[0-9a-fA-F-]{36}$' then
      begin v_recipe_id := (v_slot->>'recipeId')::uuid; exception when others then null; end;
      select servings, max_multiplier into v_servings, v_max_multiplier from public.recipes
        where id = v_recipe_id and proposal_id is null and status = 'confirmed';
    end if;
    if v_servings is null or v_servings <= 0 or v_max_multiplier is null or v_max_multiplier <= 0 then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','recipe_resolution','recipeRef',coalesce(v_slot->>'recipeRef',v_slot->>'recipeId'),'message','Slot Recipe does not resolve to a usable Recipe'));
      continue;
    end if;
    if coalesce(v_slot->>'isCook','false') = 'true' then
      begin v_multiplier := coalesce((v_slot->>'cookMultiplier')::integer, 1); exception when others then v_multiplier := 0; end;
      if v_multiplier < 1 or v_multiplier > v_max_multiplier then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','multiplier_limit','recipeRef',coalesce(v_slot->>'recipeRef',v_slot->>'recipeId'),'message','Cook multiplier is outside this Recipe limit'));
      end if;
    end if;
    if v_recipe is not null then
      for v_line in select value from jsonb_array_elements(case when jsonb_typeof(v_recipe->'lines') = 'array' then v_recipe->'lines' else '[]'::jsonb end) loop
        v_stock_unit := null; v_ingredient_id := null;
        if coalesce(v_line->>'ingredientRef','') <> '' then
          select btrim(value->>'stockUnit') into v_stock_unit from jsonb_array_elements(v_new_ingredients) where value->>'ref' = v_line->>'ingredientRef' limit 1;
        elsif coalesce(v_line->>'ingredientId','') ~ '^[0-9a-fA-F-]{36}$' then
          begin v_ingredient_id := (v_line->>'ingredientId')::uuid; exception when others then null; end;
          select stock_unit into v_stock_unit from public.ingredients where id = v_ingredient_id and status = 'active' and proposal_id is null;
        end if;
        begin v_amount := (v_line->>'amount')::numeric; exception when others then v_amount := null; end;
        v_unit := btrim(coalesce(v_line->>'unit',''));
        if v_stock_unit is null or v_amount is null or v_amount <= 0 or v_unit = ''
           or (lower(v_unit) <> lower(v_stock_unit) and (v_ingredient_id is null or not exists (select 1 from public.unit_conversions where ingredient_id = v_ingredient_id and lower(btrim(from_unit)) = lower(v_unit)))) then
          v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','recipe_line_usable','recipeRef',v_recipe->>'ref','message','Every Recipe Line needs a resolved Ingredient and usable amount'));
        end if;
      end loop;
    else
      if exists (
        select 1 from public.recipe_lines l left join public.ingredients i on i.id = l.ingredient_id
        where l.recipe_id = v_recipe_id and (l.ingredient_id is null or i.status <> 'active' or i.proposal_id is not null or l.amount is null or l.amount <= 0 or l.unit is null or btrim(l.unit) = '' or not public.recipe_line_has_conversion(l.ingredient_id, l.amount, l.unit))
      ) then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','recipe_line_usable','recipeId',v_recipe_id,'message','Every Recipe Line needs a resolved Ingredient and usable amount'));
      end if;
    end if;
  end loop;

  -- Exact portions are checked per referenced Recipe after all Slots have
  -- resolved. Multiple Cook Slots are supported by summing their multipliers.
  for v_ref in
    select distinct coalesce(value->>'recipeRef', value->>'recipeId')
    from jsonb_array_elements(v_slots)
    where coalesce(value->>'recipeRef', value->>'recipeId', '') <> ''
  loop
    v_recipe := null; v_recipe_id := null; v_servings := null;
    select value into v_recipe from jsonb_array_elements(v_new_recipes) where value->>'ref' = v_ref limit 1;
    if v_recipe is not null then
      begin v_servings := (v_recipe->>'servings')::integer; exception when others then null; end;
      select count(*)::integer, coalesce(sum(case when coalesce(value->>'isCook','false') = 'true' then coalesce((value->>'cookMultiplier')::integer, 1) else 0 end),0)::integer
      into v_count, v_cook_total from jsonb_array_elements(v_slots) where value->>'recipeRef' = v_ref;
    elsif v_ref ~ '^[0-9a-fA-F-]{36}$' then
      begin v_recipe_id := v_ref::uuid; exception when others then null; end;
      select servings into v_servings from public.recipes where id = v_recipe_id and proposal_id is null and status = 'confirmed';
      select count(*)::integer, coalesce(sum(case when coalesce(value->>'isCook','false') = 'true' then coalesce((value->>'cookMultiplier')::integer, 1) else 0 end),0)::integer
      into v_count, v_cook_total from jsonb_array_elements(v_slots) where value->>'recipeId' = v_ref;
    end if;
    if v_servings is not null and v_count <> v_servings * v_cook_total then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('rule','serving_coverage','recipeRef',v_ref,'message','Recipe servings multiplied by Cook multiplier must equal assigned Meal Slots'));
    end if;
  end loop;

  return jsonb_build_object('accepted', jsonb_array_length(v_failures) = 0, 'failures', v_failures);
end;
$$;

create or replace function public.submit_plan_proposal(p_bundle jsonb, p_proposal_id uuid default null)
returns jsonb language plpgsql as $$
declare
  v_check jsonb; v_proposal public.plan_proposals; v_existing public.plan_proposals;
  v_new_ingredients jsonb := coalesce(p_bundle->'newIngredients','[]'::jsonb);
  v_new_recipes jsonb := coalesce(p_bundle->'newRecipes','[]'::jsonb);
  v_aliases jsonb := coalesce(p_bundle->'suggestedAliases','[]'::jsonb);
  v_item jsonb; v_line jsonb; v_recipe jsonb;
  v_ingredient_ids jsonb := '{}'::jsonb; v_recipe_id uuid; v_ingredient_id uuid;
  v_ref text; v_horizon date;
begin
  if auth.uid() is null then raise exception 'submit_plan_proposal requires an authenticated caller'; end if;
  v_check := public.plan_proposal_check(p_bundle);
  if not coalesce((v_check->>'accepted')::boolean, false) then return v_check; end if;
  v_horizon := (p_bundle->>'planningHorizon')::date;
  if p_proposal_id is not null then
    select * into v_existing from public.plan_proposals where id = p_proposal_id and user_id = auth.uid() for update;
    if v_existing is null then raise exception 'Plan Proposal not found'; end if;
    if v_existing.status = 'confirmed' then raise exception 'Confirmed Plan Proposal cannot be resubmitted'; end if;
    delete from public.ingredient_aliases where proposal_id = p_proposal_id;
    delete from public.recipes where proposal_id = p_proposal_id;
    delete from public.ingredients where proposal_id = p_proposal_id;
    update public.plan_proposals set planning_horizon = v_horizon, bundle = p_bundle, status = 'review', rejection_comment = null, rejected_at = null, updated_at = now()
      where id = p_proposal_id returning * into v_proposal;
  else
    insert into public.plan_proposals (user_id, planning_horizon, bundle) values (auth.uid(), v_horizon, p_bundle) returning * into v_proposal;
  end if;
  for v_item in select value from jsonb_array_elements(v_new_ingredients) loop
    v_ref := v_item->>'ref';
    insert into public.ingredients (name, stock_unit, is_hand_depleted, status, proposal_id, proposal_ref)
    values (btrim(v_item->>'name'), btrim(v_item->>'stockUnit'), coalesce((v_item->>'isHandDepleted')::boolean, false), 'draft', v_proposal.id, v_ref)
    returning id into v_ingredient_id;
    v_ingredient_ids := jsonb_set(v_ingredient_ids, array[v_ref], to_jsonb(v_ingredient_id::text));
  end loop;
  for v_recipe in select value from jsonb_array_elements(v_new_recipes) loop
    insert into public.recipes (name, servings, max_multiplier, prep_minutes, cook_minutes, source, steps, status, proposal_id, proposal_ref)
    values (btrim(v_recipe->>'name'), (v_recipe->>'servings')::integer, coalesce((v_recipe->>'maxMultiplier')::integer, 1),
      nullif(v_recipe->>'prepMinutes','')::integer, nullif(v_recipe->>'cookMinutes','')::integer,
      nullif(btrim(v_recipe->>'source'), ''), nullif(v_recipe->>'steps',''), 'draft', v_proposal.id, v_recipe->>'ref')
    returning id into v_recipe_id;
    insert into public.recipe_tags (recipe_id, tag)
      select v_recipe_id, btrim(value) from jsonb_array_elements_text(case when jsonb_typeof(v_recipe->'tags') = 'array' then v_recipe->'tags' else '[]'::jsonb end)
      where btrim(value) <> '' on conflict do nothing;
    for v_line in select value from jsonb_array_elements(case when jsonb_typeof(v_recipe->'lines') = 'array' then v_recipe->'lines' else '[]'::jsonb end) loop
      if coalesce(v_line->>'ingredientRef','') <> '' then v_ingredient_id := (v_ingredient_ids->>(v_line->>'ingredientRef'))::uuid;
      else v_ingredient_id := (v_line->>'ingredientId')::uuid; end if;
      insert into public.recipe_lines (recipe_id, ingredient_id, raw_name, amount, unit, note, is_essential, position)
      values (v_recipe_id, v_ingredient_id, nullif(v_line->>'rawName',''), (v_line->>'amount')::numeric, btrim(v_line->>'unit'), nullif(v_line->>'note',''), coalesce((v_line->>'isEssential')::boolean, false), coalesce((v_line->>'position')::integer, 0));
    end loop;
  end loop;
  for v_item in select value from jsonb_array_elements(v_aliases) loop
    if coalesce(v_item->>'ingredientRef','') <> '' then v_ingredient_id := (v_ingredient_ids->>(v_item->>'ingredientRef'))::uuid;
    else v_ingredient_id := (v_item->>'ingredientId')::uuid; end if;
    insert into public.ingredient_aliases (ingredient_id, alias, status, proposal_id)
    values (v_ingredient_id, btrim(v_item->>'alias'), 'draft', v_proposal.id);
  end loop;
  return jsonb_build_object('accepted', true, 'failures', '[]'::jsonb, 'proposal', jsonb_build_object('id',v_proposal.id,'status',v_proposal.status,'planningHorizon',v_proposal.planning_horizon));
end;
$$;

create or replace function public.reject_plan_proposal(p_proposal_id uuid, p_comment text)
returns void language plpgsql as $$
begin
  if auth.uid() is null then raise exception 'reject_plan_proposal requires an authenticated caller'; end if;
  if current_setting('request.agent_token', true) = 'true' then raise exception 'Agent Token cannot reject a Plan Proposal'; end if;
  update public.plan_proposals set status = 'rejected', rejection_comment = nullif(btrim(p_comment), ''), rejected_at = now(), updated_at = now()
    where id = p_proposal_id and user_id = auth.uid() and status = 'review';
  if not found then raise exception 'Reviewable Plan Proposal not found'; end if;
end;
$$;

create or replace function public.confirm_plan_proposal(p_proposal_id uuid)
returns jsonb language plpgsql as $$
declare
  v_proposal public.plan_proposals; v_slot jsonb; v_existing public.meal_plan_slots;
  v_date date; v_recipe_id uuid; v_recipe_ref text; v_required numeric; v_pantry numeric; v_need record;
begin
  if auth.uid() is null then raise exception 'confirm_plan_proposal requires an authenticated caller'; end if;
  if current_setting('request.agent_token', true) = 'true' then raise exception 'Agent Token cannot confirm a Plan Proposal'; end if;
  select * into v_proposal from public.plan_proposals where id = p_proposal_id and user_id = auth.uid() for update;
  if v_proposal is null then raise exception 'Plan Proposal not found'; end if;
  if v_proposal.status = 'confirmed' then return jsonb_build_object('proposalId',v_proposal.id,'alreadyConfirmed',true); end if;
  if v_proposal.status <> 'review' then raise exception 'Only a reviewable Plan Proposal can be confirmed'; end if;

  update public.ingredients set status = 'active' where proposal_id = v_proposal.id and status = 'draft';
  update public.recipes set status = 'confirmed' where proposal_id = v_proposal.id and status = 'draft';
  update public.ingredient_aliases set status = 'active' where proposal_id = v_proposal.id and status = 'draft';

  for v_slot in select value from jsonb_array_elements(v_proposal.bundle->'slots') loop
    if coalesce(v_slot->>'keep','false') = 'true' then continue; end if;
    v_date := (v_slot->>'slotDate')::date;
    select * into v_existing from public.meal_plan_slots where slot_date = v_date and meal_time = v_slot->>'mealTime' for update;
    if v_existing is not null and (v_existing.cook_id is not null or exists (select 1 from public.meal_logs where meal_plan_slot_id = v_existing.id)) then continue; end if;
    if coalesce(v_slot->>'empty','false') = 'true' then
      if v_existing is not null then delete from public.meal_plan_slots where id = v_existing.id; end if;
      continue;
    end if;
    v_recipe_id := null;
    if coalesce(v_slot->>'recipeRef','') <> '' then
      select id into v_recipe_id from public.recipes where proposal_id = v_proposal.id and proposal_ref = v_slot->>'recipeRef';
    elsif coalesce(v_slot->>'recipeId','') <> '' then v_recipe_id := (v_slot->>'recipeId')::uuid; end if;
    if v_existing is null then
      insert into public.meal_plan_slots (slot_date, meal_time, recipe_id, label, is_cook, cook_multiplier, confirmed_plan_proposal_id)
      values (v_date, v_slot->>'mealTime', v_recipe_id, nullif(btrim(v_slot->>'label'), ''), coalesce((v_slot->>'isCook')::boolean, false), coalesce((v_slot->>'cookMultiplier')::integer, 1), v_proposal.id);
    else
      update public.meal_plan_slots set recipe_id = v_recipe_id, label = nullif(btrim(v_slot->>'label'), ''), is_cook = coalesce((v_slot->>'isCook')::boolean, false),
        cook_multiplier = coalesce((v_slot->>'cookMultiplier')::integer, 1), cook_id = null, confirmed_plan_proposal_id = v_proposal.id
      where id = v_existing.id;
    end if;
  end loop;

  -- Snapshot Pantry now. This is deliberately the only moment plan material
  -- demand can add to Shopping; later Pantry or plan edits never revise it.
  for v_need in
    select l.ingredient_id, sum(public.convert_to_stock_unit(l.ingredient_id, l.amount, l.unit) * s.cook_multiplier) as amount
    from public.meal_plan_slots s join public.recipe_lines l on l.recipe_id = s.recipe_id
    where s.confirmed_plan_proposal_id = v_proposal.id and s.is_cook and l.ingredient_id is not null and l.amount is not null
    group by l.ingredient_id
  loop
    select coalesce(sum(quantity), 0) into v_pantry from public.stock_lots where ingredient_id = v_need.ingredient_id;
    v_required := v_need.amount - v_pantry;
    if v_required > 0 then perform public.add_shopping_item(v_need.ingredient_id, v_required); end if;
  end loop;
  update public.ingredient_aliases set proposal_id = null where proposal_id = v_proposal.id;
  update public.recipes set proposal_id = null where proposal_id = v_proposal.id;
  update public.ingredients set proposal_id = null where proposal_id = v_proposal.id;
  update public.plan_proposals set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = v_proposal.id;
  return jsonb_build_object('proposalId',v_proposal.id,'alreadyConfirmed',false);
end;
$$;

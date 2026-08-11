-- Meal Log (#9): historical Cook Log import records actual food history before
-- the planner exists. `recipe_name` preserves history before Recipe import has
-- a canonical recipe_id; future Meal Log writes may populate recipe_id instead.
create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null,
  meal_time text,
  kind text not null default 'eaten',
  recipe_id uuid references public.recipes (id) on delete set null,
  portion_batch_id uuid,
  recipe_name text,
  note text,
  source_key text,
  created_at timestamptz not null default now(),
  constraint meal_logs_kind_valid check (kind in ('eaten', 'ate_out')),
  constraint meal_logs_meal_time_not_blank check (meal_time is null or btrim(meal_time) <> ''),
  constraint meal_logs_recipe_name_not_blank check (recipe_name is null or btrim(recipe_name) <> ''),
  constraint meal_logs_note_not_blank check (note is null or btrim(note) <> ''),
  constraint meal_logs_source_key_not_blank check (source_key is null or btrim(source_key) <> '')
);

comment on table public.meal_logs is
  'Record of what was actually eaten. Historical Cook Log import stores recipe_name until imported Recipes can be linked; source_key makes the one-way import idempotent.';
comment on column public.meal_logs.source_key is
  'Stable hash of an imported Cook Log file path and line number. Null for ordinary app-created Meal Log rows.';

create unique index meal_logs_source_key_unique
  on public.meal_logs (source_key)
  where source_key is not null;
create index meal_logs_occurred_on_idx on public.meal_logs (occurred_on desc);

select public.apply_deny_all_rls('public.meal_logs');

create policy "meal_logs_select_authenticated"
  on public.meal_logs for select
  to authenticated
  using (auth.uid() is not null);

create policy "meal_logs_insert_authenticated"
  on public.meal_logs for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "meal_logs_update_authenticated"
  on public.meal_logs for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "meal_logs_delete_authenticated"
  on public.meal_logs for delete
  to authenticated
  using (auth.uid() is not null);

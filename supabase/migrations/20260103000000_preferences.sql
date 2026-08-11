-- Preferences (#4): flat rows carrying the user's stated leanings — "don't
-- repeat a recipe within four weeks", "lactose free", "favour older stock".
--
-- Per .kiro/specs/larder-core/design.md (Q16, "Preferences and
-- configuration"): these are deliberately not rules. The AI reads every
-- row at the start of a planning session and reasons with them, but
-- nothing in the app enforces or validates against a Preference —
-- enforcement of structural things belongs to Plan Check, and everything
-- about taste, variety and diet is rejected conversationally if the AI
-- ignores it. There is intentionally no logic here beyond CRUD plus an
-- updated_at stamp.
--
-- Single-authenticated-user app (.kiro/specs/security.md): policies gate
-- on `auth.uid() is not null` rather than per-row ownership, matching the
-- Ingredient Registry migration. The Agent Runner gains write access to
-- this table in ticket #11 via the same authenticated policies (it is
-- authenticated by an Agent Token resolved server-side, never a database
-- credential).
create table public.preferences (
  id uuid primary key default gen_random_uuid(),
  category text,
  body text not null,
  updated_at timestamptz not null default now(),
  constraint preferences_body_not_blank check (btrim(body) <> ''),
  constraint preferences_category_not_blank check (category is null or btrim(category) <> '')
);

comment on table public.preferences is
  'Flat rows of stated leanings the AI reads every planning session and reasons with, but which nothing in the app enforces or validates against. Not rules — see .kiro/specs/larder-core/design.md Q16. Structural enforcement is Plan Check''s job, not this table''s.';
comment on column public.preferences.category is
  'Optional free-text grouping (e.g. "diet", "variety", "cadence") for skimmability. Nullable and unconstrained on purpose — this is not a controlled vocabulary.';
comment on column public.preferences.body is
  'The leaning itself, in the user''s own words, e.g. "lactose free" or "max three cooks a week".';

select public.apply_deny_all_rls('public.preferences');

create policy "preferences_select_authenticated"
  on public.preferences for select
  to authenticated
  using (auth.uid() is not null);

create policy "preferences_insert_authenticated"
  on public.preferences for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "preferences_update_authenticated"
  on public.preferences for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "preferences_delete_authenticated"
  on public.preferences for delete
  to authenticated
  using (auth.uid() is not null);

-- Every edit refreshes updated_at automatically, so listings can order by
-- recency without callers remembering to stamp it themselves.
create or replace function public.preferences_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger preferences_touch_updated_at
  before update on public.preferences
  for each row execute function public.preferences_set_updated_at();

-- Backs the default listing order (most recently touched first) and the
-- optional category filter.
create index preferences_updated_at_idx on public.preferences (updated_at desc);
create index preferences_category_idx on public.preferences (category);

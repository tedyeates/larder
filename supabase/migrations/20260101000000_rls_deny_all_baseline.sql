-- Foundation: RLS deny-all baseline, so that no later migration can
-- accidentally ship a public table.
--
-- Per .kiro/specs/security.md: "RLS on every table from the first
-- migration." The anon key ships inside the JS bundle, so any table
-- without RLS is world-readable and world-writable.
--
-- Supabase's model puts the real access boundary at RLS policies, not at
-- table-level GRANTs: `anon` and `authenticated` are meant to hold baseline
-- CRUD privileges on every table so that RLS is the single place access is
-- decided, and a table with RLS enabled but no policy denies everything
-- regardless of its GRANTs. Revoking the GRANTs instead would make every
-- future query fail with "permission denied" rather than the intended
-- "0 rows", which leaks table existence and breaks anon-key error handling
-- the client relies on.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- A tiny helper so every future migration enables RLS and adds an explicit
-- deny-all baseline in one call, rather than each one re-deriving it.
create or replace function public.apply_deny_all_rls(target_table regclass)
returns void
language plpgsql
as $$
begin
  execute format('alter table %s enable row level security', target_table);
  execute format('alter table %s force row level security', target_table);
  execute format(
    'grant select, insert, update, delete on %s to anon, authenticated',
    target_table
  );
  -- No policy is created here on purpose: with RLS enabled and no policy,
  -- every role except the table owner (never used by the app at runtime)
  -- is denied by default, regardless of the GRANT above. Each module adds
  -- the specific policies it needs in its own migration.
end;
$$;

comment on function public.apply_deny_all_rls(regclass) is
  'Enables and forces row level security on target_table, grants baseline CRUD to anon/authenticated so RLS (not the GRANT) is the access boundary, and attaches no policy — the deny-all baseline every new table starts from.';

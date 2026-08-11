-- One row per Supabase Auth user. The anchor every later module's tables
-- will reference via user_id, and the table the "deny-all baseline" pgTAP
-- assertion exercises for real.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per Supabase Auth user. Created by the handle_new_user trigger below.';

select public.apply_deny_all_rls('public.profiles');

-- A user may see and update only their own row. No insert/delete policy for
-- anon or authenticated — rows are created exclusively by the trigger below,
-- which runs as the table owner and is therefore unaffected by RLS.
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Keeps profiles in sync with auth.users without the app ever writing to
-- auth.users directly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

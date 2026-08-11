-- No seed data for the foundation ticket. Later tickets may seed reference
-- data here (e.g. default Storage Locations).

-- Local dev/test user. Email/password auth only — there is no sign-up UI,
-- so this is the one way to get a session against the local Supabase stack.
-- Credentials are throwaway local-only values, safe to keep in source.
do $$
declare
  seed_user_id uuid := '00000000-0000-0000-0000-000000000001';
  seed_email text := 'dev@larder.local';
  seed_password text := 'larder-dev-password';
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    seed_user_id,
    'authenticated',
    'authenticated',
    seed_email,
    extensions.crypt(seed_password, extensions.gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    '',
    '',
    '',
    ''
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    seed_user_id,
    seed_user_id::text,
    seed_user_id,
    jsonb_build_object('sub', seed_user_id::text, 'email', seed_email),
    'email',
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_id) do nothing;
end $$;

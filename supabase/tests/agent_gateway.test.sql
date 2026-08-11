-- Agent Gateway (#14): Agent Token storage and the RLS boundary used by MCP.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000140', 'agent-token-owner@example.com'),
  ('00000000-0000-0000-0000-000000000141', 'other-agent-token-user@example.com')
on conflict (id) do nothing;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.agent_tokens'::regclass),
  'Agent Tokens have row level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.agent_tokens'::regclass),
  'Agent Tokens force row level security'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000140","role":"authenticated"}';

insert into public.agent_tokens (id, user_id, token_hash, label) values
  ('14000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000140',
   '9c6f8d4b7a2e1c0d9f8b7a6e5d4c3b2a1908172635445566778899aabbccdde0',
   'planner container');

select isnt(
  (select token_hash from public.agent_tokens where id = '14000000-0000-0000-0000-000000000001'),
  'agt_raw-secret-never-stored',
  'Agent Token table stores a hash, not a raw secret'
);
select is(
  (select count(*)::int from public.agent_tokens where id = '14000000-0000-0000-0000-000000000001'),
  1,
  'owner can list their Agent Token metadata'
);

reset role;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000141","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.agent_tokens where id = '14000000-0000-0000-0000-000000000001'),
  0,
  'another user cannot read an Agent Token row'
);

update public.agent_tokens
set revoked_at = now()
where id = '14000000-0000-0000-0000-000000000001';

reset role;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000140","role":"authenticated"}';
set local role authenticated;

select ok(
  (select revoked_at is null from public.agent_tokens where id = '14000000-0000-0000-0000-000000000001'),
  'another user cannot revoke an owner Agent Token'
);

update public.agent_tokens
set revoked_at = now()
where id = '14000000-0000-0000-0000-000000000001';

select ok(
  (select revoked_at is not null from public.agent_tokens where id = '14000000-0000-0000-0000-000000000001'),
  'owner can revoke an Agent Token'
);

reset role;
set local "request.jwt.claims" to '';
set local role anon;

select is(
  (select count(*)::int from public.agent_tokens),
  0,
  'anon cannot read Agent Token metadata or hashes'
);

reset role;

select ok(
  'security_invoker=on' = any(
    coalesce((select reloptions from pg_class where oid = 'public.pantry_summary'::regclass), '{}'::text[])
  ),
  'Pantry summary reads with caller RLS rather than its view owner privileges'
);

select * from finish();
rollback;

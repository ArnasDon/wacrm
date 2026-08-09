-- Lightweight, privacy-preserving tool-call telemetry for the live agent
-- flow panel. Arguments, results and conversation text are deliberately not
-- stored here.

create table if not exists wacrm.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  tool_key text not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  succeeded boolean not null default true,
  called_at timestamptz not null default now(),
  constraint agent_tool_calls_tool_key_check
    check (tool_key in (
      'search_catalog',
      'send_product',
      'search_knowledge',
      'add_tag',
      'create_deal',
      'handoff_human'
    ))
);

create index if not exists agent_tool_calls_account_called_idx
  on wacrm.agent_tool_calls (account_id, called_at desc);

create index if not exists agent_tool_calls_agent_tool_called_idx
  on wacrm.agent_tool_calls (agent_id, tool_key, called_at desc);

alter table wacrm.agent_tool_calls enable row level security;

revoke all on table wacrm.agent_tool_calls from public, anon;
grant select on table wacrm.agent_tool_calls to authenticated;
grant all on table wacrm.agent_tool_calls to service_role;

drop policy if exists agent_tool_calls_select on wacrm.agent_tool_calls;
create policy agent_tool_calls_select
on wacrm.agent_tool_calls
for select
to authenticated
using (wacrm.is_account_member(account_id));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'wacrm'
      and tablename = 'agent_tool_calls'
  ) then
    alter publication supabase_realtime add table wacrm.agent_tool_calls;
  end if;
end
$$;

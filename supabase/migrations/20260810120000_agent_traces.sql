-- One privacy-preserving row per automatic agent turn. Conversation text,
-- model output, tool arguments/results and retrieved memory text must never be
-- copied into this table.

create table if not exists wacrm.agent_traces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  turn_id uuid not null,
  intent text,
  model_tier text not null default 'smart',
  final_action text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  memory_match_count integer not null default 0 check (memory_match_count >= 0),
  total_ms integer not null default 0 check (total_ms >= 0),
  created_at timestamptz not null default now(),
  constraint agent_traces_account_turn_unique unique (account_id, turn_id),
  constraint agent_traces_intent_check
    check (intent is null or intent in ('faq', 'sales', 'complaint', 'account', 'smalltalk')),
  constraint agent_traces_model_tier_check check (model_tier in ('fast', 'smart')),
  constraint agent_traces_final_action_check
    check (final_action in ('reply', 'handoff', 'no_reply')),
  constraint agent_traces_tool_calls_array_check check (jsonb_typeof(tool_calls) = 'array')
);

create index if not exists agent_traces_account_created_idx
  on wacrm.agent_traces (account_id, created_at desc);

create index if not exists agent_traces_conversation_created_idx
  on wacrm.agent_traces (conversation_id, created_at desc)
  where conversation_id is not null;

alter table wacrm.agent_traces enable row level security;

revoke all on table wacrm.agent_traces from public, anon;
grant select on table wacrm.agent_traces to authenticated;
grant all on table wacrm.agent_traces to service_role;

drop policy if exists agent_traces_select on wacrm.agent_traces;
create policy agent_traces_select
on wacrm.agent_traces
for select
to authenticated
using (wacrm.is_account_member(account_id));

-- Store-visit / appointment scheduling for the AI agent (schedule_visit
-- tool). Generic — any account can use it, not just clothing/try-before-you-
-- buy businesses, but it was motivated by exactly that flow: the agent
-- guides the customer through the catalogue over WhatsApp, then books a
-- date/time for them to come try things on in person.

create table if not exists wacrm.scheduled_visits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  contact_id uuid not null references wacrm.contacts(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  scheduled_at timestamptz not null,
  notes text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_visits_account_time_idx
  on wacrm.scheduled_visits (account_id, scheduled_at);

drop trigger if exists set_updated_at on wacrm.scheduled_visits;
create trigger set_updated_at
before update on wacrm.scheduled_visits
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.scheduled_visits enable row level security;

revoke all on table wacrm.scheduled_visits from public, anon;
grant select, update on table wacrm.scheduled_visits to authenticated;
grant all on table wacrm.scheduled_visits to service_role;

drop policy if exists scheduled_visits_select on wacrm.scheduled_visits;
create policy scheduled_visits_select
on wacrm.scheduled_visits
for select
to authenticated
using (wacrm.is_account_member(account_id));

-- Status changes (mark done / cancelled) come from the team, not the
-- agent — the agent only ever inserts via the service-role tool executor.
drop policy if exists scheduled_visits_update on wacrm.scheduled_visits;
create policy scheduled_visits_update
on wacrm.scheduled_visits
for update
to authenticated
using (wacrm.is_account_member(account_id, 'agent'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'agent'::wacrm.account_role_enum));

-- Extend the agent_tool_calls telemetry check constraint with the new key.
alter table wacrm.agent_tool_calls
  drop constraint if exists agent_tool_calls_tool_key_check;
alter table wacrm.agent_tool_calls
  add constraint agent_tool_calls_tool_key_check
  check (tool_key in (
    'search_catalog',
    'send_product',
    'search_knowledge',
    'add_tag',
    'create_deal',
    'schedule_visit',
    'get_style_opinion',
    'handoff_human'
  ));

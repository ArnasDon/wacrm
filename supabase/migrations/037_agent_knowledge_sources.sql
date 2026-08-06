-- Per-agent external knowledge sources.
-- Existing agents remain unchanged: no rows are inserted and enabled defaults to false.

create table if not exists wacrm.agent_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  provider text not null,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  last_test_status text,
  last_test_message text,
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agent_knowledge_sources_provider_check
    check (provider in ('novyra')),
  constraint agent_knowledge_sources_test_status_check
    check (last_test_status is null or last_test_status in ('success', 'failed')),
  constraint agent_knowledge_sources_test_message_check
    check (last_test_message is null or char_length(last_test_message) <= 1000),
  constraint agent_knowledge_sources_configuration_object_check
    check (jsonb_typeof(configuration) = 'object'),
  constraint agent_knowledge_sources_agent_provider_key
    unique (agent_id, provider),
  constraint agent_knowledge_sources_account_agent_provider_key
    unique (account_id, agent_id, provider)
);

create index if not exists agent_knowledge_sources_account_idx
  on wacrm.agent_knowledge_sources (account_id);

create index if not exists agent_knowledge_sources_enabled_idx
  on wacrm.agent_knowledge_sources (agent_id, provider)
  where enabled = true;

create or replace function wacrm.validate_agent_knowledge_source_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not exists (
    select 1
    from wacrm.ai_configs c
    where c.id = new.agent_id
      and c.account_id = new.account_id
  ) then
    raise exception 'Knowledge source agent must belong to the same account'
      using errcode = '23503';
  end if;

  if new.provider = 'novyra' then
    new.configuration := jsonb_build_object(
      'agentCode', coalesce(nullif(new.configuration ->> 'agentCode', ''), 'novura-news-whatsapp'),
      'countryCode', coalesce(nullif(new.configuration ->> 'countryCode', ''), 'MZ')
    );
  end if;

  return new;
end;
$function$;

revoke all on function wacrm.validate_agent_knowledge_source_context() from public;

drop trigger if exists wacrm_validate_agent_knowledge_source_context
  on wacrm.agent_knowledge_sources;
create trigger wacrm_validate_agent_knowledge_source_context
before insert or update of account_id, agent_id, provider, configuration
on wacrm.agent_knowledge_sources
for each row execute function wacrm.validate_agent_knowledge_source_context();

drop trigger if exists set_updated_at on wacrm.agent_knowledge_sources;
create trigger set_updated_at
before update on wacrm.agent_knowledge_sources
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.agent_knowledge_sources enable row level security;

revoke all on table wacrm.agent_knowledge_sources from public, anon;
grant select, insert, update, delete on table wacrm.agent_knowledge_sources to authenticated;
grant all on table wacrm.agent_knowledge_sources to service_role;

drop policy if exists agent_knowledge_sources_select on wacrm.agent_knowledge_sources;
create policy agent_knowledge_sources_select
on wacrm.agent_knowledge_sources
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists agent_knowledge_sources_insert on wacrm.agent_knowledge_sources;
create policy agent_knowledge_sources_insert
on wacrm.agent_knowledge_sources
for insert
to authenticated
with check (
  wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum)
  and exists (
    select 1
    from wacrm.ai_configs c
    where c.id = agent_id
      and c.account_id = account_id
  )
);

drop policy if exists agent_knowledge_sources_update on wacrm.agent_knowledge_sources;
create policy agent_knowledge_sources_update
on wacrm.agent_knowledge_sources
for update
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (
  wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum)
  and exists (
    select 1
    from wacrm.ai_configs c
    where c.id = agent_id
      and c.account_id = account_id
  )
);

drop policy if exists agent_knowledge_sources_delete on wacrm.agent_knowledge_sources;
create policy agent_knowledge_sources_delete
on wacrm.agent_knowledge_sources
for delete
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

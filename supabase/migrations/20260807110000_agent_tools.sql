-- Per-agent tool permissions.
-- Existing AI configs keep the current behaviour by enabling the tools that
-- were already implicitly available before this migration.

create table if not exists wacrm.agent_tools (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  tool_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_tools_tool_key_check
    check (tool_key in ('search_catalog', 'send_product', 'search_knowledge')),
  constraint agent_tools_agent_tool_key unique (agent_id, tool_key),
  constraint agent_tools_account_agent_tool_key unique (account_id, agent_id, tool_key)
);

create index if not exists agent_tools_account_idx
  on wacrm.agent_tools (account_id, agent_id);

create or replace function wacrm.validate_agent_tool_context()
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
    raise exception 'Agent tool must belong to the same account'
      using errcode = '23503';
  end if;
  return new;
end;
$function$;

revoke all on function wacrm.validate_agent_tool_context() from public;

drop trigger if exists wacrm_validate_agent_tool_context on wacrm.agent_tools;
create trigger wacrm_validate_agent_tool_context
before insert or update of account_id, agent_id, tool_key
on wacrm.agent_tools
for each row execute function wacrm.validate_agent_tool_context();

drop trigger if exists set_updated_at on wacrm.agent_tools;
create trigger set_updated_at
before update on wacrm.agent_tools
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.agent_tools enable row level security;

revoke all on table wacrm.agent_tools from public, anon;
grant select, insert, update, delete on table wacrm.agent_tools to authenticated;
grant all on table wacrm.agent_tools to service_role;

drop policy if exists agent_tools_select on wacrm.agent_tools;
create policy agent_tools_select
on wacrm.agent_tools
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists agent_tools_insert on wacrm.agent_tools;
create policy agent_tools_insert
on wacrm.agent_tools
for insert
to authenticated
with check (
  wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum)
);

drop policy if exists agent_tools_update on wacrm.agent_tools;
create policy agent_tools_update
on wacrm.agent_tools
for update
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists agent_tools_delete on wacrm.agent_tools;
create policy agent_tools_delete
on wacrm.agent_tools
for delete
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

insert into wacrm.agent_tools (account_id, agent_id, tool_key, enabled)
select c.account_id, c.id, tool_key, true
from wacrm.ai_configs c
cross join (values
  ('search_catalog'::text),
  ('send_product'::text),
  ('search_knowledge'::text)
) as defaults(tool_key)
on conflict (agent_id, tool_key) do nothing;

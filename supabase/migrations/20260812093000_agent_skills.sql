-- Skills: a named, data-driven bundle of "objective prompt + subset of
-- tools" for an agent, so a business's behaviour for a given moment
-- (selling, qualifying, after-sales, ...) is configured per account
-- instead of growing the one shared prompt scaffold in
-- src/lib/ai/defaults.ts for every tenant on the platform.
--
-- Deliberately additive and backward compatible: an agent with zero rows
-- here behaves exactly as before this migration (buildSystemPrompt/
-- createAutoReplyTools only consult skills when at least one exists for
-- the agent — see src/lib/ai/skills.ts). `tool_keys` mirrors the
-- AgentToolKey enum in src/lib/ai/tool-permissions.ts; a skill's tools
-- still need to be enabled account-wide in agent_tools — this is an
-- additional narrowing, not a replacement for that permission check.

create table if not exists wacrm.skills (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  tool_keys text[] not null default '{}'
    check (
      tool_keys <@ array[
        'search_catalog',
        'send_product',
        'search_knowledge',
        'add_tag',
        'create_deal',
        'schedule_visit',
        'get_style_opinion',
        'handoff_human'
      ]::text[]
    ),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skills_agent_name unique (agent_id, name),
  constraint skills_account_agent_name unique (account_id, agent_id, name)
);

create index if not exists skills_account_idx
  on wacrm.skills (account_id, agent_id);

-- Reuses the same "child row's agent belongs to the same account" guard
-- already defined for wacrm.agent_tools — the function only reads
-- NEW.agent_id/NEW.account_id, so it is not table-specific.
drop trigger if exists wacrm_validate_skill_context on wacrm.skills;
create trigger wacrm_validate_skill_context
before insert or update of account_id, agent_id
on wacrm.skills
for each row execute function wacrm.validate_agent_tool_context();

drop trigger if exists set_updated_at on wacrm.skills;
create trigger set_updated_at
before update on wacrm.skills
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.skills enable row level security;

revoke all on table wacrm.skills from public, anon;
grant select, insert, update, delete on table wacrm.skills to authenticated;
grant all on table wacrm.skills to service_role;

drop policy if exists skills_select on wacrm.skills;
create policy skills_select
on wacrm.skills
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists skills_insert on wacrm.skills;
create policy skills_insert
on wacrm.skills
for insert
to authenticated
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists skills_update on wacrm.skills;
create policy skills_update
on wacrm.skills
for update
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists skills_delete on wacrm.skills;
create policy skills_delete
on wacrm.skills
for delete
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

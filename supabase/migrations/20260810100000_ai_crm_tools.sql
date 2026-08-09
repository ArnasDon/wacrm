-- CRM action tools for the AI agent. Mutating tools are opt-in; structured
-- human handoff preserves the safety behaviour previously provided by the
-- [[HANDOFF]] sentinel.

alter table wacrm.agent_tools
  drop constraint if exists agent_tools_tool_key_check;

alter table wacrm.agent_tools
  add constraint agent_tools_tool_key_check
  check (tool_key in (
    'search_catalog',
    'send_product',
    'search_knowledge',
    'add_tag',
    'create_deal',
    'handoff_human'
  ));

insert into wacrm.agent_tools (account_id, agent_id, tool_key, enabled)
select c.account_id, c.id, defaults.tool_key, defaults.enabled
from wacrm.ai_configs c
cross join (values
  ('add_tag'::text, false),
  ('create_deal'::text, false),
  ('handoff_human'::text, true)
) as defaults(tool_key, enabled)
on conflict (agent_id, tool_key) do nothing;

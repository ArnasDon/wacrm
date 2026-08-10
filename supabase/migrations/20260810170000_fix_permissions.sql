-- Fixes two real permission bugs surfaced by a live deployment:
--
-- 1. ai_knowledge_documents / ai_knowledge_chunks (030_ai_knowledge.sql)
--    got RLS policies but were never GRANTed to `authenticated` at the
--    table level. Postgres checks table-level privileges before RLS is
--    even evaluated, so every save failed with "permission denied for
--    table ai_knowledge_documents" (42501) regardless of the policies
--    being otherwise correct.
--
-- 2. wacrm.agent_tools's check constraint (widened in
--    20260810100000_ai_crm_tools.sql for add_tag/create_deal/
--    handoff_human) was never widened again for schedule_visit or
--    get_style_opinion, so turning either one on in Ferramentas failed
--    with "violates check constraint agent_tools_tool_key_check".

grant select, insert, update, delete on table wacrm.ai_knowledge_documents to authenticated;
grant all on table wacrm.ai_knowledge_documents to service_role;

grant select, insert, update, delete on table wacrm.ai_knowledge_chunks to authenticated;
grant all on table wacrm.ai_knowledge_chunks to service_role;

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
    'schedule_visit',
    'get_style_opinion',
    'handoff_human'
  ));

-- Lets any account add free-text guidance to a specific tool's built-in
-- description without a code change — the cheapest lever toward "every
-- account is a different business" on this multi-tenant platform, where
-- tool descriptions were previously one fixed English string for every
-- tenant regardless of what they sell.

alter table wacrm.agent_tools
  add column if not exists instructions text;

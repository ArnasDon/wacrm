-- Identity fields, separate from the free-text system_prompt: a name,
-- role label, default language and an admin-facing internal note. All
-- nullable — an agent with none of these set behaves exactly as before
-- (buildSystemPrompt's identity line only changes when agent_name is
-- present, see src/lib/ai/defaults.ts).

alter table wacrm.ai_configs
  add column if not exists agent_name text check (char_length(agent_name) <= 80),
  add column if not exists agent_role text check (char_length(agent_role) <= 120),
  add column if not exists agent_language text check (char_length(agent_language) <= 40),
  add column if not exists agent_description text check (char_length(agent_description) <= 500);

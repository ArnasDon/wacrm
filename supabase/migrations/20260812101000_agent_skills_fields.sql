-- Enriches a skill with structured reading material for the model's own
-- judgement: objective, when to use, when not to use — separate from the
-- free-text `instructions` block. Deliberately NOT a routing/selection
-- mechanism (no code decides which skill "applies" from these fields);
-- they only make skillsPrompt()'s output clearer for the model to reason
-- over itself. All nullable — an existing skill with none of these set
-- renders exactly as it did before this migration.

alter table wacrm.skills
  add column if not exists objective text check (char_length(objective) <= 500),
  add column if not exists when_to_use text check (char_length(when_to_use) <= 500),
  add column if not exists when_not_to_use text check (char_length(when_not_to_use) <= 500);

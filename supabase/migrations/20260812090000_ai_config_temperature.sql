-- Adds an optional sampling temperature dial to ai_configs. Null (the
-- default for every existing row) means "omit temperature from the
-- provider request" — identical to today's behaviour, where neither
-- provider adapter sends the field at all. OpenAI accepts 0-2; Anthropic
-- accepts 0-1, so the wider OpenAI range is stored here and the
-- Anthropic adapter clamps to its own max at request time rather than
-- forcing two provider-specific columns for one dial.

alter table wacrm.ai_configs
  add column if not exists temperature numeric(3, 2)
    check (temperature is null or (temperature >= 0 and temperature <= 2));

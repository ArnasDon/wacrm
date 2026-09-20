-- ============================================================
-- 047_claude_agent_sdk_provider.sql — novo provider "claude-agent-sdk"
--
-- Acrescenta o provider "claude-agent-sdk" (Agent SDK + subscrição
-- Claude Code da Eter, autenticado por CLAUDE_CODE_OAUTH_TOKEN no
-- ambiente do serviço — ver src/lib/ai/providers/claude-agent-sdk.ts)
-- a par de "openai"/"anthropic" (bring-your-own-key), que ficam
-- inalterados.
--
-- Duas alterações:
--   1. ai_configs.provider   — CHECK alargado para incluir o valor novo.
--   2. ai_configs.api_key    — passa a aceitar NULL: só faz sentido
--                              para "openai"/"anthropic" (chave por
--                              conta); "claude-agent-sdk" não guarda
--                              nenhuma chave na base de dados (ver
--                              loadAiConfig em src/lib/ai/config.ts —
--                              trata NULL como "sem chave, correcto"
--                              apenas para este provider).
--   3. ai_usage_log.provider — mesmo CHECK, para o log de consumo
--                              aceitar linhas geradas por este provider.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ALTER COLUMN api_key DROP NOT NULL;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'claude-agent-sdk'));

-- Defensivo: garante que uma linha "openai"/"anthropic" nunca fica sem
-- chave (só "claude-agent-sdk" pode ter api_key NULL) — sem isto, a
-- coluna NULLable acima abriria a porta a uma conta BYO-key gravada
-- sem chave nenhuma.
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_byok_requires_key;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_byok_requires_key
    CHECK (provider = 'claude-agent-sdk' OR api_key IS NOT NULL);

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'claude-agent-sdk'));

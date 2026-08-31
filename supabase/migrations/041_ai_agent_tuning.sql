-- ============================================================
-- 041_ai_agent_tuning.sql — AI agent tuning knobs
--
-- Adds four admin-facing levers to `ai_configs` for how the AI agent
-- behaves, all additive with defaults that reproduce the exact
-- behaviour that existed before this migration — an account that never
-- opens the new Setup fields sees no change.
--
--   - handoff_sensitivity: how readily the auto-reply bot escalates to
--     a human. 'balanced' is the ONLY value whose prompt wording
--     matches what shipped before this column existed (see
--     buildSystemPrompt in src/lib/ai/defaults.ts) — it is the default
--     so nothing changes unless an admin picks a different level.
--   - temperature: provider sampling temperature. NULL (default) means
--     "omit the param" — the provider's own default, exactly today's
--     behaviour. Constrained to 0..1 (a support-bot range; both
--     providers' own maximum is higher, but this app exposes presets,
--     not a raw dial — see ai-config.tsx).
--   - knowledge_top_k: replaces the hardcoded k=5 default in
--     retrieveKnowledge (src/lib/ai/knowledge.ts) with a per-account
--     value; 5 is the same number that was hardcoded, so this is a
--     no-op until changed.
--   - knowledge_min_relevance: optional relevance floor for semantic KB
--     retrieval. NULL (default) disables filtering, matching today's
--     unfiltered behaviour. When set, `retrieveKnowledge` converts this
--     0..1 "strictness" into a max cosine distance and drops weaker
--     semantic matches — match_ai_knowledge_semantic (migration 030)
--     already returns the distance column this reads; no RPC change.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_sensitivity text NOT NULL DEFAULT 'balanced'
    CHECK (handoff_sensitivity IN ('conservative', 'balanced', 'assertive'));

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS temperature numeric(2,1)
    CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS knowledge_top_k integer NOT NULL DEFAULT 5
    CHECK (knowledge_top_k BETWEEN 1 AND 10);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS knowledge_min_relevance numeric(3,2)
    CHECK (knowledge_min_relevance IS NULL OR knowledge_min_relevance BETWEEN 0 AND 1);

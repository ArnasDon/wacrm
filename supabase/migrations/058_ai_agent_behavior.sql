-- ============================================================
-- 058_ai_agent_behavior.sql — structurally separate Agent Behavior
-- from Business Context (Fase 10 audit, hallazgo crítico 2).
--
-- Before this migration, `ai_configs.system_prompt` (029_ai_reply.sql)
-- was the ONLY free-text field an admin could use, and it was asked to
-- carry two conceptually distinct things at once: business facts (what
-- the business sells, its policies) and agent behavior/persona (tone,
-- formality, sales style). The Fase 10 read-only audit found this
-- mixing real but never a functional bug — both purposes reached the
-- model exactly the same way, inside the same free-text block.
--
-- This adds ONE new, optional column for the second concept. It is
-- purely additive:
--   - `system_prompt` is untouched — existing configurations keep
--     working exactly as before, unread and unmodified.
--   - `agent_behavior` defaults to NULL, so every existing row is
--     unaffected until an admin explicitly fills it in via the new
--     "Agent Behavior" field in AI Agents → Setup.
--   - No RLS changes: `ai_configs`' existing policies (029_ai_reply.sql)
--     already scope by `account_id` via `is_account_member(...)`, not
--     by column — a new nullable column on the same table needs no new
--     policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS agent_behavior text;

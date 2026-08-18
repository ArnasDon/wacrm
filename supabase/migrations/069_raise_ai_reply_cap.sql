-- ============================================================
-- 069_raise_ai_reply_cap.sql — raise the per-conversation
-- auto-reply cap from 20 to 200
--
-- `ai_configs.auto_reply_max_per_conversation` (migration 029) bounds
-- how many times the bot will answer one WhatsApp thread before going
-- quiet — a safety guard against runaway loops / bill blowout on a
-- chatty customer, not a meaningful product limit. Angel asked to be
-- able to set it higher than 20 for accounts that want the bot to
-- keep going through long conversations. 200 keeps the same kind of
-- guard rail (still bounded, so a true runaway loop can't spend
-- unboundedly on the account's own BYO key) while giving real headroom.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 200);

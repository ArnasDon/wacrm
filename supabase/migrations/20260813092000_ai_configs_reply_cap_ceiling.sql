-- Raise the ceiling on auto_reply_max_per_conversation from 20 to 100.
--
-- The mechanism was already fully per-account configurable (see
-- src/app/api/ai/config/route.ts); the hard CHECK constraint at 20 was
-- the actual blocker for accounts like LC Fitness that legitimately need
-- a longer bounded auto-reply run than the original default anticipated.
-- The protection itself is not removed, only widened — a value must
-- still be an explicit, bounded, per-account choice.

ALTER TABLE wacrm.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE wacrm.ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 100);

-- ============================================================
-- 044_ai_dormancy_reset.sql — auto-reset a stale AI pause after
-- customer inactivity
--
-- Today, once a conversation hits `auto_reply_max_per_conversation` or
-- the model hands off, `conversations.ai_autoreply_disabled` stays TRUE
-- forever — only a human clicking "Resume AI" clears it. A customer who
-- goes quiet and comes back weeks later with an unrelated question gets
-- permanent silence from the bot until an agent happens to notice.
--
--   - `ai_configs.dormancy_reset_hours` — opt-in (NULL = disabled,
--     today's sticky-forever behaviour, unchanged for every account
--     that doesn't set this). When set, the cron at
--     src/app/api/ai/cron/route.ts resets the pause on any conversation
--     that's been quiet (`conversations.last_message_at`, already
--     maintained on every inbound/outbound send — see 037) longer than
--     this many hours.
--   - `conversations.ai_paused_by_human` — set true only by a human
--     explicitly clicking "Take over" (src/app/api/ai/autoreply/
--     [conversationId]/route.ts), false when the BOT disables itself
--     (model handoff, reply cap) or when a human clicks "Resume AI".
--     The dormancy sweep only ever touches rows where this is false —
--     a conversation a human deliberately took over is never
--     auto-resumed out from under them, no matter how long it's been
--     quiet.
--
-- Caveat (documented, not backfilled): existing rows default this to
-- false, so a conversation a human took over BEFORE this migration —
-- and that has since gone quiet — won't be distinguishable from a bot
-- handoff on the very first sweep after deploying. Only matters for
-- accounts that both already had a human take over a now-dormant
-- conversation AND opt into dormancy reset; narrow enough not to
-- warrant a backfill heuristic.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS dormancy_reset_hours integer
    CHECK (dormancy_reset_hours IS NULL OR dormancy_reset_hours BETWEEN 1 AND 720);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_paused_by_human boolean NOT NULL DEFAULT false;

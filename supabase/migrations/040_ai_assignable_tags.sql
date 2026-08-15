-- ============================================================
-- 040_ai_assignable_tags.sql — AI-assignable tags
--
-- NOTE: renamed from 031 → 040 when syncing this fork with upstream.
-- The 031 slot was already taken by 031_ai_reply_slot_grant.sql, so
-- shipping this as 031 too made a clean `supabase db` apply fail with
-- a duplicate schema_migrations key (SQLSTATE 23505). This migration
-- is idempotent (ADD COLUMN IF NOT EXISTS) and independent of the
-- upstream migrations 032-039, so re-sequencing it after 039 is safe.
--
-- Lets the AI auto-reply assistant (migration 029) apply an *existing*
-- tag to a contact via native provider tool-use (OpenAI function
-- calling / Anthropic tool use). The model is never allowed to create
-- a tag — only to pick from a closed enum built from tags the account
-- has explicitly opted in.
--
-- `ai_assignable` is that opt-in: only tags with this flag set are
-- exposed to the model. Keeps operational tags (vip, inadimplente,
-- newsletter-only) out of the model's reach by default.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS ai_assignable boolean NOT NULL DEFAULT false;

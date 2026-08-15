-- ============================================================
-- 031_ai_assignable_tags.sql — AI-assignable tags
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

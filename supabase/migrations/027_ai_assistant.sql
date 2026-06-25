-- ============================================================
-- 027_ai_assistant.sql — AI assistant for WhatsApp ("LLM wiki")
--
-- Adds the data model for an AI assistant that answers inbound
-- WhatsApp messages grounded only in a per-account knowledge base.
-- When the model is confident the KB covers the question it replies
-- autonomously; otherwise it escalates to a human and goes silent on
-- that conversation. See docs/superpowers/specs/2026-06-25-wacrm-ai-
-- assistant-design.md §4 for the source-of-truth design.
--
-- What this migration does
--   1. `ai_assistant_config` — one row per account: master enable,
--      editable system prompt, persona, model, daily reply cap.
--   2. `knowledge_base_entries` — the "wiki pages" fed to the model.
--   3. ALTERs `conversations` with the AI hand-off columns
--      (`ai_handling`, `ai_escalated_at`, `ai_escalation_reason`).
--   4. `ai_reply_log` — one row per AI decision (audit + future cost
--      view). Inserts are service-role only.
--
-- Tenancy + RLS follow migrations 017–026: every table carries an
-- `account_id` FK to `accounts` (ON DELETE CASCADE), RLS is enabled,
-- and policies gate access via the `is_account_member(account_id,
-- min_role)` SECURITY DEFINER helper from 017. Config + knowledge
-- are admin+ (settings-class, mirroring `tags` / `api_keys`).
-- `ai_reply_log` is admin-read, service-role-write (mirroring
-- `automation_logs`). Service-role writes from the webhook bypass
-- RLS as the other engines already do.
--
-- Idempotent — safe to run multiple times. Tables use IF NOT
-- EXISTS; columns use ADD COLUMN IF NOT EXISTS; policies are dropped
-- before recreate (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- AI_ASSISTANT_CONFIG — one row per account
--
-- One config row per account (UNIQUE account_id). `enabled` is off
-- by default: the assistant is strictly opt-in. `system_prompt` is
-- seeded with the strong "answer ONLY from the KB" default from
-- §7.2; admins may edit it. `escalation_keywords` is seeded with the
-- safety vocabulary that always hands off to a human pre-LLM.
-- `logo_url` is persona context only in v1 (no customer-facing
-- surface yet).
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_assistant_config (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  system_prompt       TEXT NOT NULL DEFAULT
    'You are the customer-support assistant for {business_name}. Answer ONLY using the information in the KNOWLEDGE BASE below. If the knowledge base does not clearly and fully answer the customer''s question, you MUST set `confident` to false and leave `answer` empty — do not guess, do not use outside knowledge, do not make promises about pricing, refunds, delivery dates, or policies that aren''t written here. Be concise, friendly, and match the customer''s language.',
  handoff_message     TEXT,
  escalation_keywords TEXT[] NOT NULL DEFAULT
    '{refund,cancel,complaint,lawyer,legal,human,agent,manager}',
  business_name       TEXT,
  logo_url            TEXT,
  model               TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  daily_reply_cap     INTEGER NOT NULL DEFAULT 500,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- account_id is the lookup key (one row per account; loaded on every
-- inbound the assistant evaluates). UNIQUE already creates an index,
-- but spell it out so intent survives a future drop of the UNIQUE.
CREATE INDEX IF NOT EXISTS idx_ai_assistant_config_account
  ON ai_assistant_config(account_id);

ALTER TABLE ai_assistant_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON ai_assistant_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_assistant_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: settings-class. admin+ for select/insert/update (mirrors the
-- `tags` / `whatsapp_config` policies in 017). No DELETE policy —
-- the row is removed only by the account cascade.
DROP POLICY IF EXISTS ai_assistant_config_select ON ai_assistant_config;
CREATE POLICY ai_assistant_config_select ON ai_assistant_config FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_assistant_config_insert ON ai_assistant_config;
CREATE POLICY ai_assistant_config_insert ON ai_assistant_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_assistant_config_update ON ai_assistant_config;
CREATE POLICY ai_assistant_config_update ON ai_assistant_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- KNOWLEDGE_BASE_ENTRIES — many per account (the "wiki pages")
--
-- Each row is one page of the LLM wiki. `content` is the markdown /
-- plain text fed verbatim to the model. `source_type` distinguishes
-- a hand-authored entry from one created by a file upload (the
-- original filename is kept for display). Disabled entries are
-- excluded from the assembled prompt. `token_estimate` caches a
-- chars/4 heuristic for the Settings size meter.
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_base_entries (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  source_type        TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'file')),
  source_filename    TEXT,
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  token_estimate     INTEGER,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- account_id: prompt assembly loads "this account's enabled entries".
-- The partial composite is tuned for that hot path (enabled only).
CREATE INDEX IF NOT EXISTS idx_knowledge_base_entries_account
  ON knowledge_base_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_entries_account_enabled
  ON knowledge_base_entries(account_id)
  WHERE enabled = TRUE;

ALTER TABLE knowledge_base_entries ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON knowledge_base_entries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON knowledge_base_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: settings-class. All ops admin+ (mirrors `custom_fields` in 017).
DROP POLICY IF EXISTS knowledge_base_entries_select ON knowledge_base_entries;
CREATE POLICY knowledge_base_entries_select ON knowledge_base_entries FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS knowledge_base_entries_insert ON knowledge_base_entries;
CREATE POLICY knowledge_base_entries_insert ON knowledge_base_entries FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS knowledge_base_entries_update ON knowledge_base_entries;
CREATE POLICY knowledge_base_entries_update ON knowledge_base_entries FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS knowledge_base_entries_delete ON knowledge_base_entries;
CREATE POLICY knowledge_base_entries_delete ON knowledge_base_entries FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- CONVERSATIONS — AI hand-off columns (ALTER)
--
-- `ai_handling` is the "is the bot still driving this thread?" flag.
-- Defaults TRUE so a freshly-created conversation is eligible for the
-- assistant; set FALSE on escalation or the instant a human replies
-- (human-takeover detection in the send route). `ai_escalated_at` /
-- `ai_escalation_reason` record the hand-off for the inbox badge.
--
-- No change to the `status` CHECK: on escalation the engine also sets
-- status='pending', already an allowed value that reads as "needs
-- attention" in the inbox.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handling          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ai_escalated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_escalation_reason TEXT;

-- Surfaces the "🙋 Needs human" list filter: escalated conversations
-- still awaiting a human. Partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_conversations_ai_escalated
  ON conversations(account_id, ai_escalated_at)
  WHERE ai_escalated_at IS NOT NULL;

-- ============================================================
-- AI_REPLY_LOG — one row per AI decision (audit + future cost view)
--
-- Written by the webhook engine via the service-role client on every
-- evaluated inbound: a reply sent, an escalation, a pre-LLM skip, or
-- an error. `confident` is the model's self-report (NULL when the
-- decision was made before any LLM call — e.g. a keyword/cap skip).
-- The token + latency columns feed a future cost dashboard (§16); no
-- UI reads them in v1.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_reply_log (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  decision          TEXT NOT NULL CHECK (decision IN ('replied', 'escalated', 'skipped', 'error')),
  confident         BOOLEAN,
  reason            TEXT,
  model             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cache_read_tokens INTEGER,
  latency_ms        INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- account_id: the future cost view and the daily-cap count both scope
-- by account. The cap check counts today's `replied` rows, so a
-- composite on (account_id, created_at) WHERE decision='replied'
-- answers it from one index lookup.
CREATE INDEX IF NOT EXISTS idx_ai_reply_log_account
  ON ai_reply_log(account_id);
CREATE INDEX IF NOT EXISTS idx_ai_reply_log_account_replied
  ON ai_reply_log(account_id, created_at)
  WHERE decision = 'replied';

ALTER TABLE ai_reply_log ENABLE ROW LEVEL SECURITY;

-- RLS: admin-read, service-role-write (mirrors `automation_logs` in
-- 017). The webhook engine inserts with the service-role client,
-- which bypasses RLS — so there is no client INSERT/UPDATE/DELETE
-- policy.
DROP POLICY IF EXISTS ai_reply_log_select ON ai_reply_log;
CREATE POLICY ai_reply_log_select ON ai_reply_log FOR SELECT
  USING (is_account_member(account_id, 'admin'));

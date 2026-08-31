-- ============================================================
-- 040_ai_tools.sql — AI agent tool calling
--
-- Adds account-scoped "AI tools": HTTP calls (GET/POST/etc, with
-- optional auth) that the AI agent can invoke mid-conversation —
-- check availability, place an order, look up a status, and so on.
-- The agent decides WHEN to call a tool (guided by its `description`);
-- the actual request is built + fired server-side by
-- `src/lib/ai/tools/execute.ts`, which reuses the SSRF guard already
-- used for automations' `send_webhook` step
-- (`src/lib/webhooks/ssrf.ts: isDeliverableUrl`).
--
-- Design notes
--   - `ai_tools` is account-scoped, many-per-account (unlike
--     `ai_configs`'s one-per-account), mirroring `quick_replies` /
--     `webhook_endpoints` shape more than `ai_configs`.
--   - `auth_secret` is the caller's own bearer token / API key / basic
--     credential for the THIRD-PARTY endpoint. AES-256-GCM-encrypted at
--     rest with the same `encrypt()`/`decrypt()` used for
--     `ai_configs.api_key` and `webhook_endpoints.secret`; decrypted
--     only at call time, never returned to the client after save.
--   - `parameters` is a JSON array the agent's tool schema AND the
--     request builder both read: `[{name, in, type, description,
--     required, enum?}]` — `in` is one of query|body|path|header.
--   - RLS mirrors `ai_configs` (029_ai_reply.sql): any member can read
--     (the Tools tab list + the agent runtime both need it), but only
--     admin+ may create/update/delete — these rows carry a live
--     external credential.
--
-- Also widens `messages.content_type` to add `'tool_call'` (same
-- drop/re-add idiom `010_flows.sql` used for `'interactive'`) and adds
-- `tool_call_payload` (same pattern as `interactive_payload`, added in
-- 035) so a tool invocation + its result can be persisted as an
-- ordinary message row and show up inline in the existing inbox
-- thread through the existing realtime pipeline — no new channel.
-- `content_text` on these rows is a short human-readable fallback; the
-- full detail (request/response, secrets redacted) lives in
-- `tool_call_payload`. These rows are never fed back into the model as
-- prior turns — `buildConversationContext` already filters
-- `content_type = 'text'`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_tools (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name              text NOT NULL CHECK (name ~ '^[a-z0-9_]{1,64}$'),
  description       text NOT NULL CHECK (char_length(description) > 0),
  method            text NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  url               text NOT NULL,
  headers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_type         text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key', 'basic')),
  auth_header_name  text,
  auth_secret       text,                     -- AES-256-GCM-encrypted; null when auth_type = 'none'
  parameters        jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeout_ms        integer NOT NULL DEFAULT 8000 CHECK (timeout_ms BETWEEN 1000 AND 20000),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ai_tools_account ON ai_tools(account_id);

ALTER TABLE ai_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_tools_select ON ai_tools;
CREATE POLICY ai_tools_select ON ai_tools FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_tools_insert ON ai_tools;
CREATE POLICY ai_tools_insert ON ai_tools FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_tools_update ON ai_tools;
CREATE POLICY ai_tools_update ON ai_tools FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_tools_delete ON ai_tools;
CREATE POLICY ai_tools_delete ON ai_tools FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_tools_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_tools_updated_at ON ai_tools;
CREATE TRIGGER ai_tools_updated_at
  BEFORE UPDATE ON ai_tools
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_tools_updated_at();

-- ============================================================
-- Tool-call visibility inline in the existing message thread.
-- ============================================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'tool_call'
  ));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS tool_call_payload jsonb;

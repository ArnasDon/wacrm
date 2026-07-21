-- ============================================================
-- 030_whatsapp_webhook_replay_guard.sql
--
-- Inbound WhatsApp webhook replay protection.
--
-- Why this exists:
--   - Z-API callbacks are authenticated with an account-specific secret
--     in the callback URL. That authenticates the sender but does not make
--     retries / duplicate deliveries idempotent for our application state.
--   - The webhook route responds before `after(...)` finishes, so we
--     need a small replay ledger that can lock an event in
--     `processing`, flip it to `processed` only after the async work
--     finishes, and be released if that async work throws.
--
-- Shape:
--   - unique (session_name, event, dedupe_key) is the fast replay gate
--   - `status` distinguishes in-flight vs completed deliveries
--   - `expires_at` bounds retention so the route can opportunistically
--     delete old keys without scanning the full table
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_webhook_replays (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_name           TEXT NOT NULL,
  event                  TEXT NOT NULL,
  dedupe_key             TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed')),
  request_id             TEXT,
  hmac_algorithm         TEXT,
  signature_timestamp_ms BIGINT,
  payload_timestamp_ms   BIGINT,
  body_sha256            TEXT NOT NULL,
  processed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at             TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_webhook_replays_session_event_key
  ON whatsapp_webhook_replays (session_name, event, dedupe_key);

CREATE INDEX IF NOT EXISTS whatsapp_webhook_replays_expires_at_idx
  ON whatsapp_webhook_replays (expires_at);

ALTER TABLE whatsapp_webhook_replays ENABLE ROW LEVEL SECURITY;

COMMIT;

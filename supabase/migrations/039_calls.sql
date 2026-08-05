-- ============================================================
-- 039_calls.sql — Call logs (voice, Telnyx) + call-recordings bucket
--
-- Adds the `calls` table: a subset of policyjar's `calls` schema,
-- scoped to `account_id` and stripped of ACD/IVR/whisper/campaign
-- columns (single-user personal CRM). Every inbound/outbound leg
-- tracked by the Telnyx webhook lands here.
--
-- Write model
--   - INSERT of outbound rows: the authenticated `/api/telnyx/call`
--     route via `ctx.supabase` — executes `calls_insert` (agent+).
--   - INSERT/UPDATE of lifecycle rows: the webhook with the
--     service-role (admin-client) client, which bypasses RLS.
--     The client never UPDATEs — prevents forging logs.
--
-- Storage: `call-recordings` is the system's ONLY non-public bucket
-- (privacy). Uploads and signed-URL reads happen with service_role
-- only — no client RLS policies. MIME list left open on purpose
-- (Telnyx recording formats vary: wav/mp3/ogg).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS calls (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id             uuid REFERENCES contacts(id) ON DELETE SET NULL,
  direction              text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status                 text NOT NULL DEFAULT 'initiated'
                         CHECK (status IN ('initiated','ringing','answered','ended','failed')),
  from_number            text NOT NULL,                  -- E.164
  to_number              text NOT NULL,                  -- E.164
  initiated_at           timestamptz NOT NULL DEFAULT now(),
  answered_at            timestamptz,
  ended_at               timestamptz,
  duration_sec           integer,                        -- calculado: ended_at - answered_at
  hangup_cause           text,                           -- user_busy, normal, etc. (de Telnyx)
  disposition            text
                         CHECK (disposition IN ('completed','missed')),  -- completed | missed
  recording_url          text,                           -- URL firmada (Storage call-recordings)
  telnyx_call_control_id text UNIQUE,                    -- leg control
  telnyx_call_leg_id     text,
  telnyx_call_session_id text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- "Recent" list (calls DESC) and per-contact history.
CREATE INDEX IF NOT EXISTS idx_calls_account_initiated ON calls (account_id, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON calls (contact_id);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Reading: viewer+. Writing: agent+ (INSERT only via ctx.supabase;
-- lifecycle UPDATEs are webhook/service-role only).
DROP POLICY IF EXISTS calls_select ON calls;
CREATE POLICY calls_select ON calls FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS calls_insert ON calls;
CREATE POLICY calls_insert ON calls FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- Storage — call-recordings (PRIVATE, único bucket no-público)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  FALSE,                       -- privado: no getPublicUrl, solo signed URL
  104857600,                   -- 100 MB por grabación (holgura)
  NULL                         -- sin restricción de MIME (wav/mp3/ogg según Telnyx)
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Sin policies de cliente: el webhook sube con service_role (bypassa
-- RLS) y las lecturas van por `createSignedUrl` (service_role). Un
-- cliente nunca toca storage.objects de este bucket.
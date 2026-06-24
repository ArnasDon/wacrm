-- ============================================================
-- 027_whatsapp_calling.sql — WhatsApp Business Calling (inbound voice)
--
-- Adds `call_logs`, one row per voice call between the business
-- number and a contact over the WhatsApp Business Calling API
-- (VoIP / WebRTC, Meta 2025). v1 is inbound-only (user-initiated);
-- the `direction` + `outbound`-capable statuses are present now so
-- the later business-initiated phase needs no schema change.
--
-- Modelled as a CHILD of `conversations` (like `messages`): RLS is
-- enforced by joining to the parent conversation and checking
-- `is_account_member`. `account_id` is denormalised onto the row so
-- (a) "list my account's calls" is a single-table index scan and
-- (b) Supabase Realtime can filter on it (Realtime can't join).
--
-- The customer's SDP offer (and its type) are stored on the row so
-- the browser softphone can complete the WebRTC handshake after the
-- agent clicks Answer. Webhook (service-role) inserts/updates bypass
-- RLS, exactly as the message-delivery path does.
--
-- Status lifecycle:
--   inbound : ringing -> (connected -> completed) | missed | declined | failed
--   outbound: initiated -> ringing -> connected -> completed | failed   (later phase)
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Tenancy (denormalised — see header). FK mirrors every other
  -- account-scoped table from migration 017.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Parent conversation + contact. A call always belongs to the
  -- conversation with the WhatsApp user it is placed to/from.
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- Meta's call identifier (`call.id` from the webhook / the id we get
  -- back when initiating). Unique per account so duplicate webhook
  -- deliveries upsert the same row instead of inserting twice.
  meta_call_id TEXT,

  direction TEXT NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound')),

  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN (
      'initiated', 'ringing', 'connected',
      'completed', 'missed', 'declined', 'failed'
    )),

  -- WebRTC handshake material. For an inbound call Meta sends an SDP
  -- offer on the `connect` event; the softphone answers it.
  offer_sdp TEXT,
  sdp_type TEXT CHECK (sdp_type IN ('offer', 'answer')),

  -- Which agent answered (NULL until answered / for missed calls).
  -- SET NULL on user delete so a removed teammate doesn't erase the
  -- call history — matches the assignment/audit columns elsewhere.
  answered_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Timing. `duration_seconds` is derived (answered_at -> ended_at)
  -- and written by the terminate handler so list views don't compute.
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Meta's termination reason / our error string, for debugging.
  end_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per Meta call within an account (idempotent webhook upsert).
-- Partial: meta_call_id is NULL only in the brief window before an
-- outbound call gets its id back, so don't constrain those.
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_logs_account_meta_call
  ON call_logs(account_id, meta_call_id)
  WHERE meta_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_account
  ON call_logs(account_id);

CREATE INDEX IF NOT EXISTS idx_call_logs_conversation
  ON call_logs(conversation_id);

CREATE INDEX IF NOT EXISTS idx_call_logs_contact
  ON call_logs(contact_id);

-- Hot path: the incoming-call alert + active-call widget query for
-- live calls. Partial index keeps it tiny (most rows are terminal).
CREATE INDEX IF NOT EXISTS idx_call_logs_active
  ON call_logs(account_id, status)
  WHERE status IN ('initiated', 'ringing', 'connected');

-- updated_at maintenance — reuse the shared trigger fn (migration 001).
DROP TRIGGER IF EXISTS set_updated_at ON call_logs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON call_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS — child-of-conversations semantics (mirrors `messages`)
--   - members (viewer+) may read their account's calls
--   - agents+ may write (answer/decline/terminate via the API routes)
--   - the service-role webhook bypasses RLS for Meta-driven inserts
-- ============================================================
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_logs_select ON call_logs;
CREATE POLICY call_logs_select ON call_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = call_logs.conversation_id
      AND is_account_member(c.account_id)
  )
);

DROP POLICY IF EXISTS call_logs_modify ON call_logs;
CREATE POLICY call_logs_modify ON call_logs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = call_logs.conversation_id
      AND is_account_member(c.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = call_logs.conversation_id
      AND is_account_member(c.account_id, 'agent')
  )
);

-- Realtime — the inbox subscribes to call_logs (incoming-call alert,
-- live status). Filtered by account_id / conversation_id client-side.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'call_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_logs;
  END IF;
END $$;

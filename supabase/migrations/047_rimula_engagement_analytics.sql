-- ============================================================
-- 047_rimula_engagement_analytics.sql — EngagementEvent,
-- ProductInteraction (§9.0/§9.1, §13, §16)
--
--   1. engagement_events   — funnel/dashboard event log:
--      DELIVERED, READ, REACTION, REPLY, CLICK, LEAD, TRIAL,
--      CONVERSION (§9.1's exact `eventType` set). §16 says to add
--      these writes into the *existing* inbound/broadcast pipelines
--      rather than build a parallel ingestion path — this table is
--      that landing zone.
--   2. product_interactions — the narrower PRODUCT → CAMPAIGN →
--      CONTENT → CUSTOMER → LEAD → TRIAL → CONVERSION attribution
--      trail (§13), one row per (contact, product) touch.
--
-- Both are analytics/audit tables, not something a client edits after
-- the fact — same posture as `automation_logs` (migration 006) and
-- `ai_usage_log` (migration 033): any account member may *read* (the
-- dashboard needs this), but there is no client INSERT/UPDATE/DELETE
-- policy. Rows land here from the demo/real WhatsApp pipeline and the
-- broadcast/webhook code paths, which all run under the service-role
-- client (service role bypasses RLS, same as every other
-- server-authored table in this schema) — a later phase wires those
-- write paths; this migration only lays the schema + read policy.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. engagement_events
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  post_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'DELIVERED', 'READ', 'REACTION', 'REPLY', 'CLICK', 'LEAD', 'TRIAL', 'CONVERSION'
  )),
  event_value NUMERIC(12,2),
  source TEXT,
  -- Redact PII here the same way flow_run_events does (migration
  -- 010's header: "stores reply length, not customer text") — never
  -- write raw customer message content into this column.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_account_occurred
  ON engagement_events(account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_account_type
  ON engagement_events(account_id, event_type);
CREATE INDEX IF NOT EXISTS idx_engagement_events_campaign ON engagement_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_engagement_events_member ON engagement_events(member_id);

ALTER TABLE engagement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engagement_events_select ON engagement_events;
CREATE POLICY engagement_events_select ON engagement_events FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy for `authenticated` — written by the
-- service role only (see header).

-- ============================================================
-- 2. product_interactions
-- ============================================================
CREATE TABLE IF NOT EXISTS product_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'viewed', 'clicked', 'enquiry', 'interest', 'trial_request', 'lead', 'conversion'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_interactions_account_created
  ON product_interactions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_interactions_product ON product_interactions(product_id);
CREATE INDEX IF NOT EXISTS idx_product_interactions_campaign ON product_interactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_product_interactions_contact ON product_interactions(contact_id);

ALTER TABLE product_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_interactions_select ON product_interactions;
CREATE POLICY product_interactions_select ON product_interactions FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy for `authenticated` — same rationale
-- as engagement_events above.

-- ============================================================
-- 049_meta_conversions_api.sql — Meta Conversions API (CRM
-- integration) for ad-originated leads.
--
-- Complements 048's round-robin: every click that lands on
-- /api/leads/redirect already gets logged into `ad_leads` with the
-- click's utm/origin. This migration adds, per organization, the
-- credentials needed to report a "Lead" server event back to Meta
-- (Dataset ID + an encrypted Access Token generated in Events
-- Manager → CRM integration), plus a switch to turn it on/off.
--
-- Scope (deliberately narrow, per the store owner's own choice):
-- only the initial "Lead" event fires, at the moment the ad click is
-- assigned to a seller — not every later pipeline stage change. That
-- keeps this to one clear trigger point (leads/redirect route) rather
-- than hooking every deals/stage-change code path.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS meta_capi_dataset_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_capi_access_token TEXT, -- encrypted, see src/lib/whatsapp/encryption.ts
  ADD COLUMN IF NOT EXISTS meta_capi_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- fbclid (Meta's click-id query param) arrives on the ad-click URL
-- alongside the utm_* params leads/redirect already captures — stored
-- in the same `utm` jsonb column on ad_leads (key "fbc", already in
-- Meta's documented `fb.1.<ts>.<fbclid>` shape) rather than a new
-- column, since it's exactly the same "extra context captured at
-- click time" the utm jsonb already exists for.

-- ============================================================
-- 038_ad_platforms
--
-- Connect an ad account, sync its campaigns and daily spend, and
-- resolve the ad ids captured by migration 037 into campaigns.
--
-- Four tables, each doing one job:
--
--   ad_accounts     — the connection (one per platform per account).
--                     Token is encrypted the same way whatsapp_config
--                     encrypts its access token (AES-GCM, see
--                     src/lib/whatsapp/encryption.ts) — same threat
--                     model: a row leak (backup, RLS bug) must not
--                     hand over a live credential.
--
--   ad_campaigns    — one row per Meta campaign (or a manually-added
--                     row for a platform with no API, e.g. Google).
--                     `is_manual` distinguishes the two so the UI
--                     knows whether "spend" is synced or typed in.
--
--   ad_entities     — the ad -> campaign map. This is the missing
--                     link: attribution_events and contacts only ever
--                     learn an *ad* id from the webhook referral; nothing
--                     in the WhatsApp API says what campaign that ad
--                     belongs to. The sync asks the Marketing API and
--                     stores the answer here, once per ad, so campaign
--                     rollups don't need a live API call per lead.
--
--   ad_metrics_daily — one row per campaign per day: spend, impressions,
--                     clicks. UNIQUE(campaign_id, date) makes the sync
--                     idempotent — re-running it for a date range
--                     overwrites that day's numbers instead of adding
--                     a second copy, which matters because Meta revises
--                     a day's spend for a short window after it ends.
--
-- All four are account-scoped and RLS-gated the same way as every
-- other table since migration 017: is_account_member(account_id) for
-- reads, admin+ for anything that changes the connection or campaign
-- list. Nothing here is client-writable for ad_metrics_daily except
-- manual entries — the API sync writes through the service-role
-- client, same as the WhatsApp webhook.
-- ============================================================

-- ============================================================
-- AD ACCOUNTS (the connection)
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google', 'other')),
  -- Meta: "act_<id>". Free-form for other platforms.
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- The currency Meta (or the operator, for manual platforms) reports
  -- spend in. Compared against accounts.default_currency at read time
  -- to decide whether ROI can be shown as a number or only as a
  -- warning — there is no FX conversion (migration 021's precedent).
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- NULL for a manual-only platform (nothing to authenticate).
  access_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error')),
  -- Human-readable detail on the last sync/connect failure, shown in
  -- Settings. NULL when status = 'connected' and nothing has failed.
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_accounts_account
  ON ad_accounts(account_id);

ALTER TABLE ad_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_accounts_select ON ad_accounts;
CREATE POLICY ad_accounts_select ON ad_accounts FOR SELECT
  USING (is_account_member(account_id));

-- Connecting/editing/removing an ad platform is an account-wide
-- setting, same bar as whatsapp_config and api_keys: admin+.
DROP POLICY IF EXISTS ad_accounts_insert ON ad_accounts;
CREATE POLICY ad_accounts_insert ON ad_accounts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ad_accounts_update ON ad_accounts;
CREATE POLICY ad_accounts_update ON ad_accounts FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ad_accounts_delete ON ad_accounts;
CREATE POLICY ad_accounts_delete ON ad_accounts FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  -- Meta campaign id for a synced row. For a manually-added campaign
  -- (Google, a bare tracked link — Phase 3) this is operator-chosen
  -- text, namespaced by ad_account_id so it can't collide with a real
  -- Meta id.
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT,
  effective_status TEXT,
  daily_budget NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- True for a campaign the operator typed in rather than one the
  -- Meta sync discovered — drives "Sync" vs "Edit spend" in the UI.
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ad_account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_account
  ON ad_campaigns(account_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_ad_account
  ON ad_campaigns(ad_account_id);

ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_campaigns_select ON ad_campaigns;
CREATE POLICY ad_campaigns_select ON ad_campaigns FOR SELECT
  USING (is_account_member(account_id));

-- Only manual campaigns are ever client-inserted (a synced campaign
-- is created by the service-role sync). The CHECK enforces that at
-- the database level rather than trusting the client not to lie.
DROP POLICY IF EXISTS ad_campaigns_insert ON ad_campaigns;
CREATE POLICY ad_campaigns_insert ON ad_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin') AND is_manual = TRUE);

DROP POLICY IF EXISTS ad_campaigns_update ON ad_campaigns;
CREATE POLICY ad_campaigns_update ON ad_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ad_campaigns_delete ON ad_campaigns;
CREATE POLICY ad_campaigns_delete ON ad_campaigns FOR DELETE
  USING (is_account_member(account_id, 'admin') AND is_manual = TRUE);

-- ============================================================
-- AD -> CAMPAIGN MAP
--
-- One row per ad the sync has seen, whether or not it resolved. A
-- failed resolution (deleted ad, permissions issue) still gets a row
-- with campaign_id = NULL and last_error set, so the sync doesn't
-- retry the same broken ad on every run.
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  last_error TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_entities_campaign
  ON ad_entities(campaign_id);

ALTER TABLE ad_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_entities_select ON ad_entities;
CREATE POLICY ad_entities_select ON ad_entities FOR SELECT
  USING (is_account_member(account_id));

-- No client write policy — populated exclusively by the sync through
-- the service-role client, like attribution_events.

-- ============================================================
-- DAILY METRICS
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_metrics_daily (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  -- Meta's own count of conversations started from this campaign
  -- (the `actions` insight, type onsite_conversion.messaging_conversation_started_7d).
  -- Kept alongside the CRM's own contact count rather than merged with
  -- it — the two use different attribution windows and will not
  -- always agree; showing both is more honest than picking one.
  messaging_started INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  origin TEXT NOT NULL DEFAULT 'api' CHECK (origin IN ('api', 'manual')),
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ad_metrics_daily_account_date
  ON ad_metrics_daily(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_daily_campaign_date
  ON ad_metrics_daily(campaign_id, date DESC);

ALTER TABLE ad_metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_metrics_daily_select ON ad_metrics_daily;
CREATE POLICY ad_metrics_daily_select ON ad_metrics_daily FOR SELECT
  USING (is_account_member(account_id));

-- Manual entry (a Google campaign's spend, typed in) is the one
-- client-writable path; API-synced rows come from the service-role
-- sync and bypass RLS entirely.
DROP POLICY IF EXISTS ad_metrics_daily_insert ON ad_metrics_daily;
CREATE POLICY ad_metrics_daily_insert ON ad_metrics_daily FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin') AND origin = 'manual');

DROP POLICY IF EXISTS ad_metrics_daily_update ON ad_metrics_daily;
CREATE POLICY ad_metrics_daily_update ON ad_metrics_daily FOR UPDATE
  USING (is_account_member(account_id, 'admin') AND origin = 'manual');

DROP POLICY IF EXISTS ad_metrics_daily_delete ON ad_metrics_daily;
CREATE POLICY ad_metrics_daily_delete ON ad_metrics_daily FOR DELETE
  USING (is_account_member(account_id, 'admin') AND origin = 'manual');

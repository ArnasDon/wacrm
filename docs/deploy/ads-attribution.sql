-- ============================================================
-- wacrm — ads attribution, ROI and salesperson assignment
-- Migrations 037 through 042, in order.
--
-- GENERATED FILE — do not edit. Regenerate with:
--   ./scripts/deploy/bundle-migrations.sh
--
-- HOW TO APPLY
--   1. Supabase Cloud -> SQL Editor -> New query.
--   2. Paste this whole file and run it.
--   3. THEN deploy the new app code (merge to main + redeploy).
--
-- Order matters, and this way round is the safe one: every change here
-- is additive (new tables, new columns with defaults), so the code
-- currently running in production keeps working against the new schema.
-- Deploying first would instead point the new code at tables that do
-- not exist yet.
--
-- Safe to re-run: tables use CREATE TABLE IF NOT EXISTS, columns use
-- ADD COLUMN IF NOT EXISTS, constraints and policies are dropped before
-- being recreated, and functions use CREATE OR REPLACE.
--
-- IF THE EDITOR STILL REPORTS A SYNTAX ERROR
--   It is splitting the script into statements and getting it wrong, not
--   objecting to the SQL. Run the file one section at a time: each
--   `-- ####` banner below starts a migration, and they are independent
--   in that order. The apostrophes in comments that caused this once
--   already are rewritten by the generator (see sanitize-comments.py).
--
-- One statement is not purely additive: 037 drops the 4-argument
-- filter_contacts_by_tags so it can be recreated with a 5th, defaulted
-- parameter. That is safe during the window before the redeploy,
-- because the app calls this function with *named* parameters and the
-- new p_source defaults to NULL — the old 4-argument calls still
-- resolve.
-- ============================================================


-- ############################################################
-- ##  037_attribution.sql
-- ############################################################

-- ============================================================
-- 037_attribution
--
-- Record where every lead came from.
--
-- Until now a contact carried no notion of origin: a lead that
-- arrived from a paid Click-to-WhatsApp ad was indistinguishable
-- from someone who typed the number off a business card. That makes
-- the obvious marketing questions unanswerable — what did this lead
-- cost, which campaign is actually producing sales, what is the ROI.
--
-- Meta already hands us the answer and we were dropping it on the
-- floor: an inbound message that originated from a Click-to-WhatsApp
-- ad carries a `referral` object whose `source_id` is the **ad id**
-- (plus `ctwa_clid`, the ad headline and the ad’s URL). The webhook
-- never read that field. This migration gives it somewhere to live.
--
-- Two places, on purpose:
--
--   1. `contacts.source*` — the **first touch**, denormalised onto the
--      contact so the common queries ("leads from campaign X this
--      month", "how many organic leads") are a plain indexed filter.
--      Written once and never overwritten: the campaign that earned
--      the lead keeps the credit even if the person later clicks
--      another ad.
--
--   2. `attribution_events` — an append-only log of **every** touch.
--      It costs almost nothing and buys two things the denormalised
--      columns cannot: re-attribution (at webhook time we only know
--      the ad id — the campaign it belongs to is resolved later
--      against the Marketing API) and a path to multi-touch
--      attribution without another migration.
--
-- `campaign_id` is deliberately nullable and untyped (TEXT, the Meta
-- id) — it is filled in asynchronously by the ads sync, which does
-- not exist yet. Nothing here depends on the ads tables, so this
-- migration stands on its own.
--
-- RLS: reads for any member; no client writes. Rows are created by
-- the webhook through the service-role client, exactly like messages.
-- ============================================================

-- ============================================================
-- FIRST-TOUCH COLUMNS ON contacts
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown',
  -- Meta ad id (referral.source_id). Kept even after the campaign is
  -- resolved so we can re-resolve if the mapping ever changes.
  ADD COLUMN IF NOT EXISTS source_ad_id TEXT,
  -- Filled in by the ads sync once ad -> campaign is resolved.
  ADD COLUMN IF NOT EXISTS source_campaign_id TEXT,
  -- Raw referral / link payload, for debugging and for fields we do
  -- not promote to columns (headline, media type, utm bag, ...).
  ADD COLUMN IF NOT EXISTS source_meta JSONB,
  ADD COLUMN IF NOT EXISTS source_captured_at TIMESTAMPTZ;

-- Keep the vocabulary closed but not an enum — a fork adding a source
-- should only have to touch this CHECK and the matching TS constant
-- in src/lib/attribution/sources.ts.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_source_check
  CHECK (source IN (
    'meta_ads',    -- Click-to-WhatsApp ad (captured automatically)
    'google_ads',  -- Google Ads (via a tracked link or set by hand)
    'organic',     -- wrote in on their own
    'web',         -- website / landing page
    'referral',    -- word of mouth
    'manual',      -- created by an agent (import, typed in)
    'other',
    'unknown'      -- not classified yet
  ));

CREATE INDEX IF NOT EXISTS idx_contacts_account_source
  ON contacts(account_id, source);

-- Partial: only attributed contacts participate in campaign rollups.
CREATE INDEX IF NOT EXISTS idx_contacts_account_campaign
  ON contacts(account_id, source_campaign_id, created_at DESC)
  WHERE source_campaign_id IS NOT NULL;

-- Lets the ads sync find contacts whose ad has not been mapped to a
-- campaign yet without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_contacts_unresolved_ad
  ON contacts(account_id, source_ad_id)
  WHERE source_ad_id IS NOT NULL AND source_campaign_id IS NULL;

-- ============================================================
-- ATTRIBUTION EVENT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS attribution_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- WhatsApp message id that carried the referral. Also the dedup key
  -- (see the unique index below).
  wamid TEXT,
  source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source IN (
      'meta_ads', 'google_ads', 'organic', 'web',
      'referral', 'manual', 'other', 'unknown'
    )),
  ad_id TEXT,
  campaign_id TEXT,
  ctwa_clid TEXT,
  headline TEXT,
  source_url TEXT,
  raw JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Meta retries webhook deliveries, and a retry replays the same
-- message id. Without this the same ad click would be logged twice
-- and inflate every "leads per campaign" count. Partial because
-- non-webhook sources (a tracked link, a manual reclassification)
-- have no wamid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attribution_events_wamid
  ON attribution_events(account_id, wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attribution_events_account_time
  ON attribution_events(account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_events_contact
  ON attribution_events(contact_id, occurred_at DESC);

-- Work queue for the ads sync: events whose ad is not mapped yet.
CREATE INDEX IF NOT EXISTS idx_attribution_events_unresolved
  ON attribution_events(account_id, ad_id)
  WHERE ad_id IS NOT NULL AND campaign_id IS NULL;

ALTER TABLE attribution_events ENABLE ROW LEVEL SECURITY;

-- SELECT: any member (viewer+) — this is reporting data.
-- No INSERT/UPDATE/DELETE policy: the webhook and the ads sync write
-- through the service-role client, which bypasses RLS. Keeping the
-- log append-only from the client’s point of view means a compromised
-- browser session cannot rewrite attribution history.
DROP POLICY IF EXISTS attribution_events_select ON attribution_events;
CREATE POLICY attribution_events_select ON attribution_events FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- TEACH THE TAG FILTER ABOUT SOURCES
--
-- The Contacts page resolves its tag filter server-side through
-- `filter_contacts_by_tags` (migration 025) so a tag covering many
-- contacts can’t truncate the result or break the total count. The
-- new source filter has to go through the same function: applying it
-- client-side on top of an already-paginated result would filter
-- *within* the current page and report a total that doesn’t match
-- what’s shown.
--
-- Adding a defaulted 5th parameter cannot be done with CREATE OR
-- REPLACE — it produces an overload, and then the existing 4-argument
-- calls become ambiguous ("function is not unique"). So drop the old
-- signature first. Idempotent: the DROP is a no-op on re-run.
-- ============================================================
DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_source TEXT DEFAULT NULL
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list and,
    -- when given, by lead source (AND — it narrows, it doesn’t widen).
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (p_source IS NULL OR c.source = p_source)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) TO authenticated;

-- ############################################################
-- ##  038_ad_platforms.sql
-- ############################################################

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
--                     rollups don’t need a live API call per lead.
--
--   ad_metrics_daily — one row per campaign per day: spend, impressions,
--                     clicks. UNIQUE(campaign_id, date) makes the sync
--                     idempotent — re-running it for a date range
--                     overwrites that day’s numbers instead of adding
--                     a second copy, which matters because Meta revises
--                     a day’s spend for a short window after it ends.
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
  -- warning — there is no FX conversion (migration 021’s precedent).
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- NULL for a manual-only platform (nothing to authenticate).
  access_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error')),
  -- Human-readable detail on the last sync/connect failure, shown in
  -- Settings. NULL when status = ’connected’ and nothing has failed.
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
  -- text, namespaced by ad_account_id so it can’t collide with a real
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
-- with campaign_id = NULL and last_error set, so the sync doesn’t
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
  -- Meta’s own count of conversations started from this campaign
  -- (the `actions` insight, type onsite_conversion.messaging_conversation_started_7d).
  -- Kept alongside the CRM’s own contact count rather than merged with
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

-- Manual entry (a Google campaign’s spend, typed in) is the one
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

-- ############################################################
-- ##  039_deal_closed_at.sql
-- ############################################################

-- ============================================================
-- 039_deal_closed_at
--
-- Add `deals.closed_at`, set exactly once when a deal is marked
-- won/lost, and never touched again by ordinary edits.
--
-- Why this can’t reuse `updated_at`: `updated_at` moves every time a
-- deal is edited — renaming a won deal, fixing a typo in its notes,
-- reassigning it to another rep, all bump it. `pipeline-analytics.tsx`
-- already leans on it as a "closed this month" proxy, which is
-- approximately right for a quiet deal but silently wrong the moment
-- someone touches a closed deal for an unrelated reason.
--
-- The ROI work about to land (src/lib/ads/roi.ts) makes this exact:
-- it sums the value of won deals attributed to a campaign, filtered
-- to a date range. Using `updated_at` there would let an unrelated
-- edit shift a deal’s revenue into a different month’s ROI, or in/out
-- of the requested range entirely. `closed_at` is the one column that
-- only ever means "when this deal was decided".
--
-- Backfill: for the existing ’won’/’lost’ rows, `updated_at` is the
-- best available approximation of when they closed (better than
-- `created_at`, which is when the deal was opened, or NULL, which
-- would exclude every historical deal from every ROI query until it’s
-- next touched). New closes get the accurate value going forward from
-- the write sites this migration’s companion code change updates.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE deals
SET closed_at = updated_at
WHERE status IN ('won', 'lost') AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_closed_at
  ON deals(account_id, closed_at)
  WHERE closed_at IS NOT NULL;

-- ############################################################
-- ##  040_tracked_links.sql
-- ############################################################

-- ============================================================
-- 040_tracked_links
--
-- Attribution for channels that don’t hand us a referral of their
-- own: Google Ads, a landing page, a printed flyer. Meta gives us an
-- ad id on the first inbound message for free (migration 037); none
-- of these do. A tracked link is how we get the same signal manually:
-- `crm.agenciakibo.com/l/<slug>` redirects to a pre-filled
-- `wa.me/<number>?text=...` whose text carries a short opaque code
-- (`[#a1b2c3]`, see src/lib/attribution/ref-token.ts). The webhook
-- looks for that code on the first message when there’s no Meta
-- referral, and attributes the lead the same way (migration 037’s
-- `attribution_events` + `contacts.source*`, first-touch).
--
-- `slug` doubles as the code embedded in the message — one identifier,
-- not two — and is globally unique (not per-account) because the
-- public /l/<slug> route has no account context to scope by; it has
-- to find the right account from the slug alone.
--
-- `campaign_id` is optional: a link can point at a specific manually
-- entered campaign (so its clicks/leads roll into that campaign’s ROI)
-- or stand alone as a bare source label with no campaign underneath
-- (e.g. a generic "organic" link for a print flyer).
--
-- No FK to whatsapp_config for the destination number: wacrm stores
-- no display_phone_number column (it’s fetched live from Meta when
-- needed), and the redirect route must not depend on a live Meta call
-- to stay fast and available. The operator enters the number once,
-- same as they would when generating a wa.me link by hand.
-- ============================================================

CREATE TABLE IF NOT EXISTS tracked_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('google_ads', 'web', 'organic', 'other')),
  campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  -- E.164, digits-only preferred (the redirect builds wa.me/<this>).
  whatsapp_number TEXT NOT NULL,
  message_template TEXT NOT NULL DEFAULT '',
  clicks INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_links_account
  ON tracked_links(account_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_campaign
  ON tracked_links(campaign_id)
  WHERE campaign_id IS NOT NULL;

ALTER TABLE tracked_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracked_links_select ON tracked_links;
CREATE POLICY tracked_links_select ON tracked_links FOR SELECT
  USING (is_account_member(account_id));

-- Creating/editing/removing a tracked link is a workspace setting,
-- same bar as ad_campaigns: admin+.
DROP POLICY IF EXISTS tracked_links_insert ON tracked_links;
CREATE POLICY tracked_links_insert ON tracked_links FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tracked_links_update ON tracked_links;
CREATE POLICY tracked_links_update ON tracked_links FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tracked_links_delete ON tracked_links;
CREATE POLICY tracked_links_delete ON tracked_links FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- The public redirect route reads by slug with the service-role
-- client (no session — a customer clicking the link isn’t signed in),
-- so it bypasses RLS entirely; the SELECT policy above is only what a
-- signed-in dashboard user sees.

-- ============================================================
-- ATOMIC CLICK COUNTER
--
-- The redirect route has no session and no read-modify-write step to
-- spare — supabase-js has no `clicks = clicks + 1` update expression,
-- and a JS-side read-then-write would race two simultaneous clicks
-- (a real possibility right when an ad goes live). A single UPDATE
-- does the increment atomically; SECURITY DEFINER so the service-role
-- caller doesn’t need a bespoke RLS carve-out just for this counter.
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_tracked_link_clicks(p_link_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tracked_links
  SET clicks = clicks + 1, last_clicked_at = NOW()
  WHERE id = p_link_id;
$$;

ALTER FUNCTION public.increment_tracked_link_clicks(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.increment_tracked_link_clicks(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_tracked_link_clicks(UUID) TO service_role;

-- ############################################################
-- ##  041_deal_assignment.sql
-- ############################################################

-- ============================================================
-- 041_deal_assignment
--
-- Notify a teammate when a deal is assigned to them — the deal-side
-- counterpart to `notify_conversation_assigned` (migration 027).
--
-- Two differences from that trigger, both from how the two tables are
-- shaped:
--
--   1. `conversations.assigned_agent_id` stores an `auth.users.id`
--      directly, so that trigger uses NEW.assigned_agent_id as
--      notifications.user_id as-is. `deals.assigned_to` instead
--      references `profiles(id)` (migration 002), so this trigger
--      resolves it to the assignee’s `profiles.user_id` first — that’s
--      the id `notifications.user_id` (an auth.users FK) actually needs.
--
--   2. No `deal_id` column is added to `notifications`. The click
--      handler on the Notifications page already deep-links via
--      `conversation_id` when present and otherwise just marks the row
--      read without navigating (see notifications/page.tsx) — this
--      trigger reuses that existing column when the deal happens to
--      have a linked conversation, rather than growing the schema for
--      a dedicated deals deep-link.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'deal_assigned'));

CREATE OR REPLACE FUNCTION notify_deal_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignee_user_id UUID;
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_to IS NULL
       OR NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assigned_to;
  -- assigned_to pointing at no resolvable profile (stale FK, cross-account
  -- data) — nothing sane to notify.
  IF v_assignee_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = v_assignee_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
    FROM contacts WHERE id = NEW.contact_id;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    v_assignee_user_id,
    'deal_assigned',
    NEW.conversation_id,
    NEW.contact_id,
    auth.uid(),
    'New deal assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a deal: ' ||
      COALESCE(NULLIF(NEW.title, ''), 'Untitled deal') ||
      CASE WHEN v_contact_name IS NOT NULL THEN ' (' || v_contact_name || ')' ELSE '' END
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create deal-assignment notification for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_deal_assigned() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_assigned ON deals;
CREATE TRIGGER on_deal_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_deal_assigned();

-- ############################################################
-- ##  042_ads_hardening.sql
-- ############################################################

-- ============================================================
-- 042_ads_hardening
--
-- Three corrections to the ads subsystem (037-041), all found by
-- reviewing the code rather than by it failing — because each one only
-- misbehaves once a day has passed, which same-day testing never sees.
--
--   1. Retry bookkeeping for ad resolution. Migration 038’s comment
--      claimed a failed resolution "doesn’t retry the same broken ad on
--      every run" — true, but it never retries it *at all*, because the
--      sync skipped any ad_id that had a row in ad_entities regardless
--      of why. A transient Graph API error, a rate-limit, or the very
--      common "ad resolved but its campaign isn’t synced yet" therefore
--      stranded that ad permanently: its contacts kept
--      source_campaign_id = NULL and never appeared in the campaign’s
--      leads or revenue. `attempts` + `last_attempt_at` let the sync
--      back off and give up deliberately instead of by accident.
--
--   2. The ad account’s own timezone. Meta reports insight dates in the
--      ad account’s timezone, the operator reads the /campaigns page in
--      the browser’s, and the server writes in its own — three clocks
--      that will not always agree. Storing the one Meta uses lets
--      Settings show the mismatch instead of quietly presenting numbers
--      that look off by a day for no visible reason.
--
--   3. A missing WITH CHECK. `ad_metrics_daily_update` (038) restricts
--      which rows an admin may update but not what they may write, so
--      an API-synced row could be flipped to origin = ’manual’ and
--      hand-edited. The INSERT policy already enforces manual-only;
--      this makes UPDATE agree with it.
-- ============================================================

-- ============================================================
-- 1. RETRY BOOKKEEPING
--
-- `resolved_at` keeps meaning "when this ad actually resolved" — it is
-- not overloaded as "when we last tried", which is what
-- `last_attempt_at` is for. Existing rows start at 0 attempts so they
-- get a fresh chance under the new policy: rows stranded by the old
-- behaviour are exactly the ones worth retrying once this ships.
-- ============================================================
ALTER TABLE ad_entities
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- The sync’s per-run scan is "unresolved ads for this account". Partial
-- index because resolved rows are the vast majority over time and are
-- never scanned by it.
CREATE INDEX IF NOT EXISTS idx_ad_entities_unresolved
  ON ad_entities(account_id)
  WHERE campaign_id IS NULL;

-- ============================================================
-- 2. AD ACCOUNT TIMEZONE
--
-- From Meta’s `timezone_name` on the ad account (e.g. ’America/Lima’).
-- Nullable: manual platforms (Google, other) have no such concept, and
-- Meta accounts connected before this migration only fill it on their
-- next reconnect.
-- ============================================================
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- ============================================================
-- 3. MANUAL-ONLY WRITES ON UPDATE
-- ============================================================
DROP POLICY IF EXISTS ad_metrics_daily_update ON ad_metrics_daily;
CREATE POLICY ad_metrics_daily_update ON ad_metrics_daily FOR UPDATE
  USING (is_account_member(account_id, 'admin') AND origin = 'manual')
  WITH CHECK (is_account_member(account_id, 'admin') AND origin = 'manual');

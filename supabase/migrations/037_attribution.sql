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
-- (plus `ctwa_clid`, the ad headline and the ad's URL). The webhook
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
-- log append-only from the client's point of view means a compromised
-- browser session cannot rewrite attribution history.
DROP POLICY IF EXISTS attribution_events_select ON attribution_events;
CREATE POLICY attribution_events_select ON attribution_events FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- TEACH THE TAG FILTER ABOUT SOURCES
--
-- The Contacts page resolves its tag filter server-side through
-- `filter_contacts_by_tags` (migration 025) so a tag covering many
-- contacts can't truncate the result or break the total count. The
-- new source filter has to go through the same function: applying it
-- client-side on top of an already-paginated result would filter
-- *within* the current page and report a total that doesn't match
-- what's shown.
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
    -- when given, by lead source (AND — it narrows, it doesn't widen).
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

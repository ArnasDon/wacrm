-- ============================================================
-- 040_tracked_links
--
-- Attribution for channels that don't hand us a referral of their
-- own: Google Ads, a landing page, a printed flyer. Meta gives us an
-- ad id on the first inbound message for free (migration 037); none
-- of these do. A tracked link is how we get the same signal manually:
-- `crm.agenciakibo.com/l/<slug>` redirects to a pre-filled
-- `wa.me/<number>?text=...` whose text carries a short opaque code
-- (`[#a1b2c3]`, see src/lib/attribution/ref-token.ts). The webhook
-- looks for that code on the first message when there's no Meta
-- referral, and attributes the lead the same way (migration 037's
-- `attribution_events` + `contacts.source*`, first-touch).
--
-- `slug` doubles as the code embedded in the message — one identifier,
-- not two — and is globally unique (not per-account) because the
-- public /l/<slug> route has no account context to scope by; it has
-- to find the right account from the slug alone.
--
-- `campaign_id` is optional: a link can point at a specific manually
-- entered campaign (so its clicks/leads roll into that campaign's ROI)
-- or stand alone as a bare source label with no campaign underneath
-- (e.g. a generic "organic" link for a print flyer).
--
-- No FK to whatsapp_config for the destination number: wacrm stores
-- no display_phone_number column (it's fetched live from Meta when
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
-- client (no session — a customer clicking the link isn't signed in),
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
-- caller doesn't need a bespoke RLS carve-out just for this counter.
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

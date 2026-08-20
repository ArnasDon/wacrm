-- ============================================================
-- 075_campaigns.sql — evolve Broadcasts into Campaigns.
--
-- Deliberately NOT a new send engine or a parallel table set.
-- `broadcasts` / `broadcast_recipients` (migration 001) stay the
-- planning + delivery record; this migration only:
--
--   1. Adds `description` (Campaigns wants a short planning note the
--      old Broadcasts UI never had).
--   2. Widens `broadcasts.status` with 'ready' (audience + template
--      picked, recipients materialized, not yet sent — the state the
--      new "review recipients before sending" step produces) and
--      'cancelled' (a draft/ready campaign the user decided not to
--      run). 'scheduled' is kept for wire compatibility even though
--      nothing currently schedules a send.
--   3. De-dupes any pre-existing `broadcast_recipients` rows and adds
--      a UNIQUE(broadcast_id, contact_id) constraint — the hard
--      backend guarantee that a lead can't be inserted into the same
--      campaign twice (section 5 of the spec: constraints, not just
--      frontend guards). Callers now insert with
--      `.upsert(..., { onConflict: 'broadcast_id,contact_id',
--      ignoreDuplicates: true })`, making a page reload / repeated
--      click / retried request a no-op instead of a duplicate row.
--   4. Adds an index on `broadcast_recipients.contact_id` — the
--      "which campaigns has this lead received" lookup (section 4)
--      was previously an unindexed scan.
--   5. `get_contact_campaign_history` — one RPC answering "which
--      campaigns did this contact receive, and what happened", scoped
--      by RLS same as everything else (SECURITY INVOKER).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 1. description
-- ------------------------------------------------------------
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS description TEXT;

-- Media-header templates need a URL at send time (see broadcast-core.ts
-- / use-broadcast-sending.ts). Previously that value only ever lived in
-- wizard component state, so a 'ready' campaign saved for later (or a
-- resumed/reloaded send) had no way to recover it. Persist it with the
-- campaign so "review, then send later" and "resume after reload" both
-- work for media-header templates too.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS header_media_url TEXT;

-- ------------------------------------------------------------
-- 2. status: add 'ready' + 'cancelled'.
-- ------------------------------------------------------------
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN ('draft', 'ready', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'));

-- ------------------------------------------------------------
-- 3. De-dupe existing broadcast_recipients, then enforce uniqueness.
--    Keep the row most likely to hold real send history (earliest —
--    it's the one the aggregate trigger and the webhook status
--    matcher have been updating); drop later accidental duplicates.
--
--    A plain (non-partial) UNIQUE CONSTRAINT, not a partial index:
--    Postgres's standard NULL semantics already let multiple
--    contact_id = NULL rows coexist under a plain unique constraint
--    (NULL is never equal to NULL), so a `WHERE contact_id IS NOT
--    NULL` partial index isn't needed for that — and a partial index
--    can't be targeted by `.upsert(..., { onConflict })`'s bare
--    `ON CONFLICT (broadcast_id, contact_id)` inference anyway
--    ("no unique or exclusion constraint matching the ON CONFLICT
--    specification"), which is what upsert-based dedup insert needs.
-- ------------------------------------------------------------
DELETE FROM broadcast_recipients br
USING broadcast_recipients dup
WHERE br.broadcast_id = dup.broadcast_id
  AND br.contact_id = dup.contact_id
  AND br.contact_id IS NOT NULL
  AND br.id > dup.id;

ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_broadcast_contact_unique;
ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_broadcast_contact_unique
  UNIQUE (broadcast_id, contact_id);

-- ------------------------------------------------------------
-- 4. contact_id lookup index (campaign history per lead).
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact
  ON broadcast_recipients(contact_id);

-- ------------------------------------------------------------
-- 5. get_contact_campaign_history — "which campaigns has this
--    contact received, and what happened". SECURITY INVOKER: RLS on
--    broadcasts/broadcast_recipients already scopes this to the
--    caller's account, same pattern as list_segments_with_counts
--    (migration 040).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_contact_campaign_history(p_contact_id UUID)
RETURNS TABLE (
  campaign_id UUID,
  campaign_name TEXT,
  template_name TEXT,
  campaign_status TEXT,
  recipient_status TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.name,
    b.template_name,
    b.status,
    br.status,
    br.sent_at,
    br.delivered_at,
    br.read_at,
    br.error_message,
    br.created_at
  FROM broadcast_recipients br
  JOIN broadcasts b ON b.id = br.broadcast_id
  WHERE br.contact_id = p_contact_id
  ORDER BY br.created_at DESC;
$$;

ALTER FUNCTION public.get_contact_campaign_history(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_contact_campaign_history(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_campaign_history(UUID) TO authenticated, service_role;

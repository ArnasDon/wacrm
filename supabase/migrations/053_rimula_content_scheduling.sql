-- ============================================================
-- 053_rimula_content_scheduling.sql — content-backed scheduled posts
-- (§9.0, §10)
--
-- §9.0: "broadcasts — Extend: language, campaignId, contentId,
-- approval status, scheduled time." `scheduled_at` already exists
-- (migration 001) but nothing in the app reads or writes it yet, and
-- `content_id`/`language` genuinely don't exist under any name —
-- confirmed by grepping the codebase, not assumed. `campaignId` and
-- "approval status" are NOT duplicated here: a scheduled post's
-- campaign is reachable via `content.campaign_id` (migration 046),
-- and its approval status is `content.status` itself (a broadcast is
-- only ever created from `Approved` content, enforced at the API
-- layer) — adding second copies of either would just be two sources
-- of truth to keep in sync.
--
-- `template_name` was `NOT NULL` because every existing broadcast
-- sends a Meta-approved template. A Content Studio post is free-text/
-- media, not a template, so a scheduled post's `broadcasts` row sets
-- `content_id` instead and leaves `template_name` null — the new
-- CHECK constraint requires at least one of the two, so a broadcast
-- can never be a "send nothing" row. (Real-Meta note, not a bug to
-- paper over here: WhatsApp's 24-hour customer-service-window rule
-- means a free-text content post to a contact outside that window
-- will be rejected by Meta the same way it always has been — Content
-- Studio does not get a template-messaging exemption Meta doesn't
-- grant. Demo Mode has no such window.)
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS language TEXT;

-- Same language domain as content_translations.language (046) — NULL
-- means "the content's own source-language body", not "no language".
ALTER TABLE broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_language_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_language_check
  CHECK (language IS NULL OR language IN ('ur', 'ps', 'pa', 'ur-Roman'));

ALTER TABLE broadcasts
  ALTER COLUMN template_name DROP NOT NULL;

ALTER TABLE broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_send_source_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_send_source_check
  CHECK (template_name IS NOT NULL OR content_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_broadcasts_content ON broadcasts(content_id);

-- The cron drain (GET /api/content/cron) scans exactly this slice —
-- due, still-pending scheduled posts — every run. A partial index
-- keyed on the predicate it actually filters by keeps that scan cheap
-- regardless of how many sent/failed broadcasts accumulate.
CREATE INDEX IF NOT EXISTS idx_broadcasts_due_scheduled
  ON broadcasts(scheduled_at)
  WHERE status = 'scheduled';

-- ============================================================
-- create_content_broadcast_with_recipients — the content-post sibling
-- of migration 037/038/052's create_broadcast_with_recipients.
--
-- Mirrors it exactly (atomic parent+recipients insert, so a
-- recipient-insert failure can never leave an orphaned `sending`
-- parent with no delivery plan — issue #370's fix, applied here from
-- day one rather than copying the bug first). Doesn't need
-- p_template_params (a content post has no per-recipient template
-- variables) and always inserts `status = 'scheduled'` — there is no
-- separate "send immediately" path; a `p_scheduled_at` of "now" is
-- simply picked up on the cron's next run rather than sent
-- synchronously inside this call. That keeps exactly one send code
-- path (the cron drain) instead of two that could drift.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_content_broadcast_with_recipients(
  p_account_id      UUID,
  p_user_id         UUID,
  p_name            TEXT,
  p_content_id      UUID,
  p_language        TEXT,
  p_scheduled_at    TIMESTAMPTZ,
  p_audience_filter JSONB,
  p_contact_ids     UUID[],
  p_is_demo         BOOLEAN
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, user_id, name, content_id, language,
    audience_filter, scheduled_at, status, total_recipients, is_demo
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_content_id, p_language,
    p_audience_filter, p_scheduled_at, 'scheduled',
    COALESCE(array_length(p_contact_ids, 1), 0), p_is_demo
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (broadcast_id, contact_id, status)
    SELECT v_broadcast_id, cid, 'pending'
    FROM unnest(p_contact_ids) AS cid
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) TO service_role;

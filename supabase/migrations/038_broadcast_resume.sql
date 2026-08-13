-- ============================================================
-- 038_broadcast_resume
--
-- Issue #472. A dashboard campaign's send loop runs in the browser tab
-- that started it. Close the tab and the remaining recipients are
-- stranded 'pending' while the broadcast sits in 'sending' forever —
-- the "no campaign status is updated" half of that report. The
-- reporter also asked for a way to reprocess pending and failed
-- recipients. All three need delivery to be resumable server-side,
-- which needs two things the schema didn't record:
--
--   1. broadcast_recipients.template_params — the per-recipient
--      variable values. The wizard resolved them in the browser at
--      send time and never persisted them, so a later resume had no
--      way to reconstruct what {{1}} should be for each contact.
--      Freezing them at plan time also means a resume sends exactly
--      what the original pass would have, not a re-resolution against
--      contact data that may have changed since.
--
--   2. broadcasts.delivery_locked_at — a mutex. Resume is a button.
--      Two clicks, or a click while another pass is still fanning out,
--      would message people twice, and a WhatsApp message cannot be
--      recalled.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Per-recipient template params
-- ============================================================
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS template_params JSONB;

COMMENT ON COLUMN broadcast_recipients.template_params IS
  'Positional body values for this recipient''s template send ({{1}}, {{2}}, ...), frozen when the broadcast was planned. NULL on rows created before migration 038; a resume treats that as no params.';

-- ============================================================
-- 2. Delivery mutex
--
-- Claimed with a conditional UPDATE (`WHERE delivery_locked_at IS NULL
-- OR delivery_locked_at < cutoff`), which is atomic in one statement —
-- the loser's WHERE simply doesn't match. A lock older than the
-- staleness window is treated as abandoned, which is what recovers a
-- pass whose process died mid-fan-out.
-- ============================================================
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS delivery_locked_at TIMESTAMPTZ;

COMMENT ON COLUMN broadcasts.delivery_locked_at IS
  'Set while a server-side delivery pass is fanning out; NULL when idle. See 038_broadcast_resume.sql.';

-- Resume selects this broadcast's pending / failed rows.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients(broadcast_id, status);

-- ============================================================
-- 3. create_broadcast_with_recipients — carry params through
--
-- Dropped rather than CREATE OR REPLACE'd: adding a parameter makes a
-- new overload, and a DEFAULT on it would leave the 7-argument call
-- ambiguous between the two.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[]
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
    account_id, user_id, name, template_name,
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  -- Two-array unnest pairs each contact with its params positionally.
  -- A shorter params array pads with NULL, which the resume path reads
  -- as "no params" — the same as a pre-038 row.
  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO service_role;

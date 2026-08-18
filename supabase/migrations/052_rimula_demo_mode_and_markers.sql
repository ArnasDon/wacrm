-- ============================================================
-- 052_rimula_demo_mode_and_markers.sql — explicit Demo Mode setting +
-- demo-origin markers on messages/broadcasts (§3, §15, §20)
--
-- Corrects a design choice from the WhatsAppService rollout
-- (migrations up through 051's follow-up commit): whether an account
-- sends live or simulated WhatsApp traffic must be an explicit,
-- admin-visible Settings toggle (§15 lists "Demo Mode" as its own
-- Settings item) — not silently inferred from whether a
-- `whatsapp_config` row happens to exist. `resolveWhatsAppService`
-- (src/lib/whatsapp/service.ts) is updated in the same commit as this
-- migration to read this flag first and fail loudly — rather than
-- quietly simulate — when Demo Mode is off and no config exists.
--
--   1. accounts.demo_mode_enabled — the explicit switch.
--   2. messages.is_demo           — marks a message sent through
--                                    DemoWhatsAppService, mirroring the
--                                    `messages.ai_generated` precedent
--                                    (033) exactly: same shape, same
--                                    reasoning (a column is the only
--                                    thing that distinguishes two kinds
--                                    of otherwise-identical row).
--   3. broadcasts.is_demo         — same marker, one level up: a whole
--                                    campaign sent while Demo Mode was
--                                    on. Needed for the identical reason
--                                    §20 states for messages/events —
--                                    demo and real activity share the
--                                    same tables and code path, so
--                                    analytics needs an explicit way to
--                                    tell them apart.
--   4. create_broadcast_with_recipients gains a `p_is_demo` parameter
--      so `broadcasts.is_demo` is set atomically at creation, same
--      transaction as everything else this RPC already does.
--
-- Default `true` on `demo_mode_enabled` matches the out-of-the-box
-- requirement (§3/§24: a fresh account must run end-to-end with zero
-- Meta credentials) for every NEW account going forward. The backfill
-- below flips it to `false` specifically for accounts that already
-- have a `whatsapp_config` row at migration time — i.e. self-hosted
-- deployments already sending real WhatsApp traffic keep doing so
-- after this migration lands, rather than silently switching to
-- simulated sends. Every other existing account keeps the same
-- effective behaviour it already had under the old (implicit) design.
--
-- Idempotent — safe to run multiple times. (The backfill only touches
-- rows still at the column's own default, so re-running it after an
-- admin has since made a deliberate choice on an account is a no-op
-- for every account that already reflects one either way — the one
-- narrow case this can't distinguish is "admin manually re-enabled
-- Demo Mode on an account that also has config", which would be
-- reverted by a literal re-run of this exact file; every other
-- one-time backfill in this codebase — e.g. 022's contact dedup —
-- carries the same class of caveat.)
-- ============================================================

-- ============================================================
-- 1. accounts.demo_mode_enabled
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS demo_mode_enabled BOOLEAN NOT NULL DEFAULT true;

UPDATE accounts
SET demo_mode_enabled = false
WHERE demo_mode_enabled = true
  AND id IN (SELECT account_id FROM whatsapp_config);

-- ============================================================
-- 2. messages.is_demo
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. broadcasts.is_demo
-- ============================================================
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_broadcasts_account_demo ON broadcasts(account_id, is_demo);

-- ============================================================
-- 4. create_broadcast_with_recipients — carry is_demo through
--
-- Dropped rather than CREATE OR REPLACE'd, same reasoning 038 already
-- documented: adding a parameter makes a new overload, and a DEFAULT
-- on it would leave the 8-argument call ambiguous between the two.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[],
  p_is_demo           BOOLEAN
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
    template_language, status, total_recipients, is_demo
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients, p_is_demo
  )
  RETURNING id INTO v_broadcast_id;

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

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) TO service_role;

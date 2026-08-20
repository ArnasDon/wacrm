-- ============================================================
-- 054_fix_ambiguous_contact_id_column_reference.sql
--
-- Root cause of POST /api/content/[id]/schedule returning 500 with no
-- detail (found once the route's silent-swallow paths were fixed to
-- actually log): create_content_broadcast_with_recipients (053) fails
-- for every real call with
--
--   code:    42702
--   message: column reference "contact_id" is ambiguous
--   details: It could refer to either a PL/pgSQL variable or a table
--            column.
--
-- Cause: `RETURNS TABLE(broadcast_id UUID, recipient_id UUID,
-- contact_id UUID)` implicitly declares broadcast_id/recipient_id/
-- contact_id as PL/pgSQL variables in scope for the whole function
-- body (same as OUT parameters) — 053's DECLARE block already used
-- the v_ prefix for the one variable it explicitly declared
-- (v_broadcast_id), but never renamed/qualified around these three
-- implicit ones. The unqualified `RETURNING id, contact_id` inside
-- the `ins` CTE's INSERT then collides: Postgres can't tell whether
-- `contact_id` there means the table column just written or the
-- outer contact_id variable, and — unlike sent/read/etc; #variable_
-- conflict defaults to `error`, not silent-shadow — raises 42702
-- rather than guessing. It never showed up in `npm run test` because
-- that suite mocks db.rpc() entirely; nothing exercises the real
-- PL/pgSQL until a live call, which is exactly how this shipped in
-- 053 and only surfaced once the app was scheduling a real audience.
--
-- Fix: qualify the RETURNING target rather than rename the RETURNS
-- TABLE columns. Renaming broadcast_id/recipient_id/contact_id would
-- change the RPC's actual wire contract (the JSON keys
-- src/app/api/whatsapp/broadcast/route.ts's rpcRows[i].broadcast_id
-- and src/app/api/content/[id]/schedule/route.ts's rpcRows[0].
-- broadcast_id read) for no benefit — the ambiguity only exists
-- *inside* the SQL statement, so an explicit table alias on the
-- INSERT + a qualified RETURNING clause resolves it without touching
-- anything a caller depends on.
--
-- create_broadcast_with_recipients (037/038/052) has the exact same
-- RETURNS TABLE shape and the exact same unqualified `RETURNING id,
-- contact_id` — same latent bug, just never yet hit by a real call in
-- this environment (it predates 053 and is covered only by mocked-rpc
-- tests too). Fixed here in the same pass rather than leaving a
-- known-reproducible crash sitting in the hot path every existing
-- template broadcast goes through.
--
-- Idempotent — CREATE OR REPLACE, same signatures as before.
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
    INSERT INTO broadcast_recipients AS br (broadcast_id, contact_id, status)
    SELECT v_broadcast_id, cid, 'pending'
    FROM unnest(p_contact_ids) AS cid
    RETURNING br.id, br.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_content_broadcast_with_recipients(UUID, UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB, UUID[], BOOLEAN) TO service_role;

-- ── Same fix applied to the template-broadcast sibling (052) ──
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
    INSERT INTO broadcast_recipients AS br (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING br.id, br.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], BOOLEAN) TO service_role;

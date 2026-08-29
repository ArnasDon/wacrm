-- ============================================================
-- 040_fix_broadcast_contact_id_ambiguity.sql — make
--     create_broadcast_with_recipients executable
--
-- The problem
--
--   Every call to POST /api/v1/broadcasts dies in the database with
--   SQLSTATE 42702:
--
--     column reference "contact_id" is ambiguous
--     It could refer to either a PL/pgSQL variable or a table column.
--
--   `create_broadcast_with_recipients` is declared
--   `RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)`,
--   and in PL/pgSQL a RETURNS TABLE output column is ALSO an in-scope
--   variable. The recipient INSERT ends in a bare
--   `RETURNING id, contact_id`, so that `contact_id` resolves against
--   both the target table's column and the function's own output
--   variable, and Postgres refuses to guess. Qualifying it —
--   `broadcast_recipients.contact_id` — names the column and nothing
--   else. That one word is the entire fix.
--
--   The other identifiers in the body are already unambiguous:
--   `broadcast_id` appears only in an INSERT column list (never a
--   variable reference), and the final SELECT reads through `ins`.
--
-- Why nothing caught it
--
--   A plpgsql body is only parsed at CREATE time — name resolution
--   happens on first EXECUTION. The migration applies cleanly, so both
--   a fresh `supabase db reset` and CI go green on a function that
--   cannot run. Worth considering a smoke test that CALLS the RPCs the
--   migrations define, not just one that applies them.
--
--   The blast radius also hid it. `lib/whatsapp/broadcast-core.ts` is
--   the only caller, reached from the public API. The dashboard's own
--   broadcast route (POST /api/whatsapp/broadcast) loops
--   sendTemplateMessage and never writes a campaign row, so the UI
--   looks healthy while `broadcasts` and `broadcast_recipients` stay
--   empty.
--
-- Introduced by 037 (which added the function, fixing #370) and
-- carried forward unchanged by 038 (which added p_template_params,
-- fixing #472). It has never once succeeded.
--
-- Why a new file rather than an edit to 038
--
--   Applied migrations are recorded in `schema_migrations`, so editing
--   038 in place would fix only fresh installs — every existing
--   deployment already has 038 recorded and would keep the broken
--   function forever. Same reasoning, and the same shape, as
--   034_fix_profiles_update_rls.sql repairing 017's policy.
--
--   This is a CREATE OR REPLACE of the exact 038 signature, so it is
--   idempotent and safe to re-run. Signature, arguments and result
--   columns are unchanged — broadcast-core.ts needs no edit.
-- ============================================================

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
    -- Qualified: a bare `contact_id` collides with the RETURNS TABLE
    -- output variable of the same name. This is the whole fix.
    RETURNING id, broadcast_recipients.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

-- CREATE OR REPLACE preserves the existing ACL, but 037/038 both state
-- the grants explicitly so a replay from nothing lands the same thing.
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO service_role;

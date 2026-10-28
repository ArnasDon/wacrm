-- ============================================================
-- 079_followup_dedup_and_rpc.sql
--
-- Optimization for follow-up candidate scanning:
-- 1. Introduces `get_pending_followup_contact_ids` RPC to return
--    distinct contact IDs with active pending follow-ups for a given account.
--    This prevents PostgREST URL overflow and 1000-row limit truncation
--    when checking contacts against historical suggestions.
--
-- Security (Defense-in-Depth):
-- - plpgsql with strict role whitelisting.
-- - ONLY permits:
--     1. 'service_role' (system/cron execution)
--     2. 'authenticated' callers who are proven members of p_account_id via `is_account_member(p_account_id)`
-- - Explicitly REJECTS (RAISE EXCEPTION) any anonymous, missing auth.role(), or non-member caller.
-- - Explicitly REVOKES execution from PUBLIC and anon.
--
-- Note: The partial unique index on ai_suggestions will be applied
-- in migration 081 only after the historical duplicate backlog is safely cleaned up.
-- ============================================================

CREATE OR REPLACE FUNCTION get_pending_followup_contact_ids(
  p_account_id uuid,
  p_contact_ids uuid[]
)
RETURNS TABLE(contact_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strict multi-tenant security guard:
  -- Only two execution pathways are permitted:
  -- 1) 'service_role' (background crons, webhook workers, admin client)
  -- 2) 'authenticated' user who is verified to be a member of p_account_id
  -- All other callers (anonymous, missing role, or authenticated non-members)
  -- are immediately aborted with an exception.
  IF auth.role() = 'service_role' THEN
    -- Authorized system execution
    NULL;
  ELSIF auth.role() = 'authenticated' AND is_account_member(p_account_id) THEN
    -- Authorized account member
    NULL;
  ELSE
    RAISE EXCEPTION 'Access denied: unauthorized caller or cross-account access attempt for account %', p_account_id;
  END IF;

  RETURN QUERY
  SELECT DISTINCT s.contact_id
  FROM ai_suggestions s
  WHERE s.account_id = p_account_id
    AND s.category = 'followup'
    AND s.status = 'pending'
    AND s.contact_id = ANY(p_contact_ids);
END;
$$;

-- Explicit privilege restriction: deny PUBLIC and anon, grant strictly to authenticated and service_role
REVOKE ALL ON FUNCTION get_pending_followup_contact_ids(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_pending_followup_contact_ids(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION get_pending_followup_contact_ids(uuid, uuid[]) TO authenticated, service_role;

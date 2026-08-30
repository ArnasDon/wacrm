-- ============================================================
-- 093_redeem_invitation_data_guard.sql
--
-- Close the remaining gaps in `redeem_invitation`'s "your personal
-- account already contains data" guard (review finding AF8).
--
-- When someone who ALREADY owns a solo account redeems a team
-- invitation, the function moves their profile into the new account and
-- then `DELETE FROM accounts WHERE id = <old account>`. Every
-- account-scoped table cascades on that delete, so anything the guard
-- fails to notice is destroyed silently.
--
-- Migration 019 shipped an 11-table whitelist; migration 087 extended
-- it (products, quotes, ai_configs, api_keys, webhook_endpoints,
-- quick_replies, *_config) but three meaningful ones were still
-- missing:
--   * deals               — core CRM data. Only caught today via the
--                           transitive `pipelines` check.
--   * ai_knowledge_documents — user-uploaded business docs (KB).
--   * google_sheets_config  — added in migration 090, after 087's pass;
--                             holds the Google OAuth refresh token.
--
-- Deliberately NOT added (operational / derivative rows a brand-new
-- solo account can legitimately have without it counting as "data
-- worth keeping" — adding them would wrongly block real team joins):
--   notifications, member_presence, system_alerts, ai_usage_log,
--   ai_usage_monthly, kpi_period_spend, ai_action_log, support_tickets,
--   automation_logs / automation_pending_executions / flow_runs /
--   webhook_deliveries / ai_knowledge_chunks / product_price_options /
--   quote_items (all children of a table already in the list),
--   platform_company_invitations (platform-level, not account data).
--
-- The whitelist is inherently fragile — every future account-scoped
-- table that holds user-created content has to be added here by hand.
-- If that keeps happening, replace it with a dynamic scan of every
-- `public` base table with an `account_id` column minus an explicit
-- exclude-list (the "NOT added" set above).
--
-- Only the `v_has_data` SELECT changes; the rest of the function is
-- byte-for-byte the live definition (087 + earlier). Idempotent
-- (CREATE OR REPLACE). Apply in the Supabase SQL editor, like every
-- other migration.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_profile BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed' USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- New team-invite signup: no profile yet (handle_new_user only
  -- bootstraps for platform "new company" invites now). Create the
  -- profile straight into the inviting account and finish.
  SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_caller_id) INTO v_has_profile;
  IF NOT v_has_profile THEN
    INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
    SELECT u.id,
           COALESCE(u.raw_user_meta_data->>'full_name', ''),
           COALESCE(u.email, ''),
           v_inv.account_id,
           v_inv.role
    FROM auth.users u
    WHERE u.id = v_caller_id;

    UPDATE account_invitations
    SET accepted_at = NOW(), accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id;

    RETURN v_inv.account_id;
  END IF;

  -- Caller already has a profile + account. Unchanged path.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account' USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM products WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quotes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM google_calendar_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM google_sheets_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM instagram_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM facebook_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$;

-- Re-assert owner + execute ACL (CREATE OR REPLACE preserves both, but
-- migrations 018/019/022/036 had drifted before — see migration 085 —
-- so match 087's belt-and-suspenders).
ALTER FUNCTION public.redeem_invitation(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;

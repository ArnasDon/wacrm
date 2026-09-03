-- ============================================================
-- 041_peek_invitation_context.sql — richer /join/<token> payload
--
-- Problem this fixes
--   The join page rendered "You're invited to <account_name>" and
--   nothing else. `accounts.name` is seeded by handle_new_user
--   (migration 017) from the owner's own `full_name`, so every
--   invite an account sends reads "You're invited to <owner's
--   personal name>" — identical for every invitee, and easily
--   misread as "we think YOU are that person".
--
--   Two halves to the fix. This migration is the data half: peek
--   now also returns who sent the invite and the label the admin
--   attached to it, so the page can say "Invited by Sara · created
--   for ahmed@example.com" and read differently per invite. The
--   other half is UI: the workspace name became editable in
--   Settings → Team members, so it need not stay a person's name.
--
-- New keys on the ok:true payload (purely additive — the previous
-- keys keep their names and types, so an older client that only
-- reads account_name / role / expires_at is unaffected):
--   invited_by   TEXT|null — inviter's full_name, else their email,
--                            else null if that profile is gone.
--   invite_label TEXT|null — free-text label the admin typed when
--                            creating the link ("Sara — support").
--   account_named_after_owner BOOLEAN — true when accounts.name is
--     still exactly what handle_new_user seeded it with (the owner's
--     full_name, or their email when that was blank), i.e. nobody has
--     renamed the workspace. The join page uses it to render
--     "join <Name>'s workspace" instead of the bare "join <Name>",
--     which otherwise reads as an invitation addressed TO that
--     person. False once an admin sets a real workspace name, and
--     false if the owner has since changed their own display name —
--     which is fine: the page then shows the name as-is, which is
--     what an explicitly-chosen name deserves.
--
-- Disclosure note: `invite_label` is admin-authored text about the
-- intended recipient, and it is now readable by anyone holding the
-- (256-bit, rate-limited) token. That is the same audience that
-- already learns the account name and role, and it is the person
-- the label describes, so the exposure is intentional — but it is
-- why the label is only surfaced here and never on a failure
-- payload, where the caller has proven nothing.
--
-- Idempotent — CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.peek_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
  v_owner_id UUID;
  v_owner_name TEXT;
  v_owner_email TEXT;
  v_named_after_owner BOOLEAN := FALSE;
  v_invited_by TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name, owner_user_id INTO v_account_name, v_owner_id
  FROM accounts
  WHERE id = v_inv.account_id;

  -- Does the workspace still carry the owner's own name? Mirrors the
  -- COALESCE(NULLIF(full_name,''), email, 'My account') seed in
  -- handle_new_user. Case- and whitespace-insensitive so a display-name
  -- edit that only changes capitalisation still counts as "unrenamed".
  IF v_owner_id IS NOT NULL AND v_account_name IS NOT NULL THEN
    SELECT p.full_name, p.email INTO v_owner_name, v_owner_email
    FROM profiles p
    WHERE p.user_id = v_owner_id;

    v_named_after_owner := LOWER(TRIM(v_account_name)) IN (
      LOWER(TRIM(COALESCE(v_owner_name, ''))),
      LOWER(TRIM(COALESCE(v_owner_email, '')))
    ) AND TRIM(v_account_name) <> '';
  END IF;

  -- created_by_user_id is ON DELETE SET NULL, and the profile may
  -- have been removed since — both leave v_invited_by null, which
  -- the page renders by simply omitting the "Invited by" line.
  IF v_inv.created_by_user_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, '')), '')
    INTO v_invited_by
    FROM profiles p
    WHERE p.user_id = v_inv.created_by_user_id;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at,
    'invited_by', v_invited_by,
    'invite_label', NULLIF(TRIM(COALESCE(v_inv.label, '')), ''),
    'account_named_after_owner', COALESCE(v_named_after_owner, FALSE)
  );
END;
$$;

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

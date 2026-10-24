-- ============================================================
-- 060_invitation_signup_redeem.sql — alta + canje atómico (BASE.3)
--
-- Registro cerrado: la ruta POST /api/invitations/[token]/signup crea
-- el usuario con la service role y llama a esta función, que en una
-- sola transacción bloquea la invitación (FOR UPDATE), la valida, mueve
-- el perfil del usuario recién creado a la cuenta que invita y la marca
-- usada. Un token da como máximo un alta; dos POST simultáneos se
-- serializan en el bloqueo y el segundo recibe 'used'.
--
-- Solo service_role puede ejecutarla (no anon ni authenticated).
-- Además se concede peek_invitation a service_role: en instancias
-- endurecidas no hereda el permiso por default privileges.
--
-- Idempotente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation_for_new_user(
  p_token_hash TEXT,
  p_user_id UUID
) RETURNS UUID  -- account_id al que quedó unido
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
BEGIN
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

  SELECT account_id INTO v_old_account_id
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'New user has no profile' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = p_user_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = p_user_id
  WHERE id = v_inv.id;

  -- Cuenta personal recién creada por handle_new_user: vacía.
  IF v_old_account_id <> v_inv.account_id THEN
    DELETE FROM accounts WHERE id = v_old_account_id AND owner_user_id = p_user_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation_for_new_user(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation_for_new_user(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_invitation_for_new_user(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation_for_new_user(TEXT, UUID) TO service_role;

GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO service_role;

-- ============================================================
-- 965 — transferir a posse LIMPA o perfil do novo dono
--
-- A 962 fixou o invariante "papel × perfil não divergem" no
-- `set_member_role`, mas a `transfer_account_ownership` (018) ficou de
-- fora: promover um membro COM `perfil_id` a owner deixava o vínculo de
-- pé — e o CHECK da 956 diz que perfil não tem `papel_base = 'owner'`,
-- então o novo dono ficava com um perfil de agent/admin pendurado.
--
-- Não é só estética: o dono enxerga tudo por curto-circuito em
-- `visibilidade.ts` (papel decide, perfil ignorado), mas o vínculo preso é
-- IRREMOVÍVEL pela UI — a rota `atribuir` recusa mexer em owner com 409 —
-- e qualquer leitor futuro que consulte `perfil_id` sem passar pelo
-- curto-circuito herdaria a divergência (ledger da revisão 48h, r5b).
--
-- `CREATE OR REPLACE` preserva a ACL da 018 (GRANT a authenticated), como
-- a 960 fez com `redeem_invitation`. O corpo é o da 018 mais UMA linha no
-- UPDATE de promoção.
-- ============================================================

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Demote current owner first so the temporary state where the
  -- account has zero owners is never visible — both writes happen
  -- in the same function transaction.
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  -- ⚠️ 965: `perfil_id = NULL` junto com a promoção. Dono não tem perfil
  -- (CHECK da 956 barra papel_base='owner'); deixar o vínculo antigo de pé
  -- criava a divergência papel×perfil que a 962 barra no set_member_role —
  -- aberta por este caminho, e irremovível pela UI (atribuir recusa owner).
  UPDATE profiles SET account_role = 'owner', perfil_id = NULL
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$$;

-- O par explícito, mesmo sendo REPLACE (a ACL da 018 sobrevive): a regra da
-- casa manda a migration conceder o que confere, sem depender de herança —
-- é o formato das irmãs 961/962, e o que a nota da 960 pede.
ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;

-- ============================================================
-- Conferência — só schema/definição, roda em banco VAZIO
-- ============================================================
DO $$
BEGIN
  IF pg_get_functiondef('public.transfer_account_ownership(uuid)'::regprocedure)
     !~ 'perfil_id' THEN
    RAISE EXCEPTION '965: a função não limpa perfil_id — o REPLACE não pegou';
  END IF;

  -- A ACL da 018 tem de ter sobrevivido ao REPLACE: sem o EXECUTE de
  -- authenticated a tela de Membros perde a transferência inteira.
  IF NOT has_function_privilege(
    'authenticated',
    'public.transfer_account_ownership(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '965: authenticated perdeu o EXECUTE — conceda de volta';
  END IF;

  RAISE NOTICE '965 OK — transferência limpa o perfil do novo dono';
END $$;

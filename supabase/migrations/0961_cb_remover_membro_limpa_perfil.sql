-- ============================================================
-- 961 — remover membro limpa o perfil de acesso
--
-- Achado da revisão final das Fases 1–6, PROVADO em produção antes desta
-- migration: `remove_account_member` (018) move o removido para uma conta
-- pessoal nova SEM limpar `perfil_id`, e a FK composta da 957 valida o par
-- `(perfil_id, account_id)` — o perfil é da conta ANTIGA, a conta é a NOVA,
-- e o UPDATE estoura com:
--
--   insert or update on table "profiles" violates foreign key constraint
--   "profiles_perfil_conta_fkey"
--
-- Como a Fase 6 faz todo convidado chegar COM perfil, isso quebraria
-- "remover membro" para praticamente todo membro futuro — e só apareceria no
-- primeiro desligamento de alguém, como um 500 sem explicação na tela de
-- Membros.
--
-- A semântica do zeramento é a certa por si só: o perfil pertence à CONTA,
-- não à pessoa. Quem sai vira dono de uma conta pessoal vazia, sem
-- restrição — exatamente o estado de um signup novo.
--
-- ⚠️ Corpo da 018 reproduzido FIEL (mesma lição da 922/960): o REPLACE troca
-- o corpo inteiro, e as guardas daqui decidem quem consegue remover quem.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  -- the new personal account id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
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

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner',
      -- 961: o perfil é da conta que a pessoa está DEIXANDO. Sem esta linha,
      -- a FK composta da 957 estoura (perfil da conta antiga × conta nova) e
      -- a remoção inteira falha.
      perfil_id = NULL
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
-- ⚠️ As duas metades (regra do CLAUDE.md): num banco novo o REPLACE herda a
-- ACL vigente, mas escrever o par REVOKE/GRANT deixa o estado explícito e
-- idempotente nos dois ambientes.
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF pg_get_functiondef('public.remove_account_member(uuid)'::regprocedure)
     !~ 'perfil_id' THEN
    RAISE EXCEPTION '961: a função não zera perfil_id — o REPLACE não pegou';
  END IF;
  IF NOT has_function_privilege('authenticated', 'remove_account_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '961: authenticated perdeu o EXECUTE — ninguém remove membro';
  END IF;
  IF has_function_privilege('anon', 'remove_account_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '961: anon ganhou EXECUTE — não devia';
  END IF;
END $$;

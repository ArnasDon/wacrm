-- ============================================================
-- 962 — `set_member_role` recusa membro que tem perfil de acesso
--
-- Irmã da 961, mesma revisão. Com um perfil atribuído, o papel do membro
-- SEGUE o `papel_base` do perfil (é a regra do plano: `account_role` é a
-- fonte da verdade, e o perfil o define). A tela de Membros já esconde o
-- seletor de papel de quem tem perfil — mas `set_member_role` (018) continua
-- aceitando a chamada DIRETA, e um papel trocado por ela divergiria do
-- perfil em silêncio: a tela afirmaria "Advogado Trabalhista" enquanto as
-- guardas de servidor obedeceriam outro papel.
--
-- A recusa é explícita, não um zeramento silencioso do perfil: quem quer
-- mudar o papel de alguém com perfil deve trocar o PERFIL (ou removê-lo) —
-- a mensagem diz exatamente isso.
--
-- ⚠️ Corpo da 018 reproduzido FIEL + a guarda nova (lição da 922).
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
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
  v_target_perfil UUID;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Can't change own role via this endpoint.
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target.
  SELECT account_id, account_role, perfil_id
  INTO v_target_account_id, v_target_role, v_target_perfil
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  -- Target must be in caller's account.
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Owner role changes go through transfer_account_ownership.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  -- 962: com perfil atribuído, o papel segue o papel_base do perfil.
  -- Trocar o papel por fora divergiria papel × perfil em silêncio — a tela
  -- afirmaria um perfil e as guardas obedeceriam outro papel.
  IF v_target_perfil IS NOT NULL THEN
    RAISE EXCEPTION 'This member has an access profile; change the profile (or unassign it) instead of the role'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF pg_get_functiondef('public.set_member_role(uuid, account_role_enum)'::regprocedure)
     !~ 'perfil_id' THEN
    RAISE EXCEPTION '962: a guarda do perfil não entrou — o REPLACE não pegou';
  END IF;
  IF NOT has_function_privilege('authenticated', 'set_member_role(uuid, account_role_enum)', 'EXECUTE') THEN
    RAISE EXCEPTION '962: authenticated perdeu o EXECUTE — ninguém muda papel';
  END IF;
  IF has_function_privilege('anon', 'set_member_role(uuid, account_role_enum)', 'EXECUTE') THEN
    RAISE EXCEPTION '962: anon ganhou EXECUTE — não devia';
  END IF;
END $$;

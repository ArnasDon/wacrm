-- ============================================================
-- 959 — trocar o papel-base de um perfil sincroniza os membros, numa
--       transação só
--
-- Fase 5 dos perfis de acesso. Achado do review do Codex sobre o plano: a
-- regra "ao atribuir um perfil, a rota grava account_role = papel_base"
-- cobria a ATRIBUIÇÃO e não a EDIÇÃO. Sem isto, mudar o papel de um perfil
-- que já tem gente deixaria cada membro com o account_role antigo — e como
-- essa coluna é a fonte da verdade das guardas e da RLS, a mudança não teria
-- efeito nenhum sobre o que aquelas pessoas podem fazer, enquanto a tela
-- afirmaria que teve.
--
-- Por que uma FUNÇÃO, e não dois UPDATEs na rota: supabase-js não abre
-- transação entre chamadas. Perfil atualizado + membros não (ou o inverso) é
-- exatamente o estado divergente que o plano existe para evitar; dentro da
-- função, ou tudo ou nada.
--
-- Quem chama é a rota de perfis, em SERVICE-ROLE — o EXECUTE é só dele.
-- O trigger da 958 (colunas privilegiadas de profiles) não barra: ele mira
-- `current_user = 'authenticated'`, e aqui o executor é service_role.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cb_mudar_papel_do_perfil(
  p_perfil UUID,
  p_papel  account_role_enum
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row     cb_perfis_de_acesso%ROWTYPE;
  v_membros INTEGER;
BEGIN
  -- FOR UPDATE: duas edições simultâneas do mesmo perfil se serializam aqui,
  -- em vez de intercalar os dois UPDATEs e deixar membros num papel e o
  -- perfil noutro.
  SELECT * INTO v_row FROM cb_perfis_de_acesso WHERE id = p_perfil FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = '22023';
  END IF;
  IF v_row.sistema THEN
    RAISE EXCEPTION 'Perfil de sistema não muda de papel' USING ERRCODE = '22023';
  END IF;
  IF p_papel = 'owner' THEN
    -- Mesmo CHECK da tabela; a mensagem daqui é mais clara que a violação.
    RAISE EXCEPTION 'papel_base não pode ser owner' USING ERRCODE = '22023';
  END IF;

  UPDATE cb_perfis_de_acesso SET papel_base = p_papel WHERE id = p_perfil;

  -- O escopo por account_id é redundante com a FK composta da 957 (perfil e
  -- membro são da mesma conta por construção) — fica como cinto, é de graça.
  UPDATE profiles
  SET account_role = p_papel
  WHERE perfil_id = p_perfil
    AND account_id = v_row.account_id;
  GET DIAGNOSTICS v_membros = ROW_COUNT;

  RETURN jsonb_build_object('membros_atualizados', v_membros);
END;
$$;

ALTER FUNCTION public.cb_mudar_papel_do_perfil(UUID, account_role_enum) OWNER TO postgres;
-- ⚠️ As duas metades, como manda o CLAUDE.md: o REVOKE de PUBLIC tira de
-- todos (service_role incluído), e o GRANT devolve a quem precisa. Num banco
-- vazio (replay do CI) é o GRANT que faz a conferência passar.
REVOKE ALL ON FUNCTION public.cb_mudar_papel_do_perfil(UUID, account_role_enum)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_mudar_papel_do_perfil(UUID, account_role_enum)
  TO service_role;

-- ------------------------------------------------------------
-- Conferência — resultado, nunca intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conta  UUID;
  v_perfil UUID;
  v_papel  account_role_enum;
  v_ok     BOOLEAN := false;
BEGIN
  IF has_function_privilege('anon', 'cb_mudar_papel_do_perfil(uuid, account_role_enum)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_mudar_papel_do_perfil(uuid, account_role_enum)', 'EXECUTE') THEN
    RAISE EXCEPTION '959: o EXECUTE vazou para anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'cb_mudar_papel_do_perfil(uuid, account_role_enum)', 'EXECUTE') THEN
    RAISE EXCEPTION '959: service_role perdeu o EXECUTE — a rota de perfis não funcionaria';
  END IF;

  -- Prova de comportamento: deriva a conta e PULA num banco vazio.
  SELECT id INTO v_conta FROM accounts LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '959: banco sem contas, pulando a prova.';
  ELSE
    INSERT INTO cb_perfis_de_acesso (account_id, nome, papel_base)
    VALUES (v_conta, '__959_prova__', 'agent') RETURNING id INTO v_perfil;

    PERFORM cb_mudar_papel_do_perfil(v_perfil, 'viewer');
    SELECT papel_base INTO v_papel FROM cb_perfis_de_acesso WHERE id = v_perfil;
    IF v_papel <> 'viewer' THEN
      RAISE EXCEPTION '959: a função não mudou o papel_base';
    END IF;

    -- owner tem de ser recusado
    BEGIN
      PERFORM cb_mudar_papel_do_perfil(v_perfil, 'owner');
      RAISE EXCEPTION '959: aceitou papel owner';
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '959: a recusa de owner não veio como 22023';
    END IF;

    DELETE FROM cb_perfis_de_acesso WHERE id = v_perfil;
  END IF;
END $$;

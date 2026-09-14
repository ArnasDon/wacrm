-- ============================================================
-- 958 — `perfil_id` entra nas colunas que o navegador NÃO edita
--
-- Achado de revisão (Codex) sobre a 956, corrigido antes de qualquer tela
-- consumir o perfil. A classe do problema é EXATAMENTE a da 034
-- (GHSA-fg5p-2qc3-jmxr): RLS restringe QUAIS LINHAS se atualiza, não QUAIS
-- COLUNAS — e a policy `profiles_update` deixa cada um editar a própria
-- linha, que é correto para nome e avatar.
--
-- Sem esta migration, um membro com perfil restrito faria, do próprio
-- navegador:
--
--   PATCH /rest/v1/profiles?user_id=eq.<eu>  { "perfil_id": null }
--
-- e como `perfil_id` NULO significa SEM RESTRIÇÃO (956), a próxima carga
-- devolveria todas as telas. A FK composta da 957 não barra isso: ela impede
-- perfil de OUTRA conta, e aqui o valor é null ou um perfil da MESMA conta
-- (um advogado do trabalhista se movendo para o perfil do administrador).
--
-- ⚠️ Isto NÃO contradiz a decisão "visualização, não segurança" do plano.
-- O buraco aceito é o de LEITURA (espiar dado de outra área pelo PostgREST).
-- Aqui é outra coisa: alteração DURÁVEL da configuração que o operador fez —
-- a mesma razão pela qual `account_role` já é protegido pela 034. Quem
-- gerencia perfil é a rota supervisionada (service_role), como quem gerencia
-- papel são os RPCs de membro.
--
-- ⚠️ O CREATE OR REPLACE reproduz o corpo da 034 INTEIRO e acrescenta só a
-- condição nova — a lição da 922: substituir o corpo omitindo um trecho
-- apaga uma guarda em silêncio. Os escritores legítimos continuam passando:
-- handle_new_user e os RPCs 018/019 rodam SECURITY DEFINER como postgres, e
-- o backend roda como service_role — nenhum deles é `authenticated`.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      -- 958: o vínculo de perfil é configuração do operador, não
      -- self-service. Nulo = sem restrição, então deixar a própria pessoa
      -- zerá-lo desfaz o recorte de área com um PATCH.
      OR NEW.perfil_id IS DISTINCT FROM OLD.perfil_id)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id and perfil_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

-- O trigger da 034 já aponta para esta função; recriá-lo é só cinto de
-- segurança para o caso de a 034 nunca ter rodado (banco novo aplica em
-- ordem, então ela sempre rodou — mas o DROP/CREATE é idempotente e barato).
DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ------------------------------------------------------------
-- Conferência — resultado, nunca intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_user   UUID;
  v_conta  UUID;
  v_perfil UUID;
  v_ok     BOOLEAN := false;
BEGIN
  -- Estrutura: o trigger está lá e a função menciona a coluna nova.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'profiles'
      AND t.tgname = 'enforce_profile_privilege_columns'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '958: o trigger sumiu de profiles';
  END IF;
  IF pg_get_functiondef('public.enforce_profile_privilege_columns()'::regprocedure)
     !~ 'perfil_id' THEN
    RAISE EXCEPTION '958: a função não menciona perfil_id — o REPLACE não pegou';
  END IF;

  -- Comportamento: um `authenticated` autenticado como dono da linha tenta
  -- trocar o próprio perfil_id e TEM de levar insufficient_privilege.
  -- Deriva o usuário do banco e PULA quando não houver (replay do CI roda
  -- num banco vazio — regra do CLAUDE.md).
  SELECT p.user_id, p.account_id INTO v_user, v_conta
  FROM profiles p
  WHERE p.account_id IS NOT NULL
  LIMIT 1;

  IF v_user IS NULL THEN
    RAISE NOTICE '958: banco sem profiles, pulando a prova comportamental.';
  ELSE
    -- Perfil-alvo da MESMA conta (a FK composta da 957 barra o de fora; o
    -- perigo que sobra é justamente o de dentro).
    INSERT INTO cb_perfis_de_acesso (account_id, nome, papel_base)
    VALUES (v_conta, '__958_prova__', 'agent')
    RETURNING id INTO v_perfil;

    -- Vira o usuário da linha: claims para a RLS enxergar a própria linha
    -- (sem isso o UPDATE casa 0 linhas, o trigger nunca dispara e a prova
    -- passaria VAZIA — provando nada).
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text,
      true
    );
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE profiles SET perfil_id = v_perfil WHERE user_id = v_user;
      -- Chegou aqui = o trigger NÃO barrou. O RAISE lá embaixo aborta a
      -- transação inteira, então nada disto persiste.
    EXCEPTION
      WHEN insufficient_privilege THEN v_ok := true;
    END;
    RESET ROLE;

    DELETE FROM cb_perfis_de_acesso WHERE id = v_perfil;

    IF NOT v_ok THEN
      RAISE EXCEPTION '958: authenticated conseguiu trocar o próprio perfil_id — a tranca não pegou';
    END IF;
  END IF;
END $$;

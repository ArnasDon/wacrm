-- ============================================================
-- 1031 — Card PERDIDO que entra numa etapa neutra VOLTA a ficar aberto
--   (1) o gatilho da 950, para todo escritor; (2) a RPC das automações (934),
--   para o "Mover card" que leva o perdido à etapa em que ele já está; e
--   (3) a mesma RPC só escreve se o card continua no status esperado — o que
--   a BUSCA do motor viu, ou o que a própria execução gravou —, e devolve o
--   status que gravou
--
-- Decisão do operador (21/09/2026), revendo a metade "perdido" da 950: o
-- lead desqualificado — em tese perdido — pode voltar a ser qualificado
-- (estava em dia quando falou com o escritório e, meses depois, entra em
-- atraso). Até aqui, card perdido movido para uma etapa sem resultado
-- continuava `lost`: ficava na coluna nova com o selo "Perdido", fora das
-- métricas de aberto, e invisível para as automações (que só enxergam card
-- aberto). Era uma trava da qual o lead não saía.
--
-- ⚠️ SÓ o perdido. GANHO continua ganho ao sair para etapa neutra — é a
-- transferência do jurídico que a 950 protege (fechou → vai para o funil
-- do Jurídico → CONTINUA ganho). Não estender ao `won`.
--
-- ⚠️ A regra age quando o update NÃO trocou o status (`NEW.status =
-- OLD.status = 'lost'`) — o arrasto no quadro, o seletor de etapa, a lista
-- do funil e a RPC das automações (`coalesce(p_status, status)`). Quem pede
-- OUTRO status junto com a etapa fica com o que pediu. ⚠️ O gatilho não
-- distingue "não mexeu no status" de "mandou 'lost' de novo": um PATCH da
-- API v1 com `status: 'lost'` e etapa neutra sobre card JÁ perdido volta
-- aberto (a doc da API diz). Continuar perdido e trocar de etapa = entrar
-- numa etapa marcada "perdido".
--
-- ⚠️ Etapa IGUAL não passa pelo gatilho (ele só age quando a etapa muda): o
-- card marcado perdido pelo BOTÃO continua na etapa em que estava, e o
-- "Mover card" das automações para essa mesma etapa — o Calendly manda para
-- "Reunião Agendada" quem reagendou — seria um no-op com cara de sucesso. Por
-- isso a parte 2 ensina a RPC das automações a reabrir NA MESMA ESCRITA.
--
-- O gatilho da 950 continua apontando para a primeira função (só o CORPO
-- muda). A RPC ganha um 7º argumento, opcional (`p_status_esperado`): por isso
-- DROP + CREATE — `CREATE OR REPLACE` com um argumento a mais criaria uma
-- SEGUNDA função ao lado da antiga, e o PostgREST teria duas para escolher.
-- Quem chama sem ele (o app de antes do deploy) cai no DEFAULT e segue como
-- antes.
--
-- A conferência no fim CHAMA as duas funções com dado real — a RPC direto e o
-- gatilho por um UPDATE — num subbloco que se desfaz (regra 3 das migrations
-- no CLAUDE.md). Banco vazio (o replay do CI) pula e avisa.
-- ============================================================

CREATE OR REPLACE FUNCTION cb_deals_aplica_resultado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_resultado TEXT;
  v_achou     BOOLEAN;
BEGIN
  -- Só quando o negócio ENTRA numa etapa (insert, ou update que muda a
  -- etapa). Update que não toca a etapa — inclusive o Reabrir, que muda só
  -- o status — passa reto.
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT resultado INTO v_resultado
  FROM pipeline_stages
  WHERE id = NEW.stage_id;
  v_achou := FOUND;

  IF v_resultado = 'ganho' THEN
    NEW.status := 'won';
  ELSIF v_resultado = 'perdido' THEN
    NEW.status := 'lost';
  ELSIF v_achou
    AND v_resultado IS NULL
    AND TG_OP = 'UPDATE'
    AND OLD.status = 'lost'
    AND NEW.status = 'lost' THEN
    -- 1031: o perdido que volta ao funil volta ABERTO. Só com a etapa
    -- ACHADA e sem resultado: etapa que a RLS esconde não é afirmação de
    -- "neutra", e reabrir por ignorância seria afirmar o que não se sabe.
    NEW.status := 'open';
  END IF;
  -- Etapa neutra com card aberto ou ganho: não mexe.

  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE preserva os privilégios, mas a conferência cobra as duas
-- metades de novo (ver "Fechar EXECUTE de função" no CLAUDE.md).
REVOKE EXECUTE ON FUNCTION cb_deals_aplica_resultado() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) A RPC das automações (934) reabre o perdido que o "Mover card" leva a
--    uma etapa neutra — inclusive a etapa em que ele JÁ está.
--
-- ⚠️ A decisão fica DENTRO do UPDATE, olhando o status da LINHA no momento da
-- escrita. A 1ª versão lia o status no motor e mandava `p_status: 'open'`
-- depois: quem marcasse o card como ganho entre a leitura e a escrita teria o
-- ganho sobrescrito (Codex, PR #245). Aqui o CASE vê o que está gravado.
-- Status explícito (`p_status`) continua vencendo; etapa marcada continua
-- com o gatilho da 950 (que roda depois, no BEFORE, e carimba ganho/perdido).
--
-- 3) `p_status_esperado`: o card que o motor achou pela BUSCA (o aberto mais
--    recente, senão o perdido mais recente — nunca o ganho) só é escrito se
--    AINDA está no status em que foi achado. Entre a busca e a escrita alguém
--    pode tê-lo marcado ganho, e o CASE acima protege só o STATUS: a etapa
--    mudaria assim mesmo, e o card do cliente que acabou de fechar voltaria
--    para o funil comercial (Codex, PR #245). Nulo = escreve sem conferir (o
--    card do evento de funil, antes da primeira escrita da execução).
--
--    A RPC DEVOLVE o status gravado (`status_gravado`, depois do gatilho da
--    950): o motor o fixa junto com o card, e as escritas seguintes da MESMA
--    execução — inclusive depois de um "Aguardar" de dias — esperam esse
--    status. Sem isso o card fixado atravessava a espera sem guarda, e o
--    ganho marcado no meio virava perdido no passo seguinte (revisão do PR
--    #245). ⚠️ A coluna NÃO se chama `status`: coluna de saída de RETURNS
--    TABLE é variável em escopo, e colidiria com `deals.status` no UPDATE —
--    o 42702 que a 1030 consertou.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION cb_atualizar_negocio(
  p_deal_id         uuid,
  p_account_id      uuid,
  p_pipeline_id     uuid,
  p_stage_id        uuid,
  p_status          text,
  p_cadeia          jsonb,
  p_status_esperado text DEFAULT NULL
)
RETURNS TABLE (ok boolean, motivo text, status_gravado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deal      deals;
  v_funil     uuid;
  v_resultado text;
  v_gravado   text;
BEGIN
  -- Posse. O motor roda em service-role e ignora RLS, então o filtro por
  -- conta aqui é a única barreira entre um `deal_id` vindo do contexto e o
  -- negócio de outro escritório.
  SELECT * INTO v_deal FROM deals
   WHERE id = p_deal_id AND account_id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'negocio nao encontrado nesta conta', NULL::text;
    RETURN;
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'won', 'lost') THEN
    RETURN QUERY SELECT false, format('status invalido: %s', p_status), NULL::text;
    RETURN;
  END IF;

  -- Etapa dada sem funil: descobre o funil DELA. Sem isto, mover para uma
  -- etapa de outro funil violaria a FK composta `(stage_id, pipeline_id)`.
  IF p_stage_id IS NOT NULL THEN
    SELECT s.pipeline_id, s.resultado INTO v_funil, v_resultado
      FROM pipeline_stages s WHERE s.id = p_stage_id;
    IF v_funil IS NULL THEN
      RETURN QUERY SELECT false, 'etapa nao existe', NULL::text;
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pipelines p WHERE p.id = v_funil AND p.account_id = p_account_id
    ) THEN
      RETURN QUERY SELECT false, 'etapa pertence a um funil de outra conta', NULL::text;
      RETURN;
    END IF;
  END IF;

  -- A cadeia, marcada como LOCAL: vive só até o fim desta transação, e o
  -- UPDATE abaixo está nela. O trigger da 933/934 a copia para o evento.
  PERFORM set_config('cb.cadeia', coalesce(p_cadeia, '[]'::jsonb)::text, true);

  UPDATE deals
     SET pipeline_id = coalesce(v_funil, pipeline_id),
         stage_id    = coalesce(p_stage_id, stage_id),
         -- 1031: mover para etapa NEUTRA reabre o card que ESTÁ perdido agora.
         status      = CASE
                         WHEN p_status IS NULL
                          AND p_stage_id IS NOT NULL
                          AND v_resultado IS NULL
                          AND status = 'lost'
                         THEN 'open'
                         ELSE coalesce(p_status, status)
                       END
   WHERE id = p_deal_id AND account_id = p_account_id
     -- 3) o card achado pela busca só é escrito no status em que foi achado.
     AND (p_status_esperado IS NULL OR status = p_status_esperado)
  RETURNING deals.status INTO v_gravado;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false,
      CASE WHEN p_status_esperado IS NULL THEN 'negocio nao encontrado nesta conta'
           ELSE format('o negocio deixou de estar %s durante a automacao', p_status_esperado)
      END,
      NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_gravado;
END;
$$;

-- Só o motor chama (service_role). A assinatura é nova, então as duas metades
-- de novo: o EXECUTE nasce concedido a PUBLIC, e revogar dele tira também do
-- service_role — daí o GRANT de volta (ver "Migration tem de aplicar num banco
-- VAZIO" no CLAUDE.md).
REVOKE EXECUTE ON FUNCTION cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb, text)
  TO service_role;

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_oid     regprocedure;
  v_def     text;
  v_quantas int;
  v_deal    uuid;
  v_conta   uuid;
  v_etapa   uuid;
  v_status  text;
  v_ok      boolean;
  v_motivo  text;
  v_depois  text;
  v_provas  text[] := '{}';
BEGIN
  -- 1. O gatilho da 950 continua ligado, com a regra nova e fechado ao cliente.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_deals_aplica_resultado_trigger'
  ) THEN
    RAISE EXCEPTION '1031: gatilho da 950 ausente';
  END IF;
  IF position('OLD.status = ''lost''' IN pg_get_functiondef('cb_deals_aplica_resultado()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1031: a função não traz a regra do perdido que volta';
  END IF;
  IF has_function_privilege('anon', 'cb_deals_aplica_resultado()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_deals_aplica_resultado()', 'EXECUTE') THEN
    RAISE EXCEPTION '1031: função do gatilho executável por papel de cliente';
  END IF;

  -- 2. Sobrou UMA cb_atualizar_negocio — a de sete —, com a reabertura e a
  --    guarda. `to_regprocedure` devolve NULL em vez de estourar.
  SELECT count(*) INTO v_quantas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cb_atualizar_negocio';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION '1031: % assinatura(s) de cb_atualizar_negocio (esperado 1)', v_quantas;
  END IF;
  v_oid := to_regprocedure('public.cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '1031: a cb_atualizar_negocio que sobrou não é a de sete argumentos';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('AND status = ''lost''' IN v_def) = 0 THEN
    RAISE EXCEPTION '1031: a RPC das automações não traz a reabertura do perdido';
  END IF;
  IF position('p_status_esperado IS NULL OR status = p_status_esperado' IN v_def) = 0 THEN
    RAISE EXCEPTION '1031: a RPC das automações não traz a guarda do status esperado';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '1031: cb_atualizar_negocio executável por papel de cliente';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '1031: service_role NAO executa cb_atualizar_negocio';
  END IF;

  -- 3. CHAMAR as duas: o corpo de uma função plpgsql só é analisado quando
  --    RODA (regra 3 das migrations no CLAUDE.md). Com dado real, num subbloco
  --    que se desfaz por exceção própria — nada sobra em `deals`, na trilha
  --    nem na fila do funil. Cada prova pula quando o banco não tem o dado
  --    dela; o replay do CI, com o banco vazio, pula todas.
  BEGIN
    -- 3a. A guarda: com o status esperado ERRADO, a RPC recusa e não escreve.
    SELECT d.id, d.account_id, d.stage_id, d.status
      INTO v_deal, v_conta, v_etapa, v_status
      FROM deals d WHERE d.stage_id IS NOT NULL ORDER BY d.id LIMIT 1;
    IF v_deal IS NOT NULL THEN
      SELECT r.ok INTO v_ok
        FROM cb_atualizar_negocio(v_deal, v_conta, NULL, v_etapa, NULL, '[]'::jsonb,
               CASE v_status WHEN 'open' THEN 'won' ELSE 'open' END) r;
      IF v_ok THEN
        RAISE EXCEPTION '1031: a RPC escreveu num negócio fora do status esperado';
      END IF;
      v_provas := array_append(v_provas, 'a guarda recusa');
    END IF;

    -- 3b. A RPC reabre o perdido levado a uma etapa neutra.
    SELECT d.id, d.account_id, s.id INTO v_deal, v_conta, v_etapa
      FROM deals d
      JOIN pipeline_stages s ON s.pipeline_id = d.pipeline_id AND s.resultado IS NULL
     WHERE d.status = 'lost'
     ORDER BY d.id, s.position, s.id LIMIT 1;
    IF v_deal IS NOT NULL THEN
      SELECT r.ok, r.motivo, r.status_gravado INTO v_ok, v_motivo, v_status
        FROM cb_atualizar_negocio(v_deal, v_conta, NULL, v_etapa, NULL, '[]'::jsonb, 'lost') r;
      IF NOT v_ok THEN
        RAISE EXCEPTION '1031: a RPC recusou mover o perdido: %', v_motivo;
      END IF;
      SELECT status INTO v_depois FROM deals WHERE id = v_deal;
      IF v_depois IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION '1031: o perdido movido pela RPC para etapa neutra ficou %', v_depois;
      END IF;
      -- O que a RPC devolve é o que ficou gravado — o motor fixa isso.
      IF v_status IS DISTINCT FROM v_depois THEN
        RAISE EXCEPTION '1031: a RPC devolveu % e gravou %', v_status, v_depois;
      END IF;
      v_provas := array_append(v_provas, 'a RPC reabre');
    END IF;

    -- 3c. O gatilho: qualquer escritor que leva o perdido a uma etapa neutra
    --     DIFERENTE o reabre (o arrasto, o seletor, a lista do funil).
    SELECT d.id, s.id INTO v_deal, v_etapa
      FROM deals d
      JOIN pipeline_stages s
        ON s.pipeline_id = d.pipeline_id AND s.resultado IS NULL AND s.id <> d.stage_id
     WHERE d.status = 'lost'
     ORDER BY d.id, s.position, s.id LIMIT 1;
    IF v_deal IS NOT NULL THEN
      UPDATE deals SET stage_id = v_etapa WHERE id = v_deal;
      SELECT status INTO v_depois FROM deals WHERE id = v_deal;
      IF v_depois IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION '1031: o gatilho deixou o perdido % numa etapa neutra', v_depois;
      END IF;
      v_provas := array_append(v_provas, 'o gatilho reabre');
    END IF;

    -- 3d. E o ganho continua ganho numa etapa neutra (a transferência para o
    --     funil do Jurídico, que a 950 protege).
    SELECT d.id, s.id INTO v_deal, v_etapa
      FROM deals d
      JOIN pipeline_stages s
        ON s.pipeline_id = d.pipeline_id AND s.resultado IS NULL AND s.id <> d.stage_id
     WHERE d.status = 'won'
     ORDER BY d.id, s.position, s.id LIMIT 1;
    IF v_deal IS NOT NULL THEN
      UPDATE deals SET stage_id = v_etapa WHERE id = v_deal;
      SELECT status INTO v_depois FROM deals WHERE id = v_deal;
      IF v_depois IS DISTINCT FROM 'won' THEN
        RAISE EXCEPTION '1031: o ganho levado a uma etapa neutra virou %', v_depois;
      END IF;
      v_provas := array_append(v_provas, 'o ganho fica ganho');
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1031', MESSAGE = 'desfaz as chamadas de conferência';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria justamente o erro que
    -- a prova existe para mostrar. As variáveis sobrevivem ao desfazer; o
    -- banco, não.
    WHEN SQLSTATE 'P1031' THEN
      IF cardinality(v_provas) = 0 THEN
        RAISE NOTICE '1031: banco sem negócios — as funções foram conferidas pela definição, não chamadas.';
      ELSE
        RAISE NOTICE '1031: provas com dado real, todas desfeitas: %', array_to_string(v_provas, '; ');
      END IF;
  END;
END $$;

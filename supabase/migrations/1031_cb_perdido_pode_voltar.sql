-- ============================================================
-- 1031 — Card PERDIDO que entra numa etapa neutra VOLTA a ficar aberto
--   (1) o gatilho da 950, para todo escritor; (2) a RPC das automações (934),
--   para o "Mover card" que leva o perdido à etapa em que ele já está
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
-- Troca só o CORPO das duas funções; o gatilho da 950 continua apontando para
-- a primeira, e a assinatura da RPC da 934 não muda.
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
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_atualizar_negocio(
  p_deal_id     uuid,
  p_account_id  uuid,
  p_pipeline_id uuid,
  p_stage_id    uuid,
  p_status      text,
  p_cadeia      jsonb
)
RETURNS TABLE (ok boolean, motivo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deal      deals;
  v_funil     uuid;
  v_resultado text;
BEGIN
  -- Posse. O motor roda em service-role e ignora RLS, então o filtro por
  -- conta aqui é a única barreira entre um `deal_id` vindo do contexto e o
  -- negócio de outro escritório.
  SELECT * INTO v_deal FROM deals
   WHERE id = p_deal_id AND account_id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'negocio nao encontrado nesta conta';
    RETURN;
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'won', 'lost') THEN
    RETURN QUERY SELECT false, format('status invalido: %s', p_status);
    RETURN;
  END IF;

  -- Etapa dada sem funil: descobre o funil DELA. Sem isto, mover para uma
  -- etapa de outro funil violaria a FK composta `(stage_id, pipeline_id)`.
  IF p_stage_id IS NOT NULL THEN
    SELECT s.pipeline_id, s.resultado INTO v_funil, v_resultado
      FROM pipeline_stages s WHERE s.id = p_stage_id;
    IF v_funil IS NULL THEN
      RETURN QUERY SELECT false, 'etapa nao existe';
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pipelines p WHERE p.id = v_funil AND p.account_id = p_account_id
    ) THEN
      RETURN QUERY SELECT false, 'etapa pertence a um funil de outra conta';
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
   WHERE id = p_deal_id AND account_id = p_account_id;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb)
  TO service_role;

DO $$
BEGIN
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

  IF position('AND status = ''lost''' IN pg_get_functiondef('cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1031: a RPC das automações não traz a reabertura do perdido';
  END IF;
  IF has_function_privilege('anon', 'cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '1031: cb_atualizar_negocio executável por papel de cliente';
  END IF;
  IF NOT has_function_privilege('service_role', 'cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '1031: service_role NAO executa cb_atualizar_negocio';
  END IF;
END $$;

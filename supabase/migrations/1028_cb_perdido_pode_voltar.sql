-- ============================================================
-- 1028 — Card PERDIDO que entra numa etapa neutra VOLTA a ficar aberto
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
-- ⚠️ Status EXPLÍCITO no mesmo update vence, como antes: quem muda o
-- status para outra coisa junto com a etapa fica com o que pediu. A regra
-- só age quando o update NÃO mexeu no status (`NEW.status = OLD.status =
-- 'lost'`) — é o arrasto no quadro, o seletor de etapa, a RPC das
-- automações (`coalesce(p_status, status)`) e o formulário que reenvia o
-- status que já estava. Continuar perdido e trocar de etapa = entrar numa
-- etapa marcada "perdido".
--
-- Só troca o CORPO da função; o gatilho da 950 continua apontando para ela.
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
    -- 1028: o perdido que volta ao funil volta ABERTO. Só com a etapa
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_deals_aplica_resultado_trigger'
  ) THEN
    RAISE EXCEPTION '1028: gatilho da 950 ausente';
  END IF;

  IF position('OLD.status = ''lost''' IN pg_get_functiondef('cb_deals_aplica_resultado()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1028: a função não traz a regra do perdido que volta';
  END IF;

  IF has_function_privilege('anon', 'cb_deals_aplica_resultado()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_deals_aplica_resultado()', 'EXECUTE') THEN
    RAISE EXCEPTION '1028: função do gatilho executável por papel de cliente';
  END IF;
END $$;

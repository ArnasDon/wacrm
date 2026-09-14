-- ============================================================
-- 950 — Etapa com RESULTADO: entrar nela carimba ganho/perdido
--
-- O operador não marca ganho/perdido por botão — o fluxo dele é mover o
-- card: "Contrato Fechado" É o ganho, "Perdido" É o perdido (decisão de
-- 2026-08-29, plano em docs/PLANO-painel-do-contato.md, Fase 5). Esta
-- migration dá à etapa um marcador opcional e a um gatilho a tarefa de
-- aplicar o status quando um negócio ENTRA numa etapa marcada.
--
-- ⚠️ POR QUE NO BANCO, e não nas telas: há CINCO escritores de etapa
-- (painel da conversa, arrasto no quadro, formulário, RPC das automações,
-- API v1). Regra em gatilho vale para todos — a mesma garantia de
-- paridade da Fase 4. Os gatilhos da 912 (trilha) e 933 (fila) são AFTER
-- e enxergam o NEW já carimbado: um único UPDATE de etapa gera as duas
-- linhas de história ("moveu" e "ganhou"), que é como a 912 já conta
-- fatos múltiplos.
--
-- ⚠️ ASSIMETRIA DELIBERADA (decisão do operador): SAIR de uma etapa
-- marcada para uma etapa neutra NÃO reabre nem mexe no status. É o fluxo
-- do jurídico: fechou → transfere para outro funil → CONTINUA ganho.
-- Reabrir é só por ação explícita (botão) ou por entrar numa etapa
-- marcada com outro resultado. Não "corrigir" para o modelo do Kommo
-- (que reabre ao sair) — quebraria a transferência pós-fechamento.
--
-- ⚠️ Se o MESMO update trouxer status explícito E etapa marcada, a etapa
-- VENCE — o marcador é declarativo. (Reabrir pelo botão não esbarra
-- nisso: ele muda só o status, sem tocar na etapa.)
-- ============================================================

-- ------------------------------------------------------------
-- 1) O marcador da etapa
-- ------------------------------------------------------------
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS resultado TEXT;

ALTER TABLE pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_resultado_check;
ALTER TABLE pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_resultado_check
  CHECK (resultado IS NULL OR resultado IN ('ganho', 'perdido'));

-- ------------------------------------------------------------
-- 2) O gatilho — BEFORE, para o status ir na MESMA escrita.
--
-- SECURITY INVOKER: o SELECT em `pipeline_stages` roda como quem escreveu
-- o negócio. `authenticated` tem SELECT via RLS (membro da conta — e a
-- etapa consultada é sempre da conta do próprio negócio); `service_role`
-- enxerga tudo. Cobre INSERT também: negócio que NASCE numa etapa marcada
-- (API/DealForm apontando direto para ela) já nasce carimbado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_deals_aplica_resultado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_resultado TEXT;
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

  IF v_resultado = 'ganho' THEN
    NEW.status := 'won';
  ELSIF v_resultado = 'perdido' THEN
    NEW.status := 'lost';
  END IF;
  -- Etapa neutra (ou não encontrada sob RLS): não mexe — o selo fica.

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_deals_aplica_resultado_trigger ON deals;
CREATE TRIGGER cb_deals_aplica_resultado_trigger
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW
  EXECUTE FUNCTION cb_deals_aplica_resultado();

-- ------------------------------------------------------------
-- 3) Privilégios — as duas metades. Ninguém chama a função direto
-- (gatilho dispara sem EXECUTE — checado no CREATE TRIGGER); o corpo só
-- faz SELECT em pipeline_stages, que é privilégio de TABELA do invocador.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION cb_deals_aplica_resultado() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Conferência — schema e privilégio; verdadeiro num banco vazio.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_stages' AND column_name = 'resultado'
  ) THEN
    RAISE EXCEPTION '950: coluna resultado ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cb_pipeline_stages_resultado_check'
  ) THEN
    RAISE EXCEPTION '950: CHECK do resultado ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_deals_aplica_resultado_trigger'
  ) THEN
    RAISE EXCEPTION '950: gatilho ausente';
  END IF;

  IF has_function_privilege('anon', 'cb_deals_aplica_resultado()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_deals_aplica_resultado()', 'EXECUTE') THEN
    RAISE EXCEPTION '950: função do gatilho ainda executável por papel de cliente';
  END IF;
END $$;

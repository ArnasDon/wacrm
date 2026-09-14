-- 978_cb_calendly_em_espera.sql
--
-- `cb_calendly_eventos.resultado` ganha o valor 'em_espera': a automação
-- disparada pelo agendamento parou num passo "Aguardar" (`executeStepsFrom`
-- devolveu `partial`, no escopo de fora ou dentro de um ramo). Até aqui isso
-- era gravado como 'disparado' — o log da integração afirmava "rodou até o
-- fim" sobre execução que ainda nem tinha terminado, e que podia falhar
-- depois sem nada voltar a esta linha (achado do Codex no PR #128, 2ª
-- rodada). O CHECK é o da 977, mais o valor.
--
-- O que vier DEPOIS da espera fica no histórico da automação
-- (`automation_logs`): o agendador retoma a execução e NÃO escreve aqui.
-- `em_espera` é terminal para esta linha, de propósito — o texto do
-- `detalhe` diz isso ao operador.
--
-- Idempotente: derruba qualquer CHECK desta tabela que mencione `resultado`
-- (o da 977 nasceu inline, com o nome que o Postgres dá —
-- `cb_calendly_eventos_resultado_check` — mas procurar pela DEFINIÇÃO não
-- depende do nome) e recria com nome explícito. Roda em banco VAZIO: não
-- exige linha nenhuma, só confere a definição no catálogo.

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cb_calendly_eventos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%resultado%'
  LOOP
    EXECUTE format('ALTER TABLE public.cb_calendly_eventos DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE cb_calendly_eventos
  ADD CONSTRAINT cb_calendly_eventos_resultado_check
  CHECK (resultado IN ('recebido', 'disparado', 'em_espera', 'sem_automacao', 'sem_contato', 'sem_telefone', 'ignorado', 'falhou'));

-- Conferência: a definição, não o dado (banco vazio passa).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.cb_calendly_eventos'::regclass
    AND conname = 'cb_calendly_eventos_resultado_check';
  IF v_def IS NULL OR v_def NOT LIKE '%em_espera%' OR v_def NOT LIKE '%disparado%' THEN
    RAISE EXCEPTION '978: o CHECK de cb_calendly_eventos.resultado não ficou como esperado (%).', coalesce(v_def, 'ausente');
  END IF;
END $$;

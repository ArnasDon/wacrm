-- 980_cb_calendly_claim.sql
--
-- `cb_calendly_eventos.processando_desde`: o CADEADO de quem está rodando
-- este agendamento agora.
--
-- Sem ele, "Processar de novo" era uma leitura seguida de escrita: dois
-- cliques (duas abas, dois administradores) liam a mesma linha, os dois
-- passavam na conferência e os dois disparavam a automação — dois avisos ao
-- advogado e o card mexido duas vezes. A guarda anterior olhava a IDADE da
-- linha (`recebido` com menos de 2 min), o que não serializa nada: nada
-- impede duas requisições de acharem a mesma linha velha (achado do Codex
-- nos PRs #133 e #134, nas duas rodadas).
--
-- É o mesmo cadeado `UPDATE…RETURNING` da transcrição de áudio (943): quem
-- consegue escrever a coluna é o dono; os demais leem o estado e desistem.
-- Aqui ele também fecha a corrida com o `after()` do webhook, que carimba a
-- coluna ANTES de processar — a idade da linha não dizia (e não podia
-- dizer) se aquele processamento ainda estava vivo, porque em produção não
-- há corte de duração de rota.
--
-- Recolhimento embutido: claim mais velho que o corte da aplicação
-- (`RECOLHER_CLAIM_MS`, 10 min) é tomado. Sem isso, um processo morto no
-- meio deixaria o agendamento travado para sempre.
--
-- Nenhum GRANT novo: a tabela é fechada para `authenticated` desde a 977.

ALTER TABLE cb_calendly_eventos
  ADD COLUMN IF NOT EXISTS processando_desde timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cb_calendly_eventos' AND column_name = 'processando_desde'
  ) THEN
    RAISE EXCEPTION '980: a coluna processando_desde não foi criada.';
  END IF;
  IF has_column_privilege('authenticated', 'public.cb_calendly_eventos', 'processando_desde', 'SELECT') THEN
    RAISE EXCEPTION '980: authenticated não pode enxergar cb_calendly_eventos.';
  END IF;
END $$;

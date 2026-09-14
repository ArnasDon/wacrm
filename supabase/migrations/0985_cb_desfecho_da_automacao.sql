-- ============================================================
-- 985 — Desfecho da execução de automação.
--
-- O motor já registrava CADA PASSO em `automation_logs.steps_executed`, mas
-- não registrava o DESFECHO da execução como um todo — e o `status` que ele
-- grava não serve para isso:
--
--   * `status` nasce `'failed'` no INSERT, ANTES do primeiro passo rodar
--     (semente pessimista da issue #409: execução que morre no meio não pode
--     ficar parecendo sucesso). Uma tela que leia `status` sem mais nada
--     pinta vermelho em toda automação que COMEÇOU;
--   * quando uma condição desvia para um ramo VAZIO, o motor termina o log
--     como `'success'`. Ou seja: a execução que uma trava por etiqueta barrou
--     é hoje registrada como "concluída com sucesso". É o defeito que motivou
--     esta feature — o aviso na tela repetiria a mentira.
--
-- Vocabulário NOVO e NOSSO, em coluna própria, em vez de um quarto valor em
-- `status`: `status` é lido por quatro consumidores que o TypeScript não
-- cobre (o `StatusBadge` da tela de logs, com fallback vermelho; um
-- `t(\`status.${status}\`)` que nenhum portão de i18n confere; um
-- `status: string` no feed do painel; e um if/else sem ramo final no próprio
-- motor). Um valor novo ali pintaria "barrada" de vermelho, igual a falha, e
-- imprimiria chave de tradução crua na tela. A coluna nova não muda nada para
-- quem não a conhece.
--
-- ⚠️ `automation_logs` é tabela DO UPSTREAM (006). Estas duas colunas, o CHECK
-- próprio, o índice e os grants abaixo são nossos — anotado na tabela de
-- divergências do CLAUDE.md.
--
-- ⚠️ SEM BACKFILL, de propósito. Não existe registro de QUANDO cada execução
-- antiga terminou, e carimbar `created_at` como hora de fim mentiria em toda
-- execução que passou por um "Aguardar" (a linha é criada no início e o log
-- continua o MESMO depois da espera). As 15 execuções gravadas ficam sem
-- desfecho e não aparecem no fio — o histórico começa a partir daqui.
-- ============================================================

-- ------------------------------------------------------------
-- (a) As duas colunas
-- ------------------------------------------------------------
ALTER TABLE public.automation_logs
  ADD COLUMN IF NOT EXISTS desfecho text,
  ADD COLUMN IF NOT EXISTS finalizado_em timestamptz;

COMMENT ON COLUMN public.automation_logs.desfecho IS
  'Desfecho da execução, vocabulário nosso (985): concluida | barrada | falhou. '
  'NULO = não terminou, ou terminou antes desta migration, ou o processo morreu '
  'no meio. Independente de `status`, que é do upstream e nasce "failed" no '
  'INSERT. "barrada" é ESTREITA: só quando uma condição desviou para ramo vazio '
  'E a execução não fez trabalho nenhum.';

COMMENT ON COLUMN public.automation_logs.finalizado_em IS
  'Quando a execução terminou de fato (985). Diferente de `created_at`, que é o '
  'INSERT, feito ANTES do primeiro passo — numa automação com "Aguardar" os dois '
  'podem estar a dias de distância.';

-- ------------------------------------------------------------
-- (b) CHECK só sobre a coluna nova
--
-- ⚠️ NÃO tocar `automation_logs_status_check`. É ele que mantém honestos os
-- leitores antigos de `status`: enquanto ele só admite os três valores do
-- upstream, nenhuma tela existente pode receber um valor que não sabe pintar.
-- ------------------------------------------------------------
ALTER TABLE public.automation_logs
  DROP CONSTRAINT IF EXISTS automation_logs_desfecho_check;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_desfecho_check
  CHECK (desfecho IS NULL OR desfecho IN ('concluida', 'barrada', 'falhou'));

-- ------------------------------------------------------------
-- (c) Índice por CONTATO
--
-- Não existia índice nenhum por `contact_id` nesta tabela (só pkey, conta,
-- automação e usuário) — e o fio da conversa passa a consultar exatamente
-- "as execuções encerradas DESTE contato" a cada abertura de conversa.
-- Parcial: linha sem contato (disparo sem alvo) nunca é lida por esse caminho.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS automation_logs_contato_desfecho_idx
  ON public.automation_logs (account_id, contact_id, finalizado_em DESC)
  WHERE contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- (d) Fechar o `anon` — e devolver o que os outros papéis usam
--
-- ⚠️ MEDIDO em 2026-09-09: `anon` tinha INSERT, SELECT, UPDATE, DELETE e
-- TRUNCATE nesta tabela. Ela é do upstream e ficou FORA do fechamento da 931,
-- que fez isso para as tabelas `cb_*`. Nunca houve vazamento (a RLS filtra),
-- mas era UMA barreira onde as nossas têm duas.
--
-- ⚠️ Os GRANTs de volta não são zelo decorativo: em banco NOVO (o replay do CI)
-- não existe o default privilege do Supabase que concede tudo a estes papéis,
-- então o que esta migration não conceder por escrito não existe lá. É a regra
-- do CLAUDE.md — todo privilégio conferido tem de ser concedido aqui.
--
-- ⚠️ DELETE fica com `authenticated` de propósito: apagar uma automação
-- CASCADEia nos logs, e eu não medi se a ação referencial ignora o privilégio
-- de quem invoca. Revogar sem medir arriscaria quebrar "apagar automação" em
-- silêncio — que é justamente a classe de falha que esta migration evita.
-- ------------------------------------------------------------
REVOKE ALL ON TABLE public.automation_logs FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_logs TO service_role;

-- ------------------------------------------------------------
-- Conferência — SÓ catálogo.
--
-- ⚠️ Nada aqui exige dado presente: em banco vazio (o job `Apply to a clean
-- database`) uma conferência que precise de linha reprova por falta de dado, e
-- não por defeito. Afirmar AUSÊNCIA é sempre seguro; afirmar presença de dado
-- é que quebra.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'automation_logs'
       AND column_name = 'desfecho'
  ) THEN
    RAISE EXCEPTION '985: coluna desfecho não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'automation_logs'
       AND column_name = 'finalizado_em'
  ) THEN
    RAISE EXCEPTION '985: coluna finalizado_em não existe';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'automation_logs_desfecho_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '985: CHECK do desfecho não foi criado';
  END IF;
  IF v_def NOT LIKE '%concluida%' OR v_def NOT LIKE '%barrada%' OR v_def NOT LIKE '%falhou%' THEN
    RAISE EXCEPTION '985: CHECK do desfecho não cobre os três valores: %', v_def;
  END IF;

  -- O CHECK do upstream tem de sair INTACTO desta migration.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conname = 'automation_logs_status_check';
  IF v_def IS NULL THEN
    RAISE NOTICE '985: sem automation_logs_status_check neste banco (nada a preservar).';
  ELSIF v_def NOT LIKE '%success%' OR v_def NOT LIKE '%partial%' OR v_def NOT LIKE '%failed%' THEN
    RAISE EXCEPTION '985: o CHECK de status foi alterado — não deveria: %', v_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'automation_logs_contato_desfecho_idx'
  ) THEN
    RAISE EXCEPTION '985: índice por contato não foi criado';
  END IF;

  -- As DUAS metades do REVOKE, como o CLAUDE.md exige: que o anon perdeu, e
  -- que os outros NÃO perderam.
  IF has_table_privilege('anon', 'public.automation_logs', 'SELECT') THEN
    RAISE EXCEPTION '985: anon ainda tem SELECT em automation_logs';
  END IF;
  IF has_table_privilege('anon', 'public.automation_logs', 'INSERT')
     OR has_table_privilege('anon', 'public.automation_logs', 'UPDATE')
     OR has_table_privilege('anon', 'public.automation_logs', 'DELETE') THEN
    RAISE EXCEPTION '985: anon ainda escreve em automation_logs';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.automation_logs', 'SELECT') THEN
    RAISE EXCEPTION '985: authenticated perdeu SELECT — o fio e a aba leem sob RLS';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.automation_logs', 'DELETE') THEN
    RAISE EXCEPTION '985: authenticated perdeu DELETE — apagar automação cascateia aqui';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.automation_logs', 'UPDATE') THEN
    RAISE EXCEPTION '985: service_role perdeu UPDATE — é o motor que grava o desfecho';
  END IF;

  RAISE NOTICE '985: colunas, CHECK, índice e grants conferidos.';
END $$;

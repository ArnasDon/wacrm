-- ============================================================
-- 943 — Transcrição de áudio (fase 1 do PLANO-transcricao-e-midia-na-ia)
--
-- Colunas de estado em `messages` (o padrão do projeto para "estado de um
-- anexo" é coluna na própria tabela — `media_state` é o precedente; ver o
-- plano, §3.1, para os motivos de NÃO usar `content_text` nem tabela nova).
--
-- A transcrição NÃO entra no índice GIN da busca (929) — trade-off aceito
-- no plano: buscar por conteúdo de áudio é migration futura, não redesenho.
--
-- Provedor: Gemini, com a chave BYO da conta (decisão de 2026-08-27, no
-- plano) — por isso o custo passa a ser registrado em `ai_usage_log`, e o
-- CHECK de `mode` ganha 'transcricao'. Recriamos os CHECKs com a lista
-- COMPLETA (incluindo os valores da 941) para esta migration ser
-- autossuficiente num replay que a rode logo após a 941 — a ordem
-- numérica garante 941 < 943 em qualquer banco.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS transcricao text,
  ADD COLUMN IF NOT EXISTS transcricao_status text,
  ADD COLUMN IF NOT EXISTS transcricao_erro text,
  ADD COLUMN IF NOT EXISTS transcricao_desde timestamptz,
  ADD COLUMN IF NOT EXISTS transcricao_em timestamptz,
  ADD COLUMN IF NOT EXISTS transcricao_tentativas int NOT NULL DEFAULT 0;

-- Máquina de estados: NULL (nunca pedida) → transcrevendo → pronta |
-- falhou (retentável, até 3) | recusada (terminal, SEM botão — formato,
-- tamanho, tentativas esgotadas).
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_transcricao_status_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_transcricao_status_check CHECK (
    transcricao_status IS NULL
    OR transcricao_status IN ('transcrevendo', 'pronta', 'falhou', 'recusada')
  );

-- Modo novo no log de uso de IA: a transcrição gasta a chave BYO da conta,
-- então o custo aparece no painel de uso como os demais modos.
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check CHECK (
    mode IN ('auto_reply', 'draft', 'radar', 'transcricao')
  );

-- Idêntico ao da 941 (openai/anthropic/gemini) — recriado aqui só para o
-- replay parcial ser autossuficiente; em banco com a 941 é no-op semântico.
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check CHECK (
    provider IN ('openai', 'anthropic', 'gemini')
  );

-- ------------------------------------------------------------
-- Conferência (regra do CLAUDE.md: nada aqui exige dado pré-existente,
-- e nenhum privilégio é conferido sem ter sido concedido — as colunas
-- novas herdam os grants de TABELA que `messages` já tem).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name = 'transcricao_tentativas'
  ) THEN
    RAISE EXCEPTION '943: colunas de transcrição não foram criadas';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'ai_usage_log_mode_check'
      AND check_clause NOT LIKE '%transcricao%'
  ) THEN
    RAISE EXCEPTION '943: CHECK de mode não aceita transcricao';
  END IF;

  RAISE NOTICE '943: ok — colunas de transcrição e CHECKs no lugar.';
END $$;

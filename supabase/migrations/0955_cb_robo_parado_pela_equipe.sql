-- ============================================================
-- 955 — Robô parado pela EQUIPE (aba Automações da conversa)
--
-- A aba de automações do painel da conversa ganha o botão "Parar" sobre o
-- robô ativo do cliente. O CHECK de `flow_runs.status` precisa de um valor
-- novo para registrar isso com honestidade:
--
--   `paused_by_agent`        — uma PESSOA respondeu no meio do atendimento
--                              (parada IMPLÍCITA, já existia)
--   `stopped_by_automation`  — uma REGRA mandou parar (936)
--   `stopped_by_agent`       — uma PESSOA decidiu parar, pelo botão (esta)
--
-- Reusar qualquer um dos dois primeiros apagaria justamente a informação que
-- se procura ao investigar por que o robô calou — o mesmo argumento que a 936
-- registrou ao separar regra de gente. `end_reason` continua texto livre.
--
-- Nenhum GRANT/REVOKE aqui: a coluna é escrita só pelo service-role (o
-- navegador não tem policy de UPDATE em `flow_runs` desde a 010), e trocar
-- CHECK não mexe em privilégio.
-- ============================================================

ALTER TABLE public.flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_status_check;

ALTER TABLE public.flow_runs
  ADD CONSTRAINT flow_runs_status_check
  CHECK (status = ANY (ARRAY[
    'active',
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed',
    'stopped_by_automation',
    'stopped_by_agent'
  ]));

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção (formato da 936).
-- Duas metades: o valor novo passa E os antigos continuam lá. Só a segunda
-- prova que a restrição não foi afrouxada nem perdeu status no caminho.
-- Nada aqui exige dado: introspecção de catálogo funciona em banco vazio.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.flow_runs'::regclass
     AND conname  = 'flow_runs_status_check';

  IF v_def IS NULL OR v_def NOT LIKE '%stopped_by_agent%' THEN
    RAISE EXCEPTION 'flow_runs ainda não aceita stopped_by_agent: %',
      coalesce(v_def, '(restrição ausente)');
  END IF;

  IF v_def NOT LIKE '%active%'
     OR v_def NOT LIKE '%paused_by_agent%'
     OR v_def NOT LIKE '%stopped_by_automation%'
     OR v_def NOT LIKE '%timed_out%'
     OR v_def NOT LIKE '%handed_off%'
     OR v_def NOT LIKE '%completed%'
     OR v_def NOT LIKE '%failed%' THEN
    RAISE EXCEPTION 'a restrição perdeu status antigo: %', v_def;
  END IF;

  RAISE NOTICE '955 OK — stopped_by_agent aceito, os 7 status antigos preservados';
END $$;

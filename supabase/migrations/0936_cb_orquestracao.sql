-- ============================================================
-- 936 — Orquestração: acionar e parar automação, robô e IA (Fase 3)
--
-- Duas linhas de schema, e as duas existem porque "parar" não tinha como ser
-- registrado. Sem elas o motor teria de mentir sobre o que aconteceu:
-- execução cancelada viraria `failed` (o painel diria que quebrou) e robô
-- parado por regra viraria `paused_by_agent` (a tela diria que uma PESSOA
-- interveio, quando não houve pessoa nenhuma).
--
-- Os passos novos (`run_automation`, `stop_automation`, `run_flow`,
-- `stop_flow`, `set_ai`) NÃO precisam de migration: `automation_steps` não
-- tem CHECK em `step_type` — conferido em 2026-08-04, a tabela só restringe
-- `branch`.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `cancelled` na execução parada em "Aguardar"
--
-- Duas coisas passam a produzi-lo, e as duas são o MESMO estado: alguém
-- decidiu que aquela espera não deve mais acordar.
--
--   a) o passo `stop_automation`, disparado por outra automação;
--   b) ⚠️ **desativar a automação na tela** — que até aqui NÃO parava nada.
--      O resume relia a automação por id e nunca olhava `is_active`, então
--      uma automação desligada continuava acordando execuções paradas.
--      O defeito era invisível porque nada nunca chamou o cron em produção;
--      ligar o laço de 60 s o tornaria real no mesmo dia.
--
-- `failed` seria a saída fácil e está errada: ela alimenta o painel de erro,
-- e cancelamento não é erro. Quem for investigar "por que a automação não
-- terminou?" precisa distinguir "quebrou" de "mandaram parar".
-- ------------------------------------------------------------

ALTER TABLE public.automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;

ALTER TABLE public.automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status = ANY (ARRAY['pending', 'running', 'done', 'failed', 'cancelled']));

-- ------------------------------------------------------------
-- 2. `stopped_by_automation` no robô (flow_runs)
--
-- Já existia `paused_by_agent`, escrito quando um humano responde no meio do
-- atendimento (`send-message.ts`). Reusá-lo aqui apagaria justamente a
-- informação que se procura ao investigar: **teve gente ou foi regra?**
--
-- O motivo fino fica no `end_reason`, que é texto livre e não precisa de
-- CHECK:
--   `stopped_by_automation`  — o passo `stop_flow` mandou parar
--   `replaced_by_automation` — o passo `run_flow` trocou este robô por outro
--                              (D11: o novo SUBSTITUI o ativo)
--
-- ⚠️ O índice `idx_one_active_run_per_contact` é parcial sobre
-- `status = 'active'`, então acrescentar status não o afeta: uma run parada
-- aqui LIBERA o contato para a run nova — que é exatamente o que D11 pede.
-- ------------------------------------------------------------

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
    'stopped_by_automation'
  ]));

-- ------------------------------------------------------------
-- 3. Conferência — o resultado, nunca a intenção
--
-- Confere as duas metades de cada CHECK: que o valor NOVO passa **e** que um
-- valor inventado continua sendo recusado. Só a segunda prova que a
-- restrição não foi afrouxada para qualquer texto no caminho.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_def_pending text;
  v_def_runs    text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def_pending
    FROM pg_constraint
   WHERE conrelid = 'public.automation_pending_executions'::regclass
     AND conname  = 'automation_pending_executions_status_check';

  IF v_def_pending IS NULL OR v_def_pending NOT LIKE '%cancelled%' THEN
    RAISE EXCEPTION 'automation_pending_executions ainda não aceita cancelled: %',
      coalesce(v_def_pending, '(restrição ausente)');
  END IF;
  IF v_def_pending NOT LIKE '%pending%' OR v_def_pending NOT LIKE '%running%' THEN
    RAISE EXCEPTION 'a restrição perdeu status antigo: %', v_def_pending;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def_runs
    FROM pg_constraint
   WHERE conrelid = 'public.flow_runs'::regclass
     AND conname  = 'flow_runs_status_check';

  IF v_def_runs IS NULL OR v_def_runs NOT LIKE '%stopped_by_automation%' THEN
    RAISE EXCEPTION 'flow_runs ainda não aceita stopped_by_automation: %',
      coalesce(v_def_runs, '(restrição ausente)');
  END IF;
  IF v_def_runs NOT LIKE '%paused_by_agent%' OR v_def_runs NOT LIKE '%active%' THEN
    RAISE EXCEPTION 'a restrição de flow_runs perdeu status antigo: %', v_def_runs;
  END IF;

  RAISE NOTICE '936 OK — cancelled e stopped_by_automation aceitos, antigos preservados';
END $$;

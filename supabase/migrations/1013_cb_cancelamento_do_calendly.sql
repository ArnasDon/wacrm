-- 1013_cb_cancelamento_do_calendly.sql
--
-- Reunião CANCELADA no Calendly passa a DESARMAR os lembretes.
--
-- Até aqui o CRM só assinava `invitee.created`: o cancelamento era invisível,
-- a data continuava no campo do contato e o card continuava em "Reunião
-- Agendada" — então os quatro lembretes saíam do mesmo jeito, inclusive o de
-- "sua reunião começa em 10 minutos", com o link de um evento que o cliente
-- cancelou. Achado na revisão das automações do escritório (20/09/2026),
-- medido: 13 contatos com data futura no campo, todos com card aberto na
-- etapa.
--
-- Duas colunas, e nenhuma delas é escrita por código antigo:
--
-- 1) `cb_calendly_eventos.resultado` ganha 'cancelado'. O CHECK é o da 978
--    mais o valor. A linha do cancelamento é do MESMO invitee do agendamento
--    (o UNIQUE é por `(conta, evento, invitee)`, e `evento` difere), então as
--    duas convivem e o log da integração conta a história inteira.
--
-- 2) `cb_automation_reminders.motivo` separa "já disparou" de "não deve
--    disparar". O cancelamento NÃO apaga a data da ficha — ele PRÉ-ARMA a
--    trava do lembrete, que é o mecanismo que a 935 já criou para isto
--    ("este (automação, contato, valor) está resolvido"). Sem a coluna, a
--    linha mentiria: `disparado_em` preenchido num lembrete que ninguém
--    mandou, e o operador leria "o cliente recebeu" sobre mensagem que não
--    saiu.
--
--    ⚠️ Pré-armar em vez de apagar a data é escolha, não economia: apagar
--    destruiria a informação da ficha ("a reunião era às 14h"), mexeria num
--    campo que outras regras leem, e ainda dependeria de adivinhar QUAL
--    campo guarda a data. A trava é por (automação, contato, VALOR), então
--    reagendamento re-arma sozinho — valor novo, chave nova —, que é a
--    mesma propriedade que a 935 documenta.
--
-- Idempotente e roda em banco VAZIO: nenhuma conferência exige linha.

-- ------------------------------------------------------------
-- 1) 'cancelado' no CHECK de resultado (padrão da 978: derruba pela
--    DEFINIÇÃO, não pelo nome, e recria com nome explícito).
-- ------------------------------------------------------------
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
  CHECK (resultado IN ('recebido', 'disparado', 'em_espera', 'cancelado',
                       'sem_automacao', 'sem_contato', 'sem_telefone',
                       'ignorado', 'falhou'));

-- ------------------------------------------------------------
-- 2) POR QUE a trava existe.
--
-- DEFAULT 'disparo' de propósito: as linhas que já estão lá foram todas
-- escritas pela varredura, e é o que a coluna tem de dizer sobre elas.
-- ------------------------------------------------------------
ALTER TABLE cb_automation_reminders
  ADD COLUMN IF NOT EXISTS motivo text NOT NULL DEFAULT 'disparo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_automation_reminders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%motivo%'
  ) THEN
    ALTER TABLE cb_automation_reminders
      ADD CONSTRAINT cb_automation_reminders_motivo_check
      CHECK (motivo IN ('disparo', 'cancelamento'));
  END IF;
END $$;

COMMENT ON COLUMN cb_automation_reminders.motivo IS
  'disparo = o lembrete saiu; cancelamento = a reuniao foi cancelada no '
  'Calendly e a trava foi PRE-ARMADA para o lembrete nao sair. Sem isto, '
  '`disparado_em` afirmaria envio que nunca houve.';

-- ------------------------------------------------------------
-- Conferência (catálogo, sem depender de dado).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_calendly_eventos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%cancelado%'
  ) THEN
    RAISE EXCEPTION '1013: o CHECK de resultado nao aceita cancelado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cb_automation_reminders'
      AND column_name = 'motivo'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '1013: cb_automation_reminders.motivo ausente ou anulavel';
  END IF;

  RAISE NOTICE '1013: cancelamento do Calendly pronto (resultado + motivo).';
END $$;

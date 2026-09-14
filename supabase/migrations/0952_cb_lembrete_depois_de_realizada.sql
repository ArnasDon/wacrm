-- ============================================================
-- 952 — Lembrete "depois" da reunião tem de aceitar reunião REALIZADA
--
-- A 947 filtra `status = 'agendada'` — correto para o lembrete ANTES
-- ("sua reunião é amanhã" sobre reunião cancelada afirmaria algo falso),
-- e errado para o follow-up DEPOIS: a janela do "depois" cai após o
-- início, e marcar `realizada` é exatamente o que o operador diligente
-- faz nesse meio-tempo. Com o filtro da 947, o follow-up só saía para
-- quem NÃO atualiza a agenda.
--
-- `falta` e `cancelada` continuam fora nas DUAS direções: follow-up de
-- reunião que não aconteceu ("obrigado pela reunião") mente ao cliente.
--
-- ⚠️ A direção é decidida pelo CHAMADOR (`varrerLembretes` conhece a
-- config da automação), não pela função — por isso o parâmetro booleano
-- e não um `p_direcao` que obrigasse a função a reimplementar a janela.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Recriar a função com o parâmetro
--
-- ⚠️ DROP antes do CREATE, e não CREATE OR REPLACE: acrescentar parâmetro
-- muda a assinatura, então o REPLACE criaria uma SEGUNDA função (overload).
-- Com as duas vivas, a chamada RPC com 3 argumentos casa com ambas (o 4º
-- tem DEFAULT) e o PostgREST devolve erro de ambiguidade — a varredura
-- inteira pararia, não só o caso novo.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz);

CREATE FUNCTION cb_alvos_de_lembrete_reuniao(
  p_account_id         uuid,
  p_de                 timestamptz,
  p_ate                timestamptz,
  p_incluir_realizadas boolean DEFAULT false
)
RETURNS TABLE (contact_id uuid, valor text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.contact_id,
         -- ⚠️ ISO 8601 com fuso (ver 947): o valor é chave de deduplicação e
         -- aparece no log — um horário sem offset seria lido como UTC e
         -- mandaria o diagnóstico para o lado errado (armadilha da 935).
         to_char(m.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    FROM cb_meetings m
   WHERE m.account_id = p_account_id
     -- Sem contato não há para quem mandar (reunião interna do escritório).
     AND m.contact_id IS NOT NULL
     -- ⚠️ `agendada` sempre; `realizada` SÓ quando o chamador pede (direção
     -- "depois"). `falta` e `cancelada` nunca — são reuniões que não
     -- aconteceram, e um lembrete sobre elas afirmaria algo falso.
     AND (m.status = 'agendada'
          OR (p_incluir_realizadas AND m.status = 'realizada'))
     AND m.starts_at >  p_de
     AND m.starts_at <= p_ate;
$$;

COMMENT ON FUNCTION cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz, boolean) IS
  'Alvos do gatilho de lembrete quando a fonte da data e a AGENDA (947/952). '
  'p_incluir_realizadas=true no follow-up ("depois"): reuniao realizada ainda gera follow-up.';

-- ⚠️ As DUAS metades do REVOKE (ver CLAUDE.md — o engano já foi cometido três
-- vezes: 913, 914, 915). E o GRANT de volta ao service_role por escrito: num
-- banco vazio o default privilege do Supabase não existe, e sem o GRANT o CI
-- reprova e o cron pararia num self-host novo.
REVOKE EXECUTE ON FUNCTION cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz, boolean)
  TO service_role;

-- ------------------------------------------------------------
-- 2) Alargar o índice da varredura
--
-- O parcial da 947 cobre só `status = 'agendada'` — a consulta do follow-up
-- (que agora também olha `realizada`) ficaria fora dele. A tabela é pequena
-- e um seq scan não doeria hoje, mas o índice existe para a consulta que o
-- cron repete a cada ciclo; deixá-lo cobrindo só metade dos casos é convite
-- para ninguém notar quando doer.
-- ------------------------------------------------------------

DROP INDEX IF EXISTS cb_meetings_lembrete_idx;
CREATE INDEX cb_meetings_lembrete_idx
  ON cb_meetings (account_id, starts_at)
  WHERE status IN ('agendada', 'realizada') AND contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) Conferência — metadado, nunca dado (regra do banco vazio)
-- ------------------------------------------------------------

DO $$
DECLARE
  v_qtd int;
BEGIN
  -- A assinatura antiga tem de ter SUMIDO: com as duas vivas, a chamada RPC
  -- de 3 argumentos vira ambígua e a varredura inteira quebra.
  SELECT count(*) INTO v_qtd
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'cb_alvos_de_lembrete_reuniao';
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION '952: esperava 1 cb_alvos_de_lembrete_reuniao, achei % (overload ambiguo)', v_qtd;
  END IF;

  IF has_function_privilege(
       'anon',
       'cb_alvos_de_lembrete_reuniao(uuid,timestamptz,timestamptz,boolean)',
       'EXECUTE') THEN
    RAISE EXCEPTION '952: anon ainda executa cb_alvos_de_lembrete_reuniao';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'cb_alvos_de_lembrete_reuniao(uuid,timestamptz,timestamptz,boolean)',
       'EXECUTE') THEN
    RAISE EXCEPTION '952: authenticated ainda executa cb_alvos_de_lembrete_reuniao';
  END IF;

  IF NOT has_function_privilege(
       'service_role',
       'cb_alvos_de_lembrete_reuniao(uuid,timestamptz,timestamptz,boolean)',
       'EXECUTE') THEN
    RAISE EXCEPTION '952: service_role NAO executa — o cron nao varreria os lembretes de reuniao';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'cb_meetings_lembrete_idx'
  ) THEN
    RAISE EXCEPTION '952: indice da varredura sumiu no realargamento';
  END IF;

  RAISE NOTICE '952: follow-up "depois" aceita reuniao realizada.';
END $$;

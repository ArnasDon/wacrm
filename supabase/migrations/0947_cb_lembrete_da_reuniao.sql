-- ============================================================
-- 947 — Lembrete a partir da REUNIÃO, não só do campo personalizado
--
-- O gatilho de lembrete por data (935) lê a hora de um campo personalizado do
-- contato — que é o que a automação do Calendly preenche. Reunião marcada
-- direto na agenda (945) não passa por ali e, por isso, **não avisa ninguém**.
--
-- Esta migration acrescenta a segunda fonte. Uma função irmã da
-- `cb_alvos_de_lembrete`, com a mesma assinatura de saída, para o motor
-- escolher a fonte e o resto do caminho continuar idêntico.
--
-- ⚠️ POR QUE NÃO UM MOTOR DE LEMBRETES NA AGENDA
-- Porque já existe um, e ele funciona. Um segundo motor significaria duas telas
-- configurando a mesma coisa, com o operador tendo de lembrar qual delas manda
-- em cada reunião. Decisão do operador em 2026-08-29, e ela está certa: a
-- agenda é FONTE DE DATA para o motor de automações, não um motor paralelo.
--
-- ⚠️ O QUE ESTA MIGRATION NÃO FAZ
-- Nada dispara sozinho por causa dela. Quem varre é
-- `varrerLembretes()` dentro de `/api/automations/cron`, no laço de 60 s que já
-- roda — o mesmo lugar de onde a 935 é varrida. Nenhuma mudança na VPS.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Os alvos, vindos da agenda
--
-- Devolve `(contact_id, valor)` como a irmã da 935, porque é esse par que a
-- trava anti-repetição usa. O `valor` é o `starts_at` em texto ISO — e isso é
-- load-bearing: a chave única de `cb_automation_reminders` inclui o valor,
-- então **remarcar a reunião re-arma o lembrete sozinho**, e o mesmo horário
-- nunca dispara duas vezes.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION cb_alvos_de_lembrete_reuniao(
  p_account_id uuid,
  p_de         timestamptz,
  p_ate        timestamptz
)
RETURNS TABLE (contact_id uuid, valor text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.contact_id,
         -- ⚠️ ISO 8601 com fuso (`YYYY-MM-DD"T"HH24:MI:SSOF`). Sem o offset
         -- escrito, quem lesse este texto de volta o interpretaria como UTC —
         -- a armadilha de 3 horas que a 935 documenta. Aqui o valor é só
         -- chave de deduplicação, mas ele aparece no log e no diagnóstico, e
         -- um horário mentiroso ali manda a próxima pessoa para o lado errado.
         to_char(m.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    FROM cb_meetings m
   WHERE m.account_id = p_account_id
     -- ⚠️ Sem contato não há para quem mandar: reunião interna do escritório
     -- não gera lembrete de cliente. Deixá-la passar faria o motor rodar uma
     -- automação sem alvo, e o passo de envio falharia lá na frente, longe
     -- da causa.
     AND m.contact_id IS NOT NULL
     -- ⚠️ Cancelada não lembra. `realizada` e `falta` também ficam de fora:
     -- as duas são passado, e um lembrete sobre elas afirmaria algo falso.
     AND m.status = 'agendada'
     AND m.starts_at >  p_de
     AND m.starts_at <= p_ate;
$$;

COMMENT ON FUNCTION cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz) IS
  'Alvos do gatilho de lembrete quando a fonte da data e a AGENDA (947). '
  'Irma de cb_alvos_de_lembrete, que le campo personalizado.';

-- ⚠️ As DUAS metades do REVOKE. A forma da concessão varia por função neste
-- banco (ver CLAUDE.md): umas nascem com `=X` para PUBLIC, outras com
-- concessão explícita por papel. Escrever só uma das metades não tira nada, e
-- o engano já foi cometido três vezes aqui (913, 914, 915).
REVOKE EXECUTE ON FUNCTION cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- E o `service_role` ganha de volta, EXPLICITAMENTE: em Postgres o EXECUTE
-- nasce concedido a PUBLIC, então revogar de PUBLIC tira dele junto. Em
-- produção o Supabase concede por *default privilege* e não se nota; num banco
-- vazio — que é o que o CI reaplica — o default não existe e o cron pararia.
GRANT EXECUTE ON FUNCTION cb_alvos_de_lembrete_reuniao(uuid, timestamptz, timestamptz)
  TO service_role;

-- ------------------------------------------------------------
-- 2) Índice para a varredura
--
-- A consulta acima roda a cada ciclo do cron, uma vez por automação de
-- lembrete ativa. Parcial porque a varredura só olha reunião agendada COM
-- cliente — o índice fica pequeno e não é pago pelas outras.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS cb_meetings_lembrete_idx
  ON cb_meetings (account_id, starts_at)
  WHERE status = 'agendada' AND contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) Conferência — metadado, nunca dado
--
-- Toda afirmação abaixo é sobre privilégio e existência. Conferência que
-- exigisse linha presente reprovaria num banco vazio por falta de dado, não
-- por defeito.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF has_function_privilege(
       'anon',
       'cb_alvos_de_lembrete_reuniao(uuid,timestamptz,timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION '947: anon ainda executa cb_alvos_de_lembrete_reuniao';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'cb_alvos_de_lembrete_reuniao(uuid,timestamptz,timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION '947: authenticated ainda executa cb_alvos_de_lembrete_reuniao';
  END IF;

  IF NOT has_function_privilege(
       'service_role',
       'cb_alvos_de_lembrete_reuniao(uuid,timestamptz,timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION '947: service_role NAO executa — o cron nao varreria os lembretes de reuniao';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'cb_meetings_lembrete_idx'
  ) THEN
    RAISE EXCEPTION '947: indice da varredura nao foi criado';
  END IF;

  RAISE NOTICE '947: lembrete a partir da agenda pronto (fonte "reuniao").';
END $$;

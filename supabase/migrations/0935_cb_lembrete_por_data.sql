-- ============================================================
-- 935 — Gatilho de LEMBRETE por data de campo personalizado
--
-- "24 horas antes da reunião, mande a confirmação." É o padrão que o operador
-- chamou de essencial, e é literal do print do Kommo ("24 horas antes Lead:
-- Reunião Marcada").
--
-- ⚠️ POR QUE NÃO É O `time_based` DO UPSTREAM
--
-- Aquele gatilho existe no enum desde sempre e nunca disparou — e não é só
-- falta de código: ele não tem ALVO. O motor roda por contato, e "todo dia às
-- 9h" não diz para qual. Este aqui dispara POR CONTATO, porque a hora vem de
-- um campo DO CONTATO. A pergunta "para quem?" se responde sozinha.
--
-- ⚠️ FUSO. O contêiner roda em UTC e quem digita está em Brasília. A tela
-- grava ISO 8601 com fuso explícito (`...Z`), e é isso que
-- `cb_para_timestamp` recebe. Gravar "2026-08-05 14:00" cru faria o Postgres
-- interpretar como UTC e todo lembrete erraria por 3 horas — sem erro nenhum,
-- só chegando na hora errada.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Casamento SEGURO de texto para timestamp
--
-- `contact_custom_values.value` é TEXT livre: o mesmo campo pode ter
-- "2026-08-05T17:00:00Z" numa linha e "amanhã de tarde" na outra, porque
-- nada impede. Um `value::timestamptz` cru derrubaria a varredura INTEIRA por
-- causa de uma linha ruim — e a varredura é o que faz o lembrete sair.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION cb_para_timestamp(p_texto text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_texto::timestamptz;
EXCEPTION WHEN OTHERS THEN
  -- Texto que não é data. Não é erro: é campo livre usado para outra coisa.
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_para_timestamp(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) Quem deve receber o lembrete AGORA
--
-- ⚠️ A janela é feita no BANCO, não em JS lendo tudo. Ler
-- `contact_custom_values` inteiro e filtrar no cliente esbarra no teto de
-- 1000 linhas do PostgREST **sem avisar**: a varredura ficaria incompleta com
-- cara de completa, e o lembrete simplesmente não sairia para parte dos
-- clientes. Aqui só as linhas que casam atravessam a fronteira.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION cb_alvos_de_lembrete(
  p_account_id      uuid,
  p_custom_field_id uuid,
  p_de              timestamptz,
  p_ate             timestamptz
)
RETURNS TABLE (contact_id uuid, valor text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT v.contact_id, v.value
    FROM contact_custom_values v
    JOIN contacts c ON c.id = v.contact_id
   WHERE v.custom_field_id = p_custom_field_id
     -- `contact_custom_values` não tem `account_id` (a tenancy é via contato),
     -- e o motor roda em service-role ignorando RLS: este filtro é a barreira.
     AND c.account_id = p_account_id
     AND cb_para_timestamp(v.value) >  p_de
     AND cb_para_timestamp(v.value) <= p_ate;
$$;

REVOKE EXECUTE ON FUNCTION cb_alvos_de_lembrete(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ⚠️ E o `service_role` precisa ganhar de volta, EXPLICITAMENTE. Em Postgres o
-- EXECUTE de função nasce concedido a PUBLIC; revogar de PUBLIC tira de todo
-- mundo que dependia disso — inclusive dele. Em produção não se notou porque o
-- Supabase concede EXECUTE ao service_role por *default privilege*, que nenhuma
-- migration escreveu. Num banco novo esse default não existe, e a conferência
-- logo abaixo reprovava com "service_role NAO executa".
--
-- É o motor/cron/webhook que chama esta função, sempre com service_role.
-- Em produção é no-op; GRANT é idempotente.
GRANT EXECUTE ON FUNCTION cb_alvos_de_lembrete(uuid, uuid, timestamptz, timestamptz)
  TO service_role;

-- ------------------------------------------------------------
-- 3) Trava anti-repetição
--
-- ⚠️ A chave inclui o VALOR do campo, não só automação+contato. É o que faz
-- reunião REMARCADA re-armar o lembrete (valor novo = chave nova) enquanto o
-- mesmo horário nunca dispara duas vezes. Sem o valor na chave, remarcar
-- deixaria o cliente sem aviso; sem a trava, cada ciclo do cron mandaria a
-- mesma mensagem de novo.
--
-- O INSERT é a própria reivindicação: colisão do índice único = alguém já
-- mandou. Nada de ler-depois-escrever, que abriria janela para dois ciclos
-- sobrepostos dispararem juntos.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cb_automation_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  /** O valor do campo no momento do disparo — parte da chave. */
  valor         text NOT NULL,
  disparado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, contact_id, valor)
);

COMMENT ON TABLE cb_automation_reminders IS
  'Trava anti-repeticao do gatilho de lembrete por data. A chave inclui o '
  'VALOR do campo: reuniao remarcada re-arma, mesmo horario nunca repete.';

CREATE INDEX IF NOT EXISTS cb_automation_reminders_poda_idx
  ON cb_automation_reminders (disparado_em);

ALTER TABLE cb_automation_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_automation_reminders FROM anon, authenticated;
GRANT ALL ON TABLE cb_automation_reminders TO service_role;

-- ------------------------------------------------------------
-- 4) Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------

DO $$
BEGIN
  IF has_function_privilege('anon', 'cb_alvos_de_lembrete(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa cb_alvos_de_lembrete';
  END IF;
  IF has_function_privilege('authenticated', 'cb_para_timestamp(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ainda executa cb_para_timestamp';
  END IF;
  IF has_table_privilege('anon', 'cb_automation_reminders', 'SELECT') THEN
    RAISE EXCEPTION 'anon ainda le cb_automation_reminders';
  END IF;
  -- E o caminho que PRECISA funcionar.
  IF NOT has_function_privilege('service_role', 'cb_alvos_de_lembrete(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role NAO executa cb_alvos_de_lembrete';
  END IF;
  IF cb_para_timestamp('nao sou data') IS NOT NULL THEN
    RAISE EXCEPTION 'cb_para_timestamp deveria devolver NULL para lixo';
  END IF;
  IF cb_para_timestamp('2026-08-05T17:00:00Z') IS NULL THEN
    RAISE EXCEPTION 'cb_para_timestamp deveria casar ISO com fuso';
  END IF;
END $$;

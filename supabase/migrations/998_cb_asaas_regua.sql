-- 998_cb_asaas_regua.sql
--
-- Asaas — a RÉGUA DE COBRANÇA (Fase 3 de docs/PLANO-integracao-asaas.md, §3.6),
-- com as decisões do operador de 12 e 13/09/2026.
--
-- 1) `cb_asaas_config`:
--    - `regua_ativa` (D20): o interruptor de cima, "Cobrança automática".
--      Nasce DESLIGADO. Desligado, a varredura não seleciona candidata
--      nenhuma — nem lembrete do vencimento, nem marco de atraso —, e cada
--      automação continua com o seu liga/desliga por baixo.
--    - `regua_ativada_em` (D13): carimbado ao LIGAR. Só a parcela vista
--      vencida DEPOIS disto entra na régua: na primeira sincronização TODAS
--      as vencidas ganham `vista_vencida_em` = aquele dia, e ligar a régua
--      não pode despejar as 405 de uma vez — nem o marco de 30 dias delas,
--      semanas depois ("se atrasar mais uma vez, aí sim recebe").
--    - `regua_intervalo_dias` (D11, 13/09): o intervalo mínimo entre
--      COBRANÇAS ao mesmo cliente (3 por padrão); o marco que cai dentro
--      dele é `absorvida`. Vale entre cobranças — o lembrete do vencimento
--      não conta nem é contado.
--
-- 2) `cb_asaas_clientes.regua_desligada` (D21, pedido do operador em 13/09):
--    a LISTA DE EXCEÇÃO — "não cobrar automaticamente" por cliente do Asaas,
--    com quem e quando. Por cliente do Asaas, e não por contato, porque a
--    régua agrupa por cliente (D11): o mesmo contato pode ter a pessoa e a
--    empresa. A planilha do operador (41 nomes com CPF/CNPJ) nasce marcada
--    por um UPDATE fora do repositório — documento não entra em migration.
--
-- 3) `automations.assinatura_personalizada` (D18): "Assinar como" da
--    automação ("Carol - financeiro"), prefixo de todo `send_message` dela,
--    sob o interruptor `accounts.assinatura_ativa`. NULL = o nome automático
--    do escritório, como hoje. Mora na AUTOMAÇÃO, não no passo nem num
--    catálogo: uma régua são 3–4 automações e a mesma pessoa assina todas.
--
-- 4) `cb_asaas_regua_envios` — a TRAVA e o REGISTRO da régua, numa tabela só
--    (não é podada em 90 dias como a dos lembretes: é histórico de cobrança).
--    A trava é do MARCO, não da automação: `UNIQUE (cobranca_id, tipo, marco,
--    vencimento)` — duas automações do mesmo marco disputam a mesma trava e
--    só uma envia; editar o marco de uma automação não herda as travas do
--    antigo; a chave inclui o vencimento porque parcela renegociada rearma a
--    régua, como reunião remarcada. O lembrete usa `tipo = 'vence_hoje'` e
--    `marco = 0` (a tela rotula como "lembrete do vencimento", nunca "0 dias
--    de atraso"). ⚠️ O INSERT do grupo do cliente é UM comando com várias
--    linhas: 23505 em qualquer parcela recusa o grupo INTEIRO — é o que
--    serializa dois processos (o deploy `start-first` tem dois Node vivos).
--    `asaas_customer_id` fica na linha para o intervalo mínimo e o "uma por
--    cliente por dia" serem uma consulta.
--    ⚠️ `na_fila` e `automation_log_id` existem por causa da RETENTATIVA do
--    motor (13/09/2026, PR #205): um `send_message` que o provedor RECUSA
--    (4xx) volta para a fila do "Aguardar" e roda de novo em 30 s / 5 min,
--    fora da varredura. A trava registra `na_fila` com o id do log, e a
--    varredura seguinte RECONCILIA pelo log (`enviado`/`falhou`/`barrada`;
--    sem desfecho depois de 1 h, `incerto`). Enquanto isso o cliente conta
--    como cobrado (intervalo mínimo e "uma por dia") — mandar de menos é o
--    lado seguro de uma cobrança.
--
-- A FK composta para `cb_asaas_cobrancas` exige o índice único `(id,
-- account_id)` lá (a rota roda em service role; FK simples só garante
-- "existe uma cobrança com esse id").
--
-- Tudo FECHADO ao navegador, como as outras do Asaas (992/994/997). `anon`
-- sem nada (931). `service_role` com tudo, POR ESCRITO. Aditiva e idempotente:
-- o app anterior não lê nada disto, e `regua_ativa` nasce falso.

CREATE UNIQUE INDEX IF NOT EXISTS cb_asaas_cobrancas_id_account_idx
  ON cb_asaas_cobrancas (id, account_id);

ALTER TABLE cb_asaas_config
  ADD COLUMN IF NOT EXISTS regua_ativa           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regua_ativada_em      timestamptz,
  ADD COLUMN IF NOT EXISTS regua_intervalo_dias  integer NOT NULL DEFAULT 3
    CHECK (regua_intervalo_dias >= 0 AND regua_intervalo_dias <= 60);

ALTER TABLE cb_asaas_clientes
  ADD COLUMN IF NOT EXISTS regua_desligada       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regua_desligada_por   text,
  ADD COLUMN IF NOT EXISTS regua_desligada_em    timestamptz;

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS assinatura_personalizada text;

CREATE TABLE IF NOT EXISTS cb_asaas_regua_envios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cobranca_id        uuid NOT NULL,
  asaas_customer_id  text NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('atraso', 'vence_hoje')),
  marco              integer NOT NULL DEFAULT 0,
  vencimento         date NOT NULL,
  automation_id      uuid REFERENCES automations(id) ON DELETE SET NULL,
  automation_nome    text NOT NULL,
  contact_id         uuid,
  -- o log da execução que a varredura disparou (para reconciliar `na_fila`);
  -- SET NULL porque o log pode ser podado sem levar o histórico da cobrança
  automation_log_id  uuid REFERENCES automation_logs(id) ON DELETE SET NULL,
  resultado          text NOT NULL DEFAULT 'reservado' CHECK (resultado IN
                       ('reservado', 'enviado', 'absorvida', 'barrada', 'falhou', 'fora_do_escopo', 'sem_automacao', 'incerto', 'na_fila')),
  detalhe            text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  finalizado_em      timestamptz,
  CONSTRAINT cb_asaas_regua_envios_marco_ck
    CHECK ((tipo = 'vence_hoje' AND marco = 0) OR (tipo = 'atraso' AND marco > 0)),
  CONSTRAINT cb_asaas_regua_envios_uk UNIQUE (cobranca_id, tipo, marco, vencimento),
  CONSTRAINT cb_asaas_regua_envios_cobranca_fk FOREIGN KEY (cobranca_id, account_id)
    REFERENCES cb_asaas_cobrancas (id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_asaas_regua_envios_contato_fk FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id)
);

-- A aba Cobranças ("Cobrança automática: 1 dia · enviada em …") e o
-- intervalo mínimo / "uma por cliente por dia" da varredura.
CREATE INDEX IF NOT EXISTS cb_asaas_regua_envios_contato_idx
  ON cb_asaas_regua_envios (account_id, contact_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS cb_asaas_regua_envios_cliente_idx
  ON cb_asaas_regua_envios (account_id, asaas_customer_id, criado_em DESC);

ALTER TABLE cb_asaas_regua_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_regua_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_regua_envios TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['regua_ativa', 'regua_ativada_em', 'regua_intervalo_dias'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cb_asaas_config' AND column_name = c
    ) THEN
      RAISE EXCEPTION '998: cb_asaas_config.% ausente', c;
    END IF;
  END LOOP;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cb_asaas_config' AND column_name = 'regua_ativa') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '998: regua_ativa tem de nascer DESLIGADA (D20)';
  END IF;
  FOREACH c IN ARRAY ARRAY['regua_desligada', 'regua_desligada_por', 'regua_desligada_em'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cb_asaas_clientes' AND column_name = c
    ) THEN
      RAISE EXCEPTION '998: cb_asaas_clientes.% ausente — a lista de exceção (D21) não teria onde morar', c;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'automations' AND column_name = 'assinatura_personalizada'
  ) THEN
    RAISE EXCEPTION '998: automations.assinatura_personalizada ausente (D18)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cb_asaas_regua_envios') THEN
    RAISE EXCEPTION '998: tabela cb_asaas_regua_envios ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.cb_asaas_regua_envios'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION '998: RLS desligada em cb_asaas_regua_envios';
  END IF;
  IF has_table_privilege('anon', 'public.cb_asaas_regua_envios', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_asaas_regua_envios', 'INSERT') THEN
    RAISE EXCEPTION '998: anon ainda alcança cb_asaas_regua_envios';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_asaas_regua_envios', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_regua_envios', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_regua_envios', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_asaas_regua_envios', 'DELETE') THEN
    RAISE EXCEPTION '998: authenticated alcança cb_asaas_regua_envios — tudo passa pela rota';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_asaas_regua_envios', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_asaas_regua_envios', 'SELECT') THEN
    RAISE EXCEPTION '998: service_role sem acesso a cb_asaas_regua_envios';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_regua_envios'::regclass AND conname = 'cb_asaas_regua_envios_uk' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '998: a trava do marco (UNIQUE cobranca_id, tipo, marco, vencimento) está ausente — a régua mandaria duas vezes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_regua_envios'::regclass AND conname = 'cb_asaas_regua_envios_cobranca_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '998: FK composta para cb_asaas_cobrancas ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_regua_envios'::regclass AND conname = 'cb_asaas_regua_envios_contato_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '998: FK composta para contacts ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cb_asaas_regua_envios' AND column_name = 'automation_log_id'
  ) THEN
    RAISE EXCEPTION '998: automation_log_id ausente — a trava na_fila não teria como ser reconciliada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_regua_envios'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%resultado%na_fila%'
  ) THEN
    RAISE EXCEPTION '998: o CHECK de resultado não aceita na_fila (a retentativa do motor, PR #205)';
  END IF;
END $$;

-- 994_cb_asaas_espelho.sql
--
-- Asaas — o ESPELHO: os clientes do Asaas com o VÍNCULO à ficha do CRM, e as
-- cobranças que o CRM já viu vencidas (mais a que vence HOJE, para o
-- lembrete do vencimento). Fase 1a-espelho de docs/PLANO-integracao-asaas.md.
--
-- A 992 guardou só a conexão (a chave cifrada), de propósito: a forma destas
-- duas tabelas dependia do LEVANTAMENTO da conta real, rodado em 12/09/2026
-- (§2.5 do plano). O que ele mudou está na forma delas:
--
--   - 79,5% dos clientes do Asaas não tinham ficha no CRM, e o operador
--     decidiu que o CRM CRIA a ficha (D2). Daí o valor `'criada'` em
--     `vinculo_origem`: é a marca de "esta ficha nasceu do Asaas". `contacts`
--     não ganha coluna de origem por carona.
--   - 85 clientes não têm telefone nenhum; para eles a única régua é o NOME
--     APROXIMADO (D5), que só SUGERE — as sugestões ficam em `candidatos`.
--   - O CPF/CNPJ vem 100% preenchido e é guardado (só dígitos), mas nunca
--     sai inteiro por rota nenhuma: mascarado, e só para administrador (D3).
--     A tabela é FECHADA ao navegador justamente por isso.
--   - O que vence HOJE entra no espelho (D17, o lembrete das 8h) com
--     `vista_vencida_em` NULO — ela não está vencida; é isso que a separa das
--     vencidas nas consultas do aviso. O resto do futuro fica FORA: o espelho
--     responde "quem deve" e "quem regularizou", não copia o Asaas.
--
-- Duas tabelas, as duas FECHADAS ao navegador (RLS ligada, nenhuma policy,
-- `REVOKE ALL` de `PUBLIC`/`anon`/`authenticated`, `GRANT ALL` a
-- `service_role` por escrito), como a 992 e as do Calendly (977): a tela lê
-- por rota, e a rota devolve também o que o membro não enxergaria (se o
-- Asaas está conectado e se a leitura é fresca). Sem isso, "Em dia" viraria
-- afirmação sobre dado parado — e qualquer membro leria o CPF pelo PostgREST.
--
-- 1) `cb_asaas_clientes` — um por cliente do Asaas (`cus_…`):
--    - `contact_id`: o VÍNCULO. NULL = sem ficha, desligado ou ignorado.
--      FK COMPOSTA `(contact_id, account_id)` como na 987 — a rota roda em
--      service role, e FK simples só garante "existe um contato com esse
--      id". `ON DELETE SET NULL (contact_id)`, coluna NOMEADA: `account_id`
--      é NOT NULL e SET NULL sem lista tentaria zerá-la junto (lição da 966).
--    - `vinculo_origem`: COMO ligou — `telefone`, `cpf` (cadastro duplicado
--      no Asaas, mesmo CPF já ligado), `email`, `criada` (a ficha nasceu do
--      Asaas, D2), `manual` (uma pessoa escolheu) ou `desvinculado`
--      ("Ignorar": fornecedor cadastrado no Asaas — a regra automática não
--      olha mais). ⚠️ A elegibilidade em SQL é `IS NULL OR IN (…)`, nunca
--      `<> 'desvinculado'`: com a coluna nula (todo cliente novo) a
--      comparação dá NULL e exclui o cliente sem erro nenhum.
--    - `contatos_recusados`: contatos DESLIGADOS por gente. A regra nunca
--      liga este cliente a eles de novo — nem depois de um vínculo manual.
--    - `candidatos`: `[{ contact_id, motivo, pontuacao? }]` que a regra NÃO
--      aplicou — sufixo de 8, nome aproximado, ambiguidade, o contato já
--      ligado a outro CPF. É o que a tela mostra em "Para confirmar" e
--      "Sem ficha", com os botões Ligar/Ignorar.
--    - `vinculado_por_nome`: carimbado pela rota, sobrevive à saída do login.
--    - `visto_em`: a última listagem que trouxe este cliente. Quem não
--      voltou na listagem completa vira `deleted`.
--    - `cpf_cnpj`, `email`, `celular`, `telefone`: só dígitos / minúsculas;
--      o telefone já com o 55 (o Asaas devolve SEM DDI — C1, medido).
--
-- 2) `cb_asaas_cobrancas` — toda cobrança que o CRM já viu vencida, mais a
--    que vence hoje, com o estado ATUAL do Asaas:
--    - `status`: o enum do Asaas CRU, SEM CHECK. "Atributos novos podem
--      aparecer a qualquer momento", diz a doc; um CHECK derrubaria a
--      sincronização inteira por causa de um status novo. Quem interpreta é
--      `classificar()` em `src/lib/asaas/inadimplencia.ts`.
--    - `vencimento` (DATE): A DATA DA INADIMPLÊNCIA desta parcela. Os dias de
--      atraso NÃO são gravados — são calculados na leitura, no fuso do
--      escritório, como o `aguardando_desde` da 972. Gravado, o número
--      ficaria errado em toda linha que o cron não tocasse depois da
--      meia-noite. E a coluna nunca passa por `new Date("2026-09-01")`, que é
--      meia-noite UTC e retrocede um dia no Brasil.
--    - `vista_vencida_em`: a PRIMEIRA vez que o espelho a viu vencida; nunca
--      reescrito. É o que protege o marco de 1 dia da régua (Fase 3) quando o
--      Asaas só marca vencida no dia útil seguinte (C7).
--    - `visto_em`: a última listagem que a trouxe. Vencida com `visto_em`
--      anterior à última listagem completa "sumiu" (pagou, foi apagada,
--      renegociada) e é relida uma a uma na reconciliação; até lá fica "em
--      conferência" e sai do aviso.
--    - O vínculo NÃO é copiado para cá: o contato da cobrança se resolve por
--      `cb_asaas_clientes`. Uma cópia exigiria reescrever todas as cobranças
--      a cada ligar/desligar, e duas fontes divergem na primeira falha.
--    - FK composta para o cliente `(account_id, asaas_customer_id)`: a
--      cobrança de cliente desconhecido exige a linha do cliente antes.
--
-- Os dois UNIQUE são TOTAIS — são os alvos do `upsert` do PostgREST, que
-- não aceita índice parcial (lição da 903).
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda. Idempotente.

-- A FK composta abaixo precisa do índice único `(id, account_id)` em
-- `contacts`, que a 945 criou. Repetido por idempotência (no-op onde já
-- existe; no banco reconstruído do zero a 945 vem antes).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx ON contacts (id, account_id);

-- ---------------------------------------------------------------------------
-- 1) clientes do Asaas e o VÍNCULO com a ficha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_asaas_clientes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asaas_customer_id        text NOT NULL,
  contact_id               uuid,
  nome                     text NOT NULL DEFAULT '',
  cpf_cnpj                 text,
  email                    text,
  celular                  text,
  telefone                 text,
  notificacoes_desligadas  boolean NOT NULL DEFAULT false,
  deleted                  boolean NOT NULL DEFAULT false,
  vinculo_origem           text CHECK (vinculo_origem IS NULL OR vinculo_origem IN
                             ('telefone', 'cpf', 'email', 'criada', 'manual', 'desvinculado')),
  vinculado_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vinculado_por_nome       text,
  vinculado_em             timestamptz,
  contatos_recusados       uuid[] NOT NULL DEFAULT '{}',
  candidatos               jsonb NOT NULL DEFAULT '[]'::jsonb,
  visto_em                 timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_asaas_clientes_uk UNIQUE (account_id, asaas_customer_id),
  CONSTRAINT cb_asaas_clientes_contato_fk FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id)
);

-- A aba Cobranças e a caixa de entrada: "que clientes do Asaas estão ligados
-- a esta ficha?" — e o resumo da caixa, por conta.
CREATE INDEX IF NOT EXISTS cb_asaas_clientes_contato_idx
  ON cb_asaas_clientes (account_id, contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE cb_asaas_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_clientes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_clientes TO service_role;

-- ---------------------------------------------------------------------------
-- 2) cobranças — as que o CRM já viu vencidas, mais a que vence HOJE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_asaas_cobrancas (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asaas_payment_id            text NOT NULL,
  asaas_customer_id           text NOT NULL,
  status                      text NOT NULL,
  deleted                     boolean NOT NULL DEFAULT false,
  valor                       numeric(12,2) NOT NULL,
  juros_e_multa               numeric(12,2),
  vencimento                  date NOT NULL,
  vencimento_original         date,
  vista_vencida_em            timestamptz,
  pago_em                     date,
  forma                       text,
  pode_pagar_apos_vencimento  boolean,
  dias_ate_cancelar_registro  integer,
  descricao                   text,
  parcelamento_id             text,
  parcela_numero              integer,
  parcela_total               integer,
  link_fatura                 text,
  link_boleto                 text,
  visto_em                    timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_asaas_cobrancas_uk UNIQUE (account_id, asaas_payment_id),
  CONSTRAINT cb_asaas_cobrancas_cliente_fk FOREIGN KEY (account_id, asaas_customer_id)
    REFERENCES cb_asaas_clientes (account_id, asaas_customer_id) ON DELETE CASCADE
);

-- O aviso e a lista de inadimplentes: as vencidas de cada cliente, pelo
-- vencimento. Parcial: paga e apagada ficam fora do índice.
CREATE INDEX IF NOT EXISTS cb_asaas_cobrancas_vencidas_idx
  ON cb_asaas_cobrancas (account_id, asaas_customer_id, vencimento)
  WHERE status IN ('OVERDUE', 'DUNNING_REQUESTED') AND NOT deleted;

ALTER TABLE cb_asaas_cobrancas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_cobrancas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_cobrancas TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_asaas_clientes', 'cb_asaas_cobrancas'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '994: tabela % ausente', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || t)::regclass AND relrowsecurity) THEN
      RAISE EXCEPTION '994: RLS desligada em %', t;
    END IF;
    -- Fechadas: o CPF e o espelho inteiro não passam pelo PostgREST.
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '994: anon ainda alcança %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION '994: authenticated alcança % — tudo passa pela rota', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '994: service_role sem acesso a %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_clientes'::regclass AND conname = 'cb_asaas_clientes_uk' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '994: UNIQUE (account_id, asaas_customer_id) ausente — o upsert da sincronização duplicaria o cliente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_clientes'::regclass AND conname = 'cb_asaas_clientes_contato_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '994: FK composta para contacts ausente — a rota em service role aceitaria contato de outra conta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_cobrancas'::regclass AND conname = 'cb_asaas_cobrancas_uk' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '994: UNIQUE (account_id, asaas_payment_id) ausente — o upsert da sincronização duplicaria a cobrança';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_cobrancas'::regclass AND conname = 'cb_asaas_cobrancas_cliente_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '994: FK da cobrança para o cliente ausente';
  END IF;
  -- O valor da D2 tem de estar no CHECK: a sincronização grava 'criada'.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_clientes'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%criada%'
  ) THEN
    RAISE EXCEPTION '994: o CHECK de vinculo_origem não aceita ''criada'' — a ficha criada pelo CRM não teria como ser marcada';
  END IF;
END $$;

-- 997_cb_asaas_webhook.sql
--
-- Asaas — o AVISO NA HORA (webhook), Fase 2 de docs/PLANO-integracao-asaas.md.
--
-- Até aqui o espelho só anda pelo ciclo de 15 minutos: um cliente que paga
-- às 9h05 continua "inadimplente" na conversa até o ciclo seguinte. Com o
-- webhook, o Asaas avisa o CRM em segundos; o ciclo continua sendo a
-- GARANTIA (fonte da verdade é o Asaas; o webhook só antecipa — §3.4).
--
-- Duas coisas nascem aqui, as duas FECHADAS ao navegador (992/994/977):
--
-- 1) Colunas em `cb_asaas_config`:
--    - `webhook_token`: o ENDEREÇO — o segmento da URL
--      (`/api/cb/asaas/webhook/<token>`) que diz de qual conta é a entrega.
--      Em claro, com índice único: é só endereço, e a rota o procura.
--    - `webhook_auth_token`: a CREDENCIAL, cifrada (`ENCRYPTION_KEY`). O
--      Asaas devolve o valor que NÓS informamos ao criar o webhook, em todas
--      as entregas, no cabeçalho `asaas-access-token` — comparação de
--      igualdade em tempo constante, não há HMAC. ⚠️ A lição da 982: o token
--      da URL não basta — URL vaza em log de proxy, histórico e captura de
--      tela; a credencial mora no cabeçalho.
--    - `webhook_asaas_id`: o id do webhook no Asaas (para conferir, religar e
--      apagar); `webhook_email`: para quem o Asaas manda os alertas de falha
--      de entrega (obrigatório na API dele).
--    - `webhook_state`: NULL = nunca tentado (o cron cria quando há endereço
--      público); `ativo`; `penalizado` (entregas com backoff); `interrompido`
--      (fila parada DEPOIS de o CRM já ter religado uma vez — precisa de
--      gente); `ausente` (apagado no painel do Asaas); `desligado` (por
--      decisão, aqui ou no painel); `sem_permissao` (a chave não tem
--      Webhooks em escrita — o ciclo de 15 min segue); `erro` (o Asaas
--      recusou a criação; código em `webhook_erro`).
--    - `webhook_religado_em`: o CRM religa a fila interrompida UMA vez; a
--      segunda interrupção vira "precisa de atenção", como a doc manda
--      (corrigir a causa antes de religar). Zerado só pelo "Religar" de gente.
--    - `webhook_conferido_em`: a última CONFERÊNCIA (`GET /webhooks/{id}`
--      pelo cron) OU TENTATIVA de criação — é o relógio da retentativa
--      diária do estado `erro`; `last_event_at`: a última entrega que chegou
--      (prova de vida).
--
-- 2) `cb_asaas_eventos` — cada entrega recebida: o id do evento (UNIQUE por
--    conta = idempotência: o Asaas entrega "pelo menos uma vez" e repete o
--    mesmo id no reenvio), o tipo, o id da cobrança, o `dateCreated` CRU do
--    evento (`"AAAA-MM-DD HH:mm:ss"` sem fuso — é o carimbo que mede C7, o
--    instante em que o Asaas marca a cobrança como vencida; convertê-lo com
--    um fuso presumido apagaria a medição) e o que o CRM fez com ele. SEM o
--    corpo do evento: ele traz valor, descrição e links da cobrança, que já
--    vão para a tabela dela (D8: o corpo é AVISO, a cobrança é relida na API).
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda. Aditiva e idempotente:
-- o app anterior não lê nada disto.
--
-- ⚠️ SEM PODA na v1, por decisão: `cb_asaas_eventos` cresce uma linha por
-- entrega (a conta gera unidades por dia — a mesma ordem de grandeza dos
-- eventos do Calendly, que também ficam), e a medição de C7 quer justamente
-- os `dateCreated` antigos. Quem decidir podar um dia tem a data em
-- `recebido_em`.
--
-- ⚠️ Deploy DEPOIS da migration: o app novo SELECIONA as colunas novas (o
-- cartão, o desconectar e o passo do webhook no cron) e o PostgREST recusa
-- o select inteiro sem elas. Aplicada em 13/09/2026 antes do merge — na
-- versão SEM a conferência do CHECK do bloco DO abaixo, acrescentada na
-- revisão do PR #204 depois da aplicação (só o bloco de conferência mudou;
-- o schema é o mesmo, e o replay do CI roda a versão atual).

ALTER TABLE cb_asaas_config
  ADD COLUMN IF NOT EXISTS webhook_token         text,
  ADD COLUMN IF NOT EXISTS webhook_auth_token    text,
  ADD COLUMN IF NOT EXISTS webhook_asaas_id      text,
  ADD COLUMN IF NOT EXISTS webhook_email         text,
  ADD COLUMN IF NOT EXISTS webhook_state         text
    CHECK (webhook_state IS NULL OR webhook_state IN
      ('ativo', 'penalizado', 'interrompido', 'ausente', 'desligado', 'sem_permissao', 'erro')),
  ADD COLUMN IF NOT EXISTS webhook_erro          text,
  ADD COLUMN IF NOT EXISTS webhook_religado_em   timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_conferido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_at         timestamptz;

-- A rota do webhook procura a conta pelo token da URL. Único e PARCIAL (a
-- conta sem webhook tem a coluna nula); não é alvo de upsert, então parcial serve.
CREATE UNIQUE INDEX IF NOT EXISTS cb_asaas_config_webhook_token_idx
  ON cb_asaas_config (webhook_token) WHERE webhook_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS cb_asaas_eventos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asaas_event_id     text NOT NULL,
  evento             text NOT NULL,
  asaas_payment_id   text,
  evento_criado_em   text,
  recebido_em        timestamptz NOT NULL DEFAULT now(),
  processado_em      timestamptz,
  resultado          text NOT NULL DEFAULT 'recebido' CHECK (resultado IN
                       ('recebido', 'aplicada', 'apagada', 'ignorada', 'chave', 'falhou')),
  detalhe            text,
  CONSTRAINT cb_asaas_eventos_uk UNIQUE (account_id, asaas_event_id)
);

CREATE INDEX IF NOT EXISTS cb_asaas_eventos_conta_idx
  ON cb_asaas_eventos (account_id, recebido_em DESC);

ALTER TABLE cb_asaas_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_eventos TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['webhook_token', 'webhook_auth_token', 'webhook_asaas_id', 'webhook_email',
                           'webhook_state', 'webhook_erro', 'webhook_religado_em', 'webhook_conferido_em', 'last_event_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cb_asaas_config' AND column_name = c
    ) THEN
      RAISE EXCEPTION '997: cb_asaas_config.% ausente', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'cb_asaas_config_webhook_token_idx'
  ) THEN
    RAISE EXCEPTION '997: índice do token do webhook ausente — a rota não teria como achar a conta';
  END IF;
  -- O CHECK viaja com o ADD COLUMN: uma aplicação parcial anterior que já
  -- tivesse a coluna pularia a coluna E o CHECK juntos, em silêncio.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_config'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%webhook_state%sem_permissao%'
  ) THEN
    RAISE EXCEPTION '997: o CHECK de webhook_state não existe — o estado aceitaria qualquer texto';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cb_asaas_eventos') THEN
    RAISE EXCEPTION '997: tabela cb_asaas_eventos ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.cb_asaas_eventos'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION '997: RLS desligada em cb_asaas_eventos';
  END IF;
  IF has_table_privilege('anon', 'public.cb_asaas_eventos', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_asaas_eventos', 'INSERT') THEN
    RAISE EXCEPTION '997: anon ainda alcança cb_asaas_eventos';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_asaas_eventos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_eventos', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_asaas_eventos', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_asaas_eventos', 'DELETE') THEN
    RAISE EXCEPTION '997: authenticated alcança cb_asaas_eventos — tudo passa pela rota';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_asaas_eventos', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_asaas_eventos', 'SELECT') THEN
    RAISE EXCEPTION '997: service_role sem acesso a cb_asaas_eventos';
  END IF;
  -- A config continua fechada: coluna nova não abre nada.
  IF has_table_privilege('authenticated', 'public.cb_asaas_config', 'SELECT') THEN
    RAISE EXCEPTION '997: authenticated alcança cb_asaas_config — o token de autenticação do webhook vazaria';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_asaas_eventos'::regclass AND conname = 'cb_asaas_eventos_uk' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '997: UNIQUE (account_id, asaas_event_id) ausente — a reentrega do Asaas seria processada duas vezes';
  END IF;
END $$;

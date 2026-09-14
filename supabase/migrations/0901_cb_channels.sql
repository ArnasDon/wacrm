-- ============================================================
-- 901_cb_channels.sql — Múltiplos canais de WhatsApp por conta
--
-- POR QUE ESTA TABELA EXISTE
-- Hoje uma conta tem UMA conexão: `whatsapp_config` com UNIQUE(account_id)
-- (017) e um discriminador `provider` ('meta'|'evolution') da migration 037.
-- O CB Advogados precisa de N conexões simultâneas — vários números da Meta
-- Cloud API E vários números conectados por QR Code via Evolution API.
--
-- `cb_channels` passa a ser o cadastro de conexões (uma linha por número).
--
-- DESENHO HÍBRIDO (decisão de arquitetura — ver CLAUDE.md / plano)
-- `whatsapp_config` NÃO é alterada e continua com no máximo UMA linha por conta:
-- ela é o "espelho do canal PADRÃO" que ~20 pontos do código herdado leem com
-- `.eq('account_id', …).single()` (envio, templates, broadcast, proxy de mídia,
-- registro na Meta, webhook). O canal padrão vive nas DUAS tabelas em sincronia
-- (escrita dupla, feita na aplicação). Canais ADICIONAIS vivem só aqui. Assim o
-- código herdado nunca vê uma segunda linha e nunca quebra.
--
-- ROTEAMENTO DE ENTRADA (por que os índices únicos são GLOBAIS)
-- O webhook recebe apenas a CHAVE (phone_number_id da Meta, instance_name da
-- Evolution) — nunca a conta. Para rotear a mensagem para exatamente uma conta,
-- a chave precisa ser única GLOBALMENTE, não por conta. Daí os índices parciais
-- únicos globais abaixo. (O sufixo aleatório de `buildInstanceName` torna a
-- colisão de instance_name entre contas improvável; o índice a impede de vez.)
--
-- CREDENCIAIS
-- `access_token` (Meta) e `api_key` (Evolution) gravados criptografados
-- (AES-256-GCM via ENCRYPTION_KEY) — mesmo formato de whatsapp_config, então o
-- backfill copia SEM descriptografar.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS cb_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Dono de registro (auditoria). Anulável de propósito: remover um membro não
  -- apaga os canais que a conta usa. A criação de contato/conversa que exige um
  -- user_id NOT NULL cai para whatsapp_config.user_id quando este for NULL.
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  kind          text NOT NULL CHECK (kind IN ('meta', 'evolution')),
  -- Nome que o operador dá ao canal ("Comercial", "Dr. Leonardo"). É o que
  -- aparece no seletor de canal dentro da conversa.
  label         text NOT NULL,
  -- Número E.164 efetivamente conectado (Meta: display_phone_number; Evolution:
  -- ownerJid, só conhecido após o scan do QR) — por isso nullable.
  display_phone text,

  -- Canal usado quando não há contexto de conversa (broadcast, 1ª mensagem).
  -- No máximo um por conta (índice parcial abaixo).
  is_default    boolean NOT NULL DEFAULT false,

  status        text NOT NULL DEFAULT 'disconnected'
                  CHECK (status IN ('disconnected', 'connecting', 'connected')),
  connected_at  timestamptz,
  last_error    text,

  -- ---- Meta Cloud API ----
  phone_number_id text,
  waba_id         text,
  access_token    text,   -- criptografado (AES-256-GCM)
  verify_token    text,

  -- ---- Evolution API ----
  server_url      text,   -- ex. https://api.exemplo.com (sem barra final)
  instance_name   text,
  api_key         text,   -- criptografado (AES-256-GCM)

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Cada tipo exige seus próprios campos de credencial/roteamento.
  CONSTRAINT cb_channels_required_by_kind CHECK (
    (kind = 'meta'      AND phone_number_id IS NOT NULL
                        AND access_token    IS NOT NULL)
    OR
    (kind = 'evolution' AND server_url   IS NOT NULL
                        AND instance_name IS NOT NULL
                        AND api_key       IS NOT NULL)
  )
);

-- Toda listagem é "os canais desta conta".
CREATE INDEX IF NOT EXISTS cb_channels_account_idx
  ON cb_channels (account_id);

-- ---- Roteamento de ENTRADA: chaves ÚNICAS GLOBAIS ----
-- O webhook só tem a chave, não a conta. Único global = rota inequívoca.
CREATE UNIQUE INDEX IF NOT EXISTS cb_channels_meta_route_idx
  ON cb_channels (phone_number_id)
  WHERE kind = 'meta' AND phone_number_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cb_channels_evolution_route_idx
  ON cb_channels (instance_name)
  WHERE kind = 'evolution' AND instance_name IS NOT NULL;

-- No máximo um canal padrão por conta.
CREATE UNIQUE INDEX IF NOT EXISTS cb_channels_one_default_idx
  ON cb_channels (account_id)
  WHERE is_default;

ALTER TABLE cb_channels ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro (viewer+) vê a lista de canais — ela aparece no
-- seletor dentro da conversa, que todo atendente usa.
-- ATENÇÃO: access_token / api_key estão nesta tabela e a policy não filtra
-- coluna (RLS é por linha). O código NUNCA seleciona esses campos para o
-- client — ver CB_CHANNEL_SAFE_COLUMNS em src/lib/cb-channels/repo.ts.
DROP POLICY IF EXISTS cb_channels_select ON cb_channels;
CREATE POLICY cb_channels_select ON cb_channels FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ (classe "configuração"), como api_keys (026).
DROP POLICY IF EXISTS cb_channels_insert ON cb_channels;
CREATE POLICY cb_channels_insert ON cb_channels FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS cb_channels_update ON cb_channels;
CREATE POLICY cb_channels_update ON cb_channels FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS cb_channels_delete ON cb_channels;
CREATE POLICY cb_channels_delete ON cb_channels FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- updated_at automático (função criada em 001).
DROP TRIGGER IF EXISTS set_updated_at ON cb_channels;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON cb_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BACKFILL — cada linha de whatsapp_config vira o canal PADRÃO da conta
--
-- ⚠️ RAMIFICADO POR `provider`. A versão anterior era Meta-only e incondicional:
-- ela transformava a linha `provider='evolution'` (phone_number_id/access_token
-- NULL) num canal `kind='meta'`, violando cb_channels_required_by_kind e
-- derrubando a migration inteira. Inspeção em produção (2026-07-23): a única
-- conta existente é `provider='evolution'` — exatamente o caso que quebrava.
--
-- Credenciais copiadas JÁ CRIPTOGRAFADAS (mesmo formato dos dois lados).
-- Idempotente: WHERE NOT EXISTS impede duplicar; os índices únicos são a rede.
-- ============================================================

-- Meta → canal 'meta'
INSERT INTO cb_channels (
  account_id, created_by, kind, label, is_default, display_phone,
  status, connected_at,
  phone_number_id, waba_id, access_token, verify_token
)
SELECT
  wc.account_id, wc.user_id, 'meta', 'WhatsApp Oficial', true, NULL,
  CASE WHEN wc.status = 'connected' THEN 'connected' ELSE 'disconnected' END,
  wc.connected_at,
  wc.phone_number_id, wc.waba_id, wc.access_token, wc.verify_token
FROM whatsapp_config wc
WHERE wc.provider = 'meta'
  AND wc.phone_number_id IS NOT NULL
  AND wc.access_token IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cb_channels c
    WHERE c.account_id = wc.account_id AND c.is_default
  );

-- Evolution → canal 'evolution' (base_url → server_url)
INSERT INTO cb_channels (
  account_id, created_by, kind, label, is_default, display_phone,
  status, connected_at,
  server_url, instance_name, api_key
)
SELECT
  wc.account_id, wc.user_id, 'evolution', 'WhatsApp (QR Code)', true, NULL,
  CASE WHEN wc.instance_state = 'open' OR wc.status = 'connected'
       THEN 'connected' ELSE 'disconnected' END,
  COALESCE(wc.last_connected_at, wc.connected_at),
  wc.base_url, wc.instance_name, wc.api_key
FROM whatsapp_config wc
WHERE wc.provider = 'evolution'
  AND wc.base_url IS NOT NULL
  AND wc.instance_name IS NOT NULL
  AND wc.api_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cb_channels c
    WHERE c.account_id = wc.account_id AND c.is_default
  );

COMMENT ON TABLE cb_channels IS
  'Canais de WhatsApp da conta (N por conta): Meta Cloud API e Evolution API. '
  'whatsapp_config permanece como espelho (1 linha/conta) do canal PADRÃO para o '
  'código herdado. Canal padrão sincronizado nas duas tabelas por escrita dupla.';

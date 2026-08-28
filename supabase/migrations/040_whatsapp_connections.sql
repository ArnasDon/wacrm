-- ============================================================
-- 040 — whatsapp_config → whatsapp_connections
--
-- Onda 1a do suporte a segundo provedor (UAZAPI). Rename puro: nenhuma
-- linha de código UAZAPI acompanha esta migração; a coluna `provider`
-- nasce com toda linha existente em 'meta'.
--
-- QUEBRA COORDENADA: código que aponta para `whatsapp_config` para de
-- funcionar no instante em que esta migração roda. Migração e aplicação
-- sobem juntas (spec §6).
--
-- Spec: docs/superpowers/specs/2026-08-28-uazapi-onda-1a-migracao-040.md
-- Spec-mãe §4.1: docs/superpowers/specs/2026-08-27-uazapi-provider-design.md
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela: rename + coluna credential
-- ------------------------------------------------------------
ALTER TABLE whatsapp_config RENAME TO whatsapp_connections;
ALTER TABLE whatsapp_connections RENAME COLUMN access_token TO credential;

-- ------------------------------------------------------------
-- 2. Colunas novas (não usadas na 1a; ver spec-mãe §4.1)
-- ------------------------------------------------------------
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi')),
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_phone TEXT,
  ADD COLUMN IF NOT EXISTS profile_name TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_base_url TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_connection_error TEXT;

COMMENT ON COLUMN whatsapp_connections.credential IS
  'Meta: access token. UAZAPI: instance token. Mesmo encrypt()/decrypt().';
COMMENT ON COLUMN whatsapp_connections.provider IS
  'Backfill 040: toda linha pré-existente = meta. 1b acrescenta uazapi.';

-- ------------------------------------------------------------
-- 3. Colunas Meta que passam a ser nullable
-- ------------------------------------------------------------
ALTER TABLE whatsapp_connections ALTER COLUMN phone_number_id DROP NOT NULL;
-- waba_id, verify_token, registered_at, subscribed_apps_at,
-- last_registration_error já são nullable.

-- ------------------------------------------------------------
-- 4. CHECK de status ampliado
-- ------------------------------------------------------------
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_config_status_check;
ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_status_check
  CHECK (status IN (
    'disconnected', 'connecting', 'connected', 'hibernated', 'banned'
  ));

-- ------------------------------------------------------------
-- 5. Constraints / índices
-- ------------------------------------------------------------
-- Some o "um por account" (017).
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- Some o UNIQUE(phone_number_id) rígido (013); vira índice parcial.
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;

-- Fase 1: dois canais fixos, um por provedor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_account_provider
  ON whatsapp_connections (account_id, provider)
  WHERE archived_at IS NULL;

-- Preserva a regra da 013, agora escopada a meta e a não-arquivadas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_phone_number_id
  ON whatsapp_connections (phone_number_id)
  WHERE provider = 'meta' AND archived_at IS NULL;

-- No máximo uma primária por account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_one_primary
  ON whatsapp_connections (account_id)
  WHERE is_primary AND archived_at IS NULL;

-- Lookup do webhook UAZAPI (usado só na 1c).
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_webhook_secret_hash
  ON whatsapp_connections (webhook_secret_hash)
  WHERE webhook_secret_hash IS NOT NULL;

-- Índices antigos: o RENAME TO não renomeia índices. Alinhe os nomes.
ALTER INDEX IF EXISTS idx_whatsapp_config_account
  RENAME TO idx_connections_account;
ALTER INDEX IF EXISTS idx_whatsapp_config_registered_at
  RENAME TO idx_connections_registered_at;

-- ------------------------------------------------------------
-- 6. Backfill dos flags de provider
-- ------------------------------------------------------------
UPDATE whatsapp_connections
  SET provider = 'meta', is_primary = true
  WHERE provider IS DISTINCT FROM 'meta' OR is_primary = false;

-- ------------------------------------------------------------
-- 7. RLS: nomes acompanham o rename (regras iguais)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_connections;
CREATE POLICY whatsapp_connections_select ON whatsapp_connections
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_connections_insert ON whatsapp_connections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_connections_update ON whatsapp_connections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_connections_delete ON whatsapp_connections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 8. conversations.connection_id
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE RESTRICT;

UPDATE conversations c
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.account_id = c.account_id
    AND c.connection_id IS NULL;

-- Falha alto se algum ficou sem conexão (não deveria: sem conexão não
-- há como ter conversa com número).
ALTER TABLE conversations ALTER COLUMN connection_id SET NOT NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_connection
  ON conversations (account_id, contact_id, connection_id);

-- ------------------------------------------------------------
-- 9. flow_runs: run ativo passa a ser por conversa
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_conversation
  ON flow_runs (account_id, conversation_id)
  WHERE status = 'active';

-- ------------------------------------------------------------
-- 10. broadcasts.connection_id
-- ------------------------------------------------------------
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE RESTRICT;

UPDATE broadcasts b
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.account_id = b.account_id
    AND b.connection_id IS NULL;

ALTER TABLE broadcasts ALTER COLUMN connection_id SET NOT NULL;
-- broadcasts.template_name NOT NULL FICA (relaxar é Onda 3).

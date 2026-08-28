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
-- 8. conversations.connection_id  (nullable na 1a; SET NOT NULL +
--    ON DELETE RESTRICT + ciclo de arquivo entram na 1b/1c junto dos
--    paths de criação de conversa)
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

UPDATE conversations c
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.account_id = c.account_id
    AND c.connection_id IS NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_connection
  ON conversations (account_id, contact_id, connection_id);

-- ------------------------------------------------------------
-- 9. flow_runs: run ativo passa a ser por conversa
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_conversation
  ON flow_runs (account_id, conversation_id)
  WHERE status = 'active' AND conversation_id IS NOT NULL;

-- ------------------------------------------------------------
-- 10. broadcasts.connection_id  (nullable na 1a — ver seção 8)
-- ------------------------------------------------------------
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

UPDATE broadcasts b
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.account_id = b.account_id
    AND b.connection_id IS NULL;
-- broadcasts.template_name NOT NULL FICA (relaxar é Onda 3).

-- ------------------------------------------------------------
-- 11. redeem_invitation() referencia a tabela pelo nome no corpo;
--     plpgsql resolve em runtime e o rename não reescreve funções.
--     Corpo byte-idêntico a 019, só a tabela muda.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- the joined account_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_connections WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

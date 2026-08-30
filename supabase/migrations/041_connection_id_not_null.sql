-- ============================================================
-- 041 — connection_id NOT NULL + is_primary atômico
--
-- Onda 1c-i. QUEBRA COORDENADA: sobe junto com
-- findOrCreateConnectionAwareConversation setando connection_id.
-- Spec: docs/superpowers/specs/2026-08-30-uazapi-onda-1c-i-inbound-seam.md
-- ============================================================

-- btree_gist é necessário para o EXCLUDE (account_id WITH =) num tipo
-- comum (uuid). Não foi habilitado por nenhuma migração anterior
-- (só uuid-ossp na 001 e vector na 030); o Supabase o disponibiliza.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- 1. is_primary atômico: índice parcial → EXCLUDE deferível
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_connections_one_primary;

ALTER TABLE whatsapp_connections DROP CONSTRAINT IF EXISTS whatsapp_connections_one_primary;
ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_one_primary
  EXCLUDE (account_id WITH =) WHERE (is_primary AND archived_at IS NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.set_primary_connection(
  p_id UUID,
  p_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Um statement só: com o EXCLUDE INITIALLY DEFERRED, a checagem roda
  -- no COMMIT, quando exatamente uma linha é is_primary.
  UPDATE whatsapp_connections
    SET is_primary = (id = p_id)
    WHERE account_id = p_account_id AND archived_at IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_connections
    WHERE id = p_id AND account_id = p_account_id
      AND archived_at IS NULL AND is_primary
  ) THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_connection(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_connection(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 2. conversations.connection_id
-- ------------------------------------------------------------
-- Órfã: conta sem conexão meta ativa. connection_id não tem a quem
-- pertencer; o inbound desse contato já falha hoje. Apaga (messages
-- via cascade).
DELETE FROM conversations c
  WHERE c.connection_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connections wc
      WHERE wc.account_id = c.account_id
        AND wc.provider = 'meta' AND wc.archived_at IS NULL
    );

UPDATE conversations c
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE c.connection_id IS NULL
    AND wc.account_id = c.account_id
    AND wc.provider = 'meta' AND wc.archived_at IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM conversations WHERE connection_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '041: % conversations still NULL connection_id after backfill', n;
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_connection_id_fkey;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES whatsapp_connections(id)
  ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 3. broadcasts.connection_id (mesma estrutura)
-- ------------------------------------------------------------
DELETE FROM broadcasts b
  WHERE b.connection_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connections wc
      WHERE wc.account_id = b.account_id
        AND wc.provider = 'meta' AND wc.archived_at IS NULL
    );

UPDATE broadcasts b
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE b.connection_id IS NULL
    AND wc.account_id = b.account_id
    AND wc.provider = 'meta' AND wc.archived_at IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM broadcasts WHERE connection_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '041: % broadcasts still NULL connection_id after backfill', n;
  END IF;
END $$;

ALTER TABLE broadcasts ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_connection_id_fkey;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES whatsapp_connections(id)
  ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 4. create_broadcast_with_recipients: setar connection_id
--    Corpo byte-idêntico ao da 038 exceto o INSERT em broadcasts.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[]
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
  v_connection_id UUID;
BEGIN
  SELECT id INTO v_connection_id
  FROM whatsapp_connections
  WHERE account_id = p_account_id AND is_primary AND archived_at IS NULL;

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'no primary WhatsApp connection for account %', p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients, connection_id
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients, v_connection_id
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO service_role;

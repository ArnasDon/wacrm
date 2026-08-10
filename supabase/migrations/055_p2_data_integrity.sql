-- ============================================================
-- 055_p2_data_integrity.sql
--
-- Auditoría P2 — integridad de datos. Tres fixes independientes:
--
--   1. DAT-2  — borrar un contacto YA NO destruye el historial de chat.
--      `conversations.contact_id` era `ON DELETE CASCADE` (001:143) y
--      `messages.conversation_id` también CASCADE (001:165), así que
--      borrar el contacto borraba en cadena TODAS sus conversaciones y
--      TODOS sus mensajes (más reacciones 009 y notificaciones 027).
--      Se cambia la FK a `ON DELETE SET NULL` (y se quita el NOT NULL)
--      para conservar conversación + mensajes; la UI ya tolera
--      contact_id NULL (conversation-list.tsx renderiza "unknown").
--      La migración 004 ya había protegido deals/broadcast_recipients
--      con SET NULL — conversations fue el hueco que quedó.
--
--   2. DAT-4  — índices que faltan para el trigger `_deal_on_interaction`
--      (049_tenancy_guards.sql:171-245). Cada INSERT en `messages`
--      resuelve `d.conversation_id = new.conversation_id` y cada INSERT
--      en `calls` resuelve `d.contact_id = new.contact_id` — sin índice,
--      son seq-scans de `deals` en cada mensaje/llamada entrante.
--
--   3. DAT-6  — `email_campaigns.account_id` era nullable (052:41), la
--      única tabla tenant sin NOT NULL. El RLS (is_account_member) ya
--      exige account_id en INSERT y el handler siempre lo setea, así
--      que no hay filas NULL — el ALTER solo endurece el contrato.
--
-- Idempotente (DROP/CREATE + IF EXISTS).
-- ============================================================

-- ============================================================
-- 1. DAT-2 — conversations.contact_id: CASCADE -> SET NULL
-- ============================================================
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_fkey;
ALTER TABLE conversations ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;

-- ============================================================
-- 2. DAT-4 — índices para el trigger _deal_on_interaction
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_deals_conversation_id ON deals(conversation_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact_id       ON deals(contact_id);

-- ============================================================
-- 3. DAT-6 — email_campaigns.account_id NOT NULL
-- ============================================================
ALTER TABLE email_campaigns ALTER COLUMN account_id SET NOT NULL;

-- ============================================================
-- 041_messages_channel.sql — mensajes: columna `channel` aditiva
--
-- BDD finding: el schema real de `messages` NO tiene columna
-- `channel`. Para que el SMS entrante (message.received) viva en
-- `messages` y aparezca en el inbox/Realtime existentes sin romper
-- nada, se añade UNA columna aditiva con default `'whatsapp'`.
--
-- - default 'whatsapp' → las filas existentes no quedan rotas y el
--   row/message de WhatsApp no pide relleno.
-- - messages.conversation_id NOT NULL se reutiliza: el SMS se adjunta
--   a la conversación del contacto.
-- - Separación real: voz → `calls`; SMS → `messages` (channel 'sms').
--   Mezcla solo visual en el inbox.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
  CHECK (channel IN ('whatsapp','sms'));
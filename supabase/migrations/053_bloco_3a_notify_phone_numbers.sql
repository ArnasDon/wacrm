-- ============================================================
-- 053_bloco_3a_notify_phone_numbers.sql — números de telefone que
-- recebem aviso por WhatsApp em dois eventos: handoff (conversa passada
-- à equipa) e reunião comercial marcada (book_commercial_meeting).
--
-- Contexto: até aqui só existia AISDR_ALERT_ADMIN_PHONE (uma variável de
-- ambiente, um único número, só para falhas de encaminhamento do AI
-- SDR — ver src/lib/notifications/whatsapp-admin-alert.ts). O Ricardo
-- pediu (21/09/2026) um segundo canal, por conta, configurável em
-- número de destinatários (0, 1 ou vários), para dois eventos
-- diferentes: handoff e reunião marcada. Como é "por conta" e não fixo
-- por ambiente, vive em `ai_configs`, não numa env var.
--
-- Vazio por omissão: nenhuma conta é forçada a ter alguém a receber
-- estes avisos. Ver src/lib/notifications/notify-team.ts para o envio.
--
-- Nenhuma política de RLS nova é necessária — `ai_configs` já está
-- coberta pela migração 029.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS notify_phone_numbers text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN ai_configs.notify_phone_numbers IS
  'Números E.164 que recebem aviso por WhatsApp em handoff e reunião comercial marcada (src/lib/notifications/notify-team.ts). Vazio = ninguém.';

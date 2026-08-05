-- ============================================================
-- 046_deals_fk_consistency.sql
-- Auditoría de esquema (MCP, 2026-08-05):
--  - deals.stage_id y deals.pipeline_id sin acción consistente:
--    pipeline tenía CASCADE pero stage/conversation NO ACTION.
--    Borrar una conversación o stage con deals asociados fallaba.
--  - FIX: conversation_id → SET NULL (nullable), stage_id → CASCADE
--    (NOT NULL, consistente con pipeline_id).
--  - messages: índice único parcial para dedupe SMS inbound por
--    telnyx_message_id (defensa en profundidad tras el fix app-level).
-- ============================================================

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey,
  ADD CONSTRAINT deals_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
    ON DELETE SET NULL;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_stage_id_fkey,
  ADD CONSTRAINT deals_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id)
    ON DELETE CASCADE;

-- Dedupe SMS inbound: un telnyx_message_id solo puede existir una vez
-- (reentregas de Telnyx no deben duplicar el mensaje en el inbox).
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_telnyx_message_id
  ON public.messages (message_id)
  WHERE channel = 'sms' AND message_id IS NOT NULL;

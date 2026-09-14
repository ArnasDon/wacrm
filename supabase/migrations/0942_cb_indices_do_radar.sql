-- ============================================================
-- 942 — Índices das varreduras do worker do Radar (revisão da 941)
--
-- Duas consultas rodam a cada ciclo (96×/dia) e não tinham índice:
--
-- 1. O recolhedor de travadas: `WHERE status='running' AND running_desde
--    < corte` em cb_conversation_insights. A tabela tem uma linha por
--    conversa analisada e SÓ CRESCE — sem índice é um seq scan que
--    engorda em silêncio para achar, tipicamente, zero linhas. Mesmo
--    racional do `cb_scheduled_messages_vencendo_idx` da 925.
--
-- 2. A busca de candidatas: `channel_id IN (…) AND group_id IS NULL AND
--    last_message_at >= janela ORDER BY last_message_at DESC` em
--    conversations — até aqui só havia o índice parcial de channel_id
--    da 902, que obriga filtro e sort completos por cima.
--
-- Índices apenas: nada de grants, nada de dado — aplica em banco vazio
-- por construção.
-- ============================================================

CREATE INDEX IF NOT EXISTS cb_conversation_insights_travadas_idx
  ON cb_conversation_insights (running_desde)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS conversations_radar_candidatas_idx
  ON conversations (channel_id, last_message_at DESC)
  WHERE group_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'cb_conversation_insights_travadas_idx'
  ) THEN
    RAISE EXCEPTION '942: índice das travadas não foi criado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'conversations_radar_candidatas_idx'
  ) THEN
    RAISE EXCEPTION '942: índice das candidatas não foi criado';
  END IF;
  RAISE NOTICE '942: ok.';
END $$;

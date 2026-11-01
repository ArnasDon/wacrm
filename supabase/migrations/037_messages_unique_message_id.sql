-- ============================================================
-- 037_messages_unique_message_id.sql
-- Idempotent webhook delivery: prevent duplicate message records
-- when Meta WhatsApp Cloud API retries or delivers concurrently.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_messages_unique_wamid'
  ) THEN
    CREATE UNIQUE INDEX idx_messages_unique_wamid
      ON messages(message_id)
      WHERE message_id IS NOT NULL;
  END IF;
END $$;

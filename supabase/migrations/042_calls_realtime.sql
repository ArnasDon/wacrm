-- ============================================================
-- 042_calls_realtime.sql — publicar `calls` en supabase_realtime
--
-- El hook cliente use-realtime escucha un canal 'calls' (aditivo,
-- Fase 1 Telnyx). Para que Supabase Realtime emita los eventos de
-- INSERT/UPDATE/DELETE de la tabla `calls`, esta debe pertenecer a
-- la publicación `supabase_realtime` (mismo patrón que messages /
-- conversations en 001 y notifications en 027).
-- Idempotente.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE calls;
  END IF;
END $$;
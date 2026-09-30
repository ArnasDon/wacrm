-- Migration 043: Add contact_tags and tags to supabase_realtime publication
-- Ensures Supabase Realtime broadcasts WAL events for contact_tags and tags.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'contact_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_tags;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tags;
  END IF;
END $$;

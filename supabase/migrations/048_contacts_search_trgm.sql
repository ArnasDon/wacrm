-- Speed up contact name/phone/email search (ilike '%term%') used by
-- group member picker and similar UIs on large contact books.
-- Requires pg_trgm (available on hosted Supabase).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON contacts USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm
  ON contacts USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm
  ON contacts USING gin (email gin_trgm_ops);

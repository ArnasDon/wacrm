-- Opaque, unguessable feed token per catalogue source, so a public
-- product-feed endpoint (Meta Commerce Manager, Google Shopping, ...)
-- can resolve exactly one source/account without the endpoint itself
-- ever knowing which business it is or accepting an account_id from
-- the caller. The token IS the credential — 256 bits, built from two
-- gen_random_uuid() calls so this needs no extension (pgcrypto is not
-- assumed to be enabled).
--
-- A volatile default on ADD COLUMN makes Postgres evaluate it per row,
-- so every existing source (any tenant) gets its own unique token here,
-- with no name-based backfill needed.

alter table wacrm.catalog_sources
  add column if not exists meta_feed_token text
  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

create unique index if not exists catalog_sources_meta_feed_token_key
  on wacrm.catalog_sources (meta_feed_token);

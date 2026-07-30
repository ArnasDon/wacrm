-- ============================================================
-- wacrm — per-account branding (logo and name)
-- Migration 043.
--
-- GENERATED FILE — do not edit. Regenerate with:
--   ./scripts/deploy/bundle-migrations.sh docs/deploy/branding.sql 043
--
-- HOW TO APPLY
--   1. Supabase Cloud -> SQL Editor -> New query.
--   2. Paste this whole file and run it.
--   3. THEN deploy the new app code (merge to main + redeploy).
--
-- Order matters, and this way round is the safe one: every change here
-- is additive (new tables, new columns with defaults), so the code
-- currently running in production keeps working against the new schema.
-- Deploying first would instead point the new code at tables that do
-- not exist yet.
--
-- Safe to re-run: tables use CREATE TABLE IF NOT EXISTS, columns use
-- ADD COLUMN IF NOT EXISTS, constraints and policies are dropped before
-- being recreated, and functions use CREATE OR REPLACE.
--
-- IF THE EDITOR STILL REPORTS A SYNTAX ERROR
--   It is splitting the script into statements and getting it wrong, not
--   objecting to the SQL. Run the file one section at a time: each
--   `-- ####` banner below starts a migration, and they are independent
--   in that order. The apostrophes in comments that caused this once
--   already are rewritten by the generator (see sanitize-comments.py).
-- ============================================================


-- ############################################################
-- ##  043_account_branding.sql
-- ############################################################

-- ============================================================
-- 043_account_branding
--
-- Per-account branding: a logo and a display name that replace the
-- hardcoded product mark in the sidebar and the browser tab.
--
-- Before this, the sidebar rendered a fixed lucide glyph plus the
-- i18n string `Sidebar.title` ("CRM Template for WhatsApp"), and the
-- browser tab always read "wacrm". Neither came from the database, so
-- a single deployment serving several client accounts showed every one
-- of them the same generic mark. This adds the two columns the app
-- needs to white-label itself per account.
--
-- Both columns are nullable and NULL means "no branding configured",
-- which is what every existing row gets. That is deliberate: a NULL
-- keeps the current hardcoded behaviour byte for byte, so this
-- migration cannot change what an existing install looks like.
--
-- `brand_name` is written together with `accounts.name` by the
-- settings UI (one visible field writes both). `name` stays the
-- account identity used by invitations and the members list;
-- `brand_name` doubles as the unambiguous "this account opted into
-- branding" flag, which the server needs because it cannot run the
-- clients heuristic of comparing the account name against the users
-- own full name.
--
-- RLS on accounts: no change needed. The existing `accounts_update`
-- policy (017) already restricts writes to admins+, which is exactly
-- who should change an account-wide setting. Storage RLS is a
-- different matter and is defined below.
--
-- Idempotent - safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Branding columns on accounts
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS brand_name TEXT;

-- Bounded so the sidebar and the browser tab cannot be blown out by a
-- pasted essay. The lower bound of 1 matters as much as the upper one:
-- it forces the UI to write NULL rather than an empty string, keeping
-- "no branding" a single representable state instead of two.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_brand_name_len;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_brand_name_len
  CHECK (brand_name IS NULL OR char_length(brand_name) BETWEEN 1 AND 60);

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Defence in depth only - the app writes this from getPublicUrl(), so
-- the shape is already controlled. The check exists so a hand-edited
-- row cannot put something that is not a URL into an attribute that
-- ends up in an <img src> and a <link rel="icon">. Plain http is
-- allowed because local Supabase serves storage over
-- http://127.0.0.1:54321.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_logo_url_shape;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_logo_url_shape
  CHECK (logo_url IS NULL OR logo_url ~ '^https?://');

-- ============================================================
-- 2. brand-assets storage bucket
--
-- Mirrors `chat-media` (migration 023) and its account-scoped path
-- convention:
--
--   brand-assets/account-<account_id>/<timestamp>-<basename>.<ext>
--
-- Public, because the logo is also served as the browser favicon and
-- inside an <img> on every dashboard page - a signed URL would expire
-- and break the tab icon.
--
-- 1 MB, far below the 16 MB media buckets: this renders at 32x32 as a
-- favicon and 32x32 in the sidebar, so anything larger is wasted bytes
-- on every page load.
--
-- No SVG in the MIME allow-list, on purpose. The bucket is public, so
-- an SVG opened at its own URL is rendered as a document by the
-- browser and can execute script in the Storage origin, which is
-- shared by every bucket of this Supabase project. PNG/JPEG/WebP cover
-- every logo a customer will bring, and raster files carry no script.
-- GIF is left out too - an animated favicon is not a feature.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  TRUE,
  1048576, -- 1 MB
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 3. Storage RLS - public reads, admin-only writes
--
-- Same account-scoped predicate as migration 023 (the first path
-- segment must be `account-<account_id>` for an account the caller
-- belongs to), plus a role filter that 023 does not have.
--
-- The role filter is the point: chat media is something any agent
-- sends all day, but the company logo is account-wide identity. An
-- agent who can attach a photo to a conversation should not be able to
-- replace the mark every colleague and every browser tab sees. This
-- mirrors `accounts_update` (017), which already limits the columns
-- themselves to admins+ - without it the two halves of the same
-- feature would disagree on who may change it.
--
-- Drop-then-create (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================
DROP POLICY IF EXISTS "Brand assets are publicly readable" ON storage.objects;
CREATE POLICY "Brand assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Admins can upload brand assets" ON storage.objects;
CREATE POLICY "Admins can upload brand assets"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can update brand assets" ON storage.objects;
CREATE POLICY "Admins can update brand assets"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can delete brand assets" ON storage.objects;
CREATE POLICY "Admins can delete brand assets"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- 4. Refresh the PostgREST schema cache
--
-- PostgREST answers from a cached copy of the schema. Until it
-- reloads, selecting `brand_name` returns 42703 ("column does not
-- exist") even though the column is right there - which is how issue
-- #294 took down the whole account context once already, because a
-- failed select on `accounts` is not a degraded read, it is a thrown
-- error that blanks the profile.
--
-- This NOTIFY is asynchronous and therefore not a guarantee, so the
-- application code stays defensive as well (the branding read never
-- throws, and the auth hook retries with the legacy column list). This
-- just closes the window in the common case.
-- ============================================================
NOTIFY pgrst, 'reload schema';

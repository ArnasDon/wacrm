-- ============================================================
-- 064_media_library.sql
--
-- Adds the `media` Supabase Storage bucket: a reusable image
-- library for the dashboard (viewer at /media) and for landing
-- pages built with the page editor. Images here are meant to be
-- referenced from landing block fields (hero thumbnails, gallery,
-- team photos, etc.) via their public URL.
--
-- Follows the exact convention of chat-media (023) / flow-media
-- (016+020):
--
--   1. Bucket is PUBLIC so Astro/Next can serve the images without
--      auth (`getPublicUrl`), same as the other content buckets.
--   2. Path convention `media/account-<account_id>/<timestamp>-<basename>.<ext>`
--      — the first segment is what RLS write policies match on.
--   3. Only images, and only the formats the user asked for:
--      JPEG, PNG, WebP. (GIF excluded on purpose — the page editor
--      only needs the three static formats.)
--   4. SELECT is scoped to account members (audit finding DAT-1,
--      same fix as migration 054) so the viewer can only list the
--      caller's own objects; public URL reads still work because
--      `getPublicUrl` serves bytes without hitting RLS.
--
-- Size limit 16 MB, consistent with chat-media/flow-media (the
-- uploader helper enforces this client-side too).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. media storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  TRUE,
  16777216, -- 16 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS — account-scoped reads and writes
--
-- Same predicate shape as migrations 023/054: the caller must
-- belong to the account whose folder the object lives in
-- (`account-<account_id>` as the first path segment).
-- ============================================================

DROP POLICY IF EXISTS "Media is readable by account members" ON storage.objects;
CREATE POLICY "Media is readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload media" ON storage.objects;
CREATE POLICY "Members can upload media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update media" ON storage.objects;
CREATE POLICY "Members can update media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete media" ON storage.objects;
CREATE POLICY "Members can delete media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

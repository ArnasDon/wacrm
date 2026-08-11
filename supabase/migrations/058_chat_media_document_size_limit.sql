-- ============================================================
-- 058_chat_media_document_size_limit.sql — custom feature, not part
-- of the upstream wacrm template.
--
-- Raises the `chat-media` bucket's file_size_limit from 16 MB toward
-- Meta's real 100 MB document cap — capped at 50 MB instead, which is
-- as far as it goes. This Supabase project enforces its OWN 50 MB hard
-- ceiling on any single object (a project-level Storage setting,
-- independent of and lower than a bucket's file_size_limit); every
-- update attempt above 50 MB was rejected in production with "The
-- object exceeded the maximum allowed size" (confirmed 2026-08-11 via
-- `storage.updateBucket`), 50 MB was the first value accepted.
-- Reaching the full 100 MB needs that project-level setting raised
-- (Dashboard → Storage → Settings, or a plan-tier change) — out of
-- scope here since it's a billing decision, not a bucket config one.
--
-- Supabase Storage has one size limit per bucket, not per mimetype,
-- so this technically also raises the ceiling image/video/audio COULD
-- reach at the Storage layer — that's fine, they stay capped well
-- below 50 MB by `MEDIA_MAX_BYTES_BY_KIND` in
-- `src/lib/storage/upload-media.ts` (video/audio 16 MB, image 5 MB),
-- which every upload is checked against client-side before it ever
-- reaches Storage.
--
-- allowed_mime_types is untouched — this is a size-only change.
--
-- Idempotent — safe to re-run. Already applied directly via
-- `storage.updateBucket` in production on 2026-08-11 (this migration
-- documents that change and reproduces it for any other environment).
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 52428800 -- 50 MB — see comment above for why not 100 MB
WHERE id = 'chat-media';

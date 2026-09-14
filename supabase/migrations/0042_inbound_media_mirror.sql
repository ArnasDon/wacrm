-- ============================================================
-- 042_inbound_media_mirror
--
-- ⚠️ RENUMERADA NO MERGE DO UPSTREAM (2026-08-26). Chegou como
-- `039_inbound_media_mirror.sql` e colidia com a nossa `037_evolution_transport`, ja
-- aplicada. As tres do upstream (037/038/039) viraram 040/041/042 juntas,
-- porque a 041 dropa a funcao que a 040 cria — a ordem relativa tinha de
-- ser preservada.
--
-- Issue #466. Inbound media is never persisted. The webhook verifies
-- the Meta media id and stores a POINTER — `/api/whatsapp/media/<id>`
-- — and that route re-streams the bytes from Meta on every view. Meta
-- deletes media roughly 30 days after receipt, so every inbound photo,
-- voice note and document silently rots into "Photo unavailable". No
-- amount of UI can recover it; the bytes are simply gone.
--
-- Outbound media already survives: the composer uploads to the public
-- `chat-media` bucket (migration 023) and stores a durable URL. This
-- migration is the schema half of doing the same for inbound.
--
-- Three changes:
--
--   1. `messages.media_type` — the MIME type the webhook has always
--      had in hand and always discarded (`void mediaType` in
--      `webhook/route.ts`). Without it, a download has to guess the
--      file extension from the fetched blob, which only works once
--      the bytes have already been fetched successfully.
--
--   2. `whatsapp_config.mirror_inbound_media` — the per-account
--      opt-OUT. Mirroring every inbound attachment is unbounded
--      storage growth on a self-hosted Supabase project, so it has to
--      be switchable. It defaults to TRUE because the thing being
--      fixed is silent data loss: an account that never finds the
--      setting should be the one that keeps its attachments, not the
--      one that keeps losing them.
--
--   3. Widens the `chat-media` MIME allow-list with the types Meta can
--      hand us on the way IN but that we never send out — animated
--      GIFs, bare Opus, QuickTime video, and Meta's own `video/3gp`
--      spelling of `video/3gpp`. The bucket's allow-list is enforced
--      by Storage for the service role too, so without this an
--      inbound GIF is rejected at upload and falls back to the proxy
--      (i.e. still expires). The list mirrors the inbound-only types
--      already enumerated in `EXTENSION_BY_MIME`
--      (`src/lib/media/filename.ts`).
--
-- NO BACKFILL IS POSSIBLE. Media Meta has already expired cannot be
-- recovered, and media still inside the 30-day window would need the
-- account's access token, which is encrypted at rest and only
-- decryptable by the app. Existing rows keep their proxy URL and the
-- proxy route keeps serving them for as long as Meta still has them.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. messages.media_type
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_type TEXT;

COMMENT ON COLUMN messages.media_type IS
  'MIME type of media_url''s content, as reported by Meta. Populated for '
  'INBOUND media only: an outbound media_url is a chat-media object whose '
  'path already carries the original filename and extension, so the type '
  'adds nothing there. Also NULL for text messages and for every row '
  'written before migration 042.';

-- ============================================================
-- 2. whatsapp_config.mirror_inbound_media
-- ============================================================
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS mirror_inbound_media BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN whatsapp_config.mirror_inbound_media IS
  'When true (default), the inbound webhook copies received media into '
  'the chat-media bucket so it outlives Meta''s ~30-day retention. Turn '
  'off to keep storage flat and accept that attachments expire.';

-- ============================================================
-- 3. chat-media: allow the inbound-only MIME types
--
-- Same UPSERT shape as migration 023 so the two stay comparable. Only
-- the allowed_mime_types array changes; the bucket stays public with
-- the same 16 MB ceiling, and the storage RLS policies from 023 are
-- untouched (the webhook writes with the service role, which bypasses
-- them, but a bucket-level MIME rejection applies to it all the same).
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  TRUE,
  16777216, -- 16 MB, unchanged from 023
  ARRAY[
    -- Images
    'image/png', 'image/jpeg', 'image/webp',
    -- Inbound-only: animated GIFs forwarded from another chat
    'image/gif',
    -- Videos
    'video/mp4', 'video/3gpp',
    -- Inbound-only: Meta's own spelling of 3gpp, and iOS clips that
    -- arrive as QuickTime rather than MP4
    'video/3gp', 'video/quicktime',
    -- Documents
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    -- Audio (voice notes) — outbound is transcoded to audio/ogg first
    'audio/ogg',
    'audio/mpeg',
    'audio/aac',
    'audio/mp4',
    'audio/amr',
    -- Inbound-only: some clients label an Opus voice note audio/opus
    -- rather than audio/ogg
    'audio/opus'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

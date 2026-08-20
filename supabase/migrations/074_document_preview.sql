-- 074_document_preview.sql — WhatsApp-style PDF preview (thumbnail of the
-- first page, page count, file size) for `content_type='document'`
-- messages, inbound and outbound.
--
-- None of this comes from the WhatsApp Cloud API (webhook documents give
-- only id/mime_type/filename; outbound sends only give a media_url) — it's
-- generated server-side, best-effort, after the message row already
-- exists, and patched in here. Nullable on every row; only ever populated
-- for content_type='document' messages whose file is a PDF.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS document_page_count INTEGER,
  ADD COLUMN IF NOT EXISTS document_file_size BIGINT,
  ADD COLUMN IF NOT EXISTS document_thumbnail_url TEXT;

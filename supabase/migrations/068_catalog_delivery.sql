-- ============================================================
-- 068_catalog_delivery.sql
--
-- Lets an account choose how its catalog gets delivered to a customer
-- instead of always sending a link to the live digital page
-- (`/catalog/[accountId]`):
--
--   - 'digital' (default, current behavior) — the link, unchanged.
--   - 'pdf'     — the owner's own existing catalog PDF, uploaded as-is
--                 (never generated from product records).
--   - 'photos'  — the owner's own existing catalog photos, uploaded
--                 as-is, sent in order.
--
-- `catalog_pdf_url`/`catalog_photo_urls` hold what was uploaded.
-- `products` (migration 053) stays the separate, always-searchable
-- database the team/AI use to answer price/detail questions even when
-- the thing actually sent to the customer is just a PDF/photos, not a
-- structured catalog page — no schema change needed there, it already
-- has name/description/price.
--
-- New bucket `catalog-media` (member-uploaded, unlike `catalog-documents`
-- which is deliberately service-role-only for system-generated quote
-- PDFs — mixing owner-uploaded raw files into that bucket would blur
-- that trust boundary). Same member-scoped RLS pattern as
-- `product-media` (migration 053).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS catalog_delivery_mode TEXT NOT NULL DEFAULT 'digital';

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_catalog_delivery_mode_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_catalog_delivery_mode_check
  CHECK (catalog_delivery_mode IN ('digital', 'pdf', 'photos'));

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS catalog_pdf_url TEXT;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS catalog_photo_urls TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalog-media',
  'catalog-media',
  TRUE,
  10485760, -- 10 MB
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Catalog media is publicly readable" ON storage.objects;
CREATE POLICY "Catalog media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'catalog-media');

DROP POLICY IF EXISTS "Members can upload catalog media" ON storage.objects;
CREATE POLICY "Members can upload catalog media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'catalog-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update catalog media" ON storage.objects;
CREATE POLICY "Members can update catalog media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'catalog-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete catalog media" ON storage.objects;
CREATE POLICY "Members can delete catalog media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'catalog-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

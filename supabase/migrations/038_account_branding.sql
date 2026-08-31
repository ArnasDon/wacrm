-- ============================================================
-- 038_account_branding.sql — Per-account business branding
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT;

-- Create account-logos storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('account-logos', 'account-logos', TRUE, 2097152,
        ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read access policy for account-logos
DROP POLICY IF EXISTS "Account logos are publicly readable" ON storage.objects;
CREATE POLICY "Account logos are publicly readable"
  ON storage.objects FOR SELECT USING (bucket_id = 'account-logos');

-- Admin write access policy for account-logos (path structure: account-logos/{account_id}/logo-timestamp.ext)
DROP POLICY IF EXISTS "Account admins manage their logo" ON storage.objects;
CREATE POLICY "Account admins manage their logo"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'account-logos'
    AND auth.role() = 'authenticated'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  )
  WITH CHECK (
    bucket_id = 'account-logos'
    AND auth.role() = 'authenticated'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

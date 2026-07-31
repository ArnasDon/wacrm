-- ============================================================
-- 043_app_branding
--
-- Instance-wide branding (sidebar logo + name), replacing the
-- hardcoded "CRM Template for WhatsApp" chip. Singleton table (one
-- row, enforced by a boolean primary key that can only ever be
-- `true`) — this app follows a "fork it, brand it, deploy it" model
-- (one running instance = one business), and every existing settings
-- table is per-account, so there's no natural account_id to hang
-- this off. Read is public (the sidebar, and eventually pre-login
-- pages, need it without an account context); write is gated to
-- owner/admin of any account the caller belongs to.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_branding (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  logo_url    text,
  brand_name  text NOT NULL DEFAULT 'CRM Template for WhatsApp',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO app_branding (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_branding_select ON app_branding;
CREATE POLICY app_branding_select ON app_branding FOR SELECT
  USING (true);

DROP POLICY IF EXISTS app_branding_update ON app_branding;
CREATE POLICY app_branding_update ON app_branding FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.account_role IN ('owner', 'admin')
  ));

CREATE OR REPLACE FUNCTION public.update_app_branding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_branding_updated_at ON app_branding;
CREATE TRIGGER app_branding_updated_at
  BEFORE UPDATE ON app_branding
  FOR EACH ROW
  EXECUTE FUNCTION public.update_app_branding_updated_at();

-- ============================================================
-- Storage: `branding` bucket for the logo file. 1MB cap enforced at
-- the bucket level too (defense in depth alongside the client-side
-- resize/compress step).
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  TRUE,
  1048576, -- 1 MB
  ARRAY['image/webp', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Branding is publicly readable" ON storage.objects;
CREATE POLICY "Branding is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "Admins can upload branding" ON storage.objects;
CREATE POLICY "Admins can upload branding"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'branding'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can update branding" ON storage.objects;
CREATE POLICY "Admins can update branding"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'branding'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can delete branding" ON storage.objects;
CREATE POLICY "Admins can delete branding"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'branding'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_role IN ('owner', 'admin')
    )
  );

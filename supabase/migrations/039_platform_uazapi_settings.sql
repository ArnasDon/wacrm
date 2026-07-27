-- ============================================================
-- platform_settings: UI-editable uazapi reseller credentials
--
-- Migration 037 introduced the uazapi "reseller" model — one admin
-- subscription (UAZAPI_ADMIN_TOKEN / UAZAPI_BASE_URL) backs every
-- account's instance on this deployment. Until now those two values
-- only lived in server env vars, which meant a non-technical operator
-- had to edit .env.local (or hPanel's env var UI) and restart the
-- app to set them up.
--
-- This table lets an account owner paste them once from
-- Settings → WhatsApp instead. It is NOT account-scoped — unlike
-- every other settings table in this schema, these credentials back
-- every account on the deployment, matching the reseller model they
-- serve. `resolveUazapiPlatformCredentials()`
-- (src/lib/whatsapp/uazapi-platform-config.ts) checks this table
-- first and falls back to the env vars, so operators who prefer
-- env-based config keep working unchanged.
--
-- Singleton enforcement: `id BOOLEAN PRIMARY KEY DEFAULT true CHECK
-- (id)` is a standard Postgres trick — id can only ever be `true`,
-- and being the primary key means at most one row can exist.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- Encrypted with the same encrypt()/decrypt() as whatsapp_config's
  -- access_token — never stored or returned in plaintext.
  uazapi_admin_token TEXT,
  uazapi_base_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Any account owner (of any account on this deployment) can view and
-- edit this — there is no narrower "platform superadmin" concept in
-- this schema, and self-hosted deployments (per the README's fork-
-- per-business model) typically have one trusted owner anyway.
DROP POLICY IF EXISTS platform_settings_select ON platform_settings;
CREATE POLICY platform_settings_select ON platform_settings FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid() AND profiles.account_role = 'owner'
  )
);

DROP POLICY IF EXISTS platform_settings_insert ON platform_settings;
CREATE POLICY platform_settings_insert ON platform_settings FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid() AND profiles.account_role = 'owner'
  )
);

DROP POLICY IF EXISTS platform_settings_update ON platform_settings;
CREATE POLICY platform_settings_update ON platform_settings FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid() AND profiles.account_role = 'owner'
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid() AND profiles.account_role = 'owner'
  )
);

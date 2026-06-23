-- ============================================================
-- ADD EVOLUTION API PROVIDER FIELDS
-- ============================================================

-- Add the provider type, defaults to 'meta' for existing rows
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'meta' CHECK (provider IN ('meta', 'evolution'));

-- Add evolution specific fields
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS evolution_api_url TEXT;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS evolution_api_key TEXT;
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT;

-- Meta API fields can be null if the provider is evolution
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;

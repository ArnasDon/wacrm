-- ============================================================
-- 044_ai_tools_generic_api — connect any HTTP API as an AI tool
--
-- Extends `ai_tools` (migration 042, previously Google Sheets only)
-- with a second tool type: a generic HTTP API call (e.g. OpenWeatherMap,
-- a currency-exchange API, an internal REST endpoint). The agent
-- decides when to call it and supplies the parameters the admin
-- declared; execution lives in src/lib/ai/tools/api.ts.
--
--   type            — 'google_sheet' (existing rows keep this) or 'api'.
--   api_url         — request URL template, e.g.
--                      "https://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric".
--                      "{name}" placeholders are filled from the
--                      model-supplied argument of that name; the
--                      literal "{API_KEY}" placeholder is filled from
--                      the decrypted api_key_encrypted secret.
--   api_method      — GET or POST.
--   api_params      — jsonb array of {name, description, required} the
--                      model can/must supply — becomes the tool's JSON
--                      Schema `parameters`.
--   api_headers     — jsonb object of static header name/value
--                      templates (same {param}/{API_KEY} substitution),
--                      for APIs that take their key as a header instead
--                      of a query string.
--   api_body        — optional POST body template, same substitution.
--   api_key_encrypted — optional secret (API key/token), AES-256-GCM
--                      encrypted at rest with the same scheme as
--                      webhook_endpoints.secret / whatsapp tokens
--                      (src/lib/whatsapp/encryption.ts). Never returned
--                      by the list/read API routes.
--
-- `sheet_url` becomes nullable since an 'api' row has no sheet.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_tools ALTER COLUMN sheet_url DROP NOT NULL;

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'google_sheet';

ALTER TABLE ai_tools DROP CONSTRAINT IF EXISTS ai_tools_type_check;
ALTER TABLE ai_tools
  ADD CONSTRAINT ai_tools_type_check CHECK (type IN ('google_sheet', 'api'));

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS api_url text;

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS api_method text NOT NULL DEFAULT 'GET';

ALTER TABLE ai_tools DROP CONSTRAINT IF EXISTS ai_tools_api_method_check;
ALTER TABLE ai_tools
  ADD CONSTRAINT ai_tools_api_method_check CHECK (api_method IN ('GET', 'POST'));

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS api_params jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS api_headers jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS api_body text;

ALTER TABLE ai_tools
  ADD COLUMN IF NOT EXISTS api_key_encrypted text;

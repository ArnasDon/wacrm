-- ============================================================
-- 044 — Fase 2 (softphone WebRTC + grabaciones)
-- Aditiva: no toca filas previas ni columnas existentes.
--   telnyx_config.telephony_credential_id : id de la Telephony
--     Credential usada por el WebRTC (ensureCredential la crea/guarda).
--   calls.recording_storage_path : path en el bucket call-recordings;
--     el proxy GET /api/telnyx/recordings/[callId] lo usa para
--     createSignedUrl (calls.recording_url guarda la URL del proxy).
-- ============================================================
ALTER TABLE public.telnyx_config
  ADD COLUMN IF NOT EXISTS telephony_credential_id text;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS recording_storage_path text;

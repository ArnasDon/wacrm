-- ============================================================
-- 045_ai_tools_google_drive_onedrive
--
-- Widens the Google-Sheets-only tool (migration 042) into "Google
-- Drive" — the same tool type now reads Sheets, Docs, Slides, or a
-- generic Drive file (plain text, or an uploaded .docx/.xlsx/.pptx),
-- detected from the URL. Adds a third type, 'onedrive', for the
-- equivalent on public OneDrive/SharePoint links. Execution lives in
-- src/lib/ai/tools/google-drive.ts and src/lib/ai/tools/onedrive.ts.
--
--   sheet_url -> drive_url  — same column, wider meaning: any of the
--                             URL kinds above, not just a spreadsheet.
--   type: 'google_sheet' -> 'google_drive' for existing rows; 'onedrive'
--         joins 'api' as the other allowed values.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_tools RENAME COLUMN sheet_url TO drive_url;

UPDATE ai_tools SET type = 'google_drive' WHERE type = 'google_sheet';

ALTER TABLE ai_tools ALTER COLUMN type SET DEFAULT 'google_drive';

ALTER TABLE ai_tools DROP CONSTRAINT IF EXISTS ai_tools_type_check;
ALTER TABLE ai_tools
  ADD CONSTRAINT ai_tools_type_check CHECK (type IN ('google_drive', 'onedrive', 'api'));

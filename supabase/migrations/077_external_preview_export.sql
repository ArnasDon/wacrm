-- ============================================================
-- 077_external_preview_export.sql — preview/edit/approve/export for
-- 'external'-channel campaigns (migration 076).
--
-- No new tables — still `broadcasts` + `broadcast_recipients`:
--
--   1. broadcasts.approved_at — set once the user approves the
--      previewed/edited recipient list. Before this, the review UI
--      lets the user edit or remove recipients; after, the list (and
--      therefore the export) is locked — the file exported represents
--      exactly what was approved (spec section 4).
--   2. broadcasts.exported_at — last time "Exportar para Claude Code"
--      was used. Informational only (re-exporting is always allowed).
--   3. broadcast_recipients.message_text — the FINAL per-recipient
--      message for 'external' campaigns. NULL means "use the
--      computed default" (campaign.message_text with {{nome}}
--      substituted for the contact's name); a non-NULL value is the
--      user's manual per-recipient override (spec section 3 — e.g.
--      "Maestro Pedrinho" edited down to "Pedro"). Unused for 'api'
--      campaigns, which still resolve per-recipient params through
--      template_variables as before.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS message_text TEXT;

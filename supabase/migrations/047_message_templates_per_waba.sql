-- ============================================================
-- 047: Message templates belong to a WABA
-- ============================================================
--
-- Meta owns templates per WhatsApp Business Account. Since 043 an
-- account can connect numbers from several WABAs, so each template row
-- records the WABA it lives in (`waba_id`). The Templates page filters
-- by the selected channel's WABA, sync/submit/edit/delete talk to that
-- WABA, and sends pick the template of the sending channel's WABA.
--
--   1. Adds message_templates.waba_id, backfilled from the account's
--      default channel — until now every template was synced from and
--      submitted to that channel.
--   2. Replaces the legacy UNIQUE(user_id, name, language) — which let
--      two teammates shadow each other and forbade the same name in two
--      WABAs — with UNIQUE(account_id, waba_id, name, language).
--      NULLS NOT DISTINCT keeps rows without a WABA (dry-run / legacy)
--      unique too.
--
-- Idempotent: safe to re-run.

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

UPDATE message_templates t
SET waba_id = w.waba_id
FROM whatsapp_config w
WHERE w.account_id = t.account_id
  AND w.is_default
  AND t.waba_id IS NULL;

DROP INDEX IF EXISTS message_templates_user_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_waba_name_language_key
  ON message_templates (account_id, waba_id, name, language) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_message_templates_account_waba
  ON message_templates (account_id, waba_id);

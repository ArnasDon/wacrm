-- ============================================================
-- 048_rimula_whatsapp_sync_log.sql — WhatsAppSyncLog (§9.0/§9.1, §11)
--
-- Tracks the sync state of a Product against the WhatsApp product
-- catalogue (`ProductCatalogueService`, P1 per §11 — schema now,
-- automation wired later). `sync_status` uses §11's exact set:
-- Draft, Pending Review, Published, Synced, Sync Error, Archived.
--
-- Settings/system-class, same tier as `whatsapp_config` (migration
-- 017) and `products` (migration 041) — catalogue sync is an
-- admin-configured integration, not something an agent triggers ad
-- hoc.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  whatsapp_catalogue_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'Draft' CHECK (sync_status IN (
    'Draft', 'Pending Review', 'Published', 'Synced', 'Sync Error', 'Archived'
  )),
  last_synced_at TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sync_log_account ON whatsapp_sync_log(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sync_log_product ON whatsapp_sync_log(product_id);

ALTER TABLE whatsapp_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sync_log_select ON whatsapp_sync_log;
CREATE POLICY whatsapp_sync_log_select ON whatsapp_sync_log FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_sync_log_insert ON whatsapp_sync_log;
CREATE POLICY whatsapp_sync_log_insert ON whatsapp_sync_log FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_sync_log_update ON whatsapp_sync_log;
CREATE POLICY whatsapp_sync_log_update ON whatsapp_sync_log FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_sync_log_delete ON whatsapp_sync_log;
CREATE POLICY whatsapp_sync_log_delete ON whatsapp_sync_log FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_sync_log;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_sync_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

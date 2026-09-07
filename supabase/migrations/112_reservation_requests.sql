-- ============================================================
-- 112_reservation_requests.sql — hotel vertical: a per-category
-- "solicitud" (reservation / service request) that gets progressively
-- filled (by the AI in chat, by the public catalog form, or from a
-- CRM quote) and mirrored to a category-specific Google Sheets tab.
--
-- One row per request. Nullable everywhere except account + category —
-- the AI creates it early with whatever it has and adds fields as the
-- conversation goes. `sheet_row` is the 1-based row number in its tab
-- (set by `dispatchToGoogleSheets` on the first write) so later updates
-- rewrite that row instead of appending a new one.
--
-- Same tenancy + RLS shape as product_rates / product_price_options:
-- own `account_id`, member reads, agent+ writes, `set_updated_at`.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS reservation_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,

  category TEXT NOT NULL CHECK (category IN ('habitaciones', 'spa', 'actividades', 'paquetes', 'eventos')),
  -- room name / spa or activity service / package name / event type
  service_name TEXT,
  guests INTEGER,
  check_in DATE,
  check_out DATE,
  -- "fecha de utilización" (spa / activities) or "fecha del evento"
  use_date DATE,
  duration_minutes INTEGER,
  -- eventos: filled by the hotel
  hall TEXT,
  decoration TEXT,
  estimated_price NUMERIC(12,2),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'catalog', 'ai_chat', 'quote_builder')),
  notes TEXT,
  -- 1-based row in the Google Sheets category tab; NULL until first write.
  sheet_row INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservation_requests_account ON reservation_requests(account_id);
CREATE INDEX IF NOT EXISTS idx_reservation_requests_contact ON reservation_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_reservation_requests_conversation ON reservation_requests(conversation_id);

-- One live request per (conversation, category) — the AI keeps adding to
-- the same row as it learns more. Catalog / quote-builder requests have
-- no conversation and always insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservation_requests_conv_category
  ON reservation_requests(conversation_id, category)
  WHERE conversation_id IS NOT NULL;

ALTER TABLE reservation_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservation_requests_select ON reservation_requests;
DROP POLICY IF EXISTS reservation_requests_insert ON reservation_requests;
DROP POLICY IF EXISTS reservation_requests_update ON reservation_requests;
DROP POLICY IF EXISTS reservation_requests_delete ON reservation_requests;
CREATE POLICY reservation_requests_select ON reservation_requests FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY reservation_requests_insert ON reservation_requests FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY reservation_requests_update ON reservation_requests FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY reservation_requests_delete ON reservation_requests FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON reservation_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reservation_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

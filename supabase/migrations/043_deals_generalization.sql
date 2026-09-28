-- ============================================================
-- 043_deals_generalization
--
-- Fluxo.os: generaliza `deals` para representar pedidos, turnos,
-- reservas, etc. según el rubro del cliente, sin agregar tablas
-- específicas por rubro.
--
--   1. `custom_fields.entity_type` — hasta ahora la tabla solo se
--      usaba (por convención, no por columna) para contactos. Se
--      agrega `entity_type` ('contact' | 'deal') para que el mismo
--      catálogo sirva también para atributos tipados de deals
--      (fecha de turno, talle, dirección, etc). Default 'contact'
--      + backfill implícito: todas las filas existentes quedan
--      como 'contact', cero impacto en las queries actuales.
--
--   2. `deal_custom_values` — mismo patrón que `contact_custom_values`
--      (incluyendo el estilo de RLS: sin account_id propio, se
--      valida vía join a `deals`).
--
--   3. `deals.details JSONB` — estructura libre o listas (ítems de
--      un pedido, por ejemplo) que no ameritan una tabla aparte.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ---- 1. custom_fields.entity_type ----------------------------
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'contact';

ALTER TABLE custom_fields
  DROP CONSTRAINT IF EXISTS custom_fields_entity_type_check;
ALTER TABLE custom_fields
  ADD CONSTRAINT custom_fields_entity_type_check
  CHECK (entity_type IN ('contact', 'deal'));

CREATE INDEX IF NOT EXISTS idx_custom_fields_account_entity
  ON custom_fields(account_id, entity_type);

-- ---- 2. deal_custom_values ------------------------------------
CREATE TABLE IF NOT EXISTS deal_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, custom_field_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_custom_values_deal
  ON deal_custom_values(deal_id);

ALTER TABLE deal_custom_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_custom_values_select ON deal_custom_values;
CREATE POLICY deal_custom_values_select ON deal_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id))
);

DROP POLICY IF EXISTS deal_custom_values_modify ON deal_custom_values;
CREATE POLICY deal_custom_values_modify ON deal_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id, 'agent'))
);

-- ---- 3. deals.details -------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

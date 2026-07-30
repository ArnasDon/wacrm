-- ============================================================
-- 030_order_stock_guard.sql
-- ============================================================

-- 1) Garantir que les stocks produits ne deviennent jamais négatifs
ALTER TABLE produits
  DROP CONSTRAINT IF EXISTS produits_quantity_non_negative;

ALTER TABLE produits
  ADD CONSTRAINT produits_quantity_non_negative
  CHECK (quantity >= 0);

-- 2) Corriger les valeurs déjà incohérentes déjà présentes
UPDATE produits
SET quantity = GREATEST(quantity, 0)
WHERE quantity < 0;

UPDATE produits
SET availability = CASE
  WHEN quantity <= 0 THEN 'out of stock'
  ELSE COALESCE(availability, 'in stock')
END;

-- 3) Fonction de protection au moment de la création d'une ligne dans order_items
CREATE OR REPLACE FUNCTION enforce_order_item_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id UUID;
  v_requested_quantity INTEGER;
  v_current_quantity INTEGER;
  v_new_quantity INTEGER;
  v_new_row JSONB;
BEGIN
  v_new_row := to_jsonb(NEW);

  IF v_new_row ? 'produit_id' THEN
    v_product_id := NULLIF(v_new_row ->> 'produit_id', '')::UUID;
  ELSIF v_new_row ? 'product_id' THEN
    v_product_id := NULLIF(v_new_row ->> 'product_id', '')::UUID;
  ELSIF v_new_row ? 'productId' THEN
    v_product_id := NULLIF(v_new_row ->> 'productId', '')::UUID;
  END IF;

  v_requested_quantity := COALESCE((v_new_row ->> 'quantity')::INTEGER, 0);

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Le produit est requis pour créer une commande';
  END IF;

  IF v_requested_quantity <= 0 THEN
    RAISE EXCEPTION 'La quantité commandée doit être supérieure à 0';
  END IF;

  SELECT quantity INTO v_current_quantity
  FROM produits
  WHERE id = v_product_id;

  IF v_current_quantity IS NULL THEN
    RAISE EXCEPTION 'Le produit n''existe pas';
  END IF;

  IF v_current_quantity < v_requested_quantity THEN
    RAISE EXCEPTION 'Stock insuffisant : % restant(s)', v_current_quantity;
  END IF;

  IF v_current_quantity = 0 THEN
    RAISE EXCEPTION 'Le produit est en rupture de stock';
  END IF;

  v_new_quantity := v_current_quantity - v_requested_quantity;

  UPDATE produits
  SET
    quantity = v_new_quantity,
    availability = CASE
      WHEN v_new_quantity <= 0 THEN 'out of stock'
      ELSE 'in stock'
    END
  WHERE id = v_product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Déclencheur qui bloque les insertions hors stock
DROP TRIGGER IF EXISTS trg_decrease_product_quantity ON order_items;
CREATE TRIGGER trg_decrease_product_quantity
BEFORE INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION enforce_order_item_stock();

-- 5) Recalculer l'état de disponibilité à chaque mise à jour du stock produit
CREATE OR REPLACE FUNCTION sync_product_availability()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quantity IS NULL THEN
    NEW.quantity := 0;
  END IF;

  IF NEW.quantity > 0 THEN
    NEW.availability := 'in stock';
  ELSE
    NEW.availability := 'out of stock';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_product_availability ON produits;
CREATE TRIGGER trg_sync_product_availability
BEFORE INSERT OR UPDATE ON produits
FOR EACH ROW
EXECUTE FUNCTION sync_product_availability();

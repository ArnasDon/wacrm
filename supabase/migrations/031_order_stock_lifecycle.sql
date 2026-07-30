-- ============================================================
-- 031_order_stock_lifecycle.sql
-- ============================================================

-- 1) Fonction de débit du stock à l'ajout d'un article de commande
CREATE OR REPLACE FUNCTION apply_order_item_stock_change()
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

-- 2) Fonction de réapprovisionnement du stock si la commande est annulée/supprimée
CREATE OR REPLACE FUNCTION restore_order_item_stock_change()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id UUID;
  v_quantity INTEGER;
  v_new_row JSONB;
BEGIN
  v_new_row := to_jsonb(OLD);

  IF v_new_row ? 'produit_id' THEN
    v_product_id := NULLIF(v_new_row ->> 'produit_id', '')::UUID;
  ELSIF v_new_row ? 'product_id' THEN
    v_product_id := NULLIF(v_new_row ->> 'product_id', '')::UUID;
  ELSIF v_new_row ? 'productId' THEN
    v_product_id := NULLIF(v_new_row ->> 'productId', '')::UUID;
  END IF;

  v_quantity := COALESCE((v_new_row ->> 'quantity')::INTEGER, 0);

  IF v_product_id IS NULL OR v_quantity <= 0 THEN
    RETURN OLD;
  END IF;

  UPDATE produits
  SET
    quantity = quantity + v_quantity,
    availability = CASE
      WHEN (quantity + v_quantity) <= 0 THEN 'out of stock'
      ELSE 'in stock'
    END
  WHERE id = v_product_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 3) Déclencheurs sur order_items
DROP TRIGGER IF EXISTS trg_apply_order_item_stock ON order_items;
CREATE TRIGGER trg_apply_order_item_stock
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION apply_order_item_stock_change();

DROP TRIGGER IF EXISTS trg_restore_order_item_stock ON order_items;
CREATE TRIGGER trg_restore_order_item_stock
AFTER DELETE ON order_items
FOR EACH ROW
EXECUTE FUNCTION restore_order_item_stock_change();

-- ============================================================
-- 043_order_quantity_trigger.sql
-- ============================================================
-- Final stock rule:
--  - debit stock on insert into order_items
--  - restore stock on delete from order_items
--  - keep a single consistent trigger pair, without stale old triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_decrease_product_quantity ON order_items;
DROP TRIGGER IF EXISTS trg_apply_order_item_stock ON order_items;
DROP TRIGGER IF EXISTS trg_restore_order_item_stock ON order_items;
DROP TRIGGER IF EXISTS trg_order_item_debit_stock ON order_items;
DROP TRIGGER IF EXISTS trg_order_item_restore_stock ON order_items;

DROP FUNCTION IF EXISTS decrease_product_quantity();
DROP FUNCTION IF EXISTS enforce_order_item_stock();
DROP FUNCTION IF EXISTS apply_order_item_stock_change();
DROP FUNCTION IF EXISTS restore_order_item_stock_change();

CREATE OR REPLACE FUNCTION order_item_debit_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_requested INTEGER;
  v_current INTEGER;
BEGIN
  IF NEW.produit_id IS NULL THEN
    RAISE EXCEPTION 'Le produit est requis pour créer une commande';
  END IF;

  v_requested := COALESCE(NEW.quantity, 0);

  IF v_requested <= 0 THEN
    RAISE EXCEPTION 'La quantité commandée doit être supérieure à 0';
  END IF;

  SELECT quantity INTO v_current
  FROM produits
  WHERE id = NEW.produit_id;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Produit introuvable';
  END IF;

  IF v_current < v_requested THEN
    RAISE EXCEPTION 'Stock insuffisant : % restant(s)', v_current;
  END IF;

  UPDATE produits
  SET
    quantity = quantity - v_requested,
    availability = CASE
      WHEN (quantity - v_requested) <= 0 THEN 'out of stock'
      ELSE 'in stock'
    END
  WHERE id = NEW.produit_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION order_item_restore_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_qty INTEGER;
BEGIN
  IF OLD.produit_id IS NULL THEN
    RETURN OLD;
  END IF;

  v_qty := COALESCE(OLD.quantity, 0);

  IF v_qty <= 0 THEN
    RETURN OLD;
  END IF;

  UPDATE produits
  SET
    quantity = quantity + v_qty,
    availability = CASE
      WHEN (quantity + v_qty) > 0 THEN 'in stock'
      ELSE 'out of stock'
    END
  WHERE id = OLD.produit_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_order_item_debit_stock
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION order_item_debit_stock();

CREATE TRIGGER trg_order_item_restore_stock
AFTER DELETE ON order_items
FOR EACH ROW
EXECUTE FUNCTION order_item_restore_stock();

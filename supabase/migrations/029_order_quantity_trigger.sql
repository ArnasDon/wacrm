-- ============================================================
-- 029_order_quantity_trigger.sql
-- ============================================================

-- 1. Création de la fonction qui met à jour le produit
CREATE OR REPLACE FUNCTION decrease_product_quantity()
RETURNS TRIGGER AS $$
DECLARE
  v_current_quantity INTEGER;
  v_new_quantity INTEGER;
BEGIN
  IF NEW.produit_id IS NULL THEN
    RAISE EXCEPTION 'Le produit est requis pour créer une commande';
  END IF;

  SELECT quantity INTO v_current_quantity
  FROM produits
  WHERE id = NEW.produit_id;

  IF v_current_quantity IS NULL THEN
    RAISE EXCEPTION 'Le produit n''existe pas';
  END IF;

  IF COALESCE(NEW.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'La quantité commandée doit être supérieure à 0';
  END IF;

  IF v_current_quantity < COALESCE(NEW.quantity, 0) THEN
    RAISE EXCEPTION 'Stock insuffisant : % restant(s)', v_current_quantity;
  END IF;

  v_new_quantity := v_current_quantity - COALESCE(NEW.quantity, 0);

  UPDATE produits
  SET
    quantity = v_new_quantity,
    availability = CASE
      WHEN v_new_quantity = 0 THEN 'out of stock'
      ELSE 'in stock'
    END
  WHERE id = NEW.produit_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Création du déclencheur (Trigger) sur la table order_items
DROP TRIGGER IF EXISTS trg_decrease_product_quantity ON order_items;
CREATE TRIGGER trg_decrease_product_quantity
BEFORE INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION decrease_product_quantity();

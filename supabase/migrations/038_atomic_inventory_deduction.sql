-- ============================================================
-- 038_atomic_inventory_deduction.sql
-- Enforce strict non-negative stock deduction in adjust_inventory_quantity
-- to guarantee two simultaneous orders cannot both buy the same final unit.
-- ============================================================

CREATE OR REPLACE FUNCTION adjust_inventory_quantity(
  p_account_id UUID,
  p_product_id UUID,
  p_location_name TEXT,
  p_delta INTEGER DEFAULT NULL,
  p_new_quantity INTEGER DEFAULT NULL,
  p_reorder_threshold INTEGER DEFAULT NULL
)
RETURNS SETOF inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item inventory_items;
  v_current_stock INTEGER;
BEGIN
  -- If this is an existing item, lock the row FOR UPDATE to prevent race conditions
  SELECT quantity_on_hand INTO v_current_stock
  FROM inventory_items
  WHERE product_id = p_product_id
    AND location_name = COALESCE(p_location_name, 'Main Warehouse')
  FOR UPDATE;

  -- If delta is negative, ensure sufficient stock exists
  IF p_delta IS NOT NULL AND p_delta < 0 THEN
    IF v_current_stock IS NULL OR (v_current_stock + p_delta) < 0 THEN
      RAISE EXCEPTION 'Insufficient stock: item has % units on hand, requested deduction %',
        COALESCE(v_current_stock, 0), ABS(p_delta)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO inventory_items (
    account_id,
    product_id,
    location_name,
    quantity_on_hand,
    quantity_reserved,
    reorder_threshold
  )
  VALUES (
    p_account_id,
    p_product_id,
    COALESCE(p_location_name, 'Main Warehouse'),
    CASE
      WHEN p_new_quantity IS NOT NULL THEN GREATEST(0, p_new_quantity)
      WHEN p_delta IS NOT NULL THEN GREATEST(0, p_delta)
      ELSE 0
    END,
    0,
    GREATEST(0, COALESCE(p_reorder_threshold, 5))
  )
  ON CONFLICT (product_id, location_name)
  DO UPDATE SET
    quantity_on_hand = CASE
      WHEN p_new_quantity IS NOT NULL THEN GREATEST(0, p_new_quantity)
      WHEN p_delta IS NOT NULL THEN inventory_items.quantity_on_hand + p_delta
      ELSE inventory_items.quantity_on_hand
    END,
    reorder_threshold = CASE
      WHEN p_reorder_threshold IS NOT NULL THEN GREATEST(0, p_reorder_threshold)
      ELSE inventory_items.reorder_threshold
    END,
    updated_at = now()
  RETURNING * INTO v_item;

  RETURN NEXT v_item;
END;
$$;

REVOKE ALL ON FUNCTION adjust_inventory_quantity(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adjust_inventory_quantity(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_inventory_quantity(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;

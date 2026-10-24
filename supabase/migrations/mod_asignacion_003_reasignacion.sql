-- ============================================================
-- Módulo asignacion · ASG.3 · reasignación manual (R24, R25)
--
-- Corre después de mod_asignacion_001/002. Idempotente.
-- Agrega mod_asignacion_reasignar(conversación, asesor): la ejecuta un
-- usuario autenticado y comprueba dentro que es admin u owner de la cuenta
-- (un asesor no puede reasignar, se cumple en la base).
--   * La conversación se bloquea con FOR UPDATE, igual que el motor (ASG.1):
--     reasignación y mensaje entrante a la vez no duplican filas.
--   * Destino válido: miembro de la cuenta con rol agent, admin u owner.
--   * Registra una fila en mod_asignacion_registro con regla = 'manual' y
--     asignado_por = quien reasignó. Cuenta como "asesor previo" si después
--     alguien desasigna la conversación.
--   * Mismo asesor: sin cambios ni registro (cambio = false).
--   * Errores: 42501 sin permiso; P0002 conversación no encontrada (también
--     si es de otra cuenta); 22023 asesor inválido.
-- No toca mod_asignacion_asignar: R24 ya la cumple (una conversación con
-- asesor no se reasigna por reglas).
-- ============================================================

ALTER TABLE mod_asignacion_registro
  ADD COLUMN IF NOT EXISTS asignado_por UUID NULL;

CREATE OR REPLACE FUNCTION mod_asignacion_reasignar(
  p_conversacion_id UUID,
  p_asesor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv conversations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sin permiso' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv FROM conversations
  WHERE id = p_conversacion_id FOR UPDATE;
  IF NOT FOUND OR NOT is_account_member(v_conv.account_id) THEN
    RAISE EXCEPTION 'conversación no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF NOT is_account_member(v_conv.account_id, 'admin') THEN
    RAISE EXCEPTION 'sin permiso' USING ERRCODE = '42501';
  END IF;

  IF p_asesor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = p_asesor_id
      AND p.account_id = v_conv.account_id
      AND p.account_role IN ('agent', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'asesor inválido' USING ERRCODE = '22023';
  END IF;

  IF v_conv.assigned_agent_id IS NOT DISTINCT FROM p_asesor_id THEN
    RETURN jsonb_build_object(
      'asesorId', p_asesor_id, 'anteriorId', p_asesor_id,
      'regla', 'manual', 'cambio', false);
  END IF;

  UPDATE conversations
  SET assigned_agent_id = p_asesor_id, updated_at = now()
  WHERE id = v_conv.id;

  INSERT INTO mod_asignacion_registro
    (account_id, conversacion_id, contacto_id, mensaje_id, asesor_id, regla, asignado_por)
  VALUES
    (v_conv.account_id, v_conv.id, v_conv.contact_id, NULL, p_asesor_id, 'manual', v_uid);

  RETURN jsonb_build_object(
    'asesorId', p_asesor_id, 'anteriorId', v_conv.assigned_agent_id,
    'regla', 'manual', 'cambio', true);
END;
$$;

REVOKE ALL ON FUNCTION mod_asignacion_reasignar(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mod_asignacion_reasignar(UUID, UUID) TO authenticated, service_role;

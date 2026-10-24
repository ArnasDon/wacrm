-- ============================================================
-- Módulo asignacion · ASG.1 · motor de asignación (contrato I3)
--
-- Corre después de las migraciones de wacrm (MOD.1). Idempotente.
-- Implementa: asesor = miembro con account_role 'agent'; activo = sin fila
-- activo=false en mod_asignacion_asesores; asesor previo = último registro
-- del contacto; reparto equitativo = rueda por user_id con cursor por
-- cuenta; sin activos no se escribe registro (R29); regla es text libre
-- con formato; conversacion_id ON DELETE SET NULL y asesor_id sin FK para
-- no perder la historia.
-- La asignación es atómica: la conversación se bloquea con FOR UPDATE.
-- ============================================================

CREATE TABLE IF NOT EXISTS mod_asignacion_asesores (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  activo BOOLEAN NOT NULL DEFAULT true,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mod_asignacion_registro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversacion_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contacto_id UUID NOT NULL,
  mensaje_id UUID,
  asesor_id UUID NOT NULL,
  regla TEXT NOT NULL CHECK (regla ~ '^[a-z][a-z-]*$'),
  asignado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_mod_asignacion_registro_contacto
  ON mod_asignacion_registro (account_id, contacto_id, asignado_en DESC);

CREATE TABLE IF NOT EXISTS mod_asignacion_cursor (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ultimo_asesor_id UUID,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION mod_asignacion_activos(p_account_id UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.user_id
  FROM profiles p
  WHERE p.account_id = p_account_id
    AND p.account_role = 'agent'
    AND NOT EXISTS (
      SELECT 1 FROM mod_asignacion_asesores a
      WHERE a.user_id = p.user_id
        AND a.account_id = p.account_id
        AND NOT a.activo
    );
$$;

CREATE OR REPLACE FUNCTION mod_asignacion_asignar(
  p_conversacion_id UUID,
  p_mensaje_id UUID,
  p_reglas TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conv conversations%ROWTYPE;
  v_regla TEXT;
  v_asesor UUID;
  v_ultimo UUID;
BEGIN
  SELECT * INTO v_conv FROM conversations
  WHERE id = p_conversacion_id FOR UPDATE;
  IF NOT FOUND OR v_conv.assigned_agent_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_regla IN ARRAY p_reglas LOOP
    v_asesor := NULL;
    IF v_regla = 'asesor-previo' THEN
      SELECT r.asesor_id INTO v_asesor
      FROM mod_asignacion_registro r
      WHERE r.account_id = v_conv.account_id
        AND r.contacto_id = v_conv.contact_id
      ORDER BY r.asignado_en DESC, r.id DESC
      LIMIT 1;
      -- vale solo si el más reciente sigue activo
      IF v_asesor IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM mod_asignacion_activos(v_conv.account_id) a
        WHERE a.user_id = v_asesor
      ) THEN
        v_asesor := NULL;
      END IF;
    ELSIF v_regla = 'reparto-equitativo' THEN
      INSERT INTO mod_asignacion_cursor (account_id)
      VALUES (v_conv.account_id) ON CONFLICT DO NOTHING;
      SELECT c.ultimo_asesor_id INTO v_ultimo
      FROM mod_asignacion_cursor c
      WHERE c.account_id = v_conv.account_id FOR UPDATE;
      SELECT a.user_id INTO v_asesor
      FROM mod_asignacion_activos(v_conv.account_id) a
      ORDER BY (v_ultimo IS NOT NULL AND a.user_id <= v_ultimo), a.user_id
      LIMIT 1;
      IF v_asesor IS NOT NULL THEN
        UPDATE mod_asignacion_cursor
        SET ultimo_asesor_id = v_asesor, actualizado_en = now()
        WHERE account_id = v_conv.account_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'regla de asignación desconocida: %', v_regla;
    END IF;

    IF v_asesor IS NOT NULL THEN
      UPDATE conversations
      SET assigned_agent_id = v_asesor, updated_at = now()
      WHERE id = v_conv.id;
      INSERT INTO mod_asignacion_registro
        (account_id, conversacion_id, contacto_id, mensaje_id, asesor_id, regla)
      VALUES
        (v_conv.account_id, v_conv.id, v_conv.contact_id, p_mensaje_id, v_asesor, v_regla);
      RETURN jsonb_build_object('asesorId', v_asesor, 'regla', v_regla);
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION mod_asignacion_asignar(UUID, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mod_asignacion_asignar(UUID, UUID, TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION mod_asignacion_activos(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mod_asignacion_activos(UUID) TO service_role;

ALTER TABLE mod_asignacion_asesores ENABLE ROW LEVEL SECURITY;
ALTER TABLE mod_asignacion_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE mod_asignacion_cursor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mod_asignacion_registro_select ON mod_asignacion_registro;
CREATE POLICY mod_asignacion_registro_select ON mod_asignacion_registro
  FOR SELECT USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS mod_asignacion_asesores_select ON mod_asignacion_asesores;
CREATE POLICY mod_asignacion_asesores_select ON mod_asignacion_asesores
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS mod_asignacion_asesores_escritura ON mod_asignacion_asesores;
CREATE POLICY mod_asignacion_asesores_escritura ON mod_asignacion_asesores
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

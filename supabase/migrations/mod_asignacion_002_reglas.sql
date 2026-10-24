-- ============================================================
-- Módulo asignacion · ASG.2 · reglas por etiqueta, palabra clave y campo
--
-- Corre después de mod_asignacion_001_motor.sql. Idempotente.
-- Agrega la tabla mod_asignacion_reglas (las reglas son datos de la base de
-- la empresa, R20), la columna regla_id del registro y reemplaza
-- mod_asignacion_asignar (misma firma) para entender los tipos 'etiqueta',
-- 'palabra-clave' y 'campo'.
-- Gana la primera en orden: primero el orden de tipos de p_reglas, luego
-- `orden` ascendente dentro del tipo. Una regla con asesor inactivo, o que ya
-- no es agent de la cuenta, se salta. Palabra clave: palabra o frase completa
-- sin distinguir mayúsculas ni tildes. Campo: igualdad exacta (normalizada)
-- sobre un campo personalizado del contacto.
-- ============================================================

CREATE TABLE IF NOT EXISTS mod_asignacion_reglas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  orden INT NOT NULL,
  tipo TEXT NOT NULL,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  custom_field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
  valor TEXT,
  asesor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activa BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, orden)
);

ALTER TABLE mod_asignacion_reglas
  DROP CONSTRAINT IF EXISTS mod_asignacion_reglas_tipo_check;
ALTER TABLE mod_asignacion_reglas
  ADD CONSTRAINT mod_asignacion_reglas_tipo_check
  CHECK (tipo IN ('etiqueta', 'palabra-clave', 'campo'));

ALTER TABLE mod_asignacion_reglas
  DROP CONSTRAINT IF EXISTS mod_asignacion_reglas_forma_check;
ALTER TABLE mod_asignacion_reglas
  ADD CONSTRAINT mod_asignacion_reglas_forma_check
  CHECK (
    (tipo = 'etiqueta'
      AND tag_id IS NOT NULL AND custom_field_id IS NULL AND valor IS NULL)
    OR (tipo = 'palabra-clave'
      AND tag_id IS NULL AND custom_field_id IS NULL
      AND valor ~ '^[[:alnum:]áéíóúüñÁÉÍÓÚÜÑ]+( [[:alnum:]áéíóúüñÁÉÍÓÚÜÑ]+)*$')
    OR (tipo = 'campo'
      AND tag_id IS NULL AND custom_field_id IS NOT NULL
      AND valor IS NOT NULL AND btrim(valor) <> '')
  );

CREATE INDEX IF NOT EXISTS idx_mod_asignacion_reglas_tipo
  ON mod_asignacion_reglas (account_id, tipo, orden) WHERE activa;

ALTER TABLE mod_asignacion_registro
  ADD COLUMN IF NOT EXISTS regla_id UUID
  REFERENCES mod_asignacion_reglas(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION mod_asignacion_normalizar(t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(lower(t), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun');
$$;

CREATE OR REPLACE FUNCTION mod_asignacion_regla_empresa(
  p_account_id UUID,
  p_contacto_id UUID,
  p_conversacion_id UUID,
  p_mensaje_id UUID,
  p_tipo TEXT
) RETURNS TABLE (asesor_id UUID, regla_id UUID)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT r.asesor_id, r.id
  FROM mod_asignacion_reglas r
  WHERE r.account_id = p_account_id
    AND r.tipo = p_tipo
    AND r.activa
    AND r.asesor_id IN (SELECT a.user_id FROM mod_asignacion_activos(p_account_id) a)
    AND (
      (p_tipo = 'etiqueta' AND EXISTS (
        SELECT 1 FROM contact_tags ct
        JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = p_contacto_id
          AND ct.tag_id = r.tag_id
          AND t.account_id = p_account_id))
      OR (p_tipo = 'palabra-clave' AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.id = p_mensaje_id
          AND m.conversation_id = p_conversacion_id
          AND m.content_text IS NOT NULL
          AND mod_asignacion_normalizar(m.content_text)
              ~ ('\m' || mod_asignacion_normalizar(r.valor) || '\M')))
      OR (p_tipo = 'campo' AND EXISTS (
        SELECT 1 FROM contact_custom_values v
        JOIN custom_fields f ON f.id = v.custom_field_id
        WHERE v.contact_id = p_contacto_id
          AND v.custom_field_id = r.custom_field_id
          AND f.account_id = p_account_id
          AND mod_asignacion_normalizar(btrim(v.value))
              = mod_asignacion_normalizar(btrim(r.valor))))
    )
  ORDER BY r.orden
  LIMIT 1;
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
  v_regla_id UUID;
  v_ultimo UUID;
BEGIN
  SELECT * INTO v_conv FROM conversations
  WHERE id = p_conversacion_id FOR UPDATE;
  IF NOT FOUND OR v_conv.assigned_agent_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_regla IN ARRAY p_reglas LOOP
    v_asesor := NULL;
    v_regla_id := NULL;
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
    ELSIF v_regla IN ('etiqueta', 'palabra-clave', 'campo') THEN
      SELECT e.asesor_id, e.regla_id INTO v_asesor, v_regla_id
      FROM mod_asignacion_regla_empresa(
        v_conv.account_id, v_conv.contact_id, v_conv.id, p_mensaje_id, v_regla
      ) e;
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
        (account_id, conversacion_id, contacto_id, mensaje_id, asesor_id, regla, regla_id)
      VALUES
        (v_conv.account_id, v_conv.id, v_conv.contact_id, p_mensaje_id, v_asesor, v_regla, v_regla_id);
      RETURN jsonb_build_object('asesorId', v_asesor, 'regla', v_regla);
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION mod_asignacion_asignar(UUID, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mod_asignacion_asignar(UUID, UUID, TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION mod_asignacion_regla_empresa(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mod_asignacion_regla_empresa(UUID, UUID, UUID, UUID, TEXT) TO service_role;

ALTER TABLE mod_asignacion_reglas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mod_asignacion_reglas_select ON mod_asignacion_reglas;
CREATE POLICY mod_asignacion_reglas_select ON mod_asignacion_reglas
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS mod_asignacion_reglas_escritura ON mod_asignacion_reglas;
CREATE POLICY mod_asignacion_reglas_escritura ON mod_asignacion_reglas
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

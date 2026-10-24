-- Asserts de que la migración del módulo de prueba corrió (MOD.1).
DO $$
BEGIN
  IF to_regclass('public.mod_demo_marca') IS NULL THEN
    RAISE EXCEPTION 'falta public.mod_demo_marca: la migración de módulo no corrió';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid = 'public.mod_demo_marca'::regclass
      AND confrelid = 'public.contacts'::regclass
  ) THEN
    RAISE EXCEPTION 'falta la FK de mod_demo_marca hacia public.contacts';
  END IF;
END $$;

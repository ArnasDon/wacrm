-- Migración de un módulo de prueba (MOD.1). Solo la aplica CI.
-- Depende de public.contacts: si corriera antes que las de wacrm, falla.
CREATE TABLE IF NOT EXISTS public.mod_demo_marca (
  contacto_id UUID PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  marcado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

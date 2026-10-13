-- Client onboarding via Google Forms (src/lib/onboarding/).
--
-- onboarding_forms: one Google Form per vertical, registered by the Apps
--   Script (scripts/onboarding/alta-formularios.gs). `prefill_url` carries
--   the literal TOKEN placeholder in the "Código de alta" field.
-- onboarding_intakes: one link sent to one company; the form response
--   lands in `answers` ({ question key: text }), the generator's outcome
--   in `apply_result`.
-- Writes go through the service-role client only; platform admins read.

CREATE TABLE IF NOT EXISTS public.onboarding_forms (
  form_vertical text PRIMARY KEY CHECK (form_vertical IN ('hotel', 'clinica', 'comercio')),
  prefill_url text NOT NULL,
  edit_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  form_vertical text NOT NULL CHECK (form_vertical IN ('hotel', 'clinica', 'comercio')),
  token text NOT NULL UNIQUE,
  answers jsonb,
  received_at timestamptz,
  applied_at timestamptz,
  apply_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_intakes_account_idx ON public.onboarding_intakes (account_id, created_at DESC);

ALTER TABLE public.onboarding_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_forms_platform_read ON public.onboarding_forms;
CREATE POLICY onboarding_forms_platform_read ON public.onboarding_forms
  FOR SELECT TO authenticated USING (public.is_platform_admin());

DROP POLICY IF EXISTS onboarding_intakes_platform_read ON public.onboarding_intakes;
CREATE POLICY onboarding_intakes_platform_read ON public.onboarding_intakes
  FOR SELECT TO authenticated USING (public.is_platform_admin());

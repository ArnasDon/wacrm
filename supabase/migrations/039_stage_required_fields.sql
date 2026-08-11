-- ============================================================
-- 039_stage_required_fields
--
-- Adds `required_fields` JSONB column to pipeline_stages.
-- Stores an array of required field identifiers (e.g. ['value', 'expected_close_date', 'assigned_to', 'product'])
-- that must be present on a deal before it can be moved to or saved in this stage.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

SET search_path TO public;

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS required_fields JSONB DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.reload_schema()
RETURNS void AS $$
BEGIN
  NOTIFY pgrst, 'reload schema';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.reload_schema() TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';

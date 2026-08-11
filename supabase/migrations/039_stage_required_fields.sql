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

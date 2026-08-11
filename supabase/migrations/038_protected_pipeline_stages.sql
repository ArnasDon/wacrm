-- ============================================================
-- 038_protected_pipeline_stages
--
-- 1. Adds `is_protected` boolean column to pipeline_stages.
--    Protected stages cannot be deleted from the UI.
-- 2. Marks any existing "Ganho" / "Perdido" stages as protected.
-- 3. Inserts "Ganho" (green) and "Perdido" (red) into every
--    pipeline that does not already have them, placing them
--    at the end (max_position + 1 and + 2).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- 1. Add the column (no-op if already exists)
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false;

-- 2. Mark any existing stages named Ganho / Perdido as protected
UPDATE pipeline_stages
SET is_protected = true
WHERE lower(name) IN ('ganho', 'perdido');

-- 3. Insert missing "Ganho" stage for each pipeline that lacks one
INSERT INTO pipeline_stages (pipeline_id, name, color, position, is_protected)
SELECT
  p.id,
  'Ganho',
  '#22c55e',
  COALESCE((SELECT MAX(ps.position) FROM pipeline_stages ps WHERE ps.pipeline_id = p.id), -1) + 1,
  true
FROM pipelines p
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.pipeline_id = p.id AND lower(ps.name) = 'ganho'
);

-- 4. Insert missing "Perdido" stage for each pipeline that lacks one
INSERT INTO pipeline_stages (pipeline_id, name, color, position, is_protected)
SELECT
  p.id,
  'Perdido',
  '#ef4444',
  COALESCE((SELECT MAX(ps.position) FROM pipeline_stages ps WHERE ps.pipeline_id = p.id), -1) + 1,
  true
FROM pipelines p
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.pipeline_id = p.id AND lower(ps.name) = 'perdido'
);

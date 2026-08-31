// ============================================================
// Shared pipeline logic for the public API (v1) pipeline endpoints.
//
// Pipelines are read-only over the public API (creating/editing the
// stage layout stays a dashboard-only, settings-class action — see
// docs/public-api.md). This module only serializes the
// pipeline+stages shape `GET /api/v1/pipelines[/​{id}]` returns.
// ============================================================

/** Row select that embeds a pipeline's stages for serialization. */
export const PIPELINE_SELECT = '*, pipeline_stages(*)';

export interface ApiPipelineStage {
  id: string;
  name: string;
  position: number;
  color: string;
}

export interface ApiPipeline {
  id: string;
  name: string;
  stages: ApiPipelineStage[];
  created_at: string;
}

type RawStage = {
  id: string;
  name: string;
  position: number;
  color: string;
};

/**
 * Flatten a `PIPELINE_SELECT` row into the public pipeline shape.
 * Stages are sorted by `position` (the board's left-to-right order) —
 * PostgREST doesn't let an embedded-resource select carry its own
 * `order()`, so we sort client-side.
 */
export function serializePipeline(row: Record<string, unknown>): ApiPipeline {
  const stages = (row.pipeline_stages as RawStage[] | undefined) ?? [];
  return {
    id: row.id as string,
    name: row.name as string,
    stages: [...stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        color: s.color,
      })),
    created_at: row.created_at as string,
  };
}

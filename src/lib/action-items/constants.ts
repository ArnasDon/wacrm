// Same hex values as this account's actual "Interesse" / "Follow-up"
// pipeline stages (see STAGE_COLORS in pipeline-settings.tsx) — the
// Central de Ações spec requires reusing the exact Pipeline colors,
// never inventing new ones (AGENTS.md §12/§32). Hardcoded rather than
// resolved live from `pipeline_stages` by name: the spec's intent is
// "the semantic laranja/verde already used for these two stages", not
// "whatever color today's row happens to have" if someone later
// recolors a stage.
export const ACTION_ITEM_COLORS = {
  interest: '#f97316',
  followup: '#22c55e',
} as const;

/** Case-insensitive match used to locate the account's "Follow-up"
 *  pipeline stage (for the move-into-stage confirmation, §9, and for
 *  gating the weekly view to leads still sitting in that stage, §29). */
export const FOLLOWUP_STAGE_NAME = 'Follow-up';

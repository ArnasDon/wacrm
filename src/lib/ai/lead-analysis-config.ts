// ============================================================
// Tunables for lead analysis (BLOCO 2/4) — centralized here per the
// spec's section 8 requirement ("esses limites devem ficar
// configuráveis futuramente e não espalhados pelo código") rather
// than as literals scattered across lead-analysis.ts.
// ============================================================

import type { TagConfidence } from './lead-analysis-types';

/** Minimum seconds between analysis runs for the same contact. Bounds
 *  cost when a customer sends several messages in a burst — the last
 *  one in a burst still gets analyzed once the cooldown clears, since
 *  the next inbound re-triggers `dispatchInboundToLeadAnalysis`. */
export const LEAD_ANALYSIS_COOLDOWN_SECONDS = 90;

/** How many recent text messages to read on the very first analysis
 *  of a contact (no persisted summary yet). */
export const LEAD_ANALYSIS_INITIAL_MESSAGE_LIMIT = 40;

/** Cap on "new since last analysis" messages fed into one incremental
 *  run, so a contact that went quiet for weeks and comes back with a
 *  huge backlog doesn't blow the prompt/cost budget in one call. */
export const LEAD_ANALYSIS_INCREMENTAL_MESSAGE_LIMIT = 20;

/** Below this score, a stage-move suggestion is not created at all
 *  (BLOCO 2/4 section 8: "abaixo de 60: não criar sugestão"). */
export const STAGE_SUGGESTION_MIN_SCORE = 60;

/** Tag confidence below this level is never applied (section 3:
 *  "quando houver baixa confiança, preferir não alterar"). */
export const TAG_CONFIDENCE_MIN: TagConfidence = 'medium';

const CONFIDENCE_RANK: Record<TagConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function meetsTagConfidenceThreshold(confidence: TagConfidence): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[TAG_CONFIDENCE_MIN];
}

/** Human-readable band for a 0–100 score, for display only (section 8). */
export function scoreConfidenceBand(score: number): 'strong' | 'good' | 'moderate' | 'low' {
  if (score >= 90) return 'strong';
  if (score >= 75) return 'good';
  if (score >= 60) return 'moderate';
  return 'low';
}

// ============================================================
// Tunables for supervised learning scanning (BLOCO 4/4) — same
// discipline as the other blocks' *-config.ts files.
// ============================================================

import type { LearningConfidence } from './learning-types';

/** How many recent text messages one scan reads. Bounded so a very
 *  active account's scan stays cheap and fast. */
export const LEARNING_SCAN_MESSAGE_LIMIT = 80;

/** Fallback lookback window for an account's very first scan (no
 *  `learning_last_scanned_at` yet). Every scan after that only reads
 *  messages since the previous scan. */
export const LEARNING_INITIAL_WINDOW_DAYS = 14;

/** A learning below this confidence is discarded — same "don't turn a
 *  single stray sentence into permanent knowledge" rule as the block's
 *  spec, enforced as a single threshold instead of scattered checks. */
export const LEARNING_MIN_CONFIDENCE: LearningConfidence = 'medium';

const CONFIDENCE_RANK: Record<LearningConfidence, number> = { low: 0, medium: 1, high: 2 };

export function meetsLearningConfidenceThreshold(confidence: LearningConfidence): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[LEARNING_MIN_CONFIDENCE];
}

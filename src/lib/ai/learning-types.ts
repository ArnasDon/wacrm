// ============================================================
// Shapes for supervised-learning scanning (BLOCO 4/4). Same
// strict-JSON-in-prompt approach as the rest of this AI surface.
// ============================================================

export type LearningType =
  | 'factual'
  | 'commercial_rule'
  | 'procedure'
  | 'communication_style'
  | 'template_usage'
  | 'followup_pattern'
  | 'other';

export type LearningConfidence = 'low' | 'medium' | 'high';

export interface LearningCandidate {
  type: LearningType;
  /** The knowledge itself, stated as a standalone fact/rule — this
   *  becomes the KB document's title once approved. */
  info: string;
  /** Contexto resumido. */
  context_summary: string | null;
  /** Possível aplicação. */
  application: string | null;
  /** How many times the model actually saw this pattern in the
   *  batch it was given — "quantidade de vezes identificada". */
  occurrence_count: number;
  confidence: LearningConfidence;
  /** True = a single, isolated statement or opinion — MUST NOT become
   *  a suggestion (spec: "não transformar automaticamente uma frase
   *  isolada em conhecimento permanente"). */
  is_isolated: boolean;
}

const LEARNING_TYPES: readonly LearningType[] = [
  'factual',
  'commercial_rule',
  'procedure',
  'communication_style',
  'template_usage',
  'followup_pattern',
  'other',
];
const CONFIDENCES: readonly LearningConfidence[] = ['low', 'medium', 'high'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Never throws — unparseable/malformed entries are dropped rather
 *  than surfaced as broken suggestions. Returns `null` only when the
 *  whole response isn't JSON at all (vs. an empty array, which means
 *  "scanned, nothing worth learning"). */
export function parseLearningScanResult(raw: string): LearningCandidate[] | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { learnings?: unknown })?.learnings)
      ? (parsed as { learnings: unknown[] }).learnings
      : null;
  if (!arr) return null;

  const out: LearningCandidate[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const info = str(o.info);
    if (!info) continue;
    const type = LEARNING_TYPES.includes(o.type as LearningType) ? (o.type as LearningType) : 'other';
    const confidence = CONFIDENCES.includes(o.confidence as LearningConfidence)
      ? (o.confidence as LearningConfidence)
      : 'low';
    const occurrence = typeof o.occurrence_count === 'number' && o.occurrence_count > 0
      ? Math.floor(o.occurrence_count)
      : 1;
    out.push({
      type,
      info,
      context_summary: str(o.context_summary),
      application: str(o.application),
      occurrence_count: occurrence,
      confidence,
      is_isolated: o.is_isolated !== false, // fail-safe: unclear → treat as isolated, skip it
    });
  }
  return out;
}

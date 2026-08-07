// ============================================================
// lead-scoring.ts — deterministic scoring engine for the EterWA lead
// qualification rubric. Pure, no I/O, fully unit-testable.
//
// CRITICAL DESIGN RULE this module exists to enforce: "a pontuação é
// sempre derivada das respostas guardadas, nunca um número que o LLM
// inventa." The model extracts PER-DIMENSION FACTS via the
// `save_lead_qualification` tool call (schema.ts); this module is the
// only place that turns those facts into a total score / classification.
// The tool handler (handlers/save-lead-qualification.ts) calls this on
// the full merged set of stored dimensions before every persist — a
// model-supplied `score`/`stage` is never trusted or written.
//
// The rubric (fixed product spec, do not alter without a spec change):
//   Five dimensions, 0-2 points each, max 10:
//     - necessidade    0 = no problem / curiosity, 1 = vague problem,
//                       2 = concrete pain + its cost
//     - autoridade      0 = no decision/influence, 1 = influences but
//                       someone else decides, 2 = is the decider
//                       (sócio/gerente/CEO)
//     - urgencia        0 = "um dia destes", 1 = próximos meses,
//                       2 = já esta semana / prazo definido
//     - enquadramento   0 = outside what Eter does, 1 = adjacent,
//                       2 = fits an Eter service
//     - dimensao        0 = no operation (particular/personal project),
//                       1 = micro-empresa, 2 = has team + recurring
//                       revenue
//   Classification: 0-3 = frio, 4-6 = morno, 7-10 = quente.
// ============================================================

export type Dimension = 'necessidade' | 'autoridade' | 'urgencia' | 'enquadramento' | 'dimensao'

export type DimensionScore = 0 | 1 | 2

export type Classification = 'frio' | 'morno' | 'quente'

/** Order also doubles as "next question to ask" priority when a caller
 *  wants a deterministic default — callers are free to ask in whatever
 *  order the conversation naturally goes, but should always consult
 *  `missingDimensions` rather than re-asking an already-answered one. */
export const DIMENSIONS: readonly Dimension[] = [
  'necessidade',
  'autoridade',
  'urgencia',
  'enquadramento',
  'dimensao',
]

export interface QualificationResult {
  /** Sum of the dimensions answered so far — NOT padded with zeros for
   *  missing dimensions, so a partially-answered lead still gets a
   *  meaningful "current" classification instead of being dragged to
   *  `frio` by dimensions nobody has asked about yet. */
  score: number
  classification: Classification
  /** True iff the urgência dimension is recorded as 2 — per the
   *  actuation rule "urgency dimension scores 2 in ANY overall
   *  classification → notify the admin regardless of overall score". */
  urgent: boolean
  /** Dimensions with no recorded answer yet, in rubric order. The
   *  caller (agent prompt / handler) uses this to decide what to ask
   *  next — and, crucially, never re-asks a dimension absent from this
   *  list. */
  missingDimensions: Dimension[]
  /** True once all five dimensions have a recorded answer. */
  isComplete: boolean
}

function classify(score: number): Classification {
  if (score <= 3) return 'frio'
  if (score <= 6) return 'morno'
  return 'quente'
}

/**
 * Compute the total score, classification, urgency flag and missing
 * dimensions from whatever per-dimension answers have been recorded so
 * far. Pure function — same input always produces the same output, no
 * side effects, safe to call on every tool invocation.
 */
export function computeQualification(
  dimensions: Partial<Record<Dimension, DimensionScore>>,
): QualificationResult {
  let score = 0
  const missingDimensions: Dimension[] = []

  for (const dimension of DIMENSIONS) {
    const value = dimensions[dimension]
    if (value === undefined || value === null) {
      missingDimensions.push(dimension)
      continue
    }
    score += value
  }

  return {
    score,
    classification: classify(score),
    urgent: dimensions.urgencia === 2,
    missingDimensions,
    isComplete: missingDimensions.length === 0,
  }
}

/**
 * Maps the `urgencia` dimension (0/1/2) onto `lead_qualification.urgency`
 * (the pre-existing `low | medium | high | urgent` enum from migration
 * 037). `high` is deliberately unused here — the rubric only has three
 * levels, so it is reserved for any future non-rubric caller of that
 * column rather than repurposed. Returns `undefined` when the dimension
 * hasn't been answered yet, so the handler can leave the stored
 * `urgency` column untouched rather than clobbering it with a guess.
 */
export function urgencyFromDimension(
  value: DimensionScore | undefined,
): 'low' | 'medium' | 'urgent' | undefined {
  if (value === undefined) return undefined
  if (value === 2) return 'urgent'
  if (value === 1) return 'medium'
  return 'low'
}

/** Runtime guard used when reading `dimensions` back out of the stored
 *  `answers` JSONB blob, which is typed `Record<string, unknown>` and
 *  therefore untrusted at the type level even though this module wrote
 *  it. Silently drops keys/values that don't fit the rubric shape
 *  instead of throwing — corrupt historical data shouldn't crash the
 *  qualification flow, it should just be treated as "not yet answered". */
export function parseStoredDimensions(value: unknown): Partial<Record<Dimension, DimensionScore>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const result: Partial<Record<Dimension, DimensionScore>> = {}
  for (const dimension of DIMENSIONS) {
    const v = raw[dimension]
    if (v === 0 || v === 1 || v === 2) result[dimension] = v
  }
  return result
}

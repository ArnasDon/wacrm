// ============================================================
// Shape for the template-variable-fill extraction ("Gerar com IA" in
// the template-send modal). Same strict-JSON-in-prompt contract as
// lead-analysis-types.ts (no provider JSON-mode/tool-calling exists in
// this codebase's adapters) — one key per variable number, string value.
// ============================================================

/** Key = variable number as a string ("1", "2", ...), value = the text
 *  to put in that `{{N}}` slot. Always contains exactly the requested
 *  variable numbers — never more, never fewer. */
export type TemplateFillResult = Record<string, string>;

/**
 * Parse the model's raw text output into a `TemplateFillResult`
 * containing exactly `expectedIndices` (missing/invalid/extra keys are
 * dropped; a present-but-non-string value becomes ""). Never throws —
 * returns `null` only when the text isn't recoverable JSON at all, which
 * the caller treats as a genuine generation failure (distinct from the
 * model legitimately returning empty strings for every variable, which
 * is a valid — just unhelpful — result).
 */
export function parseTemplateFillResult(
  raw: string,
  expectedIndices: number[],
): TemplateFillResult | null {
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
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;

  const result: TemplateFillResult = {};
  for (const idx of expectedIndices) {
    const key = String(idx);
    const value = o[key];
    result[key] = typeof value === 'string' ? value.trim() : '';
  }
  return result;
}

/**
 * Turn whatever the user typed as a tool's "technical name" into a
 * valid function name for the LLM providers (letters/numbers/
 * underscore/hyphen only, ≤64 chars) — instead of rejecting anything
 * with spaces or accents, which is what most users will naturally
 * type first (e.g. "Salto el León - Precios").
 */
export function slugifyToolName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .trim()
    // Any run of non-alphanumeric chars (spaces, hyphens, punctuation)
    // collapses to a single underscore, so separators stay consistent
    // instead of a mix of underscores and stray hyphens.
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

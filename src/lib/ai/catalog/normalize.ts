// ============================================================
// Query normalization + progressive, tolerant matching for
// search_catalog, per AI_Catalog_Fix_Kit FASE 5 ("BÚSQUEDA NATURAL Y
// TOLERANTE"). Pure functions, no I/O — used by
// catalog/providers/data-source-provider.ts as the in-memory fallback
// tier when the DB-side exact/FTS search (search_ai_catalog_products)
// comes back empty.
//
// The ORIGINAL query text is never discarded — normalization only
// drives matching; whatever the model/tool sees back is the real
// stored product name.
// ============================================================

/** Spanish/English filler words dropped when extracting significant
 *  tokens from a natural-language query — keeps "la TCL de 50 pulgadas"
 *  from matching on "la"/"de" instead of "tcl"/"50pulgadas". */
const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o',
  'con', 'para', 'en', 'que', 'del', 'al', 'es', 'son', 'the', 'a', 'an',
  'of', 'for', 'and', 'or', 'with', 'in', 'is', 'are',
])

/** Controlled synonym groups — every member normalizes to the group's
 *  first entry. Intentionally small and curated (not a general thesaurus)
 *  so it can't introduce false positives. */
const SYNONYM_GROUPS: string[][] = [
  ['tv', 'televisor', 'television', 'smarttv'],
]
const SYNONYM_MAP: Map<string, string> = new Map(
  SYNONYM_GROUPS.flatMap((group) => group.map((word) => [word, group[0]] as const)),
)

/** Strip diacritics (á→a, ñ→n via NFD decomposition), lowercase, and
 *  collapse whitespace/hyphens. */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Canonicalize a free-text query (or a product name, for symmetric
 * comparison) so equivalent expressions collapse to the same string:
 *   50" / 50 pulgadas / 50 inch / 50in  → bare "50"
 *   64 gb / 64GB                        → 64gb
 *   tv / televisor / smart tv           → tv (SYNONYM_MAP)
 * Hyphens and extra whitespace collapse to single spaces.
 *
 * Inches are STRIPPED (leaving the bare number), not glued onto the
 * number like storage units are. Real catalog rows very often list a
 * screen/appliance size as a bare number with no unit at all
 * (e.g. "TV TCL GOOGLE TV SMART 50 4K ULTRA HD") — gluing "pulgadas"
 * onto the QUERY's "50" would never match that stored bare "50"; both
 * sides reducing to the same bare token is what makes "la TCL de 50
 * pulgadas" find a name that never says "pulgadas" at all.
 */
export function normalizeText(raw: string): string {
  let s = stripDiacritics(raw.toLowerCase().trim())
  s = s.replace(/[-_/]+/g, ' ')
  // 50" / 50in / 50 in / 50 inch(es) / 50 pulgada(s) → "50 " (bare number)
  s = s.replace(/\b(\d+)\s*(?:"|”|''|in\b|inch(?:es)?\b|pulgadas?\b)/gi, '$1 ')
  // Storage/RAM units: "64 gb" / "64GB" → "64gb" (also mb/tb) — kept
  // GLUED because that's how these already appear in real product
  // names ("SAMSUNG A05 128GB"), unlike inches.
  s = s.replace(/\b(\d+)\s*(gb|mb|tb)\b/gi, '$1$2')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * Split normalized text into significant tokens (stopwords and
 * 1-character noise dropped), applying the controlled synonym map, PLUS
 * merged letter+digit model-code pairs ("a 07", "a-07" both normalize
 * to "a 07" — see normalizeText's hyphen handling — and both need to
 * also produce "a07" so they match a candidate's glued "a07" token).
 * The original split tokens are kept too — this only ADDS candidates,
 * so it can't remove a real match, only extend recall.
 *
 * Returns the flat, combined list — used directly by simple callers
 * (see rankByTokens below for the ranking-specific split that a query's
 * coverage THRESHOLD needs).
 */
export function significantTokens(normalized: string): string[] {
  const { core, bonus } = tokenizeForRanking(normalized)
  return [...core, ...bonus]
}

/**
 * Like significantTokens, but keeps the speculative letter+digit merge
 * tokens ("de" + "64" → "de64" when "de" is only a stopword adjacent to
 * a number, not a real model-code prefix) SEPARATE from the real,
 * meaningful tokens. This matters for rankByTokens' coverage threshold:
 * a merge token can only ever ADD a match (bonus), it must never COUNT
 * toward how many matches are required, or a query like "de 64" (real
 * token: just "64") would need its own noise byproduct to also match
 * something — which it structurally can't — and would wrongly find
 * nothing.
 */
function tokenizeForRanking(normalized: string): { core: string[]; bonus: string[] } {
  const raw = normalized.split(' ').map((t) => t.trim()).filter(Boolean)
  const core: string[] = []
  for (const t of raw) {
    if (t.length > 1 && !STOPWORDS.has(t)) core.push(SYNONYM_MAP.get(t) ?? t)
  }
  const bonus: string[] = []
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i]
    const b = raw[i + 1]
    // Short letter-prefix + numeric-suffix model code split by
    // normalization ("a" + "07"), or the reverse ("07" + "a") — merge
    // into "a07" without removing the originals.
    if (/^[a-z]{1,3}$/.test(a) && /^\d{1,4}$/.test(b)) bonus.push(a + b)
    else if (/^\d{1,4}$/.test(a) && /^[a-z]{1,3}$/.test(b)) bonus.push(a + b)
  }
  return { core, bonus }
}

/** Iterative Levenshtein edit distance — small inputs only (product
 *  names / query tokens), so the O(n*m) table is cheap. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/** Typo tolerance threshold — proportionally looser for longer words,
 *  so "dispnible" (9 chars, distance 1 from "disponible") tolerates a
 *  dropped letter but a 3-char token needs an exact/near-exact hit. */
function fuzzyThreshold(len: number): number {
  if (len <= 3) return 0
  if (len <= 5) return 1
  return 2
}

/**
 * A bare number ("64") matches a number+unit token ("64gb") ONLY when
 * the numeric part is an EXACT match — anchored regex, so "64" never
 * matches "164gb" or "640gb". This is what makes "el de 64" / "64 GB" /
 * "64GB" equivalent: storage/RAM units stay glued in normalizeText
 * (they already appear glued in real catalog names), so the customer's
 * unit-less phrasing needs this one explicit bridge — unlike inches,
 * where the unit is stripped instead because real names usually omit
 * it entirely (see normalizeText's doc comment).
 */
function bareNumberMatchesUnit(a: string, b: string): boolean {
  const unit = /^(\d+)(gb|mb|tb)$/
  const bareA = /^\d+$/.test(a) ? a : null
  const bareB = /^\d+$/.test(b) ? b : null
  const matchA = a.match(unit)
  const matchB = b.match(unit)
  if (bareA && matchB) return bareA === matchB[1]
  if (bareB && matchA) return bareB === matchA[1]
  return false
}

/** True when `token` matches `candidateToken` exactly, as a substring,
 *  via the bare-number/unit bridge, or within the length-scaled
 *  Levenshtein threshold. */
function tokenMatches(token: string, candidateToken: string): boolean {
  if (token === candidateToken) return true
  if (token.length >= 3 && candidateToken.includes(token)) return true
  if (candidateToken.length >= 3 && token.includes(candidateToken)) return true
  if (bareNumberMatchesUnit(token, candidateToken)) return true
  return levenshtein(token, candidateToken) <= fuzzyThreshold(Math.max(token.length, candidateToken.length))
}

export interface ScoredMatch<T> {
  item: T
  score: number
  matchedTokens: number
}

/**
 * Progressive/tolerant ranking used when the DB-side exact/FTS search
 * finds nothing. Scores each candidate by how many of the query's
 * significant tokens it matches (exact > substring > fuzzy, each
 * scored via `tokenMatches`), so "TCL 50 pulgadas" and "TCL de 50""
 * both score every candidate whose name contains "tcl" and a token
 * equivalent to "50" — regardless of word order.
 *
 * A candidate needs a STRICT MAJORITY of the query's significant tokens
 * to match (more than half — minimum 1). A plain "half" (queryTokens/2
 * rounded up) is not enough: for a 2-token query like "Samsung A07",
 * that rounds to 1, so a decoy that only shares the brand word
 * ("Samsung A05") would still qualify on "samsung" alone — see
 * normalize.test.ts for the exact regression this guards, found twice
 * during audits (3-token and then 2-token queries). A single-word
 * query (e.g. just "samsung") still needs only that one token, so
 * plain browsing-by-brand still works.
 *
 * Sorted by score descending, ties broken by shorter name (more
 * specific match) then alphabetically for determinism.
 */
export function rankBySignificantTokens<T>(
  query: string,
  candidates: T[],
  getSearchableText: (item: T) => string,
): ScoredMatch<T>[] {
  const { core, bonus } = tokenizeForRanking(normalizeText(query))
  if (core.length === 0) return []
  const queryTokens = [...core, ...bonus]
  // Based on CORE tokens only — a speculative merge token like "de64"
  // (from "de 64", where "de" is just a stopword adjacent to a number)
  // must never count toward the denominator: it can only ever add a
  // match, never itself be required, or "de 64" (real content: just
  // "64") would need its own noise byproduct to also match something
  // it structurally never can, and wrongly find nothing.
  const minMatched = Math.max(1, Math.floor(core.length / 2) + 1)

  const scored: ScoredMatch<T>[] = []
  for (const item of candidates) {
    const candidateTokens = significantTokens(normalizeText(getSearchableText(item)))
    let matched = 0
    let score = 0
    for (const qt of queryTokens) {
      let best = 0
      for (const ct of candidateTokens) {
        if (!tokenMatches(qt, ct)) continue
        const exact = qt === ct ? 3 : ct.includes(qt) || qt.includes(ct) ? 2 : 1
        if (exact > best) best = exact
      }
      if (best > 0) {
        matched++
        score += best
      }
    }
    if (matched >= minMatched) scored.push({ item, score, matchedTokens: matched })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.matchedTokens !== a.matchedTokens) return b.matchedTokens - a.matchedTokens
    const nameA = getSearchableText(a.item)
    const nameB = getSearchableText(b.item)
    return nameA.length - nameB.length || nameA.localeCompare(nameB)
  })
  return scored
}

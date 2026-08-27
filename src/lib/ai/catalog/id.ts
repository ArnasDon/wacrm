// ============================================================
// Composite catalog ids — "<providerKey>:<nativeId>".
//
// Every id the LLM ever sees (from search_catalog / get_product) is one
// of these. Decoding it back to (providerKey, nativeId) is how
// get_availability / get_product_media route a follow-up call to the
// SAME provider + row without re-searching — which is also what makes
// the "no mixing sources" guardrail hold structurally: a tool can't
// accidentally answer with provider B's stock for a product that came
// from provider A, because the id it was given only resolves against A.
// ============================================================

// Provider keys (see resolver.ts) are always `ds_<uuid>` or
// `budun_<uuid>` — underscores, never a colon — so splitting on the
// FIRST colon unambiguously separates the provider key from the native
// id, even when the native id itself contains colons.
const SEPARATOR = ':'

export function encodeCatalogId(providerKey: string, nativeId: string): string {
  return `${providerKey}${SEPARATOR}${nativeId}`
}

/**
 * Split a composite id back into its provider key + native id. Returns
 * null for anything that doesn't contain the separator — a malformed or
 * fabricated id the model invented rather than copied from a prior tool
 * result, which callers must treat as "not found", never guess at.
 */
export function decodeCatalogId(id: string): { providerKey: string; nativeId: string } | null {
  const at = id.indexOf(SEPARATOR)
  if (at <= 0 || at === id.length - 1) return null
  return { providerKey: id.slice(0, at), nativeId: id.slice(at + 1) }
}

/**
 * Fetch a public Google Doc's plain text, for knowledge-base documents
 * with `source_type = 'google_doc'` (migration 041).
 *
 * No OAuth: Google serves `.../export?format=txt` with no
 * authentication as long as the doc is shared "Anyone with the link"
 * (or published to the web) — the same endpoint works for either
 * sharing mode, so callers don't need to know which one the user used.
 */

const FETCH_TIMEOUT_MS = 10_000

/** Extract the document id from any Google Docs URL the user might paste. */
export function extractGoogleDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * Fetch the doc's plain-text export. Throws a human-readable error on
 * any failure — callers (the knowledge sync route) surface this
 * directly to the admin.
 */
export async function fetchGoogleDocText(docId: string): Promise<string> {
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`No se pudo contactar a Google Docs: ${msg}`)
  }

  if (!res.ok) {
    throw new Error(
      'El documento no es público o no existe. Verifica que el acceso esté configurado como "Cualquiera con el enlace puede ver".',
    )
  }

  const text = await res.text()
  if (!text.trim()) {
    throw new Error('El documento está vacío.')
  }
  return text
}

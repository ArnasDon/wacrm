/**
 * Fetch a public Google Slides presentation's plain text. Same
 * no-OAuth trick as `google-docs.ts` — Google serves
 * `.../export/txt` with no authentication as long as the
 * presentation is shared "Anyone with the link" (or published to
 * the web).
 */

const FETCH_TIMEOUT_MS = 10_000

/** Extract the presentation id from any Google Slides URL the user might paste. */
export function extractGoogleSlidesId(url: string): string | null {
  const match = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

/** Fetch the presentation's plain-text export (every slide's text,
 *  concatenated). Throws a human-readable error on any failure. */
export async function fetchGoogleSlidesText(presentationId: string): Promise<string> {
  const url = `https://docs.google.com/presentation/d/${presentationId}/export/txt`

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`No se pudo contactar a Google Slides: ${msg}`)
  }

  if (!res.ok) {
    throw new Error(
      'La presentación no es pública o no existe. Verifica que el acceso esté configurado como "Cualquiera con el enlace puede ver".',
    )
  }

  const text = await res.text()
  if (!text.trim()) {
    throw new Error('La presentación está vacía.')
  }
  return text
}

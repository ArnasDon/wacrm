/**
 * "Read a public OneDrive/SharePoint file" tool — the executable
 * behind an `ai_tools` row of type 'onedrive' (migration 045).
 *
 * Unlike Google, there's no anonymous "export as text/CSV" endpoint
 * for OneDrive — the only anonymous access a public share link gives
 * is the file's own viewer page. The `download=1` query param is a
 * long-standing, widely-relied-on trick that makes OneDrive/SharePoint
 * serve the raw file instead of that viewer page, for any link shared
 * as "Anyone with the link can view". A `1drv.ms` short link (and some
 * SharePoint links) redirect one or more times before landing on the
 * actual file host, so this follows redirects itself (capped, and
 * SSRF-checked on every hop — the request is fully server-side and
 * automatic, triggered by inbound customer messages) instead of
 * letting `fetch` do it silently.
 *
 * Best-effort by nature: link formats and behavior are Microsoft's to
 * change, and this only handles the "Anyone with the link" case, not
 * an org-restricted share.
 */

import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { extractDocxText, extractPptxText, formatXlsxForModel } from './office-text'
import { truncateText } from './format-rows'

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 15 * 1024 * 1024
const MAX_REDIRECTS = 5

const ONEDRIVE_HOST_RE = /(^|\.)onedrive\.live\.com$|^1drv\.ms$|\.sharepoint\.com$/i

/** True for a OneDrive personal, `1drv.ms` short link, or SharePoint host. */
export function isOneDriveUrl(url: string): boolean {
  try {
    return ONEDRIVE_HOST_RE.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function withDownloadParam(url: string): string {
  const u = new URL(url)
  u.searchParams.set('download', '1')
  return u.toString()
}

/** Follow redirects manually (SSRF-checking every hop) until a
 *  non-redirect response, appending `download=1` up front so the
 *  chain lands on the raw file instead of the HTML viewer. */
async function fetchOneDriveResponse(rawUrl: string): Promise<Response> {
  if (!isOneDriveUrl(rawUrl)) {
    throw new Error('no es un link de OneDrive/SharePoint reconocido')
  }

  let current = withDownloadParam(rawUrl)
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    if (!(await isDeliverableUrl(current))) {
      throw new Error('el link no es accesible públicamente')
    }
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel()?.catch(() => {})
      if (!location) throw new Error('respuesta de redirección sin destino')
      current = new URL(location, current).toString()
      continue
    }
    if (!res.ok) throw new Error(`el servidor respondió con estado ${res.status}`)
    return res
  }
  throw new Error('demasiadas redirecciones')
}

/** Fetch + extract the file's text content. Throws a human-readable
 *  error on any failure or unsupported type. */
export async function fetchOneDriveText(rawUrl: string): Promise<string> {
  const res = await fetchOneDriveResponse(rawUrl)
  const contentType = res.headers.get('content-type') ?? ''

  // No anonymous way past OneDrive's own interstitials (large file,
  // needs sign-in, link expired, ...) — they come back as HTML.
  if (contentType.startsWith('text/html')) {
    throw new Error(
      'no se pudo descargar el archivo directamente — revisa que esté compartido como "Cualquiera con el enlace puede ver" y no requiera iniciar sesión.',
    )
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    throw new Error('el archivo es demasiado grande (máximo 15 MB)')
  }

  // OneDrive's content-type for a plain text/CSV download is often a
  // generic octet-stream, so fall back to the resolved URL's
  // extension when the header alone isn't conclusive.
  const finalUrl = res.url || rawUrl
  if (contentType.includes('wordprocessingml.document') || /\.docx(?:[?#]|$)/i.test(finalUrl)) {
    return extractDocxText(buf)
  }
  if (contentType.includes('spreadsheetml.sheet') || /\.xlsx(?:[?#]|$)/i.test(finalUrl)) {
    return formatXlsxForModel(buf)
  }
  if (contentType.includes('presentationml.presentation') || /\.pptx(?:[?#]|$)/i.test(finalUrl)) {
    return extractPptxText(buf)
  }
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/octet-stream' ||
    !contentType ||
    /\.(txt|csv|md)(?:[?#]|$)/i.test(finalUrl)
  ) {
    return buf.toString('utf8')
  }

  throw new Error(
    `tipo de archivo no soportado (${contentType || 'desconocido'}). Usa texto plano, Word, Excel o PowerPoint.`,
  )
}

/**
 * Run the tool end-to-end for a given `ai_tools` row. Never throws —
 * any failure becomes a readable string returned AS the tool result.
 */
export async function runOneDriveTool(tool: { drive_url: string }): Promise<string> {
  try {
    return truncateText(await fetchOneDriveText(tool.drive_url))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `Error al consultar OneDrive: ${message}`
  }
}

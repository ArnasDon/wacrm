/**
 * Fetch a public Google Drive file that isn't a native Doc/Sheet/Slides
 * — a plain text file, or an uploaded .docx/.xlsx/.pptx kept in its
 * original Office format (Drive doesn't convert those to a Google
 * format unless the uploader asked it to). No OAuth: `uc?export=download`
 * serves the raw bytes with no authentication as long as the file is
 * shared "Anyone with the link".
 */

import { extractDocxText, extractPptxText, formatXlsxForModel } from './office-text'

const FETCH_TIMEOUT_MS = 15_000
/** Guards against a pathologically large upload blowing memory/latency —
 *  well past anything a "reference document" tool needs. */
const MAX_BYTES = 15 * 1024 * 1024

/** Extract the file id from a Drive file share link (`/file/d/{id}/...`)
 *  or a direct `?id=` download link. */
export function extractGoogleDriveFileId(url: string): string | null {
  const shareMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (shareMatch) return shareMatch[1]
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  return idMatch ? idMatch[1] : null
}

/** Fetch + extract the file's text content, dispatching on the
 *  response's declared content type. Throws a human-readable error on
 *  any failure or unsupported type. */
export async function fetchGoogleDriveFileText(fileId: string): Promise<string> {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`No se pudo contactar a Google Drive: ${msg}`)
  }

  if (!res.ok) {
    throw new Error(
      'El archivo no es público o no existe. Verifica que el acceso esté configurado como "Cualquiera con el enlace puede ver".',
    )
  }

  const contentType = res.headers.get('content-type') ?? ''

  // Files too large for the direct-download link get an HTML "virus
  // scan warning" interstitial instead of the file — there's no
  // anonymous way past it, so fail with a clear message rather than
  // returning that page's text as if it were the document.
  if (contentType.startsWith('text/html')) {
    throw new Error(
      'El archivo es demasiado grande para descargarlo automáticamente (Google Drive pide confirmación manual para archivos grandes).',
    )
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    throw new Error('El archivo es demasiado grande (máximo 15 MB).')
  }

  if (contentType.includes('wordprocessingml.document')) return extractDocxText(buf)
  if (contentType.includes('spreadsheetml.sheet')) return formatXlsxForModel(buf)
  if (contentType.includes('presentationml.presentation')) return extractPptxText(buf)
  if (contentType.startsWith('text/') || contentType === 'application/octet-stream' || !contentType) {
    return buf.toString('utf8')
  }

  throw new Error(
    `Tipo de archivo no soportado (${contentType || 'desconocido'}). Usa texto plano, Word, Excel o PowerPoint.`,
  )
}

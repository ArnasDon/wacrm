/**
 * "Read something from Google Drive" tool — the executable behind an
 * `ai_tools` row of type 'google_drive' (migration 045, renamed from
 * the Sheets-only 'google_sheet' of migration 042). Detects which
 * kind of Drive resource the configured URL points to and dispatches
 * to the matching fetcher — Sheets (CSV export), Docs (text export),
 * Slides (text export), or a generic Drive file (plain text, or an
 * uploaded .docx/.xlsx/.pptx kept in its original Office format).
 */

import { extractGoogleSheetRef, runGoogleSheetTool } from './google-sheet'
import { extractGoogleDocId, fetchGoogleDocText } from '../google-docs'
import { extractGoogleSlidesId, fetchGoogleSlidesText } from './google-slides'
import { extractGoogleDriveFileId, fetchGoogleDriveFileText } from './google-drive-file'
import { truncateText } from './format-rows'

function isGoogleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'docs.google.com' || host === 'drive.google.com'
  } catch {
    return false
  }
}

/** True if `url` looks like a Sheets, Docs, Slides, or Drive file link
 *  this tool knows how to read — used by the settings API to validate
 *  the URL before saving. */
export function isValidGoogleDriveUrl(url: string): boolean {
  if (!isGoogleHost(url)) return false
  return (
    !!extractGoogleSheetRef(url) ||
    !!extractGoogleDocId(url) ||
    !!extractGoogleSlidesId(url) ||
    !!extractGoogleDriveFileId(url)
  )
}

/**
 * Run the tool end-to-end for a given `ai_tools` row. Never throws —
 * any failure becomes a readable string returned AS the tool result.
 */
export async function runGoogleDriveTool(tool: { drive_url: string }): Promise<string> {
  const url = tool.drive_url
  if (!isGoogleHost(url)) {
    return 'Error: la URL configurada no es un link de Google (Sheets, Docs, Slides o Drive).'
  }

  try {
    const sheetRef = extractGoogleSheetRef(url)
    if (sheetRef) return await runGoogleSheetTool({ url })

    const docId = extractGoogleDocId(url)
    if (docId) return truncateText(await fetchGoogleDocText(docId))

    const slidesId = extractGoogleSlidesId(url)
    if (slidesId) return truncateText(await fetchGoogleSlidesText(slidesId))

    const fileId = extractGoogleDriveFileId(url)
    if (fileId) return truncateText(await fetchGoogleDriveFileText(fileId))

    return 'Error: la URL de Google Drive configurada no es válida. Debe ser un link de Sheets, Docs, Slides o de un archivo de Drive.'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `Error al consultar Google Drive: ${message}`
  }
}

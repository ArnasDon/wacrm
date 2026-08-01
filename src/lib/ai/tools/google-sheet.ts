/**
 * "Read a Google Sheet" tool — the executable behind an `ai_tools`
 * row (migration 042). No OAuth: fetches the sheet's public CSV
 * export, which Google serves with no authentication as long as the
 * sheet is shared "Anyone with the link" (or published to the web).
 *
 * Returns the WHOLE sheet (capped) rather than doing a row-level
 * text match. Real-world pricing/schedule sheets are often laid out
 * as a matrix with headers split across multiple rows (category name
 * row, sub-label row, values row) — a naive "find the row containing
 * the search term" misses the data entirely, since the number the
 * customer wants usually isn't on the same row as its label. Small
 * business reference sheets (prices, hours) are a few KB at most, so
 * letting the model read the full table itself is both simpler and
 * far more reliable than trying to out-guess every possible layout.
 */

import { formatRowsForModel } from './format-rows'

const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 60_000

/** Extract {sheetId, gid} from any Google Sheets URL the user might paste
 *  (a normal share link or a "Publish to web" link both contain the id). */
export function extractGoogleSheetRef(
  url: string,
): { sheetId: string; gid?: string } | null {
  const idMatch = url.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/)
  if (!idMatch) return null
  const gidMatch = url.match(/[?&#]gid=(\d+)/)
  return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : undefined }
}

/**
 * Minimal RFC4180-ish CSV line parser — handles quoted fields,
 * commas-inside-quotes, and doubled `""` escaped quotes. Does not
 * handle a quoted field spanning multiple lines (rare in exported
 * sheet data; each row is one line here).
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((h) => h.trim())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cells = parseCsvLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h || `col_${idx + 1}`] = (cells[idx] ?? '').trim()
    })
    rows.push(row)
  }
  return rows
}

interface CacheEntry {
  rows: Record<string, string>[]
  fetchedAt: number
}

// In-memory per-process cache, same single-instance assumption as
// rate-limit.ts / reply-buffer.ts. Keeps repeated tool calls (e.g. a
// burst of messages all asking about prices) from re-fetching Google
// on every single request.
const cache = new Map<string, CacheEntry>()

async function fetchSheetRows(
  sheetId: string,
  gid?: string,
): Promise<Record<string, string>[]> {
  const cacheKey = `${sheetId}:${gid ?? ''}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rows
  }

  const params = new URLSearchParams({ format: 'csv' })
  if (gid) params.set('gid', gid)
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?${params.toString()}`

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(
      'La planilla no es pública o no existe. Verifica que el acceso esté configurado como "Cualquiera con el enlace puede ver".',
    )
  }
  const text = await res.text()
  const rows = parseCsv(text)
  cache.set(cacheKey, { rows, fetchedAt: Date.now() })
  return rows
}

/**
 * Run the tool end-to-end for a given `ai_tools` row — fetches and
 * returns the full sheet content (capped). Never throws — any failure
 * becomes a readable string returned AS the tool result, so the model
 * can tell the customer it couldn't look something up right now
 * instead of the whole reply breaking.
 */
export async function runGoogleSheetTool(tool: { url: string }): Promise<string> {
  try {
    const ref = extractGoogleSheetRef(tool.url)
    if (!ref) return 'Error: la URL de la planilla configurada no es válida.'
    const rows = await fetchSheetRows(ref.sheetId, ref.gid)
    return formatRowsForModel(rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `Error al consultar la planilla: ${message}`
  }
}

/**
 * Text extraction from Office Open XML files (.docx/.xlsx/.pptx) — the
 * binary formats OneDrive serves for its native download, and that a
 * file uploaded (not natively created) into Google Drive keeps too.
 *
 * Deliberately plain-text-only: paragraph/run text and cell values,
 * no styling, images, tables-inside-tables, or embedded objects. That
 * covers what a small business would actually connect (a price list,
 * a policy doc, a menu deck) without pulling in a full document-model
 * parser.
 */

import { extractTagText, readZipEntries } from './ooxml'
import { formatRowsForModel } from './format-rows'

/** word/document.xml → paragraph text, one per line. */
export function extractDocxText(buf: Buffer): string {
  const entries = readZipEntries(buf)
  const xml = entries.get('word/document.xml')
  if (!xml) throw new Error('no es un archivo .docx válido (falta word/document.xml)')

  const paragraphs = xml.toString('utf8').split(/<\/w:p>/)
  const lines = paragraphs
    .map((p) => extractTagText(p, 'w:t').join(''))
    .filter((line) => line.length > 0)
  return lines.join('\n')
}

/** ppt/slides/slideN.xml → text runs per slide, slides in order. */
export function extractPptxText(buf: Buffer): string {
  const entries = readZipEntries(buf)
  const slideNames = [...entries.keys()]
    .map((name) => ({ name, n: Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n)

  if (slideNames.length === 0) throw new Error('no es un archivo .pptx válido (no tiene diapositivas)')

  return slideNames
    .map(({ name, n }) => {
      const xml = entries.get(name)!.toString('utf8')
      const text = extractTagText(xml, 'a:t').join(' ').trim()
      return `Diapositiva ${n}:\n${text || '(sin texto)'}`
    })
    .join('\n\n')
}

/** xl/sharedStrings.xml → the shared-string table, index-ordered. */
function readSharedStrings(entries: Map<string, Buffer>): string[] {
  const xml = entries.get('xl/sharedStrings.xml')
  if (!xml) return []
  const text = xml.toString('utf8')
  const items = text.split(/<\/si>/)
  return items.map((item) => extractTagText(item, 't').join(''))
}

/** "A1" → 0, "B1" → 1, "AA1" → 26, ... (column letters only, digits dropped). */
function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? 'A'
  let index = 0
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64)
  }
  return index - 1
}

/** xl/worksheets/sheet1.xml — only the first sheet, same "small
 *  business reference table" scope as the Google Sheets tool. */
export function extractXlsxRows(buf: Buffer): Record<string, string>[] {
  const entries = readZipEntries(buf)
  const sheetXml = entries.get('xl/worksheets/sheet1.xml')
  if (!sheetXml) throw new Error('no es un archivo .xlsx válido (falta la primera hoja)')

  const sharedStrings = readSharedStrings(entries)
  const xml = sheetXml.toString('utf8')
  const rowChunks = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []

  const cellValue = (attrs: string, inner: string): string => {
    const type = attrs.match(/\bt="([a-zA-Z]+)"/)?.[1]
    if (type === 's') {
      const idx = Number(extractTagText(inner, 'v')[0])
      return sharedStrings[idx] ?? ''
    }
    if (type === 'inlineStr') return extractTagText(inner, 't').join('')
    return extractTagText(inner, 'v')[0] ?? ''
  }

  const rows: Record<string, string>[] = []
  let headers: string[] = []
  for (const rowChunk of rowChunks) {
    const cellMatches = rowChunk.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)
    const byColumn = new Map<number, string>()
    let maxCol = -1
    for (const [, attrs, inner] of cellMatches) {
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      if (!ref) continue
      const col = columnIndex(ref)
      byColumn.set(col, cellValue(attrs, inner ?? ''))
      maxCol = Math.max(maxCol, col)
    }
    if (maxCol === -1) continue

    if (rows.length === 0 && headers.length === 0) {
      headers = Array.from({ length: maxCol + 1 }, (_, i) => byColumn.get(i)?.trim() || `col_${i + 1}`)
      continue
    }
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = (byColumn.get(i) ?? '').trim()
    })
    rows.push(row)
  }

  return rows
}

export function formatXlsxForModel(buf: Buffer): string {
  return formatRowsForModel(extractXlsxRows(buf))
}

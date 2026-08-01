/** Shared by every "tabular data" tool source (Google Sheets CSV export,
 *  an .xlsx sheet) so they all cap output the same way for the model's
 *  token budget, instead of each source picking its own limits. */
export const MAX_ROWS = 200
export const MAX_CHARS = 12_000

export function formatRowsForModel(
  rows: Record<string, string>[],
  emptyMessage = 'La planilla está vacía.',
): string {
  if (rows.length === 0) return emptyMessage

  const rowsTruncated = rows.length > MAX_ROWS
  const shown = rows.slice(0, MAX_ROWS)

  let text = shown
    .map((row, i) =>
      `Fila ${i + 1}: ` +
      Object.entries(row)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', '),
    )
    .join('\n')

  let charsTruncated = false
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS)
    charsTruncated = true
  }

  if (rowsTruncated || charsTruncated) {
    text += `\n\n[Planilla truncada — mostrando ${shown.length} de ${rows.length} filas.]`
  }
  return text
}

/** Caps free-form text (a Doc, a Slides deck, an extracted .docx/.pptx)
 *  to the same order-of-magnitude budget as a tabular result. */
export function truncateText(text: string, note = '\n\n[Texto truncado.]'): string {
  if (text.length <= MAX_CHARS) return text
  return text.slice(0, MAX_CHARS) + note
}

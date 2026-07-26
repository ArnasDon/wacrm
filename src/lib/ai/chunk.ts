// ============================================================
// Knowledge-base chunking.
//
// Splits a pasted document into retrieval-sized pieces. Paragraph-aware
// (FAQ/policy docs are naturally paragraph-delimited, and each Q&A stays
// intact), greedily packed up to `maxChars`, with oversized paragraphs
// hard-split as a fallback. Pure + deterministic so it's trivially
// testable and produces stable chunk boundaries across re-ingests.
// ============================================================

const DEFAULT_MAX_CHARS = 1200

export function chunkText(
  content: string,
  opts: { maxChars?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const text = content.replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Paragraph alone exceeds the budget — flush what we have, then
      // hard-split it into fixed windows.
      flush()
      for (let i = 0; i < para.length; i += maxChars) {
        const slice = para.slice(i, i + maxChars).trim()
        if (slice) chunks.push(slice)
      }
      continue
    }
    // +2 accounts for the "\n\n" joiner we add between paragraphs.
    if (current && current.length + 2 + para.length > maxChars) flush()
    current = current ? `${current}\n\n${para}` : para
  }
  flush()

  return chunks
}

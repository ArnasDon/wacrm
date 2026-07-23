export interface KnowledgeChunk {
  chunkIndex: number
  content: string
  tokenEstimate: number
}

const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP_CHARS = 160

export function normalizeKnowledgeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n\n')
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}

export function chunkKnowledgeText(
  input: string,
  opts: { maxChars?: number; overlapChars?: number } = {},
): KnowledgeChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS

  if (overlapChars < 0) throw new Error('overlapChars must be non-negative')
  if (overlapChars >= maxChars) throw new Error('overlapChars must be smaller than maxChars')
  if (maxChars < 20) throw new Error('maxChars must be at least 20')

  const text = normalizeKnowledgeText(input)
  if (!text) return []

  const chunks: KnowledgeChunk[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end)
      const sentenceBreak = Math.max(
        text.lastIndexOf('. ', end),
        text.lastIndexOf('? ', end),
        text.lastIndexOf('! ', end),
      )
      const whitespaceBreak = text.lastIndexOf(' ', end)
      const candidate = [paragraphBreak, sentenceBreak > -1 ? sentenceBreak + 1 : -1, whitespaceBreak]
        .filter((index) => index > start + Math.floor(maxChars * 0.5))
        .sort((a, b) => b - a)[0]
      if (candidate) end = candidate
    }

    const content = text.slice(start, end).trim()
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
      })
    }

    if (end >= text.length) break
    const nextStart = Math.max(0, end - overlapChars)
    start = nextStart <= start ? end : nextStart
  }

  return chunks
}

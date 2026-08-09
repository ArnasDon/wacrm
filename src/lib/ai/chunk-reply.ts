export const REPLY_SPLIT_MARKER = '[[SPLIT]]'

const HEURISTIC_SPLIT_MIN_LENGTH = 360

function normalizeMaxChunks(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(5, Math.max(1, Math.floor(value)))
}

function cleanParts(parts: string[]): string[] {
  return parts
    .map((part) => part.trim().replace(/\n{3,}/g, '\n\n'))
    .filter(Boolean)
}

function capParts(parts: string[], maxChunks: number): string[] {
  if (parts.length <= maxChunks) return parts
  return [
    ...parts.slice(0, maxChunks - 1),
    parts.slice(maxChunks - 1).join('\n\n'),
  ]
}

function splitLongReply(text: string, maxChunks: number): string[] {
  if (text.length < HEURISTIC_SPLIT_MIN_LENGTH || maxChunks === 1) {
    return [text]
  }

  const paragraphs = cleanParts(text.split(/\n\s*\n+/))
  if (paragraphs.length > 1) return capParts(paragraphs, maxChunks)

  const sentences = cleanParts(text.split(/(?<=[.!?…])\s+/u))
  if (sentences.length < 2) return [text]

  const targetLength = Math.ceil(text.length / maxChunks)
  const groups: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (
      current &&
      groups.length < maxChunks - 1 &&
      candidate.length > targetLength
    ) {
      groups.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) groups.push(current)

  return groups
}

/**
 * Turns one model response into WhatsApp-sized conversational bubbles.
 * The model's explicit marker wins; long unmarked replies fall back to
 * paragraph/sentence boundaries and short replies remain untouched.
 */
export function splitReplyIntoChunks(text: string, maxChunks: number): string[] {
  const cleanText = text.trim()
  if (!cleanText) return []

  const limit = normalizeMaxChunks(maxChunks)
  if (limit === 1) {
    return [cleanText.split(REPLY_SPLIT_MARKER).join(' ').trim()]
  }

  if (cleanText.includes(REPLY_SPLIT_MARKER)) {
    const explicit = cleanParts(cleanText.split(REPLY_SPLIT_MARKER))
    return capParts(explicit, limit)
  }

  return splitLongReply(cleanText, limit)
}

/** A short, length-sensitive pause before the next WhatsApp bubble. */
export function replyChunkDelayMs(previousChunk: string): number {
  return Math.min(2_000, 1_000 + previousChunk.length * 8)
}

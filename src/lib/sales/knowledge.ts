import type { KnowledgeDoc } from '@/lib/db/types'

// ============================================================
// Knowledge base — what the rep knows beyond the catalogue.
//
// Merchants write plain question/answer pairs ("How long does a logo
// take?" / "Three working days after the brief is approved"). They go
// into the AI prompt so the rep answers instead of handing off, and
// they are the ONLY source for policy answers: the rep is told not to
// invent anything that isn't here or in the catalogue.
// ============================================================

export const MAX_ENTRIES = 60
export const MAX_QUESTION = 160
export const MAX_ANSWER = 1200
/** Keep the prompt affordable — roughly 1.5k tokens of knowledge. */
const MAX_PROMPT_CHARS = 6000

/** Prompt block, or null when the merchant hasn't written anything. */
export function knowledgeBaseText(entries: Pick<KnowledgeDoc, 'question' | 'answer' | 'isActive'>[]): string | null {
  const lines: string[] = []
  let used = 0
  for (const e of entries) {
    if (!e.isActive) continue
    const block = `Q: ${e.question.trim()}\nA: ${e.answer.trim()}`
    if (used + block.length > MAX_PROMPT_CHARS) break
    used += block.length
    lines.push(block)
  }
  return lines.length ? lines.join('\n\n') : null
}

import type { KnowledgeDoc } from '@/lib/db/types'

// ============================================================
// What the rep knows beyond the catalogue.
//
// Two parts, because merchants think in both:
//   "About the business" — free text they write once: what they do,
//   how they work, what makes them different. Gives the rep something
//   to hold a conversation with.
//   Quick answers — question/answer pairs for the things customers ask
//   over and over (turnaround, delivery, hours, refunds).
//
// Both go into the prompt as the ONLY source for anything that isn't a
// product: the rep is told not to invent policies, so whatever is
// missing here becomes a handoff.
// ============================================================

export const MAX_ENTRIES = 60
export const MAX_QUESTION = 160
export const MAX_ANSWER = 1200
export const MAX_ABOUT = 4000
/** Keep the prompt affordable — quick answers are trimmed to fit. */
const MAX_ENTRY_CHARS = 4000

/** The prompt block, or null when the merchant hasn't written anything. */
export function knowledgeBaseText(
  about: string | null | undefined,
  entries: Pick<KnowledgeDoc, 'question' | 'answer' | 'isActive'>[],
): string | null {
  const parts: string[] = []
  const trimmed = (about ?? '').trim()
  if (trimmed) parts.push(`ABOUT THE BUSINESS:\n${trimmed.slice(0, MAX_ABOUT)}`)

  const qa: string[] = []
  let used = 0
  for (const e of entries) {
    if (!e.isActive) continue
    const block = `Q: ${e.question.trim()}\nA: ${e.answer.trim()}`
    if (used + block.length > MAX_ENTRY_CHARS) break
    used += block.length
    qa.push(block)
  }
  if (qa.length) parts.push(`COMMON QUESTIONS:\n${qa.join('\n\n')}`)

  return parts.length ? parts.join('\n\n') : null
}

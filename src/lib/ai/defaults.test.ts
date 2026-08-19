import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, HANDOFF_SENTINEL } from './defaults'

// The exact string that shipped before `handoffSensitivity` existed —
// 'balanced' must reproduce it verbatim so every account that never
// touches the new Setup field sees a byte-identical system prompt.
const PRE_EXISTING_BALANCED_INSTRUCTION =
  `You are replying automatically with no human in the loop. If you cannot confidently and safely help — the customer explicitly asks for a human, is upset or complaining, or the request needs information you do not have — reply with exactly ${HANDOFF_SENTINEL} and nothing else. A human agent will then take over. Prefer handing off over guessing.`

const ANTI_HALLUCINATION_GUIDELINE =
  'never invent facts, prices, order numbers, availability, or promises that are not supported by the conversation or the business context below'

describe('buildSystemPrompt — handoff sensitivity', () => {
  it('defaults to balanced when omitted, matching the pre-existing wording exactly', () => {
    const { systemPrompt } = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(systemPrompt).toContain(PRE_EXISTING_BALANCED_INSTRUCTION)
  })

  it('balanced (explicit) matches the pre-existing wording exactly', () => {
    const { systemPrompt } = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      handoffSensitivity: 'balanced',
    })
    expect(systemPrompt).toContain(PRE_EXISTING_BALANCED_INSTRUCTION)
  })

  it('conservative and assertive differ from balanced', () => {
    const balanced = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      handoffSensitivity: 'balanced',
    })
    const conservative = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      handoffSensitivity: 'conservative',
    })
    const assertive = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      handoffSensitivity: 'assertive',
    })
    expect(conservative.systemPrompt).not.toBe(balanced.systemPrompt)
    expect(assertive.systemPrompt).not.toBe(balanced.systemPrompt)
    expect(conservative.systemPrompt).not.toBe(assertive.systemPrompt)
  })

  it('every level still instructs the handoff sentinel', () => {
    for (const level of ['conservative', 'balanced', 'assertive'] as const) {
      const { systemPrompt } = buildSystemPrompt({
        userPrompt: null,
        mode: 'auto_reply',
        handoffSensitivity: level,
      })
      expect(systemPrompt).toContain(HANDOFF_SENTINEL)
    }
  })

  it('the anti-hallucination guideline is present and identical at every level', () => {
    for (const level of ['conservative', 'balanced', 'assertive'] as const) {
      const { systemPrompt } = buildSystemPrompt({
        userPrompt: null,
        mode: 'auto_reply',
        handoffSensitivity: level,
      })
      expect(systemPrompt).toContain(ANTI_HALLUCINATION_GUIDELINE)
    }
  })

  it('draft mode ignores handoffSensitivity — no handoff instruction at all', () => {
    const { systemPrompt } = buildSystemPrompt({
      userPrompt: null,
      mode: 'draft',
      handoffSensitivity: 'assertive',
    })
    expect(systemPrompt).not.toContain(HANDOFF_SENTINEL)
  })

  it('the knowledge-base excerpts land in knowledgeBlock, not systemPrompt', () => {
    const { systemPrompt, knowledgeBlock } = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      knowledge: ['Returns accepted within 30 days.'],
      handoffSensitivity: 'balanced',
    })
    expect(knowledgeBlock).toContain('Returns accepted within 30 days.')
    expect(systemPrompt).not.toContain('Returns accepted within 30 days.')
  })

  it('knowledgeBlock is undefined when there are no excerpts', () => {
    const { knowledgeBlock } = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(knowledgeBlock).toBeUndefined()
  })

  it('the knowledge-base fallback wording also varies with sensitivity', () => {
    const balanced = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      knowledge: ['Returns accepted within 30 days.'],
      handoffSensitivity: 'balanced',
    })
    const assertive = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      knowledge: ['Returns accepted within 30 days.'],
      handoffSensitivity: 'assertive',
    })
    expect(balanced.knowledgeBlock).toContain(
      `reply with exactly ${HANDOFF_SENTINEL} so a human can help`,
    )
    expect(assertive.knowledgeBlock).not.toContain(
      `reply with exactly ${HANDOFF_SENTINEL} so a human can help`,
    )
  })
})

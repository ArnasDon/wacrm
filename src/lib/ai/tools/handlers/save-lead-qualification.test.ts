import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  getLeadQualification: vi.fn(),
  upsertLeadQualification: vi.fn(),
  createAgentNotification: vi.fn(),
}))
vi.mock('@/lib/eter/repo/lead-qualification.repo', () => ({
  getLeadQualification: h.getLeadQualification,
  upsertLeadQualification: h.upsertLeadQualification,
}))
vi.mock('@/lib/eter/repo/notifications.repo', () => ({
  createAgentNotification: h.createAgentNotification,
}))

import { saveLeadQualificationHandler } from './save-lead-qualification'
import type { ToolHandlerContext } from './context'

const db = {} as SupabaseClient

function ctx(overrides: Partial<ToolHandlerContext> = {}): ToolHandlerContext {
  return {
    db,
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    defaultNotifyUserId: 'user-admin',
    ...overrides,
  }
}

function lq(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lq-1',
    accountId: 'acct-1',
    contactId: 'contact-1',
    score: null,
    stage: null,
    urgency: null,
    answers: {},
    qualifiedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: upsert just echoes back whatever it was asked to persist,
  // like the real repo does after a round-trip through Supabase.
  h.upsertLeadQualification.mockImplementation((_db, _acct, _contact, input) =>
    Promise.resolve(
      lq({
        score: input.score,
        stage: input.stage,
        urgency: input.urgency ?? null,
        answers: input.answers,
        qualifiedAt: input.qualified ? new Date() : null,
      }),
    ),
  )
})

describe('saveLeadQualificationHandler — deterministic scoring', () => {
  it('never trusts a model-supplied score/stage — always persists the computed value', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    const result = await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      score: 999, // hallucinated by the model — must be ignored
      stage: 'quente', // also hallucinated — dimensions below only sum to 2 (frio)
      dimensions: { necessidade: 1, autoridade: 1 },
    })

    expect(result.isError).toBe(false)
    const payload = h.upsertLeadQualification.mock.calls[0][3]
    expect(payload.score).toBe(2) // 1 + 1, NOT 999
    expect(payload.stage).toBe('frio') // computed from score=2, NOT the model's "quente"

    const body = JSON.parse(result.content)
    expect(body.score).toBe(2)
    expect(body.stage).toBe('frio')
  })

  it('partial dimension updates merge with, and do not wipe, previously stored dimensions', async () => {
    h.getLeadQualification.mockResolvedValue(
      lq({ answers: { dimensions: { necessidade: 2, autoridade: 1 }, foo: 'bar' } }),
    )

    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { urgencia: 1 },
    })

    const payload = h.upsertLeadQualification.mock.calls[0][3]
    expect(payload.answers.dimensions).toEqual({ necessidade: 2, autoridade: 1, urgencia: 1 })
    expect(payload.score).toBe(4) // 2 + 1 + 1
    expect(payload.stage).toBe('morno')
  })

  it('a later call for the same dimension overwrites just that dimension, not the others', async () => {
    h.getLeadQualification.mockResolvedValue(lq({ answers: { dimensions: { necessidade: 1 } } }))

    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 2 },
    })

    const payload = h.upsertLeadQualification.mock.calls[0][3]
    expect(payload.answers.dimensions).toEqual({ necessidade: 2 })
  })

  it('derives lead_qualification.urgency from the urgencia dimension, not a free-text argument', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { urgencia: 2 },
    })

    const payload = h.upsertLeadQualification.mock.calls[0][3]
    expect(payload.urgency).toBe('urgent')
  })

  it('rejects an out-of-range dimension value as a clean tool error, not a throw', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    const result = await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 5 },
    })

    expect(result.isError).toBe(true)
    expect(h.upsertLeadQualification).not.toHaveBeenCalled()
  })
})

describe('saveLeadQualificationHandler — notify_admin trigger', () => {
  it('notifies the admin when the lead becomes quente', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    const result = await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 2, autoridade: 2, urgencia: 2, enquadramento: 1 }, // score 7 = quente
    })

    expect(h.createAgentNotification).toHaveBeenCalledTimes(1)
    const body = JSON.parse(result.content)
    expect(body.notifiedAdmin).toBe(true)
  })

  it('notifies the admin when urgencia = 2 even if the overall classification stays frio', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 0, autoridade: 0, urgencia: 2, enquadramento: 0, dimensao: 0 }, // score 2 = frio
    })

    expect(h.createAgentNotification).toHaveBeenCalledTimes(1)
    const payload = h.upsertLeadQualification.mock.calls[0][3]
    expect(payload.stage).toBe('frio')
  })

  it('does NOT notify when the lead is morno and urgencia is below 2', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 2, autoridade: 2, urgencia: 1 }, // score 5 = morno
    })

    expect(h.createAgentNotification).not.toHaveBeenCalled()
  })

  it('fires exactly once per qualifying transition — a second call while still quente does not re-notify', async () => {
    // First call: not yet notified.
    h.getLeadQualification.mockResolvedValueOnce(null)
    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 2, autoridade: 2, urgencia: 2, enquadramento: 1 }, // quente
    })
    expect(h.createAgentNotification).toHaveBeenCalledTimes(1)

    const persistedAnswers = h.upsertLeadQualification.mock.calls[0][3].answers
    expect(typeof persistedAnswers.notified_admin_at).toBe('string')

    // Second call: repo now reflects the persisted notified_admin_at flag.
    h.getLeadQualification.mockResolvedValueOnce(lq({ answers: persistedAnswers, stage: 'quente' }))
    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { dimensao: 2 }, // still quente after this, unrelated new fact
    })

    expect(h.createAgentNotification).toHaveBeenCalledTimes(1) // still 1, not 2
  })

  it('re-notifies on a later transition after dropping out of quente/urgent in between', async () => {
    // Round 1: quente, notified.
    h.getLeadQualification.mockResolvedValueOnce(null)
    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 2, autoridade: 2, urgencia: 2, enquadramento: 1 }, // quente
    })
    const firstAnswers = h.upsertLeadQualification.mock.calls[0][3].answers
    expect(firstAnswers.notified_admin_at).not.toBeNull()

    // Round 2: a correction drops urgencia back to 0, no longer
    // quente/urgent — the flag must be cleared, not just left stale.
    h.getLeadQualification.mockResolvedValueOnce(lq({ answers: firstAnswers, stage: 'quente' }))
    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { urgencia: 0 }, // score now 5 = morno
    })
    const secondAnswers = h.upsertLeadQualification.mock.calls[1][3].answers
    expect(secondAnswers.notified_admin_at).toBeNull()
    expect(h.createAgentNotification).toHaveBeenCalledTimes(1) // unchanged from round 1

    // Round 3: back to quente — should notify again since the flag was cleared.
    h.getLeadQualification.mockResolvedValueOnce(lq({ answers: secondAnswers, stage: 'morno' }))
    await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { urgencia: 2 }, // score back to 7 = quente
    })
    expect(h.createAgentNotification).toHaveBeenCalledTimes(2)
  })

  it('leaves notified_admin_at unset (so it retries later) when qualifying but no admin is configured', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    await saveLeadQualificationHandler(ctx({ defaultNotifyUserId: null }), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 2, autoridade: 2, urgencia: 2, enquadramento: 1 },
    })

    expect(h.createAgentNotification).not.toHaveBeenCalled()
    const payload = h.upsertLeadQualification.mock.calls[0][3]
    expect(payload.answers.notified_admin_at).toBeNull()
  })
})

describe('saveLeadQualificationHandler — missing dimensions surfaced to the caller', () => {
  it('returns missingDimensions so the agent knows what not to re-ask', async () => {
    h.getLeadQualification.mockResolvedValue(null)

    const result = await saveLeadQualificationHandler(ctx(), {
      contact_id: 'contact-1',
      dimensions: { necessidade: 1 },
    })

    const body = JSON.parse(result.content)
    expect(body.missingDimensions).toEqual(['autoridade', 'urgencia', 'enquadramento', 'dimensao'])
  })
})

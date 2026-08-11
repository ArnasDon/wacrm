import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  logAiUsage: vi.fn(),
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
  engineSendText: vi.fn(),
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: h.logAiUsage }))
vi.mock('@/lib/ai/providers/openai', () => ({ generateOpenAi: h.generateOpenAi }))
vi.mock('@/lib/ai/providers/anthropic', () => ({ generateAnthropic: h.generateAnthropic }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))

import { attemptCtwaRescue, isBusinessHours, nextBusinessHourStart } from './ctwa-rescue'

const HOUR = 60 * 60 * 1000

// ============================================================
// Business-hours math — America/Sao_Paulo is a fixed UTC-3 offset
// (Brazil abolished DST in 2019), so these instants are exact.
// ============================================================
describe('isBusinessHours (America/Sao_Paulo, 08:00–20:00)', () => {
  it('is true exactly at the 08:00 local boundary', () => {
    expect(isBusinessHours(new Date('2026-01-15T11:00:00.000Z'))).toBe(true) // 08:00 SP
  })
  it('is false one second before the 08:00 boundary', () => {
    expect(isBusinessHours(new Date('2026-01-15T10:59:59.000Z'))).toBe(false) // 07:59:59 SP
  })
  it('is true one second before the 20:00 boundary', () => {
    expect(isBusinessHours(new Date('2026-01-15T22:59:59.000Z'))).toBe(true) // 19:59:59 SP
  })
  it('is false exactly at the 20:00 local boundary (exclusive end)', () => {
    expect(isBusinessHours(new Date('2026-01-15T23:00:00.000Z'))).toBe(false) // 20:00 SP
  })
})

describe('nextBusinessHourStart', () => {
  it('returns the same instant when already exactly at 08:00 local', () => {
    const at8 = new Date('2026-01-15T11:00:00.000Z')
    expect(nextBusinessHourStart(at8).getTime()).toBe(at8.getTime())
  })
  it('returns today 08:00 local when called before opening', () => {
    const before = new Date('2026-01-15T05:00:00.000Z') // 02:00 SP
    expect(nextBusinessHourStart(before).toISOString()).toBe('2026-01-15T11:00:00.000Z')
  })
  it('returns tomorrow 08:00 local when called after closing', () => {
    const after = new Date('2026-01-15T23:30:00.000Z') // 20:30 SP
    expect(nextBusinessHourStart(after).toISOString()).toBe('2026-01-16T11:00:00.000Z')
  })
})

// ============================================================
// attemptCtwaRescue — re-verification branches. A fake db covering
// exactly the surface the function touches, mirroring the hand-rolled
// stub style used across this codebase's other *.test.ts files.
// ============================================================

interface DbOpts {
  conversation: {
    id: string
    account_id: string
    contact_id: string | null
    ctwa_referral: unknown
    ctwa_rescue_status: string | null
    contact: { id: string; name: string | null; phone: string | null } | null
  } | null
  lastCustomerMessage: { created_at: string; content_text: string | null } | null
  companyReplyCount: number
  whatsappConfigUserId: string | null
}

function makeDb(opts: DbOpts) {
  const updateCalls: {
    payload: Record<string, unknown>
    eq: [string, unknown][]
    is?: [string, unknown]
  }[] = []

  function updateBuilder(payload: Record<string, unknown>) {
    const call: (typeof updateCalls)[number] = { payload, eq: [] }
    updateCalls.push(call)
    const claimResult = () =>
      Promise.resolve({
        data: opts.conversation ? [{ id: opts.conversation.id }] : [],
        error: null,
      })
    const builder: Record<string, unknown> = {
      eq(column: string, value: unknown) {
        call.eq.push([column, value])
        return builder
      },
      is(column: string, value: unknown) {
        call.is = [column, value]
        return builder
      },
      select: claimResult,
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return claimResult().then(onFulfilled, onRejected)
      },
    }
    return builder
  }

  const stub = {
    from(table: string) {
      if (table === 'conversations') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () => Promise.resolve({ data: opts.conversation, error: null }),
                }
              },
            }
          },
          update: updateBuilder,
        }
      }
      if (table === 'messages') {
        return {
          select(_cols: string, options?: { count?: string; head?: boolean }) {
            if (options?.count) {
              return {
                eq() {
                  return {
                    in: () => Promise.resolve({ count: opts.companyReplyCount, error: null }),
                  }
                },
              }
            }
            return {
              eq() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          limit() {
                            return {
                              maybeSingle: () =>
                                Promise.resolve({ data: opts.lastCustomerMessage, error: null }),
                            }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'whatsapp_config') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: opts.whatsappConfigUserId
                        ? { user_id: opts.whatsappConfigUserId }
                        : null,
                      error: null,
                    }),
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { stub: stub as unknown as SupabaseClient, updateCalls }
}

const BASE_CONVERSATION = {
  id: 'conv-1',
  account_id: 'acct-1',
  contact_id: 'contact-1',
  ctwa_referral: { source_id: 'ad-1' },
  ctwa_rescue_status: null,
  contact: { id: 'contact-1', name: 'Fulano', phone: '+5511999999999' },
}

describe('attemptCtwaRescue', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    h.loadAiConfig.mockReset()
    h.logAiUsage.mockReset()
    h.generateOpenAi.mockReset()
    h.generateAnthropic.mockReset()
    h.engineSendText.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels (not eligible) when the conversation is not CTWA', async () => {
    const { stub, updateCalls } = makeDb({
      conversation: { ...BASE_CONVERSATION, ctwa_referral: null },
      lastCustomerMessage: null,
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-1',
    })
    const outcome = await attemptCtwaRescue(stub, 'conv-1')
    expect(outcome).toBe('cancelled_not_eligible')
    expect(updateCalls).toHaveLength(0) // never claims — nothing to claim
  })

  it('cancels (not eligible) when rescue was already evaluated', async () => {
    const { stub } = makeDb({
      conversation: { ...BASE_CONVERSATION, ctwa_rescue_status: 'cancelled' },
      lastCustomerMessage: null,
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-1',
    })
    expect(await attemptCtwaRescue(stub, 'conv-1')).toBe('cancelled_not_eligible')
  })

  it('cancels (not eligible) when the company already replied', async () => {
    const { stub } = makeDb({
      conversation: BASE_CONVERSATION,
      lastCustomerMessage: {
        created_at: new Date(Date.now() - 23 * HOUR).toISOString(),
        content_text: 'Oi, tem o apto na Rua X?',
      },
      companyReplyCount: 1, // an agent or bot already answered
      whatsappConfigUserId: 'user-1',
    })
    expect(await attemptCtwaRescue(stub, 'conv-1')).toBe('cancelled_not_eligible')
  })

  it('cancels (window expired) when the 24h window already closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T15:00:00.000Z')) // 12:00 SP — business hours
    const { stub, updateCalls } = makeDb({
      conversation: BASE_CONVERSATION,
      lastCustomerMessage: {
        created_at: new Date('2026-01-14T14:00:00.000Z').toISOString(), // 25h ago
        content_text: 'oi',
      },
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-1',
    })
    expect(await attemptCtwaRescue(stub, 'conv-1')).toBe('cancelled_window_expired')
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].payload).toEqual({ ctwa_rescue_status: 'cancelled' })
    expect(updateCalls[0].is).toEqual(['ctwa_rescue_status', null])
  })

  it('waits (no send yet) when outside business hours but a safe slot remains before 24h', async () => {
    vi.useFakeTimers()
    // now = 07:45 SP (15 min before opening); window closes 1h from now.
    vi.setSystemTime(new Date('2026-01-15T10:45:00.000Z'))
    const { stub, updateCalls } = makeDb({
      conversation: BASE_CONVERSATION,
      lastCustomerMessage: {
        created_at: new Date('2026-01-14T11:45:00.000Z').toISOString(), // 23h ago
        content_text: 'oi',
      },
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-1',
    })
    expect(await attemptCtwaRescue(stub, 'conv-1')).toBe('waiting_for_business_hours')
    expect(updateCalls).toHaveLength(0) // no status change — a later tick decides
  })

  it('cancels (no safe window) when outside business hours and the 24h window closes before the next business day', async () => {
    vi.useFakeTimers()
    // now = 20:30 SP (just closed); window closes in 30 min, long before tomorrow 08:00.
    vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'))
    const { stub, updateCalls } = makeDb({
      conversation: BASE_CONVERSATION,
      lastCustomerMessage: {
        created_at: new Date('2026-01-15T00:00:00.000Z').toISOString(), // 23h30 ago
        content_text: 'oi',
      },
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-1',
    })
    expect(await attemptCtwaRescue(stub, 'conv-1')).toBe('cancelled_no_safe_window')
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].payload).toEqual({ ctwa_rescue_status: 'cancelled' })
  })

  it('sends the AI-drafted rescue through the official pipeline and marks the row sent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T15:00:00.000Z')) // 12:00 SP — business hours
    const { stub, updateCalls } = makeDb({
      conversation: BASE_CONVERSATION,
      lastCustomerMessage: {
        created_at: new Date('2026-01-14T16:00:00.000Z').toISOString(), // 23h ago
        content_text: 'Tem o apartamento de 2 quartos na Rua X?',
      },
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-owner',
    })
    h.loadAiConfig.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'sk-test',
    })
    h.generateOpenAi.mockResolvedValue({
      text: 'Oi Fulano, tudo bem? Recebi seu contato sobre o apartamento...',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid.test' })

    const outcome = await attemptCtwaRescue(stub, 'conv-1')

    expect(outcome).toBe('sent')
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        userId: 'user-owner',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        aiGenerated: true,
      }),
    )
    // Claim (→ 'failed') then finalize (→ 'sent') — exactly two writes.
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0].payload).toEqual({ ctwa_rescue_status: 'failed' })
    expect(updateCalls[1].payload.ctwa_rescue_status).toBe('sent')
    expect(h.logAiUsage).toHaveBeenCalledWith(
      stub,
      expect.objectContaining({ mode: 'ctwa_rescue', conversationId: 'conv-1' }),
    )
  })

  it('leaves the row failed (never retried) when the Meta send throws', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T15:00:00.000Z'))
    const { stub, updateCalls } = makeDb({
      conversation: BASE_CONVERSATION,
      lastCustomerMessage: {
        created_at: new Date('2026-01-14T16:00:00.000Z').toISOString(),
        content_text: 'oi',
      },
      companyReplyCount: 0,
      whatsappConfigUserId: 'user-owner',
    })
    h.loadAiConfig.mockResolvedValue({ provider: 'openai', model: 'gpt-test', apiKey: 'sk-test' })
    h.generateOpenAi.mockResolvedValue({ text: 'Oi, tudo bem?', usage: null })
    h.engineSendText.mockRejectedValue(new Error('Meta API error'))

    const outcome = await attemptCtwaRescue(stub, 'conv-1')

    expect(outcome).toBe('failed')
    // Only the claim write happened (pre-set to 'failed') — no second
    // write flips it to 'sent', so a retry can never fire for this row.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].payload).toEqual({ ctwa_rescue_status: 'failed' })
  })
})

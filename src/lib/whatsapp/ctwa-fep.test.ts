import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCtwaFepStatus, maybeActivateCtwaFep } from './ctwa-fep'

interface ConversationRow {
  id: string
  ctwa_referral: unknown
  ctwa_fep_started_at: string | null
}

// Mirrors the surface maybeActivateCtwaFep actually uses on the
// Supabase client — same hand-rolled-stub style as ctwa-referral.test.ts.
function makeSupabaseStub(opts: {
  conversation: ConversationRow | null
  lastCustomerMessage: { created_at: string } | null
}) {
  const updateCalls: {
    payload: Record<string, unknown>
    eq?: [string, unknown]
    is?: [string, unknown]
  }[] = []

  const stub = {
    from(table: string) {
      if (table === 'conversations') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({ data: opts.conversation, error: null }),
                }
              },
            }
          },
          update(payload: Record<string, unknown>) {
            const call: (typeof updateCalls)[number] = { payload }
            updateCalls.push(call)
            const builder = {
              eq(column: string, value: unknown) {
                call.eq = [column, value]
                return builder
              },
              is(column: string, value: unknown) {
                call.is = [column, value]
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
        }
      }
      if (table === 'messages') {
        return {
          select() {
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
                                Promise.resolve({
                                  data: opts.lastCustomerMessage,
                                  error: null,
                                }),
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
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { stub: stub as unknown as SupabaseClient, updateCalls }
}

describe('getCtwaFepStatus', () => {
  it('is inactive when never activated (no timestamps)', () => {
    expect(getCtwaFepStatus({ ctwa_fep_started_at: null, ctwa_fep_expires_at: null })).toEqual({
      active: false,
      expiresAt: null,
    })
  })

  it('is active while expires_at is still in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const status = getCtwaFepStatus({
      ctwa_fep_started_at: new Date().toISOString(),
      ctwa_fep_expires_at: future,
    })
    expect(status.active).toBe(true)
    expect(status.expiresAt).toEqual(new Date(future))
  })

  it('is inactive once expires_at has passed — derived, not read from a stored flag', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const status = getCtwaFepStatus({
      ctwa_fep_started_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
      ctwa_fep_expires_at: past,
    })
    expect(status.active).toBe(false)
  })
})

describe('maybeActivateCtwaFep', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('does nothing for a non-CTWA conversation', async () => {
    const { stub, updateCalls } = makeSupabaseStub({
      conversation: { id: 'c1', ctwa_referral: null, ctwa_fep_started_at: null },
      lastCustomerMessage: { created_at: new Date().toISOString() },
    })
    await maybeActivateCtwaFep(stub, 'c1')
    expect(updateCalls).toHaveLength(0)
  })

  it('does nothing when already activated (immutable — never re-armed)', async () => {
    const { stub, updateCalls } = makeSupabaseStub({
      conversation: {
        id: 'c1',
        ctwa_referral: { source_id: 'ad-1' },
        ctwa_fep_started_at: new Date().toISOString(),
      },
      lastCustomerMessage: { created_at: new Date().toISOString() },
    })
    await maybeActivateCtwaFep(stub, 'c1')
    expect(updateCalls).toHaveLength(0)
  })

  it('does nothing when there is no customer message yet', async () => {
    const { stub, updateCalls } = makeSupabaseStub({
      conversation: { id: 'c1', ctwa_referral: { source_id: 'ad-1' }, ctwa_fep_started_at: null },
      lastCustomerMessage: null,
    })
    await maybeActivateCtwaFep(stub, 'c1')
    expect(updateCalls).toHaveLength(0)
  })

  it('does nothing when the first 24h window has already closed', async () => {
    const { stub, updateCalls } = makeSupabaseStub({
      conversation: { id: 'c1', ctwa_referral: { source_id: 'ad-1' }, ctwa_fep_started_at: null },
      lastCustomerMessage: {
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
    })
    await maybeActivateCtwaFep(stub, 'c1')
    expect(updateCalls).toHaveLength(0)
  })

  it('activates the 72h clock when CTWA-eligible, never-activated, and the 24h window is open', async () => {
    const { stub, updateCalls } = makeSupabaseStub({
      conversation: { id: 'c1', ctwa_referral: { source_id: 'ad-1' }, ctwa_fep_started_at: null },
      lastCustomerMessage: {
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    })
    const before = Date.now()
    await maybeActivateCtwaFep(stub, 'c1')
    const after = Date.now()

    expect(updateCalls).toHaveLength(1)
    const call = updateCalls[0]
    expect(call.eq).toEqual(['id', 'c1'])
    expect(call.is).toEqual(['ctwa_fep_started_at', null])
    expect(call.payload.ctwa_fep_active).toBe(true)

    const startedAt = new Date(call.payload.ctwa_fep_started_at as string).getTime()
    const expiresAt = new Date(call.payload.ctwa_fep_expires_at as string).getTime()
    expect(startedAt).toBeGreaterThanOrEqual(before)
    expect(startedAt).toBeLessThanOrEqual(after)
    // Linear 72h — exact, not approximate.
    expect(expiresAt - startedAt).toBe(72 * 60 * 60 * 1000)
  })

  it('never throws — logs and swallows a lookup failure', async () => {
    const stub = {
      from() {
        throw new Error('boom')
      },
    }
    await expect(
      maybeActivateCtwaFep(stub as unknown as SupabaseClient, 'c1'),
    ).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })
})

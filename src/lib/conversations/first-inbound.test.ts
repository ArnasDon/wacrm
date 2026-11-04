import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimFirstInboundMessage } from './first-inbound'

function conversationsDb(state: { firstInboundAt: string | null; error?: { message: string } }) {
  const calls: { patch: Record<string, unknown>; isNull?: string }[] = []
  const db = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const call: (typeof calls)[number] = { patch }
        calls.push(call)
        return {
          eq: () => ({
            is: (column: string) => {
              call.isNull = column
              return {
                select: async () => {
                  if (state.error) return { data: null, error: state.error }
                  if (state.firstInboundAt !== null) return { data: [], error: null }
                  state.firstInboundAt = patch.first_inbound_at as string
                  return { data: [{ id: 'conv-1' }], error: null }
                },
              }
            },
          }),
        }
      },
    }),
  } as unknown as SupabaseClient
  return { db, calls }
}

describe('claimFirstInboundMessage', () => {
  it('only the first of two concurrent deliveries wins the claim', async () => {
    const state = { firstInboundAt: null as string | null }
    const { db, calls } = conversationsDb(state)
    const conversation = { id: 'conv-1', first_inbound_at: null }
    const [a, b] = await Promise.all([
      claimFirstInboundMessage(db, conversation, '2026-10-16T10:00:00.000Z'),
      claimFirstInboundMessage(db, conversation, '2026-10-16T10:00:01.000Z'),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(calls.every((c) => c.isNull === 'first_inbound_at')).toBe(true)
  })

  it('skips the write when the snapshot already has a first inbound', async () => {
    const { db, calls } = conversationsDb({ firstInboundAt: 'x' })
    const claimed = await claimFirstInboundMessage(
      db,
      { id: 'conv-1', first_inbound_at: '2026-01-01T00:00:00.000Z' },
      '2026-10-16T10:00:00.000Z',
    )
    expect(claimed).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('fails closed on a database error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = conversationsDb({ firstInboundAt: null, error: { message: 'boom' } })
    const claimed = await claimFirstInboundMessage(db, { id: 'conv-1' }, '2026-10-16T10:00:00.000Z')
    expect(claimed).toBe(false)
    error.mockRestore()
  })
})

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reopenClosedConversation } from './reopen'

/**
 * Regression cover for issue #409's "closed conversation lockout": an
 * inbound message bumped `unread_count` but never touched `status`, so a
 * closed thread accumulated unread customer messages while still reading
 * as resolved and staying out of the inbox's Open filter.
 */

interface Recorded {
  table: string
  payload: Record<string, unknown> | null
  filters: [string, unknown][]
}

/** Chainable stub shaped like the bit of postgrest this touches. */
function stubClient(error: { message: string } | null = null) {
  const calls: Recorded[] = []

  const client = {
    from(table: string) {
      const rec: Recorded = { table, payload: null, filters: [] }
      calls.push(rec)
      const builder = {
        update(payload: Record<string, unknown>) {
          rec.payload = payload
          return builder
        },
        eq(column: string, value: unknown) {
          rec.filters.push([column, value])
          return builder
        },
        then(onFulfilled: (v: { error: unknown }) => unknown) {
          return Promise.resolve({ error }).then(onFulfilled)
        },
      }
      return builder
    },
  }

  return { client: client as unknown as SupabaseClient, calls }
}

describe('reopenClosedConversation', () => {
  it('flips a closed conversation back to open', async () => {
    const { client, calls } = stubClient()

    const reopened = await reopenClosedConversation(client, {
      id: 'conv-1',
      status: 'closed',
    })

    expect(reopened).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('conversations')
    expect(calls[0].payload).toMatchObject({ status: 'open' })
    expect(calls[0].payload).toHaveProperty('updated_at')
  })

  it('guards the write on the row still being closed', async () => {
    // The caller read the row earlier in the request. Without this filter,
    // two concurrent inbound deliveries both holding a stale
    // `status: 'closed'` could write 'open' over an agent's re-close.
    const { client, calls } = stubClient()

    await reopenClosedConversation(client, { id: 'conv-1', status: 'closed' })

    expect(calls[0].filters).toEqual([
      ['id', 'conv-1'],
      ['status', 'closed'],
    ])
  })

  it.each(['open', 'pending'])(
    'issues no query for a %s conversation',
    async (status) => {
      const { client, calls } = stubClient()

      const reopened = await reopenClosedConversation(client, {
        id: 'conv-1',
        status,
      })

      expect(reopened).toBe(false)
      expect(calls).toEqual([])
    },
  )

  it('issues no query when status is missing', async () => {
    const { client, calls } = stubClient()

    expect(await reopenClosedConversation(client, { id: 'conv-1' })).toBe(false)
    expect(calls).toEqual([])
  })

  it('swallows a failed update so inbound processing continues', async () => {
    // Throwing here would abort the webhook and make Meta redeliver the
    // message — a worse outcome than a thread that stays closed.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = stubClient({ message: 'permission denied' })

    await expect(
      reopenClosedConversation(client, { id: 'conv-1', status: 'closed' }),
    ).resolves.toBe(false)

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

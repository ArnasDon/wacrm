import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('./auto-reply', () => ({ dispatchInboundToAiReply: vi.fn() }))
// Which conversations count as answered (an outbound text after the
// customer's message, app greeting echoes already dropped).
const answeredIds = vi.hoisted(() => new Set<string>())
const quietIds = vi.hoisted(() => new Set<string>())
const recentStaffIds = vi.hoisted(() => new Set<string>())
const mutedIds = vi.hoisted(() => new Set<string>())
vi.mock('./muted-contact', () => ({
  contactMutesAi: async (_db: unknown, contactId: string) => mutedIds.has(contactId),
}))
vi.mock('./human-reply', () => ({
  TEAMMATE_QUIET_MS: 3 * 60 * 60_000,
  teammateRepliedRecently: async (_db: unknown, _account: string, id: string, _reset: unknown, _now: Date, lookback = 3 * 60 * 60_000) =>
    lookback > 3 * 60 * 60_000 ? recentStaffIds.has(id) : quietIds.has(id),
  loadTrailingOutbound: async (_db: unknown, conversationId: string) => ({
    lastCustomerAt: null,
    humanSince: null,
    rows: answeredIds.has(conversationId)
      ? [{ sender_type: 'agent', content_type: 'text', content_text: 'hola', created_at: '' }]
      : [],
  }),
}))

import { recoverUnansweredInbound } from './inbound-recovery'

const NOW = Date.parse('2026-09-24T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

interface Fixture {
  hotel?: boolean
  quiet?: string[]
  recentStaff?: string[]
  muted?: string[]
  conversations: { id: string; account_id: string; contact_id: string | null; last_message_at: string }[]
  /** The customer's latest message per conversation. */
  lastCustomer: Record<string, { id: string; sender_type: string; content_type: string; created_at: string } | null>
  /** Conversations with an outbound TEXT after the customer's message. */
  answered?: string[]
  flowTouches?: Record<string, number>
  /** Prior recovery attempts per message id. */
  claimedAfterStaff?: Record<string, number>
  claimed?: Record<string, number>
}

function db(fx: Fixture) {
  quietIds.clear()
  recentStaffIds.clear()
  mutedIds.clear()
  for (const id of fx.quiet ?? []) quietIds.add(id)
  for (const id of fx.recentStaff ?? []) recentStaffIds.add(id)
  for (const id of fx.muted ?? []) mutedIds.add(id)
  answeredIds.clear()
  for (const id of fx.answered ?? []) answeredIds.add(id)
  const inserts: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      const filters: Record<string, string> = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: string) => {
          filters[col] = v
          return chain
        },
        in: () => chain,
        gt: () => chain,
        is: () => chain,
        gte: () => chain,
        lte: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row)
          return { error: null }
        },
        maybeSingle: async () => {
          if (table === 'messages') return { data: fx.lastCustomer[filters.conversation_id] ?? null, error: null }
          if (table === 'accounts') return { data: { owner_user_id: 'owner-1', industry_vertical: fx.hotel ? 'hotel' : null }, error: null }
          return { data: null, error: null }
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'conversations') return resolve({ data: fx.conversations, error: null })
          if (table === 'messages') {
            const answered = (fx.answered ?? []).includes(filters.conversation_id)
            return resolve({ data: answered ? [{ id: 'reply' }] : [], error: null })
          }
          if (table === 'flow_runs') return resolve({ count: fx.flowTouches?.[filters.conversation_id] ?? 0, error: null })
          if (table === 'ai_action_log') {
            const attempts = filters['input->>staff_window_elapsed'] === 'true' ? fx.claimedAfterStaff : fx.claimed
            const n = attempts?.[filters['input->>message_id']] ?? 0
            return resolve({ data: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })), error: null })
          }
          return resolve({ data: [], error: null })
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { client, inserts }
}

const conv = (id: string, m = 10) => ({ id, account_id: 'acct-1', contact_id: `contact-${id}`, last_message_at: minsAgo(m) })
const customerText = (id: string, m = 10) => ({ id, sender_type: 'customer', content_type: 'text', created_at: minsAgo(m) })

describe('recoverUnansweredInbound', () => {
  it('re-dispatches a customer text left unanswered, once, without the debounce wait', async () => {
    const dispatch = vi.fn()
    const { client, inserts } = db({ conversations: [conv('c1')], lastCustomer: { c1: customerText('m1') } })
    const res = await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(res.recovered).toBe(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', contactId: 'contact-c1', configOwnerUserId: 'owner-1', skipDebounce: true }),
    )
    expect(inserts[0]).toMatchObject({ action: 'inbound_recovery', target_id: 'c1', input: { message_id: 'm1' } })
  })

  it('still recovers when only our banner/photos went out before the reply was lost (prueba #27)', async () => {
    const dispatch = vi.fn()
    // The thread's last message is our image, but no TEXT followed the
    // customer's message — `answered` is empty.
    const { client } = db({ conversations: [conv('c1')], lastCustomer: { c1: customerText('m1', 12) } })
    const res = await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(res.recovered).toBe(1)
  })

  it('leaves answered, retried 3 times, flow-consumed, non-text and too-recent messages alone', async () => {
    const dispatch = vi.fn()
    const { client } = db({
      conversations: [conv('answered'), conv('retried'), conv('flow'), conv('image'), conv('fresh', 2)],
      lastCustomer: {
        answered: customerText('m1'),
        retried: customerText('m2'),
        flow: customerText('m3'),
        image: { id: 'm4', sender_type: 'customer', content_type: 'image', created_at: minsAgo(10) },
        fresh: customerText('m5', 2),
      },
      answered: ['answered'],
      flowTouches: { flow: 1 },
      claimed: { m2: 3 },
    })
    const res = await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(res.recovered).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('retries a message whose earlier attempts failed to send, up to 3 times (Zernio outage, VSR 2026-10-08)', async () => {
    const dispatch = vi.fn()
    const { client } = db({ conversations: [conv('c1')], lastCustomer: { c1: customerText('m1') }, claimed: { m1: 2 } })
    const res = await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(res.recovered).toBe(1)
  })
})

describe('hotel staff-window recovery', () => {
  it('does not consume recovery attempts during the three-hour staff pause', async () => {
    const dispatch = vi.fn()
    const { client, inserts } = db({ hotel: true, quiet: ['c1'], conversations: [conv('c1')], lastCustomer: { c1: customerText('m1') } })
    expect((await recoverUnansweredInbound(client, { now: NOW, dispatch })).recovered).toBe(0)
    expect(inserts).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers the pending message after the staff pause without a new customer message', async () => {
    const dispatch = vi.fn()
    const { client, inserts } = db({ hotel: true, recentStaff: ['c1'], conversations: [conv('c1', 175)], lastCustomer: { c1: customerText('m1', 175) } })
    expect((await recoverUnansweredInbound(client, { now: NOW, dispatch })).recovered).toBe(1)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(inserts[0]).toMatchObject({ input: { message_id: 'm1' } })
  })

  it('does not reopen old inquiries without a recent staff reply or extend other businesses', async () => {
    for (const hotel of [true, false]) {
      const dispatch = vi.fn()
      const { client } = db({ hotel, conversations: [conv('c1', 175)], lastCustomer: { c1: customerText('m1', 175) } })
      await recoverUnansweredInbound(client, { now: NOW, dispatch })
      expect(dispatch).not.toHaveBeenCalled()
    }
  })

  it('leaves answered, excluded and more-than-four-hour-old hotel messages alone', async () => {
    const dispatch = vi.fn()
    const { client, inserts } = db({ hotel: true, recentStaff: ['answered', 'muted', 'old'], muted: ['contact-muted'], answered: ['answered'], conversations: [conv('answered', 175), conv('muted', 175), conv('old', 241)], lastCustomer: { answered: customerText('a', 175), muted: customerText('m', 175), old: customerText('o', 241) } })
    await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(dispatch).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })
})

describe('legacy attempts during the hotel pause', () => {
  it('recovers after the pause even if the old sweep already spent all three attempts', async () => {
    const dispatch = vi.fn()
    const { client, inserts } = db({ hotel: true, recentStaff: ['c1'], claimed: { m1: 3 }, conversations: [conv('c1', 175)], lastCustomer: { c1: customerText('m1', 175) } })
    await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(inserts[0]).toMatchObject({ input: { message_id: 'm1', staff_window_elapsed: true } })
  })
  it('still limits retries performed after the pause to three', async () => {
    const dispatch = vi.fn()
    const { client, inserts } = db({ hotel: true, recentStaff: ['c1'], claimedAfterStaff: { m1: 3 }, conversations: [conv('c1', 175)], lastCustomer: { c1: customerText('m1', 175) } })
    await recoverUnansweredInbound(client, { now: NOW, dispatch })
    expect(dispatch).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })
})

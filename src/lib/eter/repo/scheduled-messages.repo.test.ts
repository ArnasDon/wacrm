import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  scheduleMessages,
  cancelScheduledMessagesForConversation,
  cancelRemindersForBooking,
  getDueScheduledMessages,
  claimScheduledMessage,
  markScheduledMessageSent,
  markScheduledMessageFailed,
} from './scheduled-messages.repo'

// ============================================================
// Minimal fake Supabase client — supports exactly the query shapes
// this repo module issues (insert().select(), update().eq()...select(),
// select().eq().lte().order().limit(), and the .maybeSingle() claim
// variant). Mirrors the style of pending-actions.repo.test.ts's fake
// db, extended with `.in()` / `.lte()` / `.order()` / `.limit()`.
// ============================================================

interface Row {
  [key: string]: unknown
  id: string
  account_id: string
  conversation_id: string | null
  contact_id: string | null
  booking_id: string | null
  kind: string
  send_at: string
  status: string
  payload: Record<string, unknown>
  error: string | null
  sent_at: string | null
  created_at: string
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: `row-${Math.random().toString(36).slice(2, 8)}`,
    account_id: 'acct-1',
    conversation_id: 'conv-1',
    contact_id: 'contact-1',
    booking_id: null,
    kind: 'follow_up_1d',
    send_at: '2026-08-20T09:00:00.000Z',
    status: 'pending',
    payload: {},
    error: null,
    sent_at: null,
    created_at: '2026-08-19T09:00:00.000Z',
    ...overrides,
  }
}

function makeDb(initialRows: Row[] = []) {
  const rows = [...initialRows]

  function selectChain(source: Row[]) {
    let filtered = source
    const builder = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === val)
        return builder
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes((r as Record<string, unknown>)[col]))
        return builder
      },
      lte(col: string, val: unknown) {
        filtered = filtered.filter((r) => String((r as Record<string, unknown>)[col]) <= String(val))
        return builder
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false
        filtered = [...filtered].sort((a, b) => {
          const av = String((a as Record<string, unknown>)[col])
          const bv = String((b as Record<string, unknown>)[col])
          return asc ? av.localeCompare(bv) : bv.localeCompare(av)
        })
        return builder
      },
      limit(n: number) {
        filtered = filtered.slice(0, n)
        return builder
      },
      maybeSingle() {
        return Promise.resolve({ data: filtered[0] ?? null, error: null })
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: filtered, error: null }).then(resolve)
      },
    }
    return builder
  }

  function updateChain(payload: Record<string, unknown>) {
    let filtered = rows
    const apply = () => filtered.forEach((r) => Object.assign(r, payload))
    const builder = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === val)
        return builder
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes((r as Record<string, unknown>)[col]))
        return builder
      },
      select() {
        apply()
        return {
          maybeSingle() {
            return Promise.resolve({ data: filtered[0] ?? null, error: null })
          },
          then(resolve: (v: { data: Row[]; error: null }) => unknown) {
            return Promise.resolve({ data: filtered, error: null }).then(resolve)
          },
        }
      },
      // markScheduledMessageSent/Failed await the chain directly, with
      // no trailing `.select()` — apply the mutation lazily here too.
      then(resolve: (v: { data: null; error: null }) => unknown) {
        apply()
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    }
    return builder
  }

  const db = {
    from() {
      return {
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          const arr = Array.isArray(payload) ? payload : [payload]
          const inserted = arr.map((p) => row({ id: `new-${rows.length}`, ...p } as Partial<Row>))
          rows.push(...inserted)
          return {
            select() {
              return Promise.resolve({ data: inserted, error: null })
            },
          }
        },
        update(payload: Record<string, unknown>) {
          return updateChain(payload)
        },
        select() {
          return selectChain(rows)
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, rows }
}

describe('scheduled-messages.repo — scheduleMessages', () => {
  it('inserts one row per input, scoped to accountId', async () => {
    const { db } = makeDb()
    const result = await scheduleMessages(db, 'acct-1', [
      { conversationId: 'conv-1', kind: 'follow_up_1d', sendAt: new Date('2026-08-20T09:00:00Z') },
      { conversationId: 'conv-1', kind: 'follow_up_3d', sendAt: new Date('2026-08-22T09:00:00Z') },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('follow_up_1d')
    expect(result[1].kind).toBe('follow_up_3d')
  })

  it('returns an empty array without hitting the DB for an empty input', async () => {
    const { db } = makeDb()
    expect(await scheduleMessages(db, 'acct-1', [])).toEqual([])
  })
})

describe('scheduled-messages.repo — cancellation', () => {
  it('cancelScheduledMessagesForConversation only cancels pending rows, optionally by kind', async () => {
    const { db, rows } = makeDb([
      row({ id: 'r1', kind: 'follow_up_1d', status: 'pending' }),
      row({ id: 'r2', kind: 'reminder_24h', status: 'pending', booking_id: 'bk-1' }),
      row({ id: 'r3', kind: 'follow_up_3d', status: 'sent' }),
    ])
    const cancelled = await cancelScheduledMessagesForConversation(db, 'acct-1', 'conv-1', {
      kinds: ['follow_up_1d', 'follow_up_3d', 'follow_up_7d'],
    })
    expect(cancelled).toBe(1)
    expect(rows.find((r) => r.id === 'r1')?.status).toBe('cancelled')
    // reminder_24h wasn't in the kinds filter — untouched.
    expect(rows.find((r) => r.id === 'r2')?.status).toBe('pending')
    // r3 was already 'sent', not 'pending' — untouched.
    expect(rows.find((r) => r.id === 'r3')?.status).toBe('sent')
  })

  it('cancelRemindersForBooking scopes to booking_id + REMINDER_KINDS by default', async () => {
    const { db, rows } = makeDb([
      row({ id: 'r1', booking_id: 'bk-1', kind: 'reminder_24h', conversation_id: null }),
      row({ id: 'r2', booking_id: 'bk-1', kind: 'reminder_2h', conversation_id: null }),
      row({ id: 'r3', booking_id: 'bk-2', kind: 'reminder_24h', conversation_id: null }),
    ])
    const cancelled = await cancelRemindersForBooking(db, 'acct-1', 'bk-1')
    expect(cancelled).toBe(2)
    expect(rows.find((r) => r.id === 'r3')?.status).toBe('pending')
  })

  it('cancelRemindersForBooking(kinds) narrows to a single bucket, leaving the other reminder untouched', async () => {
    const { db, rows } = makeDb([
      row({ id: 'r1', booking_id: 'bk-1', kind: 'reminder_24h', conversation_id: null }),
      row({ id: 'r2', booking_id: 'bk-1', kind: 'reminder_2h', conversation_id: null }),
    ])
    const cancelled = await cancelRemindersForBooking(db, 'acct-1', 'bk-1', { kinds: ['reminder_24h'] })
    expect(cancelled).toBe(1)
    expect(rows.find((r) => r.id === 'r1')?.status).toBe('cancelled')
    expect(rows.find((r) => r.id === 'r2')?.status).toBe('pending')
  })
})

describe('scheduled-messages.repo — cron sweep primitives', () => {
  it('getDueScheduledMessages only returns pending rows with send_at <= now, oldest first', async () => {
    const { db } = makeDb([
      row({ id: 'future', status: 'pending', send_at: '2099-01-01T00:00:00.000Z' }),
      row({ id: 'due-late', status: 'pending', send_at: '2026-08-19T12:00:00.000Z' }),
      row({ id: 'due-early', status: 'pending', send_at: '2026-08-19T09:00:00.000Z' }),
      row({ id: 'already-sent', status: 'sent', send_at: '2026-08-19T08:00:00.000Z' }),
    ])
    const due = await getDueScheduledMessages(db, { now: new Date('2026-08-19T13:00:00.000Z') })
    expect(due.map((r) => r.id)).toEqual(['due-early', 'due-late'])
  })

  it('claimScheduledMessage moves pending -> processing and returns null on a second claim', async () => {
    const { db } = makeDb([row({ id: 'r1', status: 'pending' })])
    const first = await claimScheduledMessage(db, 'r1')
    expect(first?.status).toBe('processing')
    const second = await claimScheduledMessage(db, 'r1')
    expect(second).toBeNull()
  })

  it('markScheduledMessageSent / markScheduledMessageFailed update status', async () => {
    const { db, rows } = makeDb([row({ id: 'r1', status: 'processing' }), row({ id: 'r2', status: 'processing' })])
    await markScheduledMessageSent(db, 'r1')
    await markScheduledMessageFailed(db, 'r2', 'no approved template')
    expect(rows.find((r) => r.id === 'r1')?.status).toBe('sent')
    expect(rows.find((r) => r.id === 'r2')).toMatchObject({ status: 'failed', error: 'no approved template' })
  })
})

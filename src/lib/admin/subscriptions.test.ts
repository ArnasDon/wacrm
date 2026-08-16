import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

import { sendEmail } from '@/lib/email/send'
import { findAccountsDueInDays, sendSubscriptionAlerts } from './subscriptions'

interface Row {
  id: string
  name: string
  next_payment_due_at: string
}

const h = vi.mocked({ sendEmail })

function makeDb(rows: Row[]) {
  const chain: {
    select: () => typeof chain
    not: () => typeof chain
    is: () => typeof chain
    lt: () => typeof chain
    then: (resolve: (v: { data: Row[]; error: null }) => void) => void
  } = {
    select: () => chain,
    not: () => chain,
    is: () => chain,
    lt: () => chain,
    then: (resolve) => resolve({ data: rows, error: null }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

/** `sendSubscriptionAlerts` runs findAccountsDueInDays (select/not/is)
 *  and findOverdueAccounts (select/not/lt/is) in parallel against the
 *  same fake client — disambiguate which query is which by whether
 *  `.lt()` was called in that particular chain. */
function makeAlertsDb({ dueSoonRows, overdueRows }: { dueSoonRows: Row[]; overdueRows: Row[] }) {
  return {
    from: () => {
      let usedLt = false
      const chain: {
        select: () => typeof chain
        not: () => typeof chain
        is: () => typeof chain
        lt: () => typeof chain
        then: (resolve: (v: { data: Row[]; error: null }) => void) => void
      } = {
        select: () => chain,
        not: () => chain,
        is: () => chain,
        lt: () => {
          usedLt = true
          return chain
        },
        then: (resolve) => resolve({ data: usedLt ? overdueRows : dueSoonRows, error: null }),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  vi.useFakeTimers()
  h.sendEmail.mockClear()
})
afterEach(() => vi.useRealTimers())

describe('findAccountsDueInDays', () => {
  it('matches an account whose due date is exactly N calendar days from today', async () => {
    vi.setSystemTime(new Date('2026-08-16T15:00:00Z'))
    const db = makeDb([{ id: '1', name: 'Due in 3', next_payment_due_at: '2026-08-19T00:00:00Z' }])
    const res = await findAccountsDueInDays(db, 3)
    expect(res).toHaveLength(1)
    expect(res[0].name).toBe('Due in 3')
  })

  it('does not match accounts due 2 or 4 days out', async () => {
    vi.setSystemTime(new Date('2026-08-16T15:00:00Z'))
    const db = makeDb([
      { id: '1', name: 'Due in 2', next_payment_due_at: '2026-08-18T00:00:00Z' },
      { id: '2', name: 'Due in 4', next_payment_due_at: '2026-08-20T00:00:00Z' },
    ])
    const res = await findAccountsDueInDays(db, 3)
    expect(res).toHaveLength(0)
  })

  it('matches by calendar day regardless of time-of-day — not a 24h window', async () => {
    vi.setSystemTime(new Date('2026-08-16T23:50:00Z'))
    const db = makeDb([{ id: '1', name: 'Late riser', next_payment_due_at: '2026-08-19T00:05:00Z' }])
    const res = await findAccountsDueInDays(db, 3)
    expect(res).toHaveLength(1)
  })

  it('handles a due date crossing a month boundary', async () => {
    vi.setSystemTime(new Date('2026-08-29T12:00:00Z'))
    const db = makeDb([{ id: '1', name: 'Into September', next_payment_due_at: '2026-09-01T00:00:00Z' }])
    const res = await findAccountsDueInDays(db, 3)
    expect(res).toHaveLength(1)
  })
})

describe('sendSubscriptionAlerts', () => {
  it('emails both alerts to the payments inbox when both lists are non-empty', async () => {
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'))
    const db = makeAlertsDb({
      dueSoonRows: [{ id: '1', name: 'Empresa A', next_payment_due_at: '2026-08-19T00:00:00Z' }],
      overdueRows: [{ id: '2', name: 'Empresa B', next_payment_due_at: '2026-08-10T00:00:00Z' }],
    })

    const result = await sendSubscriptionAlerts(db)

    expect(result.dueSoon).toEqual(['Empresa A'])
    expect(result.overdue).toEqual(['Empresa B'])
    expect(h.sendEmail).toHaveBeenCalledTimes(2)
    const calls = h.sendEmail.mock.calls.map((c) => c[0])
    expect(calls.every((c) => c.to === 'asistentedechat@gmail.com')).toBe(true)
    expect(calls.some((c) => c.subject.includes('por vencer'))).toBe(true)
    expect(calls.some((c) => c.subject.includes('vencido'))).toBe(true)
  })

  it('sends nothing and mutates nothing when no account is due-soon or overdue', async () => {
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'))
    const db = makeAlertsDb({ dueSoonRows: [], overdueRows: [] })

    const result = await sendSubscriptionAlerts(db)

    expect(result).toEqual({ dueSoon: [], overdue: [] })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('sends only the overdue email when nothing is due-soon', async () => {
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'))
    const db = makeAlertsDb({
      dueSoonRows: [],
      overdueRows: [{ id: '2', name: 'Empresa B', next_payment_due_at: '2026-08-10T00:00:00Z' }],
    })

    await sendSubscriptionAlerts(db)

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('vencido') }),
    )
  })
})

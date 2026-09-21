import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findCommercialSlots: vi.fn(),
  bookCommercialSlot: vi.fn(),
}))

vi.mock('@/lib/calendar/commercial-availability', async () => {
  const actual = await vi.importActual<typeof import('@/lib/calendar/commercial-availability')>(
    '@/lib/calendar/commercial-availability',
  )
  return {
    ...actual,
    findCommercialSlots: h.findCommercialSlots,
    bookCommercialSlot: h.bookCommercialSlot,
  }
})

import {
  checkCommercialAvailabilityHandler,
  bookCommercialMeetingHandler,
  saveLeadDetailsHandler,
  createCommercialToolExecutor,
} from './commercial'
import { CommercialCalendarNotConfiguredError } from '@/lib/calendar/commercial-availability'
import type { ToolHandlerContext } from './context'

/** Mock `db` that answers `contacts.select('company')` — used by
 *  bookCommercialMeetingHandler's company trava (Ricardo, 21/09/2026).
 *  `company: undefined` simulates a contact row with no company saved. */
function dbWithCompany(company: string | null | undefined): ToolHandlerContext['db'] {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { company }, error: null }),
        }),
      }),
    }),
  } as never
}

const ctx: ToolHandlerContext = {
  db: dbWithCompany('Acme Growth Lda'),
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  defaultNotifyUserId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkCommercialAvailabilityHandler', () => {
  it('returns the slots as JSON, ready for the model to propose', async () => {
    h.findCommercialSlots.mockResolvedValue({
      config: { timezone: 'Europe/Lisbon', meetingDurationMin: 30 },
      slots: [
        { start: new Date('2026-09-15T09:00:00Z'), end: new Date('2026-09-15T09:30:00Z') },
      ],
    })
    const result = await checkCommercialAvailabilityHandler(ctx)
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.content)
    expect(parsed.slots).toHaveLength(1)
    expect(parsed.timezone).toBe('Europe/Lisbon')
  })

  it('tells the model not to invent a time when there are no free slots', async () => {
    h.findCommercialSlots.mockResolvedValue({
      config: { timezone: 'Europe/Lisbon', meetingDurationMin: 30 },
      slots: [],
    })
    const result = await checkCommercialAvailabilityHandler(ctx)
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.content)
    expect(parsed.slots).toEqual([])
    expect(parsed.note).toMatch(/não inventes/i)
  })

  it('returns a clean tool error (not a thrown exception) when no calendar is configured', async () => {
    h.findCommercialSlots.mockRejectedValue(new CommercialCalendarNotConfiguredError())
    const result = await checkCommercialAvailabilityHandler(ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/pede o email/i)
  })

  it('rethrows an unexpected error (not swallowed as a config issue)', async () => {
    h.findCommercialSlots.mockRejectedValue(new Error('network blew up'))
    await expect(checkCommercialAvailabilityHandler(ctx)).rejects.toThrow('network blew up')
  })
})

describe('bookCommercialMeetingHandler', () => {
  const validInput = { starts_at: '2026-09-15T09:00:00Z', lead_email: 'lead@example.com' }

  it('books successfully and reports it back to the model', async () => {
    h.bookCommercialSlot.mockResolvedValue({ status: 'booked', eventId: 'evt-1', htmlLink: null })
    const result = await bookCommercialMeetingHandler(ctx, validInput)
    expect(result.isError).toBe(false)
    expect(h.bookCommercialSlot).toHaveBeenCalledWith(
      ctx.db,
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        leadEmail: 'lead@example.com',
      }),
    )
  })

  it('reports a conflict as a tool error telling the model to re-propose, never a crash', async () => {
    h.bookCommercialSlot.mockResolvedValue({ status: 'conflict' })
    const result = await bookCommercialMeetingHandler(ctx, validInput)
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/check_commercial_availability/)
    expect(result.content).toMatch(/não digas que já está marcado/i)
  })

  it('reports not_configured as a tool error steering the model to the email/link fallback', async () => {
    h.bookCommercialSlot.mockResolvedValue({ status: 'not_configured' })
    const result = await bookCommercialMeetingHandler(ctx, validInput)
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/pede o email/i)
  })

  it('rejects a malformed starts_at without calling bookCommercialSlot', async () => {
    const result = await bookCommercialMeetingHandler(ctx, { ...validInput, starts_at: 'not-a-date' })
    expect(result.isError).toBe(true)
    expect(h.bookCommercialSlot).not.toHaveBeenCalled()
  })

  it('rejects an invalid email without calling bookCommercialSlot', async () => {
    const result = await bookCommercialMeetingHandler(ctx, { ...validInput, lead_email: 'not-an-email' })
    expect(result.isError).toBe(true)
    expect(h.bookCommercialSlot).not.toHaveBeenCalled()
  })

  it('rejects a missing lead_email without calling bookCommercialSlot', async () => {
    const result = await bookCommercialMeetingHandler(ctx, { starts_at: validInput.starts_at })
    expect(result.isError).toBe(true)
    expect(h.bookCommercialSlot).not.toHaveBeenCalled()
  })

  it('bloqueia a marcação quando a empresa concreta ainda não está guardada (sector não conta)', async () => {
    const ctxNoCompany: ToolHandlerContext = { ...ctx, db: dbWithCompany(null) }
    const result = await bookCommercialMeetingHandler(ctxNoCompany, validInput)
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/nome concreto da empresa/i)
    expect(h.bookCommercialSlot).not.toHaveBeenCalled()
  })

  it('bloqueia a marcação quando o campo company está vazio/em branco', async () => {
    const ctxBlankCompany: ToolHandlerContext = { ...ctx, db: dbWithCompany('   ') }
    const result = await bookCommercialMeetingHandler(ctxBlankCompany, validInput)
    expect(result.isError).toBe(true)
    expect(h.bookCommercialSlot).not.toHaveBeenCalled()
  })

  it('marca normalmente quando a empresa concreta já está guardada', async () => {
    h.bookCommercialSlot.mockResolvedValue({ status: 'booked', eventId: 'evt-1', htmlLink: null })
    const result = await bookCommercialMeetingHandler(ctx, validInput)
    expect(result.isError).toBe(false)
    expect(h.bookCommercialSlot).toHaveBeenCalled()
  })
})

describe('saveLeadDetailsHandler', () => {
  function makeDb() {
    const updates: { table: string; payload: Record<string, unknown>; id: string }[] = []
    const db = {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            updates.push({ table, payload, id })
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }
    return { db, updates }
  }

  function ctxWith(db: unknown): ToolHandlerContext {
    return {
      db: db as never,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      defaultNotifyUserId: null,
    }
  }

  it('saves the name onto contacts and reports it back to the model', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), { name: 'Ricardo' })
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content)).toEqual({ saved: ['name'] })
    expect(updates).toEqual([{ table: 'contacts', payload: { name: 'Ricardo' }, id: 'contact-1' }])
  })

  it('saves the email onto contacts', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), { email: 'lead@example.com' })
    expect(result.isError).toBe(false)
    expect(updates).toEqual([
      { table: 'contacts', payload: { email: 'lead@example.com' }, id: 'contact-1' },
    ])
  })

  it('saves the escalation reason onto conversations, not contacts', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), {
      escalation_reason: 'Quer falar de preços com um humano.',
    })
    expect(result.isError).toBe(false)
    expect(updates).toEqual([
      {
        table: 'conversations',
        payload: { escalation_reason: 'Quer falar de preços com um humano.' },
        id: 'conv-1',
      },
    ])
  })

  it('saves all three at once, one write per table', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), {
      name: 'Ricardo',
      email: 'ricardo@example.com',
      escalation_reason: 'Quer falar com alguém sobre preços.',
    })
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content)).toEqual({ saved: ['name', 'email', 'escalation_reason'] })
    expect(updates).toHaveLength(2)
    expect(updates.find((u) => u.table === 'contacts')?.payload).toEqual({
      name: 'Ricardo',
      email: 'ricardo@example.com',
    })
    expect(updates.find((u) => u.table === 'conversations')?.payload).toEqual({
      escalation_reason: 'Quer falar com alguém sobre preços.',
    })
  })

  it('saves the company onto contacts', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), { company: 'Clínica Sorriso Lda' })
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content)).toEqual({ saved: ['company'] })
    expect(updates).toEqual([
      { table: 'contacts', payload: { company: 'Clínica Sorriso Lda' }, id: 'contact-1' },
    ])
  })

  it('saves all four at once, one write per table', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), {
      name: 'Ricardo',
      email: 'ricardo@example.com',
      escalation_reason: 'Quer falar com alguém sobre preços.',
      company: 'Clínica Sorriso Lda',
    })
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content)).toEqual({
      saved: ['name', 'email', 'escalation_reason', 'company'],
    })
    expect(updates.find((u) => u.table === 'contacts')?.payload).toEqual({
      name: 'Ricardo',
      email: 'ricardo@example.com',
      company: 'Clínica Sorriso Lda',
    })
  })

  it('rejects an invalid email without writing anything', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), { email: 'not-an-email' })
    expect(result.isError).toBe(true)
    expect(updates).toEqual([])
  })

  it('rejects a call with no fields at all', async () => {
    const { db, updates } = makeDb()
    const result = await saveLeadDetailsHandler(ctxWith(db), {})
    expect(result.isError).toBe(true)
    expect(updates).toEqual([])
  })
})

describe('createCommercialToolExecutor', () => {
  it('routes check_commercial_availability and book_commercial_meeting to their handlers', async () => {
    h.findCommercialSlots.mockResolvedValue({ config: { timezone: 'Europe/Lisbon' }, slots: [] })
    const executor = createCommercialToolExecutor(ctx)
    const result = await executor({ id: 'call-1', name: 'check_commercial_availability', input: {} })
    expect(result.isError).toBe(false)
  })

  it('returns a tool error for an unknown tool name instead of throwing', async () => {
    const executor = createCommercialToolExecutor(ctx)
    const result = await executor({ id: 'call-1', name: 'book_meeting', input: {} })
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/desconhecida/i)
  })

  it('routes save_lead_details to its handler', async () => {
    const executor = createCommercialToolExecutor(ctx)
    const result = await executor({ id: 'call-1', name: 'save_lead_details', input: {} })
    // ctx.db is {} here — no fields sent, so it must fail on validation
    // before ever touching the db, proving the routing reached the
    // right handler.
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/não enviaste nenhum dado/i)
  })
})

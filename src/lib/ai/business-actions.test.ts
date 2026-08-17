import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  moveDeal: vi.fn(),
  findWonStageId: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  createQuote: vi.fn(),
  createEvent: vi.fn(),
}))

vi.mock('@/lib/pipelines/move-deal', () => ({
  moveDeal: h.moveDeal,
  findWonStageId: h.findWonStageId,
  MoveDealError: class MoveDealError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhookEvent }))
vi.mock('@/lib/webhooks/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/quotes/create-quote', () => ({
  createQuote: h.createQuote,
  CreateQuoteError: class CreateQuoteError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/google-calendar/api', () => ({ createEvent: h.createEvent }))

import { executeBusinessAction, confirmationPhrase, BusinessActionError } from './business-actions'

interface Fixture {
  conversation?: { id: string; status: string } | null
  deal?: { id: string; pipeline_id: string } | null
  /** Result of the fallback `deals.update({status:'won'})` path (no is_won stage configured). */
  dealFallbackResult?: { id: string; pipeline_id: string; stage_id: string; status: string } | null
  contact?: { id: string; lead_temperature: string | null; name?: string | null } | null
  auditError?: boolean
  accountTimezone?: string | null
}

/** Records every `.eq(col, value)` call per query chain so tests can
 *  assert the account_id tenancy filter is actually present — the same
 *  filter whose absence caused the cross-tenant leak fixed earlier this
 *  session (message-thread.tsx / deal-form.tsx). */
function makeDb(fx: Fixture) {
  const inserts: Record<string, unknown>[] = []
  const eqCallsByTable: Record<string, [string, unknown][]> = {}
  const updatePayloadsByTable: Record<string, Record<string, unknown>[]> = {}

  const db = {
    from(table: string) {
      const eqCalls: [string, unknown][] = []
      eqCallsByTable[table] = eqCalls
      let updatePayload: Record<string, unknown> | undefined

      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val])
          return b
        },
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload
          ;(updatePayloadsByTable[table] ??= []).push(payload)
          return b
        },
        insert: (payload: Record<string, unknown>) => {
          inserts.push({ table, ...payload })
          return Promise.resolve({ error: fx.auditError ? { message: 'insert failed' } : null })
        },
        maybeSingle: async () => {
          if (table === 'conversations') {
            if (updatePayload) {
              return {
                data: fx.conversation ? { id: fx.conversation.id, status: updatePayload.status } : null,
                error: null,
              }
            }
            return { data: fx.conversation ?? null, error: null }
          }
          if (table === 'deals') {
            if (updatePayload) {
              return { data: fx.dealFallbackResult ?? null, error: null }
            }
            return { data: fx.deal ?? null, error: null }
          }
          if (table === 'contacts') {
            if (updatePayload) {
              return {
                data: fx.contact ? { id: fx.contact.id, lead_temperature: updatePayload.lead_temperature } : null,
                error: null,
              }
            }
            // schedule_appointment's read-only `.select('id, name')` lookup.
            return { data: fx.contact ? { id: fx.contact.id, name: fx.contact.name ?? null } : null, error: null }
          }
          if (table === 'accounts') {
            return { data: fx.accountTimezone ? { timezone: fx.accountTimezone } : null, error: null }
          }
          return { data: null, error: null }
        },
      }
      return b
    },
  }

  return { db: db as unknown as SupabaseClient, inserts, eqCallsByTable, updatePayloadsByTable }
}

beforeEach(() => {
  h.moveDeal.mockReset()
  h.findWonStageId.mockReset()
  h.dispatchWebhookEvent.mockReset().mockResolvedValue(undefined)
  h.createQuote.mockReset()
  h.createEvent.mockReset()
})

describe('confirmationPhrase', () => {
  it('is deterministic per action + target', () => {
    expect(confirmationPhrase('mark_deal_won', 'deal-1')).toBe('CONFIRM:mark_deal_won:deal-1')
  })
})

describe('executeBusinessAction — close_conversation', () => {
  it('closes the conversation, filters by account_id, and dispatches the webhook', async () => {
    const { db, inserts, eqCallsByTable } = makeDb({ conversation: { id: 'conv-1', status: 'open' } })

    const result = await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'close_conversation', targetId: 'conv-1',
    })

    expect(result).toEqual({ id: 'conv-1', status: 'closed' })
    expect(eqCallsByTable.conversations).toContainEqual(['account_id', 'acct-1'])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'conversation.closed',
      expect.objectContaining({ conversation_id: 'conv-1', closed_by: 'ai_action' }),
    )
    expect(inserts).toEqual([
      expect.objectContaining({ table: 'ai_action_log', action: 'close_conversation', target_id: 'conv-1' }),
    ])
  })

  it('throws 404 when the conversation is not found (cross-tenant or missing)', async () => {
    const { db } = makeDb({ conversation: null })
    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'close_conversation', targetId: 'conv-x' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('executeBusinessAction — mark_deal_won', () => {
  it('moves the deal to the is_won stage via moveDeal() when one is configured', async () => {
    const { db, inserts } = makeDb({ deal: { id: 'deal-1', pipeline_id: 'pipe-1' } })
    h.findWonStageId.mockResolvedValue('stage-won-1')
    h.moveDeal.mockResolvedValue({
      deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-won-1', status: 'won' },
      isWonStage: true,
    })

    const result = await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'mark_deal_won', targetId: 'deal-1',
    })

    expect(h.findWonStageId).toHaveBeenCalledWith(db, 'acct-1', 'pipe-1')
    expect(h.moveDeal).toHaveBeenCalledWith(db, 'acct-1', 'deal-1', 'stage-won-1')
    expect(result).toEqual({ id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-won-1', status: 'won' })
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'deal.won', expect.objectContaining({ deal_id: 'deal-1', source: 'ai_action' }),
    )
    expect(inserts).toEqual([
      expect.objectContaining({ table: 'ai_action_log', action: 'mark_deal_won', target_id: 'deal-1' }),
    ])
  })

  it('falls back to a direct status flip when the pipeline has no is_won stage', async () => {
    const { db } = makeDb({
      deal: { id: 'deal-1', pipeline_id: 'pipe-1' },
      dealFallbackResult: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'won' },
    })
    h.findWonStageId.mockResolvedValue(null)

    const result = await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'mark_deal_won', targetId: 'deal-1',
    })

    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'won' })
  })

  it('stamps won_at on the fallback status flip too, for accurate "won in this date range" KPI reporting', async () => {
    const { db, updatePayloadsByTable } = makeDb({
      deal: { id: 'deal-1', pipeline_id: 'pipe-1' },
      dealFallbackResult: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'won' },
    })
    h.findWonStageId.mockResolvedValue(null)

    await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'mark_deal_won', targetId: 'deal-1',
    })

    const dealsUpdate = updatePayloadsByTable.deals?.[0]
    expect(dealsUpdate).toMatchObject({ status: 'won' })
    expect(typeof dealsUpdate?.won_at).toBe('string')
    expect(Number.isNaN(new Date(dealsUpdate?.won_at as string).getTime())).toBe(false)
  })

  it('throws 404 when the deal is not found (cross-tenant or missing)', async () => {
    const { db } = makeDb({ deal: null })
    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'mark_deal_won', targetId: 'deal-x' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates a MoveDealError from moveDeal() as a BusinessActionError with the same status', async () => {
    const { db } = makeDb({ deal: { id: 'deal-1', pipeline_id: 'pipe-1' } })
    h.findWonStageId.mockResolvedValue('stage-won-1')
    const { MoveDealError } = await import('@/lib/pipelines/move-deal')
    h.moveDeal.mockRejectedValue(new MoveDealError('Deal not found in this pipeline', 404))

    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'mark_deal_won', targetId: 'deal-1' }),
    ).rejects.toBeInstanceOf(BusinessActionError)
    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'mark_deal_won', targetId: 'deal-1' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('executeBusinessAction — move_deal', () => {
  it('requires a stageId', async () => {
    const { db } = makeDb({})
    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'move_deal', targetId: 'deal-1' }),
    ).rejects.toBeInstanceOf(BusinessActionError)
  })

  it('moves the deal and dispatches both stage_changed and won events for a won stage', async () => {
    const { db, inserts } = makeDb({})
    h.moveDeal.mockResolvedValue({
      deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-won-1', status: 'won' },
      isWonStage: true,
    })

    await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'move_deal', targetId: 'deal-1', stageId: 'stage-won-1',
    })

    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'deal.stage_changed', expect.objectContaining({ deal_id: 'deal-1' }),
    )
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'deal.won', expect.objectContaining({ deal_id: 'deal-1' }),
    )
    expect(inserts).toEqual([
      expect.objectContaining({ action: 'move_deal', target_id: 'deal-1', input: { stageId: 'stage-won-1' } }),
    ])
  })

  it('dispatches only stage_changed for a non-won stage', async () => {
    const { db } = makeDb({})
    h.moveDeal.mockResolvedValue({
      deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'open' },
      isWonStage: false,
    })

    await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'move_deal', targetId: 'deal-1', stageId: 'stage-2',
    })

    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'deal.stage_changed', expect.anything(),
    )
  })
})

describe('executeBusinessAction — set_lead_temperature', () => {
  it('updates the contact, filters by account_id, and dispatches the webhook', async () => {
    const { db, inserts, eqCallsByTable } = makeDb({ contact: { id: 'contact-1', lead_temperature: null } })

    const result = await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'set_lead_temperature', targetId: 'contact-1', temperature: 'hot',
    })

    expect(result).toEqual({ id: 'contact-1', lead_temperature: 'hot' })
    expect(eqCallsByTable.contacts).toContainEqual(['account_id', 'acct-1'])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'contact.lead_temperature_changed',
      expect.objectContaining({ contact_id: 'contact-1', lead_temperature: 'hot' }),
    )
    expect(inserts).toEqual([
      expect.objectContaining({ action: 'set_lead_temperature', target_id: 'contact-1', input: { temperature: 'hot' } }),
    ])
  })

  it('rejects a temperature outside cold/warm/hot', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', lead_temperature: null } })
    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'set_lead_temperature', targetId: 'contact-1', temperature: 'scorching',
      }),
    ).rejects.toBeInstanceOf(BusinessActionError)
  })

  it('throws 404 when the contact is not found (cross-tenant or missing)', async () => {
    const { db } = makeDb({ contact: null })
    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'set_lead_temperature', targetId: 'contact-x', temperature: 'warm',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('executeBusinessAction — create_quote', () => {
  it('delegates to createQuote() with allowFreeItems: false and dispatches quote.created', async () => {
    const { db, inserts } = makeDb({})
    h.createQuote.mockResolvedValue({
      quote: { id: 'quote-1', contact_id: 'contact-1', total: 100 },
      items: [{ id: 'item-1', product_id: 'prod-1', quantity: 2 }],
    })

    const result = await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'create_quote', targetId: 'contact-1',
      items: [{ product_id: 'prod-1', quantity: 2 }],
      customerNit: '123', customerEmail: 'a@b.com', customerPhone: '+502...', customerAddress: 'Zona 1',
    })

    expect(h.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1', userId: 'user-1', contactId: 'contact-1', allowFreeItems: false,
        items: [{ product_id: 'prod-1', quantity: 2 }],
      }),
    )
    expect(result).toMatchObject({ id: 'quote-1', total: 100 })
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'quote.created',
      expect.objectContaining({ quote_id: 'quote-1', contact_id: 'contact-1', source: 'ai_action' }),
    )
    expect(inserts).toEqual([
      expect.objectContaining({ table: 'ai_action_log', action: 'create_quote', target_id: 'contact-1' }),
    ])
  })

  it('propagates a CreateQuoteError (e.g. an item without a valid catalog product) as a BusinessActionError', async () => {
    const { db } = makeDb({})
    const { CreateQuoteError } = await import('@/lib/quotes/create-quote')
    h.createQuote.mockRejectedValue(new CreateQuoteError('Items must reference a catalog product (product_id)', 400))

    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'create_quote', targetId: 'contact-1',
        items: [{ quantity: 1 }], // no product_id — the AI can never supply a free item
        customerNit: '123', customerEmail: 'a@b.com', customerPhone: '+502...', customerAddress: 'Zona 1',
      }),
    ).rejects.toBeInstanceOf(BusinessActionError)
  })
})

describe('executeBusinessAction — schedule_appointment', () => {
  it('creates the calendar event and dispatches appointment.scheduled', async () => {
    const { db, inserts } = makeDb({ contact: { id: 'contact-1', lead_temperature: null, name: 'Ana' } })
    h.createEvent.mockResolvedValue({
      eventId: 'evt-1', htmlLink: 'https://calendar.google.com/evt-1', meetLink: 'https://meet.google.com/abc',
    })

    const result = await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-1',
      startTime: '2026-06-01T15:00:00.000Z', endTime: '2026-06-01T16:00:00.000Z',
      attendeeEmail: 'ana@example.com',
    })

    expect(h.createEvent).toHaveBeenCalledWith(
      db, 'acct-1',
      expect.objectContaining({
        summary: 'Cita con Ana',
        startISO: '2026-06-01T15:00:00.000Z',
        endISO: '2026-06-01T16:00:00.000Z',
        attendeeEmail: 'ana@example.com',
        timeZone: 'UTC',
      }),
    )
    expect(result).toMatchObject({ event_id: 'evt-1', attendee_email: 'ana@example.com' })
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'appointment.scheduled',
      expect.objectContaining({ contact_id: 'contact-1', event_id: 'evt-1', source: 'ai_action' }),
    )
    expect(inserts).toEqual([
      expect.objectContaining({ table: 'ai_action_log', action: 'schedule_appointment', target_id: 'contact-1' }),
    ])
  })

  it("passes the account's real timezone to createEvent when one is set", async () => {
    const { db } = makeDb({
      contact: { id: 'contact-1', lead_temperature: null, name: 'Ana' },
      accountTimezone: 'America/Guatemala',
    })
    h.createEvent.mockResolvedValue({ eventId: 'evt-1', htmlLink: null, meetLink: null })

    await executeBusinessAction({
      db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-1',
      startTime: '2026-06-01T15:00:00.000Z', endTime: '2026-06-01T16:00:00.000Z',
      attendeeEmail: 'ana@example.com',
    })

    expect(h.createEvent).toHaveBeenCalledWith(
      db, 'acct-1', expect.objectContaining({ timeZone: 'America/Guatemala' }),
    )
  })

  it('requires startTime, endTime, and attendeeEmail', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', lead_temperature: null } })
    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-1' }),
    ).rejects.toBeInstanceOf(BusinessActionError)
  })

  it('rejects an invalid attendeeEmail', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', lead_temperature: null } })
    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-1',
        startTime: '2026-06-01T15:00:00.000Z', endTime: '2026-06-01T16:00:00.000Z', attendeeEmail: 'not-an-email',
      }),
    ).rejects.toBeInstanceOf(BusinessActionError)
  })

  it('rejects an endTime that is not after startTime', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', lead_temperature: null } })
    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-1',
        startTime: '2026-06-01T16:00:00.000Z', endTime: '2026-06-01T15:00:00.000Z', attendeeEmail: 'a@b.com',
      }),
    ).rejects.toBeInstanceOf(BusinessActionError)
  })

  it('throws 404 when the contact is not found (cross-tenant or missing)', async () => {
    const { db } = makeDb({ contact: null })
    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-x',
        startTime: '2026-06-01T15:00:00.000Z', endTime: '2026-06-01T16:00:00.000Z', attendeeEmail: 'a@b.com',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates a GoogleCalendarError from createEvent() as a BusinessActionError with the same status', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', lead_temperature: null, name: 'Ana' } })
    const { GoogleCalendarError } = await import('@/lib/google-calendar/oauth')
    h.createEvent.mockRejectedValue(new GoogleCalendarError('Google Calendar is not connected for this account.', 400))

    await expect(
      executeBusinessAction({
        db, accountId: 'acct-1', userId: 'user-1', action: 'schedule_appointment', targetId: 'contact-1',
        startTime: '2026-06-01T15:00:00.000Z', endTime: '2026-06-01T16:00:00.000Z', attendeeEmail: 'a@b.com',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('executeBusinessAction — audit logging', () => {
  it('throws when the ai_action_log insert fails, even though the mutation already succeeded', async () => {
    const { db } = makeDb({ conversation: { id: 'conv-1', status: 'open' }, auditError: true })
    await expect(
      executeBusinessAction({ db, accountId: 'acct-1', userId: 'user-1', action: 'close_conversation', targetId: 'conv-1' }),
    ).rejects.toMatchObject({ status: 500 })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  getPendingActionForConversation: vi.fn(),
  resolvePendingAction: vi.fn(),
  confirmPendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  getBooking: vi.fn(),
  loadAiConfig: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  scheduleMeetingReminders: vi.fn(),
  cancelFollowUpCadence: vi.fn(),
  cancelRemindersForBooking: vi.fn(),
}))

vi.mock('./repo/pending-actions.repo', () => ({
  getPendingActionForConversation: h.getPendingActionForConversation,
  resolvePendingAction: h.resolvePendingAction,
}))
vi.mock('../ai/tools/handlers/confirm-pending-action', async () => {
  const actual = await vi.importActual<typeof import('../ai/tools/handlers/confirm-pending-action')>(
    '../ai/tools/handlers/confirm-pending-action',
  )
  return {
    PendingActionError: actual.PendingActionError,
    confirmPendingAction: h.confirmPendingAction,
    rejectPendingAction: h.rejectPendingAction,
  }
})
vi.mock('./repo/bookings.repo', () => ({ getBooking: h.getBooking }))
vi.mock('../ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('../ai/generate', () => ({ generateReply: h.generateReply }))
vi.mock('../automations/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./followups', () => ({
  scheduleMeetingReminders: h.scheduleMeetingReminders,
  cancelFollowUpCadence: h.cancelFollowUpCadence,
}))
vi.mock('./repo/scheduled-messages.repo', () => ({
  cancelRemindersForBooking: h.cancelRemindersForBooking,
}))

import { handleInboundPendingConfirmation } from './pending-confirmation'
import { PendingActionError } from '../ai/tools/handlers/confirm-pending-action'

const db = {} as SupabaseClient

function pendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa-1',
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    toolName: 'book_meeting',
    toolInput: {},
    status: 'pending',
    resolvedAt: null,
    resultingBookingId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

const baseArgs = {
  db,
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  userId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid-1' })
  h.cancelFollowUpCadence.mockResolvedValue(undefined)
  h.scheduleMeetingReminders.mockResolvedValue(undefined)
  h.cancelRemindersForBooking.mockResolvedValue(0)
})

describe('handleInboundPendingConfirmation — no pending action', () => {
  it('returns "none" immediately and never calls the LLM fallback or sends a reply', async () => {
    h.getPendingActionForConversation.mockResolvedValue(null)
    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'sim' })
    expect(outcome).toBe('none')
    expect(h.loadAiConfig).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('handleInboundPendingConfirmation — deterministic confirm', () => {
  it('confirms, replies, cancels follow-ups, and schedules reminders for book_meeting', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.confirmPendingAction.mockResolvedValue({ bookingId: 'bk-1' })
    h.getBooking.mockResolvedValue({
      id: 'bk-1',
      status: 'confirmed',
      startsAt: new Date('2026-08-25T10:00:00Z'),
      conversationId: 'conv-1',
      contactId: 'contact-1',
    })

    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'sim' })

    expect(outcome).toBe('confirmed')
    expect(h.confirmPendingAction).toHaveBeenCalledWith(db, 'acct-1', 'pa-1')
    expect(h.cancelFollowUpCadence).toHaveBeenCalledWith(db, 'acct-1', 'conv-1')
    expect(h.scheduleMeetingReminders).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    const call = h.engineSendText.mock.calls[0][0]
    expect(call.text).toMatch(/confirmado/i)
  })

  it('cancel_booking confirm cancels reminders for the booking instead of scheduling new ones', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction({ toolName: 'cancel_booking' }))
    h.confirmPendingAction.mockResolvedValue({ bookingId: 'bk-1' })

    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'confirmo' })

    expect(outcome).toBe('confirmed')
    expect(h.cancelRemindersForBooking).toHaveBeenCalledWith(db, 'acct-1', 'bk-1')
    expect(h.scheduleMeetingReminders).not.toHaveBeenCalled()
    expect(h.engineSendText.mock.calls[0][0].text).toMatch(/cancelada/i)
  })
})

describe('handleInboundPendingConfirmation — deterministic reject', () => {
  it('rejects and replies, without touching confirmPendingAction', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.rejectPendingAction.mockResolvedValue(undefined)

    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'não, obrigado' })

    expect(outcome).toBe('rejected')
    expect(h.rejectPendingAction).toHaveBeenCalledWith(db, 'acct-1', 'pa-1')
    expect(h.confirmPendingAction).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })
})

describe('handleInboundPendingConfirmation — 24h expiry gate', () => {
  it('a confirm on a pending action older than 24h is NOT confirmed — it is marked expired and re-proposed', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    h.getPendingActionForConversation.mockResolvedValue(pendingAction({ createdAt: old }))
    h.resolvePendingAction.mockResolvedValue(undefined)

    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'sim' })

    expect(h.confirmPendingAction).not.toHaveBeenCalled()
    expect(h.resolvePendingAction).toHaveBeenCalledWith(db, 'acct-1', 'pa-1', { status: 'expired' })
    expect(h.engineSendText.mock.calls[0][0].text).toMatch(/validade|disponibilidade/i)
    // Reported as 'confirmed' to the caller so AI auto-reply is still
    // skipped for this inbound (the reply above already covers it).
    expect(outcome).toBe('confirmed')
  })

  it('a confirm just under 24h old still confirms normally', async () => {
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000)
    h.getPendingActionForConversation.mockResolvedValue(pendingAction({ createdAt: recent }))
    h.confirmPendingAction.mockResolvedValue({ bookingId: 'bk-1' })
    h.getBooking.mockResolvedValue({
      id: 'bk-1',
      status: 'confirmed',
      startsAt: new Date('2026-08-25T10:00:00Z'),
      conversationId: 'conv-1',
      contactId: 'contact-1',
    })

    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'sim' })
    expect(outcome).toBe('confirmed')
    expect(h.confirmPendingAction).toHaveBeenCalled()
  })
})

describe('handleInboundPendingConfirmation — PendingActionError handling', () => {
  it('calendar_not_active produces an apologetic reply instead of throwing', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.confirmPendingAction.mockRejectedValue(
      new PendingActionError('calendar not active', 'calendar_not_active'),
    )

    const outcome = await handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'sim' })
    expect(outcome).toBe('confirmed')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.cancelFollowUpCadence).not.toHaveBeenCalled()
  })

  it('a non-PendingActionError failure propagates (never silently swallowed)', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.confirmPendingAction.mockRejectedValue(new Error('db exploded'))

    await expect(handleInboundPendingConfirmation({ ...baseArgs, inboundText: 'sim' })).rejects.toThrow(
      'db exploded',
    )
  })
})

describe('handleInboundPendingConfirmation — LLM fallback', () => {
  it('falls back to the LLM for non-deterministic text and confirms on CONFIRM', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.loadAiConfig.mockResolvedValue({ provider: 'anthropic', model: 'x', apiKey: 'k' })
    h.generateReply.mockResolvedValue({ text: 'CONFIRM', handoff: false, usage: null })
    h.confirmPendingAction.mockResolvedValue({ bookingId: 'bk-1' })
    h.getBooking.mockResolvedValue({
      id: 'bk-1',
      status: 'confirmed',
      startsAt: new Date('2026-08-25T10:00:00Z'),
      conversationId: 'conv-1',
      contactId: 'contact-1',
    })

    const outcome = await handleInboundPendingConfirmation({
      ...baseArgs,
      inboundText: 'sim, pode marcar, obrigado!',
    })
    expect(outcome).toBe('confirmed')
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })

  it('treats anything other than an exact CONFIRM/REJECT as other', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.loadAiConfig.mockResolvedValue({ provider: 'anthropic', model: 'x', apiKey: 'k' })
    h.generateReply.mockResolvedValue({ text: 'OTHER', handoff: false, usage: null })

    const outcome = await handleInboundPendingConfirmation({
      ...baseArgs,
      inboundText: 'posso pensar melhor sobre isto',
    })
    expect(outcome).toBe('other')
    expect(h.confirmPendingAction).not.toHaveBeenCalled()
    expect(h.rejectPendingAction).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('never calls confirm/reject when there is no usable AI config (defaults to other)', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.loadAiConfig.mockResolvedValue(null)

    const outcome = await handleInboundPendingConfirmation({
      ...baseArgs,
      inboundText: 'hmm deixa-me ver',
    })
    expect(outcome).toBe('other')
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('a provider failure never turns into an accidental confirm/reject', async () => {
    h.getPendingActionForConversation.mockResolvedValue(pendingAction())
    h.loadAiConfig.mockResolvedValue({ provider: 'anthropic', model: 'x', apiKey: 'k' })
    h.generateReply.mockRejectedValue(new Error('provider timeout'))

    const outcome = await handleInboundPendingConfirmation({
      ...baseArgs,
      inboundText: 'nao sei bem',
    })
    expect(outcome).toBe('other')
    expect(h.confirmPendingAction).not.toHaveBeenCalled()
    expect(h.rejectPendingAction).not.toHaveBeenCalled()
  })
})

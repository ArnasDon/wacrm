import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  createDeletionRequest: vi.fn(),
  cancelPendingDeletionRequest: vi.fn(),
  markDeletionRequestNotified: vi.fn(),
  recordDeletionInsertFailure: vi.fn(),
  getFailedDeletionInsertsForRetry: vi.fn(),
  markDeletionInsertRecovered: vi.fn(),
  markDeletionInsertFailedAgain: vi.fn(),
  engineSendText: vi.fn(),
  sendDataDeletionNotification: vi.fn(),
  sendWhatsAppAdminAlert: vi.fn(),
}))

vi.mock('./repo/data-deletion-requests.repo', () => ({
  createDeletionRequest: h.createDeletionRequest,
  cancelPendingDeletionRequest: h.cancelPendingDeletionRequest,
  markDeletionRequestNotified: h.markDeletionRequestNotified,
}))
vi.mock('./repo/data-deletion-insert-failures.repo', () => ({
  recordDeletionInsertFailure: h.recordDeletionInsertFailure,
  getFailedDeletionInsertsForRetry: h.getFailedDeletionInsertsForRetry,
  markDeletionInsertRecovered: h.markDeletionInsertRecovered,
  markDeletionInsertFailedAgain: h.markDeletionInsertFailedAgain,
}))
vi.mock('../automations/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('../notifications/data-deletion-email', () => ({
  sendDataDeletionNotification: h.sendDataDeletionNotification,
}))
vi.mock('../notifications/whatsapp-admin-alert', () => ({
  sendWhatsAppAdminAlert: h.sendWhatsAppAdminAlert,
}))

import {
  handleInboundDataDeletionRequest,
  reprocessFailedDataDeletionInserts,
  normalizeExactCommand,
} from './data-deletion'

const db = {} as SupabaseClient

function deletionRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ddr-1',
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    phone: '351911111111',
    profileName: 'Maria',
    status: 'pending' as const,
    requestedAt: new Date(),
    cancelledAt: null,
    completedAt: null,
    notifiedAt: null,
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
  phone: '351911111111',
  profileName: 'Maria',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid-1' })
  h.sendDataDeletionNotification.mockResolvedValue(undefined)
  h.markDeletionRequestNotified.mockResolvedValue(undefined)
  h.recordDeletionInsertFailure.mockResolvedValue(undefined)
  h.sendWhatsAppAdminAlert.mockResolvedValue({ sent: true, via: 'text' })
})

describe('normalizeExactCommand', () => {
  it('trims, uppercases and strips accents', () => {
    expect(normalizeExactCommand('  apagar  ')).toBe('APAGAR')
    expect(normalizeExactCommand('Apagar')).toBe('APAGAR')
    expect(normalizeExactCommand('cancelar')).toBe('CANCELAR')
  })

  it('leaves a phrase that merely contains the keyword unaffected by the exact-match rule', () => {
    // normalizeExactCommand itself only normalizes, the caller does the
    // exact-equality check, this asserts the normalized phrase is NOT
    // equal to the bare keyword.
    const normalized = normalizeExactCommand('não quero apagar nada')
    expect(normalized).not.toBe('APAGAR')
  })
})

describe('handleInboundDataDeletionRequest', () => {
  it('returns none and sends no reply for unrelated text', async () => {
    const outcome = await handleInboundDataDeletionRequest({
      ...baseArgs,
      rawText: 'Olá, bom dia!',
    })

    expect(outcome).toBe('none')
    expect(h.createDeletionRequest).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('returns none for a message that merely contains APAGAR inside a sentence', async () => {
    const outcome = await handleInboundDataDeletionRequest({
      ...baseArgs,
      rawText: 'não quero apagar a conversa, só uma pergunta',
    })

    expect(outcome).toBe('none')
    expect(h.createDeletionRequest).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('creates a pending deletion request on an exact "APAGAR" message and replies', async () => {
    h.createDeletionRequest.mockResolvedValue({ request: deletionRequest(), created: true })

    const outcome = await handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' })

    expect(outcome).toBe('requested')
    expect(h.createDeletionRequest).toHaveBeenCalledWith(db, 'acct-1', {
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
    })
    expect(h.sendDataDeletionNotification).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    const replyText = h.engineSendText.mock.calls[0][0].text as string
    expect(replyText).toContain('30 dias')
    expect(replyText).toContain('CANCELAR')
  })

  it.each(['apagar', '  Apagar  ', 'APAGAR', 'apágar', 'ApAgAr'])(
    'matches variant %j (accents/case/whitespace)',
    async (variant) => {
      h.createDeletionRequest.mockResolvedValue({ request: deletionRequest(), created: true })

      const outcome = await handleInboundDataDeletionRequest({ ...baseArgs, rawText: variant })

      expect(outcome).toBe('requested')
    },
  )

  it('is idempotent: a second exact "APAGAR" while one is already pending does not duplicate and replies distinctly', async () => {
    h.createDeletionRequest.mockResolvedValue({ request: deletionRequest(), created: false })

    const outcome = await handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' })

    expect(outcome).toBe('already_pending')
    // No notification for a repeat request, only the first creation notifies.
    expect(h.sendDataDeletionNotification).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    const replyText = h.engineSendText.mock.calls[0][0].text as string
    expect(replyText).toMatch(/já tínhamos registado/i)
  })

  it('cancels a pending request on an exact "CANCELAR" message and replies', async () => {
    h.cancelPendingDeletionRequest.mockResolvedValue(deletionRequest({ status: 'cancelled' }))

    const outcome = await handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'CANCELAR' })

    expect(outcome).toBe('cancelled')
    expect(h.cancelPendingDeletionRequest).toHaveBeenCalledWith(db, 'acct-1', '351911111111')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    const replyText = h.engineSendText.mock.calls[0][0].text as string
    expect(replyText).toMatch(/cancelado/i)
  })

  it('replies distinctly when CANCELAR is sent with nothing pending', async () => {
    h.cancelPendingDeletionRequest.mockResolvedValue(null)

    const outcome = await handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'cancelar' })

    expect(outcome).toBe('no_pending_to_cancel')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    const replyText = h.engineSendText.mock.calls[0][0].text as string
    expect(replyText).toMatch(/não encontrámos/i)
  })

  it('never throws when the reply send fails', async () => {
    h.createDeletionRequest.mockResolvedValue({ request: deletionRequest(), created: true })
    h.engineSendText.mockRejectedValue(new Error('meta down'))

    await expect(
      handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' }),
    ).resolves.toBe('requested')
  })

  it('never throws when the notification email fails', async () => {
    h.createDeletionRequest.mockResolvedValue({ request: deletionRequest(), created: true })
    h.sendDataDeletionNotification.mockRejectedValue(new Error('smtp down'))

    await expect(
      handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' }),
    ).resolves.toBe('requested')
  })

  describe('INSERT failure protection (same level as the AI SDR approval-forward path)', () => {
    it('never falls through to "none" when createDeletionRequest throws — queues, alerts, and replies', async () => {
      h.createDeletionRequest.mockRejectedValue(new Error('connection reset'))

      const outcome = await handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' })

      // MUST NOT be 'none' — the webhook route's `outcome !== 'none'`
      // check is what stops the message from being reinterpreted as a
      // normal inbound and sent into flow/automation/AI dispatch.
      expect(outcome).toBe('insert_failed')

      expect(h.recordDeletionInsertFailure).toHaveBeenCalledWith(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        phone: '351911111111',
        profileName: 'Maria',
        error: 'connection reset',
      })

      expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledTimes(1)
      expect(h.sendWhatsAppAdminAlert.mock.calls[0][0]).toContain('351911111111')
      expect(h.sendWhatsAppAdminAlert.mock.calls[0][1]).toEqual({ accountId: 'acct-1' })

      // Still acknowledges receipt to the lead, but must NOT repeat the
      // 30-day promise — the request isn't durably recorded yet.
      expect(h.engineSendText).toHaveBeenCalledTimes(1)
      const replyText = h.engineSendText.mock.calls[0][0].text as string
      expect(replyText).not.toContain('30 dias')

      // No success-path side effects on failure.
      expect(h.sendDataDeletionNotification).not.toHaveBeenCalled()
      expect(h.markDeletionRequestNotified).not.toHaveBeenCalled()
    })

    it('never throws even if recording the failure itself fails', async () => {
      h.createDeletionRequest.mockRejectedValue(new Error('db down'))
      h.recordDeletionInsertFailure.mockRejectedValue(new Error('queue insert also failed'))

      await expect(
        handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' }),
      ).resolves.toBe('insert_failed')
    })

    it('never throws even if the alert itself fails', async () => {
      h.createDeletionRequest.mockRejectedValue(new Error('db down'))
      h.sendWhatsAppAdminAlert.mockRejectedValue(new Error('meta unreachable'))

      await expect(
        handleInboundDataDeletionRequest({ ...baseArgs, rawText: 'APAGAR' }),
      ).resolves.toBe('insert_failed')
    })
  })
})

describe('reprocessFailedDataDeletionInserts', () => {
  function failureRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'fail-1',
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      phone: '351911111111',
      profileName: 'Maria',
      status: 'failed' as const,
      attempts: 1,
      lastError: 'connection reset',
      recoveredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
  }

  beforeEach(() => {
    h.markDeletionInsertRecovered.mockResolvedValue(undefined)
    h.markDeletionInsertFailedAgain.mockResolvedValue(undefined)
  })

  it('marks a row recovered when the retried insert succeeds', async () => {
    h.getFailedDeletionInsertsForRetry.mockResolvedValue([failureRow()])
    h.createDeletionRequest.mockResolvedValue({ request: deletionRequest(), created: true })

    const result = await reprocessFailedDataDeletionInserts(db)

    expect(result).toEqual({ attempted: 1, recovered: 1, stillFailing: 0, gaveUp: 0 })
    expect(h.markDeletionInsertRecovered).toHaveBeenCalledWith(db, 'fail-1')
  })

  it('requeues as failed (not gave_up) when under the retry budget', async () => {
    h.getFailedDeletionInsertsForRetry.mockResolvedValue([failureRow({ attempts: 1 })])
    h.createDeletionRequest.mockRejectedValue(new Error('still down'))

    const result = await reprocessFailedDataDeletionInserts(db)

    expect(result).toEqual({ attempted: 1, recovered: 0, stillFailing: 1, gaveUp: 0 })
    expect(h.markDeletionInsertFailedAgain).toHaveBeenCalledWith(
      db,
      'fail-1',
      2,
      'still down',
      { giveUp: false },
    )
    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledTimes(1)
  })

  it('gives up (terminal) once the retry budget is exhausted', async () => {
    h.getFailedDeletionInsertsForRetry.mockResolvedValue([failureRow({ attempts: 4 })])
    h.createDeletionRequest.mockRejectedValue(new Error('permanently down'))

    const result = await reprocessFailedDataDeletionInserts(db)

    expect(result).toEqual({ attempted: 1, recovered: 0, stillFailing: 0, gaveUp: 1 })
    expect(h.markDeletionInsertFailedAgain).toHaveBeenCalledWith(
      db,
      'fail-1',
      5,
      'permanently down',
      { giveUp: true },
    )
  })

  it("one row's unrecoverable failure does not abort the rest of the batch", async () => {
    h.getFailedDeletionInsertsForRetry.mockResolvedValue([
      failureRow({ id: 'fail-1' }),
      failureRow({ id: 'fail-2' }),
    ])
    h.createDeletionRequest
      .mockResolvedValueOnce({ request: deletionRequest(), created: true })
      .mockResolvedValueOnce({ request: deletionRequest(), created: true })
    h.markDeletionInsertRecovered
      .mockRejectedValueOnce(new Error('DB blip recording recovery'))
      .mockResolvedValueOnce(undefined)

    const result = await reprocessFailedDataDeletionInserts(db)

    expect(result.attempted).toBe(2)
    // Row 1's failure to record its own recovery counts as still
    // failing (from this sweep's point of view); row 2 still recovers.
    expect(result.recovered).toBe(1)
    expect(result.stillFailing).toBe(1)
  })
})

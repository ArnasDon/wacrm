import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  sendDataDeletionNotification,
  configureEmailSender,
  resetEmailSender,
  type EmailMessage,
} from './data-deletion-email'
import type { DataDeletionRequest } from '@/lib/eter/repo/data-deletion-requests.repo'

function deletionRequest(overrides: Partial<DataDeletionRequest> = {}): DataDeletionRequest {
  return {
    id: 'ddr-1',
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    phone: '351911111111',
    profileName: 'Maria',
    status: 'pending',
    requestedAt: new Date('2026-08-12T10:00:00Z'),
    cancelledAt: null,
    completedAt: null,
    notifiedAt: null,
    createdAt: new Date('2026-08-12T10:00:00Z'),
    ...overrides,
  }
}

const h = vi.hoisted(() => ({ sendWhatsAppAdminAlert: vi.fn() }))

vi.mock('./whatsapp-admin-alert', () => ({
  sendWhatsAppAdminAlert: h.sendWhatsAppAdminAlert,
}))

afterEach(() => {
  resetEmailSender()
  vi.clearAllMocks()
})

describe('sendDataDeletionNotification', () => {
  it('the default sender falls back to a real WhatsApp alert (no email infra in this repo)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.sendWhatsAppAdminAlert.mockResolvedValue({ sent: true, via: 'text' })

    await expect(sendDataDeletionNotification(deletionRequest())).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('sem infraestrutura de email')
    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledTimes(1)
    expect(h.sendWhatsAppAdminAlert).toHaveBeenCalledWith(
      expect.stringContaining('351911111111'),
      { accountId: 'acct-1' },
    )
    warnSpy.mockRestore()
  })

  it('the default sender logs loudly and gives up when the request has no accountId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await sendDataDeletionNotification(deletionRequest({ accountId: '' }))

    expect(h.sendWhatsAppAdminAlert).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('delegates to a configured EmailSender with the expected recipients and content', async () => {
    const sent: EmailMessage[] = []
    configureEmailSender({
      send: async (message) => {
        sent.push(message)
      },
    })

    await sendDataDeletionNotification(deletionRequest())

    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual(['geral@etergrowth.com', 'devs@etergrowth.com'])
    expect(sent[0].subject).toContain('351911111111')
    expect(sent[0].text).toContain('351911111111')
    expect(sent[0].text).toContain('Maria')
  })

  it('never throws when the configured sender fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    configureEmailSender({
      send: async () => {
        throw new Error('smtp down')
      },
    })

    await expect(sendDataDeletionNotification(deletionRequest())).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

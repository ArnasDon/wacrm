import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Coverage for the shared admin-alert WhatsApp sender:
//   - missing/invalid AISDR_ALERT_ADMIN_PHONE → loud log, no send
//   - no whatsapp_config for the account → loud log, no send
//   - happy path → free-text send via meta-api
//   - outside the 24h window (131047-style error) → falls back to an
//     APPROVED template with the alert text as the {{1}} param
//   - outside the window AND no approved template → loud log, no
//     silent failure
// ============================================================

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  decrypt: vi.fn(),
  findApprovedTemplateByName: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: h.sendTextMessage,
  sendTemplateMessage: h.sendTemplateMessage,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: h.decrypt }))
vi.mock('@/lib/eter/repo/message-templates.repo', () => ({
  findApprovedTemplateByName: h.findApprovedTemplateByName,
}))

const CONFIG_ROW = { phone_number_id: 'PNID-1', access_token: 'enc-token' }

function makeSupabaseAdmin(configRow: unknown = CONFIG_ROW) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: configRow, error: null }),
    })),
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.AISDR_ALERT_ADMIN_PHONE = '351916944664'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  h.createClient.mockReturnValue(makeSupabaseAdmin())
  h.decrypt.mockReturnValue('plaintext-token')
  h.sendTextMessage.mockResolvedValue({ messageId: 'wamid-out-1' })
  h.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-out-2' })
  h.findApprovedTemplateByName.mockResolvedValue(null)
})

afterEach(() => {
  delete process.env.AISDR_ALERT_ADMIN_PHONE
})

describe('sendWhatsAppAdminAlert', () => {
  it('logs loudly and does not send when AISDR_ALERT_ADMIN_PHONE is unset', async () => {
    delete process.env.AISDR_ALERT_ADMIN_PHONE
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendWhatsAppAdminAlert } = await import('./whatsapp-admin-alert')
    const result = await sendWhatsAppAdminAlert('alerta de teste', { accountId: 'acct-1' })

    expect(result).toEqual({ sent: false, reason: 'admin_phone_not_configured' })
    expect(h.sendTextMessage).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('logs loudly and does not send when no whatsapp_config exists for the account', async () => {
    h.createClient.mockReturnValue(makeSupabaseAdmin(null))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendWhatsAppAdminAlert } = await import('./whatsapp-admin-alert')
    const result = await sendWhatsAppAdminAlert('alerta de teste', { accountId: 'acct-1' })

    expect(result).toEqual({ sent: false, reason: 'whatsapp_config_not_found' })
    expect(h.sendTextMessage).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('sends free text on the happy path', async () => {
    const { sendWhatsAppAdminAlert } = await import('./whatsapp-admin-alert')
    const result = await sendWhatsAppAdminAlert('alerta de teste', { accountId: 'acct-1' })

    expect(result).toEqual({ sent: true, via: 'text' })
    expect(h.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'PNID-1',
        accessToken: 'plaintext-token',
        to: '351916944664',
        text: 'alerta de teste',
      }),
    )
    expect(h.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('falls back to an approved template when outside the 24h session window', async () => {
    h.sendTextMessage.mockRejectedValue(
      new Error('(#131047) Message failed to send because more than 24 hours have passed'),
    )
    h.findApprovedTemplateByName.mockResolvedValue({ name: 'eter_admin_alert', language: 'pt_PT' })

    const { sendWhatsAppAdminAlert } = await import('./whatsapp-admin-alert')
    const result = await sendWhatsAppAdminAlert('alerta fora da janela', { accountId: 'acct-1' })

    expect(result).toEqual({ sent: true, via: 'template' })
    expect(h.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'eter_admin_alert',
        language: 'pt_PT',
        params: ['alerta fora da janela'],
      }),
    )
  })

  it('logs the impossibility (does not throw) when outside the window and no approved template exists', async () => {
    h.sendTextMessage.mockRejectedValue(new Error('(#131047) re-engagement message'))
    h.findApprovedTemplateByName.mockResolvedValue(null)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendWhatsAppAdminAlert } = await import('./whatsapp-admin-alert')
    const result = await sendWhatsAppAdminAlert('alerta perdido', { accountId: 'acct-1' })

    expect(result).toEqual({ sent: false, reason: 'outside_window_no_template' })
    expect(h.sendTemplateMessage).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('reports a plain send failure distinctly from the window fallback', async () => {
    h.sendTextMessage.mockRejectedValue(new Error('some other Meta error'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { sendWhatsAppAdminAlert } = await import('./whatsapp-admin-alert')
    const result = await sendWhatsAppAdminAlert('alerta', { accountId: 'acct-1' })

    expect(result).toEqual({ sent: false, reason: 'send_failed: some other Meta error' })
    expect(h.findApprovedTemplateByName).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

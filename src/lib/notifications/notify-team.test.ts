import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Coverage for notify-team.ts:
//   - notifyHandoff dispara Mattermost + WhatsApp quando ambos
//     estão configurados
//   - notifyMeetingBooked idem
//   - falha do Mattermost (fetch rejeita / responde não-2xx) não lança
//     e não impede o WhatsApp de ser tentado
//   - janela de 24h fechada sem template aprovado não lança, só regista
//   - sem MATTERMOST_WEBHOOK_URL / sem notify_phone_numbers → não tenta
//     enviar, não lança
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

const WHATSAPP_CONFIG_ROW = { phone_number_id: 'PNID-1', access_token: 'enc-token' }
const AI_CONFIG_ROW = { notify_phone_numbers: ['+351916944664'] }

function makeSupabaseAdmin(opts: {
  aiConfig?: unknown
  whatsappConfig?: unknown
} = {}) {
  const { aiConfig = AI_CONFIG_ROW, whatsappConfig = WHATSAPP_CONFIG_ROW } = opts
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'ai_configs' ? aiConfig : whatsappConfig,
        error: null,
      }),
    })),
  }
}

const originalFetch = global.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...originalEnv }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  process.env.MATTERMOST_WEBHOOK_URL = 'https://team.etergrowth.com/hooks/abc123'
  h.createClient.mockReturnValue(makeSupabaseAdmin())
  h.decrypt.mockReturnValue('plaintext-token')
  h.sendTextMessage.mockResolvedValue({ messageId: 'wamid-out-1' })
  h.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-out-2' })
  h.findApprovedTemplateByName.mockResolvedValue(null)
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
})

const HANDOFF_INPUT = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactName: 'Joana Silva',
  company: 'Acme Lda',
  phone: '+351910000000',
  email: 'joana@acme.pt',
  reason: 'quer falar com humano',
  lastMessages: [
    { role: 'user', content: 'ola' },
    { role: 'assistant', content: 'em que posso ajudar' },
    { role: 'user', content: 'quero falar com uma pessoa' },
  ],
  conversationUrl: 'https://eterwa.etergrowth.com/inbox?c=conv-1',
}

const MEETING_INPUT = {
  accountId: 'acct-1',
  contactName: 'Joana Silva',
  company: 'Acme Lda',
  startsAt: new Date('2026-09-25T10:00:00Z'),
  timezone: 'Europe/Lisbon',
  eventUrl: 'https://calendar.google.com/event?eid=abc',
}

describe('notifyHandoff', () => {
  it('dispara Mattermost e WhatsApp quando ambos estão configurados', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch

    const { notifyHandoff } = await import('./notify-team')
    const result = await notifyHandoff(HANDOFF_INPUT)

    expect(result.mattermost).toEqual({ sent: true, via: 'webhook' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://team.etergrowth.com/hooks/abc123',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.whatsapp).toEqual([{ sent: true, via: 'text' }])
    expect(h.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'PNID-1', accessToken: 'plaintext-token' }),
    )
  })

  it('falha do Mattermost não impede o WhatsApp de ser tentado, nem lança', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    global.fetch = fetchMock as unknown as typeof fetch

    const { notifyHandoff } = await import('./notify-team')
    const result = await notifyHandoff(HANDOFF_INPUT)

    expect(result.mattermost.sent).toBe(false)
    expect(result.whatsapp).toEqual([{ sent: true, via: 'text' }])
  })

  it('sem MATTERMOST_WEBHOOK_URL não tenta enviar e não lança', async () => {
    delete process.env.MATTERMOST_WEBHOOK_URL
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { notifyHandoff } = await import('./notify-team')
    const result = await notifyHandoff(HANDOFF_INPUT)

    expect(result.mattermost).toEqual({ sent: false, reason: 'webhook_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem notify_phone_numbers não tenta enviar WhatsApp e não lança', async () => {
    h.createClient.mockReturnValue(makeSupabaseAdmin({ aiConfig: { notify_phone_numbers: [] } }))
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch

    const { notifyHandoff } = await import('./notify-team')
    const result = await notifyHandoff(HANDOFF_INPUT)

    expect(result.whatsapp).toEqual([])
    expect(h.sendTextMessage).not.toHaveBeenCalled()
  })

  it('janela de 24h fechada e sem template aprovado: regista, não lança', async () => {
    h.sendTextMessage.mockRejectedValue(
      new Error('(#131047) Message failed to send because more than 24 hours have passed'),
    )
    h.findApprovedTemplateByName.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { notifyHandoff } = await import('./notify-team')
    const result = await notifyHandoff(HANDOFF_INPUT)

    expect(result.whatsapp).toEqual([{ sent: false, reason: 'outside_window_no_template' }])
    expect(h.sendTemplateMessage).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('janela fechada com template aprovado: usa o fallback de template', async () => {
    h.sendTextMessage.mockRejectedValue(new Error('(#131047) re-engagement message'))
    h.findApprovedTemplateByName.mockResolvedValue({ name: 'eter_admin_alert', language: 'pt_PT' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch

    const { notifyHandoff } = await import('./notify-team')
    const result = await notifyHandoff(HANDOFF_INPUT)

    expect(result.whatsapp).toEqual([{ sent: true, via: 'template' }])
    expect(h.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'eter_admin_alert', language: 'pt_PT' }),
    )
  })
})

describe('notifyMeetingBooked', () => {
  it('dispara Mattermost e WhatsApp quando ambos estão configurados', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch

    const { notifyMeetingBooked } = await import('./notify-team')
    const result = await notifyMeetingBooked(MEETING_INPUT)

    expect(result.mattermost).toEqual({ sent: true, via: 'webhook' })
    expect(result.whatsapp).toEqual([{ sent: true, via: 'text' }])
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body).text).toContain('Reunião comercial marcada')
  })

  it('falha do Mattermost não afecta o WhatsApp, nem lança', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') }) as unknown as typeof fetch

    const { notifyMeetingBooked } = await import('./notify-team')
    const result = await notifyMeetingBooked(MEETING_INPUT)

    expect(result.mattermost).toEqual({ sent: false, reason: 'mattermost_http_500' })
    expect(result.whatsapp).toEqual([{ sent: true, via: 'text' }])
  })
})

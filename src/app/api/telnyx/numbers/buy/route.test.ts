import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/telnyx/numbers/buy — compra un número vía Telnyx. owner+.
// Mockeamos requireRole, la lib telnyx, encryption y admin-client.

let callerRole = 'owner'
let configRow: Record<string, unknown> | null = {
  api_key_encrypted: 'iv:cipher:tag',
  call_control_app_id: 'ccapp-1',
  messaging_profile_id: 'profile-1',
}

// Hoisted: los mocks deben existir antes del factory de vi.mock.
const getReputation = vi.hoisted(() => vi.fn())
const createNumberOrder = vi.hoisted(() => vi.fn())
const mockCreateTelnyxClient = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    requireRole: vi.fn(async () => ({ accountId: 'acct-1', accountRole: callerRole })),
  }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => (s === 'iv:cipher:tag' ? 'decrypted-key' : '?'),
}))

vi.mock('@/lib/telnyx/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: configRow, error: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/telnyx/api', () => ({
  createTelnyxClient: mockCreateTelnyxClient,
  TelnyxApiError: class TelnyxApiError extends Error {
    status?: number
    constructor(message: string, status?: number) {
      super(message)
      this.status = status
    }
  },
  reputationScore: (r: {
    spam_risk?: string | null
    maturity_score?: number | null
    connection_score?: number | null
    engagement_score?: number | null
  } | null) => {
    if (!r) return null
    if (r.spam_risk === 'high') return 20
    const scores = [r.maturity_score, r.connection_score, r.engagement_score].filter(
      (s): s is number => typeof s === 'number',
    )
    if (scores.length === 0) return null
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  },
}))

import { POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/telnyx/numbers/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'owner'
  configRow = {
    api_key_encrypted: 'iv:cipher:tag',
    call_control_app_id: 'ccapp-1',
    messaging_profile_id: 'profile-1',
  }
  mockCreateTelnyxClient.mockReturnValue({
    getReputation,
    createNumberOrder,
  })
  getReputation.mockResolvedValue(null)
  createNumberOrder.mockResolvedValue({ id: 'order-1', status: 'pending', phoneNumbersCount: 1 })
  vi.clearAllMocks()
})

describe('POST /api/telnyx/numbers/buy', () => {
  it('400 sin número', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
  })

  it('400 con número no-E.164', async () => {
    const res = await post({ number: 'abc' })
    expect(res.status).toBe(400)
  })

  it('409 si reputation spam_risk es high', async () => {
    getReputation.mockResolvedValue({ spam_risk: 'high' })
    const res = await post({ number: '+15552223333' })
    expect(res.status).toBe(409)
    expect(createNumberOrder).not.toHaveBeenCalled()
  })

  it('compra y asocia connection/messaging profile del account', async () => {
    const res = await post({ number: '+15550001111' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order_id).toBe('order-1')
    expect(json.status).toBe('pending')
    expect(json.number).toBe('+15550001111')

    // La key se desencripta antes de pasar al cliente.
    expect(mockCreateTelnyxClient).toHaveBeenCalledWith('decrypted-key')
    expect(getReputation).toHaveBeenCalledWith('+15550001111')
    expect(createNumberOrder).toHaveBeenCalledWith({
      phoneNumber: '+15550001111',
      connectionId: 'ccapp-1',
      messagingProfileId: 'profile-1',
      billingGroupId: undefined,
      customerReference: 'wacrm-acct-1',
    })
  })

  it('billing_group_id opcional se pasa al pedido', async () => {
    const res = await post({ number: '+15556667777', billing_group_id: '3f6a2e9c-8d14-4b7a-9c2e-1a0b5f6d7e8f' })
    expect(res.status).toBe(200)
    expect(createNumberOrder).toHaveBeenCalledWith(
      expect.objectContaining({ billingGroupId: '3f6a2e9c-8d14-4b7a-9c2e-1a0b5f6d7e8f' }),
    )
  })

  it('compra sin config de app/profile (solo key)', async () => {
    configRow = { api_key_encrypted: 'iv:cipher:tag' }
    const res = await post({ number: '+15558889999' })
    expect(res.status).toBe(200)
    expect(createNumberOrder).toHaveBeenCalledWith({
      phoneNumber: '+15558889999',
      connectionId: undefined,
      messagingProfileId: undefined,
      billingGroupId: undefined,
      customerReference: 'wacrm-acct-1',
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// Test-send route: an approved template goes straight to Meta through a
// channel of its own WABA; bad input never reaches Meta.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  template: null as Record<string, unknown> | null,
  channel: null as Record<string, unknown> | null,
  send: vi.fn(),
  logged: [] as unknown[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) b[m] = () => b
    b.maybeSingle = async () => ({ data: h.template, error: null })
    return { supabase: { from: () => b }, accountId: 'acct-1', userId: 'user-1' }
  },
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/whatsapp/channels', () => ({
  loadChannelById: async () => h.channel,
  loadChannelForWaba: async () => h.channel,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain-${v}` }))
vi.mock('@/lib/whatsapp/meta-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/meta-api')>()),
}))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (row: unknown) => {
        h.logged.push(row)
        return { error: null }
      },
    }),
  }),
}))

const { POST } = await import('./route')

const ID = '11111111-2222-3333-4444-555555555555'
const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: ID }),
  })

// Meta's /messages endpoint, answered by `h.send(url, body)`.
function metaReplies(status: number, json: unknown) {
  h.send.mockImplementation(async () => ({ status, json: async () => json }))
}

beforeEach(() => {
  h.send.mockReset()
  h.logged = []
  metaReplies(200, {
    messaging_product: 'whatsapp',
    contacts: [{ input: '14155550123', wa_id: '14155550123' }],
    messages: [{ id: 'wamid.1', message_status: 'accepted' }],
  })
  vi.stubGlobal('fetch', (url: string, init: { body: string; headers: Record<string, string> }) =>
    h.send(url, JSON.parse(init.body), init.headers),
  )
  h.template = {
    id: ID,
    name: 'order_update',
    language: 'en_US',
    status: 'APPROVED',
    waba_id: 'WABA-1',
    body_text: 'Your order {{1}} ships on {{2}}',
  }
  h.channel = { id: 'ch-1', name: 'Main', phone_number_id: 'PN-1', waba_id: 'WABA-1', access_token: 'enc' }
})

describe('POST /api/whatsapp/templates/:id/test', () => {
  it('sends the template, returns the request + Meta response, and records the send', async () => {
    const res = await call({ to: '+1 415 555 0123', body: ['#42', 'Monday'] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ success: true, message_id: 'wamid.1', to: '+14155550123' })
    expect(json.response.messages[0].message_status).toBe('accepted')
    const [url, sent, headers] = h.send.mock.calls[0]
    expect(url).toMatch(/\/PN-1\/messages$/)
    expect(headers.Authorization).toBe('Bearer plain-enc')
    expect(sent).toMatchObject({ to: '14155550123', type: 'template', template: { name: 'order_update' } })
    expect(json.request).toEqual(sent)
    expect(sent.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['#42', 'Monday'])
    expect(h.logged).toEqual([expect.objectContaining({ wamid: 'wamid.1', to_phone: '14155550123' })])
  })

  it('requires an international number with +', async () => {
    const res = await call({ to: '4155550123', body: ['a', 'b'] })
    expect(res.status).toBe(400)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('refuses a template Meta has not approved', async () => {
    h.template = { ...h.template, status: 'PENDING' }
    expect((await call({ to: '+14155550123', body: ['a', 'b'] })).status).toBe(400)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('requires a value for every variable', async () => {
    expect((await call({ to: '+14155550123', body: ['only-one'] })).status).toBe(400)
    expect(h.send).not.toHaveBeenCalled()
  })

  it("refuses a channel from another WABA, which can't send this template", async () => {
    h.channel = { ...h.channel, waba_id: 'WABA-2' }
    const res = await call({ to: '+14155550123', channel_id: 'ch-2', body: ['a', 'b'] })
    expect(res.status).toBe(400)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('explains the allowed-list rule when a Meta test number refuses the recipient', async () => {
    metaReplies(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030 } })
    const res = await call({ to: '+14155550123', body: ['a', 'b'] })
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toMatch(/allowed list/)
    // The raw Meta error body is returned for the test window.
    expect(json.response.error.code).toBe(131030)
    expect(h.logged).toEqual([])
  })
})

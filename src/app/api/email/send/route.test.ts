import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/email/send — envía un email manual con template HTML (agent+).

let callerRole = 'agent'
let contactRow: { name: string | null; email: string | null; phone: string | null; company: string | null } | null = null
let templateRow: { subject: string; body_html: string } | null = null
const send = vi.fn(async (_from: string, _reply: string | null, _input: { to: string; subject: string; html: string }) => ({ id: 'resend-1' }))

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = vi.fn(chain)
    b.maybeSingle = vi.fn(async () => {
      if (table === 'contacts') return { data: contactRow, error: null }
      if (table === 'email_templates') return { data: templateRow, error: null }
      return { data: null, error: null }
    })
    b.insert = vi.fn(async () => ({ error: null, data: null }))
    return b
  }
  return { from: vi.fn((table: string) => builder(table)) }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = (await importOriginal()) as { ForbiddenError: new (m: string) => Error }
  const RANK: Record<string, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 }
  return {
    ...actual,
    requireRole: vi.fn(async (min: string) => {
      if (RANK[callerRole] < RANK[min]) throw new actual.ForbiddenError(`requires ${min}`)
      return { accountId: 'acct-1', role: callerRole, account: { id: 'acct-1', name: 'Acme' }, supabase: supabaseMock }
    }),
  }
})

// contactText real no se cubre aquí (lo cubren los tests del engine);
// el route lo usa y aquí se mockea un interpolador simple.
vi.mock('@/lib/automations/engine', () => ({
  contactText: (text: string, _vars: unknown, contact: { name?: string } | null) =>
    text.replace(/\{\{name\}\}/g, contact?.name ?? ''),
}))

vi.mock('@/lib/email/send', () => ({
  createResendClient: vi.fn(() => ({ send })),
  loadEmailConfig: vi.fn(async () => ({
    apiKey: 're_123',
    fromEmail: 'Mi Pyme <hola@midominio.com>',
    replyTo: null,
  })),
}))

// Item 13: el route persiste en email_sends con service_role. Mock del
// cliente admin para no tocar la DB real en tests.
const insertEmailSend = vi.fn(async (row: Record<string, unknown>) => ({ error: null, data: null }))
vi.mock('@/lib/telnyx/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: insertEmailSend,
    }),
  }),
}))

import { POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'agent'
  contactRow = { name: 'Ana', email: 'ana@acme.com', phone: '+15551234567', company: 'Acme' }
  templateRow = { subject: 'Hola {{name}}', body_html: '<h1>{{name}}</h1>' }
  supabaseMock = makeSupabaseMock()
  send.mockClear()
  insertEmailSend.mockClear()
})

describe('POST /api/email/send', () => {
  it('envía por contactId interpolando el template', async () => {
    const res = await post({ contactId: 'contact-1', template: 'welcome' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, resendMessageId: 'resend-1' })
    expect(send).toHaveBeenCalledTimes(1)
    const [, , input] = send.mock.calls[0] as unknown as [string, string | null, { to: string; subject: string; html: string }]
    expect(input.to).toBe('ana@acme.com')
    expect(input.subject).toBe('Hola Ana')
    expect(input.html).toBe('<h1>Ana</h1>')
    // Item 13: el envío persiste en email_sends (snapshot + contact_id).
    expect(insertEmailSend).toHaveBeenCalledTimes(1)
    expect(insertEmailSend.mock.calls[0][0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      template_name: 'welcome',
      recipient: 'ana@acme.com',
      subject: 'Hola Ana',
      html: '<h1>Ana</h1>',
      status: 'sent',
      resend_message_id: 'resend-1',
    })
  })

  it('404 cuando el contacto no es del account', async () => {
    contactRow = null
    const res = await post({ contactId: 'contact-x', template: 'welcome' })
    expect(res.status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('404 cuando el template no existe', async () => {
    templateRow = null
    const res = await post({ contactId: 'contact-1', template: 'nope' })
    expect(res.status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('400 sin template y 400 sin destinatario', async () => {
    expect((await post({ contactId: 'contact-1' })).status).toBe(400)
    expect((await post({ template: 'welcome' })).status).toBe(400)
    expect((await post({ to: 'x@y.com', template: 'welcome' })).status).toBe(200) // to directo sirve
  })

  it('400 cuando el contacto no tiene email', async () => {
    contactRow = { name: null, email: null, phone: null, company: null }
    const res = await post({ contactId: 'contact-1', template: 'welcome' })
    expect(res.status).toBe(400)
  })
})
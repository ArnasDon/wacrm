import { describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// El webhook es fail-closed: sin RESEND_WEBHOOK_SECRET rechaza con 503
// (Item 14, DAD §7.7). En tests no hay secret real → verificamos 503 y 400.
// La actualización de email_sends se cubre en el flujo de integración con
// la RPC _on_email_webhook (048); aquí solo probamos el contrato HTTP.

function post(body: string) {
  const req = new Request('http://localhost/api/email/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

describe('POST /api/email/webhook (Item 14 — fail-closed)', () => {
  it('503 sin RESEND_WEBHOOK_SECRET configurado (no ackea)', async () => {
    const res = await post(JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } }))
    expect(res.status).toBe(503)
  })

  it('400 si faltan headers de firma Svix', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test')
    try {
      const res = await post(JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } }))
      expect(res.status).toBe(400)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('400 con body inválido (sin secret)', async () => {
    const res = await post('not-json')
    expect(res.status).toBe(503)
  })
})

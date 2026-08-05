import { describe, expect, it, vi } from 'vitest'

import { POST } from './route'

function post(body: string) {
  const req = new Request('http://localhost/api/email/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return POST(req as unknown as Parameters<typeof POST>[0])
}

describe('POST /api/email/webhook (opcional v1)', () => {
  it('ackea eventos de Resend', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await post(JSON.stringify({ type: 'email.delivered', data: { id: 'e1' } }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(log).toHaveBeenCalledWith('[email:webhook] event=email.delivered')
    log.mockRestore()
  })

  it('400 con body inválido', async () => {
    const res = await post('not-json')
    expect(res.status).toBe(400)
  })
})
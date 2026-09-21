import { beforeEach, describe, expect, it, vi } from 'vitest'

// `POST /api/v1/broadcasts` descartava o `channel_id` do corpo, e três lugares
// prometiam que ele valia (docs/public-api.md, docs/mcp.md e a ferramenta
// `send_broadcast` do mcp-server, que o encaminha). Ninguém viu porque a rota
// devolvia 500 em TODA chamada — a função de disparo não executava (migration
// 1030). No dia em que ela passou a funcionar, o defeito ficou alcançável: com
// dois números oficiais a campanha sairia pelo que o núcleo escolhesse.
//
// A rota é do upstream e volta crua num merge — este pino é o que acusa.

const { createBroadcast, deliverBroadcast, depoisDaResposta } = vi.hoisted(() => ({
  createBroadcast: vi.fn(),
  deliverBroadcast: vi.fn(),
  depoisDaResposta: vi.fn(),
}))

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: depoisDaResposta,
}))
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({ supabase: {}, accountId: 'conta-1' })),
}))
vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: vi.fn(async () => 'usuario-de-auditoria'),
  ContactError: class ContactError extends Error {
    status = 400
  },
}))
vi.mock('@/lib/whatsapp/broadcast-core', () => {
  class BroadcastError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message)
    }
  }
  return { createBroadcast, deliverBroadcast, BroadcastError }
})

import { POST } from './route'
import { BroadcastError } from '@/lib/whatsapp/broadcast-core'

const pedido = (corpo: unknown) =>
  new Request('http://localhost/api/v1/broadcasts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify(corpo),
  })

const CORPO = {
  template_name: 'lembrete',
  template_language: 'pt_BR',
  recipients: [{ to: '+5583988745316', params: ['Ana', '10h'] }],
}

beforeEach(() => {
  createBroadcast.mockReset()
  deliverBroadcast.mockReset()
  depoisDaResposta.mockReset()
  createBroadcast.mockResolvedValue({ broadcastId: 'b1', planned: [{}], rejected: 0 })
})

describe('POST /api/v1/broadcasts — o canal pedido chega ao núcleo', () => {
  it('⚠️ `channel_id` do corpo vai para createBroadcast (aparado)', async () => {
    const res = await POST(pedido({ ...CORPO, channel_id: '  canal-oficial-2  ' }))
    expect(res.status).toBe(202)
    expect(createBroadcast).toHaveBeenCalledTimes(1)
    expect(createBroadcast.mock.calls[0][3]).toMatchObject({ channelId: 'canal-oficial-2' })
  })

  it('sem `channel_id` (ou com algo que não é texto) o núcleo recebe null e escolhe sozinho', async () => {
    await POST(pedido(CORPO))
    await POST(pedido({ ...CORPO, channel_id: 42 }))
    await POST(pedido({ ...CORPO, channel_id: '   ' }))
    expect(createBroadcast.mock.calls.map((c) => c[3].channelId)).toEqual([null, null, null])
  })

  it('os parâmetros de cada destinatário seguem como LISTA (é o que a 1030 grava como lista)', async () => {
    await POST(pedido(CORPO))
    expect(createBroadcast.mock.calls[0][3].recipients).toEqual([
      { to: '+5583988745316', params: ['Ana', '10h'] },
    ])
  })

  it('⚠️ canal que o núcleo recusa vira 400 e NADA é enviado', async () => {
    createBroadcast.mockRejectedValueOnce(
      new BroadcastError('meta_channel_required', 'Broadcasts require an official Meta number', 400),
    )
    const res = await POST(pedido({ ...CORPO, channel_id: 'canal-de-outra-conta' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('meta_channel_required')
    // O envio mora no `after()`: recusado o canal, ele nem é agendado.
    expect(depoisDaResposta).not.toHaveBeenCalled()
    expect(deliverBroadcast).not.toHaveBeenCalled()
  })
})

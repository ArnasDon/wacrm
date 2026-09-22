import { beforeEach, describe, expect, it, vi } from 'vitest'

// O que a rota consultou e criou, para os testes afirmarem.
let peekResposta: { data: unknown; error: unknown } = { data: { ok: true }, error: null }
const peekChamadas: unknown[] = []
let criarResposta: { data: unknown; error: unknown } = { data: { user: { id: 'u1' } }, error: null }
const criarChamadas: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (nome: string, args: unknown) => {
      peekChamadas.push({ nome, args })
      return peekResposta
    },
  }),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        createUser: async (args: Record<string, unknown>) => {
          criarChamadas.push(args)
          return criarResposta
        },
      },
    },
  }),
}))

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { hashInviteToken } from '@/lib/auth/invitations'

import { POST } from './route'

const CORPO = { nome: 'Ana Exemplo', email: 'Ana@Exemplo.com', senha: 'segredo1' }

function chamar(token: string, corpo: unknown = CORPO, ip = '10.0.0.1') {
  const req = new Request(`http://localhost/api/invitations/${token}/cadastro`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  })
  return POST(req, { params: Promise.resolve({ token }) })
}

beforeEach(() => {
  __resetRateLimitForTests()
  peekResposta = { data: { ok: true, account_name: 'Acme', role: 'agent' }, error: null }
  criarResposta = { data: { user: { id: 'u1' } }, error: null }
  peekChamadas.length = 0
  criarChamadas.length = 0
})

describe('POST /api/invitations/[token]/cadastro', () => {
  it('convite válido: confere pelo HASH e cria a conta confirmada, com o nome no metadado', async () => {
    const res = await chamar('tok-bom')
    expect(res.status).toBe(201)
    expect(peekChamadas).toEqual([
      { nome: 'peek_invitation', args: { p_token_hash: hashInviteToken('tok-bom') } },
    ])
    expect(criarChamadas).toEqual([
      {
        email: 'ana@exemplo.com',
        password: 'segredo1',
        email_confirm: true,
        user_metadata: { full_name: 'Ana Exemplo' },
      },
    ])
  })

  it.each(['used', 'expired', 'not_found'])('convite %s: 400 e NENHUMA conta criada', async (motivo) => {
    peekResposta = { data: { ok: false, reason: motivo }, error: null }
    const res = await chamar('tok')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ codigo: 'convite_invalido', motivo })
    expect(criarChamadas).toHaveLength(0)
  })

  it('falha ao conferir o convite: 500 e nenhuma conta criada (não é "convite ok")', async () => {
    peekResposta = { data: null, error: { code: 'XX000', message: 'boom' } }
    const res = await chamar('tok')
    expect(res.status).toBe(500)
    expect(criarChamadas).toHaveLength(0)
  })

  it('resposta vazia da conferência também não cria conta', async () => {
    peekResposta = { data: null, error: null }
    const res = await chamar('tok')
    expect(res.status).toBe(400)
    expect(criarChamadas).toHaveLength(0)
  })

  it('corpo inválido: 400 antes de tocar no banco', async () => {
    const res = await chamar('tok', { nome: 'Ana', email: 'x', senha: '1' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ codigo: 'dados_invalidos' })
    expect(peekChamadas).toHaveLength(0)
    expect(criarChamadas).toHaveLength(0)
  })

  it('corpo que não é JSON: 400', async () => {
    const res = await chamar('tok', 'não é json')
    expect(res.status).toBe(400)
  })

  it('e-mail que já tem conta: 409 email_existe', async () => {
    criarResposta = { data: null, error: { code: 'email_exists', status: 422, message: 'x' } }
    const res = await chamar('tok')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ codigo: 'email_existe' })
  })

  it('limite POR CONVITE vale mesmo trocando de IP', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await chamar('tok-vazado', CORPO, `10.0.1.${i}`)).status).toBe(201)
    }
    const sexta = await chamar('tok-vazado', CORPO, '10.0.1.99')
    expect(sexta.status).toBe(429)
    expect(criarChamadas).toHaveLength(5)
  })

  it('limite POR IP vale mesmo trocando de convite', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await chamar(`tok-${i}`, CORPO, '10.0.2.1')).status).toBe(201)
    }
    expect((await chamar('tok-outro', CORPO, '10.0.2.1')).status).toBe(429)
  })
})

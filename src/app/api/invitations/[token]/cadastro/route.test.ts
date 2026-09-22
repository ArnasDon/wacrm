import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------------
// O que a rota consultou, criou, aceitou e desfez — para os testes
// afirmarem cada passo.
// ------------------------------------------------------------------
let peekResposta: { data: unknown; error: unknown }
const peekChamadas: unknown[] = []

let criarResposta: { data: unknown; error: unknown }
const criarChamadas: Array<Record<string, unknown>> = []

let entrarResposta: { data: unknown; error: unknown }
const entrarChamadas: Array<Record<string, unknown>> = []

let aceiteResposta: { data: unknown; error: unknown }
const aceiteChamadas: Array<{ nome: string; args: unknown; autorizacao?: string }> = []

// Estado do perfil DEPOIS do aceite: em qual conta ele está e quem é o dono.
// `leiturasDoPerfil` é uma fila: cada leitura consome a primeira resposta
// (a última se repete), para simular o banco que falha e depois volta.
let leiturasDoPerfil: Array<{ data: unknown; error: unknown }>
let donosDaConta: string[]
let erroAoApagarConta: unknown
let contasApagadas: Array<{ id: string }>
let erroAoApagarUsuario: unknown
const apagadas: Array<{ tabela: string; filtro: [string, unknown] }> = []
const usuariosApagados: string[] = []
const bloqueios: Array<{ id: string; attrs: unknown }> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (nome: string, args: unknown) => {
      peekChamadas.push({ nome, args })
      return peekResposta
    },
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _chave: string, opcoes?: { global?: { headers?: Record<string, string> } }) => ({
    auth: {
      signInWithPassword: async (args: Record<string, unknown>) => {
        entrarChamadas.push(args)
        return entrarResposta
      },
    },
    rpc: async (nome: string, args: unknown) => {
      aceiteChamadas.push({ nome, args, autorizacao: opcoes?.global?.headers?.Authorization })
      return aceiteResposta
    },
  }),
}))

function consulta(tabela: string) {
  const filtros: Array<[string, unknown]> = []
  const api = {
    select: () => api,
    delete: () => ({
      eq: (coluna: string, valor: unknown) => ({
        select: async () => {
          apagadas.push({ tabela, filtro: [coluna, valor] })
          return { data: erroAoApagarConta ? null : contasApagadas, error: erroAoApagarConta }
        },
      }),
    }),
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor])
      return api
    },
    maybeSingle: async () => {
      if (tabela === 'profiles') {
        return leiturasDoPerfil.length > 1 ? leiturasDoPerfil.shift()! : leiturasDoPerfil[0]
      }
      if (tabela === 'accounts') {
        const dono = donosDaConta.length > 1 ? donosDaConta.shift()! : donosDaConta[0]
        return { data: { owner_user_id: dono }, error: null }
      }
      return { data: null, error: null }
    },
  }
  return api
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => consulta(tabela),
    auth: {
      admin: {
        createUser: async (args: Record<string, unknown>) => {
          criarChamadas.push(args)
          return criarResposta
        },
        deleteUser: async (id: string) => {
          usuariosApagados.push(id)
          return { error: erroAoApagarUsuario }
        },
        updateUserById: async (id: string, attrs: unknown) => {
          bloqueios.push({ id, attrs })
          return { error: null }
        },
      },
    },
  }),
}))

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { hashInviteToken } from '@/lib/auth/invitations'

import { POST } from './route'

const CORPO = { nome: 'Ana Exemplo', email: 'Ana@Exemplo.com', senha: 'segredo1' }
const SESSAO = { access_token: 'jwt-da-ana', refresh_token: 'refresh-da-ana' }

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
  criarResposta = { data: { user: { id: 'u-nova' } }, error: null }
  entrarResposta = { data: { session: SESSAO }, error: null }
  aceiteResposta = { data: 'conta-da-equipe', error: null }
  leiturasDoPerfil = [{ data: { account_id: 'conta-avulsa' }, error: null }]
  donosDaConta = ['u-nova']
  erroAoApagarConta = null
  contasApagadas = [{ id: 'conta-avulsa' }]
  erroAoApagarUsuario = null
  for (const l of [peekChamadas, criarChamadas, entrarChamadas, aceiteChamadas, apagadas, usuariosApagados, bloqueios]) {
    l.length = 0
  }
})

describe('POST /api/invitations/[token]/cadastro', () => {
  it('convite válido: cria a conta confirmada, ACEITA o convite como a pessoa e devolve a sessão', async () => {
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
    expect(entrarChamadas).toEqual([{ email: 'ana@exemplo.com', password: 'segredo1' }])
    // O aceite é o MESMO redeem da tela /join, com o JWT da pessoa nova.
    expect(aceiteChamadas).toEqual([
      {
        nome: 'redeem_invitation',
        args: { p_token_hash: hashInviteToken('tok-bom') },
        autorizacao: 'Bearer jwt-da-ana',
      },
    ])
    expect(await res.json()).toEqual({ ok: true, sessao: SESSAO })
    expect(usuariosApagados).toHaveLength(0)
    expect(bloqueios).toHaveLength(0)
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
    expect((await chamar('tok')).status).toBe(500)
    expect(criarChamadas).toHaveLength(0)
  })

  it('resposta vazia da conferência também não cria conta', async () => {
    peekResposta = { data: null, error: null }
    expect((await chamar('tok')).status).toBe(400)
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
    expect((await chamar('tok', 'não é json')).status).toBe(400)
  })

  it('e-mail que já tem conta: 409 email_existe, e nada é aceito nem desfeito', async () => {
    criarResposta = { data: null, error: { code: 'email_exists', status: 422, message: 'x' } }
    const res = await chamar('tok')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ codigo: 'email_existe' })
    expect(aceiteChamadas).toHaveLength(0)
    expect(usuariosApagados).toHaveLength(0)
  })

  it('⚠️ convite usado NO MEIO (redeem 22023): a conta criada é DESFEITA, conta avulsa antes do usuário', async () => {
    aceiteResposta = { data: null, error: { code: '22023', message: 'Invitation already used' } }
    const res = await chamar('tok')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ codigo: 'convite_invalido' })
    expect(apagadas).toEqual([{ tabela: 'accounts', filtro: ['owner_user_id', 'u-nova'] }])
    expect(usuariosApagados).toEqual(['u-nova'])
    expect(bloqueios).toHaveLength(0)
  })

  it('outra falha do aceite: desfaz e responde 500 (a pessoa pode tentar de novo com o mesmo e-mail)', async () => {
    aceiteResposta = { data: null, error: { code: 'XX000', message: 'boom' } }
    const res = await chamar('tok')
    expect(res.status).toBe(500)
    expect(usuariosApagados).toEqual(['u-nova'])
  })

  it('⚠️ erro no aceite mas o perfil JÁ saiu da conta avulsa: o aceite aconteceu — nada é desfeito', async () => {
    aceiteResposta = { data: null, error: { code: 'XX000', message: 'resposta perdida' } }
    leiturasDoPerfil = [{ data: { account_id: 'conta-da-equipe' }, error: null }]
    donosDaConta = ['dono-do-escritorio']
    const res = await chamar('tok')
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, sessao: SESSAO })
    expect(apagadas).toHaveLength(0)
    expect(usuariosApagados).toHaveLength(0)
  })

  it('não conseguir entrar como a conta nova: desfaz e responde 500', async () => {
    entrarResposta = { data: { session: null }, error: { code: 'unexpected_failure' } }
    const res = await chamar('tok')
    expect(res.status).toBe(500)
    expect(aceiteChamadas).toHaveLength(0)
    expect(usuariosApagados).toEqual(['u-nova'])
  })

  it('desfazer que falha BLOQUEIA o usuário em vez de deixá-lo solto com conta própria', async () => {
    aceiteResposta = { data: null, error: { code: '22023', message: 'x' } }
    erroAoApagarConta = { code: '23503', message: 'fk' }
    const res = await chamar('tok')
    expect(res.status).toBe(400)
    expect(usuariosApagados).toHaveLength(0)
    expect(bloqueios).toEqual([{ id: 'u-nova', attrs: { ban_duration: '876000h' } }])
  })

  it('limite POR CONVITE conta TENTATIVAS e vale mesmo trocando de IP', async () => {
    // O convite só é consumido num aceite que dá certo; aqui toda tentativa
    // bate em e-mail repetido, e o link continua válido.
    criarResposta = { data: null, error: { code: 'email_exists', status: 422, message: 'x' } }
    for (let i = 0; i < 5; i++) {
      expect((await chamar('tok-vazado', CORPO, `10.0.1.${i}`)).status).toBe(409)
    }
    expect((await chamar('tok-vazado', CORPO, '10.0.1.99')).status).toBe(429)
    expect(criarChamadas).toHaveLength(5)
  })

  it('⚠️ aceite que falha e banco que não responde: NADA apagado e NADA declarado — 503 aceite_incerto com a sessão', async () => {
    aceiteResposta = { data: null, error: { code: 'PGRST002', message: 'schema cache' } }
    leiturasDoPerfil = [{ data: null, error: { code: 'PGRST002', message: 'x' } }]
    const res = await chamar('tok')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ codigo: 'aceite_incerto', sessao: SESSAO })
    expect(apagadas).toHaveLength(0)
    expect(usuariosApagados).toHaveLength(0)
    expect(bloqueios).toHaveLength(0)
  })

  it('leitura que falha e depois volta: decide pela resposta boa (aqui, aceite aconteceu)', async () => {
    aceiteResposta = { data: null, error: { code: 'XX000', message: 'x' } }
    leiturasDoPerfil = [
      { data: null, error: { code: 'PGRST002', message: 'x' } },
      { data: { account_id: 'conta-da-equipe' }, error: null },
    ]
    donosDaConta = ['dono-do-escritorio']
    const res = await chamar('tok')
    expect(res.status).toBe(201)
    expect(usuariosApagados).toHaveLength(0)
  })

  it('⚠️ redeem EM VOO: o DELETE não acha conta avulsa (o redeem a levou) — o usuário NÃO é apagado', async () => {
    aceiteResposta = { data: null, error: { code: 'XX000', message: 'transporte' } }
    // 1ª leitura (antes de desfazer): ainda na conta avulsa → pendente.
    // 2ª leitura (depois do DELETE vazio): o perfil já foi para a equipe.
    leiturasDoPerfil = [
      { data: { account_id: 'conta-avulsa' }, error: null },
      { data: { account_id: 'conta-da-equipe' }, error: null },
    ]
    contasApagadas = []
    donosDaConta = ['u-nova', 'dono-do-escritorio']
    const res = await chamar('tok')
    expect(apagadas).toEqual([{ tabela: 'accounts', filtro: ['owner_user_id', 'u-nova'] }])
    expect(usuariosApagados).toHaveLength(0)
    expect(res.status).toBe(201)
  })

  it('limite POR IP vale mesmo trocando de convite', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await chamar(`tok-${i}`, CORPO, '10.0.2.1')).status).toBe(201)
    }
    expect((await chamar('tok-outro', CORPO, '10.0.2.1')).status).toBe(429)
  })
})

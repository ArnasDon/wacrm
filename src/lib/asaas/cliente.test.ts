import { describe, expect, it, vi } from 'vitest'

import {
  AsaasError,
  agente,
  MARCA_DE_CHAVE,
  ORIGEM_ASAAS,
  ORIGEM_ASAAS_SANDBOX,
  baseDoAmbiente,
  codigoDoErro,
  criarClienteAsaas,
  doAsaas,
  lerErro,
  semSegredo,
} from './cliente'

const CHAVE = '$aact_prod_000000000000::exemplo'

function resposta(corpo: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('doAsaas', () => {
  it('aceita só o host do ambiente — a chave viaja no cabeçalho', () => {
    expect(doAsaas(`${ORIGEM_ASAAS}/v3/customers`, 'producao')).toBe(true)
    expect(doAsaas(`${ORIGEM_ASAAS_SANDBOX}/v3/customers`, 'sandbox')).toBe(true)
    expect(doAsaas(`${ORIGEM_ASAAS_SANDBOX}/v3/customers`, 'producao')).toBe(false)
    expect(doAsaas('https://api.asaas.com.evil.test/v3/customers', 'producao')).toBe(false)
    expect(doAsaas('não é url', 'producao')).toBe(false)
  })

  it('a base sai do ambiente', () => {
    expect(baseDoAmbiente('producao')).toBe(`${ORIGEM_ASAAS}/v3`)
    expect(baseDoAmbiente('sandbox')).toBe(`${ORIGEM_ASAAS_SANDBOX}/v3`)
  })
})

describe('codigoDoErro', () => {
  it('401 é chave inválida; 403, permissão; 429, limite', () => {
    expect(codigoDoErro(401)).toBe('chave_invalida')
    expect(codigoDoErro(403)).toBe('sem_permissao')
    expect(codigoDoErro(404)).toBe('nao_encontrado')
    expect(codigoDoErro(429)).toBe('limite')
    expect(codigoDoErro(500)).toBe('asaas_error')
  })

  // ⚠️ O engano mais fácil de cometer e o mais difícil de enxergar: chave de
  // sandbox numa base de produção. O Asaas responde 401, e um 401 genérico
  // mandaria o operador trocar de chave em vez de trocar de ambiente.
  it('invalid_environment vence o 401 genérico', () => {
    expect(codigoDoErro(401, 'invalid_environment')).toBe('ambiente_errado')
  })

  // ⚠️ Medido em produção em 14/09/2026: o Asaas bloqueou por cota com 403 e
  // esta frase. Lido como permissão, o cartão mandava mexer na chave.
  const COTA_EM_403 = 'Seu acesso foi temporariamente bloqueado por exceder o limite de requisições. Tente novamente dentro de alguns minutos.'
  it('403 cuja descrição é de BLOQUEIO POR COTA é `limite`, não permissão', () => {
    expect(codigoDoErro(403, null, COTA_EM_403)).toBe('limite')
    expect(codigoDoErro(403, null, COTA_EM_403.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase())).toBe('limite')
    expect(codigoDoErro(403, null, 'Too Many Requests')).toBe('limite')
  })

  it('403 de permissão de verdade continua `sem_permissao`, e a frase não sequestra outro status', () => {
    expect(codigoDoErro(403, 'insufficient_permission', 'sem acesso')).toBe('sem_permissao')
    expect(codigoDoErro(403, null, 'HTTP 403')).toBe('sem_permissao')
    expect(codigoDoErro(403, null, 'A chave de API não possui permissão para esta operação')).toBe('sem_permissao')
    expect(codigoDoErro(401, null, 'limite de requisições')).toBe('chave_invalida')
  })
})

describe('semSegredo', () => {
  it('troca a chave pelo marcador — a mensagem do provedor ECOA o que foi enviado', () => {
    expect(semSegredo(`401: invalid token ${CHAVE}`, CHAVE)).toBe(`401: invalid token ${MARCA_DE_CHAVE}`)
  })

  it('chave curta demais não é substituída (trocaria pedaço de texto comum)', () => {
    expect(semSegredo('abc abc', 'abc')).toBe('abc abc')
  })
})

describe('lerErro', () => {
  it('lê a forma documentada `{ errors: [{ code, description }] }`', () => {
    expect(lerErro({ errors: [{ code: 'insufficient_permission', description: 'sem acesso' }] }, 403)).toEqual({
      codigo: 'insufficient_permission',
      descricao: 'sem acesso',
    })
  })

  // C5 do plano: não está confirmado que TODO 4xx vem nessa forma.
  it('cai no HTTP <status> quando a forma é outra', () => {
    expect(lerErro({ qualquer: 'coisa' }, 500)).toEqual({ codigo: null, descricao: 'HTTP 500' })
    expect(lerErro(null, 502)).toEqual({ codigo: null, descricao: 'HTTP 502' })
  })
})

describe('criarClienteAsaas', () => {
  it('manda a chave no cabeçalho access_token, com User-Agent e SEM corpo', async () => {
    const fetchFn = vi.fn(async () => resposta({ data: [], hasMore: false, totalCount: 0 }))
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await cliente.listar('/customers', { limit: 1 })

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ORIGEM_ASAAS}/v3/customers?limit=1`)
    const headers = init.headers as Record<string, string>
    expect(headers.access_token).toBe(CHAVE)
    expect(headers.Authorization).toBeUndefined()
    // ⚠️ GET com corpo no Asaas é 403.
    expect(init.body).toBeUndefined()
    expect(typeof headers['User-Agent']).toBe('string')
  })

  it('a chave NUNCA vai na URL', async () => {
    const fetchFn = vi.fn(async () => resposta({ data: [], hasMore: false }))
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await cliente.listar('/customers')
    const [url] = fetchFn.mock.calls[0] as unknown as [string]
    expect(url).not.toContain('aact')
    expect(url).not.toContain('access_token=')
  })

  it('erro vira AsaasError com o código, e a mensagem sai sem a chave', async () => {
    const fetchFn = vi.fn(async () =>
      resposta({ errors: [{ code: 'invalid_action', description: `token ${CHAVE} recusado` }] }, { status: 401 }),
    )
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await expect(cliente.listar('/customers')).rejects.toThrow(AsaasError)
    await expect(cliente.listar('/customers')).rejects.toThrow(MARCA_DE_CHAVE)
  })

  it('403 de bloqueio por cota (medido em produção em 14/09/2026) vira `limite`, nas duas formas de corpo; 403 de permissão continua `sem_permissao`', async () => {
    const frase = 'Seu acesso foi temporariamente bloqueado por exceder o limite de requisições. Tente novamente dentro de alguns minutos.'
    const com = (corpo: unknown) => criarClienteAsaas(CHAVE, { fetchFn: (async () => resposta(corpo, { status: 403 })) as unknown as typeof fetch })
    await expect(com({ errors: [{ code: 'x', description: frase }] }).obter('/payments/pay_1')).rejects.toMatchObject({ codigo: 'limite', status: 403 })
    await expect(com({ message: frase }).listar('/customers')).rejects.toMatchObject({ codigo: 'limite', status: 403 })
    await expect(com({ errors: [{ code: 'insufficient_permission', description: 'sem acesso' }] }).obter('/payments/pay_1')).rejects.toMatchObject({ codigo: 'sem_permissao' })
  })

  // ⚠️ Em 14/09/2026 o log do 403 de cota não dizia QUAL pedido o levou — e é
  // isso que separa "a prova de identidade em /customers" de "a listagem de
  // /payments" ao investigar o bloqueio. O caminho vai SEM a query: filtro de
  // busca pode carregar dado do cliente.
  it('a mensagem de erro diz o método e o caminho do pedido, sem a query', async () => {
    const bloqueado = criarClienteAsaas(CHAVE, { fetchFn: (async () => resposta({ errors: [{ description: 'bloqueado' }] }, { status: 403 })) as unknown as typeof fetch })
    const erro = (await bloqueado.listar('/payments', { customer: 'cus_9', status: 'OVERDUE' }).catch((e: unknown) => e)) as Error
    expect(erro.message).toBe('GET /payments → 403: bloqueado')
    const semRede = criarClienteAsaas(CHAVE, {
      fetchFn: (async () => {
        throw new Error('timeout')
      }) as unknown as typeof fetch,
    })
    const erroDeRede = (await semRede.obter('/customers/cus_1').catch((e: unknown) => e)) as Error
    expect(erroDeRede.message).toBe('GET /customers/cus_1: timeout')
  })

  it('404 em `obter` devolve null — que também significa "id de outra conta"', async () => {
    const fetchFn = vi.fn(async () => resposta({ errors: [] }, { status: 404 }))
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await expect(cliente.obter('/payments/pay_1')).resolves.toBeNull()
  })

  it('resposta sem data[] é erro, não lista vazia', async () => {
    const fetchFn = vi.fn(async () => resposta({ totalCount: 3 }))
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await expect(cliente.listar('/customers')).rejects.toThrow(/data/)
  })

  it('listarTudo pagina por offset até hasMore virar false', async () => {
    const paginas = [
      { data: [{ id: 'a' }, { id: 'b' }], hasMore: true },
      { data: [{ id: 'c' }], hasMore: false },
    ]
    const vistas: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      vistas.push(url)
      return resposta(paginas[vistas.length - 1])
    })
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await expect(cliente.listarTudo('/customers', { limit: 2 })).resolves.toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(vistas[0]).toContain('offset=0')
    expect(vistas[1]).toContain('offset=2')
  })

  // ⚠️ Lição do Meta Ads: meia lista vira número errado com cara de número
  // certo. O teto ESTOURA.
  it('listarTudo ESTOURA no teto de páginas, nunca devolve meia lista', async () => {
    const fetchFn = vi.fn(async () => resposta({ data: [{ id: 'x' }], hasMore: true }))
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await expect(cliente.listarTudo('/customers', { limit: 1 }, 3)).rejects.toThrow(/incompleta/)
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('guarda os cabeçalhos RateLimit da última resposta (C14)', async () => {
    const fetchFn = vi.fn(async () =>
      resposta({ data: [], hasMore: false }, { headers: { 'RateLimit-Remaining': '24999', 'RateLimit-Limit': '25000' } }),
    )
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    expect(cliente.cota()).toEqual({})
    await cliente.listar('/customers')
    expect(cliente.cota()).toEqual({ 'ratelimit-remaining': '24999', 'ratelimit-limit': '25000' })
  })

  it('falha de rede vira o código `rede`, sem a chave na mensagem', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED (${CHAVE})`)
    })
    const cliente = criarClienteAsaas(CHAVE, { fetchFn: fetchFn as unknown as typeof fetch })
    await expect(cliente.listar('/customers')).rejects.toMatchObject({ codigo: 'rede' })
    await expect(cliente.listar('/customers')).rejects.toThrow(MARCA_DE_CHAVE)
  })
})

describe('agente', () => {
  // ⚠️ Cabeçalho HTTP não aceita byte fora do ASCII imprimível: o `fetch`
  // LANÇA, em toda chamada, com um erro que não fala de acento nenhum. Cada
  // instalação escreve o nome do produto que quiser em NEXT_PUBLIC_APP_NAME.
  it('tira acento e caractere fora do ASCII do nome do produto', () => {
    expect(agente('Jurídico Ação')).toBe('Juridico Acao')
    expect(agente('CB CRM')).toBe('CB CRM')
    expect(agente('🙂')).toBe('CRM')
    expect(agente('   ')).toBe('CRM')
  })
})

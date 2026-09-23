import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A automação é da CONTA, não de quem a criou (23/09/2026, decisão do
// operador). As rotas do upstream filtravam pelo autor: com um segundo admin,
// abrir, ativar, duplicar e mudar o escopo davam 404, e excluir dizia "ok"
// sem apagar nada. O "banco" aqui APLICA os filtros `eq` de verdade — um
// filtro pelo autor devolve vazio, e um filtro esquecido deixa passar a
// automação de outra conta.
// ============================================================

type Linha = Record<string, unknown>
type Tabela = 'automations' | 'automation_steps'

const h = vi.hoisted(() => ({
  papel: 'admin',
  conta: 'acc-1',
  quem: 'u-ricardo',
  erroDeLeitura: null as { message: string } | null,
  /** Encena a automação apagada ENTRE a leitura e o UPDATE do PATCH. */
  apagarDepoisDaLeitura: false,
  /** Os filtros de cada UPDATE — a conta tem de estar na escrita também. */
  filtrosDasEscritas: [] as [string, unknown][][],
  db: {
    automations: [] as Record<string, unknown>[],
    automation_steps: [] as Record<string, unknown>[],
  },
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: Tabela) => {
      const filtros: [string, unknown][] = []
      let op: 'select' | 'update' | 'delete' | 'insert' = 'select'
      let payload: unknown = null
      let devolve = false
      const casam = () => h.db[tabela].filter((r) => filtros.every(([k, v]) => r[k] === v))
      const b: Record<string, unknown> = {
        select: () => {
          if (op !== 'select') devolve = true
          return b
        },
        eq: (k: string, v: unknown) => {
          filtros.push([k, v])
          return b
        },
        order: () => b,
        update: (p: unknown) => ((op = 'update'), (payload = p), b),
        delete: () => ((op = 'delete'), b),
        insert: (p: unknown) => ((op = 'insert'), (payload = p), b),
        maybeSingle: async () => {
          if (h.erroDeLeitura) return { data: null, error: h.erroDeLeitura }
          const linha = casam()[0] ?? null
          if (linha && h.apagarDepoisDaLeitura) h.db[tabela] = h.db[tabela].filter((x) => x !== linha)
          return { data: linha, error: null }
        },
        single: async () => {
          const linha = { id: 'copia-1', ...(payload as Linha) }
          h.db[tabela].push(linha)
          return { data: linha, error: null }
        },
        then: (f: (v: unknown) => unknown) => {
          let r: unknown = { data: null, error: null }
          if (op === 'delete') {
            const alvo = casam()
            h.db[tabela] = h.db[tabela].filter((x) => !alvo.includes(x))
            r = { data: devolve ? alvo.map((x) => ({ id: x.id })) : null, error: null }
          } else if (op === 'update') {
            h.filtrosDasEscritas.push([...filtros])
            const alvo = casam()
            for (const x of alvo) Object.assign(x, payload as Linha)
            // Com `.select()`, as linhas afetadas — a forma do PostgREST.
            r = { data: devolve ? alvo.map((x) => ({ id: x.id })) : null, error: null }
          } else if (op === 'insert') {
            h.db[tabela].push(...((Array.isArray(payload) ? payload : [payload]) as Linha[]))
          } else {
            r = { data: casam(), error: null }
          }
          return Promise.resolve(r).then(f)
        },
      }
      return b
    },
  }),
}))

// `vi.fn` para o teste cobrar o PISO PEDIDO: o #587 do original (o mesmo
// conserto, aberto lá) escreve `requireRole('agent')` nas três escritas. Este
// mock recusa o `agent` sem olhar o argumento — então só o registro da chamada
// pega um merge que troque o `'admin'` pelo `'agent'`.
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({ accountId: h.conta, userId: h.quem, role: h.papel })),
  requireRole: vi.fn<(min: string) => Promise<Record<string, unknown>>>(async () => {
    if (h.papel !== 'admin' && h.papel !== 'owner') throw new Error('forbidden')
    return { accountId: h.conta, userId: h.quem, role: h.papel }
  }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
}))

vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: async () => [],
  replaceSteps: vi.fn(async () => null),
}))

vi.mock('@/lib/cb-channels/repo', () => ({
  loadAccountChannelsForValidation: async () => [],
}))

import { DELETE, GET, PATCH } from './route'
import { POST as DUPLICAR } from './duplicate/route'
import { getCurrentAccount, requireRole } from '@/lib/auth/account'
import { replaceSteps } from '@/lib/automations/steps-tree'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const corpo = (body: unknown) =>
  new Request('http://x/api/automations/auto-1', { method: 'PATCH', body: JSON.stringify(body) })
const automacao = (id: string) => h.db.automations.find((a) => a.id === id)

beforeEach(() => {
  h.papel = 'admin'
  h.conta = 'acc-1'
  h.quem = 'u-ricardo'
  h.erroDeLeitura = null
  h.apagarDepoisDaLeitura = false
  h.filtrosDasEscritas = []
  h.db.automations = [
    {
      id: 'auto-1',
      account_id: 'acc-1',
      user_id: 'u-leonardo', // criada por OUTRO membro da conta
      name: 'Lembrete de reunião',
      description: null,
      trigger_type: 'manual',
      trigger_config: {},
      channel_ids: null,
      stage_ids: null,
      is_active: false,
      assinatura_personalizada: 'Dra. Isa',
    },
    {
      id: 'auto-2',
      account_id: 'acc-2', // de OUTRA conta, criada pelo mesmo login
      user_id: 'u-ricardo',
      name: 'De outra conta',
      description: null,
      trigger_type: 'manual',
      trigger_config: {},
      channel_ids: null,
      stage_ids: null,
      is_active: false,
      assinatura_personalizada: null,
    },
  ]
  h.db.automation_steps = [
    {
      id: 's-1',
      automation_id: 'auto-1',
      parent_step_id: null,
      branch: null,
      step_type: 'send_message',
      step_config: { text: 'oi' },
      position: 0,
    },
  ]
})

describe('GET /api/automations/[id] — lê pela conta', () => {
  it('o admin abre a automação criada por outro membro da conta', async () => {
    const res = await GET(new Request('http://x'), params('auto-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).automation.id).toBe('auto-1')
  })

  it('qualquer membro lê, como a RLS de SELECT já permite', async () => {
    h.papel = 'agent'
    expect((await GET(new Request('http://x'), params('auto-1'))).status).toBe(200)
  })

  it('automação de OUTRA conta é 404, mesmo criada pelo mesmo login', async () => {
    expect((await GET(new Request('http://x'), params('auto-2'))).status).toBe(404)
  })

  it('erro de leitura é 500, não "não encontrado"', async () => {
    h.erroDeLeitura = { message: 'timeout' }
    expect((await GET(new Request('http://x'), params('auto-1'))).status).toBe(500)
  })
})

describe('PATCH /api/automations/[id] — qualquer admin da conta', () => {
  it('o admin renomeia a automação criada por outro membro', async () => {
    const res = await PATCH(corpo({ name: 'Lembrete · 24h' }), params('auto-1'))
    expect(res.status).toBe(200)
    expect(automacao('auto-1')?.name).toBe('Lembrete · 24h')
  })

  it('automação de outra conta é 404 e fica intacta', async () => {
    const res = await PATCH(corpo({ name: 'invadida' }), params('auto-2'))
    expect(res.status).toBe(404)
    expect(automacao('auto-2')?.name).toBe('De outra conta')
  })

  it('quem não é admin é barrado antes de ler', async () => {
    h.papel = 'agent'
    expect((await PATCH(corpo({ name: 'x' }), params('auto-1'))).status).toBe(403)
    expect(automacao('auto-1')?.name).toBe('Lembrete de reunião')
  })

  it('erro de leitura é 500, não "não encontrado"', async () => {
    h.erroDeLeitura = { message: 'timeout' }
    expect((await PATCH(corpo({ name: 'x' }), params('auto-1'))).status).toBe(500)
  })
})

describe('DELETE /api/automations/[id] — confere o que apagou', () => {
  it('o admin exclui a automação criada por outro membro', async () => {
    const res = await DELETE(new Request('http://x'), params('auto-1'))
    expect(res.status).toBe(200)
    expect(automacao('auto-1')).toBeUndefined()
  })

  it('CRÍTICO: nada apagado é 404, nunca "ok" — a tela dizia "excluída" sobre a automação intacta', async () => {
    const res = await DELETE(new Request('http://x'), params('auto-2'))
    expect(res.status).toBe(404)
    expect(automacao('auto-2')).toBeDefined()
  })
})

describe('POST /api/automations/[id]/duplicate', () => {
  it('o admin duplica a automação de outro membro; a cópia é de quem duplicou, desligada, com a assinatura', async () => {
    const res = await DUPLICAR(new Request('http://x', { method: 'POST' }), params('auto-1'))
    expect(res.status).toBe(201)
    const copia = automacao('copia-1')
    expect(copia).toMatchObject({
      account_id: 'acc-1',
      user_id: 'u-ricardo',
      is_active: false,
      assinatura_personalizada: 'Dra. Isa',
    })
    const passos = h.db.automation_steps.filter((s) => s.automation_id === 'copia-1')
    expect(passos).toHaveLength(1)
    expect(passos[0].id).not.toBe('s-1')
  })

  it('automação de outra conta é 404 e nenhuma cópia nasce', async () => {
    const res = await DUPLICAR(new Request('http://x', { method: 'POST' }), params('auto-2'))
    expect(res.status).toBe(404)
    expect(automacao('copia-1')).toBeUndefined()
  })
})

// ------------------------------------------------------------
// O que a Fase 1b do plano do upstream (#587) acrescentou por cima.
// ------------------------------------------------------------
describe('upstream #587 — o piso nosso e a escrita pela conta', () => {
  it('escrever pede `admin` (o original pede `agent`); ler é por getCurrentAccount', async () => {
    await GET(new Request('http://x/'), params('auto-1'))
    expect(getCurrentAccount).toHaveBeenCalledTimes(1)
    expect(requireRole).not.toHaveBeenCalled()

    await PATCH(corpo({ name: 'x' }), params('auto-1'))
    await DUPLICAR(new Request('http://x/', { method: 'POST' }), params('auto-1'))
    await DELETE(new Request('http://x/'), params('auto-1'))
    expect(vi.mocked(requireRole).mock.calls).toEqual([['admin'], ['admin'], ['admin']])
  })

  it('PATCH só com os passos, em automação de OUTRA conta: 404 sem trocar passo nenhum', async () => {
    // Aqui o UPDATE da linha nem roda — quem barra é a leitura por conta.
    const res = await PATCH(corpo({ steps: [] }), params('auto-2'))
    expect(res.status).toBe(404)
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('o UPDATE do PATCH leva a conta', async () => {
    await PATCH(corpo({ name: 'renomeada' }), params('auto-1'))
    expect(h.filtrosDasEscritas).toEqual([[['id', 'auto-1'], ['account_id', 'acc-1']]])
  })

  it('apagada entre a leitura e o UPDATE: 404, e os passos não são regravados', async () => {
    h.apagarDepoisDaLeitura = true
    const res = await PATCH(corpo({ name: 'x', steps: [] }), params('auto-1'))
    expect(res.status).toBe(404)
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('PATCH SÓ com os passos também toca a linha: apagada no meio, 404 (Codex, PR #261)', async () => {
    h.apagarDepoisDaLeitura = true
    const res = await PATCH(corpo({ steps: [] }), params('auto-1'))
    expect(res.status).toBe(404)
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('PATCH só com os passos, automação de pé: toca a linha pela conta e troca os passos', async () => {
    const res = await PATCH(corpo({ steps: [] }), params('auto-1'))
    expect(res.status).toBe(200)
    expect(h.filtrosDasEscritas).toEqual([[['id', 'auto-1'], ['account_id', 'acc-1']]])
    expect(replaceSteps).toHaveBeenCalledTimes(1)
  })
})

// Um merge do upstream traz o filtro pelo autor de volta sem conflito nenhum.
describe('pino: nenhuma rota de automação filtra pelo AUTOR', () => {
  for (const arquivo of ['route.ts', 'duplicate/route.ts']) {
    it(arquivo, () => {
      const fonte = readFileSync(join(process.cwd(), 'src/app/api/automations/[id]', arquivo), 'utf8')
      expect(fonte).not.toMatch(/\.eq\(\s*['"]user_id['"]/)
      expect(fonte).not.toMatch(/user_id\s*[!=]==/)
    })
  }
})

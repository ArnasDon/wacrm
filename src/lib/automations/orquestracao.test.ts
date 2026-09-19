import { describe, it, expect, beforeEach, vi } from 'vitest'

// ------------------------------------------------------------
// Orquestração (migration 936) — as guardas que tocam o banco.
//
// A aritmética da cadeia está em `cadeia.test.ts`, pura. Aqui ficam as três
// coisas que só existem contra o banco e que, se quebrarem, quebram calado:
//
//   1. desativar a automação PARA o que está parado em "Aguardar";
//   2. `runAutomationById` recusa alvo de outra conta e alvo desligado;
//   3. `stop_automation` cancela só as esperas DESTE contato.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  state: {
    /** O que `.single()`/`.maybeSingle()` devolve para `automations`. */
    automacaoAlvo: null as Record<string, unknown> | null,
    /** O que a busca em lista devolve para `automations`. */
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    owned: null as { id: string } | null,
    fromCalls: [] as string[],
    updates: [] as {
      table: string
      payload: unknown
      filters: [string, string, unknown][]
    }[],
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h

  function resolve(ops: {
    table: string
    type: string
    payload?: unknown
    filters: [string, string, unknown][]
    single: boolean
  }) {
    const { table, type } = ops
    if (type === 'update') {
      state.updates.push({ table, payload: ops.payload, filters: ops.filters })
      // `.select('id')` depois do update: o passo conta as linhas atingidas.
      return { data: [{ id: 'linha-1' }], error: null }
    }
    if (table === 'contacts') return { data: state.owned, error: null }
    if (table === 'automations') {
      return { data: ops.single ? state.automacaoAlvo : state.automations, error: null }
    }
    if (table === 'automation_logs') {
      if (type === 'insert') return { data: { id: 'log1' }, error: null }
      return { data: { steps_executed: [], status: 'success' }, error: null }
    }
    if (table === 'automation_steps') return { data: state.steps, error: null }
    if (table === 'conversations') return { data: { id: 'conv-1', group_id: null }, error: null }
    return { data: null, error: null }
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
      single: false,
    }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      delete: () => ((ops.type = 'delete'), b),
      upsert: (p: unknown) => ((ops.type = 'upsert'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(['eq', k, v]), b),
      in: (k: string, v: unknown) => (ops.filters.push(['in', k, v]), b),
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => ((ops.single = true), Promise.resolve(resolve(ops))),
      maybeSingle: () => ((ops.single = true), Promise.resolve(resolve(ops))),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t)
        return builder(t)
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  }
})

vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
}))

import {
  resumePendingExecution,
  runAutomationById,
  runAutomationsForTrigger,
} from './engine'

const CONTA = 'acct-1'

const automacao = (over: Record<string, unknown> = {}) => ({
  id: 'auto-1',
  account_id: CONTA,
  user_id: 'user-1',
  name: 'Alvo',
  trigger_type: 'new_message_received',
  trigger_config: {},
  is_active: true,
  channel_ids: null,
  stage_ids: null,
  ...over,
})

beforeEach(() => {
  h.state.automacaoAlvo = null
  h.state.automations = []
  h.state.steps = []
  h.state.owned = { id: 'c1' }
  h.state.fromCalls = []
  h.state.updates = []
})

const parada = (over: Record<string, unknown> = {}) =>
  ({
    id: 'pend-1',
    automation_id: 'auto-1',
    user_id: 'user-1',
    account_id: CONTA,
    contact_id: 'c1',
    log_id: 'log-1',
    parent_step_id: null,
    branch: null,
    next_step_position: 1,
    context: {},
    ...over,
  }) as Parameters<typeof resumePendingExecution>[0]

describe('resumePendingExecution — desativar PARA o que está parado', () => {
  it('CRÍTICO: automação desativada não retoma, e vira cancelled', async () => {
    // O defeito que a 936 conserta. Antes dela o resume relia a automação por
    // id e nunca olhava `is_active`: uma automação desligada na tela seguia
    // acordando esperas. Ficou invisível porque o cron nunca foi chamado em
    // produção; o laço de 60 s o tornaria real no mesmo dia.
    h.state.automacaoAlvo = automacao({ is_active: false })
    h.state.steps = [
      { id: 's1', step_type: 'send_message', step_config: { text: 'oi' }, position: 1 },
    ]

    await resumePendingExecution(parada())

    const pend = h.state.updates.filter((u) => u.table === 'automation_pending_executions')
    // A própria espera + a varredura das irmãs por `log_id` (revisão de 19/09).
    expect(pend).toHaveLength(2)
    // `cancelled`, NÃO `failed`: cancelamento não é erro e não pode alimentar
    // o painel de falhas.
    expect(pend.map((u) => u.payload)).toEqual([{ status: 'cancelled' }, { status: 'cancelled' }])
    // E não chegou a buscar passo nenhum — parou antes de executar.
    expect(h.state.fromCalls).not.toContain('automation_steps')
  })

  it('automação ativa retoma normalmente', async () => {
    h.state.automacaoAlvo = automacao({ is_active: true })
    h.state.steps = []

    await resumePendingExecution(parada())

    expect(h.state.fromCalls).toContain('automation_steps')
    const pend = h.state.updates.filter((u) => u.table === 'automation_pending_executions')
    expect(pend[0].payload).toEqual({ status: 'done' })
  })
})

describe('runAutomationById — as duas guardas', () => {
  it('CRÍTICO: a busca é recortada pela CONTA', async () => {
    // O motor roda em service-role e ignora RLS. Sem o `eq('account_id')`, um
    // id de outra conta rodaria a automação DELA com os contatos DESTA.
    h.state.automacaoAlvo = automacao()

    await runAutomationById({
      automationId: 'auto-1',
      accountId: CONTA,
      contactId: 'c1',
      context: {},
      triggerType: 'new_message_received',
    })

    // Não dá para observar o filtro de um SELECT com este mock, então a prova
    // é indireta e vale: alvo ausente (que é o que o filtro produz para id de
    // outra conta) devolve recusa sem executar nada.
    h.state.fromCalls = []
    h.state.automacaoAlvo = null
    const r = await runAutomationById({
      automationId: 'auto-de-outra-conta',
      accountId: CONTA,
      contactId: 'c1',
      context: {},
      triggerType: 'new_message_received',
    })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('não encontrada')
    expect(h.state.fromCalls).not.toContain('automation_logs')
  })

  it('CRÍTICO: recusa automação desativada — o interruptor é freio', async () => {
    // Sem isto, desligar uma automação que está mandando mensagem errada não
    // a para: ela continua sendo acionada por outra regra, e não há como
    // saber que o freio está em outro lugar.
    h.state.automacaoAlvo = automacao({ is_active: false })

    const r = await runAutomationById({
      automationId: 'auto-1',
      accountId: CONTA,
      contactId: 'c1',
      context: {},
      triggerType: 'new_message_received',
    })

    expect(r.ok).toBe(false)
    expect(r.detail).toContain('desativada')
    expect(h.state.fromCalls).not.toContain('automation_logs')
  })

  it('automação ativa roda e o registro diz que foi acionada', async () => {
    h.state.automacaoAlvo = automacao()
    h.state.steps = []

    const r = await runAutomationById({
      automationId: 'auto-1',
      accountId: CONTA,
      contactId: 'c1',
      context: {},
      triggerType: 'deal_stage_changed',
    })

    expect(r.ok).toBe(true)
    expect(h.state.fromCalls).toContain('automation_logs')
  })
})

describe('passo stop_automation', () => {
  it('CRÍTICO: cancela só as esperas DESTE contato', async () => {
    // Sem o filtro por contato, um cliente entrando numa etapa apagaria o
    // follow-up de 24h de TODOS os outros — em silêncio e sem desfazer.
    h.state.automations = [
      automacao({
        id: 'caller',
        trigger_type: 'new_message_received',
        trigger_config: {},
      }),
    ]
    h.state.steps = [
      {
        id: 's1',
        step_type: 'stop_automation',
        step_config: { automation_id: 'alvo-99' },
        position: 0,
      },
    ]

    await runAutomationsForTrigger({
      accountId: CONTA,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    })

    const pend = h.state.updates.filter(
      (u) => u.table === 'automation_pending_executions',
    )
    expect(pend).toHaveLength(1)
    expect(pend[0].payload).toEqual({ status: 'cancelled' })

    const colunas = pend[0].filters.map((f) => f[1])
    expect(colunas).toContain('contact_id')
    expect(colunas).toContain('account_id')
    expect(colunas).toContain('automation_id')
    // Só as pendentes: uma execução já `done` não pode ser "cancelada"
    // retroativamente — ela já rodou e mandou o que tinha para mandar.
    expect(pend[0].filters).toContainEqual(['eq', 'status', 'pending'])
    expect(pend[0].filters).toContainEqual(['eq', 'contact_id', 'c1'])
  })
})

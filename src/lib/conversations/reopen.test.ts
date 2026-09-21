import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reopenClosedConversation } from './reopen'

/**
 * Regression cover for issue #409's "closed conversation lockout": an
 * inbound message bumped `unread_count` but never touched `status`, so a
 * closed thread accumulated unread customer messages while still reading
 * as resolved and staying out of the inbox's Open filter.
 */

interface Recorded {
  table: string
  payload: Record<string, unknown> | null
  filters: [string, unknown][]
  count?: string
}

/**
 * Chainable stub shaped like the bit of postgrest this touches. `linhas` é o
 * que o BANCO responde ao UPDATE condicional: 1 = a linha estava encerrada e
 * foi reaberta; 0 = não casou o `status = 'closed'`.
 */
function stubClient(error: { message: string } | null = null, linhas = 1) {
  const calls: Recorded[] = []

  const client = {
    from(table: string) {
      const rec: Recorded = { table, payload: null, filters: [] }
      calls.push(rec)
      const builder = {
        update(payload: Record<string, unknown>, opts?: { count?: string }) {
          rec.payload = payload
          rec.count = opts?.count
          return builder
        },
        eq(column: string, value: unknown) {
          rec.filters.push([column, value])
          return builder
        },
        then(onFulfilled: (v: { error: unknown; count: number | null }) => unknown) {
          return Promise.resolve({ error, count: error ? null : linhas }).then(onFulfilled)
        },
      }
      return builder
    },
  }

  return { client: client as unknown as SupabaseClient, calls }
}

describe('reopenClosedConversation', () => {
  it('flips a closed conversation back to open', async () => {
    const { client, calls } = stubClient()

    const reopened = await reopenClosedConversation(client, { id: 'conv-1' })

    expect(reopened).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('conversations')
    expect(calls[0].payload).toMatchObject({ status: 'open' })
    expect(calls[0].payload).toHaveProperty('updated_at')
  })

  it('guards the write on the row still being closed', async () => {
    // O filtro é a ÚNICA pergunta "está encerrada?": duas entregas
    // concorrentes não podem escrever 'open' por cima de quem acabou de
    // encerrar a conversa de novo no meio delas.
    const { client, calls } = stubClient()

    await reopenClosedConversation(client, { id: 'conv-1' })

    expect(calls[0].filters).toEqual([
      ['id', 'conv-1'],
      ['status', 'closed'],
    ])
  })

  it('SEMPRE pergunta ao banco — o status que o chamador leu não conta (Codex, PR #232)', async () => {
    // A corrida: o chamador leu a conversa ABERTA no começo da requisição, um
    // encerramento (botão, automação, lote da 1018) caiu antes de a mensagem
    // ser gravada, e o atalho antigo `status !== 'closed'` pulava a
    // reabertura — a mensagem do cliente ficava escondida da caixa. Agora a
    // função nem recebe o status: o UPDATE condicional roda sempre.
    const { client, calls } = stubClient()
    const lidaAberta = { id: 'conv-1', status: 'open' }

    expect(await reopenClosedConversation(client, lidaAberta)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].filters).toContainEqual(['status', 'closed'])
  })

  it('conversa que o banco diz aberta/pendente: o UPDATE não casa e devolve false', async () => {
    const { client, calls } = stubClient(null, 0)

    expect(await reopenClosedConversation(client, { id: 'conv-1' })).toBe(false)
    expect(calls).toHaveLength(1)
    // `count` pedido ao PostgREST: é ele que separa "reabri" de "já estava aberta".
    expect(calls[0].count).toBe('exact')
  })

  it('swallows a failed update so inbound processing continues', async () => {
    // Throwing here would abort the webhook and make Meta redeliver the
    // message — a worse outcome than a thread that stays closed.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = stubClient({ message: 'permission denied' })

    await expect(
      reopenClosedConversation(client, { id: 'conv-1' }),
    ).resolves.toBe(false)

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('reopenClosedConversation — quem reabre fica responsável (2026-09-02)', () => {
  it('com `assignTo`, reabre E atribui na mesma escrita', async () => {
    const { client, calls } = stubClient()

    await reopenClosedConversation(
      client,
      { id: 'conv-1' },
      { assignTo: 'user-ana' },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toMatchObject({
      status: 'open',
      assigned_agent_id: 'user-ana',
    })
  })

  it.each([null, undefined])(
    'sem quem nomear (%s) reabre SEM responsável — escreve NULL, não deixa como estava',
    async (assignTo) => {
      // Cliente, celular pareado e API por chave: reabrem, mas não há pessoa
      // da equipe a nomear. ⚠️ Conversa encerrada ANTES da regra ainda
      // carrega o responsável velho (encerrar só zerava `status`); deixar a
      // coluna em paz devolveria a conversa à caixa em nome de quem já a
      // tinha dado por resolvida (Codex, PR #106).
      const { client, calls } = stubClient()

      await reopenClosedConversation(
        client,
        { id: 'conv-1' },
        { assignTo },
      )

      expect(calls[0].payload).toMatchObject({ assigned_agent_id: null })
    },
  )

  it('sem `opts` nenhum também zera o responsável (os caminhos do cliente)', async () => {
    const { client, calls } = stubClient()

    await reopenClosedConversation(client, { id: 'conv-1' })

    expect(calls[0].payload).toMatchObject({ status: 'open', assigned_agent_id: null })
  })

  it('conversa aberta não é reatribuída por um envio comum', async () => {
    // A regra é "quem REABRE fica responsável" — mandar mensagem numa conversa
    // já aberta não pode roubar a atribuição de quem está com ela. Desde que o
    // UPDATE roda sempre, quem garante isso é o FILTRO: a atribuição mora na
    // MESMA escrita cercada por `status = 'closed'`, então numa conversa
    // aberta a linha não casa e nada é gravado — nem o responsável.
    const { client, calls } = stubClient(null, 0)

    const reabriu = await reopenClosedConversation(
      client,
      { id: 'conv-1' },
      { assignTo: 'user-ana' },
    )

    expect(reabriu).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toHaveProperty('assigned_agent_id', 'user-ana')
    expect(calls[0].filters).toContainEqual(['status', 'closed'])
    // Uma única escrita: o responsável nunca viaja num UPDATE sem a cerca.
    expect(calls.filter((c) => c.payload && 'assigned_agent_id' in c.payload)).toHaveLength(1)
  })
})

describe('reopenClosedConversation — a marca de espera do cliente (972)', () => {
  // Encerrar APAGA `aguardando_desde` (cb_encerrar_limpa_espera). Com o
  // UPDATE rodando sempre, o encerramento que cai entre gravar a mensagem e
  // reabrir é coberto — mas a conversa voltava SEM o selo "em atraso",
  // porque a marca que o INSERT acendeu já tinha sido apagada.
  it('mensagem do cliente devolve aguardando_desde no MESMO UPDATE cercado', async () => {
    const { client, calls } = stubClient()

    await reopenClosedConversation(
      client,
      { id: 'conv-1' },
      { clienteEsperaDesde: '2026-09-21T14:00:00.000Z' },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toMatchObject({
      status: 'open',
      aguardando_desde: '2026-09-21T14:00:00.000Z',
    })
    expect(calls[0].filters).toContainEqual(['status', 'closed'])
  })

  it('sem ela (celular pareado, envio do CRM) a coluna não é tocada', async () => {
    // Resposta de gente não espera ninguém: o INSERT dela já limpou a marca.
    const { client, calls } = stubClient()

    await reopenClosedConversation(client, { id: 'conv-1' }, { assignTo: 'user-ana' })

    expect(calls[0].payload).not.toHaveProperty('aguardando_desde')
  })
})

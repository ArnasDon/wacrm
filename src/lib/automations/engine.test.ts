import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    // Os campos do contato entram aqui porque a interpolação de
    // `{{contact.*}}` lê a MESMA tabela pela qual o motor confere posse.
    owned: null as {
      id: string;
      name?: string;
      phone?: string;
      email?: string;
      company?: string;
    } | null,
    ownedCustomField: null as { id: string } | null,
    pipeline: null as { id: string } | null,
    stage: null as { id: string } | null,
    dealExistente: null as { id: string; stage_id?: string } | null,
    /** Preenchido, a LEITURA de `deals` devolve este erro (18/09). */
    erroNoNegocio: null as string | null,
    /** Status gravados na fila (`markPending`), na ordem. */
    statusDaFila: [] as unknown[],
    /**
     * A MARCA durável da execução (`automation_logs.interrompida_em`, 1005) —
     * o que a retomada e o estacionamento (`cb_estacionar_espera`) consultam.
     */
    interrompida: false,
    dealSelects: [] as [string, string, unknown][][],
    dealInserts: [] as Record<string, unknown>[],
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as {
      table: string;
      filters: [string, string, unknown][];
      payload?: unknown;
    }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    logInserts: [] as Record<string, unknown>[],
    logUpdates: [] as Record<string, unknown>[],
    /** Filtros de cada update em `automation_logs` — a cerca de não-regressão. */
    updateFiltros: [] as [string, string, unknown][][],
    historicoDoLog: [] as Array<Record<string, unknown>>,
    taskInserts: [] as Record<string, unknown>[],
    /** O que o motor mandou para a fila — o "Aguardar" e a retentativa. */
    esperasEnfileiradas: [] as Record<string, unknown>[],
    /** Preenchido, a fila RECUSA o insert com esta mensagem (18/09). */
    erroNaFila: null as string | null,
    notifInserts: [] as Record<string, unknown>[],
    // Valores de campo personalizado do contato, como o PostgREST os entrega
    // (com a definição embutida) — é por eles que a interpolação de
    // `{{contact.campo.*}}` passa.
    customValues: [] as Record<string, unknown>[],
    // A guarda de `fecharLog` (985) pergunta se sobrou espera VIVA deste log.
    // Vazio = nenhuma, que é o caso da maioria dos testes.
    esperasVivas: [] as Record<string, unknown>[],
    membros: [
      {
        user_id: 'agente-fallback',
        full_name: 'Agente Um',
        email: 'um@cb.test',
      },
    ] as Record<string, unknown>[],
  },
}));

vi.mock('./admin-client', () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
    recorte?: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === 'contacts') {
      if (type === 'update') {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === 'conversations') {
      // O passo assign_conversation escreve aqui, e QUAIS filtros ele usa é
      // justamente o que se quer observar (a conversa do disparo vs. todas as
      // do contato).
      if (type === 'update') {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'profiles') {
      // round_robin resolve um membro da conta por aqui; `create_task` usa a
      // MESMA consulta para provar que o responsável é membro e para carimbar
      // o nome dele na tarefa.
      return { data: state.membros, error: null };
    }
    if (table === 'custom_fields') {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === 'contact_custom_values') {
      if (type === 'upsert') {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: state.customValues, error: null };
    }
    if (table === 'pipelines') return { data: state.pipeline, error: null };
    if (table === 'pipeline_stages') return { data: state.stage, error: null };
    if (table === 'deals') {
      if (type === 'insert') {
        state.dealInserts.push(ops.payload as Record<string, unknown>);
        return {
          data: { id: 'd-novo', ...(ops.payload as Record<string, unknown>) },
          error: null,
        };
      }
      state.dealSelects.push(ops.filters);
      if (state.erroNoNegocio) {
        return { data: null, error: { message: state.erroNoNegocio } };
      }
      return { data: state.dealExistente, error: null };
    }
    if (table === 'automation_pending_executions') {
      if (type === 'insert') {
        // O Supabase DEVOLVE o erro, não lança — é por isso que um insert
        // não conferido falha em silêncio.
        if (state.erroNaFila) {
          return { data: null, error: { message: state.erroNaFila } };
        }
        state.esperasEnfileiradas.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (type === 'update') {
        state.statusDaFila.push((ops.payload as { status?: unknown })?.status);
        return { data: null, error: null };
      }
      if (type === 'select') {
        // ⚠️ Respeita o `.neq('id', …)`: é ele que faz a guarda de `fecharLog`
        // ignorar a espera que o cron está processando AGORA. Sem isto o mock
        // devolveria a própria espera em curso e o pino do resume passaria
        // por um motivo errado.
        const excluido = ops.filters.find(
          ([op, k]) => op === 'neq' && k === 'id'
        )?.[2];
        const vivas = excluido
          ? state.esperasVivas.filter((e) => e.id !== excluido)
          : state.esperasVivas;
        return { data: vivas, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'cb_tasks') {
      if (type === 'insert') {
        state.taskInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: 't-1' }, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'notifications') {
      if (type === 'insert') {
        state.notifInserts.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === 'automations') {
      // ⚠️ Consulta POR ID (o resume e o `run_automation`) espera UM objeto —
      // `.single()`. Devolver a lista fazia `automation.is_active` ser
      // `undefined`, e o resume desistia achando a automação desligada: o
      // pino do desfecho pós-espera reprovava por um motivo que não era o dele.
      const porId = ops.filters.find(
        ([op, k]) => op === 'eq' && k === 'id'
      )?.[2];
      if (porId) {
        return {
          data: state.automations.find((a) => a.id === porId) ?? null,
          error: null,
        };
      }
      return { data: state.automations, error: null };
    }
    if (table === 'automation_logs') {
      if (type === 'insert') {
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: 'log1' }, error: null };
      }
      if (type === 'update') {
        state.logUpdates.push(ops.payload as Record<string, unknown>);
        state.updateFiltros.push([...ops.filters]);
        // Uma linha de volta: a anotação de interrupção grava com cerca
        // ("ninguém acrescentou desde que li") e lê o RETURNING para saber se
        // venceu. Os demais updates ignoram o retorno.
        return { data: [{ id: 'log1' }], error: null };
      }
      // ⚠️ O que já estava GRAVADO em `steps_executed` antes desta chamada.
      // Configurável porque é a única forma de encenar uma execução que
      // atravessou um "Aguardar": a retomada é um processo novo, e o que
      // aconteceu antes da espera só existe nesta coluna.
      return {
        data: {
          steps_executed: state.historicoDoLog,
          status: 'success',
          // A marca da 1005, lida pela retomada.
          interrompida_em: state.interrompida ? '2026-09-18T12:00:00Z' : null,
        },
        error: null,
      };
    }
    if (table === 'automation_steps') {
      // Recorte por ESCOPO (parent_step_id / branch / position), para os
      // testes de ramo e espera: sem ele a consulta do ramo devolvia a lista
      // inteira — inclusive a própria condição, em recursão infinita. Passo
      // sem a coluna (helpers antigos) conta como escopo de fora, posição 0.
      let lista = state.steps;
      for (const [op, k, v] of [...ops.filters, ...(ops.recorte ?? [])]) {
        if (k === 'automation_id') continue;
        if (op === 'is' && v === null)
          lista = lista.filter((s) => s[k] == null);
        else if (op === 'eq') lista = lista.filter((s) => (s[k] ?? null) === v);
        else if (op === 'gte')
          lista = lista.filter(
            (s) => s[k] === undefined || Number(s[k]) >= Number(v)
          );
      }
      return { data: lista, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
      recorte: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      delete: () => ((ops.type = 'delete'), b),
      upsert: (p: unknown) => ((ops.type = 'upsert'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(['eq', k, v]), b),
      // `create_task` pergunta pelos DOIS perfis (autor e responsável) numa
      // consulta só — é ela que prova que o responsável é da conta.
      in: (k: string, v: unknown) => (ops.filters.push(['in', k, v]), b),
      // A guarda de `fecharLog` exclui a espera em curso com `.neq('id', …)`.
      neq: (k: string, v: unknown) => (ops.filters.push(['neq', k, v]), b),
      not: (k: string, o: string, v: unknown) => (
        ops.filters.push([`not.${o}`, k, v]), b
      ),
      // `fecharLog` usa `.or('desfecho.is.null,desfecho.neq.falhou')` para
      // NUNCA REGREDIR um 'falhou' já gravado. O mock só registra: o que os
      // pinos medem é o payload do update, não o filtro do PostgREST.
      or: (expr: string) => (ops.filters.push(['or', 'expr', expr]), b),
      gte: (k: string, v: unknown) => (ops.recorte.push(['gte', k, v]), b),
      is: (k: string, v: unknown) => (ops.recorte.push(['is', k, v]), b),
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      // `cb_estacionar_espera` (1005) é a ÚNICA porta da fila pelo motor:
      // registra o que foi mandado, recusa (null) com a execução marcada e
      // devolve erro quando a fila recusa a linha.
      rpc: (nome: string, args?: Record<string, unknown>) => {
        if (nome === 'cb_estacionar_espera') {
          if (state.erroNaFila) {
            return Promise.resolve({
              data: null,
              error: { message: state.erroNaFila },
            });
          }
          if (state.interrompida) return Promise.resolve({ data: null, error: null });
          state.esperasEnfileiradas.push(args ?? {});
          return Promise.resolve({ data: 'espera-nova', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
});

import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client';

vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
}));

// `send_to_number` (977): a ficha/conversa do número avisado e a conferência
// da conexão são mockadas — o que se testa aqui é o que chega ao sender e a
// regra de falhar FECHADO quando a conexão pedida não resolve.
const destinatarioMock = vi.hoisted(() => ({
  resolverDestinatario: vi.fn(async () => ({
    contactId: 'equipe-1',
    conversationId: 'conv-equipe',
    criouContato: false,
  })),
}));
vi.mock('./destinatario', () => destinatarioMock);
const canalMock = vi.hoisted(() => ({
  resolveEngineChannelPreferring: vi.fn(
    async (
      _db: unknown,
      _acc: string,
      _conv: string,
      preferido: string | null | undefined
    ) => ({
      channelId: preferido ?? 'ch-padrao',
    })
  ),
}));
vi.mock('@/lib/cb-channels/engine-send', () => canalMock);

import {
  dispararAutomacoes,
  resumePendingExecution,
  runAutomationsForTrigger,
  triggerMatches,
} from './engine';
import { engineSendText } from './meta-send';
import type { Automation, KeywordMatchTriggerConfig } from '@/types';
import { diaNoFuso, somarDias } from '@/lib/tasks/prazo';

const ACCOUNT = 'acct-1';

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.pipeline = null;
  h.state.stage = null;
  h.state.dealExistente = null;
  h.state.dealSelects = [];
  h.state.dealInserts = [];
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.logInserts = [];
  h.state.logUpdates = [];
  h.state.updateFiltros = [];
  h.state.historicoDoLog = [];
  h.state.taskInserts = [];
  h.state.notifInserts = [];
  h.state.customValues = [];
  h.state.esperasVivas = [];
  h.state.erroNaFila = null;
  h.state.erroNoNegocio = null;
  h.state.statusDaFila = [];
  h.state.interrompida = false;
  h.state.membros = [
    { user_id: 'agente-fallback', full_name: 'Agente Um', email: 'um@cb.test' },
  ];
});

describe('runAutomationsForTrigger — tenant isolation', () => {
  it('refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)', async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'victim-contact-uuid',
      context: { message_text: 'manual trigger' },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain('contacts');
    expect(h.state.fromCalls).not.toContain('automations');
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it('proceeds past the guard when the contact belongs to the account', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.fromCalls).toContain('automations');
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(['eq', 'id', 'c1']);
    expect(filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
  });
});

describe('automation_logs — status is seeded pessimistically (issue #409)', () => {
  it("writes the log row as 'failed' before any step runs", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // The insert happens before execution, so a run killed mid-flight must
    // not leave behind a row that claims it succeeded.
    expect(h.state.logInserts).toHaveLength(1);
    expect(h.state.logInserts[0]).toMatchObject({
      status: 'failed',
      steps_executed: [],
    });
  });

  it("still promotes the log to 'success' once the steps complete", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // The seed is only a floor — the outermost scope still writes the real
    // verdict, so a completed run reports success as it always did.
    const withStatus = h.state.logUpdates.filter((u) => 'status' in u);
    expect(withStatus.at(-1)).toMatchObject({ status: 'success' });
  });
});

describe('update_contact_field — custom fields', () => {
  it('upserts contact_custom_values when the field is account-owned', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', 'Premium')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: 'c1',
      custom_field_id: 'cf1',
      value: 'Premium',
    });
  });

  it('interpolates {{ vars.* }} into the custom value', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = { id: 'cf1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:cf1', '{{ vars.source }}')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { vars: { source: 'WhatsApp Ad' } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect((h.state.upsertCalls[0].payload as { value: string }).value).toBe(
      'WhatsApp Ad'
    );
  });

  it('refuses to write a custom field from another account', async () => {
    h.state.owned = { id: 'c1' };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('custom:foreign-cf', 'x')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe('update_contact_field — o NOME (999)', () => {
  // Revisão do PR #208: o passo gravava `contacts.name` por chave computada,
  // sem respeitar nem gravar a marca. A automação ativa do Calendly tem este
  // passo com {{vars.agendamento_nome}} — um telefone digitado no campo de nome
  // ia para a ficha e a marca antiga o CONGELAVA.
  it('CRÍTICO: nome de verdade é gravado FIXADO', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('name', '{{ vars.nome }}')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { vars: { nome: '  Douglas   Barbosa ' } },
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const payload = h.state.updateCalls[0].payload as Record<string, unknown>;
    expect(payload.name).toBe('Douglas Barbosa');
    expect(typeof payload.nome_fixado_em).toBe('string');
    expect(h.state.updateCalls[0].filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
  });

  it('CRÍTICO: valor que não é nome (telefone, vazio) NÃO sobrescreve a ficha', async () => {
    for (const valor of ['+55 62 99379-8909', '']) {
      h.state.updateCalls = [];
      h.state.owned = { id: 'c1' };
      h.state.automations = [automationWithUpdateStep()];
      h.state.steps = [customStep('name', '{{ vars.nome }}')];

      await runAutomationsForTrigger({
        accountId: ACCOUNT,
        triggerType: 'new_message_received',
        contactId: 'c1',
        context: { vars: { nome: valor } },
      });

      expect(h.state.updateCalls).toHaveLength(0);
    }
  });

  it('e-mail e empresa seguem sem marca nenhuma', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep('company', 'ACME')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    const payload = h.state.updateCalls[0].payload as Record<string, unknown>;
    expect(payload.company).toBe('ACME');
    expect(payload).not.toHaveProperty('nome_fixado_em');
  });
});

describe('create_deal — um card por contato', () => {
  // O índice único da 911 é PARCIAL (WHERE source = 'channel') e este passo
  // insere com source 'automation' — o banco não barra o duplicado, então a
  // regra é uma checagem explícita no motor, antes do insert.
  function dealStep() {
    return {
      id: 's1',
      automation_id: 'a1',
      step_type: 'create_deal',
      position: 0,
      parent_step_id: null,
      step_config: {
        pipeline_id: 'p1',
        stage_id: 'st1',
        title: 'Novo negócio',
      },
    };
  }

  function executados() {
    return h.state.logUpdates.flatMap(
      (u) =>
        (u.steps_executed as
          { status: string; detail: string }[] | undefined) ?? []
    );
  }

  beforeEach(() => {
    h.state.owned = { id: 'c1' };
    h.state.pipeline = { id: 'p1' };
    h.state.stage = { id: 'st1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [dealStep()];
  });

  it('desiste sem inserir quando o contato já tem card — qualquer funil, qualquer origem', async () => {
    h.state.dealExistente = { id: 'd-antigo' };

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(0);
    // A checagem roda em service-role (ignora RLS) — o escopo de conta é o filtro.
    expect(h.state.dealSelects[0]).toContainEqual([
      'eq',
      'account_id',
      ACCOUNT,
    ]);
    expect(h.state.dealSelects[0]).toContainEqual(['eq', 'contact_id', 'c1']);
    // Não é falha do passo: é a regra funcionando, com o log que a documenta.
    expect(executados()).toContainEqual(
      expect.objectContaining({
        status: 'success',
        detail: 'deal already existed',
      })
    );
  });

  it("cria o card com source 'automation' quando o contato não tem nenhum", async () => {
    h.state.dealExistente = null;

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(1);
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: ACCOUNT,
      contact_id: 'c1',
      pipeline_id: 'p1',
      stage_id: 'st1',
      source: 'automation',
    });
    expect(executados()).toContainEqual(
      expect.objectContaining({ status: 'success', detail: 'deal created' })
    );
  });
});

describe('send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)', () => {
  it('refuses a private / link-local destination and never calls fetch', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep('http://169.254.169.254/latest/meta-data/')];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain('automation_steps');
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'send_webhook',
    position: 0,
    parent_step_id: null,
    step_config: {
      url,
      headers: { 'Metadata-Flavor': 'Google' },
      body_template: '{}',
    },
  };
}

// ------------------------------------------------------------
// Canal de SAÍDA por passo — a precedência que o seletor "Enviar por" promete.
//
// stepChannel é privado, então o teste passa pelo motor de verdade e observa o
// que chega ao sender. Nenhuma conta tem 2 conexões hoje, então esta é a única
// forma de provar a regra.
// ------------------------------------------------------------

function sendStep(step_config: Record<string, unknown>) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'send_message',
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

async function dispararEnvio(
  step_config: Record<string, unknown>,
  context: Record<string, unknown>
) {
  h.state.owned = { id: 'c1' };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [sendStep(step_config)];
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    // conversation_id no contexto evita a busca de conversa em `resolveConversationId`.
    context: { conversation_id: 'conv1', ...context },
  });
  const chamadas = vi.mocked(engineSendText).mock.calls;
  return chamadas[0]?.[0];
}

describe('send_message — canal de saída por passo', () => {
  beforeEach(() => vi.mocked(engineSendText).mockClear());

  it('CRÍTICO: o canal do PASSO vence o canal do disparo', async () => {
    // "o cliente escreveu no pessoal, mas a confirmação sai pelo oficial".
    const args = await dispararEnvio(
      { text: 'oi', channel_id: 'ch-oficial' },
      { channel_id: 'ch-pessoal' }
    );
    expect(args?.preferredChannelId).toBe('ch-oficial');
  });

  it('sem canal no passo, herda o canal do DISPARO', async () => {
    // É o que faz o follow-up parado num `wait` de 24h voltar pelo número por
    // onde o cliente escreveu, e não pelo que ele usou no meio-tempo.
    const args = await dispararEnvio(
      { text: 'oi' },
      { channel_id: 'ch-pessoal' }
    );
    expect(args?.preferredChannelId).toBe('ch-pessoal');
  });

  it('sem canal em lugar nenhum, o sender cai na conversa (undefined)', async () => {
    const args = await dispararEnvio({ text: 'oi' }, {});
    expect(args?.preferredChannelId).toBeUndefined();
  });

  it('channel_id nulo no passo (config antiga) não apaga o canal do disparo', async () => {
    // `??` e não `||`: um `null` gravado por config antiga tem de cair para o
    // disparo, não virar "sem canal".
    const args = await dispararEnvio(
      { text: 'oi', channel_id: null },
      { channel_id: 'ch-pessoal' }
    );
    expect(args?.preferredChannelId).toBe('ch-pessoal');
  });
});

// ------------------------------------------------------------
// assign_conversation: a conversa DO DISPARO, não todas as do contato.
//
// O codigo anterior filtrava so por conta+contato, entao um contato com tres
// conversas tinha as tres atribuidas de uma vez — inclusive as de outro
// numero, atropelando o recorte por conexao.
// ------------------------------------------------------------

describe('assign_conversation — alvo', () => {
  const passoAtribuir = {
    id: 's1',
    automation_id: 'a1',
    step_type: 'assign_conversation',
    position: 0,
    parent_step_id: null,
    step_config: { mode: 'specific', agent_id: 'agente-1' },
  };

  it('CRÍTICO: mira a conversa do contexto, não o contato inteiro', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-do-disparo' },
    });

    const conversas = h.state.updateCalls.filter(
      (u) => u.table === 'conversations'
    );
    expect(conversas).toHaveLength(1);
    const colunas = conversas[0].filters.map((f) => f[1]);
    expect(colunas).toContain('id');
    expect(colunas).not.toContain('contact_id');
  });

  it('sem conversa no disparo, cai em todas as do contato (como antes)', async () => {
    // É o caso da etiqueta adicionada na ficha: não há conversa no contexto,
    // e não atribuir nada seria pior que atribuir todas.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    const conversas = h.state.updateCalls.filter(
      (u) => u.table === 'conversations'
    );
    expect(conversas).toHaveLength(1);
    expect(conversas[0].filters.map((f) => f[1])).toContain('contact_id');
  });
});

function automationWithUpdateStep() {
  return {
    id: 'a1',
    account_id: ACCOUNT,
    user_id: 'u1',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'update_contact_field',
    position: 0,
    parent_step_id: null,
    step_config: { field: 'company', value: 'pwned-by-automation' },
  };
}

function customStep(field: string, value: string) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'update_contact_field',
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe('triggerMatches — interactive_reply', () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: 'a1',
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'menu step',
      trigger_type: 'interactive_reply',
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('matches when the tapped id is in reply_ids (exact)', () => {
    expect(
      triggerMatches(automation(['yes', 'no']), { interactive_reply_id: 'yes' })
    ).toBe(true);
  });

  it('does not match a different id', () => {
    expect(
      triggerMatches(automation(['yes']), { interactive_reply_id: 'maybe' })
    ).toBe(false);
  });

  it('does not match on a substring (exact only)', () => {
    expect(
      triggerMatches(automation(['yes']), {
        interactive_reply_id: 'yes_please',
      })
    ).toBe(false);
  });

  it('does not match when no reply id is present or config is empty', () => {
    expect(triggerMatches(automation(['yes']), {})).toBe(false);
    expect(
      triggerMatches(automation([]), { interactive_reply_id: 'yes' })
    ).toBe(false);
  });
});

describe('triggerMatches — tag_added', () => {
  function automation(tagId?: string): Automation {
    return {
      id: 'a1',
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'tag follow-up',
      trigger_type: 'tag_added',
      trigger_config: tagId ? { tag_id: tagId } : {},
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('matches only the exact tag id', () => {
    expect(triggerMatches(automation('tag-a'), { tag_id: 'tag-a' })).toBe(true);
    expect(triggerMatches(automation('tag-a'), { tag_id: 'tag-ab' })).toBe(
      false
    );
  });

  it('fails closed when the config or event tag is missing', () => {
    expect(triggerMatches(automation(), { tag_id: 'tag-a' })).toBe(false);
    expect(triggerMatches(automation('tag-a'), {})).toBe(false);
    expect(triggerMatches(automation('tag-a'), undefined)).toBe(false);
  });
});

describe('triggerMatches — date_field_offset (952)', () => {
  function lembrete(id: string): Automation {
    return {
      id,
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'lembrete',
      trigger_type: 'date_field_offset',
      trigger_config: {
        fonte: 'reuniao',
        offset_hours: 24,
        direction: 'antes',
      },
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('⚠️ roda SÓ a automação carimbada no contexto', () => {
    // O "aconteceu?" deste gatilho é decidido pela varredura, fora do motor.
    // Sem o recorte, o alvo de um lembrete executava TODOS os lembretes da
    // conta — o de 48h saía junto com o de 24h, fora da própria janela.
    expect(triggerMatches(lembrete('a1'), { automation_id: 'a1' })).toBe(true);
    expect(triggerMatches(lembrete('a2'), { automation_id: 'a1' })).toBe(false);
  });

  it('fail closed: sem carimbo no contexto, nada roda', () => {
    // Inclusive o dispatch manual (POST /api/automations/engine) sem
    // automation_id — rodar "todos, agora" ignoraria as datas.
    expect(triggerMatches(lembrete('a1'), {})).toBe(false);
    expect(triggerMatches(lembrete('a1'), undefined)).toBe(false);
  });
});

describe('triggerMatches — a régua do Asaas (998)', () => {
  function regua(id: string, tipo: 'asaas_cobranca_vencida' | 'asaas_cobranca_vence_hoje'): Automation {
    return {
      id,
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'cobrança',
      trigger_type: tipo,
      trigger_config: tipo === 'asaas_cobranca_vencida' ? { dias_de_atraso: 5 } : {},
      is_active: true,
      execution_count: 0,
      created_at: '',
      updated_at: '',
    };
  }

  it('⚠️ roda SÓ a automação carimbada no contexto, nos DOIS gatilhos', () => {
    // O "aconteceu?" é decidido pela varredura; o dispatch por tipo rodaria
    // a de 5 dias junto com a de 1 (a mesma cerca do `date_field_offset`).
    expect(triggerMatches(regua('a1', 'asaas_cobranca_vencida'), { automation_id: 'a1' })).toBe(true);
    expect(triggerMatches(regua('a2', 'asaas_cobranca_vencida'), { automation_id: 'a1' })).toBe(false);
    expect(triggerMatches(regua('l1', 'asaas_cobranca_vence_hoje'), { automation_id: 'l1' })).toBe(true);
    expect(triggerMatches(regua('l2', 'asaas_cobranca_vence_hoje'), { automation_id: 'l1' })).toBe(false);
  });

  it('fail closed: sem carimbo no contexto, nada roda', () => {
    expect(triggerMatches(regua('a1', 'asaas_cobranca_vencida'), {})).toBe(false);
    expect(triggerMatches(regua('a1', 'asaas_cobranca_vencida'), undefined)).toBe(false);
    expect(triggerMatches(regua('l1', 'asaas_cobranca_vence_hoje'), {})).toBe(false);
  });
});

describe('tag_added — conversation policy', () => {
  it('records a clear failed step when the contact has no conversation', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [
      {
        id: 'a1',
        account_id: ACCOUNT,
        user_id: 'u1',
        name: 'tag outreach',
        trigger_type: 'tag_added',
        trigger_config: { tag_id: 'tag-a' },
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's1',
        automation_id: 'a1',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: { text: 'Hello' },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'tag_added',
      contactId: 'c1',
      context: { tag_id: 'tag-a' },
    });

    expect(h.state.logUpdates).toContainEqual(
      expect.objectContaining({
        status: 'failed',
        error_message:
          'tag_added automation cannot send: contact has no existing conversation',
      })
    );
  });
});

describe('triggerMatches — keyword_match', () => {
  function automation(
    cfg: Partial<KeywordMatchTriggerConfig> & { keywords: string[] }
  ): Automation {
    return {
      id: 'a1',
      account_id: ACCOUNT,
      user_id: 'u1',
      name: 'kw',
      trigger_type: 'keyword_match',
      trigger_config: { match_type: 'contains', ...cfg },
      is_active: true,
    } as unknown as Automation;
  }

  const on = (a: Automation, text: string) =>
    triggerMatches(a, { message_text: text });

  it('keeps `contains` as a raw substring test', () => {
    // Issue #409 asked for this to become word-boundary matching. It
    // deliberately did NOT change: existing automations relying on
    // substring behaviour ("cat" firing on "category") must keep working,
    // and `contains` is the builder's default. `word` is the opt-in fix.
    expect(on(automation({ keywords: ['k'] }), 'thanks')).toBe(true);
    expect(on(automation({ keywords: ['cat'] }), 'category')).toBe(true);
  });

  it('`word` matches only standalone words', () => {
    const a = automation({ keywords: ['k'], match_type: 'word' });
    expect(on(a, 'thanks')).toBe(false);
    expect(on(a, 'k')).toBe(true);
    expect(on(a, 'press k to continue')).toBe(true);
    expect(on(a, 'press K!')).toBe(true);
  });

  it('`word` respects punctuation and line edges around the keyword', () => {
    const a = automation({ keywords: ['hi'], match_type: 'word' });
    expect(on(a, 'hi')).toBe(true);
    expect(on(a, 'hi!')).toBe(true);
    expect(on(a, '(hi)')).toBe(true);
    expect(on(a, 'say hi.')).toBe(true);
    expect(on(a, 'this')).toBe(false);
    expect(on(a, 'hiya')).toBe(false);
  });

  it('`word` handles a keyword that itself carries punctuation', () => {
    // `\b` can't do this: /\bhi!\b/ demands a word char after the "!",
    // so it never matches. Hence the lookaround implementation.
    const a = automation({ keywords: ['hi!'], match_type: 'word' });
    expect(on(a, 'say hi!')).toBe(true);
    expect(on(a, 'hi! there')).toBe(true);
  });

  it('`word` treats regex metacharacters in a keyword as literal', () => {
    // Account-supplied free text — an unescaped "(" would throw.
    const a = automation({ keywords: ['c++ (beginner)'], match_type: 'word' });
    expect(on(a, 'I want the c++ (beginner) course')).toBe(true);
    expect(on(a, 'I want the cxx beginner course')).toBe(false);
    expect(() =>
      on(automation({ keywords: ['('], match_type: 'word' }), '(')
    ).not.toThrow();
  });

  it('`word` is case-insensitive unless case_sensitive is set', () => {
    expect(on(automation({ keywords: ['Hi'], match_type: 'word' }), 'hi')).toBe(
      true
    );
    expect(
      on(
        automation({
          keywords: ['Hi'],
          match_type: 'word',
          case_sensitive: true,
        }),
        'hi'
      )
    ).toBe(false);
    expect(
      on(
        automation({
          keywords: ['Hi'],
          match_type: 'word',
          case_sensitive: true,
        }),
        'Hi'
      )
    ).toBe(true);
  });

  it('`word` finds a space-delimited keyword in a non-Latin script', () => {
    // ASCII `\b` fails outright here — every character of "안녕" is a
    // non-word character to it, so /\b안녕\b/ matches nothing.
    const a = automation({ keywords: ['안녕'], match_type: 'word' });
    expect(on(a, '안녕')).toBe(true);
    expect(on(a, '저기 안녕 하세요')).toBe(true);
    // Documented limitation, not an accident: a language written without
    // spaces has no word edge inside a run of characters.
    expect(on(a, '안녕하세요')).toBe(false);
  });

  it('`exact` still requires the whole message to be the keyword', () => {
    const a = automation({ keywords: ['hi'], match_type: 'exact' });
    expect(on(a, 'hi')).toBe(true);
    expect(on(a, 'hi there')).toBe(false);
  });

  it('ignores empty keywords and empty messages in `word` mode', () => {
    expect(
      on(automation({ keywords: [''], match_type: 'word' }), 'anything')
    ).toBe(false);
    expect(on(automation({ keywords: ['hi'], match_type: 'word' }), '')).toBe(
      false
    );
  });
});

// ------------------------------------------------------------
// send_to_number (977): avisa um NÚMERO fixo, não o contato do disparo.
// ------------------------------------------------------------

function passoAvisar(step_config: Record<string, unknown>) {
  return {
    id: 's1',
    automation_id: 'a1',
    step_type: 'send_to_number',
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

async function dispararAviso(
  step_config: Record<string, unknown>,
  context: Record<string, unknown> = {}
) {
  h.state.owned = { id: 'c1' };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [passoAvisar(step_config)];
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: {
      conversation_id: 'conv-cliente',
      channel_id: 'ch-do-cliente',
      ...context,
    },
  });
}

describe('send_to_number — aviso para a equipe', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    destinatarioMock.resolverDestinatario.mockClear();
    canalMock.resolveEngineChannelPreferring.mockClear();
  });

  it('manda para a conversa do NÚMERO avisado, com o texto interpolado, pela conexão do passo', async () => {
    await dispararAviso(
      {
        phone: '(83) 98874-5316',
        contact_name: 'Leonardo',
        text: 'Novo agendamento: {{vars.agendamento_nome}}',
        channel_id: 'ch-comercial',
      },
      { vars: { agendamento_nome: 'Marcelo' } }
    );
    expect(destinatarioMock.resolverDestinatario).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT,
      '5583988745316',
      'Leonardo'
    );
    const args = vi.mocked(engineSendText).mock.calls[0]?.[0];
    expect(args?.conversationId).toBe('conv-equipe');
    expect(args?.contactId).toBe('equipe-1');
    expect(args?.text).toBe('Novo agendamento: Marcelo');
    expect(args?.preferredChannelId).toBe('ch-comercial');
  });

  it('CRÍTICO: sem conexão no passo NÃO herda o canal do disparo (é o número do cliente, não o da equipe)', async () => {
    await dispararAviso({ phone: '5583988745316', text: 'oi' });
    const args = vi.mocked(engineSendText).mock.calls[0]?.[0];
    expect(args?.preferredChannelId).toBeUndefined();
  });

  it('CRÍTICO: conexão pedida que não resolve FALHA, em vez de sair por outro número', async () => {
    canalMock.resolveEngineChannelPreferring.mockResolvedValueOnce({
      channelId: 'ch-padrao',
    });
    await dispararAviso({
      phone: '5583988745316',
      text: 'oi',
      channel_id: 'ch-apagado',
    });
    expect(engineSendText).not.toHaveBeenCalled();
    // ⚠️ O update do STATUS, não o último: desde a 985 `fecharLog` escreve
    // depois dele (o desfecho e, em update próprio, a hora de fim).
    const log = h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string; error_message?: string } | undefined;
    expect(log?.status).toBe('failed');
    expect(log?.error_message).toContain('conexão escolhida');
  });

  it('telefone inválido falha antes de criar ficha', async () => {
    await dispararAviso({ phone: '123', text: 'oi' });
    expect(destinatarioMock.resolverDestinatario).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it('texto vazio depois da interpolação falha antes de enviar', async () => {
    await dispararAviso({ phone: '5583988745316', text: '{{vars.nada}}' });
    expect(engineSendText).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// calendly_booking (977): vazio = qualquer evento; URI = só aquele.
// ------------------------------------------------------------

describe('triggerMatches — calendly_booking', () => {
  const auto = (trigger_config: Record<string, unknown>) =>
    ({
      id: 'a1',
      trigger_type: 'calendly_booking',
      trigger_config,
    }) as unknown as Automation;

  it('config vazia dispara para qualquer evento — inclusive sem URI no contexto', () => {
    expect(
      triggerMatches(auto({}), {
        calendly_event_type: 'https://api.calendly.com/event_types/A',
      })
    ).toBe(true);
    expect(triggerMatches(auto({ event_type_uri: '' }), {})).toBe(true);
    expect(triggerMatches(auto({}), undefined)).toBe(true);
  });

  it('com URI, só o evento igual', () => {
    const a = auto({
      event_type_uri: 'https://api.calendly.com/event_types/A',
    });
    expect(
      triggerMatches(a, {
        calendly_event_type: 'https://api.calendly.com/event_types/A',
      })
    ).toBe(true);
    expect(
      triggerMatches(a, {
        calendly_event_type: 'https://api.calendly.com/event_types/B',
      })
    ).toBe(false);
  });

  it('com URI e disparo sem evento, falha fechado', () => {
    expect(
      triggerMatches(
        auto({ event_type_uri: 'https://api.calendly.com/event_types/A' }),
        {}
      )
    ).toBe(false);
  });
});

// ------------------------------------------------------------
// Variáveis do CONTATO (977): {{contact.*}} e {{conversation.link}}.
// ------------------------------------------------------------

describe('interpolate — variáveis do contato', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.exemplo.com/');
  });

  async function textoEnviado(
    text: string,
    context: Record<string, unknown> = {}
  ) {
    h.state.owned = {
      id: 'c1',
      name: 'Marcelo',
      phone: '5596991126767',
      email: 'm@x.com',
      company: null,
    } as unknown as { id: string };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv1', ...context },
    });
    return vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
  }

  it('lê nome, telefone e e-mail do contato, e o link da conversa do disparo', async () => {
    const texto = await textoEnviado(
      '{{contact.name}} · {{contact.phone}} · {{contact.email}} · {{conversation.link}}'
    );
    expect(texto).toBe(
      'Marcelo · 5596991126767 · m@x.com · https://crm.exemplo.com/inbox?c=conv1'
    );
  });

  it("campo personalizado ausente vira vazio, nunca 'undefined'; empresa nula idem", async () => {
    const texto = await textoEnviado(
      '[{{contact.campo.tamanho_da_divida}}] [{{contact.company}}] [{{contact.nada}}]'
    );
    expect(texto).toBe('[] [] []');
  });

  it('{{contact.origem}} junta campanha - conjunto - anúncio, só as partes preenchidas', async () => {
    // O mock de contact_custom_values devolve null: sem campos, a origem é vazia
    // (nunca " -  - ", que foi o que o primeiro aviso real imprimiu).
    expect(await textoEnviado('[{{contact.origem}}]')).toBe('[]');
  });

  it('link da ficha do contato', async () => {
    expect(await textoEnviado('{{contact.link}}')).toBe(
      'https://crm.exemplo.com/contacts?contact=c1'
    );
  });

  it('texto sem `contact.` NÃO consulta o contato (só a guarda de posse)', async () => {
    h.state.fromCalls = [];
    await textoEnviado('oi {{vars.x}}');
    expect(
      h.state.fromCalls.filter((t) => t === 'contact_custom_values')
    ).toHaveLength(0);
  });

  it('texto com `contact.` consulta o contato UMA vez por execução', async () => {
    h.state.fromCalls = [];
    await textoEnviado(
      '{{contact.name}} e de novo {{contact.name}} e {{contact.campo.x}}'
    );
    expect(
      h.state.fromCalls.filter((t) => t === 'contact_custom_values')
    ).toHaveLength(1);
  });
});

// ------------------------------------------------------------
// Ramo e espera (Codex, PR #128 — 2ª rodada). O que `dispararAutomacoes`
// devolve é o que o evento do Calendly grava: "disparado" tem de significar
// "rodou até o fim, sem falha". O mock de `automation_steps` recorta por
// escopo (lá em cima) justamente para estes testes.
// ------------------------------------------------------------

const condicao = {
  id: 'cond',
  automation_id: 'a1',
  step_type: 'condition',
  position: 0,
  parent_step_id: null,
  step_config: { subject: 'message_content', value: 'oi' },
};
const noRamo = (step: Record<string, unknown>) => ({
  ...step,
  id: `ramo-${String(step.step_type)}`,
  parent_step_id: 'cond',
  branch: 'yes',
  position: 0,
});
const depoisDoRamo = { ...updateStep(), id: 'depois', position: 1 };
const espera = () => ({
  id: 'esp',
  automation_id: 'a1',
  step_type: 'wait',
  position: 0,
  parent_step_id: null,
  step_config: { amount: 1, unit: 'hours' },
});

async function dispararComRamo() {
  h.state.owned = { id: 'c1' };
  h.state.automations = [automationWithUpdateStep()];
  return dispararAutomacoes({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: { message_text: 'oi' },
  });
}
const ultimoStatusDoLog = () =>
  (
    h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string } | undefined
  )?.status;

describe('dispararAutomacoes — o gancho antesDeExecutar', () => {
  // O Calendly fixa o nome da ficha por este gancho: ele só pode rodar quando
  // alguma automação VAI RODAR, e antes dela (Codex, PR #208).
  function disparar(antesDeExecutar: () => Promise<void>, channel_id?: string) {
    h.state.owned = { id: 'c1' };
    return dispararAutomacoes({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { message_text: 'oi', channel_id },
      antesDeExecutar,
    });
  }

  it('CRÍTICO: roda UMA vez, ANTES do primeiro passo, mesmo com várias automações', async () => {
    const ordem: string[] = [];
    h.state.automations = [automationWithUpdateStep(), { ...automationWithUpdateStep(), id: 'a2' }];
    h.state.steps = [updateStep()];
    const gancho = vi.fn(async () => {
      ordem.push('gancho:' + h.state.updateCalls.length);
    });
    const r = await disparar(gancho);
    expect(r.executadas).toBe(2);
    expect(gancho).toHaveBeenCalledTimes(1);
    // Nenhuma escrita de passo tinha acontecido quando o gancho rodou.
    expect(ordem).toEqual(['gancho:0']);
  });

  it('CRÍTICO: todas fora do escopo — o gancho NÃO roda', async () => {
    h.state.automations = [{ ...automationWithUpdateStep(), channel_ids: ['outro-canal'] }];
    h.state.steps = [updateStep()];
    const gancho = vi.fn(async () => {});
    const r = await disparar(gancho, 'este-canal');
    expect(r).toMatchObject({ candidatas: 1, foraDoEscopo: 1, executadas: 0 });
    expect(gancho).not.toHaveBeenCalled();
  });

  it('falha do gancho não segura o disparo', async () => {
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await disparar(async () => {
      throw new Error('ficha fora do ar');
    });
    expect(r.executadas).toBe(1);
    expect(h.state.updateCalls).toHaveLength(1);
    erro.mockRestore();
  });
});

describe('dispararAutomacoes — ramo e espera (Codex, 2ª rodada)', () => {
  it("CRÍTICO: passo que falha DENTRO do ramo derruba a execução: log 'failed', comFalha, e o passo seguinte ao ramo não roda", async () => {
    // "123" não é telefone: `send_to_number` lança antes de tocar em nada.
    h.state.steps = [
      condicao,
      noRamo(passoAvisar({ phone: '123', text: 'oi' })),
      depoisDoRamo,
    ];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 1, emEspera: 0 });
    expect(ultimoStatusDoLog()).toBe('failed');
    // `depois` escreve em contacts; antes ele rodava como se nada tivesse falhado.
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it('ramo que termina bem não muda nada: sucesso, e o passo seguinte ao ramo roda', async () => {
    h.state.steps = [condicao, noRamo(updateStep()), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 0 });
    expect(ultimoStatusDoLog()).toBe('success');
    expect(h.state.updateCalls).toHaveLength(2);
  });

  it("CRÍTICO: 'Aguardar' no escopo de fora é emEspera, não execução sem falha", async () => {
    h.state.steps = [espera(), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 1 });
    expect(ultimoStatusDoLog()).toBe('partial');
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("'Aguardar' DENTRO do ramo também é emEspera — mas o escopo de fora segue e o LOG termina por ele (semântica do upstream)", async () => {
    h.state.steps = [condicao, noRamo(espera()), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 1 });
    expect(h.state.updateCalls).toHaveLength(1);
    expect(ultimoStatusDoLog()).toBe('success');
  });
});

// ------------------------------------------------------------
// Passo "Criar tarefa" — a tarefa que a regra abre para a equipe.
//
// O que estes testes protegem: o prazo é RELATIVO ao dia do ESCRITÓRIO (não do
// contêiner, que roda em UTC), os nomes são carimbados no servidor, o
// responsável é conferido contra a conta, e o aviso SAI mesmo quando o
// responsável é o autor da automação — o contrário da rota da tela, de
// propósito, porque aqui a pessoa escreveu uma regra meses antes.
// ------------------------------------------------------------

function automacaoDeTarefa(cfg: Record<string, unknown>) {
  return {
    automacao: {
      id: 'a-tarefa',
      account_id: ACCOUNT,
      user_id: 'agente-fallback',
      name: 'Contrato fechado',
      trigger_type: 'new_message_received',
      trigger_config: {},
      is_active: true,
    },
    passo: {
      id: 's-tarefa',
      automation_id: 'a-tarefa',
      step_type: 'create_task',
      position: 0,
      parent_step_id: null,
      step_config: cfg,
    },
  };
}

describe('create_task', () => {
  it('abre a tarefa com prazo relativo, nomes carimbados e aviso', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Conferir documentação de {{contact.name}}',
      responsavel_user_id: 'agente-fallback',
      prazo_em_dias: 1,
      hora: '09:00',
      importante: true,
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(1);
    const tarefa = h.state.taskInserts[0];
    expect(tarefa.account_id).toBe(ACCOUNT);
    expect(tarefa.contact_id).toBe('c1');
    expect(tarefa.responsavel_user_id).toBe('agente-fallback');
    // Carimbado do banco, não do config: é o que faz a autoria sobreviver à
    // saída do membro.
    expect(tarefa.responsavel_nome).toBe('Agente Um');
    expect(tarefa.criador_nome).toBe('Agente Um');
    expect(tarefa.vence_as).toBe('09:00:00');
    expect(tarefa.importante).toBe(true);
    expect(tarefa.tipo).toBe('tarefa');
    // Prazo relativo: 1 dia à frente do dia de HOJE no escritório.
    const hoje = diaNoFuso(new Date(), 'America/Sao_Paulo');
    expect(tarefa.vence_em).toBe(somarDias(hoje, 1));

    // Aviso: mesmo com o responsável sendo o autor da automação.
    expect(h.state.notifInserts).toHaveLength(1);
    expect(h.state.notifInserts[0]).toMatchObject({
      user_id: 'agente-fallback',
      type: 'task_assigned',
      task_id: 't-1',
      contact_id: 'c1',
    });
    // Sem conversa, de propósito: quem roteia o clique é `task_id`; com
    // `conversation_id` preenchido a tela levaria ao fio, não à tarefa.
    expect('conversation_id' in h.state.notifInserts[0]).toBe(false);
    expect(String(h.state.notifInserts[0].title)).toContain('Contrato fechado');
  });

  it('interpola o título com os dados do contato', async () => {
    h.state.owned = { id: 'c1', name: 'Joel' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Ligar para {{contact.name}}',
      responsavel_user_id: 'agente-fallback',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts[0].titulo).toBe('Ligar para Joel');
  });

  it('sem prazo escrito, a tarefa é para HOJE', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Assinar',
      responsavel_user_id: 'agente-fallback',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts[0].vence_em).toBe(
      diaNoFuso(new Date(), 'America/Sao_Paulo')
    );
    // Sem hora = o dia inteiro, nunca "00:00".
    expect(h.state.taskInserts[0].vence_as).toBeNull();
  });

  it('recusa responsável que não é membro da conta, sem criar tarefa', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: 'Tarefa para fora',
      responsavel_user_id: 'gente-de-outro-escritorio',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(0);
    expect(h.state.notifInserts).toHaveLength(0);
    // A falha fica no registro, com motivo — é onde o operador vai olhar.
    expect(JSON.stringify(h.state.logUpdates)).toContain('não é membro');
  });

  it('título vazio depois da interpolação não vira tarefa sem nome', async () => {
    h.state.owned = { id: 'c1' };
    const { automacao, passo } = automacaoDeTarefa({
      // A variável não resolve (não há campo), então o título inteiro some.
      titulo: '{{contact.campo.inexistente}}',
      responsavel_user_id: 'agente-fallback',
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(0);
  });
});

describe('interpolação de campo de DATA', () => {
  it('campo datetime sai formatado, nunca o ISO cru', async () => {
    h.state.owned = { id: 'c1' };
    h.state.customValues = [
      {
        value: '2026-08-30T19:00:00.000Z',
        custom_fields: {
          field_key: 'data_e_hora_reuniao',
          field_type: 'datetime',
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: 'a-msg',
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'new_message_received',
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's-msg',
        automation_id: 'a-msg',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: {
          text: 'Sua reunião é {{contact.campo.data_e_hora_reuniao}}.',
        },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(enviado.text).toBe('Sua reunião é 30/08/2026 às 16:00h.');
  });

  it('campo de texto continua saindo como está', async () => {
    h.state.owned = { id: 'c1' };
    h.state.customValues = [
      {
        value: 'https://meet.google.com/abc-defg-hij',
        custom_fields: {
          field_key: 'link_reuniao',
          field_type: 'text',
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: 'a-msg',
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'new_message_received',
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's-msg',
        automation_id: 'a-msg',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: { text: 'Link: {{contact.campo.link_reuniao}}' },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(enviado.text).toBe('Link: https://meet.google.com/abc-defg-hij');
  });

  it('data ilegível no campo cai no valor cru, não em vazio', async () => {
    // A coluna é TEXT livre — pode ter "amanhã de tarde" digitado à mão.
    // Melhor o cliente ler o que a pessoa escreveu do que uma frase truncada.
    h.state.owned = { id: 'c1' };
    h.state.customValues = [
      {
        value: 'amanhã de tarde',
        custom_fields: {
          field_key: 'data_e_hora_reuniao',
          field_type: 'datetime',
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: 'a-msg',
        account_id: ACCOUNT,
        user_id: 'u1',
        trigger_type: 'new_message_received',
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: 's-msg',
        automation_id: 'a-msg',
        step_type: 'send_message',
        position: 0,
        parent_step_id: null,
        step_config: { text: 'Reunião: {{contact.campo.data_e_hora_reuniao}}' },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-1' },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as {
      text: string;
    };
    expect(enviado.text).toBe('Reunião: amanhã de tarde');
  });
});

// ------------------------------------------------------------
// O MESMO campo de data em dois modos (achado do Codex no PR #152).
//
// Em texto para gente, formatado. Onde a saída é DADO — `update_contact_field`
// grava no banco, `send_webhook` fala com um sistema — cru. Trocar isto faz o
// campo copiado ficar ilegível para a tela e, pior, invisível para a varredura
// de lembretes (`cb_para_timestamp` de uma data em português devolve NULL, e o
// lembrete nunca sai).
// ------------------------------------------------------------

function comCampoDeData(passo: Record<string, unknown>) {
  h.state.owned = { id: 'c1' };
  h.state.customValues = [
    {
      value: '2026-08-30T19:00:00.000Z',
      custom_fields: {
        field_key: 'data_e_hora_reuniao',
        field_type: 'datetime',
        account_id: ACCOUNT,
      },
    },
  ];
  h.state.automations = [
    {
      id: 'a-cru',
      account_id: ACCOUNT,
      user_id: 'u1',
      trigger_type: 'new_message_received',
      trigger_config: {},
      is_active: true,
    },
  ];
  h.state.steps = [
    {
      id: 's-cru',
      automation_id: 'a-cru',
      position: 0,
      parent_step_id: null,
      ...passo,
    },
  ];
}

describe('campo de data: formatado na mensagem, CRU no dado', () => {
  it('update_contact_field grava o ISO, não a data em português', async () => {
    comCampoDeData({
      step_type: 'update_contact_field',
      step_config: {
        field: 'company',
        value: '{{contact.campo.data_e_hora_reuniao}}',
      },
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    const escrita = h.state.updateCalls.find((u) => u.table === 'contacts');
    expect(escrita).toBeDefined();
    // O payload do update passa pelo mock como `ops.payload`; aqui basta
    // provar que o valor gravado é o instante, não "30/08/2026 às 16:00h".
    expect(JSON.stringify(h.state.updateCalls)).not.toContain('às 16:00h');
  });

  it('send_webhook manda o ISO no corpo', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) =>
        ({ ok: true, status: 200 }) as unknown as Response
    );
    vi.stubGlobal('fetch', fetchMock);
    comCampoDeData({
      step_type: 'send_webhook',
      step_config: {
        // IP público literal: a guarda decide sem DNS (e sem mock, que
        // quebraria o teste vizinho que prova o BLOQUEIO). O fetch está
        // stubbed, então nada sai da máquina.
        url: 'https://8.8.8.8/hook',
        body_template: '{"quando":"{{contact.campo.data_e_hora_reuniao}}"}',
      },
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    vi.unstubAllGlobals();
    const corpo = String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? '');
    expect(corpo).toContain('2026-08-30T19:00:00.000Z');
    expect(corpo).not.toContain('às 16:00h');
  });
});

// ------------------------------------------------------------
// DESFECHO da execução (migration 985).
//
// O que estes pinos protegem: a execução que uma condição barrou deixa de ser
// registrada como "concluída com sucesso" (era o defeito que motivou a
// feature), sem que `status` mude de vocabulário — as quatro telas que leem
// `status` sem cobertura de tipo continuam vendo os mesmos três valores.
// ------------------------------------------------------------

function automacaoSimples(id = 'a-desf') {
  return {
    id,
    account_id: ACCOUNT,
    user_id: 'u1',
    name: 'Contrato fechado',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
  };
}

/** Condição no escopo raiz. Sem passo com este `parent_step_id`, o ramo é VAZIO. */
function passoCondicao(id: string, position: number) {
  return {
    id,
    automation_id: 'a-desf',
    step_type: 'condition',
    position,
    parent_step_id: null,
    step_config: { subject: 'tag_presence', operand: 'tag-x' },
  };
}

/**
 * Passo que representa TRABALHO FEITO. É `update_contact_field` e não
 * `add_tag` porque o harness mocka a escrita em `contacts`, enquanto `add_tag`
 * exige que a etiqueta exista na conta — o que aqui viraria falha e mediria
 * outra coisa.
 */
function passoDeTrabalho(id: string, position: number) {
  return {
    id,
    automation_id: 'a-desf',
    step_type: 'update_contact_field',
    position,
    parent_step_id: null,
    step_config: { field: 'company', value: 'trabalho feito' },
  };
}

const desfechoGravado = () =>
  h.state.logUpdates.filter((u) => 'desfecho' in u).at(-1) as
    { desfecho?: string; finalizado_em?: string } | undefined;

/**
 * ⚠️ A HORA DE FIM vem em UPDATE PRÓPRIO desde a 2ª rodada da revisão: a cerca
 * anti-regressão recusa a linha inteira quando o log já diz 'falhou', e
 * juntas as duas colunas a falha ficava para sempre sem hora de fim — ou
 * seja, invisível no fio, que exige as duas. Procurar `finalizado_em` dentro
 * do update do desfecho passaria a medir sempre `undefined`.
 */
const horaDeFimGravada = () =>
  (
    h.state.logUpdates.filter((u) => 'finalizado_em' in u).at(-1) as
      { finalizado_em?: string } | undefined
  )?.finalizado_em;

/** Os filtros do update que carregou a hora de fim (para provar que vai SEM cerca). */
const filtrosDaHoraDeFim = () => {
  const i = h.state.logUpdates.findIndex((u) => 'finalizado_em' in u);
  return i < 0 ? null : h.state.updateFiltros[i];
};

const statusGravado = () =>
  (
    h.state.logUpdates.filter((u) => 'status' in u).at(-1) as
      { status?: string } | undefined
  )?.status;

async function dispara() {
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: 'new_message_received',
    contactId: 'c1',
    context: {},
  });
}

describe('retentativa de passo que falhou (13/09/2026)', () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockResolvedValue({ whatsapp_message_id: 'm1' });
    // ⚠️ O acumulador é do harness e atravessa os testes: o "Aguardar" dos
    // blocos anteriores também enfileira, e sem esta linha a contagem daqui
    // mede o que outro teste fez.
    h.state.esperasEnfileiradas = [];
  });

  /** O cenário real: o aviso ao advogado falha e o card fica para trás. */
  async function avisoQueFalha(
    erro: unknown,
    context: Record<string, unknown> = {}
  ) {
    vi.mocked(engineSendText).mockRejectedValueOnce(erro);
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAvisar({ phone: '5583988745316', text: 'oi' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { conversation_id: 'conv-cliente', ...context },
    });
  }

  it('provedor RECUSOU (4xx): volta para a fila NA MESMA POSIÇÃO, e a execução não fecha', async () => {
    await avisoQueFalha(new EvolutionApiError('Error: Connection Closed', 400));

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    const fila = h.state.esperasEnfileiradas[0];
    // ⚠️ A posição do PRÓPRIO passo: é ele que roda de novo. O "Aguardar"
    // enfileira `position + 1` porque já terminou.
    expect(fila.next_step_position).toBe(0);
    // ⚠️ O contador vai AMARRADO À POSIÇÃO: guardar só o número contaria
    // por execução, e o próximo passo a falhar nasceria perto do teto.
    expect((fila.context as Record<string, unknown>)._tentativa).toEqual({
      pos: 0,
      n: 1,
    });
    expect(typeof fila.run_at).toBe('string');
    // Sem desfecho: a execução continua, como no "Aguardar".
    expect(desfechoGravado()?.desfecho).toBeUndefined();
  });

  it('⚠️ entrega INCERTA (5xx) não volta para a fila — a mensagem pode ter saído', async () => {
    await avisoQueFalha(new EvolutionApiError('timeout', 504));

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
  });

  it('⚠️ erro que não é do provedor não volta para a fila — não melhora sozinho', async () => {
    await avisoQueFalha(new Error('contact phone invalid: null'));

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
  });

  it('⚠️ execução JÁ interrompida não volta à fila pela retentativa (Codex, 4ª rodada)', async () => {
    h.state.interrompida = true;
    await avisoQueFalha(new EvolutionApiError('Error: Connection Closed', 400));

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    // Sem desfecho: cancelamento não é erro, e a execução não terminou por
    // conta própria — o mesmo estado da espera não estacionada.
    expect(desfechoGravado()?.desfecho).toBeUndefined();
  });

  it('⚠️ contador de OUTRO passo não consome as chances deste', async () => {
    // O passo 7 falhou duas vezes antes e se recuperou; este é o passo 0.
    await avisoQueFalha(new EvolutionApiError('recusado', 400), {
      _tentativa: { pos: 7, n: 2 },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect(
      (h.state.esperasEnfileiradas[0].context as Record<string, unknown>)
        ._tentativa
    ).toEqual({ pos: 0, n: 1 });
  });

  it('⚠️ no TETO de tentativas desiste e grava a falha, em vez de reenfileirar para sempre', async () => {
    await avisoQueFalha(new EvolutionApiError('recusado de novo', 400), {
      _tentativa: { pos: 0, n: 2 },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(horaDeFimGravada()).toBeTruthy();
  });
});

describe('desfecho da execução (985)', () => {
  it("condição de ramo vazio, sem trabalho: desfecho 'barrada' e status intocado", async () => {
    // É a trava por etiqueta da automação de contrato fechado: o ramo "sim"
    // existe vazio de propósito, para a segunda passada morrer nele.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoCondicao('s-cond', 0)];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('barrada');
    expect(horaDeFimGravada()).toBeTruthy();
    // ⚠️ `status` continua nos três valores do upstream — é o que impede as
    // telas que o leem sem cobertura de tipo de pintar "barrada" de vermelho.
    expect(statusGravado()).toBe('success');
  });

  it("marca a própria condição como 'skipped', para a tela dizer qual desviou", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoCondicao('s-cond', 0)];

    await dispara();

    const passos = h.state.logUpdates
      .flatMap(
        (u) => (u.steps_executed as Array<Record<string, unknown>>) ?? []
      )
      .filter((p) => p.step_type === 'condition');
    expect(passos.at(-1)).toMatchObject({
      step_id: 's-cond',
      status: 'skipped',
    });
  });

  it("barreira DEPOIS de trabalho feito é 'concluida', não 'barrada'", async () => {
    // A etiqueta foi aplicada; chamar a execução de interrompida faria o
    // operador ler "não rodou" sobre algo que rodou.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-tag', 0), passoCondicao('s-cond', 1)];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it('a regra não depende da ORDEM em steps_executed', async () => {
    // `[condição vazia][condição cheia]`: o ramo cheio faz seu próprio flush
    // ANTES do escopo de fora, então uma régua baseada em `at(-1)` acharia a
    // condição errada. Aqui a segunda condição tem um passo no ramo.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [
      passoCondicao('s-vazia', 0),
      passoCondicao('s-cheia', 1),
      {
        id: 's-dentro',
        automation_id: 'a-desf',
        step_type: 'update_contact_field',
        position: 0,
        parent_step_id: 's-cheia',
        // ⚠️ Ramo "no": o contato do harness não tem etiqueta, então
        // `tag_presence` reprova e é este o ramo que o motor escolhe. Pôr o
        // passo no "yes" deixaria os DOIS ramos vazios e o teste mediria
        // 'barrada' — o oposto do que ele existe para provar.
        branch: 'no',
        step_config: { field: 'company', value: 'dentro do ramo' },
      },
    ];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it("passo que falha vira desfecho 'falhou'", async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    // `add_tag` sem tag_id estoura dentro do motor.
    h.state.steps = [
      {
        ...passoDeTrabalho('s-ruim', 0),
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(statusGravado()).toBe('failed');
    // ⚠️ A FALHA TAMBÉM PRECISA DA HORA DE FIM, e sem esta linha o pino não
    // existia: um mutante que gateasse a 2ª escrita em `desfecho !== 'falhou'`
    // passava na suíte inteira (75/75) enquanto deixava toda execução falhada
    // invisível no fio, que exige as duas colunas (medido pela revisão).
    expect(horaDeFimGravada()).toBeTruthy();
  });

  it('CRÍTICO: espera VIVA adia a HORA DE FIM, mas o desfecho é gravado', async () => {
    // ⚠️ A régua mudou depois da revisão adversarial de 09/09: antes a espera
    // viva fazia `fecharLog` DESCARTAR o desfecho — e o 'falhou' de um escopo
    // cujo ramo continuava era perdido, para horas depois o resume daquele
    // ramo gravar 'concluida' por cima. Hoje o desfecho é gravado sempre; o
    // que a espera adia é só `finalizado_em`. Como a régua do fio exige os
    // DOIS, a execução continua não aparecendo como encerrada — sem que o
    // fato se perca.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-tag', 0)];
    h.state.esperasVivas = [{ id: 'espera-1' }];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
    expect(horaDeFimGravada()).toBeUndefined();
  });

  it("CRÍTICO: 'falhou' de um escopo NÃO é apagado pelo ramo que conclui depois", async () => {
    // O cenário que a revisão achou, no nível do que dá para observar aqui:
    // quando o desfecho não é 'falhou', o update sai com a cerca
    // `desfecho.is.null,desfecho.neq.falhou` — é ela que impede a regressão
    // no banco. 'falhou' grava sem cerca, porque é o pior desfecho.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [
      {
        ...passoDeTrabalho('s-ruim', 0),
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ];

    await dispara();

    const semCerca = h.state.updateFiltros.filter((f) =>
      f.some(([op]) => op === 'or')
    );
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(semCerca).toHaveLength(0);
  });
});

describe('desfecho depois de uma ESPERA (achado do teste ponta a ponta)', () => {
  it('CRÍTICO: o resume fecha o log, ignorando a própria espera que está processando', async () => {
    // ⚠️ Este pino nasceu de um defeito MEDIDO no preview em 09/09: a guarda
    // de `fecharLog` enxergava a espera que o cron acabou de reivindicar
    // (`status='running'`, que é ESTA execução), concluía que a automação
    // continuava e nunca fechava. Resultado: toda automação com "Aguardar"
    // terminava sem desfecho e ficava invisível no fio — para sempre.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoDeTrabalho('s-depois', 1), automation_id: 'a-resume' },
    ];
    // A espera em curso está `running` e é a que o resume está processando.
    h.state.esperasVivas = [{ id: 'espera-em-curso' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it('mas uma espera de OUTRO ramo, ainda viva, continua segurando o fechamento', async () => {
    // A exceção é só para a espera em processamento. Outra pendente do mesmo
    // log significa que a automação REALMENTE continua — é o follow-up de 30
    // dias com nove mensagens pela frente.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoDeTrabalho('s-depois', 1), automation_id: 'a-resume' },
    ];
    h.state.esperasVivas = [{ id: 'espera-em-curso' }, { id: 'outra-espera' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    // O desfecho é registrado; a HORA DE FIM é que espera a outra ponta.
    expect(desfechoGravado()?.desfecho).toBe('concluida');
    expect(horaDeFimGravada()).toBeUndefined();
  });
});

// ============================================================
// A 2ª rodada da revisão (Codex, PR #155). Os dois achados são do mesmo
// tronco: o desfecho é decidido por uma CHAMADA, e uma execução com
// "Aguardar" atravessa várias.
// ============================================================
describe('desfecho: os dois furos da 2ª rodada da revisão', () => {
  it('CRÍTICO: a HORA DE FIM vai SEM cerca — senão a falha nunca aparece', async () => {
    // ⚠️ O cenário: um ramo estoura enquanto a espera irmã segue viva, então o
    // log fica 'falhou' e SEM hora de fim. Horas depois a outra ponta termina
    // bem e chama `fecharLog` com 'concluida' — que sai com a cerca
    // `desfecho.is.null,desfecho.neq.falhou`. Com as duas colunas no MESMO
    // update, a cerca recusava a linha inteira e a hora de fim nunca era
    // gravada; como `itensDoFio` descarta linha sem hora de fim, a falha
    // sumia do fio e do histórico — some justamente o cartão vermelho.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [passoDeTrabalho('s-tag', 0)];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
    expect(horaDeFimGravada()).toBeTruthy();
    // O update do desfecho leva a cerca; o da hora de fim, não.
    expect(filtrosDaHoraDeFim()?.some(([op]) => op === 'or')).toBe(false);
    expect(
      h.state.updateFiltros.some((f) => f.some(([op]) => op === 'or'))
    ).toBe(true);
  });

  it("CRÍTICO: trabalho feito ANTES da espera impede o 'barrada' na retomada", async () => {
    // ⚠️ `[enviar][aguardar][condição de ramo vazio]` — a forma do follow-up
    // de no-show. A retomada não faz trabalho e acha a barreira, então os
    // contadores DELA dizem "barrada": "a automação não fez nada", sobre uma
    // execução que já mandou a mensagem. Quem sabe do trecho anterior é o
    // registro persistido.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoCondicao('s-cond', 1), automation_id: 'a-resume' },
    ];
    h.state.historicoDoLog = [
      { step_id: 's-enviou', step_type: 'send_message', status: 'success' },
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];
    h.state.esperasVivas = [{ id: 'espera-em-curso' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it('sem trabalho nenhum no registro, a barreira da retomada CONTINUA valendo', async () => {
    // A cerca de cima não pode virar "nunca mais barra": execução que só
    // esperou e morreu numa trava é `barrada` de verdade.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoCondicao('s-cond', 1), automation_id: 'a-resume' },
    ];
    h.state.historicoDoLog = [
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];
    h.state.esperasVivas = [{ id: 'espera-em-curso' }];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('barrada');
  });
});

// ============================================================
// Os DOIS fechadores irmãos que a 1ª tentativa da correção #2 não alcançou
// (medidos por dois céticos da revisão, que não conseguiram refutar).
//
// ⚠️ Importa mais do que parece: as automações deste escritório põem o
// "Aguardar" DENTRO do ramo da condição — é assim que a trava por etiqueta e o
// "ainda está em No Show?" gateiam de verdade, porque ramo vazio NÃO para o
// escopo de fora. Ou seja, o caminho de ramo é o comum aqui, não a borda.
// ============================================================
describe('desfecho: os fechadores que não têm o histórico em mão', () => {
  it("retomada de RAMO sem trabalho, com barreira no registro, é 'barrada'", async () => {
    h.state.automations = [automacaoSimples('a-resume')];
    // O escopo do ramo não tem mais passo depois da espera.
    h.state.steps = [];
    h.state.historicoDoLog = [
      {
        step_id: 's-cond',
        step_type: 'condition',
        status: 'skipped',
        detail: 'branch=no',
      },
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: 's-pai',
      branch: 'yes',
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('barrada');
  });

  it("retomada de RAMO com trabalho no registro continua 'concluida'", async () => {
    // A correção não pode virar "tudo é barrada": mensagem que saiu antes da
    // espera manda no desfecho.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [];
    h.state.historicoDoLog = [
      { step_id: 's-enviou', step_type: 'send_message', status: 'success' },
      {
        step_id: 's-cond',
        step_type: 'condition',
        status: 'skipped',
        detail: 'branch=no',
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: 's-pai',
      branch: 'yes',
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });

  it("retomada da RAIZ sem passo restante lê o registro em vez de cravar 'concluida'", async () => {
    // Alcançável sem nada de exótico: o motor enfileira `position + 1` sem
    // perguntar se sobrou passo, então "Aguardar" como ÚLTIMO passo cai aqui.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [];
    h.state.historicoDoLog = [
      {
        step_id: 's-cond',
        step_type: 'condition',
        status: 'skipped',
        detail: 'branch=no',
      },
      { step_id: 's-esperou', step_type: 'wait', status: 'success' },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(desfechoGravado()?.desfecho).toBe('barrada');
  });

  it("automação SEM passo nenhum, no disparo fresco, continua 'concluida'", async () => {
    // O outro morador do mesmo ramo: registro vazio, e a resposta de sempre.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [];

    await dispara();

    expect(desfechoGravado()?.desfecho).toBe('concluida');
  });
});

// ============================================================
// "Aguardar — parar se o cliente responder" (18/09/2026).
//
// O motor só tem DUAS responsabilidades aqui, e as duas são sobre a MARCA no
// contexto da fila: escrevê-la (ou limpá-la) a cada estacionamento, e tirá-la
// na retomada. Quem cancela é `parar-se-responder.ts`, na ingestão.
// ============================================================
describe('Aguardar — parar se o cliente responder', () => {
  beforeEach(() => {
    h.state.esperasEnfileiradas = [];
  });

  const esperaMarcada = (config: Record<string, unknown>) => ({
    id: 'esp-1',
    automation_id: 'a-desf',
    step_type: 'wait',
    position: 0,
    parent_step_id: null,
    step_config: { amount: 30, unit: 'hours', ...config },
  });

  const contextoNaFila = () =>
    h.state.esperasEnfileiradas[0]?.context as Record<string, unknown>;

  /**
   * A marca como o agendador a devolve: dentro do JSONB da fila. Entra por
   * espalhamento porque NÃO faz parte de `AutomationContext` — de propósito:
   * ela nunca vive num contexto de execução, só no contexto GRAVADO de uma
   * espera (é o que a retomada garante). Mesmo trato do `_tentativa`.
   */
  const marcaDaEsperaAnterior: Record<string, unknown> = {
    _parar_se_responder: 'esp-1',
  };

  it('marcada: a fila guarda o ID DO PASSO na marca', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({ parar_se_responder: true })];

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    // O id, e não `true`: é o que deixa anotar QUAL espera foi interrompida.
    expect(contextoNaFila()._parar_se_responder).toBe('esp-1');
  });

  it('sem a caixa marcada, nenhuma marca vai para a fila', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({})];

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect('_parar_se_responder' in contextoNaFila()).toBe(false);
  });

  it('⚠️ só o booleano true liga — "true" e 1 chegam de JSONB e são truthy', async () => {
    for (const valor of ['true', 1]) {
      h.state.esperasEnfileiradas = [];
      h.state.owned = { id: 'c1' };
      h.state.automations = [automacaoSimples()];
      h.state.steps = [esperaMarcada({ parar_se_responder: valor })];

      await dispara();

      expect('_parar_se_responder' in contextoNaFila()).toBe(false);
    }
  });

  it('⚠️⚠️ a espera seguinte, NÃO marcada, nasce limpa mesmo com a marca no contexto', async () => {
    // O contexto é copiado de ponta a ponta da execução. Sem a limpeza, a
    // marca da 1ª espera viajaria para a 2ª — que o operador NÃO marcou — e
    // a resposta do cliente pararia a sequência num ponto que ele não
    // escolheu. São DUAS defesas: a retomada limpa (pino abaixo, pela
    // retentativa) e o estacionamento reescreve a decisão — este pino.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      {
        ...esperaMarcada({}),
        id: 'esp-2',
        automation_id: 'a-resume',
        position: 1,
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { conversation_id: 'conv-1', ...marcaDaEsperaAnterior },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    expect('_parar_se_responder' in contextoNaFila()).toBe(false);
    // O resto do contexto atravessa intacto — é o que carrega canal e negócio.
    expect(contextoNaFila().conversation_id).toBe('conv-1');
  });

  it('⚠️⚠️ a RETOMADA tira a marca: a retentativa do passo seguinte não a herda', async () => {
    // A retentativa reenfileira copiando `args.context` cru — ela não passa
    // por `contextoDaEspera`. Se a retomada não limpasse, a marca da espera
    // que JÁ ACABOU iria junto, e uma resposta do cliente nos 30 s da
    // retentativa cancelaria a sequência num ponto que ninguém marcou.
    // (Medido por mutação: sem a limpeza na retomada, só este pino reprova.)
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockRejectedValueOnce(
      new EvolutionApiError('Error: Connection Closed', 400)
    );
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      {
        ...passoAvisar({ phone: '5583988745316', text: 'oi' }),
        automation_id: 'a-resume',
        position: 1,
        parent_step_id: null,
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { conversation_id: 'conv-1', ...marcaDaEsperaAnterior },
    });

    expect(h.state.esperasEnfileiradas).toHaveLength(1);
    // É a retentativa (mesma posição, contador gravado), e sem a marca.
    expect(h.state.esperasEnfileiradas[0].next_step_position).toBe(1);
    expect(contextoNaFila()._tentativa).toEqual({ pos: 1, n: 1 });
    expect('_parar_se_responder' in contextoNaFila()).toBe(false);
    vi.mocked(engineSendText).mockReset();
    vi.mocked(engineSendText).mockResolvedValue({ whatsapp_message_id: 'm1' });
  });

  it('a retomada seguida de OUTRA espera marcada grava a marca da NOVA', async () => {
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      {
        ...esperaMarcada({ parar_se_responder: true }),
        id: 'esp-2',
        automation_id: 'a-resume',
        position: 1,
      },
    ];

    await resumePendingExecution({
      id: 'espera-em-curso',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { ...marcaDaEsperaAnterior },
    });

    expect(contextoNaFila()._parar_se_responder).toBe('esp-2');
  });

  it('⚠️⚠️ execução JÁ interrompida pela resposta: a continuação que acorda depois não roda (Codex, PR #223)', async () => {
    // A espera marcada estava num RAMO; o escopo de fora seguiu e estacionou a
    // SUA espera — sem marca — um instante depois de o cliente responder. O
    // cancelamento das irmãs não a viu (ainda não existia); quem a segura é a
    // retomada, perguntando à fila se a execução já foi interrompida.
    h.state.automations = [automacaoSimples('a-resume')];
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-seguinte', 1), automation_id: 'a-resume' },
    ];
    h.state.interrompida = true;

    await resumePendingExecution({
      id: 'espera-irma',
      automation_id: 'a-resume',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-resume',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: {},
    });

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(h.state.statusDaFila).toEqual(['cancelled']);
  });

  it('⚠️⚠️ execução JÁ interrompida NÃO estaciona espera nova (Codex, 4ª rodada) — sem linha zumbi na aba', async () => {
    // A resposta do cliente cancelou a espera do ramo enquanto o escopo de
    // fora ainda rodava; ao chegar no SEU "Aguardar", ele não pode criar uma
    // linha `pending` que a aba mostraria por dias e a retomada cancelaria.
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({})];
    h.state.interrompida = true;

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(statusGravado()).toBe('partial');
    expect(desfechoGravado()).toBeUndefined();
    const ultimo = h.state.logUpdates
      .filter((u) => 'steps_executed' in u)
      .flatMap((u) => u.steps_executed as { status: string; detail?: string }[])
      .at(-1);
    expect(ultimo).toMatchObject({ status: 'skipped' });
    expect(ultimo?.detail).toMatch(/já foi interrompida/);
  });

  it('⚠️ fila que RECUSA a espera vira falha visível, não "esperando" para sempre', async () => {
    // Até 18/09/2026 este INSERT não era conferido: recusado, o log dizia
    // "waiting…", nada retomava, e a execução ficava `partial` eternamente —
    // fora do fio e fora do bloco de correções do Meu dia.
    h.state.erroNaFila = 'new row violates check constraint';
    h.state.owned = { id: 'c1' };
    h.state.automations = [automacaoSimples()];
    h.state.steps = [esperaMarcada({ parar_se_responder: true })];

    await dispara();

    expect(h.state.esperasEnfileiradas).toHaveLength(0);
    expect(statusGravado()).toBe('failed');
    expect(desfechoGravado()?.desfecho).toBe('falhou');
  });
});


// ============================================================
// Automação PRESA À ETAPA (18/09/2026): a espera que acorda com o card fora
// da etapa não retoma nada. Aqui se prende a ponta da RETOMADA — a garantia;
// o cancelamento imediato no dreno do funil é de `so-na-etapa.test.ts`.
// ============================================================
describe('retomada de automação presa à etapa', () => {
  const NO_SHOW = 'etapa-no-show';

  const recuperacao = (config: Record<string, unknown>) => ({
    ...automacaoSimples('a-noshow'),
    name: 'No-Show Recuperação',
    trigger_type: 'deal_stage_changed',
    trigger_config: { stage_ids: [NO_SHOW], ...config },
  });

  async function acordar() {
    h.state.steps = [
      { ...passoDeTrabalho('s-msg-4', 1), automation_id: 'a-noshow' },
    ];
    await resumePendingExecution({
      id: 'espera-1',
      automation_id: 'a-noshow',
      account_id: ACCOUNT,
      user_id: 'u1',
      contact_id: 'c1',
      log_id: 'log-noshow',
      parent_step_id: null,
      branch: null,
      next_step_position: 1,
      context: { deal_id: 'deal-1', to_stage_id: NO_SHOW },
    });
  }

  const passosGravados = () =>
    h.state.logUpdates
      .filter((u) => 'steps_executed' in u)
      .flatMap((u) => u.steps_executed as { step_id: string; detail?: string; status: string }[]);

  it('⚠️⚠️ o cliente REAGENDOU (card saiu da etapa): nada roda, a espera vira cancelled e o motivo fica escrito', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: 'etapa-reuniao-agendada' };

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(h.state.statusDaFila).toEqual(['cancelled']);
    // A MARCA da 1005 vai para o registro, com o motivo.
    expect(h.state.logUpdates.some((u) => u.interrompida_por === 'etapa')).toBe(true);
    expect(passosGravados().at(-1)).toMatchObject({
      status: 'skipped',
      detail: 'interrompida: o card saiu da etapa desta automação',
    });
    // Cancelamento não é desfecho: o precedente da 936.
    expect(desfechoGravado()).toBeUndefined();
  });

  it('⚠️⚠️ card VOLTOU à etapa, mas a execução já tinha sido interrompida: a espera irmã não a ressuscita (Codex, 3ª rodada)', async () => {
    // A saída cancelou a espera do ramo; a espera de fora, estacionada depois
    // do evento, ficou fora do corte por data. O card reentra (execução NOVA
    // começa) e ela acorda com o card NA etapa — sem o sinal, a execução
    // antiga seguiria ao lado da nova, mandando a sequência em dobro.
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };
    h.state.interrompida = true;

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(h.state.statusDaFila).toEqual(['cancelled']);
  });

  it('card ainda em No Show: a sequência segue', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = { id: 'deal-1', stage_id: NO_SHOW };

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    expect(h.state.statusDaFila).toEqual(['done']);
  });

  it('⚠️ card APAGADO conta como fora da etapa', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.dealExistente = null;

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(h.state.statusDaFila).toEqual(['cancelled']);
  });

  it('⚠️⚠️ automação SEM a opção (gravada antes dela) segue mesmo com o card fora — nada muda retroativamente', async () => {
    h.state.automations = [recuperacao({})];
    h.state.dealExistente = { id: 'deal-1', stage_id: 'etapa-reuniao-agendada' };

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(1);
    expect(h.state.statusDaFila).toEqual(['done']);
  });

  it('⚠️⚠️ não consegui ler a etapa: falha VISÍVEL — nem segue cobrando, nem cancela calada', async () => {
    h.state.automations = [recuperacao({ parar_ao_sair: true })];
    h.state.erroNoNegocio = 'timeout';

    await acordar();

    expect(h.state.updateCalls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(h.state.statusDaFila).toEqual(['failed']);
    expect(statusGravado()).toBe('failed');
    expect(desfechoGravado()?.desfecho).toBe('falhou');
    expect(horaDeFimGravada()).toBeTruthy();
  });
});

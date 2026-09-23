import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CbAutomationEvent } from '@/types';

// A entrega em si (assinatura, SSRF, contador de falhas) é de `deliver.ts` e
// tem teste próprio. Aqui interessa O QUE chega a ela, e quando.
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => {}),
}));

import { dispatchWebhookEvent } from './deliver';
import { entregarEventosDeFunil } from './entregar-eventos-de-funil';

// ============================================================
// Banco falso: filtra DE VERDADE por eq/in/overlaps e pagina por range, para
// o recorte pela conta ser testado, não suposto. Dados FICTÍCIOS.
// ============================================================

type Linha = Record<string, unknown>;

interface Consulta {
  tabela: string;
  select: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  overlaps: [string, unknown[]][];
  range?: [number, number];
}

function bancoFalso(tabelas: Record<string, Linha[]>, falham: string[] = []) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const c: Consulta = { tabela, select: '', eq: [], in: [], overlaps: [] };
    consultas.push(c);
    const resultado = () => {
      if (falham.includes(tabela)) return { data: null, error: { message: `${tabela} caiu` } };
      let linhas = (tabelas[tabela] ?? []).filter(
        (l) =>
          c.eq.every(([k, v]) => l[k] === v) &&
          c.in.every(([k, vs]) => vs.includes(l[k])) &&
          c.overlaps.every(
            ([k, vs]) => Array.isArray(l[k]) && (l[k] as unknown[]).some((x) => vs.includes(x))
          )
      );
      if (c.range) linhas = linhas.slice(c.range[0], c.range[1] + 1);
      return { data: linhas, error: null };
    };
    const b = {
      select: (s: string) => ((c.select = s), b),
      eq: (k: string, v: unknown) => (c.eq.push([k, v]), b),
      in: (k: string, vs: unknown[]) => (c.in.push([k, vs]), b),
      overlaps: (k: string, vs: unknown[]) => (c.overlaps.push([k, vs]), b),
      order: () => b,
      range: (a: number, z: number) => ((c.range = [a, z]), b),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, erro),
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, consultas };
}

const CONTA = '00000000-0000-4000-8000-00000000c0a7';
const OUTRA_CONTA = '00000000-0000-4000-8000-00000000c0a8';
const FUNIL = 'f-comercial';
const LEAD = 'e-lead';
const REUNIAO = 'e-reuniao';
const NEGOCIO = 'd-1';
const CONTATO = 'c-1';

function evento(parcial: Partial<CbAutomationEvent> = {}): CbAutomationEvent {
  return {
    id: 'evt-1',
    account_id: CONTA,
    tipo: 'deal_stage_changed',
    deal_id: NEGOCIO,
    contact_id: CONTATO,
    channel_id: 'conexao-1',
    from_pipeline_id: FUNIL,
    to_pipeline_id: FUNIL,
    from_stage_id: LEAD,
    to_stage_id: REUNIAO,
    from_status: null,
    to_status: null,
    origem: 'usuario',
    cadeia: [],
    criado_em: '2026-09-23T14:05:00.000Z',
    processado_em: '2026-09-23T14:05:01.000Z',
    tentativas: 0,
    erro: null,
    ...parcial,
  };
}

const CRIADO = evento({ id: 'evt-criado', from_pipeline_id: null, from_stage_id: null, to_stage_id: LEAD, criado_em: '2026-09-23T14:00:00.000Z' });
const MOVIDO = evento({ id: 'evt-movido', criado_em: '2026-09-23T14:05:00.000Z' });
const GANHO = evento({
  id: 'evt-ganho',
  tipo: 'deal_status_changed',
  from_pipeline_id: null,
  from_stage_id: null,
  from_status: 'open',
  to_status: 'won',
  criado_em: '2026-09-23T14:10:00.000Z',
});

function tabelas(parcial: Record<string, Linha[]> = {}): Record<string, Linha[]> {
  return {
    webhook_endpoints: [
      { account_id: CONTA, is_active: true, events: ['deal.created', 'deal.stage_changed', 'deal.status_changed'] },
    ],
    deals: [
      {
        id: NEGOCIO,
        account_id: CONTA,
        pipeline_id: FUNIL,
        stage_id: REUNIAO,
        contact_id: CONTATO,
        conversation_id: null,
        channel_id: 'conexao-1',
        title: 'Maria Exemplo',
        value: '1500.00',
        currency: 'BRL',
        status: 'won',
        source: 'channel',
        expected_close_date: null,
        created_at: '2026-09-23T14:00:00.000Z',
        updated_at: '2026-09-23T14:10:00.000Z',
        assigned_to: 'perfil-ana',
      },
    ],
    profiles: [{ id: 'perfil-ana', account_id: CONTA, user_id: 'usuario-ana', full_name: 'Ana Atendente' }],
    pipelines: [{ id: FUNIL, account_id: CONTA, name: 'Comercial' }],
    pipeline_stages: [
      { id: LEAD, pipeline_id: FUNIL, name: 'Lead', position: 2 },
      { id: REUNIAO, pipeline_id: FUNIL, name: 'Reunião Agendada', position: 3 },
    ],
    contacts: [
      {
        id: CONTATO,
        account_id: CONTA,
        phone: '5511900000000',
        name: 'Maria Exemplo',
        email: 'maria@exemplo.com.br',
        company: null,
        avatar_url: null,
        instagram_id: null,
        instagram_username: null,
        created_at: '2026-09-20T12:00:00.000Z',
        updated_at: '2026-09-23T14:00:00.000Z',
        contact_tags: [{ tags: { id: 't-1', name: 'Typebot', color: '#3b82f6' } }, { tags: null }],
      },
    ],
    custom_fields: [
      { id: 'cf-divida', account_id: CONTA, field_key: 'tamanho_da_divida', field_name: 'Tamanho da dívida', field_type: 'number', categoria: 'geral' },
      { id: 'cf-utm', account_id: CONTA, field_key: 'utm_source', field_name: 'utm_source', field_type: 'text', categoria: 'tracking' },
      { id: 'cf-vazio', account_id: CONTA, field_key: 'observacao', field_name: 'Observação', field_type: 'text', categoria: 'geral' },
    ],
    contact_custom_values: [
      { contact_id: CONTATO, custom_field_id: 'cf-divida', value: '150000' },
      // '' no banco (automação que gravou variável vazia) sai null, como na v1.
      { contact_id: CONTATO, custom_field_id: 'cf-vazio', value: '' },
    ],
    ...parcial,
  };
}

const chamadas = () => vi.mocked(dispatchWebhookEvent).mock.calls;
/** O `data` da i-ésima entrega, para inspecionar campo a campo. */
const dataDa = (i: number) => chamadas()[i][3] as unknown as Record<string, unknown>;

// `mockReset` devolve a implementação da fábrica — o teste de concorrência troca a dele.
beforeEach(() => vi.mocked(dispatchWebhookEvent).mockReset());
afterEach(() => vi.restoreAllMocks());

describe('entregarEventosDeFunil', () => {
  it('conta sem endpoint deal.*: UMA consulta, nenhum catálogo lido, nada entregue', async () => {
    const { db, consultas } = bancoFalso(
      tabelas({ webhook_endpoints: [{ account_id: CONTA, is_active: true, events: ['message.received'] }] })
    );
    await entregarEventosDeFunil(db, [CRIADO, MOVIDO, GANHO]);

    expect(consultas.map((c) => c.tabela)).toEqual(['webhook_endpoints']);
    // A pergunta é "alguém assina ALGUM deal.*?", só dos ativos da conta.
    expect(consultas[0].overlaps).toEqual([['events', ['deal.created', 'deal.stage_changed', 'deal.status_changed']]]);
    expect(consultas[0].eq).toEqual(expect.arrayContaining([['account_id', CONTA], ['is_active', true]]));
    expect(chamadas()).toHaveLength(0);
  });

  it('endpoint DESLIGADO não conta', async () => {
    const { db, consultas } = bancoFalso(
      tabelas({ webhook_endpoints: [{ account_id: CONTA, is_active: false, events: ['deal.created'] }] })
    );
    await entregarEventosDeFunil(db, [CRIADO]);
    expect(consultas).toHaveLength(1);
    expect(chamadas()).toHaveLength(0);
  });

  it('só as linhas cujo evento alguém assina viram aviso', async () => {
    const { db } = bancoFalso(
      tabelas({ webhook_endpoints: [{ account_id: CONTA, is_active: true, events: ['deal.status_changed'] }] })
    );
    await entregarEventosDeFunil(db, [CRIADO, MOVIDO, GANHO]);
    expect(chamadas().map((c) => c[2])).toEqual(['deal.status_changed']);
  });

  it('created, stage e status: cada um com o seu evento, id e hora do FATO, em ordem de criado_em', async () => {
    const { db } = bancoFalso(tabelas());
    // Fora de ordem de propósito.
    await entregarEventosDeFunil(db, [GANHO, CRIADO, MOVIDO]);

    const c = chamadas();
    expect(c.map((x) => x[2])).toEqual(['deal.created', 'deal.stage_changed', 'deal.status_changed']);
    expect(c.map((x) => x[1])).toEqual([CONTA, CONTA, CONTA]);
    expect(c.map((x) => x[4])).toEqual([
      { id: 'evt-criado', occurredAt: '2026-09-23T14:00:00.000Z' },
      { id: 'evt-movido', occurredAt: '2026-09-23T14:05:00.000Z' },
      { id: 'evt-ganho', occurredAt: '2026-09-23T14:10:00.000Z' },
    ]);

    const [criado, movido, ganho] = c.map((_, i) => dataDa(i));
    expect(criado.event_id).toBe('evt-criado');
    expect(criado.stage).toEqual({ id: LEAD, name: 'Lead', position: 2 });
    expect('from_stage' in criado).toBe(false);
    expect(movido.from_stage).toEqual({ id: LEAD, name: 'Lead', position: 2 });
    expect(movido.stage).toEqual({ id: REUNIAO, name: 'Reunião Agendada', position: 3 });
    expect(movido.pipeline).toEqual({ id: FUNIL, name: 'Comercial' });
    expect(ganho).toMatchObject({ from_status: 'open', status: 'won' });
    // O negócio no formato da v1 (value numérico) e o responsável pelo USUÁRIO.
    expect(movido.deal).toMatchObject({ id: NEGOCIO, value: 1500, status: 'won', currency: 'BRL' });
    expect(movido.assignee).toEqual({ user_id: 'usuario-ana', name: 'Ana Atendente' });
  });

  it('contato completo: etiquetas e TODO campo do catálogo (vazio = null)', async () => {
    const { db } = bancoFalso(tabelas());
    await entregarEventosDeFunil(db, [MOVIDO]);
    const contato = (dataDa(0).contact as Record<string, unknown>);
    expect(contato).toMatchObject({ id: CONTATO, name: 'Maria Exemplo', phone: '5511900000000' });
    expect(contato.tags).toEqual([{ id: 't-1', name: 'Typebot', color: '#3b82f6' }]);
    expect(contato.custom_fields).toEqual({
      tamanho_da_divida: '150000',
      utm_source: null,
      observacao: null,
    });
  });

  it('negócio apagado antes da entrega: deal e assignee null, o resto sai', async () => {
    const { db } = bancoFalso(tabelas({ deals: [] }));
    await entregarEventosDeFunil(db, [MOVIDO]);
    const data = dataDa(0);
    expect(data.deal_id).toBe(NEGOCIO);
    expect(data.deal).toBeNull();
    expect(data.assignee).toBeNull();
    expect(data.contact).not.toBeNull();
  });

  it('sem responsável: assignee null, sem consultar perfis', async () => {
    const t = tabelas();
    t.deals = [{ ...t.deals[0], assigned_to: null }];
    const { db, consultas } = bancoFalso(t);
    await entregarEventosDeFunil(db, [MOVIDO]);
    expect(dataDa(0).assignee).toBeNull();
    expect(consultas.some((c) => c.tabela === 'profiles')).toBe(false);
  });

  it.each(['deals', 'profiles', 'pipelines', 'pipeline_stages', 'contacts', 'custom_fields', 'contact_custom_values'])(
    '⚠️ leitura de %s que FALHA não vira aviso com null: nada da conta é entregue',
    async (tabela) => {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { db } = bancoFalso(tabelas(), [tabela]);
      await entregarEventosDeFunil(db, [CRIADO, MOVIDO, GANHO]);
      expect(chamadas()).toHaveLength(0);
      expect(erro).toHaveBeenCalled();
      // A contagem do que se perdeu vai para o log.
      expect(String(erro.mock.calls[0][0])).toMatch(/3 aviso\(s\)/);
    }
  );

  it('falha na leitura dos ENDPOINTS: nada entregue, com a contagem no log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = bancoFalso(tabelas(), ['webhook_endpoints']);
    await entregarEventosDeFunil(db, [CRIADO, MOVIDO]);
    expect(chamadas()).toHaveLength(0);
    expect(String(erro.mock.calls[0][0])).toMatch(/2 aviso\(s\)/);
  });

  it('toda leitura é recortada pela conta (service role ignora RLS)', async () => {
    const { db, consultas } = bancoFalso(tabelas());
    await entregarEventosDeFunil(db, [MOVIDO]);
    for (const tabela of ['webhook_endpoints', 'deals', 'profiles', 'pipelines', 'contacts', 'custom_fields']) {
      const c = consultas.find((x) => x.tabela === tabela);
      expect(c, tabela).toBeDefined();
      expect(c!.eq, tabela).toContainEqual(['account_id', CONTA]);
    }
    // Sem `account_id` na tabela: o recorte é pelos contatos que a CONTA devolveu.
    const valores = consultas.find((x) => x.tabela === 'contact_custom_values')!;
    expect(valores.in).toEqual([['contact_id', [CONTATO]]]);
  });

  it('etapa de funil de OUTRA conta não empresta o nome', async () => {
    const t = tabelas({
      pipelines: [{ id: FUNIL, account_id: OUTRA_CONTA, name: 'Alheio' }],
    });
    const { db } = bancoFalso(t);
    await entregarEventosDeFunil(db, [MOVIDO]);
    const data = dataDa(0);
    expect(data.pipeline).toEqual({ id: FUNIL, name: null });
    expect(data.stage).toEqual({ id: REUNIAO, name: null, position: null });
  });

  it('contato de OUTRA conta com o mesmo id não entra no aviso', async () => {
    const t = tabelas();
    t.contacts = [{ ...t.contacts[0], account_id: OUTRA_CONTA }];
    const { db } = bancoFalso(t);
    await entregarEventosDeFunil(db, [MOVIDO]);
    expect(dataDa(0).contact).toBeNull();
  });

  it('duas contas no mesmo lote: cada uma com os SEUS endpoints e o seu catálogo', async () => {
    const t = tabelas();
    t.webhook_endpoints.push({ account_id: OUTRA_CONTA, is_active: true, events: ['deal.created'] });
    const daOutra = evento({ id: 'evt-outra', account_id: OUTRA_CONTA, from_pipeline_id: null, from_stage_id: null, deal_id: 'd-9', contact_id: null });
    const { db } = bancoFalso(t);
    await entregarEventosDeFunil(db, [MOVIDO, daOutra]);
    expect(chamadas().map((c) => [c[1], c[2]])).toEqual([
      [CONTA, 'deal.stage_changed'],
      [OUTRA_CONTA, 'deal.created'],
    ]);
  });

  it('linha sem contato (card de grupo): sai com contact null, sem ler contatos', async () => {
    const { db, consultas } = bancoFalso(tabelas());
    await entregarEventosDeFunil(db, [evento({ contact_id: null })]);
    expect(dataDa(0).contact).toBeNull();
    expect(consultas.some((c) => c.tabela === 'contacts')).toBe(false);
  });

  it('⚠️ pagina os valores de campo além do teto de 1000 linhas do PostgREST', async () => {
    const campos: Linha[] = [];
    const valores: Linha[] = [];
    for (let i = 0; i < 600; i++) {
      campos.push({ id: `cf-${i}`, account_id: CONTA, field_key: `campo_${i}`, field_name: `Campo ${i}`, field_type: 'text', categoria: 'geral' });
      valores.push({ contact_id: CONTATO, custom_field_id: `cf-${i}`, value: `a${i}` });
      valores.push({ contact_id: 'c-2', custom_field_id: `cf-${i}`, value: `b${i}` });
    }
    const t = tabelas({ custom_fields: campos, contact_custom_values: valores });
    t.contacts = [...t.contacts, { ...t.contacts[0], id: 'c-2' }];
    const { db } = bancoFalso(t);
    await entregarEventosDeFunil(db, [MOVIDO, evento({ id: 'evt-2', contact_id: 'c-2' })]);

    const [primeiro, segundo] = chamadas().map((_, i) => dataDa(i).contact as { custom_fields: Record<string, string> });
    expect(Object.keys(primeiro.custom_fields)).toHaveLength(600);
    // O último valor do SEGUNDO contato está na segunda página — sem paginar, ele sumiria.
    expect(segundo.custom_fields.campo_599).toBe('b599');
    expect(primeiro.custom_fields.campo_599).toBe('a599');
  });

  it('no máximo 4 entregas ao mesmo tempo', async () => {
    let emVoo = 0;
    let pico = 0;
    vi.mocked(dispatchWebhookEvent).mockImplementation(async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo--;
    });
    const linhas = Array.from({ length: 11 }, (_, i) =>
      evento({ id: `evt-${i}`, criado_em: `2026-09-23T14:${String(10 + i).padStart(2, '0')}:00.000Z` })
    );
    const { db } = bancoFalso(tabelas());
    await entregarEventosDeFunil(db, linhas);
    expect(chamadas()).toHaveLength(11);
    expect(pico).toBe(4);
    // Começam em ordem de criado_em.
    expect(chamadas().map((c) => (c[4] as { id: string }).id)).toEqual(linhas.map((l) => l.id));
  });

  it('nunca lança — nem com o banco estourando na primeira chamada', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      from: () => {
        throw new Error('sem conexão');
      },
    } as unknown as SupabaseClient;
    await expect(entregarEventosDeFunil(db, [MOVIDO])).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();
  });

  it('lista vazia: nem consulta', async () => {
    const { db, consultas } = bancoFalso(tabelas());
    await entregarEventosDeFunil(db, []);
    expect(consultas).toHaveLength(0);
  });
});

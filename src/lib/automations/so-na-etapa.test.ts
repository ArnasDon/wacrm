import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DETALHE_SAIU_DA_ETAPA,
  cancelarEsperasAoSairDaEtapa,
  cardSaiuDaEtapa,
  estadiaSemEvento,
  execucoesPresas,
  estaFora,
  etapasQuePrendem,
} from './so-na-etapa';

const NO_SHOW = 'etapa-no-show';
const REUNIAO = 'etapa-reuniao-agendada';

const presa = (config: Record<string, unknown> = {}) => ({
  trigger_type: 'deal_stage_changed',
  trigger_config: { stage_ids: [NO_SHOW], parar_ao_sair: true, ...config },
});

describe('etapasQuePrendem', () => {
  it('gatilho de etapa + caixa marcada + etapa nomeada = presa', () => {
    expect(etapasQuePrendem(presa())).toEqual([NO_SHOW]);
  });

  it('⚠️ automação gravada ANTES da opção (sem a chave) não é presa — nada muda retroativamente', () => {
    expect(
      etapasQuePrendem({
        trigger_type: 'deal_stage_changed',
        trigger_config: { stage_ids: [NO_SHOW] },
      })
    ).toBeNull();
  });

  it('⚠️ só o booleano true prende', () => {
    for (const valor of ['true', 1, {}, null, false]) {
      expect(etapasQuePrendem(presa({ parar_ao_sair: valor }))).toBeNull();
    }
  });

  it('⚠️ sem etapa nomeada (vale para QUALQUER etapa) não há de onde sair', () => {
    expect(etapasQuePrendem(presa({ stage_ids: [] }))).toBeNull();
    expect(etapasQuePrendem(presa({ stage_ids: undefined }))).toBeNull();
    expect(etapasQuePrendem(presa({ stage_ids: ['', '  '] }))).toBeNull();
  });

  it('outro gatilho com a chave perdida na config não é preso', () => {
    expect(
      etapasQuePrendem({
        trigger_type: 'new_message_received',
        trigger_config: { stage_ids: [NO_SHOW], parar_ao_sair: true },
      })
    ).toBeNull();
  });

  it('config nula não estoura', () => {
    expect(
      etapasQuePrendem({ trigger_type: 'deal_stage_changed', trigger_config: null })
    ).toBeNull();
  });
});

describe('estaFora', () => {
  it('na etapa: dentro; noutra: fora', () => {
    expect(estaFora([NO_SHOW], NO_SHOW)).toBe(false);
    expect(estaFora([NO_SHOW], REUNIAO)).toBe(true);
  });

  it('cartão EXPANDIDO na grade: qualquer uma das etapas é dentro', () => {
    expect(estaFora([NO_SHOW, 'etapa-sem-retorno'], 'etapa-sem-retorno')).toBe(false);
  });

  it('⚠️ sem card (apagado / contato sem negócio aberto) é FORA — fato, não ignorância', () => {
    expect(estaFora([NO_SHOW], null)).toBe(true);
  });
});

describe('execucoesPresas', () => {
  const execucao = (id: string, automations: unknown) => ({
    id,
    automation_id: `auto-${id}`,
    automations: automations as never,
  });

  it('o caso do No Show: execução de automação presa → o movimento encerra', () => {
    expect(execucoesPresas([execucao('e1', presa())]).map((e) => e.id)).toEqual(['e1']);
  });

  it('automação NÃO presa fica — inclusive a de etapa sem a caixa', () => {
    const r = execucoesPresas([
      execucao('e1', { trigger_type: 'deal_stage_changed', trigger_config: { stage_ids: [NO_SHOW] } }),
      execucao('e2', { trigger_type: 'calendly_booking', trigger_config: {} }),
    ]);
    expect(r).toEqual([]);
  });

  it('⚠️⚠️ card foi para OUTRA etapa que também prende a automação → TAMBÉM encerra (revisão de 19/09)', () => {
    // A mesma régua da estadia (`cardSaiuDaEtapa` com `eventoEm`): a entrada
    // na etapa nova dispara execução nova, e a antiga sairia em dobro. Até
    // aqui esta ponta lia "continuar dentro" e discordava da retomada.
    expect(execucoesPresas([execucao('e1', presa({ stage_ids: [NO_SHOW, REUNIAO] }))]).map((e) => e.id)).toEqual(['e1']);
  });

  it('⚠️⚠️ o MESMO lead com VÁRIAS automações: o movimento só encerra quem pediu', () => {
    // Pergunta do operador (18/09/2026): um lead pode ter mais de uma
    // automação rodando — várias na mesma etapa, e outras que NÃO foram
    // marcadas para parar. Medido de ponta a ponta com quatro ao mesmo tempo;
    // este é o pino do recorte.
    const r = execucoesPresas([
      execucao('presa-1', presa()),
      execucao('presa-2', presa()),
      execucao('mesma-etapa-sem-caixa', {
        trigger_type: 'deal_stage_changed',
        trigger_config: { stage_ids: [NO_SHOW], parar_ao_sair: false },
      }),
      execucao('calendly', { trigger_type: 'calendly_booking', trigger_config: {} }),
      execucao('manual', { trigger_type: 'manual', trigger_config: {} }),
    ]);
    expect(r.map((e) => e.id)).toEqual(['presa-1', 'presa-2']);
  });

  it('o embed do PostgREST pode vir como LISTA', () => {
    expect(execucoesPresas([execucao('e1', [presa()])]).map((e) => e.id)).toEqual(['e1']);
  });
});

// ------------------------------------------------------------
// I/O contra um banco falso que registra o que foi pedido.
// ------------------------------------------------------------

type Filtro = [string, string, unknown];

function bancoFalso(opcoes: {
  negocio?: { stage_id?: string; id?: string } | null;
  erroNoNegocio?: string;
  estouraNoNegocio?: boolean;
  /** Movimentos do card na fila de eventos DEPOIS do instante perguntado. */
  movimentosDepois?: { id: string }[];
  erroNosMovimentos?: string;
  /** O último movimento conhecido do card (a âncora da estadia sem evento). */
  ultimoMovimento?: { criado_em: string } | null;
  /** Os negócios ABERTOS do contato (a lista da estadia sem evento). */
  negocios?: { id: string; stage_id: string | null }[];
  /** As execuções VIVAS que o SELECT em `automation_logs` devolve. */
  execucoes?: unknown[];
  erroNasExecucoes?: string;
  canceladas?: { id: string }[];
  erroNoCancelamento?: string;
  /** As esperas `pending` das execuções candidatas (`log_id` + o card da espera). */
  esperas?: { log_id: string; card: string | null }[];
  erroNasEsperas?: string;
}) {
  const chamadas: { tabela: string; tipo: string; payload?: unknown; filtros: Filtro[] }[] = [];
  const db = {
    from(tabela: string) {
      const op = { tabela, tipo: 'select', payload: undefined as unknown, filtros: [] as Filtro[], limite: 0 };
      chamadas.push(op);
      const resolver = () => {
        if (tabela === 'cb_automation_events') {
          if (opcoes.erroNosMovimentos) return { data: null, error: { message: opcoes.erroNosMovimentos } };
          if (!op.filtros.some(([o]) => o === 'gt')) {
            return { data: opcoes.ultimoMovimento ? [opcoes.ultimoMovimento] : [], error: null };
          }
          return { data: opcoes.movimentosDepois ?? [], error: null };
        }
        if (tabela === 'deals') {
          if (opcoes.estouraNoNegocio) throw new Error('rede caiu');
          if (opcoes.erroNoNegocio) return { data: null, error: { message: opcoes.erroNoNegocio } };
          if (op.limite > 1) return { data: opcoes.negocios ?? [], error: null };
          return { data: opcoes.negocio ?? null, error: null };
        }
        if (tabela === 'automation_pending_executions') {
          if (op.tipo === 'update') {
            if (opcoes.erroNoCancelamento) return { data: null, error: { message: opcoes.erroNoCancelamento } };
            return { data: opcoes.canceladas ?? [], error: null };
          }
          if (opcoes.erroNasEsperas) return { data: null, error: { message: opcoes.erroNasEsperas } };
          return { data: opcoes.esperas ?? [], error: null };
        }
        // automation_logs: a lista de execuções vivas (select com embed), a
        // marca (update com `interrompida_por`), a anotação (update com
        // `steps_executed`) e a leitura para anotar (select por id).
        if (op.tipo === 'update') return { data: [{ id: 'log' }], error: null };
        if (op.filtros.some(([o, k]) => o === 'eq' && k === 'id')) {
          return { data: { steps_executed: [] }, error: null };
        }
        if (opcoes.erroNasExecucoes) return { data: null, error: { message: opcoes.erroNasExecucoes } };
        return { data: opcoes.execucoes ?? [], error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: unknown) => ((op.tipo = 'update'), (op.payload = p), b),
        eq: (k: string, v: unknown) => (op.filtros.push(['eq', k, v]), b),
        in: (k: string, v: unknown) => (op.filtros.push(['in', k, v]), b),
        lte: (k: string, v: unknown) => (op.filtros.push(['lte', k, v]), b),
        gt: (k: string, v: unknown) => (op.filtros.push(['gt', k, v]), b),
        is: (k: string, v: unknown) => (op.filtros.push(['is', k, v]), b),
        order: () => b,
        limit: (n: number) => ((op.limite = n), b),
        maybeSingle: () => Promise.resolve().then(resolver),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve().then(resolver).then(onF, onR),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, chamadas };
}

const automacaoPresa = { ...presa(), account_id: 'acct-1' };

describe('cardSaiuDaEtapa — a espera acordou', () => {
  it('não presa: nem consulta o banco', async () => {
    const { db, chamadas } = bancoFalso({});
    const r = await cardSaiuDaEtapa({
      db,
      automation: { trigger_type: 'manual', trigger_config: {}, account_id: 'acct-1' },
      contactId: 'c1',
      dealId: 'deal-1',
    });
    expect(r).toBe('nao_se_aplica');
    expect(chamadas).toHaveLength(0);
  });

  it('card do contexto ainda na etapa → segue', async () => {
    const { db, chamadas } = bancoFalso({ negocio: { stage_id: NO_SHOW } });
    const r = await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1' });
    expect(r).toBe('na_etapa');
    // Pelo id do card E pela conta (o motor roda em service-role, sem RLS).
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'id', 'deal-1'],
      ['eq', 'account_id', 'acct-1'],
    ]);
  });

  it('card foi para Reunião Agendada → saiu', async () => {
    const { db } = bancoFalso({ negocio: { stage_id: REUNIAO } });
    expect(
      await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1' })
    ).toBe('saiu');
  });

  it('card APAGADO → saiu', async () => {
    const { db } = bancoFalso({ negocio: null });
    expect(
      await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1' })
    ).toBe('saiu');
  });

  it('sem card no contexto (execução manual): o negócio ABERTO mais recente do contato', async () => {
    const { db, chamadas } = bancoFalso({ negocio: { stage_id: NO_SHOW } });
    const r = await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: null });
    expect(r).toBe('na_etapa');
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'open'],
    ]);
  });

  it('⚠️⚠️ a ESTADIA: movimento do card POSTERIOR ao evento encerra, mesmo com o card de volta (7ª rodada)', async () => {
    const { db, chamadas } = bancoFalso({ negocio: { stage_id: NO_SHOW }, movimentosDepois: [{ id: 'ev-2' }] });
    const r = await cardSaiuDaEtapa({
      db,
      automation: automacaoPresa,
      contactId: 'c1',
      dealId: 'deal-1',
      eventoEm: '2026-09-18T10:00:00+00:00',
    });
    expect(r).toBe('saiu');
    // A pergunta vai à fila de eventos, pelo card e pela conta, só movimentos
    // de ETAPA e só os posteriores ao instante da entrada.
    expect(chamadas[0].tabela).toBe('cb_automation_events');
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'deal_id', 'deal-1'],
      ['eq', 'tipo', 'deal_stage_changed'],
      ['gt', 'criado_em', '2026-09-18T10:00:00+00:00'],
    ]);
  });

  it('sem movimento posterior, vale a posição do card', async () => {
    const { db } = bancoFalso({ negocio: { stage_id: NO_SHOW }, movimentosDepois: [] });
    expect(
      await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1', eventoEm: '2026-09-18T10:00:00+00:00' })
    ).toBe('na_etapa');
  });

  it('⚠️ sem card no contexto mas com instante (execução manual ancorada): a pergunta é por CONTATO (9ª rodada)', async () => {
    const { db, chamadas } = bancoFalso({ negocio: { stage_id: NO_SHOW }, movimentosDepois: [{ id: 'ev-2' }] });
    const r = await cardSaiuDaEtapa({
      db,
      automation: automacaoPresa,
      contactId: 'c1',
      dealId: null,
      eventoEm: '2026-09-18T10:00:00+00:00',
    });
    expect(r).toBe('saiu');
    expect(chamadas[0].tabela).toBe('cb_automation_events');
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'tipo', 'deal_stage_changed'],
      ['gt', 'criado_em', '2026-09-18T10:00:00+00:00'],
    ]);
  });

  it('execução manual (sem instante de entrada) não pergunta à fila de eventos', async () => {
    const { db, chamadas } = bancoFalso({ negocio: { stage_id: NO_SHOW }, movimentosDepois: [{ id: 'x' }] });
    expect(await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1' })).toBe('na_etapa');
    expect(chamadas.some((c) => c.tabela === 'cb_automation_events')).toBe(false);
  });

  it("⚠️ erro ao ler a fila de eventos também é 'erro'", async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db } = bancoFalso({ negocio: { stage_id: NO_SHOW }, erroNosMovimentos: 'timeout' });
      expect(
        await cardSaiuDaEtapa({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1', eventoEm: '2026-09-18T10:00:00+00:00' })
      ).toBe('erro');
    } finally {
      calado.mockRestore();
    }
  });

  it("⚠️⚠️ erro de leitura é 'erro' — NUNCA 'na_etapa' nem 'saiu'", async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const comErro = bancoFalso({ erroNoNegocio: 'timeout' });
      expect(
        await cardSaiuDaEtapa({ db: comErro.db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-1' })
      ).toBe('erro');
      const estourando = bancoFalso({ estouraNoNegocio: true });
      expect(
        await cardSaiuDaEtapa({ db: estourando.db, automation: automacaoPresa, contactId: 'c1', dealId: null })
      ).toBe('erro');
    } finally {
      calado.mockRestore();
    }
  });
});

describe('cancelarEsperasAoSairDaEtapa — o card mudou de etapa', () => {
  const MOVIDO_EM = '2026-09-18T15:01:02.123456+00:00';
  const evento = {
    accountId: 'acct-1',
    contactId: 'c1',
    dealId: 'deal-1',
    toStageId: REUNIAO,
    movidoEm: MOVIDO_EM,
  };
  const execucaoPresa = { id: 'log-1', automation_id: 'auto-1', automations: presa() };

  const updates = (chamadas: { tabela: string; tipo: string; payload?: unknown; filtros: Filtro[] }[], tabela: string) =>
    chamadas.filter((c) => c.tabela === tabela && c.tipo === 'update');

  it('⚠️⚠️ a unidade é a EXECUÇÃO: lê os registros VIVOS do contato, marca, e só então cancela a fila', async () => {
    const { db, chamadas } = bancoFalso({
      execucoes: [execucaoPresa],
      canceladas: [{ id: 'p1' }],
    });
    const n = await cancelarEsperasAoSairDaEtapa({ db, ...evento });

    expect(n).toBe(2); // 1 registro marcado + 1 espera cancelada
    const leitura = chamadas[0];
    expect(leitura.tabela).toBe('automation_logs');
    expect(leitura.filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      // Viva: sem hora de fim e ainda não interrompida.
      ['is', 'finalizado_em', null],
      ['is', 'interrompida_em', null],
      ['eq', 'automations.trigger_type', 'deal_stage_changed'],
      // ⚠️ Só a execução que JÁ EXISTIA quando o card saiu: a saída
      // processada com atraso não pode matar a que a reentrada iniciou.
      ['lte', 'created_at', MOVIDO_EM],
    ]);

    const [marca] = updates(chamadas, 'automation_logs');
    expect(marca.payload).toMatchObject({ interrompida_por: 'etapa' });

    const [cancelamento] = updates(chamadas, 'automation_pending_executions');
    expect(cancelamento.payload).toEqual({ status: 'cancelled' });
    // Pelo REGISTRO, sem corte por data: a execução nova é outro registro.
    expect(cancelamento.filtros).toEqual([
      ['in', 'log_id', ['log-1']],
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'pending'],
    ]);
  });

  it('⚠️ o CARD é distinguido pela espera: execução estacionada por OUTRO card do contato fica de fora (revisão de 19/09)', async () => {
    const outra = { ...execucaoPresa, id: 'log-2' };
    const { db, chamadas } = bancoFalso({
      execucoes: [execucaoPresa, outra],
      esperas: [
        { log_id: 'log-1', card: evento.dealId },
        { log_id: 'log-2', card: 'deal-do-juridico' },
      ],
      canceladas: [{ id: 'p1' }],
    });
    const n = await cancelarEsperasAoSairDaEtapa({ db, ...evento });
    expect(n).toBe(2);
    const [marca] = updates(chamadas, 'automation_logs');
    expect(marca.filtros.find(([, k]) => k === 'id')).toEqual(['in', 'id', ['log-1']]);
  });

  it('⚠️ a espera já RUNNING também distingue o card (12ª rodada): a leitura pede pending E running, o cancelamento só pending', async () => {
    const { db, chamadas } = bancoFalso({
      execucoes: [execucaoPresa],
      esperas: [{ log_id: 'log-1', card: 'deal-do-juridico' }],
      canceladas: [],
    });
    expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento })).toBe(0);
    const leitura = chamadas.find((c) => c.tabela === 'automation_pending_executions' && c.tipo === 'select');
    expect(leitura?.filtros).toContainEqual(['in', 'status', ['pending', 'running']]);
    expect(chamadas.some((c) => c.tipo === 'update')).toBe(false);
  });

  it('a execução RODANDO (sem espera) não tem card conhecido e é marcada — aceito, um card por contato', async () => {
    const { db, chamadas } = bancoFalso({ execucoes: [execucaoPresa], esperas: [], canceladas: [] });
    expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento })).toBe(1);
    expect(updates(chamadas, 'automation_logs')[0].payload).toMatchObject({ interrompida_por: 'etapa' });
  });

  it('⚠️ leitura das esperas falhou: NÃO marca (a ponta 1 cobre) — marcar sem saber o card mataria a sequência do outro', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db, chamadas } = bancoFalso({ execucoes: [execucaoPresa], erroNasEsperas: 'timeout' });
      expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento })).toBe(0);
      expect(chamadas.some((c) => c.tipo === 'update')).toBe(false);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️⚠️ execução RODANDO sem espera nenhuma na fila também é marcada (5ª rodada do Codex)', async () => {
    // Entre o disparo e a primeira espera não há linha na fila — e a saída
    // nesse instante não tinha onde se gravar. O registro existe.
    const { db, chamadas } = bancoFalso({ execucoes: [execucaoPresa], canceladas: [] });
    const n = await cancelarEsperasAoSairDaEtapa({ db, ...evento });

    expect(n).toBe(1);
    expect(updates(chamadas, 'automation_logs')[0].payload).toMatchObject({ interrompida_por: 'etapa' });
  });

  it('anota a interrupção no registro de cada execução marcada', async () => {
    const { db, chamadas } = bancoFalso({ execucoes: [execucaoPresa], canceladas: [] });
    await cancelarEsperasAoSairDaEtapa({ db, ...evento });

    const nota = updates(chamadas, 'automation_logs').find((c) => 'steps_executed' in (c.payload as object));
    const passos = (nota?.payload as { steps_executed: { detail: string; status: string }[] }).steps_executed;
    expect(passos.at(-1)).toMatchObject({ status: 'skipped', step_type: 'wait', detail: DETALHE_SAIU_DA_ETAPA });
  });

  it('nenhuma execução presa: não escreve nada', async () => {
    const { db, chamadas } = bancoFalso({
      execucoes: [{ id: 'log-x', automation_id: 'a', automations: { trigger_type: 'deal_stage_changed', trigger_config: { stage_ids: [NO_SHOW] } } }],
    });
    expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento })).toBe(0);
    expect(chamadas.some((c) => c.tipo === 'update')).toBe(false);
  });

  it('evento sem carimbo (linha antiga da fila): não recorta por data, mas segue', async () => {
    const { db, chamadas } = bancoFalso({ execucoes: [execucaoPresa], canceladas: [] });
    expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento, movidoEm: null })).toBe(1);
    expect(chamadas[0].filtros.some(([op]) => op === 'lte')).toBe(false);
  });

  it('evento sem contato, sem card ou sem etapa de destino: nada a fazer, nenhuma consulta', async () => {
    for (const falta of [{ contactId: null }, { dealId: null }, { toStageId: null }]) {
      const { db, chamadas } = bancoFalso({});
      expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento, ...falta })).toBe(0);
      expect(chamadas).toHaveLength(0);
    }
  });

  it('⚠️ NUNCA lança: o dreno do funil não pode perder o disparo da etapa nova por causa disto', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const lendo = bancoFalso({ erroNasExecucoes: 'timeout' });
      await expect(cancelarEsperasAoSairDaEtapa({ db: lendo.db, ...evento })).resolves.toBe(0);
      const cancelando = bancoFalso({ execucoes: [execucaoPresa], erroNoCancelamento: 'timeout' });
      // A marca ficou (1) mesmo com a fila recusando o cancelamento.
      await expect(cancelarEsperasAoSairDaEtapa({ db: cancelando.db, ...evento })).resolves.toBe(1);
    } finally {
      calado.mockRestore();
    }
  });
});

describe('estadiaSemEvento — a execução sem evento (9ª/10ª rodadas)', () => {
  it('⚠️⚠️ o CARD-ALVO é o aberto mais recente que está numa etapa da automação, e a âncora é o último movimento DELE', async () => {
    const { db, chamadas } = bancoFalso({
      negocios: [
        { id: 'deal-juridico', stage_id: 'etapa-do-juridico' }, // mais novo, fora da etapa
        { id: 'deal-noshow', stage_id: NO_SHOW },
      ],
      ultimoMovimento: { criado_em: '2026-09-18T09:00:00+00:00' },
    });
    expect(await estadiaSemEvento({ db, automation: automacaoPresa, contactId: 'c1' })).toEqual({
      deal_id: 'deal-noshow',
      evento_em: '2026-09-18T09:00:00+00:00',
    });
    expect(chamadas[0].tabela).toBe('deals');
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'open'],
    ]);
    expect(chamadas[1].tabela).toBe('cb_automation_events');
    expect(chamadas[1].filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'deal_id', 'deal-noshow'],
      ['eq', 'tipo', 'deal_stage_changed'],
    ]);
  });

  it('⚠️⚠️ com o card JÁ no contexto (a filha herda o da mãe): a âncora é resolvida para ELE, sem escolher outro (12ª rodada)', async () => {
    const { db, chamadas } = bancoFalso({
      negocios: [{ id: 'deal-mais-novo', stage_id: NO_SHOW }],
      ultimoMovimento: { criado_em: '2026-09-18T11:00:00+00:00' },
    });
    expect(await estadiaSemEvento({ db, automation: automacaoPresa, contactId: 'c1', dealId: 'deal-herdado' })).toEqual({
      deal_id: 'deal-herdado',
      evento_em: '2026-09-18T11:00:00+00:00',
    });
    expect(chamadas.some((c) => c.tabela === 'deals')).toBe(false);
    expect(chamadas[0].filtros).toContainEqual(['eq', 'deal_id', 'deal-herdado']);
  });

  it('nenhum card na etapa: o aberto mais recente (a posição dirá "saiu")', async () => {
    const { db } = bancoFalso({ negocios: [{ id: 'deal-fora', stage_id: 'outra' }], ultimoMovimento: null });
    expect(await estadiaSemEvento({ db, automation: automacaoPresa, contactId: 'c1' })).toEqual({ deal_id: 'deal-fora', evento_em: null });
  });

  it('sem card aberto: tudo null (vale só a posição)', async () => {
    const { db } = bancoFalso({ negocios: [] });
    expect(await estadiaSemEvento({ db, automation: automacaoPresa, contactId: 'c1' })).toEqual({ deal_id: null, evento_em: null });
  });

  it('automação NÃO presa, ou sem contato: nem consulta', async () => {
    const { db, chamadas } = bancoFalso({ negocios: [{ id: 'x', stage_id: NO_SHOW }] });
    expect(await estadiaSemEvento({ db, automation: { ...presa({ parar_ao_sair: false }), account_id: 'acct-1' }, contactId: 'c1' })).toEqual({ deal_id: null, evento_em: null });
    expect(await estadiaSemEvento({ db, automation: automacaoPresa, contactId: null })).toEqual({ deal_id: null, evento_em: null });
    expect(chamadas).toHaveLength(0);
  });

  it('⚠️ leitura que falha devolve null (só a posição), nunca lança', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cards = bancoFalso({ erroNoNegocio: 'timeout' });
      await expect(estadiaSemEvento({ db: cards.db, automation: automacaoPresa, contactId: 'c1' })).resolves.toEqual({ deal_id: null, evento_em: null });
      const ancora = bancoFalso({ negocios: [{ id: 'deal-1', stage_id: NO_SHOW }], erroNosMovimentos: 'timeout' });
      await expect(estadiaSemEvento({ db: ancora.db, automation: automacaoPresa, contactId: 'c1' })).resolves.toEqual({ deal_id: 'deal-1', evento_em: null });
    } finally {
      calado.mockRestore();
    }
  });
});

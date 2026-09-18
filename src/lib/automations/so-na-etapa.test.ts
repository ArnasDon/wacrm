import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DETALHE_SAIU_DA_ETAPA,
  cancelarEsperasAoSairDaEtapa,
  cardSaiuDaEtapa,
  esperasQueOMovimentoEncerra,
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

describe('esperasQueOMovimentoEncerra', () => {
  const espera = (id: string, deal: string | null, automations: unknown) => ({
    id,
    log_id: `log-${id}`,
    deal,
    automations: automations as never,
  });
  const movimento = { dealId: 'deal-1', toStageId: REUNIAO };

  it('o caso do No Show: presa, mesmo card, foi para fora → encerra', () => {
    const r = esperasQueOMovimentoEncerra([espera('p1', 'deal-1', presa())], movimento, null);
    expect(r.map((e) => e.id)).toEqual(['p1']);
  });

  it('automação NÃO presa fica — inclusive a de etapa sem a caixa', () => {
    const r = esperasQueOMovimentoEncerra(
      [
        espera('p1', 'deal-1', { trigger_type: 'deal_stage_changed', trigger_config: { stage_ids: [NO_SHOW] } }),
        espera('p2', 'deal-1', { trigger_type: 'calendly_booking', trigger_config: {} }),
      ],
      movimento,
      null
    );
    expect(r).toEqual([]);
  });

  it('⚠️ card foi para OUTRA etapa que também prende a automação → continua', () => {
    const r = esperasQueOMovimentoEncerra(
      [espera('p1', 'deal-1', presa({ stage_ids: [NO_SHOW, REUNIAO] }))],
      movimento,
      null
    );
    expect(r).toEqual([]);
  });

  it('⚠️ espera de OUTRO card do mesmo contato não é tocada', () => {
    const r = esperasQueOMovimentoEncerra([espera('p1', 'deal-2', presa())], movimento, null);
    expect(r).toEqual([]);
  });

  it('execução manual (sem card no contexto): vale o negócio aberto mais recente', () => {
    const lista = [espera('p1', null, presa())];
    expect(esperasQueOMovimentoEncerra(lista, movimento, 'deal-1').map((e) => e.id)).toEqual(['p1']);
    expect(esperasQueOMovimentoEncerra(lista, movimento, 'deal-9')).toEqual([]);
    // Não deu para saber qual é o card → fica para a conferência da retomada.
    expect(esperasQueOMovimentoEncerra(lista, movimento, null)).toEqual([]);
  });

  it('o embed do PostgREST pode vir como LISTA', () => {
    const r = esperasQueOMovimentoEncerra([espera('p1', 'deal-1', [presa()])], movimento, null);
    expect(r.map((e) => e.id)).toEqual(['p1']);
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
  esperas?: unknown[];
  erroNasEsperas?: string;
  canceladas?: { id: string; log_id: string | null }[];
  erroNoCancelamento?: string;
}) {
  const chamadas: { tabela: string; tipo: string; payload?: unknown; filtros: Filtro[] }[] = [];
  const db = {
    from(tabela: string) {
      const op = { tabela, tipo: 'select', payload: undefined as unknown, filtros: [] as Filtro[] };
      chamadas.push(op);
      const resolver = () => {
        if (tabela === 'deals') {
          if (opcoes.estouraNoNegocio) throw new Error('rede caiu');
          if (opcoes.erroNoNegocio) return { data: null, error: { message: opcoes.erroNoNegocio } };
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
        if (op.tipo === 'update') return { data: [{ id: 'log' }], error: null };
        return { data: { steps_executed: [] }, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: unknown) => ((op.tipo = 'update'), (op.payload = p), b),
        eq: (k: string, v: unknown) => (op.filtros.push(['eq', k, v]), b),
        in: (k: string, v: unknown) => (op.filtros.push(['in', k, v]), b),
        is: () => b,
        order: () => b,
        limit: () => b,
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
  const evento = { accountId: 'acct-1', contactId: 'c1', dealId: 'deal-1', toStageId: REUNIAO };
  const esperaPresa = { id: 'p1', log_id: 'log-1', deal: 'deal-1', automations: presa() };

  it('⚠️⚠️ as cercas: conta + CONTATO + pending na leitura; ids + conta + pending no cancelamento', async () => {
    const { db, chamadas } = bancoFalso({
      esperas: [esperaPresa],
      canceladas: [{ id: 'p1', log_id: 'log-1' }],
    });
    const n = await cancelarEsperasAoSairDaEtapa({ db, ...evento });

    expect(n).toBe(1);
    const leitura = chamadas[0];
    expect(leitura.filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'pending'],
      ['eq', 'automations.trigger_type', 'deal_stage_changed'],
    ]);
    const cancelamento = chamadas.find((c) => c.tabela === 'automation_pending_executions' && c.tipo === 'update');
    expect(cancelamento?.payload).toEqual({ status: 'cancelled' });
    expect(cancelamento?.filtros).toEqual([
      ['in', 'id', ['p1']],
      ['eq', 'account_id', 'acct-1'],
      // A foto é de instantes atrás: quem decide é o banco.
      ['eq', 'status', 'pending'],
    ]);
  });

  it('anota a interrupção no registro de cada espera cancelada', async () => {
    const { db, chamadas } = bancoFalso({
      esperas: [esperaPresa],
      canceladas: [{ id: 'p1', log_id: 'log-1' }],
    });
    await cancelarEsperasAoSairDaEtapa({ db, ...evento });

    const nota = chamadas.find((c) => c.tabela === 'automation_logs' && c.tipo === 'update');
    const passos = (nota?.payload as { steps_executed: { detail: string; status: string }[] }).steps_executed;
    expect(passos.at(-1)).toMatchObject({ status: 'skipped', step_type: 'wait', detail: DETALHE_SAIU_DA_ETAPA });
  });

  it('nenhuma espera presa: não escreve nada', async () => {
    const { db, chamadas } = bancoFalso({
      esperas: [{ id: 'p1', log_id: 'l', deal: 'deal-1', automations: { trigger_type: 'deal_stage_changed', trigger_config: { stage_ids: [NO_SHOW] } } }],
    });
    expect(await cancelarEsperasAoSairDaEtapa({ db, ...evento })).toBe(0);
    expect(chamadas.some((c) => c.tipo === 'update')).toBe(false);
  });

  it('só consulta o negócio mais recente quando há espera SEM card no contexto', async () => {
    const comCard = bancoFalso({ esperas: [esperaPresa], canceladas: [] });
    await cancelarEsperasAoSairDaEtapa({ db: comCard.db, ...evento });
    expect(comCard.chamadas.some((c) => c.tabela === 'deals')).toBe(false);

    const semCard = bancoFalso({
      esperas: [{ ...esperaPresa, deal: null }],
      negocio: { id: 'deal-1' },
      canceladas: [{ id: 'p1', log_id: null }],
    });
    expect(await cancelarEsperasAoSairDaEtapa({ db: semCard.db, ...evento })).toBe(1);
    expect(semCard.chamadas.some((c) => c.tabela === 'deals')).toBe(true);
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
      const lendo = bancoFalso({ erroNasEsperas: 'timeout' });
      await expect(cancelarEsperasAoSairDaEtapa({ db: lendo.db, ...evento })).resolves.toBe(0);
      const cancelando = bancoFalso({ esperas: [esperaPresa], erroNoCancelamento: 'timeout' });
      await expect(cancelarEsperasAoSairDaEtapa({ db: cancelando.db, ...evento })).resolves.toBe(0);
    } finally {
      calado.mockRestore();
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CHAVE_PARAR_SE_RESPONDER,
  DETALHE_DA_INTERRUPCAO,
  cancelarEsperasPorResposta,
  contextoDaEspera,
  semMarcaDeResposta,
} from './parar-se-responder';

describe('contextoDaEspera — o que vai para a fila', () => {
  it('caixa marcada: grava o id do passo na marca e preserva o resto', () => {
    const ctx = { conversation_id: 'conv-1', channel_id: 'ch-1' };
    expect(contextoDaEspera(ctx, { parar_se_responder: true }, 'esp-1')).toEqual({
      conversation_id: 'conv-1',
      channel_id: 'ch-1',
      [CHAVE_PARAR_SE_RESPONDER]: 'esp-1',
    });
  });

  it('caixa desmarcada: sem marca', () => {
    const ctx = { conversation_id: 'conv-1' };
    expect(contextoDaEspera(ctx, { parar_se_responder: false }, 'esp-1')).toEqual(ctx);
    expect(contextoDaEspera(ctx, {}, 'esp-1')).toEqual(ctx);
    expect(contextoDaEspera(ctx, null, 'esp-1')).toEqual(ctx);
  });

  it('⚠️ marca HERDADA é apagada quando esta espera não é marcada', () => {
    // A defesa em profundidade da invariante: mesmo que a marca chegue viva
    // no contexto (retomada que esqueceu de limpar), a espera NÃO marcada não
    // a leva adiante.
    const herdado = { conversation_id: 'conv-1', [CHAVE_PARAR_SE_RESPONDER]: 'esp-velha' };
    const r = contextoDaEspera(herdado, {}, 'esp-nova');
    expect(CHAVE_PARAR_SE_RESPONDER in r).toBe(false);
  });

  it('⚠️ marca herdada é SUBSTITUÍDA pelo id desta espera', () => {
    const herdado = { [CHAVE_PARAR_SE_RESPONDER]: 'esp-velha' };
    const r = contextoDaEspera(herdado, { parar_se_responder: true }, 'esp-nova');
    expect((r as Record<string, unknown>)[CHAVE_PARAR_SE_RESPONDER]).toBe('esp-nova');
  });

  it('⚠️ só o booleano true liga', () => {
    for (const valor of ['true', 1, {}, [], 'sim']) {
      const r = contextoDaEspera({}, { parar_se_responder: valor }, 'esp-1');
      expect(CHAVE_PARAR_SE_RESPONDER in r).toBe(false);
    }
  });

  it('não altera o contexto recebido', () => {
    const ctx = { vars: { a: 1 } };
    contextoDaEspera(ctx, { parar_se_responder: true }, 'esp-1');
    expect(ctx).toEqual({ vars: { a: 1 } });
  });
});

describe('semMarcaDeResposta — a retomada', () => {
  it('tira só a marca', () => {
    const r = semMarcaDeResposta({
      conversation_id: 'conv-1',
      _tentativa: { pos: 2, n: 1 },
      [CHAVE_PARAR_SE_RESPONDER]: 'esp-1',
    });
    expect(r).toEqual({ conversation_id: 'conv-1', _tentativa: { pos: 2, n: 1 } });
  });

  it('sem marca, devolve o MESMO objeto', () => {
    const ctx = { conversation_id: 'conv-1' };
    expect(semMarcaDeResposta(ctx)).toBe(ctx);
  });
});

// ------------------------------------------------------------
// O cancelamento, contra um banco falso que registra o que foi pedido.
// ------------------------------------------------------------

type Filtro = [string, string, unknown, unknown?];

interface Chamada {
  tabela: string;
  tipo: 'update' | 'select';
  payload?: unknown;
  filtros: Filtro[];
}

function bancoFalso(opcoes: {
  /** O que o 1º UPDATE (as MARCADAS) devolve. */
  canceladas?: { id: string; log_id: string | null; passo: string | null }[];
  /** O que o 2º UPDATE (as IRMÃS, por `log_id`) devolve. */
  irmas?: { id: string }[];
  erroNoCancelamento?: string;
  erroNasIrmas?: string;
  estouraNoCancelamento?: boolean;
  passosDoLog?: unknown;
  erroNaNota?: string;
  /** Linhas devolvidas pelo SELECT da fila (o sinal da execução). */
  sinal?: { id: string }[];
  erroNoSinal?: string;
  /** As esperas MARCADAS em `running` (o cron acabou de reivindicá-las). */
  emCurso?: { id: string; log_id: string | null; passo: string | null }[];
  erroEmCurso?: string;
}) {
  const chamadas: Chamada[] = [];

  const db = {
    from(tabela: string) {
      const op = {
        tabela,
        tipo: 'select' as 'update' | 'select',
        payload: undefined as unknown,
        filtros: [] as Filtro[],
      };
      chamadas.push(op);
      const resolver = () => {
        if (tabela === 'automation_pending_executions') {
          if (op.tipo === 'select') {
            if (op.filtros.some(([o, k, v]) => o === 'eq' && k === 'status' && v === 'running')) {
              if (opcoes.erroEmCurso) return { data: null, error: { message: opcoes.erroEmCurso } };
              return { data: opcoes.emCurso ?? [], error: null };
            }
            if (opcoes.erroNoSinal) return { data: null, error: { message: opcoes.erroNoSinal } };
            return { data: opcoes.sinal ?? [], error: null };
          }
          const ehDasIrmas = op.filtros.some(([o, k]) => o === 'in' && k === 'log_id');
          if (ehDasIrmas) {
            if (opcoes.erroNasIrmas) return { data: null, error: { message: opcoes.erroNasIrmas } };
            return { data: opcoes.irmas ?? [], error: null };
          }
          if (opcoes.estouraNoCancelamento) throw new Error('rede caiu');
          if (opcoes.erroNoCancelamento) {
            return { data: null, error: { message: opcoes.erroNoCancelamento } };
          }
          return { data: opcoes.canceladas ?? [], error: null };
        }
        // automation_logs
        if (op.tipo === 'update') {
          return opcoes.erroNaNota
            ? { data: null, error: { message: opcoes.erroNaNota } }
            : { data: [{ id: 'log' }], error: null };
        }
        return { data: { steps_executed: opcoes.passosDoLog ?? [] }, error: null };
      };
      const b: Record<string, unknown> = {
        update: (p: unknown) => ((op.tipo = 'update'), (op.payload = p), b),
        select: () => b,
        eq: (k: string, v: unknown) => (op.filtros.push(['eq', k, v]), b),
        in: (k: string, v: unknown) => (op.filtros.push(['in', k, v]), b),
        is: (k: string, v: unknown) => (op.filtros.push(['is', k, v]), b),
        not: (k: string, o: string, v: unknown) => (op.filtros.push(['not', k, o, v]), b),
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

const updatesDaFila = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.tabela === 'automation_pending_executions' && c.tipo === 'update');
const notas = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.tabela === 'automation_logs' && c.tipo === 'update');

describe('cancelarEsperasPorResposta', () => {
  it('⚠️⚠️ as cercas: conta + CONTATO + pending + marca presente', async () => {
    const { db, chamadas } = bancoFalso({});
    await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    const cancelamento = chamadas[0];
    expect(cancelamento.tabela).toBe('automation_pending_executions');
    expect(cancelamento.tipo).toBe('update');
    expect(cancelamento.payload).toEqual({ status: 'cancelled' });
    // Sem o contato, a resposta de UM cliente pararia a sequência de TODOS.
    expect(cancelamento.filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'pending'],
      ['not', `context->>${CHAVE_PARAR_SE_RESPONDER}`, 'is', null],
    ]);
  });

  it('⚠️⚠️ a parada é da EXECUÇÃO: as esperas IRMÃS do mesmo log também caem (Codex, PR #223)', async () => {
    // Espera marcada DENTRO de um ramo + espera SEM marca no escopo de fora,
    // mesma execução. Só a marcada caindo, a de fora acordava e a sequência
    // seguia — com a caixa prometendo "parar a automação".
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p-ramo', log_id: 'log-1', passo: 'esp-1' }],
      irmas: [{ id: 'p-raiz' }],
    });

    const n = await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    expect(n).toBe(2);
    // A MARCA da 1005 vai para o REGISTRO, antes das irmãs: é ela que a
    // retomada e o estacionamento consultam.
    const marca = chamadas.find((c) => c.tabela === 'automation_logs' && c.tipo === 'update');
    expect(marca?.payload).toMatchObject({ interrompida_por: 'resposta' });
    expect(marca?.filtros).toEqual([
      ['in', 'id', ['log-1']],
      ['is', 'interrompida_em', null],
    ]);
    const [, dasIrmas] = updatesDaFila(chamadas);
    expect(dasIrmas.payload).toEqual({ status: 'cancelled' });
    // Pela EXECUÇÃO (`log_id`), e com as mesmas cercas: conta, contato, pending.
    expect(dasIrmas.filtros).toEqual([
      ['in', 'log_id', ['log-1']],
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'pending'],
    ]);
  });

  it('nada marcado: nem procura irmã — resposta do cliente não para automação que não pediu', async () => {
    const { db, chamadas } = bancoFalso({ canceladas: [], irmas: [{ id: 'x' }] });
    const n = await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    expect(n).toBe(0);
    // A foto das pendentes + a leitura das marcadas em curso (9ª rodada); nada
    // de marca nem de irmãs.
    expect(chamadas).toHaveLength(2);
    expect(chamadas.filter((c) => c.tabela === 'automation_logs')).toHaveLength(0);
  });

  it('UMA anotação por execução, com o passo da primeira espera marcada', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [
        { id: 'p1', log_id: 'log-1', passo: 'esp-1' },
        { id: 'p2', log_id: 'log-1', passo: 'esp-2' },
        { id: 'p3', log_id: 'log-2', passo: 'esp-9' },
      ],
      passosDoLog: [{ step_id: 's0', step_type: 'send_message', status: 'success' }],
    });

    await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    const gravadas = notas(chamadas).filter((c) => 'steps_executed' in (c.payload as object));
    expect(gravadas.map((g) => g.filtros[0])).toEqual([
      ['eq', 'id', 'log-1'],
      ['eq', 'id', 'log-2'],
    ]);
    // Acrescenta — o que a execução já fez continua no registro.
    expect(gravadas[0].payload).toEqual({
      steps_executed: [
        { step_id: 's0', step_type: 'send_message', status: 'success' },
        { step_id: 'esp-1', step_type: 'wait', status: 'skipped', detail: DETALHE_DA_INTERRUPCAO },
      ],
    });
  });

  it('⚠️ a anotação NÃO toca status nem desfecho — como os outros cancelamentos', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p1', log_id: 'log-1', passo: 'esp-1' }],
    });
    await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    const daAnotacao = notas(chamadas).find((c) => 'steps_executed' in (c.payload as object));
    expect(Object.keys(daAnotacao?.payload as object)).toEqual(['steps_executed']);
  });

  it('espera sem log: cancela, mas não tem execução para estender nem onde anotar', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p1', log_id: null, passo: 'esp-1' }],
    });
    const n = await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    expect(n).toBe(1);
    expect(updatesDaFila(chamadas)).toHaveLength(1);
    expect(chamadas.some((c) => c.tabela === 'automation_logs')).toBe(false);
  });

  it('⚠️ NUNCA lança: erro do banco vira zero (a mensagem do cliente não pode se perder)', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const comErro = bancoFalso({ erroNoCancelamento: 'permission denied' });
      await expect(
        cancelarEsperasPorResposta({ db: comErro.db, accountId: 'a', contactId: 'c' })
      ).resolves.toBe(0);

      const estourando = bancoFalso({ estouraNoCancelamento: true });
      await expect(
        cancelarEsperasPorResposta({ db: estourando.db, accountId: 'a', contactId: 'c' })
      ).resolves.toBe(0);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️ falha ao cancelar as IRMÃS não desfaz a marcada nem estoura — a retomada as segura', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db } = bancoFalso({
        canceladas: [{ id: 'p1', log_id: 'log-1', passo: 'esp-1' }],
        erroNasIrmas: 'timeout',
      });
      await expect(
        cancelarEsperasPorResposta({ db, accountId: 'a', contactId: 'c' })
      ).resolves.toBe(1);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️ anotação que falha não desfaz o cancelamento nem estoura', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db } = bancoFalso({
        canceladas: [{ id: 'p1', log_id: 'log-1', passo: 'esp-1' }],
        erroNaNota: 'timeout',
      });
      await expect(
        cancelarEsperasPorResposta({ db, accountId: 'a', contactId: 'c' })
      ).resolves.toBe(1);
    } finally {
      calado.mockRestore();
    }
  });
});

describe('a espera marcada já RUNNING (Codex, 9ª rodada)', () => {
  it('⚠️⚠️ marca e anota a execução, sem cancelar a linha — que é do cron', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [],
      emCurso: [{ id: 'p-running', log_id: 'log-running', passo: 's-wait' }],
      irmas: [],
    });
    await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    const marcas = chamadas.filter((c) => c.tabela === 'automation_logs' && c.tipo === 'update' && (c.payload as { interrompida_por?: string })?.interrompida_por === 'resposta');
    expect(marcas).toHaveLength(1);
    expect(marcas[0].filtros.find(([, k]) => k === 'id')).toEqual(['in', 'id', ['log-running']]);
    // A linha `running` não é tocada: só `pending` cai (a foto e a varredura das irmãs).
    const naFila = chamadas.filter((c) => c.tabela === 'automation_pending_executions' && c.tipo === 'update');
    for (const u of naFila) expect(u.filtros).toContainEqual(['eq', 'status', 'pending']);
    // E a leitura das em curso é POR conta + contato + running + marca.
    const leitura = chamadas.find((c) => c.tabela === 'automation_pending_executions' && c.tipo === 'select');
    expect(leitura?.filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['eq', 'status', 'running'],
      ['not', 'context->>_parar_se_responder', 'is', null],
    ]);
  });

  it('leitura das em curso falhou: as canceladas seguem marcadas normalmente', async () => {
    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db, chamadas } = bancoFalso({
        canceladas: [{ id: 'p1', log_id: 'log-1', passo: 's-wait' }],
        erroEmCurso: 'timeout',
        irmas: [],
      });
      expect(await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' })).toBe(1);
      const marca = chamadas.find((c) => c.tabela === 'automation_logs' && c.tipo === 'update');
      expect(marca?.payload).toMatchObject({ interrompida_por: 'resposta' });
    } finally {
      calado.mockRestore();
    }
  });
});

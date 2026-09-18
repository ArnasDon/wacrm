import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CHAVE_PARAR_SE_RESPONDER,
  DETALHE_DA_INTERRUPCAO,
  cancelarEsperasPorResposta,
  contextoDaEspera,
  execucaoInterrompidaPorResposta,
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
    expect(chamadas).toHaveLength(1);
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

    const gravadas = notas(chamadas);
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

    expect(Object.keys(notas(chamadas)[0].payload as object)).toEqual(['steps_executed']);
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

describe('execucaoInterrompidaPorResposta — o sinal que a retomada consulta', () => {
  it('o sinal é a própria fila: espera MARCADA desta execução em cancelled', async () => {
    const { db, chamadas } = bancoFalso({ sinal: [{ id: 'p-marcada' }] });

    expect(await execucaoInterrompidaPorResposta(db, 'log-1')).toBe(true);
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'log_id', 'log-1'],
      ['eq', 'status', 'cancelled'],
      ['not', `context->>${CHAVE_PARAR_SE_RESPONDER}`, 'is', null],
    ]);
  });

  it('sem linha: a execução segue', async () => {
    const { db } = bancoFalso({ sinal: [] });
    expect(await execucaoInterrompidaPorResposta(db, 'log-1')).toBe(false);
  });

  it('sem log não há execução a consultar — nem vai ao banco', async () => {
    const { db, chamadas } = bancoFalso({ sinal: [{ id: 'x' }] });
    expect(await execucaoInterrompidaPorResposta(db, null)).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('⚠️ falha ABERTA: erro de leitura não trava a retomada de toda automação', async () => {
    const { db } = bancoFalso({ erroNoSinal: 'timeout' });
    expect(await execucaoInterrompidaPorResposta(db, 'log-1')).toBe(false);
  });
});

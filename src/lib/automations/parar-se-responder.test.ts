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

function bancoFalso(opcoes: {
  canceladas?: { id: string; log_id: string | null; passo: string | null }[];
  erroNoCancelamento?: string;
  estouraNoCancelamento?: boolean;
  passosDoLog?: unknown;
  erroNaNota?: string;
}) {
  const chamadas: {
    tabela: string;
    tipo: 'update' | 'select';
    payload?: unknown;
    filtros: Filtro[];
    select?: string;
  }[] = [];

  const db = {
    from(tabela: string) {
      const op = {
        tabela,
        tipo: 'select' as 'update' | 'select',
        payload: undefined as unknown,
        filtros: [] as Filtro[],
        select: undefined as string | undefined,
      };
      chamadas.push(op);
      const resolver = () => {
        if (tabela === 'automation_pending_executions') {
          if (opcoes.estouraNoCancelamento) throw new Error('rede caiu');
          if (opcoes.erroNoCancelamento) {
            return { data: null, error: { message: opcoes.erroNoCancelamento } };
          }
          return { data: opcoes.canceladas ?? [], error: null };
        }
        // automation_logs
        if (op.tipo === 'update') {
          return {
            data: null,
            error: opcoes.erroNaNota ? { message: opcoes.erroNaNota } : null,
          };
        }
        return { data: { steps_executed: opcoes.passosDoLog ?? [] }, error: null };
      };
      const b: Record<string, unknown> = {
        update: (p: unknown) => ((op.tipo = 'update'), (op.payload = p), b),
        select: (s?: string) => ((op.select = s), b),
        eq: (k: string, v: unknown) => (op.filtros.push(['eq', k, v]), b),
        not: (k: string, o: string, v: unknown) => (op.filtros.push(['not', k, o, v]), b),
        maybeSingle: () => Promise.resolve().then(resolver),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve().then(resolver).then(onF, onR),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, chamadas };
}

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

  it('devolve quantas cancelou e ANOTA a interrupção no registro de cada uma', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p1', log_id: 'log-1', passo: 'esp-1' }],
      passosDoLog: [{ step_id: 's0', step_type: 'send_message', status: 'success' }],
    });

    const n = await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    expect(n).toBe(1);
    const nota = chamadas.find((c) => c.tabela === 'automation_logs' && c.tipo === 'update');
    expect(nota?.filtros).toEqual([['eq', 'id', 'log-1']]);
    // Acrescenta — o que a execução já fez continua no registro.
    expect(nota?.payload).toEqual({
      steps_executed: [
        { step_id: 's0', step_type: 'send_message', status: 'success' },
        {
          step_id: 'esp-1',
          step_type: 'wait',
          status: 'skipped',
          detail: DETALHE_DA_INTERRUPCAO,
        },
      ],
    });
  });

  it('⚠️ a anotação NÃO toca status nem desfecho — como os outros cancelamentos', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p1', log_id: 'log-1', passo: 'esp-1' }],
    });
    await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    const nota = chamadas.find((c) => c.tabela === 'automation_logs' && c.tipo === 'update');
    expect(Object.keys(nota?.payload as object)).toEqual(['steps_executed']);
  });

  it('espera sem log não tenta anotar', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p1', log_id: null, passo: 'esp-1' }],
    });
    const n = await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    expect(n).toBe(1);
    expect(chamadas.some((c) => c.tabela === 'automation_logs')).toBe(false);
  });

  it('nada a cancelar: zero, e nenhuma escrita no registro', async () => {
    const { db, chamadas } = bancoFalso({ canceladas: [] });
    const n = await cancelarEsperasPorResposta({ db, accountId: 'acct-1', contactId: 'c1' });

    expect(n).toBe(0);
    expect(chamadas).toHaveLength(1);
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

  it('registro com `steps_executed` que não é lista recomeça do vazio', async () => {
    const { db, chamadas } = bancoFalso({
      canceladas: [{ id: 'p1', log_id: 'log-1', passo: 'esp-1' }],
      passosDoLog: null,
    });
    await cancelarEsperasPorResposta({ db, accountId: 'a', contactId: 'c' });

    const nota = chamadas.find((c) => c.tabela === 'automation_logs' && c.tipo === 'update');
    expect((nota?.payload as { steps_executed: unknown[] }).steps_executed).toHaveLength(1);
  });
});

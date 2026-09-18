import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { anotarInterrupcao, execucaoJaInterrompida, marcarExecucoesInterrompidas } from './interrupcao';

// ============================================================
// A anotação grava COM CERCA: "só se ninguém acrescentou nada desde que li".
// O banco falso aqui simula o outro escritor — o `appendResults` do motor —
// chegando no meio, que é o caso que o Codex apontou no PR #223.
// ============================================================

type Filtro = [string, string, unknown];

function logFalso(opcoes: {
  /** O que cada LEITURA devolve, em ordem (a última se repete). */
  leituras: unknown[][];
  /** Quantas gravações perdem a corrida (0 linhas) antes de uma vencer. */
  derrotas?: number;
  erroNaGravacao?: string;
}) {
  const gravacoes: { payload: { steps_executed: unknown[] }; filtros: Filtro[] }[] = [];
  let leitura = 0;
  let derrotas = opcoes.derrotas ?? 0;

  const db = {
    from() {
      const op = { tipo: 'select', payload: undefined as unknown, filtros: [] as Filtro[] };
      const resolver = () => {
        if (op.tipo === 'select') {
          const passos = opcoes.leituras[Math.min(leitura, opcoes.leituras.length - 1)];
          leitura += 1;
          return { data: { steps_executed: passos }, error: null };
        }
        gravacoes.push({ payload: op.payload as { steps_executed: unknown[] }, filtros: op.filtros });
        if (opcoes.erroNaGravacao) return { data: null, error: { message: opcoes.erroNaGravacao } };
        if (derrotas > 0) {
          derrotas -= 1;
          return { data: [], error: null };
        }
        return { data: [{ id: 'log-1' }], error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: unknown) => ((op.tipo = 'update'), (op.payload = p), b),
        eq: (k: string, v: unknown) => (op.filtros.push(['eq', k, v]), b),
        is: (k: string, v: unknown) => (op.filtros.push(['is', k, v]), b),
        maybeSingle: () => Promise.resolve().then(resolver),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve().then(resolver).then(onF, onR),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, gravacoes, leituras: () => leitura };
}

const PASSO = { step_id: 's0', step_type: 'send_message', status: 'success' };

describe('anotarInterrupcao', () => {
  it('⚠️⚠️ a cerca: só grava se a posição N do array continuar VAZIA', async () => {
    const { db, gravacoes } = logFalso({ leituras: [[PASSO, PASSO]] });
    await anotarInterrupcao(db, 'log-1', 'esp-1', 'motivo');

    expect(gravacoes).toHaveLength(1);
    // Li 2 passos → a posição 2 tem de estar vazia. Todo escritor só
    // ACRESCENTA, então "posição N vazia" = "ninguém escreveu desde que li".
    expect(gravacoes[0].filtros).toEqual([
      ['eq', 'id', 'log-1'],
      ['is', 'steps_executed->>2', null],
    ]);
    expect(gravacoes[0].payload.steps_executed).toEqual([
      PASSO,
      PASSO,
      { step_id: 'esp-1', step_type: 'wait', status: 'skipped', detail: 'motivo' },
    ]);
  });

  it('⚠️⚠️ o motor gravou no meio: RELÊ e acrescenta por cima do que ELE gravou — nunca apaga passo do motor', async () => {
    const doMotor = { step_id: 's1', step_type: 'move_deal_stage', status: 'success' };
    const { db, gravacoes } = logFalso({
      leituras: [[PASSO], [PASSO, doMotor]],
      derrotas: 1,
    });
    await anotarInterrupcao(db, 'log-1', null, 'motivo');

    expect(gravacoes).toHaveLength(2);
    // A 1ª tentativa perdeu (0 linhas) e NÃO valeu; a 2ª parte do array NOVO.
    expect(gravacoes[1].filtros[1]).toEqual(['is', 'steps_executed->>2', null]);
    expect(gravacoes[1].payload.steps_executed.slice(0, 2)).toEqual([PASSO, doMotor]);
    expect(gravacoes[1].payload.steps_executed).toHaveLength(3);
  });

  it('o registro não para de mudar: desiste da anotação em vez de insistir para sempre', async () => {
    const calado = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { db, gravacoes } = logFalso({ leituras: [[PASSO]], derrotas: 99 });
      await expect(anotarInterrupcao(db, 'log-1', null, 'motivo')).resolves.toBeUndefined();
      expect(gravacoes).toHaveLength(3);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️ IDEMPOTENTE por motivo: a execução já anotada não ganha a mesma linha de novo', async () => {
    // Duas esperas irmãs da mesma execução acordam em horas diferentes com o
    // card fora da etapa: a segunda NÃO pode contar outra interrupção.
    const jaLa = { step_id: '', step_type: 'wait', status: 'skipped', detail: 'motivo' };
    const { db, gravacoes } = logFalso({ leituras: [[PASSO, jaLa]] });
    await anotarInterrupcao(db, 'log-1', null, 'motivo');
    expect(gravacoes).toHaveLength(0);

    // Outro MOTIVO na mesma execução é outra informação, e entra.
    const outro = logFalso({ leituras: [[PASSO, jaLa]] });
    await anotarInterrupcao(outro.db, 'log-1', null, 'outro motivo');
    expect(outro.gravacoes).toHaveLength(1);
  });

  it('registro vazio ou que não é lista: a cerca é a posição 0', async () => {
    const { db, gravacoes } = logFalso({ leituras: [null as unknown as unknown[]] });
    await anotarInterrupcao(db, 'log-1', null, 'motivo');

    expect(gravacoes[0].filtros[1]).toEqual(['is', 'steps_executed->>0', null]);
    expect(gravacoes[0].payload.steps_executed).toHaveLength(1);
  });

  it('sem log não vai ao banco; erro de gravação não estoura nem insiste', async () => {
    const semLog = logFalso({ leituras: [[]] });
    await anotarInterrupcao(semLog.db, null, null, 'motivo');
    expect(semLog.leituras()).toBe(0);

    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const comErro = logFalso({ leituras: [[]], erroNaGravacao: 'timeout' });
      await expect(anotarInterrupcao(comErro.db, 'log-1', null, 'motivo')).resolves.toBeUndefined();
      expect(comErro.gravacoes).toHaveLength(1);
    } finally {
      calado.mockRestore();
    }
  });
});

describe('a MARCA durável da execução (1005)', () => {
  function logsFalsos(opcoes: { linha?: Record<string, unknown> | null; marcadas?: { id: string }[]; erro?: string }) {
    const chamadas: { tipo: string; payload?: unknown; filtros: [string, string, unknown][] }[] = [];
    const db = {
      from() {
        const op = { tipo: 'select', payload: undefined as unknown, filtros: [] as [string, string, unknown][] };
        chamadas.push(op);
        const resolver = () => {
          if (opcoes.erro) return { data: null, error: { message: opcoes.erro } };
          if (op.tipo === 'update') return { data: opcoes.marcadas ?? [], error: null };
          return { data: opcoes.linha === undefined ? null : opcoes.linha, error: null };
        };
        const b: Record<string, unknown> = {
          select: () => b,
          update: (p: unknown) => ((op.tipo = 'update'), (op.payload = p), b),
          eq: (k: string, v: unknown) => (op.filtros.push(['eq', k, v]), b),
          in: (k: string, v: unknown) => (op.filtros.push(['in', k, v]), b),
          is: (k: string, v: unknown) => (op.filtros.push(['is', k, v]), b),
          maybeSingle: () => Promise.resolve().then(resolver),
          then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
            Promise.resolve().then(resolver).then(onF, onR),
        };
        return b;
      },
    };
    return { db: db as unknown as SupabaseClient, chamadas };
  }

  it('⚠️⚠️ marcar: por REGISTRO, com o motivo, e só a PRIMEIRA marca fica', async () => {
    const { db, chamadas } = logsFalsos({ marcadas: [{ id: 'log-1' }] });
    const n = await marcarExecucoesInterrompidas(db, ['log-1', null, 'log-1', undefined, 'log-2'], 'resposta');

    expect(n).toBe(1);
    expect(chamadas[0].tipo).toBe('update');
    expect(chamadas[0].payload).toMatchObject({ interrompida_por: 'resposta' });
    expect((chamadas[0].payload as { interrompida_em: string }).interrompida_em).toMatch(/^\d{4}-/);
    expect(chamadas[0].filtros).toEqual([
      ['in', 'id', ['log-1', 'log-2']],
      // Quem interrompeu primeiro é o motivo que vale.
      ['is', 'interrompida_em', null],
    ]);
  });

  it('marcar: sem registro não vai ao banco; erro vira zero, nunca estoura', async () => {
    const vazio = logsFalsos({});
    expect(await marcarExecucoesInterrompidas(vazio.db, [null, undefined], 'parar')).toBe(0);
    expect(vazio.chamadas).toHaveLength(0);

    const calado = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const comErro = logsFalsos({ erro: 'timeout' });
      await expect(marcarExecucoesInterrompidas(comErro.db, ['log-1'], 'etapa')).resolves.toBe(0);
    } finally {
      calado.mockRestore();
    }
  });

  it('⚠️⚠️ o sinal é a MARCA do registro: qualquer cancelamento a grava, e a retomada a lê', async () => {
    const { db, chamadas } = logsFalsos({ linha: { interrompida_em: '2026-09-18T12:00:00Z' } });
    expect(await execucaoJaInterrompida(db, 'log-1')).toBe(true);
    expect(chamadas[0].filtros).toEqual([['eq', 'id', 'log-1']]);
  });

  it('sem marca: a execução segue', async () => {
    const { db } = logsFalsos({ linha: { interrompida_em: null } });
    expect(await execucaoJaInterrompida(db, 'log-1')).toBe(false);
  });

  it('sem log não há execução a consultar — nem vai ao banco', async () => {
    const { db, chamadas } = logsFalsos({ linha: { interrompida_em: 'x' } });
    expect(await execucaoJaInterrompida(db, null)).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('⚠️ falha ABERTA: erro de leitura não trava a retomada de toda automação', async () => {
    const { db } = logsFalsos({ erro: 'timeout' });
    expect(await execucaoJaInterrompida(db, 'log-1')).toBe(false);
  });
});

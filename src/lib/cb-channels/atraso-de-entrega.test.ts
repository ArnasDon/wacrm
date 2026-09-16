import { describe, expect, it } from 'vitest';

import {
  ESPACAMENTO_DE_GRAVACAO_SEG,
  LIMIAR_ATRASO_SEG,
  TOLERANCIA_DE_RELOGIO_SEG,
  atrasoDaFronteira,
  entregaAtrasada,
  espacamentoLiberou,
  moveAFronteira,
  podeIgnorarOEspacamento,
  registrarEntrega,
} from './atraso-de-entrega';

const T = (iso: string) => Date.parse(iso);

describe('atrasoDaFronteira', () => {
  it('mede a distância entre o carimbo do WhatsApp e a gravação', () => {
    expect(
      atrasoDaFronteira({
        carimboIso: '2026-09-16T14:30:25.000Z',
        recebidaIso: '2026-09-16T14:58:48.000Z',
      }),
    ).toBe(1703); // o episódio real de 16/09: 28min23s
  });

  it('nunca mediu é null, NÃO zero', () => {
    // A distinção é a feature: zero seria a afirmação "entrega instantânea"
    // sobre uma conexão que ninguém mediu ainda.
    expect(atrasoDaFronteira({ carimboIso: null, recebidaIso: null })).toBeNull();
    expect(
      atrasoDaFronteira({ carimboIso: '2026-09-16T14:30:00.000Z', recebidaIso: null }),
    ).toBeNull();
    expect(
      atrasoDaFronteira({ carimboIso: null, recebidaIso: '2026-09-16T14:30:00.000Z' }),
    ).toBeNull();
  });

  it('carimbo ilegível é null, não NaN', () => {
    expect(
      atrasoDaFronteira({ carimboIso: 'ontem à tarde', recebidaIso: '2026-09-16T14:30:00.000Z' }),
    ).toBeNull();
  });

  it('relógio do remetente à frente vira zero, não negativo', () => {
    expect(
      atrasoDaFronteira({
        carimboIso: '2026-09-16T14:30:40.000Z',
        recebidaIso: '2026-09-16T14:30:00.000Z',
      }),
    ).toBe(0);
  });
});

describe('entregaAtrasada', () => {
  it('não sei nunca acusa', () => {
    expect(entregaAtrasada(null)).toBe(false);
  });

  it('a operação normal medida (segundos) não acusa', () => {
    // 10 dias antes do episódio: 0,0–0,1 min. O limiar não pode pegar isto.
    expect(entregaAtrasada(0)).toBe(false);
    expect(entregaAtrasada(6)).toBe(false);
  });

  it('acusa acima do limiar, e não nele', () => {
    expect(entregaAtrasada(LIMIAR_ATRASO_SEG)).toBe(false);
    expect(entregaAtrasada(LIMIAR_ATRASO_SEG + 1)).toBe(true);
  });

  it('acusa os episódios medidos (9 a 50 min)', () => {
    for (const min of [9, 16, 26, 29, 43, 50]) {
      expect(entregaAtrasada(min * 60)).toBe(true);
    }
  });
});

describe('moveAFronteira', () => {
  const agoraMs = T('2026-09-16T15:00:00.000Z');

  it('a primeira entrega da conexão sempre estabelece a fronteira', () => {
    expect(
      moveAFronteira({ carimboMs: T('2026-09-16T14:30:00.000Z'), carimboGuardadoIso: null, agoraMs }),
    ).toBe(true);
  });

  it('carimbo mais novo avança', () => {
    expect(
      moveAFronteira({
        carimboMs: T('2026-09-16T14:36:22.000Z'),
        carimboGuardadoIso: '2026-09-16T14:30:35.000Z',
        agoraMs,
      }),
    ).toBe(true);
  });

  it('⚠️ backlog fora de ordem NÃO puxa a fronteira para trás', () => {
    // A sequência real que a Evolution gravou em 16/09 enquanto drenava:
    // 11:36, 11:30, 11:23, 11:30, 11:29, 11:04, 11:04, 11:03. Aceitar a de
    // 11:04 apagaria o alarme que a de 11:36 acabou de acender.
    const fronteira = '2026-09-16T14:36:26.000Z';
    for (const atrasada of ['14:30:35', '14:23:22', '14:29:29', '14:04:25', '14:03:34']) {
      expect(
        moveAFronteira({
          carimboMs: T(`2026-09-16T${atrasada}.000Z`),
          carimboGuardadoIso: fronteira,
          agoraMs,
        }),
      ).toBe(false);
    }
  });

  it('carimbo igual não move (nada mudou)', () => {
    expect(
      moveAFronteira({
        carimboMs: T('2026-09-16T14:36:22.000Z'),
        carimboGuardadoIso: '2026-09-16T14:36:22.000Z',
        agoraMs,
      }),
    ).toBe(false);
  });

  it('⚠️ carimbo no futuro além da tolerância é recusado', () => {
    // Aceitar trava a fronteira à frente do relógio e mascara atraso real
    // até o tempo alcançá-la.
    expect(
      moveAFronteira({
        carimboMs: agoraMs + (TOLERANCIA_DE_RELOGIO_SEG + 60) * 1000,
        carimboGuardadoIso: null,
        agoraMs,
      }),
    ).toBe(false);
  });

  it('relógio torto dentro da tolerância ainda vale', () => {
    expect(
      moveAFronteira({
        carimboMs: agoraMs + 30_000,
        carimboGuardadoIso: null,
        agoraMs,
      }),
    ).toBe(true);
  });

  it('carimbo ausente ou zerado não move nada', () => {
    for (const carimboMs of [0, -1, Number.NaN]) {
      expect(moveAFronteira({ carimboMs, carimboGuardadoIso: null, agoraMs })).toBe(false);
    }
  });

  it('fronteira guardada ilegível é substituída, não respeitada', () => {
    expect(
      moveAFronteira({
        carimboMs: T('2026-09-16T14:30:00.000Z'),
        carimboGuardadoIso: 'lixo',
        agoraMs,
      }),
    ).toBe(true);
  });
});

describe('espaçamento de gravação (Codex, PR #220)', () => {
  const agoraMs = T('2026-09-16T15:00:00.000Z');
  const seg = (s: number) => new Date(agoraMs - s * 1000).toISOString();

  describe('espacamentoLiberou', () => {
    it('nunca gravou libera', () => {
      expect(espacamentoLiberou(null, agoraMs)).toBe(true);
    });

    it('carimbo ilegível libera — não travar por dado corrompido', () => {
      expect(espacamentoLiberou('não é data', agoraMs)).toBe(true);
    });

    it('segura dentro do intervalo e libera depois dele', () => {
      expect(espacamentoLiberou(seg(ESPACAMENTO_DE_GRAVACAO_SEG - 1), agoraMs)).toBe(false);
      expect(espacamentoLiberou(seg(ESPACAMENTO_DE_GRAVACAO_SEG), agoraMs)).toBe(true);
    });
  });

  describe('podeIgnorarOEspacamento — apagar o alarme nunca espera', () => {
    it('⚠️ O CENÁRIO DO CODEX: fronteira ATRASADA + amostra SAUDÁVEL grava já', () => {
      // O backlog drena em segundos e termina numa mensagem atual. Sem esta
      // regra, a atual cai no espaçamento, é descartada, o tráfego silencia
      // e a fronteira fica congelada na amostra atrasada — alarme aceso
      // sobre conexão já recuperada. Foi a forma exata da recuperação
      // medida em 16/09, quando o restart drenou 15 min de fila.
      expect(
        podeIgnorarOEspacamento(3, {
          carimboIso: seg(29 * 60),
          recebidaIso: seg(10),
        }),
      ).toBe(true);
    });

    it('fronteira atrasada + amostra AINDA atrasada respeita o espaçamento', () => {
      // Acender pode esperar o minuto: o episódio dura dezenas deles, e é
      // aqui que mora a rajada que o espaçamento existe para conter.
      expect(
        podeIgnorarOEspacamento(26 * 60, {
          carimboIso: seg(29 * 60),
          recebidaIso: seg(10),
        }),
      ).toBe(false);
    });

    it('operação normal (fronteira saudável + amostra saudável) respeita o espaçamento', () => {
      // Senão seria um UPDATE por mensagem recebida — e cada um faz a tela
      // refazer a sonda pelo realtime.
      expect(
        podeIgnorarOEspacamento(2, { carimboIso: seg(5), recebidaIso: seg(10) }),
      ).toBe(false);
    });

    it('conexão sem fronteira nenhuma respeita o espaçamento', () => {
      // `null` é "não sei", e não-sei não é alarme aceso para apagar.
      expect(
        podeIgnorarOEspacamento(2, { carimboIso: null, recebidaIso: null }),
      ).toBe(false);
    });

    it('a amostra exatamente no limiar já conta como saudável', () => {
      expect(
        podeIgnorarOEspacamento(LIMIAR_ATRASO_SEG, {
          carimboIso: seg(40 * 60),
          recebidaIso: seg(10),
        }),
      ).toBe(true);
      expect(
        podeIgnorarOEspacamento(LIMIAR_ATRASO_SEG + 1, {
          carimboIso: seg(40 * 60),
          recebidaIso: seg(10),
        }),
      ).toBe(false);
    });
  });
});

// ============================================================
// O I/O de `registrarEntrega`, com um dublê do supabase-js.
//
// A decisão é testada acima; isto cobre a SEQUÊNCIA — ler a fronteira,
// decidir, e só então escrever com a cerca — e as saídas silenciosas, que
// são as que ninguém vê falhar em produção (tudo vira `console.warn`).
// ============================================================
function duble(opcoes: {
  linha?: { entrega_carimbo_em: string | null; entrega_recebida_em: string | null } | null;
  erroNaLeitura?: { message: string };
  erroNaEscrita?: { message: string };
  lancaNaLeitura?: boolean;
}) {
  const updates: { valores: Record<string, string>; filtros: string[] }[] = [];
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  if (opcoes.lancaNaLeitura) throw new Error('rede caiu');
                  return {
                    data: opcoes.linha === undefined ? null : opcoes.linha,
                    error: opcoes.erroNaLeitura ?? null,
                  };
                },
              };
            },
          };
        },
        update(valores: Record<string, string>) {
          const reg = { valores, filtros: [] as string[] };
          updates.push(reg);
          const encadeia = {
            eq(_col: string, v: string) {
              reg.filtros.push(`eq:${v}`);
              return encadeia;
            },
            or(cond: string) {
              reg.filtros.push(`or:${cond}`);
              return encadeia;
            },
            then(resolve: (r: { error: unknown }) => unknown) {
              return Promise.resolve(resolve({ error: opcoes.erroNaEscrita ?? null }));
            },
          };
          return encadeia;
        },
      };
    },
  };
  return { db, updates };
}

describe('registrarEntrega — o I/O', () => {
  const agoraSeg = () => Math.floor(Date.now() / 1000);

  it('sem conexão não faz nada', async () => {
    const { db, updates } = duble({ linha: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, null, agoraSeg());
    expect(updates).toEqual([]);
  });

  it('a primeira entrega grava, com a cerca de avanço no WHERE', async () => {
    const { db, updates } = duble({
      linha: { entrega_carimbo_em: null, entrega_recebida_em: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, 'canal-1', agoraSeg());
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].valores).sort()).toEqual([
      'entrega_carimbo_em',
      'entrega_recebida_em',
    ]);
    // A cerca é o que impede o backlog fora de ordem de retroceder.
    expect(updates[0].filtros.some((f) => f.includes('entrega_carimbo_em.lt.'))).toBe(true);
    expect(updates[0].filtros.some((f) => f.includes('entrega_carimbo_em.is.null'))).toBe(true);
  });

  it('carimbo que NÃO avança não chega a escrever', async () => {
    const { db, updates } = duble({
      linha: {
        entrega_carimbo_em: new Date().toISOString(),
        entrega_recebida_em: new Date().toISOString(),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, 'canal-1', agoraSeg() - 3600);
    expect(updates).toEqual([]);
  });

  it('o espaçamento segura a rajada de amostras ATRASADAS', async () => {
    const agora = Date.now();
    const { db, updates } = duble({
      linha: {
        entrega_carimbo_em: new Date(agora - 40 * 60_000).toISOString(),
        entrega_recebida_em: new Date(agora - 5_000).toISOString(),
      },
    });
    // avança (35 min < 40 min de atraso), mas continua atrasada
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, 'canal-1', Math.floor((agora - 35 * 60_000) / 1000));
    expect(updates).toEqual([]);
  });

  it('⚠️ a amostra SAUDÁVEL que fecha o backlog grava na hora (Codex, PR #220)', async () => {
    const agora = Date.now();
    const { db, updates } = duble({
      linha: {
        entrega_carimbo_em: new Date(agora - 29 * 60_000).toISOString(),
        entrega_recebida_em: new Date(agora - 5_000).toISOString(), // dentro do espaçamento
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, 'canal-1', agoraSeg());
    expect(updates).toHaveLength(1);
  });

  it('leitura que falha NÃO escreve no escuro', async () => {
    const { db, updates } = duble({ linha: null, erroNaLeitura: { message: 'timeout' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, 'canal-1', agoraSeg());
    expect(updates).toEqual([]);
  });

  it('NUNCA LANÇA — é o que permite o `await` no caminho da ingestão', async () => {
    const q = duble({ lancaNaLeitura: true });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registrarEntrega(q.db as any, 'canal-1', agoraSeg()),
    ).resolves.toBeUndefined();

    const w = duble({
      linha: { entrega_carimbo_em: null, entrega_recebida_em: null },
      erroNaEscrita: { message: 'coluna não existe' },
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registrarEntrega(w.db as any, 'canal-1', agoraSeg()),
    ).resolves.toBeUndefined();
  });

  it('carimbo no futuro além da tolerância não escreve', async () => {
    const { db, updates } = duble({
      linha: { entrega_carimbo_em: null, entrega_recebida_em: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarEntrega(db as any, 'canal-1', agoraSeg() + TOLERANCIA_DE_RELOGIO_SEG + 60);
    expect(updates).toEqual([]);
  });
});

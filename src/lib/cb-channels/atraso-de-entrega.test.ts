import { describe, expect, it } from 'vitest';

import {
  LIMIAR_ATRASO_SEG,
  TOLERANCIA_DE_RELOGIO_SEG,
  atrasoDaFronteira,
  entregaAtrasada,
  moveAFronteira,
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

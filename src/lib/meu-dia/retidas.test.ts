import { describe, expect, it } from 'vitest';

import { lerRetidas } from './retidas';

describe('lerRetidas', () => {
  it('lê a forma que a rota devolve', () => {
    expect(
      lerRetidas({
        quantidade: 3,
        itens: [
          { canalId: 'canal-1', recebidaEm: '2026-09-18T16:05:02.000Z', daEquipe: false },
          { canalId: null, recebidaEm: '2026-09-17T12:00:00.000Z', daEquipe: true },
        ],
      }),
    ).toEqual({
      quantidade: 3,
      itens: [
        { canalId: 'canal-1', recebidaEm: '2026-09-18T16:05:02.000Z', daEquipe: false },
        { canalId: null, recebidaEm: '2026-09-17T12:00:00.000Z', daEquipe: true },
      ],
    });
  });

  it('zero retidas é uma RESPOSTA (e é diferente de não saber)', () => {
    expect(lerRetidas({ quantidade: 0, itens: [] })).toEqual({ quantidade: 0, itens: [] });
  });

  it('⚠️ "não sei" nunca vira zero: null, ausente e corpo estranho devolvem null', () => {
    for (const bruto of [null, undefined, 'x', 7, [], {}, { itens: [] }, { quantidade: '2' }]) {
      expect(lerRetidas(bruto), JSON.stringify(bruto)).toBeNull();
    }
    expect(lerRetidas({ quantidade: -1, itens: [] })).toBeNull();
    expect(lerRetidas({ quantidade: 1.5, itens: [] })).toBeNull();
    expect(lerRetidas({ quantidade: Number.NaN, itens: [] })).toBeNull();
  });

  it('item torto é descartado sem derrubar a contagem', () => {
    const r = lerRetidas({
      quantidade: 4,
      itens: [
        null,
        'x',
        { canalId: 'c', recebidaEm: 'não é data' },
        { canalId: 7, recebidaEm: '2026-09-18T16:05:02.000Z', daEquipe: 'true' },
      ],
    });
    expect(r).toEqual({
      quantidade: 4,
      itens: [{ canalId: null, recebidaEm: '2026-09-18T16:05:02.000Z', daEquipe: false }],
    });
  });

  it('sem lista, a contagem ainda vale', () => {
    expect(lerRetidas({ quantidade: 2 })).toEqual({ quantidade: 2, itens: [] });
  });
});

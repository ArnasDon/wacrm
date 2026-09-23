import { describe, expect, it } from 'vitest';

import { pareceIdDeEtiqueta } from './id-de-etiqueta';

describe('pareceIdDeEtiqueta', () => {
  it('⚠️ o id que GET /api/v1/tags devolve é id, não nome — o caso de 22/09', () => {
    expect(pareceIdDeEtiqueta('32f2da4f-765d-4be1-9496-eec52528c356')).toBe(true);
  });

  it('aceita maiúsculas e espaço nas pontas', () => {
    expect(pareceIdDeEtiqueta('  32F2DA4F-765D-4BE1-9496-EEC52528C356 ')).toBe(true);
  });

  it('nome de etiqueta é nome', () => {
    for (const nome of ['Typebot', 'Bancário', 'Ag. Demissão', '-150k', 'VIP 2026']) {
      expect(pareceIdDeEtiqueta(nome)).toBe(false);
    }
  });

  it('só a forma canônica: sem hífen, entre chaves ou truncado continua nome', () => {
    expect(pareceIdDeEtiqueta('32f2da4f765d4be19496eec52528c356')).toBe(false);
    expect(pareceIdDeEtiqueta('{32f2da4f-765d-4be1-9496-eec52528c356}')).toBe(false);
    expect(pareceIdDeEtiqueta('32f2da4f-765d-4be1-9496-eec52528c35')).toBe(false);
    expect(pareceIdDeEtiqueta('32f2da4f-765d-4be1-9496-eec52528c356x')).toBe(false);
  });
});

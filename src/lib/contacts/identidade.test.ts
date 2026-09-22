import { describe, expect, it } from 'vitest';

import { identidadeDoContato, nomeDoContato } from './identidade';

describe('identidadeDoContato', () => {
  it('telefone primeiro, @ do Instagram depois', () => {
    expect(identidadeDoContato({ phone: '+5583980000016' })).toBe(
      '+5583980000016'
    );
    expect(
      identidadeDoContato({ phone: null, instagram_username: 'cbadv.bancario' })
    ).toBe('@cbadv.bancario');
    // Ficha unificada (Fase 5): tem os dois — o telefone continua sendo a
    // identidade principal, porque é por ele que o resto do CRM casa.
    expect(
      identidadeDoContato({ phone: '+5583980000016', instagram_username: 'x' })
    ).toBe('+5583980000016');
  });

  it('Instagram sem @ lido ainda NÃO vira o IGSID na tela', () => {
    expect(
      identidadeDoContato({ phone: null, instagram_id: '1234567890123456' })
    ).toBeNull();
    expect(identidadeDoContato({})).toBeNull();
  });
});

describe('nomeDoContato', () => {
  it('nome, senão identidade, senão o fallback da tela', () => {
    expect(nomeDoContato({ name: 'Ana', phone: '+55' }, '?')).toBe('Ana');
    expect(nomeDoContato({ name: '  ', phone: '+55' }, '?')).toBe('+55');
    expect(nomeDoContato({ name: null, instagram_username: 'ana' }, '?')).toBe(
      '@ana'
    );
    expect(nomeDoContato({ name: null, phone: null }, 'Cliente')).toBe(
      'Cliente'
    );
  });

  it('contato ausente cai no fallback, sem estourar', () => {
    expect(nomeDoContato(null, 'Sem contato')).toBe('Sem contato');
    expect(nomeDoContato(undefined, 'Sem contato')).toBe('Sem contato');
  });
});

import { describe, expect, it } from 'vitest';

import {
  aplicarMencao,
  filtrarMembros,
  mencionadosNoTexto,
  tokenSobOCursor,
  type MembroMencionavel,
} from './mentions';

const LEO: MembroMencionavel = { user_id: 'u-leo', rotulo: 'Rodrigo Tavares' };
const JOSE: MembroMencionavel = { user_id: 'u-jose', rotulo: 'José Marcos' };
const ANA: MembroMencionavel = { user_id: 'u-ana', rotulo: 'Ana Tavares' };
const EQUIPE = [LEO, JOSE, ANA];

describe('tokenSobOCursor', () => {
  it('acha o token quando o cursor está logo depois do @', () => {
    const texto = 'falar com @';
    expect(tokenSobOCursor(texto, texto.length)).toEqual({
      inicio: 10,
      termo: '',
    });
  });

  it('acha o termo parcial sendo digitado', () => {
    const texto = 'falar com @leo';
    expect(tokenSobOCursor(texto, texto.length)).toEqual({
      inicio: 10,
      termo: 'leo',
    });
  });

  it('aceita espaço no termo — nome de gente tem sobrenome', () => {
    const texto = 'ver com @Rodrigo Tav';
    expect(tokenSobOCursor(texto, texto.length)?.termo).toBe('Rodrigo Tav');
  });

  it('desiste depois de espaços demais, para não caçar o parágrafo inteiro', () => {
    const texto = 'ver com @Rodrigo Tavares Monteiro ontem';
    expect(tokenSobOCursor(texto, texto.length)).toBeNull();
  });

  it('IGNORA o @ de um e-mail — ele não vem depois de espaço', () => {
    const texto = 'mandar para leo@exemplo';
    expect(tokenSobOCursor(texto, texto.length)).toBeNull();
  });

  it('não atravessa quebra de linha', () => {
    const texto = 'primeira @linha\nsegunda';
    expect(tokenSobOCursor(texto, texto.length)).toBeNull();
  });

  it('vale o @ no começo absoluto do texto', () => {
    expect(tokenSobOCursor('@an', 3)).toEqual({ inicio: 0, termo: 'an' });
  });

  it('devolve null quando não há @ nenhum', () => {
    expect(tokenSobOCursor('anotação comum', 14)).toBeNull();
  });

  it('lê o token do CURSOR, não do fim do texto', () => {
    //                     0123456789
    const texto = 'oi @an tudo bem';
    expect(tokenSobOCursor(texto, 6)).toEqual({ inicio: 3, termo: 'an' });
  });

  it('devolve null para cursor fora do texto', () => {
    expect(tokenSobOCursor('oi', 99)).toBeNull();
    expect(tokenSobOCursor('oi', -1)).toBeNull();
  });
});

describe('filtrarMembros', () => {
  it('termo vazio mostra a equipe inteira', () => {
    expect(filtrarMembros(EQUIPE, '')).toEqual(EQUIPE);
  });

  it('ignora acento e caixa', () => {
    expect(filtrarMembros(EQUIPE, 'jose')).toEqual([JOSE]);
    expect(filtrarMembros(EQUIPE, 'JOSÉ')).toEqual([JOSE]);
  });

  it('quem casa pelo COMEÇO vem antes de quem casa no meio', () => {
    // "Tavares" é sobrenome de dois; só a Ana começa com "ana".
    const r = filtrarMembros(EQUIPE, 'tavares');
    expect(r.map((m) => m.user_id)).toEqual(['u-leo', 'u-ana']);

    const r2 = filtrarMembros(EQUIPE, 'ana');
    expect(r2[0]).toBe(ANA);
  });

  it('respeita o limite', () => {
    expect(filtrarMembros(EQUIPE, '', 2)).toHaveLength(2);
  });

  it('devolve vazio quando ninguém casa', () => {
    expect(filtrarMembros(EQUIPE, 'zzz')).toEqual([]);
  });
});

describe('aplicarMencao', () => {
  it('troca o token pelo rótulo e põe espaço no fim', () => {
    const texto = 'falar com @leo';
    const alvo = tokenSobOCursor(texto, texto.length)!;
    const r = aplicarMencao(texto, alvo.inicio, texto.length, LEO.rotulo);
    expect(r.texto).toBe('falar com @Rodrigo Tavares ');
    expect(r.cursor).toBe(r.texto.length);
  });

  it('preserva o que vinha DEPOIS do cursor', () => {
    const texto = 'oi @an tudo bem';
    const alvo = tokenSobOCursor(texto, 6)!;
    const r = aplicarMencao(texto, alvo.inicio, 6, ANA.rotulo);
    expect(r.texto).toBe('oi @Ana Tavares  tudo bem');
    expect(r.cursor).toBe('oi @Ana Tavares '.length);
  });
});

describe('mencionadosNoTexto', () => {
  it('acha quem está escrito no texto', () => {
    const texto = '@Rodrigo Tavares confere isso, por favor';
    expect(mencionadosNoTexto(texto, EQUIPE)).toEqual(['u-leo']);
  });

  it('acha mais de um, sem repetir', () => {
    const texto = '@Ana Tavares e @José Marcos — e de novo @Ana Tavares';
    expect(mencionadosNoTexto(texto, EQUIPE).sort()).toEqual([
      'u-ana',
      'u-jose',
    ]);
  });

  it('NÃO acha quem foi escolhido e depois apagado do texto', () => {
    // É a razão de a função existir: a verdade é o texto, não o clique.
    expect(mencionadosNoTexto('mudei de ideia', EQUIPE)).toEqual([]);
  });

  it('não confunde o nome sem @ com menção', () => {
    expect(mencionadosNoTexto('o Rodrigo Tavares ligou', EQUIPE)).toEqual([]);
  });

  it('NÃO menciona quem só é PREFIXO de outro colega', () => {
    // Regressão: com "Ana" e "Ana Tavares" na equipe, `@Ana Tavares` casava
    // com os dois, e a Ana levava no sino uma anotação sobre caso alheio.
    // Sobrenome repetido é o caso comum num escritório de família.
    const ana: MembroMencionavel = { user_id: 'u-ana-curta', rotulo: 'Ana' };
    const equipe = [ana, ANA]; // ANA = 'Ana Tavares'
    expect(mencionadosNoTexto('@Ana Tavares confere isso', equipe)).toEqual([
      'u-ana',
    ]);
  });

  it('menciona a curta quando é ela mesma que está escrita', () => {
    const ana: MembroMencionavel = { user_id: 'u-ana-curta', rotulo: 'Ana' };
    expect(mencionadosNoTexto('@Ana confere isso', [ana, ANA])).toEqual([
      'u-ana-curta',
    ]);
  });

  it('acha as duas quando as duas estão escritas', () => {
    const ana: MembroMencionavel = { user_id: 'u-ana-curta', rotulo: 'Ana' };
    const r = mencionadosNoTexto('@Ana Tavares e @Ana veem isso', [ana, ANA]);
    expect(r.sort()).toEqual(['u-ana', 'u-ana-curta']);
  });

  it('ignora membro sem rótulo em vez de casar com todo mundo', () => {
    // `memberLabel` cai para o id quando não há nome nem e-mail, mas um
    // rótulo vazio faria `texto.includes('@')` casar com qualquer menção.
    const anonimo: MembroMencionavel = { user_id: 'u-x', rotulo: '' };
    expect(mencionadosNoTexto('@Ana Tavares vê isso', [anonimo])).toEqual([]);
  });
});

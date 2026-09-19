import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { inserirNaOrdem } from './ordem-do-fio';

const m = (id: string, created_at: string) => ({ id, created_at });
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe('inserirNaOrdem', () => {
  const fio = [
    m('a', '2026-09-18T16:00:00+00:00'),
    m('b', '2026-09-18T16:04:11+00:00'),
    m('c', '2026-09-18T16:04:13+00:00'),
  ];

  it('mensagem em ordem (a regra): idêntico a acrescentar no fim', () => {
    const nova = m('d', '2026-09-18T16:05:00+00:00');
    expect(inserirNaOrdem(fio, nova)).toEqual([...fio, nova]);
  });

  it('o caso de 18/09: a fala das 13:03:54 gravada DEPOIS das respostas entra ANTES delas', () => {
    const fala = m('fala', '2026-09-18T16:03:54+00:00');
    expect(ids(inserirNaOrdem(fio, fala))).toEqual(['a', 'fala', 'b', 'c']);
  });

  it('mais antiga que tudo: vai para o começo', () => {
    expect(ids(inserirNaOrdem(fio, m('z', '2026-09-01T00:00:00+00:00')))).toEqual([
      'z',
      'a',
      'b',
      'c',
    ]);
  });

  it('fio vazio', () => {
    expect(ids(inserirNaOrdem([], m('x', '2026-09-18T16:00:00+00:00')))).toEqual(['x']);
  });

  it('empate de instante fica DEPOIS (a ordem de chegada desempata)', () => {
    expect(ids(inserirNaOrdem(fio, m('e', '2026-09-18T16:04:13+00:00')))).toEqual([
      'a',
      'b',
      'c',
      'e',
    ]);
    expect(ids(inserirNaOrdem(fio, m('e', '2026-09-18T16:04:11+00:00')))).toEqual([
      'a',
      'b',
      'e',
      'c',
    ]);
  });

  it('compara INSTANTES: o realtime e o REST escrevem frações diferentes', () => {
    const misto = [
      m('a', '2026-09-18T16:04:11.500000+00:00'),
      m('b', '2026-09-18T16:04:12+00:00'),
    ];
    // 16:04:11.9 é DEPOIS de 11.5 e ANTES de 12 — por texto, "11.9" > "12"? não; mas
    // "…:12+00:00" < "…:12.000+00:00" por texto, e o instante é o mesmo.
    expect(ids(inserirNaOrdem(misto, m('x', '2026-09-18T16:04:11.900+00:00')))).toEqual([
      'a',
      'x',
      'b',
    ]);
    expect(ids(inserirNaOrdem(misto, m('y', '2026-09-18T16:04:12.000000+00:00')))).toEqual([
      'a',
      'b',
      'y',
    ]);
  });

  it('carimbo ilegível cai no fim, como sempre foi', () => {
    expect(ids(inserirNaOrdem(fio, m('?', 'não é data')))).toEqual(['a', 'b', 'c', '?']);
  });

  it('não muta a lista recebida (é estado do React)', () => {
    const copia = [...fio];
    inserirNaOrdem(fio, m('fala', '2026-09-18T16:03:54+00:00'));
    expect(fio).toEqual(copia);
  });
});

// O helper só serve se a página do inbox o usar no INSERT do realtime — e
// "voltou a acrescentar no fim" não quebra build nem teste de comportamento.
describe('a página do inbox insere pelo helper', () => {
  it('handleMessageEvent não acrescenta a mensagem nova direto no fim', () => {
    const pagina = fs
      .readFileSync(
        path.join(__dirname, '..', '..', 'app', '(dashboard)', 'inbox', 'page.tsx'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(pagina).toContain('inserirNaOrdem(withoutOptimistic, newMsg)');
    expect(pagina).not.toContain('[...withoutOptimistic, newMsg]');
  });
});

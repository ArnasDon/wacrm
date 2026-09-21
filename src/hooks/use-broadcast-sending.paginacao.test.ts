import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  IDS_POR_CONSULTA,
  emFatias,
  erroDeLeituraParcial,
} from './use-broadcast-sending';

// ============================================================
// O disparo lia a audiência SEM PAGINAR, e o PostgREST corta em 1000 linhas
// sem avisar: `error: null`, mil linhas, cara de lista inteira.
//
// Aqui o corte não deixava uma tela incompleta — deixava uma CAMPANHA
// incompleta que se declarava completa: a tela somava a audiência real, a
// linha de `broadcasts` gravava esse total, e o envio saía para mil
// contatos escolhidos arbitrariamente. Com 1.212 contatos a conta já
// passava do teto HOJE; depois da carga da Kommo são ~12.980.
//
// Pior que o "de menos": a EXCLUSÃO por etiqueta cortava junto, e a
// etiqueta `kommo` é a rede de proteção da migração — cortada, ela conhece
// 8% dos importados e deixa a campanha alcançar os outros 92%, com a tela
// afirmando que protegeu.
//
// Os dois lados deste arquivo (o comportamento puro e a FORMA das
// consultas) são pinados aqui: `resolveAudience` é código do upstream, e um
// merge futuro traz a versão não-paginada de volta sem conflito nenhum.
// ============================================================

describe('emFatias: o `.in()` não pode viajar inteiro na URL', () => {
  it('reparte no tamanho pedido, com a sobra no fim', () => {
    expect(emFatias([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('múltiplo exato não deixa fatia vazia no fim', () => {
    expect(emFatias([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('lista vazia não vira fatia nenhuma — nada a consultar é nada a pedir', () => {
    expect(emFatias([], 100)).toEqual([]);
  });

  it('lista menor que a fatia sai inteira, numa fatia só', () => {
    expect(emFatias(['a'], 100)).toEqual([['a']]);
  });

  it('não perde nem duplica ninguém na audiência inteira (12.980 ids)', () => {
    const ids = Array.from({ length: 12_980 }, (_, i) => `id-${i}`);
    const fatias = emFatias(ids, IDS_POR_CONSULTA);

    expect(fatias.flat()).toEqual(ids);
    expect(new Set(fatias.flat()).size).toBe(ids.length);
    // Nenhuma fatia acima do teto: é ela que mantém a URL sob controle.
    expect(fatias.every((f) => f.length <= IDS_POR_CONSULTA)).toBe(true);
  });

  it('a fatia cabe na linha de requisição de um GET', () => {
    // Cada UUID custa 36 caracteres + a vírgula. O teto prático de uma
    // request line em proxy/servidor é ~8 KB; ficar abaixo de 4 KB é a
    // folga que impede um erro que não fala de tamanho nenhum.
    expect(IDS_POR_CONSULTA * 37).toBeLessThan(4096);
  });
});

describe('erroDeLeituraParcial: leitura parcial ABORTA o disparo', () => {
  it('nomeia o que faltou e afirma que nada saiu', () => {
    const erro = erroDeLeituraParcial('a lista de contatos da audiência', 'teto', null);
    expect(erro.message).toContain('a lista de contatos da audiência');
    expect(erro.message).toContain('Nada foi enviado');
  });

  it('separa os motivos — "teto" e "a consulta falhou" pedem coisas diferentes', () => {
    const teto = erroDeLeituraParcial('x', 'teto', null).message;
    const falha = erroDeLeituraParcial('x', 'erro', null).message;
    const mudou = erroDeLeituraParcial('x', 'incompleto', null).message;
    const semTotal = erroDeLeituraParcial('x', 'sem_contagem', null).message;

    expect(new Set([teto, falha, mudou, semTotal]).size).toBe(4);
    expect(teto).toContain('teto');
    expect(falha).toContain('falhou');
  });

  it('leva a mensagem do PostgREST quando existe — é ela que diz o que houve', () => {
    const erro = erroDeLeituraParcial('x', 'erro', {
      message: 'permission denied for table contacts',
    });
    expect(erro.message).toContain('permission denied for table contacts');
  });

  it('motivo nulo não imprime "undefined" na cara do operador', () => {
    const erro = erroDeLeituraParcial('x', null, null);
    expect(erro.message).not.toContain('undefined');
    expect(erro.message).toContain('Nada foi enviado');
  });
});

// ------------------------------------------------------------
// Pino de FORMA. O comportamento acima é puro; o que o merge do upstream
// desfaz é a consulta, e consulta não-paginada não tem sintoma observável
// em teste unitário — devolve mil linhas e `error: null`. Só ler o fonte
// alcança isso.
// ------------------------------------------------------------

const fonte = fs.readFileSync(
  path.join(__dirname, 'use-broadcast-sending.ts'),
  'utf8',
);

/** Faixa [início, fim) do corpo de uma função do hook, no fonte. */
function faixaDaFuncao(nome: string): [number, number] {
  const inicio = fonte.indexOf(`async function ${nome}(`);
  expect(inicio).toBeGreaterThan(-1);
  const fim = fonte.indexOf('\n  async function ', inicio + 1);
  return [inicio, fim === -1 ? fonte.length : fim];
}

/**
 * A ÚNICA leitura declaradamente sem paginar, e o motivo está escrito no
 * arquivo: `use-broadcast-sending.dono-do-csv.test.ts` trava a forma deste
 * trecho letra por letra (resolução do merge do upstream de 2026-09-05), e
 * fatiar a lista renomearia a variável que aquele pino exige. Quem
 * consertar mexe nos dois arquivos na mesma passada — e tira esta exceção
 * daqui, que é o que faz este teste cobrar o conserto.
 */
const EXCECAO_DECLARADA = faixaDaFuncao('upsertCsvContacts');

/** Tabelas cuja leitura cresce com a base — todas passam do teto de 1000. */
const TABELAS_QUE_CRESCEM = [
  'contacts',
  'contact_tags',
  'contact_custom_values',
  'broadcast_recipients',
];

interface Leitura {
  tabela: string;
  indice: number;
  trecho: string;
}

function leiturasDoFonte(): Leitura[] {
  const achadas: Leitura[] = [];
  const padrao = new RegExp(
    `\\.from\\('(${TABELAS_QUE_CRESCEM.join('|')})'\\)`,
    'g',
  );

  for (const m of fonte.matchAll(padrao)) {
    const indice = m.index!;
    // Janela folgada de propósito: no recorte por campo personalizado os
    // ramos do operador (`is`/`is_not`/`contains`) ficam ENTRE o `.from()` e
    // o `.order()`, e uma janela curta reprovava uma consulta correta.
    const depois = fonte.slice(indice, indice + 900);
    // Escrita não pagina: o que vem primeiro depois do `.from()` diz se a
    // consulta LÊ ou ESCREVE.
    const verbo = depois.match(/\.(select|insert|update|upsert|delete)\(/);
    if (verbo?.[1] !== 'select') continue;
    if (indice >= EXCECAO_DECLARADA[0] && indice < EXCECAO_DECLARADA[1]) continue;
    achadas.push({ tabela: m[1], indice, trecho: depois });
  }
  return achadas;
}

describe('toda leitura que cresce com a base passa por `buscarPaginado`', () => {
  const leituras = leiturasDoFonte();

  it('há leituras a cobrir (o pino não pode passar por não achar nada)', () => {
    // Audiência "todos" / por etiqueta / por campo, o índice de valores e a
    // releitura dos destinatários do passo 4.
    expect(leituras.length).toBeGreaterThanOrEqual(5);
  });

  it.each(TABELAS_QUE_CRESCEM)('%s é lida paginada', (tabela) => {
    const daTabela = leituras.filter((l) => l.tabela === tabela);
    expect(daTabela.length).toBeGreaterThan(0);

    for (const leitura of daTabela) {
      const antes = fonte.slice(Math.max(0, leitura.indice - 400), leitura.indice);
      expect(
        antes.includes('buscarPaginado'),
        `leitura de ${tabela} fora de um laço paginado (offset ${leitura.indice})`,
      ).toBe(true);
    }
  });

  it('cada leitura leva `count: exact` e ordem com desempate — as invariantes do laço', () => {
    for (const leitura of leituras) {
      // Sem a contagem não há como distinguir "a coleção acabou" de "a
      // página veio cheia por acaso", e o laço fecha cedo.
      expect(
        leitura.trecho,
        `leitura de ${leitura.tabela} sem count: 'exact'`,
      ).toContain("count: 'exact'");
      // `range` sem `order` é LIMIT/OFFSET sobre ordem INDEFINIDA: linha que
      // muda de posição entre duas páginas some ou vem duas vezes. `id` é a
      // chave primária das quatro tabelas, então desempata sempre.
      expect(
        leitura.trecho,
        `leitura de ${leitura.tabela} sem order('id')`,
      ).toContain("order('id'");
    }
  });

  it('o índice de campos não chunkeia mais por 500 contatos', () => {
    // Era fatia de CONTATOS numa tabela com N LINHAS POR CONTATO: ~15 campos
    // × 500 contatos = ~7.500 linhas por volta, das quais chegavam mil. O
    // efeito saía no texto ao CLIENTE, com a variável vazia.
    expect(fonte).not.toContain('const PAGE = 500');
    expect(IDS_POR_CONSULTA).toBeLessThanOrEqual(100);
  });
});

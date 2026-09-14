import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';

// ============================================================
// A régua de "mesma etiqueta" existe DUAS vezes: em TS (`chaveDeTag`) e em
// SQL (a coluna gerada `tags.name_key`). Elas precisam concordar — a
// divergência entre as duas foi o defeito que a 983 fechou, e o furo que a
// 984 fechou depois.
//
// Um teste não roda SQL, então o que dá para cobrar aqui é a FORMA da
// expressão. A equivalência de VALOR foi medida contra o Postgres de
// produção em 2026-09-09 (precomposta e decomposta → "bancario"; "Bancária"
// segue distinta; `a^b` e `ø` sobrevivem) e está escrita no cabeçalho da
// migration.
// ============================================================

const p = (arquivo: string) =>
  readFileSync(path.join(__dirname, arquivo), 'utf8');

const SQL_984 = p('0984_cb_chave_de_tag_normalizada.sql');

const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

/**
 * A expressão DA COLUNA GERADA, e só ela.
 *
 * ⚠️ Varrer o arquivo inteiro atrás de `normalize(`/`regexp_replace(` não
 * serve: o bloco de conferência da própria migration usa as MESMAS chamadas,
 * então os testes passariam com a expressão da coluna errada. Recortar o
 * `ADD COLUMN ... GENERATED ALWAYS AS (...) STORED` é o que faz a asserção
 * valer sobre a coisa certa. (Achado da revisão adversarial.)
 */
function expressaoDaColunaGerada(sql: string): string {
  const m = semComentarios(sql).match(
    /ADD COLUMN\s+name_key[\s\S]*?GENERATED ALWAYS AS\s*\(([\s\S]*?)\)\s*STORED/i
  );
  if (!m) throw new Error('não achei o ADD COLUMN ... GENERATED ALWAYS AS da name_key');
  return m[1];
}

describe('984 — a régua do SQL casa com a do TS', () => {
  const corpo = semComentarios(SQL_984);
  const expressao = expressaoDaColunaGerada(SQL_984);

  it('CRÍTICO: a coluna gerada NORMALIZA antes de apagar os sinais', () => {
    // Sem o `normalize(..., NFD)`, a forma decomposta de um nome acentuado
    // gera outra chave e o índice único deixa a duplicata entrar — que é
    // exatamente o furo que a 983 tinha.
    expect(/normalize\(\s*lower\(\s*btrim\(\s*name/i.test(expressao)).toBe(true);
    // ⚠️ `[\s\S]*?` e não `[^)]*`: o argumento do `normalize` tem parênteses
    // aninhados (`lower(btrim(name, ...))`), então a versão com `[^)]*` NUNCA
    // casava aqui — ela vinha passando só porque a busca era no arquivo
    // inteiro e encontrava o `normalize('Bancário', NFD)` do bloco de
    // conferência. Exatamente o furo que motivou recortar a expressão.
    expect(/normalize\([\s\S]*?,\s*NFD\s*\)/i.test(expressao)).toBe(true);
  });

  it('CRÍTICO: apaga o bloco de sinais combinantes U+0300–U+036F', () => {
    expect(/regexp_replace\(/i.test(expressao)).toBe(true);
    expect(expressao).toContain('u0300-\\u036f');
  });

  it('⚠️ a asserção é sobre a EXPRESSÃO, não sobre o arquivo', () => {
    // Prova que o recorte funciona: a expressão extraída é bem menor que o
    // arquivo, e não arrasta o bloco de conferência junto.
    expect(expressao.length).toBeLessThan(corpo.length / 3);
    expect(expressao).not.toMatch(/RAISE EXCEPTION/i);
    expect(expressao).toContain('name');
  });

  it('⚠️ o intervalo é escrito por ESCAPE, nunca com o caractere literal', () => {
    // Caractere combinante literal num arquivo é invisível para quem lê ou
    // edita — e some numa cópia descuidada. Já aconteceu ao escrever esta
    // própria migration.
    const combinanteLiteral = /[̀-ͯ]/u;
    expect(combinanteLiteral.test(SQL_984)).toBe(false);
  });

  it('a coluna é RECRIADA, e o índice volta depois', () => {
    // `ALTER ... SET EXPRESSION` só existe no PG 17, e a migration precisa
    // replayar no Postgres que o CI subir.
    expect(/DROP COLUMN IF EXISTS name_key/i.test(corpo)).toBe(true);
    expect(/ADD COLUMN name_key[\s\S]*GENERATED ALWAYS AS/i.test(corpo)).toBe(true);
    expect(/CREATE UNIQUE INDEX[\s\S]*tags_conta_nome_uk/i.test(corpo)).toBe(true);
  });

  it('a migration RENOMEIA a duplicata, nunca apaga', () => {
    // Apagar quebraria em silêncio as regras que referenciam `tags.id` por
    // JSON — automação, fluxo e o recorte salvo da caixa de entrada —, que
    // nenhuma FK protege.
    expect(/UPDATE\s+tags[\s\S]*?SET\s+name\s*=/i.test(corpo)).toBe(true);
    expect(/DELETE\s+FROM\s+tags/i.test(corpo)).toBe(false);
  });

  it('o TS trata as duas formas Unicode como a mesma etiqueta', () => {
    // O outro lado da equivalência que a migration garante no banco.
    const pre = 'Bancário';
    expect(chaveDeTag(pre.normalize('NFD'))).toBe(chaveDeTag(pre));
    expect(chaveDeTag(pre.normalize('NFC'))).toBe('bancario');
  });

  it('os nomes reais do escritório continuam distintos entre si', () => {
    const reais = [
      'Ag. Demissão', 'Bancário', 'Cliente Fechado', 'Demitida',
      'Desqualificado', 'Formulário', 'Imobiliario', 'Pediu Demissão',
      'Setor Acordo', 'Trabalhista', 'Typebot',
    ];
    expect(new Set(reais.map(chaveDeTag)).size).toBe(reais.length);
  });
});

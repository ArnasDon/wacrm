import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Toda migration tem QUATRO dígitos, e isto não é estética.
//
// O replay do CI (`supabase db reset`) aplica os arquivos em ordem de NOME —
// lexicográfica, não numérica. Com três dígitos, a 999 era o último nome
// possível: `1000_` ordena ENTRE `042_` e `900_` (o `1` vem antes do `9`), e
// nenhum prefixo só de dígitos ordena depois de `999_` (`9990_` < `999_`,
// porque `0` vem antes de `_`). A migration seguinte rodaria antes das tabelas
// de que depende, o replay ficaria vermelho — e desde 08/09/2026 replay
// vermelho TRAVA o deploy.
//
// Em 14/09/2026 as 137 migrations foram renomeadas para `0001_` … `0998_`.
// O histórico do Supabase não sente (registra por timestamp, não por nome).
//
// Por que um teste, e não só a convenção escrita:
//   · um merge do upstream traz migration nova com TRÊS dígitos (`043_x.sql`);
//   · uma branch aberta antes da renomeação volta com o formato antigo;
// e nos dois casos nada estoura na hora — só a ordem fica errada, em silêncio,
// até alguém criar a migration que depende dela.
// ============================================================

const DIR = __dirname;
const sql = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));

describe('nomes dos arquivos de migration', () => {
  it('CRÍTICO: todo arquivo tem 4 dígitos, sublinhado e nome em snake_case', () => {
    const foraDoFormato = sql.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
    // Quem aparecer aqui: renomeie para 4 dígitos (`043_x.sql` → `0043_x.sql`).
    expect(foraDoFormato).toEqual([]);
  });

  it('dois arquivos nunca dividem o mesmo número', () => {
    const numeros = sql.map((f) => f.slice(0, 4));
    const repetidos = numeros.filter((n, i) => numeros.indexOf(n) !== i);
    // Número repetido é o sinal de duas branches em paralelo (906, 963, 966,
    // 989, 993 — todas pegas tarde). Renumere a que ainda não foi aplicada.
    expect(repetidos).toEqual([]);
  });

  it('a ordem por nome (a do replay) é a ordem numérica', () => {
    const porNome = [...sql].sort();
    const porNumero = [...sql].sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)));
    expect(porNome).toEqual(porNumero);
  });
});

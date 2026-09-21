import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1032 — as regras de LEITURA perguntam "de quais contas sou membro" UMA vez
// por consulta (`account_id IN (SELECT cb_contas_do_usuario())`), e não a
// cada linha lida (`is_account_member(account_id)`).
//
// O que este pino segura:
//
// 1. A escada de papéis da função nova é a MESMA de `is_account_member`.
//    As duas convivem — as policies de ESCRITA continuam na antiga —, e uma
//    escada divergente faria leitura e escrita discordarem sobre quem é
//    admin, sem erro nenhum.
// 2. A 1032 altera TODA policy de leitura que chamava a antiga (nem uma a
//    menos: a que ficasse para trás seguiria somando o custo por linha na
//    mesma tabela), só policy que existe, e trava com `lock_timeout`.
// 3. No FIM do replay nenhuma policy de leitura chama `is_account_member`.
//    Não é regra de segurança — a forma por linha é CORRETA, só lenta —, e é
//    por isso que volta sem ninguém notar: a regressão não quebra tela
//    nenhuma, só devolve o funil de 9 s. O caminho provável é um merge do
//    upstream com tabela nova (as policies da 017 são dele) — o conserto é
//    escrever a forma da 1032.
//
// LIMITE DECLARADO: isto lê os `.sql`. Policy criada por `EXECUTE` dentro de
// um bloco DO é invisível — por isso a própria 1032 confere o CATÁLOGO ao
// ser aplicada (conferência 1). `DROP TABLE` é lido mesmo dentro de string
// (a 0922 apaga `contact_notes` por `EXECUTE`), e leva as policies junto.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1032_cb_rls_leitura_uma_vez_por_consulta.sql';
const SQL_1032 = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');

const CRIA = /CREATE\s+POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?(\w+)/gi;
const APAGA = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?(\w+)/gi;
const ALTERA = /ALTER\s+POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?(\w+)/gi;
const APAGA_TABELA = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;

type Politica = { cmd: string; corpo: string };

/** O resto da instrução, até o `;` — onde vivem o comando e o predicado. */
function corpoDe(sql: string, m: RegExpMatchArray): string {
  return sql.slice(m.index! + m[0].length).split(';')[0];
}

/**
 * Reproduz o replay até `ate` (exclusive): as policies vivas, com o CORPO da
 * última definição. Por arquivo: tabelas apagadas, DROP, CREATE e só então
 * ALTER — a ordem em que estas migrations escrevem (nenhuma altera e recria
 * a mesma policy no mesmo arquivo).
 */
function replay(ate?: string): Map<string, Politica> {
  const arquivos = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => ate === undefined || f < ate);

  const vivas = new Map<string, Politica>();
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');

    for (const m of sql.matchAll(APAGA_TABELA)) {
      for (const chave of [...vivas.keys()]) {
        if (chave.startsWith(`${m[1]}.`)) vivas.delete(chave);
      }
    }
    for (const m of sql.matchAll(APAGA)) vivas.delete(`${m[3]}.${m[1] ?? m[2]}`);
    for (const m of sql.matchAll(CRIA)) {
      const corpo = corpoDe(sql, m);
      // Sem `FOR`, o padrão do Postgres é ALL — que vale também para SELECT.
      const cmd = (corpo.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? 'ALL').toUpperCase();
      vivas.set(`${m[3]}.${m[1] ?? m[2]}`, { cmd, corpo });
    }
    for (const m of sql.matchAll(ALTERA)) {
      const atual = vivas.get(`${m[3]}.${m[1] ?? m[2]}`);
      // ALTER POLICY não muda o comando: só o predicado.
      if (atual) atual.corpo = corpoDe(sql, m);
    }
  }
  return vivas;
}

/** As policies de LEITURA (SELECT e FOR ALL) que ainda perguntam por linha. */
function leituraPorLinha(vivas: Map<string, Politica>): string[] {
  return [...vivas]
    .filter(([, p]) => (p.cmd === 'SELECT' || p.cmd === 'ALL') && /is_account_member/.test(p.corpo))
    .map(([chave]) => chave)
    .sort();
}

/** O texto de uma função, do `CREATE` até o `$$;` que fecha o corpo. */
function funcao(sql: string, nome: RegExp): string {
  const inicio = sql.search(nome);
  expect(inicio, `definição de ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
  const abre = sql.indexOf('$$', inicio);
  const fecha = sql.indexOf('$$', abre + 2);
  return sql.slice(inicio, fecha + 2);
}

const CRIA_ANTIGA = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?is_account_member\s*\(/i;

/** Os degraus dos CASE de papel, na ordem em que aparecem. */
function degraus(texto: string): string[] {
  return [...texto.matchAll(/WHEN\s+'(\w+)'\s+THEN\s+(\d+)/g)].map((m) => `${m[1]}=${m[2]}`);
}

describe('1032 — a leitura pergunta a conta uma vez por consulta', () => {
  it('a escada de papéis é a mesma da is_account_member, e a função é SECURITY DEFINER', () => {
    // A ÚLTIMA definição da antiga — hoje, a da 0017.
    const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    const comAntiga = arquivos.filter((f) =>
      CRIA_ANTIGA.test(fs.readFileSync(path.join(DIR, f), 'utf8')),
    );
    const ultima = fs.readFileSync(path.join(DIR, comAntiga.at(-1)!), 'utf8');
    const antiga = funcao(ultima, CRIA_ANTIGA);
    const nova = funcao(SQL_1032, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.cb_contas_do_usuario\s*\(/i);

    expect(degraus(antiga)).toHaveLength(8);
    expect(degraus(nova)).toEqual(degraus(antiga));
    expect(nova).toMatch(/auth\.uid\(\)/);
    // Invoker entraria em recursão: lê `profiles`, cuja policy pergunta a conta.
    expect(nova).toMatch(/SECURITY\s+DEFINER/i);
  });

  it('altera EXATAMENTE as policies de leitura que chamavam a antiga — nem uma a menos, nem inventada', () => {
    const antes = leituraPorLinha(replay(ARQUIVO));
    const alteradas = [...SQL_1032.matchAll(ALTERA)].map((m) => `${m[3]}.${m[1] ?? m[2]}`).sort();

    // Sanidade do parser: sem isto, um parser que não casa nada passaria.
    expect(antes.length).toBeGreaterThanOrEqual(61);
    expect(alteradas).toEqual(antes);
  });

  it('nenhuma ALTER da 1032 carrega a forma antiga, e a trava vem antes da primeira', () => {
    for (const m of SQL_1032.matchAll(ALTERA)) {
      expect(corpoDe(SQL_1032, m), `${m[3]}.${m[1] ?? m[2]}`).not.toMatch(/is_account_member/);
    }
    const trava = SQL_1032.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(SQL_1032.search(/ALTER\s+POLICY\s+\w+\s+ON/i));
  });

  it('no FIM do replay nenhuma policy de leitura chama is_account_member', () => {
    // Policy de leitura NOVA (tabela nova, merge do upstream) escreve:
    //   account_id IN (SELECT public.cb_contas_do_usuario())
    // e, para papel mínimo, cb_contas_do_usuario('admin'::public.account_role_enum).
    expect(leituraPorLinha(replay())).toEqual([]);
  });
});

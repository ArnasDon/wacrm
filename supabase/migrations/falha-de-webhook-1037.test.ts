import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1037: `record_webhook_failure` (SECURITY DEFINER, desliga um
// endpoint na 15ª falha) só executa pelo service_role. Aberta, qualquer
// pessoa com a chave anônima e o id de um endpoint — que viaja no cabeçalho
// `X-Wacrm-Webhook-Id` de toda entrega — desligava os webhooks do escritório.
//
// A conferência DENTRO da migration prova os privilégios no banco; este teste
// roda no job `verificar`, que é portão, e pega o que desfaz a 1037 SEM
// conflito: uma metade do REVOKE apagada, um GRANT acrescentado por engano,
// ou uma migration posterior (inclusive uma do upstream) que recrie a função
// — DROP + CREATE devolve o EXECUTE a PUBLIC.
//
// LIMITE DECLARADO: lê os `.sql`. Um GRANT montado por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const dir = __dirname;
const FUNCAO = 'record_webhook_failure';

function semComentarios(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');
}

function ler(arquivo: string): string {
  return semComentarios(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
}

const sql = ler('1037_cb_falha_de_webhook_so_pelo_servidor.sql');
const f = `(?:public\\.)?${FUNCAO}\\s*\\(\\s*uuid\\s*,\\s*integer\\s*\\)`;

/** Número da migration pelo prefixo do nome (`1037_...` → 1037). */
function numero(arquivo: string): number {
  return Number(arquivo.match(/^(\d+)_/)?.[1] ?? NaN);
}

describe('1037 — record_webhook_failure só pelo servidor', () => {
  it('revoga as DUAS metades: PUBLIC e os papéis, na mesma instrução', () => {
    expect(
      new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${f}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`, 'i').test(sql)
    ).toBe(true);
  });

  it('devolve o EXECUTE ao service_role por escrito (banco novo não herda)', () => {
    expect(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${f}\\s+TO\\s+service_role\\s*;`, 'i').test(sql)).toBe(true);
  });

  it('não concede nada a anon, authenticated nem PUBLIC', () => {
    expect(
      new RegExp(`GRANT[^;]*ON\\s+FUNCTION\\s+${f}[^;]*\\b(anon|authenticated|public)\\b`, 'i').test(sql)
    ).toBe(false);
  });

  it('a conferência confere os três papéis e troca de papel', () => {
    for (const papel of ['anon', 'authenticated', 'service_role']) {
      expect(sql).toMatch(new RegExp(`has_function_privilege\\('${papel}'`));
    }
    expect(sql).toMatch(/SET\s+LOCAL\s+ROLE\s+authenticated/i);
    expect(sql).toMatch(/SET\s+LOCAL\s+ROLE\s+service_role/i);
    expect(sql).toMatch(/WHEN\s+insufficient_privilege/i);
  });

  it('não recria a função (o corpo é o da 028; recriar devolveria o EXECUTE a PUBLIC)', () => {
    expect(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${FUNCAO}`, 'i').test(sql)).toBe(false);
  });
});

describe('nenhuma migration POSTERIOR à 1037 reabre a função', () => {
  const posteriores = fs
    .readdirSync(dir)
    .filter((a) => a.endsWith('.sql') && numero(a) > 1037);

  it.each(posteriores.length ? posteriores : ['(nenhuma ainda)'])('%s', (arquivo) => {
    if (arquivo === '(nenhuma ainda)') return;
    const texto = ler(arquivo);
    if (!new RegExp(`\\b${FUNCAO}\\b`, 'i').test(texto)) return;

    // GRANT a quem não é o servidor reabre o buraco.
    expect(
      new RegExp(`GRANT[^;]*ON\\s+FUNCTION\\s+(public\\.)?${FUNCAO}[^;]*\\b(anon|authenticated|public)\\b`, 'i').test(texto),
      `${arquivo} concede EXECUTE de ${FUNCAO} a anon/authenticated/PUBLIC`
    ).toBe(false);

    // Recriar (DROP + CREATE, ou CREATE numa assinatura nova) devolve o
    // EXECUTE a PUBLIC: quem recria, fecha de novo — as duas metades.
    const recria = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${FUNCAO}`, 'i').test(texto);
    if (recria) {
      expect(
        new RegExp(`REVOKE\\s+(EXECUTE|ALL)[^;]*ON\\s+FUNCTION\\s+(public\\.)?${FUNCAO}[^;]*FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`, 'i').test(texto),
        `${arquivo} recria ${FUNCAO} sem revogar de PUBLIC, anon e authenticated`
      ).toBe(true);
    }
  });
});

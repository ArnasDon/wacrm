import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// As tabelas do tl;dv (987) têm regras DIFERENTES, de propósito:
// - `cb_tldv_config` guarda a chave CIFRADA e não dá NADA a `authenticated`
//   (a tela lê pela rota, com service role) — mesmo racional da 977;
// - `cb_reunioes_transcritas` é LIDA direto pela ficha do cliente (SELECT
//   sob RLS, como `cb_meetings`) e escrita SÓ pela rota. Um GRANT de escrita
//   dado por engano deixaria o navegador vincular reunião a cliente de outra
//   conta — a FK composta barra, mas o sintoma seria erro cru na tela.
// A conferência DENTRO da 987 testa GRANT, não RLS; este teste roda no job
// `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '0987_cb_tldv.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('987 — RLS das tabelas do tl;dv', () => {
  it.each(['cb_tldv_config', 'cb_reunioes_transcritas'])('%s tem ENABLE ROW LEVEL SECURITY', (tabela) => {
    const padrao = new RegExp(`ALTER\\s+TABLE\\s+${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    expect(padrao.test(semComentarios)).toBe(true);
  });

  it.each(['cb_tldv_config', 'cb_reunioes_transcritas'])('%s revoga tudo de PUBLIC, anon e authenticated antes de conceder', (tabela) => {
    expect(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(semComentarios),
    ).toBe(true);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${tabela}\\b[^;]*\\banon\\b`, 'i').test(semComentarios)).toBe(false);
  });

  it.each(['cb_tldv_config', 'cb_reunioes_transcritas'])('%s concede tudo ao service_role por escrito', (tabela) => {
    expect(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+TO\\s+service_role`, 'i').test(semComentarios)).toBe(true);
  });

  it('a config não dá NADA a authenticated (a chave cifrada não passa pelo PostgREST)', () => {
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_tldv_config\b[^;]*\bauthenticated\b/i.test(semComentarios)).toBe(false);
    expect(/CREATE\s+POLICY[^;]*\bON\s+cb_tldv_config\b/i.test(semComentarios)).toBe(false);
  });

  it('as reuniões dão SÓ SELECT a authenticated, por policy de membro', () => {
    expect(/GRANT\s+SELECT\s+ON\s+TABLE\s+cb_reunioes_transcritas\s+TO\s+authenticated/i.test(semComentarios)).toBe(true);
    expect(/GRANT\s+(ALL|INSERT|UPDATE|DELETE)[^;]*\bON\s+TABLE\s+cb_reunioes_transcritas\b[^;]*\bauthenticated\b/i.test(semComentarios)).toBe(false);
    expect(/CREATE\s+POLICY\s+\S+\s+ON\s+cb_reunioes_transcritas\s+FOR\s+SELECT\s+USING\s*\(\s*is_account_member\s*\(\s*account_id\s*\)\s*\)/i.test(semComentarios)).toBe(true);
    expect(/CREATE\s+POLICY[^;]*\bON\s+cb_reunioes_transcritas\s+FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(semComentarios)).toBe(false);
  });

  it('a idempotência da importação é um UNIQUE, e o cliente é FK COMPOSTA com a conta', () => {
    expect(/UNIQUE\s*\(\s*account_id\s*,\s*tldv_meeting_id\s*\)/i.test(semComentarios)).toBe(true);
    expect(/FOREIGN\s+KEY\s*\(\s*contact_id\s*,\s*account_id\s*\)\s*REFERENCES\s+contacts\s*\(\s*id\s*,\s*account_id\s*\)\s*ON\s+DELETE\s+SET\s+NULL\s*\(\s*contact_id\s*\)/i.test(semComentarios)).toBe(true);
  });
});

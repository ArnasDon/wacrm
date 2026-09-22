import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1036: as reuniões históricas da Kommo ficam numa tabela FECHADA
// ao navegador, com RLS ligada, e fora do alcance de lembrete e automação —
// o ponto da decisão 27 (opção b) é justamente não disparar nada. A
// conferência DENTRO da migration testa GRANT e RLS no banco; este teste
// roda no job `verificar`, que é portão, e pega um GRANT ou uma policy
// acrescentados por engano ao arquivo.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const TABELA = 'cb_reunioes_da_kommo';

const sql = fs.readFileSync(path.join(__dirname, '1036_cb_reunioes_da_kommo.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

const t = `(?:public\\.)?${TABELA}`;

describe('1036 — reuniões históricas da Kommo', () => {
  it('liga a RLS', () => {
    expect(new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(semComentarios)).toBe(true);
  });

  it('não dá NADA a authenticated nem a anon, e não tem policy', () => {
    expect(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${t}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(semComentarios)
    ).toBe(true);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${t}\\b[^;]*\\b(authenticated|anon)\\b`, 'i').test(semComentarios)).toBe(false);
    expect(new RegExp(`CREATE\\s+POLICY[^;]*\\bON\\s+${t}\\b`, 'i').test(semComentarios)).toBe(false);
  });

  it('concede tudo ao service_role por escrito', () => {
    expect(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${t}\\s+TO\\s+service_role`, 'i').test(semComentarios)).toBe(true);
  });

  it('é uma linha por lead da Kommo, e apagar o contato não apaga a reunião', () => {
    expect(/unique\s*\(\s*account_id\s*,\s*kommo_lead_id\s*\)/i.test(semComentarios)).toBe(true);
    expect(/on\s+delete\s+set\s+null\s*\(\s*contact_id\s*\)/i.test(semComentarios)).toBe(true);
  });

  it('não cria gatilho: nada reage a esta tabela', () => {
    expect(/create\s+(or\s+replace\s+)?trigger/i.test(semComentarios)).toBe(false);
  });
});

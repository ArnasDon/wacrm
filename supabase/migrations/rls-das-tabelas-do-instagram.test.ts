import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// `cb_instagram_config` (990) guarda o Instagram App Secret CIFRADO — a
// credencial que troca o código do login do Instagram pelo token e assina
// os webhooks. Não dá NADA a `authenticated`: a tela lê pela rota
// `/api/cb/instagram/app`, que devolve só o App ID (mesmo racional da
// 976/977/987). A conferência DENTRO da 990 testa GRANT, não RLS; este
// teste roda no job `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '0990_cb_instagram_config.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('990 — RLS da config do app do Instagram', () => {
  it('cb_instagram_config tem ENABLE ROW LEVEL SECURITY', () => {
    expect(/ALTER\s+TABLE\s+cb_instagram_config\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(semComentarios)).toBe(true);
  });

  it('revoga tudo de PUBLIC, anon e authenticated antes de conceder', () => {
    expect(/REVOKE\s+ALL\s+ON\s+TABLE\s+cb_instagram_config\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(true);
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_instagram_config\b[^;]*\banon\b/i.test(semComentarios)).toBe(false);
  });

  it('concede tudo ao service_role por escrito', () => {
    expect(/GRANT\s+ALL\s+ON\s+TABLE\s+cb_instagram_config\s+TO\s+service_role/i.test(semComentarios)).toBe(true);
  });

  it('não dá NADA a authenticated nem cria policy (o segredo cifrado não passa pelo PostgREST)', () => {
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_instagram_config\b[^;]*\bauthenticated\b/i.test(semComentarios)).toBe(false);
    expect(/CREATE\s+POLICY[^;]*\bON\s+cb_instagram_config\b/i.test(semComentarios)).toBe(false);
  });

  it('o App ID é conferido pela forma (só dígitos) e o segredo é obrigatório', () => {
    expect(/ig_app_id\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*ig_app_id\s*~\s*'\^\[0-9\]\{5,32\}\$'\s*\)/i.test(semComentarios)).toBe(true);
    expect(/ig_app_secret\s+text\s+NOT\s+NULL/i.test(semComentarios)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// As tabelas do Calendly (977) guardam token e chave de assinatura
// CIFRADOS e o registro de cada agendamento (telefone, e-mail). Nenhuma das
// duas dá NADA a `authenticated` — a tela lê pela rota, com service role —
// e as duas ficam com RLS ligada, para que um GRANT dado por engano no
// futuro não abra a tabela inteira para qualquer usuário autenticado da
// instalação. A conferência DENTRO da 977 testa GRANT, não RLS; este teste
// roda no job `verificar`, que é portão. Mesmo racional do
// `rls-das-tabelas-do-meta-ads.test.ts` ao lado.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const TABELAS = ['cb_calendly_config', 'cb_calendly_eventos'] as const;

const sql = fs.readFileSync(path.join(__dirname, '0977_cb_calendly.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('977 — RLS das tabelas do Calendly', () => {
  it.each(TABELAS)('%s tem ENABLE ROW LEVEL SECURITY', (tabela) => {
    const padrao = new RegExp(`ALTER\\s+TABLE\\s+${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    expect(padrao.test(semComentarios)).toBe(true);
  });

  it.each(TABELAS)('%s não dá NADA a authenticated nem a anon', (tabela) => {
    expect(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(
        semComentarios,
      ),
    ).toBe(true);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${tabela}\\b[^;]*\\b(authenticated|anon)\\b`, 'i').test(semComentarios)).toBe(
      false,
    );
    expect(new RegExp(`CREATE\\s+POLICY[^;]*\\bON\\s+${tabela}\\b`, 'i').test(semComentarios)).toBe(false);
  });

  it.each(TABELAS)('%s concede tudo ao service_role por escrito', (tabela) => {
    expect(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+TO\\s+service_role`, 'i').test(semComentarios)).toBe(true);
  });

  it('a idempotência do webhook é um UNIQUE, não um "if" no código', () => {
    expect(/UNIQUE\s*\(\s*account_id\s*,\s*evento\s*,\s*invitee_uri\s*\)/i.test(semComentarios)).toBe(true);
  });
});

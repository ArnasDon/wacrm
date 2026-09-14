import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// As tabelas dos webhooks de entrada (982) guardam o SEGREDO cifrado de
// cada webhook e o registro de cada acionamento (telefone do cliente e o
// payload achatado). Nenhuma das duas dá NADA a `authenticated` — a tela lê
// pela rota, com service role — e as duas ficam com RLS ligada, para que um
// GRANT dado por engano no futuro não abra a tabela inteira para qualquer
// usuário autenticado da instalação. A conferência DENTRO da 982 testa
// GRANT, não RLS; este teste roda no job `verificar`, que é portão. Mesmo
// racional do `rls-das-tabelas-do-calendly.test.ts` ao lado.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const TABELAS = ['cb_webhooks', 'cb_webhook_eventos'] as const;

const sql = fs.readFileSync(
  path.join(__dirname, '0982_cb_webhooks_de_entrada.sql'),
  'utf8'
);

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('982 — RLS das tabelas dos webhooks de entrada', () => {
  it.each(TABELAS)('%s tem ENABLE ROW LEVEL SECURITY', (tabela) => {
    const padrao = new RegExp(
      `ALTER\\s+TABLE\\s+${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i'
    );
    expect(padrao.test(semComentarios)).toBe(true);
  });

  it.each(TABELAS)('%s não dá NADA a authenticated nem a anon', (tabela) => {
    expect(
      new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`,
        'i'
      ).test(semComentarios)
    ).toBe(true);
    expect(
      new RegExp(
        `GRANT[^;]*\\bON\\s+TABLE\\s+${tabela}\\b[^;]*\\b(authenticated|anon)\\b`,
        'i'
      ).test(semComentarios)
    ).toBe(false);
    expect(
      new RegExp(`CREATE\\s+POLICY[^;]*\\bON\\s+${tabela}\\b`, 'i').test(
        semComentarios
      )
    ).toBe(false);
  });

  it.each(TABELAS)('%s concede tudo ao service_role por escrito', (tabela) => {
    expect(
      new RegExp(
        `GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+TO\\s+service_role`,
        'i'
      ).test(semComentarios)
    ).toBe(true);
  });

  it('webhook não pode nascer sem segredo e sem se declarar aberto', () => {
    expect(
      /CHECK\s*\(\s*sem_segredo\s+OR\s+segredo\s+IS\s+NOT\s+NULL\s*\)/i.test(
        semComentarios
      )
    ).toBe(true);
  });

  it('a idempotência é um UNIQUE, não um "if" no código', () => {
    expect(
      /UNIQUE\s*\(\s*webhook_id\s*,\s*id_externo\s*\)/i.test(semComentarios)
    ).toBe(true);
  });

  it('o UNIQUE da idempotência é TOTAL — só assim serve de alvo do ON CONFLICT', () => {
    // `id_externo` NOT NULL com DEFAULT é o que mantém o índice total.
    // Índice PARCIAL não arbitra `ON CONFLICT` pelo PostgREST (lição da 903).
    expect(
      /id_externo\s+text\s+NOT\s+NULL\s+DEFAULT/i.test(semComentarios)
    ).toBe(true);
    expect(/UNIQUE[^;]*\bWHERE\b/i.test(semComentarios)).toBe(false);
  });

  it('a FK do evento para o webhook é COMPOSTA com a conta', () => {
    // A rota roda em service-role e ignora RLS: FK simples só garantiria
    // "existe uma linha com esse id", não "é desta conta".
    expect(
      /FOREIGN\s+KEY\s*\(\s*webhook_id\s*,\s*account_id\s*\)\s*REFERENCES\s+cb_webhooks\s*\(\s*id\s*,\s*account_id\s*\)/i.test(
        semComentarios
      )
    ).toBe(true);
  });
});

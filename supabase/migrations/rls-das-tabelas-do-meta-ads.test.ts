import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// As tabelas do Meta Ads (976) só podem dar SELECT ao membro PORQUE a RLS
// está ligada nelas.
//
// `cb_meta_ads_campanhas` e `cb_meta_ads_gastos` têm `GRANT SELECT` para
// `authenticated` — é assim que o Desempenho lê o investimento sem passar
// por rota. A policy `is_account_member(account_id)` é o que impede um
// membro de uma conta ler o gasto em anúncios de OUTRA. Se um dia um merge
// ou uma "limpeza" apagar o `ENABLE ROW LEVEL SECURITY` de uma delas, o
// GRANT sozinho abre o nome de campanha e o gasto diário de todo escritório
// para qualquer usuário autenticado da instalação — e a conferência DENTRO
// da 976 continuaria verde, porque ela testa GRANT, não RLS.
//
// ⚠️ Por que um teste, e não uma linha a mais na 976: a migration já foi
// APLICADA em produção (04/09/2026), e migration aplicada não se reescreve.
// Este teste roda dentro do job `verificar`, que é PORTÃO — ao contrário do
// replay das migrations, que é sinal. Mesmo racional do
// `policies-de-escrita.test.ts` ao lado.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const TABELAS = ['cb_meta_ads_config', 'cb_meta_ads_campanhas', 'cb_meta_ads_gastos'] as const;

/** Só estas duas dão SELECT ao membro; a config não dá nada. */
const COM_SELECT_DO_MEMBRO = ['cb_meta_ads_campanhas', 'cb_meta_ads_gastos'] as const;

const sql = fs.readFileSync(path.join(__dirname, '0976_cb_meta_ads.sql'), 'utf8');

/** Sem comentários: um `-- ALTER TABLE …` não vale como prova. */
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('976 — RLS das tabelas do Meta Ads', () => {
  it.each(TABELAS)('%s tem ENABLE ROW LEVEL SECURITY', (tabela) => {
    const padrao = new RegExp(`ALTER\\s+TABLE\\s+${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    expect(padrao.test(semComentarios)).toBe(true);
  });

  it.each(COM_SELECT_DO_MEMBRO)('%s recorta o SELECT por conta', (tabela) => {
    const policy = new RegExp(
      `CREATE\\s+POLICY[\\s\\S]{0,120}ON\\s+${tabela}[\\s\\S]{0,160}is_account_member\\s*\\(\\s*account_id\\s*\\)`,
      'i',
    );
    expect(policy.test(semComentarios)).toBe(true);
    expect(new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+${tabela}\\s+TO\\s+authenticated`, 'i').test(semComentarios)).toBe(
      true,
    );
  });

  it('a config não dá NADA a authenticated — o token cifrado não passa pelo PostgREST', () => {
    expect(/REVOKE\s+ALL\s+ON\s+TABLE\s+cb_meta_ads_config\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(
      true,
    );
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_meta_ads_config\b[^;]*\bauthenticated\b/i.test(semComentarios)).toBe(false);
  });

  it.each(TABELAS)('%s não deixa nada para anon', (tabela) => {
    expect(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+FROM\\s+PUBLIC,\\s*anon`, 'i').test(semComentarios)).toBe(
      true,
    );
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${tabela}\\b[^;]*\\banon\\b`, 'i').test(semComentarios)).toBe(false);
  });
});

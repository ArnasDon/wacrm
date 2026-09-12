import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// `cb_asaas_config` (992) guarda a chave da API do Asaas CIFRADA — a
// credencial que lê as cobranças do escritório inteiro. Ela não dá NADA a
// `authenticated`: a tela lê pela rota, com service role. RLS fica ligada
// para que um GRANT dado por engano no futuro não abra a tabela para
// qualquer usuário autenticado da instalação. A conferência DENTRO da 992
// testa GRANT; este teste roda no job `verificar`, que é portão. Mesmo
// racional do `rls-das-tabelas-do-calendly.test.ts` ao lado.
//
// ⚠️ As outras duas tabelas do plano (`cb_asaas_clientes`,
// `cb_asaas_cobrancas`) ainda não existem — nascem depois do levantamento,
// que é quem calibra a forma delas. Quando nascerem, elas entram em TABELAS.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const TABELAS = ['cb_asaas_config'] as const;

const sql = fs.readFileSync(path.join(__dirname, '992_cb_asaas_config.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('992 — RLS da config do Asaas', () => {
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

  it('o sandbox é declarado no CHECK, e não deduzido pelo código', () => {
    expect(/CHECK\s*\(\s*ambiente\s+IN\s*\(\s*'producao'\s*,\s*'sandbox'\s*\)\s*\)/i.test(semComentarios)).toBe(true);
  });

  it('guarda o NOME da chave: o evento de chave do webhook só traz o nome', () => {
    expect(/\bchave_nome\b/.test(semComentarios)).toBe(true);
  });
});

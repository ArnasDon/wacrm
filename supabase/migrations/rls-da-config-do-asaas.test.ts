import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// `cb_asaas_config` (992) guarda a chave da API do Asaas CIFRADA — a
// credencial que lê as cobranças do escritório inteiro. `cb_asaas_clientes`
// e `cb_asaas_cobrancas` (994) guardam o ESPELHO: o CPF/CNPJ de cada
// cliente (que só sai mascarado, pela rota do administrador) e a dívida de
// quem tem e de quem não tem ficha. Nenhuma das três dá NADA a
// `authenticated`: a tela lê pela rota, com service role. RLS fica ligada
// para que um GRANT dado por engano no futuro não abra a tabela para
// qualquer usuário autenticado da instalação. A conferência DENTRO de cada
// migration testa GRANT; este teste roda no job `verificar`, que é portão.
// Mesmo racional do `rls-das-tabelas-do-calendly.test.ts` ao lado.
//
// LIMITE DECLARADO: lê o `.sql`. Uma tabela criada por `EXECUTE format(...)`
// dentro de um DO block é invisível aqui.
// ============================================================

const TABELAS = [
  { tabela: 'cb_asaas_config', migration: '0992_cb_asaas_config.sql' },
  { tabela: 'cb_asaas_clientes', migration: '0994_cb_asaas_espelho.sql' },
  { tabela: 'cb_asaas_cobrancas', migration: '0994_cb_asaas_espelho.sql' },
  // 997: cada entrega do webhook — o id do evento e o que o CRM fez com ele.
  { tabela: 'cb_asaas_eventos', migration: '0997_cb_asaas_webhook.sql' },
] as const;

function lerSemComentarios(migration: string): string {
  return fs
    .readFileSync(path.join(__dirname, migration), 'utf8')
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');
}

const sqlDa = new Map(TABELAS.map((t) => [t.tabela, lerSemComentarios(t.migration)]));

describe('992/994/997 — RLS das tabelas do Asaas', () => {
  it.each(TABELAS)('$tabela tem ENABLE ROW LEVEL SECURITY', ({ tabela }) => {
    const padrao = new RegExp(`ALTER\\s+TABLE\\s+${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    expect(padrao.test(sqlDa.get(tabela)!)).toBe(true);
  });

  it.each(TABELAS)('$tabela não dá NADA a authenticated nem a anon', ({ tabela }) => {
    const sql = sqlDa.get(tabela)!;
    expect(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(sql),
    ).toBe(true);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${tabela}\\b[^;]*\\b(authenticated|anon)\\b`, 'i').test(sql)).toBe(false);
    expect(new RegExp(`CREATE\\s+POLICY[^;]*\\bON\\s+${tabela}\\b`, 'i').test(sql)).toBe(false);
  });

  it.each(TABELAS)('$tabela concede tudo ao service_role por escrito', ({ tabela }) => {
    expect(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+TO\\s+service_role`, 'i').test(sqlDa.get(tabela)!)).toBe(true);
  });

  it('o sandbox é declarado no CHECK, e não deduzido pelo código', () => {
    expect(/CHECK\s*\(\s*ambiente\s+IN\s*\(\s*'producao'\s*,\s*'sandbox'\s*\)\s*\)/i.test(sqlDa.get('cb_asaas_config')!)).toBe(true);
  });

  it('guarda o NOME da chave: o evento de chave do webhook só traz o nome', () => {
    expect(/\bchave_nome\b/.test(sqlDa.get('cb_asaas_config')!)).toBe(true);
  });

  it("o CHECK de vinculo_origem aceita 'criada' (D2) e a régua de elegibilidade tem os seis valores", () => {
    const sql = sqlDa.get('cb_asaas_clientes')!;
    const check = sql.match(/vinculo_origem\s+IN\s*\(([^)]*)\)/i);
    expect(check).not.toBeNull();
    const valores = check![1].match(/'([a-z_]+)'/g)!.map((v) => v.replace(/'/g, ''));
    expect(valores.sort()).toEqual(['cpf', 'criada', 'desvinculado', 'email', 'manual', 'telefone']);
  });

  it('os dois UNIQUE do espelho são TOTAIS (alvo do upsert) e as FKs compostas existem', () => {
    const sql = sqlDa.get('cb_asaas_clientes')!;
    expect(/CONSTRAINT\s+cb_asaas_clientes_uk\s+UNIQUE\s*\(\s*account_id\s*,\s*asaas_customer_id\s*\)/i.test(sql)).toBe(true);
    expect(/CONSTRAINT\s+cb_asaas_cobrancas_uk\s+UNIQUE\s*\(\s*account_id\s*,\s*asaas_payment_id\s*\)/i.test(sql)).toBe(true);
    // Coluna NOMEADA no SET NULL: `account_id` é NOT NULL (lição da 966).
    expect(/REFERENCES\s+contacts\s*\(\s*id\s*,\s*account_id\s*\)\s+ON\s+DELETE\s+SET\s+NULL\s*\(\s*contact_id\s*\)/i.test(sql)).toBe(true);
    expect(/REFERENCES\s+cb_asaas_clientes\s*\(\s*account_id\s*,\s*asaas_customer_id\s*\)\s+ON\s+DELETE\s+CASCADE/i.test(sql)).toBe(true);
  });

  it('997: o token de AUTENTICAÇÃO do webhook fica na config FECHADA, e o id do evento é UNIQUE por conta (idempotência)', () => {
    const sql = lerSemComentarios('0997_cb_asaas_webhook.sql');
    expect(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+webhook_auth_token\s+text/i.test(sql)).toBe(true);
    expect(/CONSTRAINT\s+cb_asaas_eventos_uk\s+UNIQUE\s*\(\s*account_id\s*,\s*asaas_event_id\s*\)/i.test(sql)).toBe(true);
    // O `dateCreated` do evento vai CRU (texto sem fuso): é a medição de C7.
    expect(/evento_criado_em\s+text/i.test(sql)).toBe(true);
  });

  it('o status da cobrança NÃO tem CHECK: status novo do Asaas não pode derrubar a sincronização', () => {
    const sql = sqlDa.get('cb_asaas_cobrancas')!;
    const tabela = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+cb_asaas_cobrancas\s*\(([\s\S]*?)\);/i);
    expect(tabela).not.toBeNull();
    expect(/\bstatus\s+text\s+NOT\s+NULL\s*,/i.test(tabela![1])).toBe(true);
    expect(/status\s+text[^,]*CHECK/i.test(tabela![1])).toBe(false);
  });
});

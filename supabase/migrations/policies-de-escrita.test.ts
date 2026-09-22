import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Disparo e regras são de ADMIN (964) — e ninguém pode reabrir isso
// acrescentando uma policy.
//
// Em Postgres, policies PERMISSIVAS (o padrão) se combinam com **OU**.
// Então as doze policies rígidas da 964 não protegem nada se uma décima
// terceira, frouxa, existir na mesma tabela. A conferência DENTRO da 964
// pega policy renomeada (conta os doze nomes) e policy afrouxada (procura
// `'agent'` nos doze) — e **não pega policy adicionada**, que é justamente
// a forma que a regressão tem.
//
// O caso real, e não é hipotético: a `"Users can manage own broadcasts"`
// (001, `FOR ALL USING auth.uid() = user_id`) foi derrubada pela 017. Um
// merge do upstream a traz de volta, as doze seguem intactas, a migration
// imprime OK e o `agent` volta a disparar broadcast.
//
// ⚠️ POR QUE AQUI, E NÃO SÓ NO SQL. A mesma conferência existe em
// `supabase/ci/verify-schema.sql`, que roda contra o banco limpo e é
// semanticamente mais forte (vê o estado REAL, inclusive policy criada por
// caminho que este parser não enxerga). Mas aquele job é **sinal, não
// portão**: o `deploy` depende só de `verificar`, então uma migração
// vermelha publica assim mesmo. Este teste roda DENTRO de `verificar` — é
// a metade com dentes. As duas juntas cobrem o que cada uma perde.
//
// LIMITE DECLARADO: isto lê os arquivos `.sql`, então policy criada por
// `EXECUTE format(...)` dentro de um DO block é invisível aqui. É por isso
// que a metade SQL existe.
// ============================================================

const DIR = __dirname;

const TABELAS = [
  'automations',
  'automation_steps',
  'flows',
  'flow_nodes',
  'broadcasts',
  'broadcast_recipients',
] as const;

/** As doze da 964 — o conjunto COMPLETO de escrita nessas tabelas. */
const ESPERADAS = [
  'automations.automations_delete',
  'automations.automations_insert',
  'automations.automations_update',
  'automation_steps.automation_steps_modify',
  'broadcast_recipients.broadcast_recipients_modify',
  'broadcasts.broadcasts_delete',
  'broadcasts.broadcasts_insert',
  'broadcasts.broadcasts_update',
  'flow_nodes.flow_nodes_modify',
  'flows.flows_delete',
  'flows.flows_insert',
  'flows.flows_update',
].sort();

const CRIA = /CREATE\s+POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?(\w+)/gi;
const APAGA = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?(\w+)/gi;
// ALTER POLICY troca o PREDICADO e nunca o comando — é assim que a 1032
// reescreveu as três FOR ALL daqui (`… = ANY (ARRAY(SELECT
// cb_contas_do_usuario('admin'…)))`). Sem lê-lo, o teste abaixo conferiria o
// corpo da 964, que já não é o que o banco tem.
const ALTERA = /ALTER\s+POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?(\w+)/gi;

/**
 * Reproduz o replay: aplica os arquivos em ordem e devolve as policies de
 * ESCRITA que sobram nas seis tabelas, com o CORPO da última definição.
 * `Map` porque `CREATE` depois de `DROP` (o padrão deste repo) tem de
 * reescrever, não duplicar.
 *
 * ⚠️ O corpo viaja junto porque nome + comando não bastam: uma migration
 * posterior pode DERRUBAR `broadcasts_insert` e recriá-la com o MESMO nome
 * e `FOR INSERT`, só que `WITH CHECK (is_account_member(account_id,
 * 'agent'))` — a conferência da 964 já rodou (e passou) antes dela, e o
 * teste de conjunto veria exatamente as doze chaves esperadas (achado do
 * Codex no PR #98). O predicado é conferido no FIM do replay, abaixo.
 */
function policiasDeEscritaComCorpo(): Map<string, { cmd: string; corpo: string }> {
  const arquivos = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 0001 < 0017 < 0037 < 0900 < 0964 — largura fixa, ordem lexicográfica serve (ver nomes-das-migrations.test.ts)

  const vivas = new Map<string, { cmd: string; corpo: string }>();

  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');

    for (const m of sql.matchAll(APAGA)) {
      const nome = m[1] ?? m[2];
      if (TABELAS.includes(m[3] as (typeof TABELAS)[number])) {
        vivas.delete(`${m[3]}.${nome}`);
      }
    }

    for (const m of sql.matchAll(CRIA)) {
      const nome = m[1] ?? m[2];
      const tabela = m[3];
      if (!TABELAS.includes(tabela as (typeof TABELAS)[number])) continue;
      // O comando vive entre o `ON <tabela>` e o fim da instrução. Sem
      // `FOR`, o padrão do Postgres é ALL — que é ESCRITA, e é a forma da
      // policy do upstream que este teste existe para pegar.
      // Até o `;` — o corpo inteiro, não os 200 primeiros caracteres: o
      // predicado de `automation_steps_modify` (subselect com JOIN) passa
      // disso, e é nele que o `'agent'` de uma regressão apareceria.
      const corpo = sql.slice(m.index! + m[0].length).split(';')[0];
      const cmd = corpo.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? 'ALL';
      vivas.set(`${tabela}.${nome}`, { cmd: cmd.toUpperCase(), corpo });
    }

    for (const m of sql.matchAll(ALTERA)) {
      const atual = vivas.get(`${m[3]}.${m[1] ?? m[2]}`);
      if (atual) atual.corpo = sql.slice(m.index! + m[0].length).split(';')[0];
    }
  }

  for (const [chave, { cmd }] of vivas) {
    if (cmd === 'SELECT') vivas.delete(chave);
  }
  return vivas;
}

function policiasDeEscrita(): string[] {
  return [...policiasDeEscritaComCorpo().keys()].sort();
}

describe('policies de escrita em disparo/regras (M17)', () => {
  it('são EXATAMENTE as doze da 964 — nenhuma a mais', () => {
    // Deep-equal, não `every`: o ponto do teste é a policy EXTRA, e um
    // `every` sobre as esperadas passaria feliz com uma décima terceira.
    expect(policiasDeEscrita()).toEqual(ESPERADAS);
  });

  it('no FIM do replay, as doze ainda exigem admin — nenhuma foi recriada frouxa', () => {
    // O mesmo critério da conferência da 964 (`'agent'` no predicado), só
    // que sobre a ÚLTIMA definição de cada uma, e não sobre a da 964.
    for (const [chave, { corpo }] of policiasDeEscritaComCorpo()) {
      expect(corpo, `${chave} aceita agent`).not.toMatch(/'agent'/);
      // As duas formas da mesma pergunta: por linha (964) e por consulta (1032).
      expect(corpo, `${chave} não exige admin`).toMatch(
        /is_account_member\([^)]*'admin'\)|cb_contas_do_usuario\('admin'/,
      );
    }
  });

  it('o parser enxerga as policies que o upstream derrubou — senão não prova nada', () => {
    // Sanidade do próprio parser: a `"Users can manage own broadcasts"` da
    // 001 TEM de ser encontrada nos arquivos (e sumir pelo DROP da 017).
    // Sem isto, um parser que não casa nada passaria no teste acima.
    const sql001 = fs.readFileSync(path.join(DIR, '0001_initial_schema.sql'), 'utf8');
    const achadas = [...sql001.matchAll(CRIA)].map((m) => m[1] ?? m[2]);
    expect(achadas).toContain('Users can manage own broadcasts');
  });

  it('o parser enxerga a ALTER da 1032 — o corpo conferido é o do fim do replay', () => {
    // Sem ler ALTER, o teste acima passaria sobre o corpo da 964 — verde, e
    // conferindo um texto que o banco já não tem.
    const passos = policiasDeEscritaComCorpo().get('automation_steps.automation_steps_modify');
    expect(passos?.corpo).toMatch(/cb_contas_do_usuario\('admin'/);
  });
});

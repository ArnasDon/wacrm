import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A 1007 guarda o PAYLOAD de mensagens de cliente (enquanto retidas) e cria a
// função que reescreve `conversations.aguardando_desde`. Três coisas que a
// conferência DENTRO da migration não alcança, e que este teste — que roda no
// job `verificar`, portão do deploy — cobra:
//
//  1. a tabela é FECHADA ao navegador (RLS ligada, zero policy, REVOKE das
//     duas metades) — o mesmo racional do `rls-das-tabelas-dos-webhooks`;
//  2. a fórmula de `aguardando_desde` é a MESMA do gatilho de mensagem
//     apagada da 972. São duas cópias em SQL; mudou numa, muda na outra —
//     senão a conversa mostra "em atraso" por uma régua ao receber mensagem
//     antiga e por outra ao apagar mensagem;
//  3. os nomes que o código TypeScript usa existem no SQL (tabela, colunas,
//     função e parâmetros): o dublê dos testes imita a forma SUPOSTA.
//
// LIMITE DECLARADO: lê o `.sql`. O COMPORTAMENTO foi medido num Postgres 16
// descartável (13 cenários, com o gatilho REAL da 972) — ver
// docs/PLANO-lid-sem-telefone.md, T13.
// ============================================================

const ler = (arquivo: string) => fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const compacto = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const sql1007 = semComentarios(ler('1007_cb_mensagens_sem_telefone.sql'));
const sql972 = semComentarios(ler('0972_cb_aguardando_resposta.sql'));
const TABELA = 'cb_mensagens_sem_telefone';

describe('1007 — a tabela das mensagens sem telefone é fechada ao navegador', () => {
  it('tem ENABLE ROW LEVEL SECURITY', () => {
    expect(
      new RegExp(`alter\\s+table\\s+public\\.${TABELA}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(
        sql1007,
      ),
    ).toBe(true);
  });

  it('revoga as DUAS metades (PUBLIC e os papéis) e não concede nada a anon/authenticated', () => {
    expect(
      new RegExp(
        `revoke\\s+all\\s+on\\s+table\\s+public\\.${TABELA}\\s+from\\s+public,\\s*anon,\\s*authenticated`,
        'i',
      ).test(sql1007),
    ).toBe(true);
    expect(
      new RegExp(`grant[^;]*\\bon\\s+table\\s+public\\.${TABELA}\\b[^;]*\\b(authenticated|anon)\\b`, 'i').test(
        sql1007,
      ),
    ).toBe(false);
  });

  it('não cria policy nenhuma', () => {
    expect(/create\s+policy/i.test(sql1007)).toBe(false);
  });

  it('concede ao service_role POR ESCRITO (o default do Supabase não existe em banco novo)', () => {
    expect(
      new RegExp(`grant\\s+all\\s+on\\s+table\\s+public\\.${TABELA}\\s+to\\s+service_role`, 'i').test(sql1007),
    ).toBe(true);
  });

  it('a função: REVOKE das duas metades + GRANT de volta ao service_role', () => {
    const f = 'public\\.cb_assentar_mensagem_historica\\(uuid,\\s*boolean\\)';
    expect(
      new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${f}\\s+from\\s+public,\\s*anon,\\s*authenticated`, 'i').test(
        sql1007,
      ),
    ).toBe(true);
    expect(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${f}\\s+to\\s+service_role`, 'i').test(sql1007)).toBe(
      true,
    );
  });

  it('o payload existe se, e somente se, a linha está retida (conteúdo de cliente só enquanto é preciso)', () => {
    expect(compacto(sql1007)).toContain("check ((situacao = 'retida') = (payload is not null))");
  });

  it('o UNIQUE é TOTAL — índice parcial não serve de alvo ao ON CONFLICT do PostgREST (lição da 903)', () => {
    expect(compacto(sql1007)).toContain('unique (account_id, provider_message_id)');
  });

  it('SET NULL com a coluna NOMEADA: apagar a conexão não pode tentar zerar account_id (lição da 966)', () => {
    expect(compacto(sql1007)).toContain('on delete set null (channel_id)');
  });
});

describe('1007 × 972 — UMA régua de "desde quando o cliente espera"', () => {
  /** A subconsulta canônica, do `select min(` até fechar — sem espaços nem caixa. */
  function formula(sql: string): string {
    const texto = compacto(sql);
    const ini = texto.indexOf('select min(m.created_at)');
    expect(ini).toBeGreaterThan(-1);
    const fim = texto.indexOf("'-infinity'::timestamptz)", ini);
    expect(fim).toBeGreaterThan(ini);
    return texto.slice(ini, fim);
  }

  it('a fórmula da função é a do gatilho de mensagem apagada, termo a termo', () => {
    // A 972 tem a fórmula DUAS vezes (gatilho e acervo); a primeira é a do gatilho.
    expect(formula(sql1007)).toBe(formula(sql972));
  });

  it('gente = `sender_id` OU `from_device` (o celular pareado), e mensagem apagada não conta', () => {
    const f = formula(sql1007);
    expect(f).toContain('(h.sender_id is not null or h.from_device)');
    expect(f).toContain('m.deleted_at is null');
    expect(f).toContain('h.deleted_at is null');
  });

  it('grupo e conversa encerrada ficam NULOS — as duas invariantes que a 972 confere', () => {
    expect(compacto(sql1007)).toContain("when c.group_id is not null or c.status = 'closed' then null");
  });
});

describe('os nomes que o TypeScript usa existem no SQL', () => {
  const src = path.join(__dirname, '..', '..', 'src');
  const ts = (rel: string) => fs.readFileSync(path.join(src, rel), 'utf8');

  it('as colunas que `retidas.ts` grava e lê', () => {
    const retidas = ts('lib/whatsapp/sem-telefone/retidas.ts');
    expect(retidas).toContain(`'${TABELA}'`);
    for (const coluna of [
      'account_id',
      'channel_id',
      'lid_jid',
      'provider_message_id',
      'from_me',
      'tipo',
      'carimbo',
      'payload',
      'situacao',
      'resolvida_por',
      'message_id',
      'resolvida_em',
    ]) {
      expect(new RegExp(`^\\s+${coluna}\\s`, 'm').test(sql1007), `coluna ${coluna} na 1007`).toBe(true);
      expect(retidas, `${coluna} em retidas.ts`).toContain(coluna);
    }
    // O alvo do upsert é o UNIQUE, coluna por coluna.
    expect(retidas).toContain("onConflict: 'account_id,provider_message_id'");
  });

  it('os valores de situação e de resolvida_por', () => {
    const retidas = ts('lib/whatsapp/sem-telefone/retidas.ts');
    for (const v of ['retida', 'entregue', 'duplicada']) {
      expect(sql1007).toContain(`'${v}'`);
      expect(retidas).toContain(`'${v}'`);
    }
    for (const v of ['acervo', 'religacao']) expect(sql1007).toContain(`'${v}'`);
  });

  it('a função e os DOIS parâmetros que `historica.ts` passa', () => {
    const historica = ts('lib/whatsapp/sem-telefone/historica.ts');
    expect(historica).toContain("rpc('cb_assentar_mensagem_historica'");
    for (const p of ['p_conversation_id', 'p_conta_nao_lida']) {
      expect(sql1007).toContain(p);
      expect(historica).toContain(p);
    }
  });

  it('a rota do Meu dia lê as colunas que existem', () => {
    const rota = ts('app/api/cb/meu-dia/pendencias/route.ts');
    expect(rota).toContain(`'${TABELA}'`);
    expect(sql1007).toMatch(/^\s+recebida_em\s/m);
    expect(rota).toContain('recebida_em');
  });
});

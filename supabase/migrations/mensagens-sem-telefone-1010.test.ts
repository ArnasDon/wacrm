import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A 1010 guarda o PAYLOAD de mensagens de cliente (enquanto retidas) e cria a
// função que reescreve `conversations.aguardando_desde`. Três coisas que a
// conferência DENTRO da migration não alcança, e que este teste — que roda no
// job `verificar`, portão do deploy — cobra:
//
//  1. a tabela é FECHADA ao navegador (RLS ligada, zero policy, REVOKE das
//     duas metades) — o mesmo racional do `rls-das-tabelas-dos-webhooks`;
//  2. a função de `aguardando_desde` usa a MESMA régua de "resposta de gente"
//     do gatilho da 972 (`sender_id` OU `from_device`, mensagem apagada não
//     conta) — e NÃO copia o recálculo canônico do gatilho de mensagem
//     apagada, que ressuscita espera já limpa por um encerramento (medido
//     pela revisão em 19/09/2026);
//  3. os nomes que o código TypeScript usa existem no SQL (tabela, colunas,
//     função e parâmetros): o dublê dos testes imita a forma SUPOSTA.
//
// LIMITE DECLARADO: lê o `.sql`. O COMPORTAMENTO foi medido num Postgres 16
// descartável (20 cenários, com o gatilho REAL da 972) — ver
// docs/PLANO-lid-sem-telefone.md, T13.
// ============================================================

const ler = (arquivo: string) => fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const compacto = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const sql1010 = semComentarios(ler('1010_cb_mensagens_sem_telefone.sql'));
// ⚠️ A função foi REDEFINIDA pela 1011 (a 1010 já estava aplicada quando o
// Codex achou a corrida do eco). Os pinos do CORPO leem a definição VIGENTE —
// pinar a da 1010 seria vigiar um texto que o banco já não executa.
const sql1011 = semComentarios(ler('1011_cb_historica_eco_e_resposta_concorrente.sql'));
const sql972 = semComentarios(ler('0972_cb_aguardando_resposta.sql'));
const TABELA = 'cb_mensagens_sem_telefone';

describe('1010 — a tabela das mensagens sem telefone é fechada ao navegador', () => {
  it('tem ENABLE ROW LEVEL SECURITY', () => {
    expect(
      new RegExp(`alter\\s+table\\s+public\\.${TABELA}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(
        sql1010,
      ),
    ).toBe(true);
  });

  it('revoga as DUAS metades (PUBLIC e os papéis) e não concede nada a anon/authenticated', () => {
    expect(
      new RegExp(
        `revoke\\s+all\\s+on\\s+table\\s+public\\.${TABELA}\\s+from\\s+public,\\s*anon,\\s*authenticated`,
        'i',
      ).test(sql1010),
    ).toBe(true);
    expect(
      new RegExp(`grant[^;]*\\bon\\s+table\\s+public\\.${TABELA}\\b[^;]*\\b(authenticated|anon)\\b`, 'i').test(
        sql1010,
      ),
    ).toBe(false);
  });

  it('não cria policy nenhuma', () => {
    expect(/create\s+policy/i.test(sql1010)).toBe(false);
  });

  it('concede ao service_role POR ESCRITO (o default do Supabase não existe em banco novo)', () => {
    expect(
      new RegExp(`grant\\s+all\\s+on\\s+table\\s+public\\.${TABELA}\\s+to\\s+service_role`, 'i').test(sql1010),
    ).toBe(true);
  });

  it('a função: REVOKE das duas metades + GRANT de volta ao service_role', () => {
    const f =
      'public\\.cb_assentar_mensagem_historica\\(uuid,\\s*timestamptz,\\s*boolean,\\s*timestamptz,\\s*boolean\\)';
    expect(
      new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${f}\\s+from\\s+public,\\s*anon,\\s*authenticated`, 'i').test(
        sql1010,
      ),
    ).toBe(true);
    expect(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${f}\\s+to\\s+service_role`, 'i').test(sql1010)).toBe(
      true,
    );
  });

  it('o payload existe se, e somente se, a linha está retida (conteúdo de cliente só enquanto é preciso)', () => {
    expect(compacto(sql1010)).toContain("check ((situacao = 'retida') = (payload is not null))");
  });

  it('o UNIQUE é TOTAL — índice parcial não serve de alvo ao ON CONFLICT do PostgREST (lição da 903)', () => {
    expect(compacto(sql1010)).toContain('unique (account_id, provider_message_id)');
  });

  it('SET NULL com a coluna NOMEADA: apagar a conexão não pode tentar zerar account_id (lição da 966)', () => {
    expect(compacto(sql1010)).toContain('on delete set null (channel_id)');
  });
});

describe('1010 × 972 — a função desfaz só o que ESTA mensagem estragou', () => {
  /** O corpo VIGENTE da função (1011), do `as $$` ao `$$;` — sem espaços nem caixa. */
  const corpo = (() => {
    const texto = compacto(sql1011);
    const ini = texto.indexOf('create or replace function public.cb_assentar_mensagem_historica');
    expect(ini).toBeGreaterThan(-1);
    const abre = texto.indexOf('as $$', ini);
    const fecha = texto.indexOf('$$;', abre + 5);
    expect(fecha).toBeGreaterThan(abre);
    return texto.slice(abre, fecha);
  })();

  it('gente = `sender_id` OU `from_device` (o celular pareado), e mensagem apagada não conta — a régua do gatilho da 972', () => {
    const regua = '(h.sender_id is not null or h.from_device)';
    expect(compacto(sql972)).toContain(regua);
    // Três perguntas "gente respondeu depois?": o eco POSTERIOR à espera (a da
    // 1011), o eco ANTERIOR a ela, e a fala do cliente.
    expect(corpo.split(regua).length - 1).toBe(3);
    expect(corpo.split('h.deleted_at is null').length - 1).toBe(3);
    expect(corpo).toContain('m.deleted_at is null');
  });

  // O achado do Codex no PR #226: no ramo do eco POSTERIOR à espera, a fala de
  // cliente que fica "esperando" tem de ser uma que NINGUÉM respondeu depois —
  // senão a resposta real que chega entre a leitura da espera e esta função é
  // desfeita, e o cliente atendido aparece "em atraso". Reproduzido e
  // consertado num Postgres 16 com o gatilho real.
  it('eco posterior à espera: só conta a fala de cliente SEM resposta de gente depois dela', () => {
    const ramo = corpo.slice(corpo.indexOf('when p_carimbo > p_espera_antes then'));
    const ate = ramo.indexOf('when exists');
    expect(ate).toBeGreaterThan(-1);
    const subconsulta = ramo.slice(0, ate);
    expect(subconsulta).toContain('m.created_at > p_carimbo');
    expect(subconsulta).toContain('and not exists (');
    expect(subconsulta).toContain('h.created_at > m.created_at');
  });

  it('a 1011 só troca o CORPO: mesma assinatura da 1010, e confere que sobrou UMA função', () => {
    const assinatura = (sql: string) =>
      compacto(sql).match(/create or replace function public\.cb_assentar_mensagem_historica\(([^)]*)\)/)?.[1];
    expect(assinatura(sql1011)).toBeTruthy();
    expect(assinatura(sql1011)).toBe(assinatura(sql1010));
    expect(compacto(sql1011)).toContain("p.proname = 'cb_assentar_mensagem_historica'");
    expect(compacto(sql1011)).toContain('set local role service_role');
  });

  it('grupo e conversa encerrada ficam NULOS — as duas invariantes que a 972 confere', () => {
    expect(corpo).toContain("when c.group_id is not null or c.status = 'closed' then null");
  });

  // ⚠️ O pino do achado da revisão. O recálculo canônico ("a fala de cliente
  // mais antiga depois da ÚLTIMA resposta de gente") não sabe que ENCERRAR
  // limpa a espera: ressuscitava o "ok, obrigado" de semanas atrás. A forma
  // dele é inconfundível — o `max(` da última resposta e o `-infinity`.
  it('NÃO recalcula a espera do zero: sem `max(h.created_at)` e sem `-infinity`', () => {
    expect(corpo).not.toContain('max(h.created_at)');
    expect(corpo).not.toContain('-infinity');
  });

  it('tudo é relativo ao carimbo DESTA mensagem ou à espera que havia antes dela', () => {
    expect(corpo).toContain('m.created_at > p_carimbo');
    expect(corpo).toContain('h.created_at > p_carimbo');
    expect(corpo).toContain('h.created_at > p_espera_antes');
    expect(corpo).toContain('when p_espera_antes is null then c.aguardando_desde');
    expect(corpo).toContain('when p_carimbo > p_espera_antes then');
    expect(corpo).toContain('else least(p_espera_antes, c.aguardando_desde)');
    // fala já respondida: desfaz SÓ o que o gatilho acabou de pôr (este carimbo)
    expect(corpo).toContain('case when c.aguardando_desde = p_carimbo then null else c.aguardando_desde end');
    expect(corpo).toContain('else least(c.aguardando_desde, p_carimbo)');
  });

  it('SECURITY INVOKER prova o privilégio trocando de papel, e concede o que confere', () => {
    const t = compacto(sql1010);
    expect(t).toContain('security invoker');
    expect(t).toContain('grant select, update on table public.conversations to service_role');
    expect(t).toContain('grant select on table public.messages to service_role');
    expect(t).toContain('set local role service_role');
    expect(t).toContain('exception when insufficient_privilege');
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
      expect(new RegExp(`^\\s+${coluna}\\s`, 'm').test(sql1010), `coluna ${coluna} na 1010`).toBe(true);
      expect(retidas, `${coluna} em retidas.ts`).toContain(coluna);
    }
    // O alvo do upsert é o UNIQUE, coluna por coluna.
    expect(retidas).toContain("onConflict: 'account_id,provider_message_id'");
  });

  it('os valores de situação e de resolvida_por', () => {
    const retidas = ts('lib/whatsapp/sem-telefone/retidas.ts');
    for (const v of ['retida', 'entregue', 'duplicada']) {
      expect(sql1010).toContain(`'${v}'`);
      expect(retidas).toContain(`'${v}'`);
    }
    for (const v of ['acervo', 'religacao']) expect(sql1010).toContain(`'${v}'`);
  });

  it('a função e os CINCO parâmetros que `historica.ts` passa — nem um a mais, nem um a menos', () => {
    const historica = ts('lib/whatsapp/sem-telefone/historica.ts');
    expect(historica).toContain("rpc('cb_assentar_mensagem_historica'");
    const PARAMETROS = ['p_conversation_id', 'p_carimbo', 'p_da_equipe', 'p_espera_antes', 'p_conta_nao_lida'];
    for (const p of PARAMETROS) {
      expect(sql1010).toContain(p);
      expect(historica, `${p} em historica.ts`).toContain(`${p}:`);
    }
    // O PostgREST resolve a função pelos NOMES dos argumentos: um parâmetro a
    // mais ou a menos no TS dá "function not found", e a histórica entra sem
    // o acerto da espera — com um erro no log como único rastro.
    const noTs = [...historica.matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]).sort();
    expect(noTs).toEqual([...PARAMETROS].sort());
    const assinatura = compacto(sql1010).match(
      /create or replace function public\.cb_assentar_mensagem_historica\(([^)]*)\)/,
    );
    expect(assinatura).not.toBeNull();
    const noSql = assinatura![1].split(',').map((x) => x.trim().split(' ')[0]).sort();
    expect(noSql).toEqual([...PARAMETROS].sort());
  });

  it('a rota do Meu dia lê as colunas que existem', () => {
    const rota = ts('app/api/cb/meu-dia/pendencias/route.ts');
    expect(rota).toContain(`'${TABELA}'`);
    expect(sql1010).toMatch(/^\s+recebida_em\s/m);
    expect(rota).toContain('recebida_em');
  });
});

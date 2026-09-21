import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * DUBLÊ de banco para os testes de `sem-telefone/` — um Supabase em memória
 * com o subconjunto de PostgREST que estes módulos usam.
 *
 * ⚠️ NÃO vale como teste de PostgREST: ele imita a forma SUPOSTA das
 * consultas (a lição do `storage.exists()`). Por isso os módulos só usam
 * formas que JÁ rodam em produção neste repositório — `!inner` com filtro no
 * embutido (rota do webhook, edição cifrada), `.like('%sufixo')`
 * (`findExistingContact`), `.or('sender_id.not.is.null,from_device.is.true')`
 * (`use-radar.ts`), upsert com `onConflict`/`ignoreDuplicates` (Calendly) — e
 * a ponta a ponta contra o banco real está no plano
 * (docs/PLANO-lid-sem-telefone.md, T18). Vale como pino do COMPORTAMENTO — o
 * que é gravado, em que ordem, e o que acontece quando uma consulta falha.
 *
 * O `*.test-helper.ts` no nome o tira das varreduras estruturais
 * (`dono-duravel`, `chamadores`): não é código de produção.
 */

export type Linha = Record<string, unknown>;

/** UNIQUEs simulados: 23505 no insert, alvo do upsert. */
const UNIQUES: Record<string, string[]> = {
  messages: ['conversation_id', 'message_id'],
  cb_mensagens_sem_telefone: ['account_id', 'provider_message_id'],
};

export interface Banco {
  tabelas: Record<string, Linha[]>;
  /** tabela → erro devolvido por TODA operação nela (`{ data: null, error }`). */
  falhas: Record<string, { code?: string; message: string }>;
  /** tudo que foi escrito, na ordem. */
  escritas: { tabela: string; op: string; payload: unknown }[];
  rpcs: { nome: string; args: Linha }[];
  /** nome da rpc → erro. */
  falhasDeRpc: Record<string, { code?: string; message: string }>;
  db: SupabaseClient;
}

let serie = 1;
const novoId = (p: string) => `${p}-${String(serie++).padStart(4, '0')}`;

/** `a.b` lê o recurso embutido (`conversations.account_id`). */
function ler(linha: Linha, col: string): unknown {
  return col.split('.').reduce<unknown>((o, k) => (o as Linha | undefined)?.[k], linha);
}

/** O pedaço de `.or()` que estes módulos usam: `col.not.is.null` e `col.is.true`. */
function condicaoDoOr(parte: string): (l: Linha) => boolean {
  const [col, ...resto] = parte.split('.');
  const op = resto.join('.');
  if (op === 'not.is.null') return (l) => l[col] != null;
  if (op === 'is.true') return (l) => l[col] === true;
  throw new Error(`dublê: forma de .or() não suportada: ${parte}`);
}

export function criarBanco(tabelas: Record<string, Linha[]> = {}): Banco {
  const banco: Banco = {
    tabelas,
    falhas: {},
    escritas: [],
    rpcs: [],
    falhasDeRpc: {},
    db: null as unknown as SupabaseClient,
  };

  function consulta(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Linha = {};
    let opcoes: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = Infinity;
    let devolve = false;

    const executar = (): { data: Linha[] | null; error: unknown } => {
      const falha = banco.falhas[tabela];
      if (falha) return { data: null, error: falha };
      const linhas = (banco.tabelas[tabela] ??= []);

      if (op === 'insert' || op === 'upsert') {
        const chave = UNIQUES[tabela];
        const existente = chave
          ? linhas.find((l) => chave.every((c) => l[c] != null && l[c] === payload[c]))
          : undefined;
        banco.escritas.push({ tabela, op, payload: { ...payload } });
        if (existente) {
          if (op === 'insert') {
            return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          }
          if (opcoes.ignoreDuplicates) return { data: [], error: null };
          Object.assign(existente, payload);
          return { data: [{ ...existente }], error: null };
        }
        const nova: Linha = { id: novoId(tabela.slice(0, 3)), ...payload };
        linhas.push(nova);
        return { data: devolve ? [{ ...nova }] : null, error: null };
      }

      let alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === 'update') {
        banco.escritas.push({ tabela, op, payload: { ...payload } });
        for (const l of alvo) Object.assign(l, payload);
        return { data: devolve ? alvo.map((l) => ({ ...l })) : null, error: null };
      }
      if (ordem) {
        const { col, asc } = ordem;
        alvo = [...alvo].sort((a, b) => {
          const [x, y] = [String(ler(a, col) ?? ''), String(ler(b, col) ?? '')];
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      return { data: alvo.slice(0, limite).map((l) => ({ ...l })), error: null };
    };

    const q = {
      select: () => {
        if (op !== 'select') devolve = true;
        return q;
      },
      insert: (p: Linha) => ((op = 'insert'), (payload = p), q),
      update: (p: Linha) => ((op = 'update'), (payload = p), q),
      upsert: (p: Linha, o: typeof opcoes = {}) => ((op = 'upsert'), (payload = p), (opcoes = o), q),
      eq: (c: string, v: unknown) => (filtros.push((l) => ler(l, c) === v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (ler(l, c) ?? null) === v), q),
      gt: (c: string, v: string) => (filtros.push((l) => String(ler(l, c)) > v), q),
      like: (c: string, padrao: string) => {
        const sufixo = padrao.replace(/^%/, '');
        filtros.push((l) => String(ler(l, c) ?? '').endsWith(sufixo));
        return q;
      },
      or: (expr: string) => {
        const partes = expr.split(',').map(condicaoDoOr);
        filtros.push((l) => partes.some((p) => p(l)));
        return q;
      },
      order: (col: string, o: { ascending?: boolean } = {}) => {
        ordem = { col, asc: o.ascending !== false };
        return q;
      },
      limit: (n: number) => ((limite = n), q),
      maybeSingle: () => {
        const r = executar();
        return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
      },
      single: () => {
        const r = executar();
        if (r.error) return Promise.resolve({ data: null, error: r.error });
        return Promise.resolve({ data: r.data?.[0] ?? null, error: null });
      },
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, falha),
    };
    return q;
  }

  banco.db = {
    from: (tabela: string) => consulta(tabela),
    rpc: (nome: string, args: Linha) => {
      banco.rpcs.push({ nome, args });
      return Promise.resolve({ data: null, error: banco.falhasDeRpc[nome] ?? null });
    },
  } as unknown as SupabaseClient;
  return banco;
}

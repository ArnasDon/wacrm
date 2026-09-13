import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClienteAsaas, PaginaDoAsaas } from "./cliente";

/**
 * DUBLÊS para os testes da sincronização — um Supabase em memória com o
 * subconjunto de PostgREST que `sincronizar.ts`, `criar-ficha.ts` e
 * `aplicar.ts` usam, e um cliente do Asaas alimentado por listas fixas.
 *
 * Não vale como teste de PostgREST — vale como pino do COMPORTAMENTO: o que
 * o upsert preserva, quem é ligado e por quê, quando a ficha nasce, o que a
 * reconciliação relê. Só o `*.test-helper.ts` no nome o tira das varreduras
 * estruturais (`dono-duravel`, `chamadores`) — ele não é código de produção.
 */

export type Linha = Record<string, unknown>;

export interface EstadoDoDuble {
  tabelas: Record<string, Linha[]>;
  /** todo insert/upsert/update/delete, na ordem */
  escritas: { tabela: string; op: string; payload: unknown; filtros: Filtro[] }[];
}

interface Filtro {
  tipo: "eq" | "neq" | "is" | "in" | "lt" | "lte" | "gt" | "gte" | "like" | "ilike" | "not" | "or";
  col: string;
  val: unknown;
  op?: string;
}

/** UNIQUEs que o dublê simula (23505 no insert; alvo do upsert). */
const UNIQUES: Record<string, string[][]> = {
  contacts: [["account_id", "phone_normalized"]],
  cb_asaas_clientes: [["account_id", "asaas_customer_id"]],
  cb_asaas_cobrancas: [["account_id", "asaas_payment_id"]],
  tags: [["account_id", "name_key"]],
  contact_tags: [["contact_id", "tag_id"]],
};

let proximoId = 1;
export function idDeTeste(prefixo = "id"): string {
  const n = String(proximoId++).padStart(4, "0");
  return `${prefixo.slice(0, 4).padEnd(4, "0")}0000-0000-4000-8000-00000000${n}`;
}

/** Os DEFAULTs de coluna que o banco daria — sem eles o dublê devolveria `undefined` onde o Postgres devolve `null`. */
const DEFAULTS: Record<string, Linha> = {
  cb_asaas_clientes: { contact_id: null, vinculo_origem: null, vinculado_por: null, vinculado_por_nome: null, vinculado_em: null, contatos_recusados: [], candidatos: [], deleted: false, email: null, celular: null, telefone: null, cpf_cnpj: null, etiqueta_pendente: false },
  cb_asaas_config: { sincronizando_desde: null, vinculo_completo_em: null },
  cb_asaas_cobrancas: { deleted: false, vista_vencida_em: null, parcela_total: null, juros_e_multa: null },
  contacts: { name: null, email: null },
};

/** As colunas GERADAS que o banco derivaria do payload. */
function derivadas(tabela: string, linha: Linha): Linha {
  const extra: Linha = {};
  if (tabela === "contacts" && typeof linha.phone === "string") extra.phone_normalized = linha.phone.replace(/\D/g, "");
  if (tabela === "tags" && typeof linha.name === "string") extra.name_key = linha.name.trim().normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  return extra;
}

/** A linha como o INSERT a criaria: defaults, id e colunas geradas. */
function normalizarLinha(tabela: string, linha: Linha): Linha {
  const nova: Linha = { ...(DEFAULTS[tabela] ?? {}), ...linha, ...derivadas(tabela, linha) };
  if (nova.id === undefined) nova.id = idDeTeste(tabela.replace(/[^a-z]/g, "").slice(0, 4));
  return nova;
}

function casa(linha: Linha, f: Filtro): boolean {
  const v = linha[f.col];
  switch (f.tipo) {
    case "eq":
      return v === f.val || String(v) === String(f.val);
    case "neq":
      return v !== f.val;
    case "is":
      return f.val === null ? v === null || v === undefined : v === f.val;
    case "in":
      return Array.isArray(f.val) && f.val.some((x) => x === v || String(x) === String(v));
    case "lt":
      return v !== null && v !== undefined && String(v) < String(f.val);
    case "lte":
      return v !== null && v !== undefined && String(v) <= String(f.val);
    case "gt":
      return v !== null && v !== undefined && String(v) > String(f.val);
    case "gte":
      return v !== null && v !== undefined && String(v) >= String(f.val);
    case "like":
    case "ilike": {
      const padrao = String(f.val);
      const texto = String(v ?? "");
      const re = new RegExp(`^${padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, f.tipo === "ilike" ? "i" : "");
      return re.test(texto);
    }
    case "not":
      return !casa(linha, { tipo: f.op as Filtro["tipo"], col: f.col, val: f.val });
    case "or":
      return avaliarOr(linha, String(f.val));
  }
}

/** Divide por vírgula no nível de cima, respeitando parênteses. */
function dividir(expr: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of expr) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual !== "") partes.push(atual);
  return partes;
}

function avaliarTermo(linha: Linha, termo: string): boolean {
  if (termo.startsWith("and(")) return dividir(termo.slice(4, -1)).every((t) => avaliarTermo(linha, t));
  if (termo.startsWith("or(")) return dividir(termo.slice(3, -1)).some((t) => avaliarTermo(linha, t));
  const m = termo.match(/^([a-z_]+)\.(is|eq|in|lt|gt|neq)\.([\s\S]+)$/);
  if (!m) throw new Error(`dublê: termo de .or() não suportado: ${termo}`);
  const [, col, op, bruto] = m;
  if (op === "is") return casa(linha, { tipo: "is", col, val: bruto === "null" ? null : bruto === "true" });
  if (op === "in") return casa(linha, { tipo: "in", col, val: bruto.slice(1, -1).split(",") });
  return casa(linha, { tipo: op as Filtro["tipo"], col, val: bruto });
}

function avaliarOr(linha: Linha, expr: string): boolean {
  return dividir(expr).some((t) => avaliarTermo(linha, t));
}

function conflita(tabela: string, a: Linha, b: Linha, colunas: string[]): boolean {
  return colunas.every((c) => a[c] !== null && a[c] !== undefined && a[c] === b[c]);
}

export function dubleDoSupabase(estado: EstadoDoDuble): SupabaseClient {
  const tabela = (nome: string) => (estado.tabelas[nome] ??= []);

  function from(nome: string) {
    const filtros: Filtro[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: unknown = null;
    let opcoes: { onConflict?: string; ignoreDuplicates?: boolean; count?: string; head?: boolean } = {};
    let devolver = false;
    let faixa: [number, number] | null = null;
    let teto: number | null = null;

    function executar(): { data: unknown; error: { message: string; code?: string } | null; count: number | null } {
      const linhas = tabela(nome);
      const filtradas = linhas.filter((l) => filtros.every((f) => casa(l, f)));
      if (op === "select") {
        let saida = filtradas;
        if (faixa) saida = saida.slice(faixa[0], faixa[1] + 1);
        if (teto !== null) saida = saida.slice(0, teto);
        return { data: opcoes.head ? null : saida.map((l) => ({ ...l })), error: null, count: filtradas.length };
      }
      estado.escritas.push({ tabela: nome, op, payload, filtros: [...filtros] });
      if (op === "update") {
        for (const l of filtradas) Object.assign(l, payload as Linha);
        return { data: devolver ? filtradas.map((l) => ({ ...l })) : null, error: null, count: filtradas.length };
      }
      if (op === "delete") {
        estado.tabelas[nome] = linhas.filter((l) => !filtradas.includes(l));
        return { data: devolver ? filtradas.map((l) => ({ ...l })) : null, error: null, count: filtradas.length };
      }
      const cruas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
      const inseridas: Linha[] = [];
      for (const crua of cruas) {
        const nova = normalizarLinha(nome, crua);
        const uniques = UNIQUES[nome] ?? [];
        const existente = linhas.find((l) => uniques.some((u) => conflita(nome, l, nova, u)));
        if (existente) {
          if (op === "insert") return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" }, count: null };
          if (opcoes.ignoreDuplicates) continue;
          // ⚠️ Como o PostgREST: o upsert só escreve as colunas PRESENTES no
          // payload — as ausentes mantêm o valor (é o que `vista_vencida_em`
          // e o vínculo dependem).
          Object.assign(existente, crua, derivadas(nome, crua), { id: existente.id });
          inseridas.push(existente);
        } else {
          linhas.push(nova);
          inseridas.push(nova);
        }
      }
      return { data: devolver ? inseridas.map((l) => ({ ...l })) : null, error: null, count: inseridas.length };
    }

    const q: Record<string, unknown> = {
      select: (_cols?: string, o?: typeof opcoes) => {
        if (op !== "select") devolver = true;
        if (o) opcoes = { ...opcoes, ...o };
        return q;
      },
      insert: (p: unknown) => ((op = "insert"), (payload = p), q),
      upsert: (p: unknown, o?: typeof opcoes) => ((op = "upsert"), (payload = p), (opcoes = { ...opcoes, ...(o ?? {}) }), q),
      update: (p: unknown) => ((op = "update"), (payload = p), q),
      delete: (o?: typeof opcoes) => ((op = "delete"), (opcoes = { ...opcoes, ...(o ?? {}) }), q),
      eq: (col: string, val: unknown) => (filtros.push({ tipo: "eq", col, val }), q),
      neq: (col: string, val: unknown) => (filtros.push({ tipo: "neq", col, val }), q),
      is: (col: string, val: unknown) => (filtros.push({ tipo: "is", col, val }), q),
      in: (col: string, val: unknown) => (filtros.push({ tipo: "in", col, val }), q),
      lt: (col: string, val: unknown) => (filtros.push({ tipo: "lt", col, val }), q),
      lte: (col: string, val: unknown) => (filtros.push({ tipo: "lte", col, val }), q),
      gt: (col: string, val: unknown) => (filtros.push({ tipo: "gt", col, val }), q),
      gte: (col: string, val: unknown) => (filtros.push({ tipo: "gte", col, val }), q),
      like: (col: string, val: unknown) => (filtros.push({ tipo: "like", col, val }), q),
      ilike: (col: string, val: unknown) => (filtros.push({ tipo: "ilike", col, val }), q),
      not: (col: string, o: string, val: unknown) => (filtros.push({ tipo: "not", col, op: o, val }), q),
      or: (expr: string) => (filtros.push({ tipo: "or", col: "", val: expr }), q),
      order: () => q,
      range: (de: number, ate: number) => ((faixa = [de, ate]), q),
      limit: (n: number) => ((teto = n), q),
      single: async () => {
        const r = executar();
        const lista = (r.data as Linha[] | null) ?? [];
        if (r.error) return { data: null, error: r.error };
        return lista.length === 1 ? { data: lista[0], error: null } : { data: null, error: { message: `single(): ${lista.length} linhas` } };
      },
      maybeSingle: async () => {
        const r = executar();
        const lista = (r.data as Linha[] | null) ?? [];
        if (r.error) return { data: null, error: r.error };
        return { data: lista[0] ?? null, error: null };
      },
      then: (resolver: (r: unknown) => unknown, rejeitar?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(executar()).then(resolver, rejeitar);
        } catch (e) {
          return rejeitar ? rejeitar(e) : Promise.reject(e);
        }
      },
    };
    return q;
  }
  return { from } as unknown as SupabaseClient;
}

export interface RespostasDoAsaas {
  /** por caminho de LISTAGEM ("/customers", "/payments?status=OVERDUE,DUNNING_REQUESTED"…) */
  listas: Record<string, unknown[]>;
  /** por caminho de RECURSO ("/customers/cus_1", "/payments/pay_1") — `null` = 404 */
  recursos: Record<string, unknown | null>;
  /** lança este erro em qualquer pedido */
  erro?: Error;
}

/** O que foi pedido ao Asaas, na ordem. */
export interface PedidosAoAsaas {
  pedidos: string[];
}

export function dubleDoAsaas(respostas: RespostasDoAsaas, registro: PedidosAoAsaas = { pedidos: [] }): ClienteAsaas {
  const chave = (caminho: string, params?: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (k !== "limit" && k !== "offset" && v !== undefined) u.set(k, String(v));
    const q = u.toString();
    return q ? `${caminho}?${q}` : caminho;
  };
  return {
    async listar<T>(caminho: string, params?: Record<string, string | number | undefined>): Promise<PaginaDoAsaas<T>> {
      const c = chave(caminho, params);
      registro.pedidos.push(c);
      if (respostas.erro) throw respostas.erro;
      const data = (respostas.listas[c] ?? []) as T[];
      return { data, hasMore: false, totalCount: data.length };
    },
    async listarTudo<T>(caminho: string, params?: Record<string, string | number | undefined>, _teto?: number, aCadaPagina?: () => Promise<void>): Promise<T[]> {
      const c = chave(caminho, params);
      registro.pedidos.push(c);
      if (respostas.erro) throw respostas.erro;
      // o dublê devolve tudo numa página; o batimento entre páginas é chamado uma vez para o teste enxergá-lo
      if (aCadaPagina) await aCadaPagina();
      return (respostas.listas[c] ?? []) as T[];
    },
    async obter<T>(caminho: string): Promise<T | null> {
      registro.pedidos.push(caminho);
      if (respostas.erro) throw respostas.erro;
      return (respostas.recursos[caminho] ?? null) as T | null;
    },
    cota: () => ({}),
  };
}

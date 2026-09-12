/**
 * Cliente da API do Asaas (v3) — só o que a integração usa: listar clientes,
 * listar cobranças, ler um recurso por id. Molde dos irmãos (Meta Ads,
 * Calendly, tl;dv), com as diferenças que a doc do Asaas impõe:
 *
 * - ⚠️ A chave vai no cabeçalho **`access_token`**, NÃO em `Authorization:
 *   Bearer`, e NUNCA na URL (URL vaza em log de proxy). A chave começa com
 *   `$` (`$aact_prod_…`) e o `$` faz parte dela.
 * - ⚠️ **`User-Agent` é obrigatório** para conta criada desde 13/06/2024 —
 *   sem ele o Asaas recusa. Ele sai do nome do produto (`NOME_DO_APP`), e
 *   passa por `agente()`: um nome com acento faria o `fetch` LANÇAR em TODA
 *   chamada, com um erro que não fala de acento nenhum.
 * - ⚠️ **GET com CORPO devolve 403.** Por isso `pedir()` nunca monta `body`
 *   num GET, e todo filtro viaja na query.
 * - ⚠️ **404 também significa "id de outra conta"**, não só "não existe".
 *   Quem lê um recurso por id recebe `null` e não pode concluir "foi
 *   apagado".
 * - Erro vira CÓDIGO (`chave_invalida`, `sem_permissao`, …) para a tela
 *   traduzir; a mensagem do Asaas fica no `Error.message` para o log,
 *   depois de passar por `semSegredo()` — a mesma disciplina do Meta Ads e
 *   do Calendly, onde a mensagem do provedor ECOAVA o segredo.
 * - Só fala com o host do ambiente (`doAsaas()` confere antes de cada
 *   pedido). Hoje nenhuma URL vem da resposta, mas a regra é a mesma dos
 *   irmãos — uma URL de outro host levaria a chave junto.
 * - ⚠️ A cota é da **CONTA do Asaas**, não da chave: 25.000 pedidos a cada
 *   12 h e 50 GET simultâneos, dividido com qualquer outro sistema do
 *   escritório que use a API. Por isso o cliente guarda os cabeçalhos
 *   `RateLimit-*` da última resposta (o cartão os mostra) e a paginação tem
 *   TETO — e o teto ESTOURA em vez de devolver meia lista (lição do Meta
 *   Ads: meia lista vira número errado com cara de número certo).
 */

import { NOME_DO_APP } from "@/lib/marca";

/**
 * O nome do produto em ASCII, para caber num cabeçalho HTTP. O `NOME_DO_APP`
 * vem de `NEXT_PUBLIC_APP_NAME` e cada instalação escreve o que quiser lá —
 * "Jurídico Ação", por exemplo, derrubaria toda chamada ao Asaas.
 */
export function agente(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
  return limpo === "" ? "CRM" : limpo;
}

export const ORIGEM_ASAAS = "https://api.asaas.com";
export const ORIGEM_ASAAS_SANDBOX = "https://api-sandbox.asaas.com";

export type AmbienteDoAsaas = "producao" | "sandbox";

const TIMEOUT_MS = 20_000;
/** Teto da API por página (o padrão dela é 10). */
export const POR_PAGINA_MAX = 100;
/** Teto de páginas de uma listagem: 100 × 100 = 10.000 linhas. */
export const PAGINAS_MAX = 100;

export type CodigoDoErroAsaas =
  | "chave_invalida"
  | "ambiente_errado"
  | "sem_permissao"
  | "nao_encontrado"
  | "limite"
  | "rede"
  | "asaas_error";

export class AsaasError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroAsaas,
    mensagem: string,
    /** O `code` do corpo do Asaas, quando veio (ex.: `insufficient_permission`). */
    public readonly codigoDoAsaas: string | null = null,
    public readonly status: number | null = null,
  ) {
    super(mensagem);
    this.name = "AsaasError";
  }
}

export function baseDoAmbiente(ambiente: AmbienteDoAsaas): string {
  return `${ambiente === "sandbox" ? ORIGEM_ASAAS_SANDBOX : ORIGEM_ASAAS}/v3`;
}

/** A URL é do Asaas daquele ambiente? Todo pedido passa por aqui. */
export function doAsaas(url: string, ambiente: AmbienteDoAsaas): boolean {
  try {
    return new URL(url).origin === (ambiente === "sandbox" ? ORIGEM_ASAAS_SANDBOX : ORIGEM_ASAAS);
  } catch {
    return false;
  }
}

/**
 * Puro: o status HTTP (e o `code` do corpo, quando vem) → o nosso código.
 * ⚠️ 401 com `invalid_environment` é chave do ambiente ERRADO — sandbox
 * numa base de produção, o engano mais fácil de cometer e o mais difícil de
 * enxergar depois.
 */
export function codigoDoErro(status: number, codigoDoAsaas?: string | null): CodigoDoErroAsaas {
  if (codigoDoAsaas === "invalid_environment") return "ambiente_errado";
  if (status === 401) return "chave_invalida";
  if (status === 403) return "sem_permissao";
  if (status === 404) return "nao_encontrado";
  if (status === 429) return "limite";
  return "asaas_error";
}

export const MARCA_DE_CHAVE = "«chave»";

/** Tira a chave de um texto antes de ele virar mensagem de erro (e log). */
export function semSegredo(texto: string, chave: string): string {
  return chave.length >= 8 ? texto.replaceAll(chave, MARCA_DE_CHAVE) : texto;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Puro: a primeira `{ code, description }` do corpo de erro do Asaas.
 * ⚠️ A FORMA `{ errors: [...] }` é a documentada, mas não está confirmada
 * para todo 4xx (C5 do plano) — por isso a leitura é tolerante e cai no
 * `HTTP <status>` quando não reconhece nada.
 */
export function lerErro(corpo: unknown, status: number): { codigo: string | null; descricao: string } {
  if (ehObjeto(corpo) && Array.isArray(corpo.errors) && corpo.errors.length > 0) {
    const primeiro: unknown = corpo.errors[0];
    if (ehObjeto(primeiro)) {
      const codigo = typeof primeiro.code === "string" ? primeiro.code : null;
      const descricao = typeof primeiro.description === "string" ? primeiro.description : `HTTP ${status}`;
      return { codigo, descricao };
    }
  }
  if (ehObjeto(corpo) && typeof corpo.message === "string") return { codigo: null, descricao: corpo.message };
  return { codigo: null, descricao: `HTTP ${status}` };
}

export interface PaginaDoAsaas<T> {
  data: T[];
  hasMore: boolean;
  /** `totalCount` da resposta; `null` quando o Asaas não o mandou. */
  totalCount: number | null;
}

/** O que os cabeçalhos `RateLimit-*` da última resposta disseram (C14). */
export type CabecalhosDeCota = Record<string, string>;

export interface ClienteAsaas {
  /** Uma página. `params` vai na query; GET nunca leva corpo (403). */
  listar<T>(caminho: string, params?: Record<string, string | number | undefined>): Promise<PaginaDoAsaas<T>>;
  /** Todas as páginas, com teto. ESTOURA no teto — nunca devolve meia lista. */
  listarTudo<T>(caminho: string, params?: Record<string, string | number | undefined>, teto?: number): Promise<T[]>;
  /** Um recurso por id. `null` no 404 — que também significa "de outra conta". */
  obter<T>(caminho: string): Promise<T | null>;
  /** Os cabeçalhos de cota da última resposta (vazio antes do primeiro pedido). */
  cota(): CabecalhosDeCota;
}

type Fetch = typeof fetch;

export function criarClienteAsaas(
  chave: string,
  opcoes: { ambiente?: AmbienteDoAsaas; fetchFn?: Fetch } = {},
): ClienteAsaas {
  const ambiente = opcoes.ambiente ?? "producao";
  const fetchFn = opcoes.fetchFn ?? fetch;
  const base = baseDoAmbiente(ambiente);
  let cota: CabecalhosDeCota = {};

  function url(caminho: string, params?: Record<string, string | number | undefined>): string {
    const u = new URL(`${base}${caminho.startsWith("/") ? caminho : `/${caminho}`}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /** Um pedido. `aceitar` devolve a resposta em vez de lançar naqueles status. */
  async function pedir(alvo: string, aceitar: number[] = []): Promise<{ status: number; corpo: unknown }> {
    if (!doAsaas(alvo, ambiente)) throw new AsaasError("asaas_error", "URL fora do host do Asaas");
    let resposta: Response;
    try {
      resposta = await fetchFn(alvo, {
        // ⚠️ Sem `body`: GET com corpo no Asaas é 403.
        headers: {
          access_token: chave,
          Accept: "application/json",
          "User-Agent": agente(NOME_DO_APP),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new AsaasError("rede", semSegredo(e instanceof Error ? e.message : String(e), chave));
    }

    const vistos: CabecalhosDeCota = {};
    resposta.headers.forEach((valor, nome) => {
      if (nome.toLowerCase().startsWith("ratelimit")) vistos[nome.toLowerCase()] = valor;
    });
    if (Object.keys(vistos).length > 0) cota = vistos;

    const corpo: unknown = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      if (aceitar.includes(resposta.status)) return { status: resposta.status, corpo };
      const { codigo, descricao } = lerErro(corpo, resposta.status);
      throw new AsaasError(
        codigoDoErro(resposta.status, codigo),
        semSegredo(`${resposta.status}: ${descricao}`, chave),
        codigo,
        resposta.status,
      );
    }
    return { status: resposta.status, corpo };
  }

  async function listar<T>(caminho: string, params?: Record<string, string | number | undefined>): Promise<PaginaDoAsaas<T>> {
    const { corpo } = await pedir(url(caminho, params));
    if (!ehObjeto(corpo) || !Array.isArray(corpo.data)) {
      throw new AsaasError("asaas_error", `resposta de ${caminho} sem \`data[]\``);
    }
    return {
      data: corpo.data as T[],
      hasMore: corpo.hasMore === true,
      totalCount: typeof corpo.totalCount === "number" ? corpo.totalCount : null,
    };
  }

  return {
    listar,

    async listarTudo<T>(
      caminho: string,
      params?: Record<string, string | number | undefined>,
      teto = PAGINAS_MAX,
    ): Promise<T[]> {
      const limit = Math.min(POR_PAGINA_MAX, Math.max(1, Number(params?.limit ?? POR_PAGINA_MAX)));
      const tudo: T[] = [];
      for (let pagina = 0; pagina < teto; pagina++) {
        const p = await listar<T>(caminho, { ...params, limit, offset: pagina * limit });
        tudo.push(...p.data);
        if (!p.hasMore || p.data.length === 0) return tudo;
      }
      // ⚠️ Estourar, nunca devolver meia lista: a contagem parcial vira
      // número errado com cara de número certo (lição do Meta Ads).
      throw new AsaasError("asaas_error", `${caminho}: mais de ${teto} páginas — listagem incompleta`);
    },

    async obter<T>(caminho: string): Promise<T | null> {
      const { status, corpo } = await pedir(url(caminho), [404]);
      if (status === 404) return null;
      return (corpo ?? null) as T | null;
    },

    cota: () => cota,
  };
}

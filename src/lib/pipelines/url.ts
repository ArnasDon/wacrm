// ============================================================
// A jornada funil → construtor de automações → funil.
//
// A grade "Automações" do funil (`automations-board.tsx`) abre o construtor
// com a ORIGEM na URL, e o voltar do construtor a lê para devolver o operador
// à mesma aba do mesmo funil. Sem isso o voltar levava sempre à tela de
// Automações do menu: a aba escolhida no funil é estado da página e se perde
// quando ela desmonta (reportado pelo operador em 18/09/2026).
//
// ⚠️ A origem viaja na URL, e não no sessionStorage do `retorno.ts`: montar
// uma automação passa fácil dos 10 minutos de validade daquele registro, e,
// vencido, ele devolveria o operador à grade de OUTRO funil (o primeiro da
// lista), com as colunas erradas e cara de "a minha automação sumiu".
//
// ⚠️ O `router.replace` que o construtor faz depois de CRIAR tem de repetir a
// origem. É o caminho mais comum — criar pela coluna, salvar o rascunho e só
// então voltar —, e sem ela o voltar da tela de edição caía na tela de
// Automações de novo.
//
// ⚠️ `?vista=` e `?funil=` da página do funil são porta de ENTRADA, lidas uma
// vez na montagem, como o `?etapa=` do inbox: trocar de aba ou de funil
// depois não reescreve a URL.
// ============================================================

import { VISTAS_DO_FUNIL, type VistaDoFunil } from "./vistas";

/** `URLSearchParams` e o `useSearchParams()` do Next servem. */
interface ParametrosDaUrl {
  get(nome: string): string | null;
}

/**
 * O construtor foi aberto pela grade do funil. `funil` nulo = a URL diz que
 * veio do funil mas não diz de qual (link colado pela metade): a volta cai na
 * aba de automações do funil que a página escolher.
 */
export interface OrigemNoFunil {
  funil: string | null;
}

/** O que a página do funil aceita da URL ao montar. Valor estranho vira `null`. */
export function lerUrlDoFunil(params: ParametrosDaUrl): {
  funil: string | null;
  vista: VistaDoFunil | null;
} {
  const vista = VISTAS_DO_FUNIL.find((v) => v === params.get("vista")) ?? null;
  return { funil: params.get("funil") || null, vista };
}

/**
 * A URL do construtor: edição com `id`, criação sem ele. ⚠️ `id` VENCE
 * `etapa` — a tela de edição não lê `stage`, e emiti-lo faria a URL prometer
 * o que ninguém cumpre.
 */
export function urlDoConstrutor(destino: {
  id?: string | null;
  etapa?: string | null;
  origem?: OrigemNoFunil | null;
}): string {
  const base = destino.id
    ? `/automations/${encodeURIComponent(destino.id)}/edit`
    : "/automations/new";
  const partes: string[] = [];
  if (!destino.id && destino.etapa) {
    partes.push(`stage=${encodeURIComponent(destino.etapa)}`);
  }
  if (destino.origem) {
    partes.push("de=funil");
    if (destino.origem.funil) {
      partes.push(`funil=${encodeURIComponent(destino.origem.funil)}`);
    }
  }
  return partes.length > 0 ? `${base}?${partes.join("&")}` : base;
}

/** `null` = o construtor não veio do funil. Só `de=funil` conta como origem. */
export function origemDoConstrutor(params: ParametrosDaUrl): OrigemNoFunil | null {
  if (params.get("de") !== "funil") return null;
  return { funil: params.get("funil") || null };
}

/** Para onde o voltar do construtor leva. */
export function voltaDoConstrutor(origem: OrigemNoFunil | null): string {
  if (!origem) return "/automations";
  return origem.funil
    ? `/pipelines?vista=automacoes&funil=${encodeURIComponent(origem.funil)}`
    : "/pipelines?vista=automacoes";
}

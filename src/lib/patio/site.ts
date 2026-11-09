// Regras puras das telas do Site (conteúdo, página de links, iBox Club).

/** Caminhos de campo de "pagina" para gravar, sem os contadores que o site soma sozinho. */
export function caminhosDaPagina(pagina: Record<string, unknown>): string[] {
  const caminhos: string[] = [];
  for (const [k, v] of Object.entries(pagina)) {
    if (k === "grupo" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const g of Object.keys(v as Record<string, unknown>)) {
        if (g === "vagasOcupadas" || g === "listaEspera") continue;
        caminhos.push(`pagina.grupo.${g}`);
      }
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      caminhos.push(`pagina.${k}`);
    }
  }
  return caminhos;
}

/** Cliques da página de links por alvo, do mais clicado para o menos. */
export function contarCliques(eventos: { tipo?: unknown; alvo?: unknown }[]): { alvo: string; cliques: number }[] {
  const m = new Map<string, number>();
  for (const e of eventos) {
    if (e.tipo === "visita") continue;
    const alvo = String(e.alvo ?? "").trim() || "(sem nome)";
    m.set(alvo, (m.get(alvo) ?? 0) + 1);
  }
  return [...m.entries()].map(([alvo, cliques]) => ({ alvo, cliques })).sort((a, b) => b.cliques - a.cliques);
}

/** CSV simples (separador ;) para abrir no Excel em português. */
export function paraCsv(linhas: Record<string, unknown>[], colunas: [string, string][]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [colunas.map(([, n]) => esc(n)).join(";"), ...linhas.map((l) => colunas.map(([k]) => esc(l[k])).join(";"))].join("\n");
}

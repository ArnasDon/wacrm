// Regras e alertas montados pela loja (nada vem pronto). Cada regra olha um
// tipo de coisa (carro, campanha ou conversa), testa condições e, quando
// todas batem, gera um alerta. Funções puras: testadas em regras.test.ts.

export type Gatilho = "carro" | "campanha" | "conversa";
export type Operador = ">" | ">=" | "<" | "<=" | "=";
export type Condicao = { campo: string; op: Operador; valor: number };
export type Acao = { tipo: "alerta_hoje" } | { tipo: "whatsapp_grupo"; grupo: string };
export type Regra = { id: string; nome: string; ativo: boolean; gatilho: Gatilho; condicoes: Condicao[]; acoes: Acao[] };

export const CAMPOS: Record<Gatilho, { id: string; nome: string; unidade: string }[]> = {
  carro: [
    { id: "dias_no_patio", nome: "Dias no pátio", unidade: "dias" },
    { id: "conversas_30d", nome: "Conversas nos últimos 30 dias", unidade: "conversas" },
    { id: "gasto_30d", nome: "Gasto em anúncio nos últimos 30 dias", unidade: "R$" },
    { id: "preco", nome: "Preço", unidade: "R$" },
    { id: "tem_anuncio", nome: "Tem anúncio ligado (1 = sim, 0 = não)", unidade: "" },
  ],
  campanha: [
    { id: "custo_por_conversa", nome: "Custo por conversa", unidade: "R$" },
    { id: "gasto", nome: "Gasto no período", unidade: "R$" },
    { id: "conversas", nome: "Conversas no período", unidade: "conversas" },
    { id: "carro_vendido", nome: "Carro já vendido (1 = sim, 0 = não)", unidade: "" },
    { id: "sem_carro", nome: "Sem carro ligado (1 = sim, 0 = não)", unidade: "" },
  ],
  conversa: [{ id: "minutos_sem_resposta", nome: "Minutos esperando resposta", unidade: "min" }],
};

export const GATILHOS: Record<Gatilho, string> = { carro: "Um carro do pátio", campanha: "Uma campanha", conversa: "Uma conversa" };
export const OPERADORES: Record<Operador, string> = { ">": "maior que", ">=": "pelo menos", "<": "menor que", "<=": "no máximo", "=": "igual a" };

export function testa(v: number, c: Condicao): boolean {
  switch (c.op) {
    case ">": return v > c.valor;
    case ">=": return v >= c.valor;
    case "<": return v < c.valor;
    case "<=": return v <= c.valor;
    case "=": return v === c.valor;
  }
}

export type Item = { id: string; nome: string; href: string; valores: Record<string, number> };
export type Alerta = { regraId: string; regra: string; itens: { id: string; nome: string; href: string }[]; acoes: Acao[] };

/** Avalia as regras ativas contra os itens de cada tipo. */
export function avaliar(regras: Regra[], itens: Record<Gatilho, Item[]>): Alerta[] {
  const saida: Alerta[] = [];
  for (const r of regras) {
    if (!r.ativo || !r.condicoes.length) continue;
    const bateu = (itens[r.gatilho] ?? []).filter((it) =>
      r.condicoes.every((c) => typeof it.valores[c.campo] === "number" && Number.isFinite(it.valores[c.campo]) && testa(it.valores[c.campo], c)),
    );
    if (bateu.length) saida.push({ regraId: r.id, regra: r.nome, itens: bateu.map(({ id, nome, href }) => ({ id, nome, href })), acoes: r.acoes });
  }
  return saida;
}

/** Frase da regra para mostrar na lista. */
export function frase(r: Pick<Regra, "gatilho" | "condicoes" | "acoes">): string {
  const nomes = Object.fromEntries(CAMPOS[r.gatilho].map((c) => [c.id, c.nome.toLowerCase()]));
  const conds = r.condicoes.map((c) => `${nomes[c.campo] ?? c.campo} ${OPERADORES[c.op]} ${c.valor}`).join(" e ");
  const acoes = r.acoes.map((a) => (a.tipo === "alerta_hoje" ? "avisar em Hoje" : `mandar no grupo ${a.grupo}`)).join(" e ");
  return `Quando ${GATILHOS[r.gatilho].toLowerCase()} tiver ${conds}: ${acoes || "nenhuma ação"}.`;
}

/** Confere e limpa uma regra vinda da tela. */
export function validar(r: Partial<Regra>): { ok: true; regra: Omit<Regra, "id"> } | { ok: false; erro: string } {
  if (!r.nome?.trim()) return { ok: false, erro: "Dê um nome à regra." };
  if (!r.gatilho || !(r.gatilho in CAMPOS)) return { ok: false, erro: "Escolha o que a regra olha." };
  const validos = new Set(CAMPOS[r.gatilho].map((c) => c.id));
  const condicoes = (r.condicoes ?? []).filter((c) => validos.has(c.campo) && c.op in OPERADORES && Number.isFinite(Number(c.valor))).map((c) => ({ ...c, valor: Number(c.valor) }));
  if (!condicoes.length) return { ok: false, erro: "Coloque pelo menos uma condição com número." };
  const acoes = (r.acoes ?? []).filter((a) => a.tipo === "alerta_hoje" || (a.tipo === "whatsapp_grupo" && !!a.grupo?.trim()));
  if (!acoes.length) return { ok: false, erro: "Escolha pelo menos uma ação." };
  return { ok: true, regra: { nome: r.nome.trim().slice(0, 80), ativo: r.ativo !== false, gatilho: r.gatilho, condicoes, acoes } };
}

// De onde veio cada venda (gravado na venda do carro: sale.origem e, quando
// faz sentido, sale.origem_detalhe — o vendedor, quem indicou, a campanha).
// As origens personalizadas que a loja criar passam a aparecer na lista.

export const ORIGENS_VENDA = [
  "Anúncio (Meta)",
  "Instagram (orgânico)",
  "Indicação",
  "Conexão de vendedor",
  "Site",
  "Loja (passou na frente)",
  "OLX / Webmotors",
  "Cliente antigo",
] as const;

/** Que detalhe pedir para cada origem. */
export function detalheDaOrigem(origem: string): string | null {
  if (origem === "Conexão de vendedor") return "Qual vendedor";
  if (origem === "Indicação") return "Quem indicou";
  if (origem === "Anúncio (Meta)") return "Qual anúncio ou campanha (opcional)";
  return null;
}

/** Lista para escolher: as fixas + as personalizadas já usadas, sem repetir. */
export function listaDeOrigens(usadas: string[]): string[] {
  const fixas = new Set<string>(ORIGENS_VENDA);
  const extras = [...new Set(usadas.map((u) => u.trim()).filter((u) => u && !fixas.has(u)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [...ORIGENS_VENDA, ...extras];
}

export type VendaPorOrigem = { origem: string; vendas: number; receita: number };

/** Vendas do período agrupadas pela origem ("Não informada" quando vazia). */
export function vendasPorOrigem(vendas: { origem?: unknown; valor: number }[]): VendaPorOrigem[] {
  const m = new Map<string, VendaPorOrigem>();
  for (const v of vendas) {
    const o = typeof v.origem === "string" && v.origem.trim() ? v.origem.trim() : "Não informada";
    const x = m.get(o) ?? { origem: o, vendas: 0, receita: 0 };
    x.vendas++; x.receita += v.valor || 0;
    m.set(o, x);
  }
  return [...m.values()].sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);
}

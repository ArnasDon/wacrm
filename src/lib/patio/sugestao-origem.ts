// Sugestão de origem para as vendas que ficaram sem origem (vendas antigas,
// de antes do campo existir). Só sugere — quem confirma é o sócio.
//   1. clientes deste carro no CRM que têm origem → a origem mais comum entre eles;
//   2. senão, se o carro teve gasto em anúncio → "Anúncio (Meta)" com a campanha que mais gastou;
//   3. senão, sem sugestão.

export type Sugestao = { origem: string; detalhe: string; motivo: string };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function sugerirOrigem(p: {
  origensClientes: (string | null | undefined)[];
  gastoAnuncios: number;
  campanhaQueMaisGastou?: string | null;
}): Sugestao | null {
  const conta = new Map<string, number>();
  for (const o of p.origensClientes) {
    const t = typeof o === "string" ? o.trim() : "";
    if (t) conta.set(t, (conta.get(t) ?? 0) + 1);
  }
  if (conta.size) {
    const [origem, n] = [...conta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const total = [...conta.values()].reduce((s, v) => s + v, 0);
    return {
      origem,
      detalhe: origem === "Anúncio (Meta)" && p.campanhaQueMaisGastou ? p.campanhaQueMaisGastou : "",
      motivo: `${n} de ${total} cliente(s) deste carro no CRM vieram de “${origem}”`,
    };
  }
  if (p.gastoAnuncios > 0) {
    return {
      origem: "Anúncio (Meta)",
      detalhe: p.campanhaQueMaisGastou ?? "",
      motivo: `o carro teve ${brl(p.gastoAnuncios)} em anúncios`,
    };
  }
  return null;
}

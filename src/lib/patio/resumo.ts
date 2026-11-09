// Contas da tela Hoje e do Relatório a partir dos carros do Pátio e das
// métricas das campanhas. Funções puras: testadas em resumo.test.ts.

import type { Carro } from "./veiculo";

export type CarroResumo = Carro & { dias: number | null; anuncios: { gasto: number; msgs: number; campanhas: unknown[] } | null };

const preco = (c: Carro) => Number(c.finance?.sale_price) || 0;

/** Data da venda: a da aba Venda, senão a do Financeiro. */
export function dataVenda(c: Carro): number | null {
  const d = (c.sale?.date as string) || (c.finance?.sale_date as string) || "";
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

export function valorVenda(c: Carro): number {
  return Number(c.sale?.final_price) || Number(c.finance?.sale_price) || 0;
}

export function custoTotal(c: Carro): number {
  const custos = Array.isArray(c.finance?.costs) ? (c.finance!.costs as { value?: number }[]) : [];
  return (Number(c.finance?.purchase_price) || 0) + custos.reduce((s, x) => s + (Number(x.value) || 0), 0);
}

export function resumoPatio(carros: CarroResumo[], desde: number, ate: number, limiteParado = 45) {
  const aVenda = carros.filter((c) => ["available", "reserved", "unavailable"].includes(c.status ?? "available"));
  const vendidos = carros.filter((c) => c.status === "sold");
  const vendidosPeriodo = vendidos.filter((c) => {
    const t = dataVenda(c);
    return t != null && t >= desde && t <= ate;
  });
  const comCusto = vendidosPeriodo.filter((c) => custoTotal(c) > 0);
  return {
    aVenda: aVenda.length,
    valorEstoque: aVenda.reduce((s, c) => s + preco(c), 0),
    capitalParado: aVenda.reduce((s, c) => s + custoTotal(c), 0),
    parados: aVenda.filter((c) => (c.dias ?? 0) > limiteParado).length,
    semAnuncio: aVenda.filter((c) => !c.anuncios?.campanhas.length).length,
    rascunhos: carros.filter((c) => c.status === "review").length,
    vendidosTotal: vendidos.length,
    vendidosPeriodo: vendidosPeriodo.length,
    vendidosSemData: vendidos.filter((c) => dataVenda(c) == null).length,
    receitaPeriodo: vendidosPeriodo.reduce((s, c) => s + valorVenda(c), 0),
    lucroPeriodo: comCusto.reduce((s, c) => s + valorVenda(c) - custoTotal(c), 0),
    vendidosAte30Dias: vendidosPeriodo.filter((c) => c.dias != null && c.dias <= 30).length,
    maisConversa: [...aVenda]
      .filter((c) => (c.anuncios?.msgs ?? 0) > 0)
      .sort((a, b) => (b.anuncios?.msgs ?? 0) - (a.anuncios?.msgs ?? 0))
      .slice(0, 5)
      .map((c) => ({ id: c.id, nome: [c.brand, c.model, c.versao].filter(Boolean).join(" "), ano: String(c.year ?? ""), preco: preco(c), img: c.img ?? "", msgs: c.anuncios?.msgs ?? 0, gasto: c.anuncios?.gasto ?? 0 })),
    maisParados: [...aVenda]
      .filter((c) => c.dias != null)
      .sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0))
      .slice(0, 5)
      .map((c) => ({ id: c.id, nome: [c.brand, c.model, c.versao].filter(Boolean).join(" "), ano: String(c.year ?? ""), preco: preco(c), img: c.img ?? "", dias: c.dias ?? 0 })),
  };
}

export type CampanhaPeriodo = { id: string; nome: string; status: string | null; gasto: number; msgs: number; carro: "ok" | "vendido" | "sem" };

/** Imposto do Meta sobre o gasto (o painel antigo já somava 12%). */
export const IMPOSTO_META = 0.12;

export function resumoTrafego(campanhas: CampanhaPeriodo[]) {
  const ativas = campanhas.filter((c) => c.gasto > 0 || c.msgs > 0);
  const gasto = ativas.reduce((s, c) => s + c.gasto, 0);
  const msgs = ativas.reduce((s, c) => s + c.msgs, 0);
  const foraDoPatio = ativas.filter((c) => c.carro === "vendido");
  const semCarro = ativas.filter((c) => c.carro === "sem");
  return {
    gasto,
    investido: gasto * (1 + IMPOSTO_META),
    msgs,
    custoPorConversa: msgs ? (gasto * (1 + IMPOSTO_META)) / msgs : 0,
    campanhas: [...ativas].sort((a, b) => b.gasto - a.gasto),
    gastoForaDoPatio: foraDoPatio.reduce((s, c) => s + c.gasto, 0) * (1 + IMPOSTO_META),
    qtdForaDoPatio: foraDoPatio.length,
    gastoSemCarro: semCarro.reduce((s, c) => s + c.gasto, 0) * (1 + IMPOSTO_META),
    qtdSemCarro: semCarro.length,
  };
}

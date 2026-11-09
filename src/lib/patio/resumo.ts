// Contas da tela Hoje e do Relatório a partir dos carros do Pátio e das
// métricas das campanhas. Funções puras: testadas em resumo.test.ts.

import type { Carro } from "./veiculo";
import { vendasPorOrigem } from "./origem-venda";

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

const extras = (c: Carro) =>
  (Array.isArray(c.finance?.costs) ? (c.finance!.costs as { value?: number }[]) : []).reduce((s, x) => s + (Number(x.value) || 0), 0);
const consignado = (c: Carro) => c.ownership_type === "consignado";

/** Custo do carro, como no admin do site: próprio = compra + custos; consignado = valor combinado com o dono + custos. */
export function custoTotal(c: Carro): number {
  return (Number(consignado(c) ? c.finance?.repasse_value : c.finance?.purchase_price) || 0) + extras(c);
}

/** Dinheiro da loja parado no carro: no consignado, só os custos (o carro não foi pago). */
export function investido(c: Carro): number {
  return (consignado(c) ? 0 : Number(c.finance?.purchase_price) || 0) + extras(c);
}

/** Tem custo lançado? Sem isso o lucro sairia igual ao preço. */
export function temCusto(c: Carro): boolean {
  return consignado(c) ? Number(c.finance?.repasse_value) > 0 || extras(c) > 0 : Number(c.finance?.purchase_price) > 0;
}

const FAIXAS: [string, number][] = [["Até R$ 50 mil", 50_000], ["R$ 50–80 mil", 80_000], ["R$ 80–120 mil", 120_000], ["R$ 120–200 mil", 200_000], ["Acima de R$ 200 mil", Infinity]];

/** Como está o pátio: posse × situação, categorias e faixas de preço (o que o painel do admin mostrava). */
export function composicao(carros: Carro[]) {
  const posse: Record<string, Record<string, number>> = {};
  const categorias: Record<string, number> = {};
  const faixas = FAIXAS.map(([nome]) => ({ nome, carros: 0, valor: 0 }));
  let semPreco = 0;
  for (const c of carros) {
    const p = c.ownership_type || "proprio";
    const st = c.status || "available";
    (posse[p] ??= {})[st] = (posse[p][st] ?? 0) + 1;
    const cat = c.cat || "carros";
    categorias[cat] = (categorias[cat] ?? 0) + 1;
    const v = preco(c);
    if (!v) { semPreco++; continue; }
    const i = FAIXAS.findIndex(([, max]) => v <= max);
    faixas[i].carros++; faixas[i].valor += v;
  }
  return { posse, categorias, faixas, semPreco };
}

export function resumoPatio(carros: CarroResumo[], desde: number, ate: number, limiteParado = 45) {
  const aVenda = carros.filter((c) => ["available", "reserved", "unavailable"].includes(c.status ?? "available"));
  const vendidos = carros.filter((c) => c.status === "sold");
  const vendidosPeriodo = vendidos.filter((c) => {
    const t = dataVenda(c);
    return t != null && t >= desde && t <= ate;
  });
  const comCusto = vendidosPeriodo.filter(temCusto);
  return {
    aVenda: aVenda.length,
    valorEstoque: aVenda.reduce((s, c) => s + preco(c), 0),
    capitalParado: aVenda.reduce((s, c) => s + investido(c), 0),
    parados: aVenda.filter((c) => (c.dias ?? 0) > limiteParado).length,
    semAnuncio: aVenda.filter((c) => !c.anuncios?.campanhas.length).length,
    rascunhos: carros.filter((c) => c.status === "review").length,
    vendidosTotal: vendidos.length,
    vendidosPeriodo: vendidosPeriodo.length,
    vendidosSemData: vendidos.filter((c) => dataVenda(c) == null).length,
    receitaPeriodo: vendidosPeriodo.reduce((s, c) => s + valorVenda(c), 0),
    lucroPeriodo: comCusto.reduce((s, c) => s + valorVenda(c) - custoTotal(c), 0),
    vendidosAte30Dias: vendidosPeriodo.filter((c) => c.dias != null && c.dias <= 30).length,
    composicao: composicao(aVenda),
    porOrigem: vendasPorOrigem(vendidosPeriodo.map((c) => ({ origem: c.sale?.origem, valor: valorVenda(c) }))),
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

export type CampanhaPeriodo = { id: string; nome: string; status: string | null; gasto: number; msgs: number; carro: "ok" | "vendido" | "sem" | "outra" };

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

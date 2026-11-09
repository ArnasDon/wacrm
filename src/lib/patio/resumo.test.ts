import { describe, it, expect } from "vitest";
import { resumoPatio, resumoTrafego, dataVenda, custoTotal, investido, temCusto, composicao, type CarroResumo } from "./resumo";

const c = (o: Partial<CarroResumo>): CarroResumo => ({ id: o.id ?? "x", dias: null, anuncios: null, ...o }) as CarroResumo;
const D = (s: string) => Date.parse(s);

describe("resumoPatio", () => {
  const carros = [
    c({ id: "a", status: "available", finance: { sale_price: 100000, purchase_price: 80000, costs: [{ value: 2000 }] }, dias: 50, anuncios: { gasto: 100, msgs: 10, campanhas: [{}] } }),
    c({ id: "b", status: "reserved", finance: { sale_price: 50000 }, dias: 10 }),
    c({ id: "r", status: "review" }),
    c({ id: "v1", status: "sold", sale: { final_price: 90000, date: "2026-11-05" }, finance: { purchase_price: 70000 }, dias: 20 }),
    c({ id: "v2", status: "sold", finance: { sale_price: 40000, sale_date: "2026-09-01" } }),
    c({ id: "v3", status: "sold" }),
  ];
  const r = resumoPatio(carros, D("2026-10-10"), D("2026-11-09"));
  it("conta pátio, parados, sem anúncio e rascunhos", () => {
    expect(r).toMatchObject({ aVenda: 2, valorEstoque: 150000, capitalParado: 82000, parados: 1, semAnuncio: 1, rascunhos: 1 });
  });
  it("vendas no período usam a data da venda", () => {
    expect(r).toMatchObject({ vendidosTotal: 3, vendidosPeriodo: 1, vendidosSemData: 1, receitaPeriodo: 90000, lucroPeriodo: 20000, vendidosAte30Dias: 1 });
  });
  it("lista os que mais conversam", () => {
    expect(r.maisConversa.map((x) => x.id)).toEqual(["a"]);
    expect(r.maisParados[0].id).toBe("a");
  });
  it("auxiliares", () => {
    expect(dataVenda(c({ finance: { sale_date: "2026-01-02" } }))).toBe(D("2026-01-02"));
    expect(custoTotal(c({ finance: { purchase_price: 10, costs: [{ value: 5 }, { value: "x" }] } }))).toBe(15);
  });
  it("consignado: custo = valor combinado + custos; investido = só os custos (igual ao admin)", () => {
    const cons = c({ ownership_type: "consignado", finance: { purchase_price: 0, repasse_value: 80000, costs: [{ value: 1500 }] } });
    expect(custoTotal(cons)).toBe(81500);
    expect(investido(cons)).toBe(1500);
    expect(temCusto(cons)).toBe(true);
    expect(temCusto(c({ ownership_type: "consignado", finance: {} }))).toBe(false);
    expect(temCusto(c({ finance: { purchase_price: 0, costs: [{ value: 100 }] } }))).toBe(false);
  });
});

describe("composicao", () => {
  it("posse × situação, categorias e faixas", () => {
    const r = composicao([
      c({ ownership_type: "consignado", status: "reserved", cat: "motos", finance: { sale_price: 30000 } }),
      c({ status: "available", finance: { sale_price: 90000 } }),
      c({ status: "available", finance: {} }),
    ]);
    expect(r.posse).toEqual({ consignado: { reserved: 1 }, proprio: { available: 2 } });
    expect(r.categorias).toEqual({ motos: 1, carros: 2 });
    expect(r.faixas[0]).toMatchObject({ carros: 1, valor: 30000 });
    expect(r.faixas[2]).toMatchObject({ carros: 1, valor: 90000 });
    expect(r.semPreco).toBe(1);
  });
});

describe("resumoTrafego", () => {
  it("soma com imposto e separa campanhas de carro vendido ou sem carro", () => {
    const r = resumoTrafego([
      { id: "1", nome: "Song", status: "ACTIVE", gasto: 100, msgs: 10, carro: "ok" },
      { id: "2", nome: "Hilux", status: "ACTIVE", gasto: 200, msgs: 20, carro: "vendido" },
      { id: "3", nome: "Geral", status: "ACTIVE", gasto: 50, msgs: 0, carro: "sem" },
      { id: "4", nome: "Parada", status: "PAUSED", gasto: 0, msgs: 0, carro: "sem" },
    ]);
    expect(r.gasto).toBe(350);
    expect(r.investido).toBeCloseTo(392);
    expect(r.msgs).toBe(30);
    expect(r.custoPorConversa).toBeCloseTo(13.0667, 3);
    expect(r.campanhas.map((x) => x.id)).toEqual(["2", "1", "3"]);
    expect(r.qtdForaDoPatio).toBe(1);
    expect(r.gastoForaDoPatio).toBeCloseTo(224);
    expect(r.qtdSemCarro).toBe(1);
  });
});

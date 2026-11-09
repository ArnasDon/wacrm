import { describe, it, expect } from "vitest";
import { passaFiltros, ordenar, planilha, lucro, FILTROS_VAZIOS, type CarroLista } from "./filtros";

const c = (o: Partial<CarroLista>): CarroLista => ({ id: "x", dias: 10, anuncios: null, ...o }) as CarroLista;

describe("filtros do pátio", () => {
  const lista = [
    c({ id: "a", cat: "carros", ownership_type: "proprio", status: "available", dias: 70, finance: { sale_price: 90000, purchase_price: 70000 } }),
    c({ id: "b", cat: "motos", ownership_type: "consignado", status: "reserved", dias: 20, finance: { sale_price: 30000, repasse_value: 25000 }, anuncios: { gasto: 10, msgs: 5, campanhas: [{}] } }),
    c({ id: "c", status: "available", dias: null, finance: { sale_price: 0 } }),
  ];
  const ids = (f: Partial<typeof FILTROS_VAZIOS>) => lista.filter((x) => passaFiltros(x, { ...FILTROS_VAZIOS, ...f })).map((x) => x.id);
  it("categoria, posse e situação (sem valor = carros, próprio, à venda)", () => {
    expect(ids({ categoria: "carros" })).toEqual(["a", "c"]);
    expect(ids({ posse: "consignado" })).toEqual(["b"]);
    expect(ids({ situacao: "available" })).toEqual(["a", "c"]);
  });
  it("faixa de preço ignora carro sem preço no máximo", () => {
    expect(ids({ precoMin: "50.000" })).toEqual(["a"]);
    expect(ids({ precoMax: "50000" })).toEqual(["b"]);
  });
  it("dias e anúncio", () => {
    expect(ids({ dias: "60+" })).toEqual(["a"]);
    expect(ids({ dias: "30" })).toEqual(["b"]);
    expect(ids({ anuncio: "com" })).toEqual(["b"]);
    expect(ids({ anuncio: "sem" })).toEqual(["a", "c"]);
  });
  it("lucro do consignado pelo valor combinado", () => {
    expect(lucro(lista[1])).toBe(5000);
    expect(lucro(lista[2])).toBeNull();
  });
  it("ordena e exporta", () => {
    expect(ordenar(lista, "maior_preco").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(ordenar(lista, "mais_dias").map((x) => x.id)).toEqual(["a", "b", "c"]);
    const csv = planilha([lista[0]], ["preco", "lucro"], false);
    expect(csv).toContain("Marca;Modelo;Versão;Preço");
    expect(csv).not.toContain("Lucro");
    expect(planilha([lista[0]], ["preco", "lucro"], true)).toContain(";90000;20000");
  });
});

import { describe, it, expect } from "vitest";
import { sugerirOrigem } from "./sugestao-origem";

describe("sugerirOrigem", () => {
  it("usa a origem mais comum dos clientes do carro", () => {
    const s = sugerirOrigem({ origensClientes: ["Site", "Anúncio (Meta)", "Anúncio (Meta)", null], gastoAnuncios: 10, campanhaQueMaisGastou: "[VD] Hilux" });
    expect(s).toMatchObject({ origem: "Anúncio (Meta)", detalhe: "[VD] Hilux" });
    expect(s?.motivo).toContain("2 de 3");
  });
  it("sem clientes com origem, sugere anúncio quando houve gasto", () => {
    const s = sugerirOrigem({ origensClientes: [null, ""], gastoAnuncios: 312.5, campanhaQueMaisGastou: "Strada" });
    expect(s?.origem).toBe("Anúncio (Meta)");
    expect(s?.motivo).toContain("312,50");
  });
  it("sem pista nenhuma, não sugere", () => {
    expect(sugerirOrigem({ origensClientes: [], gastoAnuncios: 0 })).toBeNull();
  });
  it("origem de cliente que não é anúncio não leva campanha no detalhe", () => {
    expect(sugerirOrigem({ origensClientes: ["Site"], gastoAnuncios: 50, campanhaQueMaisGastou: "X" })).toMatchObject({ origem: "Site", detalhe: "" });
  });
});

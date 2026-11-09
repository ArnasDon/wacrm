import { describe, it, expect } from "vitest";
import { listaDeOrigens, vendasPorOrigem, detalheDaOrigem, ORIGENS_VENDA } from "./origem-venda";

describe("origem da venda", () => {
  it("junta as fixas com as personalizadas, sem repetir", () => {
    const l = listaDeOrigens(["Feirão", "Indicação", " Feirão ", ""]);
    expect(l.slice(0, ORIGENS_VENDA.length)).toEqual([...ORIGENS_VENDA]);
    expect(l.filter((x) => x === "Feirão")).toHaveLength(1);
    expect(l).not.toContain("");
  });
  it("agrupa vendas", () => {
    expect(vendasPorOrigem([{ origem: "Indicação", valor: 10 }, { origem: "", valor: 5 }, { origem: "Indicação", valor: 20 }])).toEqual([
      { origem: "Indicação", vendas: 2, receita: 30 },
      { origem: "Não informada", vendas: 1, receita: 5 },
    ]);
  });
  it("detalhe só onde faz sentido", () => {
    expect(detalheDaOrigem("Conexão de vendedor")).toBe("Qual vendedor");
    expect(detalheDaOrigem("Site")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { caminhosDaPagina, contarCliques, paraCsv } from "./site";

describe("site", () => {
  it("não grava os contadores do Club", () => {
    expect(caminhosDaPagina({ faixa: [], grupo: { aberto: true, vagasTotal: 50, vagasOcupadas: 9, listaEspera: 3 }, consultor: {} }))
      .toEqual(["pagina.faixa", "pagina.grupo.aberto", "pagina.grupo.vagasTotal", "pagina.consultor"]);
  });
  it("conta cliques sem contar visitas", () => {
    expect(contarCliques([{ tipo: "clique", alvo: "consultor" }, { tipo: "clique", alvo: "consultor" }, { tipo: "visita" }, { tipo: "clique", alvo: "estoque" }]))
      .toEqual([{ alvo: "consultor", cliques: 2 }, { alvo: "estoque", cliques: 1 }]);
  });
  it("CSV com ponto e vírgula e aspas", () => {
    expect(paraCsv([{ a: "x;y", b: 'diz "oi"' }], [["a", "A"], ["b", "B"]])).toBe('A;B\n"x;y";"diz ""oi"""');
  });
});

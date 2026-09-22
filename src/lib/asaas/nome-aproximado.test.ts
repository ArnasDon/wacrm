import { describe, expect, it } from "vitest";

import { compararNomes, ehNomeNumerico, nomesIncompativeis, sugerirPorNome, tokensDoNome } from "./nome-aproximado";

describe("tokensDoNome", () => {
  it("normaliza acento, caixa, pontuação e tira as partículas", () => {
    expect(tokensDoNome("  José DA Silva-Júnior ")).toEqual(["jose", "silva", "junior"]);
    expect(tokensDoNome("Maria de Fátima dos Santos e Souza")).toEqual(["maria", "fatima", "santos", "souza"]);
  });

  it("NFD antes de apagar o sinal: a forma decomposta dá o mesmo token", () => {
    expect(tokensDoNome("José")).toEqual(tokensDoNome("José"));
  });

  it("inicial abreviada e nome vazio não viram token", () => {
    expect(tokensDoNome("J. Silva")).toEqual(["silva"]);
    expect(tokensDoNome(null)).toEqual([]);
  });
});

describe("ehNomeNumerico", () => {
  it("o número como nome (203 fichas na conta) é numérico; nome com letra não é", () => {
    expect(ehNomeNumerico("5583980000016")).toBe(true);
    expect(ehNomeNumerico("+55 (83) 98000-0016")).toBe(true);
    expect(ehNomeNumerico("Leo 83")).toBe(false);
    expect(ehNomeNumerico("")).toBe(false);
  });
});

describe("compararNomes", () => {
  it("primeiro token igual e dois em comum: candidato", () => {
    const s = compararNomes("Maria Aparecida Silva", "Maria A. Silva");
    expect(s.candidato).toBe(true);
    expect(s.emComum).toBe(2);
    expect(s.pontuacao).toBe(1); // "maria silva" inteiro dentro do maior
  });

  it("o nome mais curto contido no mais longo, mesmo sem o primeiro token igual", () => {
    expect(compararNomes("Ana Maria Silva", "Maria Silva").candidato).toBe(true);
  });

  it("um token em comum só, sem o primeiro igual, NÃO é candidato", () => {
    expect(compararNomes("João Pedro Souza", "Maria Souza").candidato).toBe(false);
  });

  it("primeiro token igual com um só em comum não basta ('Maria' é meio escritório)", () => {
    expect(compararNomes("Maria Aparecida Silva", "Maria Santos").candidato).toBe(false);
  });

  it("nome de um token nunca casa, de nenhum dos lados", () => {
    expect(compararNomes("Rod", "Rodrigo Tavares Monteiro").candidato).toBe(false);
    expect(compararNomes("Rodrigo Tavares", "Rodrigo").candidato).toBe(false);
  });

  it("a pontuação é tokens em comum sobre o menor", () => {
    expect(compararNomes("Maria Aparecida Silva Santos", "Maria Silva Souza").pontuacao).toBe(0.67);
  });
});

describe("sugerirPorNome", () => {
  const fichas = [
    { id: "num", nome: "5583980000016" },
    { id: "ms", nome: "Maria Silva" },
    { id: "mas", nome: "Maria Aparecida Silva" },
    { id: "js", nome: "João Silva" },
    { id: "um", nome: "Maria" },
  ];

  it("devolve as fichas parecidas, melhores primeiro, sem as numéricas nem as de um token", () => {
    const s = sugerirPorNome("Maria Aparecida Silva", fichas);
    expect(s.map((x) => x.contactId)).toEqual(["mas", "ms"]);
    expect(s[0].pontuacao).toBe(1);
  });

  it("nome do Asaas de um token não sugere nada", () => {
    expect(sugerirPorNome("Maria", fichas)).toEqual([]);
  });

  it("respeita o teto", () => {
    const muitas = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, nome: `Maria Aparecida Silva ${i}` }));
    expect(sugerirPorNome("Maria Aparecida Silva", muitas)).toHaveLength(3);
  });
});

describe("nomesIncompativeis (a cerca da esposa que paga a conta)", () => {
  it("ficha com nome de gente sem NENHUM token em comum é incompatível", () => {
    expect(nomesIncompativeis("João Pedro Souza", "Maria Santos")).toBe(true);
  });

  it("um token em comum já basta para NÃO ser incompatível", () => {
    expect(nomesIncompativeis("João Pedro Souza", "Maria Souza")).toBe(false);
  });

  it("ficha de nome numérico ou de um token não diz nada", () => {
    expect(nomesIncompativeis("João Pedro Souza", "5583980000016")).toBe(false);
    expect(nomesIncompativeis("João Pedro Souza", "Leo")).toBe(false);
    expect(nomesIncompativeis("João Pedro Souza", null)).toBe(false);
  });

  it("nome do Asaas curto demais também não diz nada", () => {
    expect(nomesIncompativeis("João", "Maria Santos")).toBe(false);
  });
});

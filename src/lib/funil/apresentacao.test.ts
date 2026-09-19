import { describe, expect, it } from "vitest";

import {
  eixoDasTaxas,
  formatarPercentual,
  formatarPp,
  formatarVariacao,
  paraPontosPercentuais,
  rotuloCurtoDoDia,
  sinalDe,
} from "./apresentacao";

// O separador decimal do pt-BR é a vírgula; o de milhar não aparece aqui.
describe("apresentacao (pt-BR fixo)", () => {
  it("percentual com uma casa; nulo vira travessão", () => {
    expect(formatarPercentual(0.6)).toBe("60,0%");
    expect(formatarPercentual(2 / 3)).toBe("66,7%");
    expect(formatarPercentual(0)).toBe("0,0%");
    expect(formatarPercentual(null)).toBe("—");
  });

  it("variação de contagem com sinal e sem casas", () => {
    expect(formatarVariacao(7)).toBe("+700%");
    expect(formatarVariacao(-0.5)).toBe("-50%");
    expect(formatarVariacao(0)).toBe("0%");
    expect(formatarVariacao(null)).toBeNull();
  });

  it("pontos percentuais com sinal e uma casa", () => {
    expect(formatarPp(20)).toBe("+20,0 pp");
    expect(formatarPp(-33.333)).toBe("-33,3 pp");
    expect(formatarPp(null)).toBeNull();
  });

  it("sinal e rótulos auxiliares", () => {
    expect([sinalDe(3), sinalDe(-1), sinalDe(0), sinalDe(null)]).toEqual([1, -1, 0, 0]);
    expect(rotuloCurtoDoDia("2026-09-01")).toBe("01/09");
    expect(rotuloCurtoDoDia("lixo")).toBe("lixo");
    expect(paraPontosPercentuais(2 / 3)).toBe(66.7);
    expect(paraPontosPercentuais(null)).toBeNull();
  });
});

describe("eixoDasTaxas — o teto sobe quando a taxa passa de 100%", () => {
  it("até 100% é o eixo de sempre, inclusive vazio e só nulos", () => {
    expect(eixoDasTaxas([])).toEqual({ teto: 100, ticks: [0, 25, 50, 75, 100] });
    expect(eixoDasTaxas([null, 30, 99.9])).toEqual({ teto: 100, ticks: [0, 25, 50, 75, 100] });
    expect(eixoDasTaxas([100])).toEqual({ teto: 100, ticks: [0, 25, 50, 75, 100] });
  });

  it("acima de 100% o teto cobre o maior valor, em passos redondos e com no máximo seis marcas", () => {
    expect(eixoDasTaxas([120])).toEqual({ teto: 125, ticks: [0, 25, 50, 75, 100, 125] });
    expect(eixoDasTaxas([250])).toEqual({ teto: 250, ticks: [0, 50, 100, 150, 200, 250] });
    expect(eixoDasTaxas([260])).toEqual({ teto: 300, ticks: [0, 100, 200, 300] });
    expect(eixoDasTaxas([1200, null])).toEqual({ teto: 1250, ticks: [0, 250, 500, 750, 1000, 1250] });
    for (const maior of [130, 480, 5000, 33333]) {
      const { teto, ticks } = eixoDasTaxas([maior]);
      expect(teto).toBeGreaterThanOrEqual(maior);
      expect(ticks.length).toBeLessThanOrEqual(7);
      expect(ticks[ticks.length - 1]).toBe(teto);
    }
  });
});

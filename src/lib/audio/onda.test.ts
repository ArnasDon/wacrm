import { describe, expect, it } from "vitest";

import {
  ALTURA_MINIMA,
  BARRAS_DA_ONDA,
  VELOCIDADES,
  formatarTempo,
  fracaoNoPonto,
  lerVelocidade,
  picosDaOnda,
  proximaVelocidade,
} from "./onda";

describe("proximaVelocidade", () => {
  it("percorre 1× → 1,5× → 2× → 1×", () => {
    expect(proximaVelocidade(1)).toBe(1.5);
    expect(proximaVelocidade(1.5)).toBe(2);
    expect(proximaVelocidade(2)).toBe(1);
  });

  it("valor fora da lista volta ao começo, sem travar o botão", () => {
    expect(proximaVelocidade(1.25)).toBe(1);
    expect(proximaVelocidade(Number.NaN)).toBe(1);
  });

  it("dá a volta inteira em tantos cliques quantas são as velocidades", () => {
    let v: number = VELOCIDADES[0];
    for (let i = 0; i < VELOCIDADES.length; i++) v = proximaVelocidade(v);
    expect(v).toBe(VELOCIDADES[0]);
  });
});

describe("lerVelocidade", () => {
  it("aceita o que o próprio player grava", () => {
    for (const v of VELOCIDADES) expect(lerVelocidade(String(v))).toBe(v);
  });

  it("qualquer outra coisa é 1×", () => {
    expect(lerVelocidade(null)).toBe(1);
    expect(lerVelocidade("")).toBe(1);
    expect(lerVelocidade("3")).toBe(1);
    expect(lerVelocidade("1,5")).toBe(1);
    expect(lerVelocidade("rápido")).toBe(1);
    expect(lerVelocidade("0")).toBe(1);
  });
});

describe("picosDaOnda", () => {
  it("devolve uma altura por barra, entre o mínimo e 1", () => {
    const amostras = Float32Array.from({ length: 8000 }, (_, i) =>
      Math.sin(i / 7) * (i / 8000),
    );
    const picos = picosDaOnda(amostras, BARRAS_DA_ONDA);
    expect(picos).toHaveLength(BARRAS_DA_ONDA);
    for (const p of picos) {
      expect(p).toBeGreaterThanOrEqual(ALTURA_MINIMA);
      expect(p).toBeLessThanOrEqual(1);
    }
    // A fatia mais alta é a referência.
    expect(Math.max(...picos)).toBe(1);
  });

  it("segue o volume: o trecho alto sai mais alto que o baixo", () => {
    // Primeira metade baixa, segunda metade alta.
    const amostras = Float32Array.from({ length: 4000 }, (_, i) =>
      (i < 2000 ? 0.1 : 0.8) * Math.sin(i / 3),
    );
    const [baixa, , , alta] = picosDaOnda(amostras, 4);
    expect(alta).toBeCloseTo(1, 2);
    expect(baixa).toBeLessThan(alta);
    expect(baixa).toBeGreaterThan(ALTURA_MINIMA);
  });

  it("aproxima a escala do ouvido: 1/4 da amplitude vira meia altura", () => {
    const amostras = [0.25, -0.25, 1, -1];
    expect(picosDaOnda(amostras, 2)).toEqual([0.5, 1]);
  });

  it("silêncio vira ponto, não buraco", () => {
    const amostras = [0, 0, 0, 0, 1, -1, 0, 0];
    expect(picosDaOnda(amostras, 4)).toEqual([
      ALTURA_MINIMA,
      ALTURA_MINIMA,
      1,
      ALTURA_MINIMA,
    ]);
  });

  it("áudio mudo não divide por zero: todas as barras no mínimo", () => {
    expect(picosDaOnda(new Float32Array(1000), 5)).toEqual(
      Array(5).fill(ALTURA_MINIMA),
    );
  });

  it("menos amostras que barras não estoura", () => {
    const picos = picosDaOnda([0.5, -0.5], 10);
    expect(picos).toHaveLength(10);
    expect(picos.filter((p) => p === 1)).toHaveLength(2);
  });

  it("nenhuma barra pedida, nenhuma barra devolvida", () => {
    expect(picosDaOnda([1, 1], 0)).toEqual([]);
  });
});

describe("formatarTempo", () => {
  it("m:ss, com os segundos truncados", () => {
    expect(formatarTempo(0)).toBe("0:00");
    expect(formatarTempo(2.52)).toBe("0:02");
    expect(formatarTempo(59.99)).toBe("0:59");
    expect(formatarTempo(60)).toBe("1:00");
    expect(formatarTempo(173)).toBe("2:53");
    expect(formatarTempo(616)).toBe("10:16");
  });

  it("passa a h:mm:ss a partir de uma hora", () => {
    expect(formatarTempo(3600)).toBe("1:00:00");
    expect(formatarTempo(3723)).toBe("1:02:03");
  });

  it("valor inválido vira 0:00 em vez de NaN:NaN", () => {
    expect(formatarTempo(Number.NaN)).toBe("0:00");
    expect(formatarTempo(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatarTempo(-3)).toBe("0:00");
  });
});

describe("fracaoNoPonto", () => {
  it("mede a posição dentro da onda", () => {
    expect(fracaoNoPonto(150, 100, 200)).toBe(0.25);
    expect(fracaoNoPonto(100, 100, 200)).toBe(0);
    expect(fracaoNoPonto(300, 100, 200)).toBe(1);
  });

  it("arrastar para fora da onda para nas pontas", () => {
    expect(fracaoNoPonto(20, 100, 200)).toBe(0);
    expect(fracaoNoPonto(900, 100, 200)).toBe(1);
  });

  it("onda sem largura (ainda não desenhada) não vira NaN", () => {
    expect(fracaoNoPonto(150, 100, 0)).toBe(0);
  });
});

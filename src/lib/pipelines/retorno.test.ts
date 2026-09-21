import { describe, expect, it } from "vitest";

import { desserializarRetorno, VALIDADE_DO_RETORNO_MS } from "./retorno";

const AGORA = 1_700_000_000_000;

function registro(extras: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pipelineId: "p1",
    scrollLeft: 320,
    scrollTop: 1024,
    em: AGORA,
    ...extras,
  });
}

describe("desserializarRetorno — registro de sessionStorage é entrada não confiável", () => {
  it("nulo / vazio / JSON inválido → null, nunca exceção", () => {
    expect(desserializarRetorno(null, AGORA)).toBeNull();
    expect(desserializarRetorno("", AGORA)).toBeNull();
    expect(desserializarRetorno("{", AGORA)).toBeNull();
    expect(desserializarRetorno("[1,2]", AGORA)).toBeNull();
    expect(desserializarRetorno('"texto"', AGORA)).toBeNull();
  });

  it("pipelineId ausente, vazio ou não-string → null (sem funil não há o que restaurar)", () => {
    expect(desserializarRetorno('{"scrollLeft":10,"em":1}', AGORA)).toBeNull();
    expect(desserializarRetorno(registro({ pipelineId: "" }), AGORA)).toBeNull();
    expect(desserializarRetorno(registro({ pipelineId: 42 }), AGORA)).toBeNull();
  });

  it("⚠️ registro VENCIDO ou sem carimbo → null — é o prazo, não a limpeza, que impede um registro velho de sequestrar a visita de amanhã", () => {
    expect(
      desserializarRetorno(
        registro({ em: AGORA - VALIDADE_DO_RETORNO_MS - 1 }),
        AGORA,
      ),
    ).toBeNull();
    expect(desserializarRetorno(registro({ em: undefined }), AGORA)).toBeNull();
    expect(desserializarRetorno(registro({ em: "ontem" }), AGORA)).toBeNull();
  });

  it("dentro do prazo passa (inclusive no limite exato)", () => {
    expect(
      desserializarRetorno(
        registro({ em: AGORA - VALIDADE_DO_RETORNO_MS }),
        AGORA,
      ),
    ).not.toBeNull();
  });

  it("rolagem inválida (string, NaN, negativa, ausente) vira 0 — restaura o funil e abre no topo", () => {
    expect(
      desserializarRetorno(registro({ scrollLeft: "x", scrollTop: null }), AGORA),
    ).toEqual({
      pipelineId: "p1",
      scrollLeft: 0,
      scrollTop: 0,
      limites: {},
      em: AGORA,
    });
    expect(
      desserializarRetorno(registro({ scrollLeft: -5 }), AGORA)?.scrollLeft,
    ).toBe(0);
  });

  it("ida-e-volta preserva", () => {
    expect(desserializarRetorno(registro(), AGORA)).toEqual({
      pipelineId: "p1",
      scrollLeft: 320,
      scrollTop: 1024,
      limites: {},
      em: AGORA,
    });
  });

  // ------------------------------------------------------------
  // Os tetos por coluna (PR #231). Sem eles, a rolagem restaurada cai sobre
  // um quadro mais curto do que o que o operador deixou: o card de onde ele
  // saiu não está renderizado e o `scrollTop` é grampeado.
  // ------------------------------------------------------------

  it("os tetos por coluna sobrevivem à ida e volta", () => {
    const lido = desserializarRetorno(
      registro({ limites: { etapa1: 300, etapa2: 100 } }),
      AGORA,
    );
    expect(lido?.limites).toEqual({ etapa1: 300, etapa2: 100 });
  });

  it("registro antigo, sem o campo, volta com o mapa VAZIO — nunca indefinido", () => {
    // O registro pode ter sido gravado pela versão anterior, que estava na
    // aba do operador quando o deploy entrou. `undefined` aqui viraria
    // `Object.keys(undefined)` no quadro.
    expect(desserializarRetorno(registro(), AGORA)?.limites).toEqual({});
  });

  it("teto estragado é descartado SOZINHO, sem derrubar o registro", () => {
    // Perder a restauração de uma coluna é muito mais barato que perder a
    // rolagem da jornada inteira.
    const lido = desserializarRetorno(
      registro({
        limites: { boa: 200, texto: "300", zero: 0, negativa: -1, quebrada: 1.5, "": 100 },
      }),
      AGORA,
    );
    expect(lido).not.toBeNull();
    expect(lido?.limites).toEqual({ boa: 200 });
    expect(lido?.scrollLeft).toBe(320);
  });

  it("`limites` que não é objeto não derruba o registro", () => {
    for (const lixo of ["x", 7, null, true]) {
      const lido = desserializarRetorno(registro({ limites: lixo }), AGORA);
      expect(lido?.limites).toEqual({});
    }
  });
});

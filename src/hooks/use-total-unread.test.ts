import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contarNaoLidas, mapaDaCarga } from "./use-total-unread";

// ============================================================
// O número do menu (conversas com não lida). Dois defeitos do #247, os dois
// achados pelo Codex: a paginação por OFFSET sobre um recorte que muda a cada
// conversa lida, e a carga que atropelava os eventos chegados durante ela.
// ============================================================

describe("mapaDaCarga — o evento que chega durante a carga vence a foto", () => {
  const carga = [
    { id: "a", unread_count: 2 },
    { id: "b", unread_count: 1 },
  ];

  it("sem eventos, é a carga", () => {
    const mapa = mapaDaCarga(carga, new Map());
    expect(Object.fromEntries(mapa)).toEqual({ a: 2, b: 1 });
    expect(contarNaoLidas(mapa)).toBe(2);
  });

  it("CRÍTICO: conversa LIDA no meio da carga não fica contada", () => {
    expect(contarNaoLidas(mapaDaCarga(carga, new Map([["a", 0]])))).toBe(1);
  });

  it("conversa que ganhou não lida no meio da carga entra", () => {
    expect(contarNaoLidas(mapaDaCarga(carga, new Map([["c", 3]])))).toBe(3);
  });

  it("conversa apagada no meio da carga sai", () => {
    const mapa = mapaDaCarga(carga, new Map<string, number | null>([["b", null]]));
    expect(mapa.has("b")).toBe(false);
    expect(contarNaoLidas(mapa)).toBe(1);
  });

  it("unread_count nulo conta como zero", () => {
    expect(contarNaoLidas(mapaDaCarga([{ id: "a", unread_count: null }], new Map()))).toBe(0);
  });
});

// O laço da carga não tem teste de comportamento (é um efeito do React);
// "esqueci de guardar o evento" ou "voltei ao OFFSET" só se pega lendo o fonte.
describe("pino: a carga do contador", () => {
  const fonte = readFileSync(join(process.cwd(), "src/hooks/use-total-unread.ts"), "utf8");

  it("pagina por chave, nunca por OFFSET", () => {
    expect(fonte).toMatch(/buscarPorChave/);
    expect(fonte).not.toMatch(/buscarPaginado/);
    expect(fonte).not.toMatch(/\.range\(/);
  });

  it("guarda os eventos que chegam durante a carga e os aplica por cima dela", () => {
    expect(fonte).toMatch(/if \(carregando\) duranteACarga\.set\(oldRow\.id, null\)/);
    expect(fonte).toMatch(/if \(carregando\) duranteACarga\.set\(row\.id, row\.unread_count \?\? 0\)/);
    expect(fonte).toMatch(/mapaDaCarga\(linhas, duranteACarga\)/);
  });
});

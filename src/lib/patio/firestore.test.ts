import { describe, it, expect } from "vitest";
import { codificar, decodificar, codificarCampos, decodificarCampos } from "./firestore";

describe("codificação do Firestore", () => {
  it("ida e volta preserva tipos", () => {
    const obj = { a: "x", n: 3, d: 2.5, b: true, z: null, l: [1, "y", { k: false }], m: { p: { q: 9 } } };
    expect(decodificarCampos(codificarCampos(obj))).toEqual(obj);
  });
  it("inteiro vai como integerValue (texto), fração como doubleValue", () => {
    expect(codificar(218000)).toEqual({ integerValue: "218000" });
    expect(codificar(1.5)).toEqual({ doubleValue: 1.5 });
  });
  it("lê valores vindos da API", () => {
    expect(decodificar({ integerValue: "42" })).toBe(42);
    expect(decodificar({ timestampValue: "2026-11-09T00:00:00Z" })).toBe("2026-11-09T00:00:00Z");
    expect(decodificar({ arrayValue: {} })).toEqual([]);
    expect(decodificar({ mapValue: {} })).toEqual({});
  });
  it("campos undefined não são enviados", () => {
    expect(codificarCampos({ a: undefined, b: 1 })).toEqual({ b: { integerValue: "1" } });
  });
});

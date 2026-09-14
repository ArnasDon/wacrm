import { describe, expect, it } from "vitest";

import { nomeParaFixar } from "./nome-fixado";

describe("nomeParaFixar", () => {
  it("devolve o nome como a pessoa escreveu, só com o espaço arrumado", () => {
    expect(nomeParaFixar("Douglas Barbosa")).toBe("Douglas Barbosa");
    expect(nomeParaFixar("  douglas   barbosa  ")).toBe("douglas barbosa");
    expect(nomeParaFixar("Anny Karoline da Silva")).toBe("Anny Karoline da Silva");
  });

  it("CRÍTICO: número não é nome — fixá-lo tiraria da ficha o nome de verdade para sempre", () => {
    expect(nomeParaFixar("5583988745316")).toBeNull();
    expect(nomeParaFixar("+55 (83) 98874-5316")).toBeNull();
    expect(nomeParaFixar("83.98874.5316")).toBeNull();
  });

  it("vazio, só espaço, só pontuação e ausente não servem", () => {
    expect(nomeParaFixar("")).toBeNull();
    expect(nomeParaFixar("   ")).toBeNull();
    expect(nomeParaFixar("---")).toBeNull();
    expect(nomeParaFixar(null)).toBeNull();
    expect(nomeParaFixar(undefined)).toBeNull();
  });

  it("nome com número ou pontuação no meio continua sendo nome", () => {
    expect(nomeParaFixar("Dr. João")).toBe("Dr. João");
    expect(nomeParaFixar("João 2º")).toBe("João 2º");
    expect(nomeParaFixar("Maria-Clara")).toBe("Maria-Clara");
  });
});

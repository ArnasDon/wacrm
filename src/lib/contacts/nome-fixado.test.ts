import { describe, expect, it } from "vitest";

import { marcaDoNomeManual, nomeParaFixar } from "./nome-fixado";

const AGORA = "2026-09-14T14:00:00.000Z";

describe("marcaDoNomeManual (a escrita à mão também fixa o nome)", () => {
  it("CRÍTICO: nome que NÃO mudou não mexe na marca — salvar só o e-mail não fixa o nome do WhatsApp", () => {
    expect(marcaDoNomeManual("DOUGLAS BARBOSA", "DOUGLAS BARBOSA", AGORA)).toEqual({});
    expect(marcaDoNomeManual("DOUGLAS BARBOSA", "  DOUGLAS   BARBOSA ", AGORA)).toEqual({});
    expect(marcaDoNomeManual(null, "", AGORA)).toEqual({});
    expect(marcaDoNomeManual(undefined, null, AGORA)).toEqual({});
  });

  it("nome trocado por um nome de verdade FIXA", () => {
    expect(marcaDoNomeManual("Carolzinha", "Anny Karoline da Silva", AGORA)).toEqual({ nome_fixado_em: AGORA });
  });

  it("nome apagado ou trocado por número SOLTA — a próxima mensagem volta a preencher", () => {
    expect(marcaDoNomeManual("Anny Karoline da Silva", "", AGORA)).toEqual({ nome_fixado_em: null });
    expect(marcaDoNomeManual("Anny Karoline da Silva", "5583988745316", AGORA)).toEqual({ nome_fixado_em: null });
  });

  it("na criação (antes nulo), nome digitado fixa e campo vazio não grava a chave", () => {
    expect(marcaDoNomeManual(null, "Joana Silva", AGORA)).toEqual({ nome_fixado_em: AGORA });
    expect(marcaDoNomeManual(null, "   ", AGORA)).toEqual({});
  });
});

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

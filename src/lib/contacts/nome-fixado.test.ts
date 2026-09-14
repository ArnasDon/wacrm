import { describe, expect, it } from "vitest";

import { escritaDoNomeManual, marcaDoNomeManual, nomeParaFixar } from "./nome-fixado";

const AGORA = "2026-09-14T14:00:00.000Z";

describe("escritaDoNomeManual (o nome e a marca só vão quando o nome mudou)", () => {
  it("CRÍTICO: nome igual ao carregado não é REGRAVADO — a tela velha não devolve o nome antigo por cima do novo", () => {
    // Revisão do PR #208: com o formulário aberto sobre a lista velha, o
    // agendamento trocou o nome no banco; salvar só a empresa regravava o
    // nome da foto e mantinha a marca — o nome do perfil ficava FIXADO.
    expect(escritaDoNomeManual("DOUGLAS BARBOSA", "DOUGLAS BARBOSA", AGORA)).toEqual({});
    expect(escritaDoNomeManual("DOUGLAS BARBOSA", " DOUGLAS  BARBOSA ", AGORA)).toEqual({});
    expect(escritaDoNomeManual(null, "", AGORA)).toEqual({});
  });

  it("nome trocado vai JUNTO com a marca, já colapsado", () => {
    expect(escritaDoNomeManual("Carolzinha", "  Anny   Karoline ", AGORA)).toEqual({
      name: "Anny Karoline",
      nome_fixado_em: AGORA,
    });
  });

  it("nome apagado grava NULL e solta a marca; número grava e solta", () => {
    expect(escritaDoNomeManual("Anny", "", AGORA)).toEqual({ name: null, nome_fixado_em: null });
    expect(escritaDoNomeManual("Anny", "5583988745316", AGORA)).toEqual({
      name: "5583988745316",
      nome_fixado_em: null,
    });
  });
});

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

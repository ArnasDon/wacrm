import { describe, expect, it } from "vitest";

import { escritaDoTituloManual } from "./titulo-do-card";

const AGORA = "2026-09-19T19:00:00.000Z";

describe("escritaDoTituloManual (1007)", () => {
  it("título digitado entra COM a marca", () => {
    expect(escritaDoTituloManual("Bancário - Comercial — 5585…", "Ana Araújo", AGORA)).toEqual({
      title: "Ana Araújo",
      titulo_fixado_em: AGORA,
    });
  });

  it("na criação (sem título anterior) também fixa", () => {
    expect(escritaDoTituloManual(null, "Reclamatória – Empresa X", AGORA)).toEqual({
      title: "Reclamatória – Empresa X",
      titulo_fixado_em: AGORA,
    });
  });

  it("⚠️ título IGUAL ao carregado não grava nada — nem o texto, nem a marca", () => {
    // O formulário reenvia o título em todo salvamento (corrigir o valor do
    // negócio, mudar a etapa). Gravar aqui congelaria um card que ninguém
    // batizou, e devolveria o título da FOTO da tela por cima do que o
    // gatilho tivesse acabado de escrever.
    expect(escritaDoTituloManual("Ana Araújo", "Ana Araújo", AGORA)).toEqual({});
  });

  it("espaço nas pontas e repetido não conta como mudança", () => {
    expect(escritaDoTituloManual("Ana Araújo", "  Ana   Araújo  ", AGORA)).toEqual({});
  });

  it("o texto gravado é o colapsado, não o digitado", () => {
    expect(escritaDoTituloManual("Ana", "Ana   Maria", AGORA)).toEqual({
      title: "Ana Maria",
      titulo_fixado_em: AGORA,
    });
  });

  it("título em branco não grava nada — a coluna é NOT NULL", () => {
    expect(escritaDoTituloManual("Ana Araújo", "   ", AGORA)).toEqual({});
    expect(escritaDoTituloManual("Ana Araújo", null, AGORA)).toEqual({});
  });

  it("número É título válido aqui: quem digitou escolheu", () => {
    // Diferente do NOME da ficha (`nomeParaFixar` recusa telefone): aqui o
    // texto é o rótulo do card, e "Processo 0801234-56" é legítimo.
    expect(escritaDoTituloManual("Ana", "5585997049490", AGORA)).toEqual({
      title: "5585997049490",
      titulo_fixado_em: AGORA,
    });
  });
});

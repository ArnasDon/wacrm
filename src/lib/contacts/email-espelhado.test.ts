import { describe, expect, it } from "vitest";

import { campoDoEmail, emailMudou, emailNormalizado } from "./email-espelhado";

describe("emailNormalizado", () => {
  it("apara e trata vazio como nulo — a forma que o banco guarda", () => {
    expect(emailNormalizado("  ana@x.com ")).toBe("ana@x.com");
    expect(emailNormalizado("")).toBeNull();
    expect(emailNormalizado("   ")).toBeNull();
    expect(emailNormalizado(null)).toBeNull();
    expect(emailNormalizado(undefined)).toBeNull();
  });
});

describe("emailMudou", () => {
  it("CRÍTICO: e-mail que não foi tocado NÃO conta como mudança — o Salvar não pode regravar o valor velho", () => {
    // O caso: editou o campo espelhado, voltou à aba de dados e salvou só o
    // telefone. A caixa ainda tem o e-mail carregado; mandá-lo desfaria a
    // edição do campo.
    expect(emailMudou("antigo@x.com", "antigo@x.com")).toBe(false);
    expect(emailMudou("antigo@x.com", "  antigo@x.com ")).toBe(false);
    expect(emailMudou(null, "")).toBe(false);
    expect(emailMudou(undefined, "   ")).toBe(false);
  });

  it("e-mail trocado ou apagado na caixa conta", () => {
    expect(emailMudou("antigo@x.com", "novo@x.com")).toBe(true);
    expect(emailMudou("antigo@x.com", "")).toBe(true);
    expect(emailMudou(null, "novo@x.com")).toBe(true);
  });
});

describe("campoDoEmail", () => {
  it("acha o campo espelhado, e nulo quando a conta não o tem", () => {
    expect(campoDoEmail([{ id: "a", espelho: null }, { id: "b", espelho: "contacts.email" }])).toBe("b");
    expect(campoDoEmail([{ id: "a", espelho: null }])).toBeNull();
    expect(campoDoEmail([])).toBeNull();
  });
});

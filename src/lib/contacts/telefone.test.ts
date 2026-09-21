import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

import {
  digitosDoTelefone,
  formatarTelefone,
  pareceTelefone,
  telefoneCanonico,
  variantesDoNonoDigito,
} from "./telefone";

describe("digitosDoTelefone", () => {
  it("o lembrete por SMS vem com DDI e entra como veio", () => {
    expect(digitosDoTelefone("+55 96 99112-6767")).toBe("5596991126767");
    expect(digitosDoTelefone("+1 404-555-1234")).toBe("14045551234");
  });

  it("o que o brasileiro digita sem DDI ganha o 55", () => {
    expect(digitosDoTelefone("(96) 99112-6767")).toBe("5596991126767");
    expect(digitosDoTelefone("96 9112-6767")).toBe("559691126767");
    expect(digitosDoTelefone("83988745316")).toBe("5583988745316");
  });

  it("CRÍTICO: número de fora escrito só em dígitos NÃO ganha o 55 (o 9 na 3ª posição é o que separa)", () => {
    // "14045551234" tem 11 dígitos como um celular brasileiro; com o 55 ele
    // iria para outro destinatário, com os dados do agendamento junto.
    expect(digitosDoTelefone("14045551234")).toBe("14045551234");
    expect(digitosDoTelefone("1 404 555 1234")).toBe("14045551234");
    // celular brasileiro: DDD + 9 + 8 dígitos
    expect(digitosDoTelefone("83988745316")).toBe("5583988745316");
    expect(digitosDoTelefone("11 91234-5678")).toBe("5511912345678");
  });

  it("já com 55 e sem `+` não dobra o DDI", () => {
    expect(digitosDoTelefone("5596991126767")).toBe("5596991126767");
    expect(digitosDoTelefone("55 96 99112-6767")).toBe("5596991126767");
  });

  it("prefixo internacional 00 é DDI escrito de outro jeito", () => {
    expect(digitosDoTelefone("0055 96 99112 6767")).toBe("5596991126767");
  });

  it("curto ou longo demais não é telefone", () => {
    expect(digitosDoTelefone("1234567")).toBeNull();
    expect(digitosDoTelefone("1234567890123456")).toBeNull();
    expect(digitosDoTelefone("")).toBeNull();
    expect(digitosDoTelefone(null)).toBeNull();
  });
});

describe("pareceTelefone", () => {
  it("aceita as formas usuais", () => {
    expect(pareceTelefone("(96) 99112-6767")).toBe(true);
    expect(pareceTelefone("+55 96 99112-6767")).toBe(true);
    expect(pareceTelefone("96991126767")).toBe(true);
  });

  it("recusa texto com letras ou poucos dígitos", () => {
    expect(pareceTelefone("Rua 12, nº 340")).toBe(false);
    expect(pareceTelefone("R$ 15.000")).toBe(false);
    expect(pareceTelefone("12345")).toBe(false);
    expect(pareceTelefone("")).toBe(false);
  });
});

describe("formatarTelefone", () => {
  it("brasileiro com 9 dígitos", () => {
    expect(formatarTelefone("5596991126767")).toBe("(96) 99112-6767");
  });

  it("brasileiro com 8 dígitos (fixo)", () => {
    expect(formatarTelefone("558332221111")).toBe("(83) 3222-1111");
  });

  it("estrangeiro sai com `+`", () => {
    expect(formatarTelefone("14045551234")).toBe("+14045551234");
  });

  it("vazio fica vazio", () => {
    expect(formatarTelefone(null)).toBe("");
  });
});

describe("variantesDoNonoDigito", () => {
  it("celular gravado COM o 9 ganha a irmã sem ele — a original primeiro", () => {
    expect(variantesDoNonoDigito("5583988745316")).toEqual([
      "5583988745316",
      "558388745316",
    ]);
  });

  it("celular gravado SEM o 9 ganha a irmã com ele", () => {
    expect(variantesDoNonoDigito("558388745316")).toEqual([
      "558388745316",
      "5583988745316",
    ]);
  });

  it("⚠️ fixo não ganha 9: o nono dígito é só de celular (6, 7, 8 ou 9)", () => {
    expect(variantesDoNonoDigito("558333334444")).toEqual(["558333334444"]);
    // 13 dígitos com 9 na 5ª posição mas 3 na 6ª: não é celular com 9 na frente.
    expect(variantesDoNonoDigito("5583933334444")).toEqual(["5583933334444"]);
  });

  it("sem DDI 55, ou de outro país, volta sozinho", () => {
    expect(variantesDoNonoDigito("83988745316")).toEqual(["83988745316"]);
    expect(variantesDoNonoDigito("14045551234")).toEqual(["14045551234"]);
    expect(variantesDoNonoDigito("")).toEqual([""]);
  });
});

describe("telefoneCanonico (a chave única de contacts desde a 1024)", () => {
  it.each([
    ["558388745316", "5583988745316"], // celular sem o 9: ganha
    ["5583988745316", "5583988745316"], // com o 9: fica
    ["+55 (83) 8874-5316", "5583988745316"], // separadores saem
    ["551132345678", "551132345678"], // fixo (começa em 3): não inventa 9
    ["5511912345678", "5511912345678"], // 13 dígitos: fica como está
    ["14045551234", "14045551234"], // fora do Brasil: fica
    ["", ""],
  ])("%s → %s", (entrada, esperado) => {
    expect(telefoneCanonico(entrada)).toBe(esperado);
  });

  it("nulo e indefinido viram vazio (a ficha só do Instagram fica fora do índice)", () => {
    expect(telefoneCanonico(null)).toBe("");
    expect(telefoneCanonico(undefined)).toBe("");
  });

  it("as duas grafias do nono dígito têm SEMPRE a mesma canônica", () => {
    for (const numero of ["558388745316", "5583988745316", "5511987654321", "556199998888"]) {
      const [a, b] = variantesDoNonoDigito(numero);
      if (b === undefined) continue;
      expect(telefoneCanonico(a)).toBe(telefoneCanonico(b));
    }
  });

  it("dois números que NÃO são irmãos continuam distintos (os pares ambíguos do de-para)", () => {
    // Mesmos 8 finais, DDDs diferentes: duas pessoas.
    expect(telefoneCanonico("5582988745316")).not.toBe(telefoneCanonico("5515988745316"));
    // Fixo e celular que diferem só no 9: o fixo não tem irmã.
    expect(telefoneCanonico("551132345678")).not.toBe(telefoneCanonico("5511932345678"));
  });

  it("é ESPELHO da coluna gerada da 1024 — a régua do banco é a mesma", () => {
    // Mudar a regra de um lado só faz o código achar "pessoa nova" onde o
    // índice vê a mesma (23505 na cara) ou o contrário.
    const sql = fs.readFileSync(
      path.join(__dirname, "../../../supabase/migrations/1024_cb_telefone_canonico.sql"),
      "utf8",
    );
    expect(sql).toContain("regexp_replace(regexp_replace(phone, '\\D', '', 'g'),");
    expect(sql).toContain("'^(55[0-9]{2})([6-9][0-9]{7})$', '\\19\\2')");
    expect(sql).toContain("on public.contacts (account_id, telefone_canonico)");
    expect(sql).toContain("where telefone_canonico <> ''");
  });
});

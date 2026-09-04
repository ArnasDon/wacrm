import { describe, expect, it } from "vitest";
import { normalizeCpfCnpj } from "./cpf-cnpj";

describe("normalizeCpfCnpj", () => {
  it("strips formatting from a CPF (11 digits)", () => {
    expect(normalizeCpfCnpj("123.456.789-01")).toBe("12345678901");
  });

  it("strips formatting from a CNPJ (14 digits)", () => {
    expect(normalizeCpfCnpj("12.345.678/0001-95")).toBe("12345678000195");
  });

  it("accepts already-plain digits", () => {
    expect(normalizeCpfCnpj("12345678901")).toBe("12345678901");
  });

  it("rejects wrong length", () => {
    expect(normalizeCpfCnpj("123")).toBeNull();
    expect(normalizeCpfCnpj("123456789012")).toBeNull();
  });

  it("rejects empty/blank input", () => {
    expect(normalizeCpfCnpj("")).toBeNull();
    expect(normalizeCpfCnpj("   ")).toBeNull();
  });
});

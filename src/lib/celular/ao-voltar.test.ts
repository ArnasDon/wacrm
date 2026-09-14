import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUSENCIA_QUE_RECARREGA_MS,
  voltouDepoisDeAusencia,
} from "./ao-voltar";

const SAIU = 1_000_000;

describe("voltouDepoisDeAusencia", () => {
  it("olhada rápida em outro app não recarrega", () => {
    expect(
      voltouDepoisDeAusencia(SAIU, SAIU + AUSENCIA_QUE_RECARREGA_MS - 1),
    ).toBe(false);
  });

  it("tempo fora suficiente recarrega", () => {
    expect(
      voltouDepoisDeAusencia(SAIU, SAIU + AUSENCIA_QUE_RECARREGA_MS),
    ).toBe(true);
    expect(voltouDepoisDeAusencia(SAIU, SAIU + 60 * 60 * 1000)).toBe(true);
  });

  it("sem ter visto a saída, não recarrega", () => {
    expect(voltouDepoisDeAusencia(null, SAIU)).toBe(false);
  });

  it("relógio andando para trás não recarrega", () => {
    expect(voltouDepoisDeAusencia(SAIU, SAIU - 5 * 60 * 1000)).toBe(false);
  });
});

describe("as telas que se atualizam ao voltar", () => {
  const ler = (caminho: string) =>
    readFileSync(join(process.cwd(), caminho), "utf8");

  it.each([
    "src/app/(dashboard)/tarefas/page.tsx",
    "src/app/(dashboard)/meu-dia/page.tsx",
    "src/app/(dashboard)/pipelines/page.tsx",
    "src/app/(dashboard)/contacts/page.tsx",
  ])("%s chama useAoVoltarParaOApp", (caminho) => {
    expect(ler(caminho)).toContain("useAoVoltarParaOApp(");
  });
});

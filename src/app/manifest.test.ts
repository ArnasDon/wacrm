// ============================================================
// Pino do manifesto e do ícone do app instalado na Tela de Início.
//
// Os modos de falha daqui não estouram em lugar nenhum: um escopo
// estreitado devolve a moldura de navegador do iPhone por cima de cada
// conversa aberta, e um ícone que some do `<head>` (ou que aponta para um
// tamanho que o `apple-icon.tsx` não gera) vira ícone improvisado ou
// quebrado na Tela de Início. Tudo só aparece no aparelho, e só para quem
// instalar DEPOIS da mudança.
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TAMANHOS_DO_ICONE } from "@/lib/marca";
import manifest from "./manifest";

describe("manifesto do app instalado", () => {
  const m = manifest();

  it("o escopo é a raiz: todo endereço do CRM fica dentro do app", () => {
    // Sem isso, abrir uma conversa no iPhone cobria a tela com a moldura
    // de navegador (relato do operador com print, 14/09/2026).
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("abre na caixa de entrada, dentro do próprio escopo", () => {
    expect(m.start_url).toBe("/inbox");
    expect(m.start_url?.startsWith(m.scope ?? "")).toBe(true);
  });

  it("tem identidade fixa, que não muda junto com a tela de abertura", () => {
    expect(m.id).toBe("/");
  });

  it("aponta um ícone para cada tamanho que o apple-icon gera, e só para eles", () => {
    const icones = m.icons ?? [];
    const esperados = TAMANHOS_DO_ICONE.map((lado) => `/apple-icon/${lado}`);

    for (const src of esperados) {
      expect(icones.map((i) => i.src)).toContain(src);
    }
    for (const icone of icones) {
      expect(esperados).toContain(icone.src);
      const lado = icone.src.split("/").pop();
      expect(icone.sizes).toBe(`${lado}x${lado}`);
      expect(icone.type).toBe("image/png");
    }
  });

  it("tem os dois tamanhos que o Android exige para instalar", () => {
    const tamanhos = (m.icons ?? []).map((i) => i.sizes);
    expect(tamanhos).toContain("192x192");
    expect(tamanhos).toContain("512x512");
  });
});

describe("ícone do app instalado no <head>", () => {
  it("o layout NÃO declara `icons` — a declaração desliga o apple-touch-icon", () => {
    // Medido em 14/09/2026 (Next 16.2): com `metadata.icons` no layout, o
    // Next ignora TODOS os ícones de arquivo, e o `<head>` saía sem nenhum
    // `apple-touch-icon`. O `icons` veio do upstream e um merge o traz de
    // volta sem conflito nenhum.
    const layout = readFileSync(
      join(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    );
    expect(layout).not.toMatch(/^\s*icons\s*:/m);
  });
});

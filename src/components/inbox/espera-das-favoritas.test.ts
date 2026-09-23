import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// O recorte "Favoritas" aplicado sobre o conjunto VAZIO da montagem diz
// "nenhuma conversa" até a consulta das favoritas voltar. O padrão salvo com
// Favoritas era semeado assim quando ela chegava por último (Codex, PR #247).
// A espera é de tela e do hook, sem teste de comportamento possível aqui —
// daí o pino no fonte.
// ============================================================

const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");

describe("a lista espera as favoritas antes de aplicar o recorte", () => {
  const lista = ler("src/components/inbox/conversation-list.tsx");
  const hook = ler("src/hooks/use-favoritas.ts");

  it("o spinner segura enquanto o recorte está ligado e as favoritas não voltaram", () => {
    expect(lista).toMatch(/const aguardandoFavoritas = filtros\.favoritas && !favoritasCarregadas;/);
    expect(lista).toMatch(/\{loading \|\| aguardandoEtapas \|\| aguardandoFavoritas \|\| esperandoPadrao \? \(/);
  });

  it("'carregadas' é carimbado com o dono e vale também para a leitura que falhou", () => {
    expect(hook).toMatch(/carregadas: userId !== null && carregadasDe === userId/);
    // Antes do teste de erro: leitura que falhou também libera a lista (o
    // aviso das favoritas explica), senão o spinner ficaria para sempre.
    expect(hook).toMatch(/if \(cancelado\) return;\s+setCarregadasDe\(userId\);\s+if \(error \|\| !data\)/);
  });
});

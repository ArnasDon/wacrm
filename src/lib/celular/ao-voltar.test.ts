import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUSENCIA_QUE_RECARREGA_MS,
  voltouDepoisDeAusencia,
} from "./ao-voltar";

const SAIU = 1_000_000;

const ler = (caminho: string) =>
  readFileSync(join(process.cwd(), caminho), "utf8");

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
  it.each([
    "src/app/(dashboard)/tarefas/page.tsx",
    "src/app/(dashboard)/meu-dia/page.tsx",
    "src/app/(dashboard)/pipelines/page.tsx",
    "src/app/(dashboard)/contacts/page.tsx",
  ])("%s chama useAoVoltarParaOApp", (caminho) => {
    expect(ler(caminho)).toContain("useAoVoltarParaOApp(");
  });
});

describe("as cercas da recarga silenciosa (Codex, PR #216)", () => {
  const contatos = ler("src/app/(dashboard)/contacts/page.tsx");
  const funil = ler("src/app/(dashboard)/pipelines/page.tsx");

  it("Contatos poda a seleção às linhas que continuam na página", () => {
    // A ação em massa age sobre a seleção inteira: id que saiu da página e
    // continuou marcado seria apagado sem ninguém o ver marcado.
    expect(contatos).toContain("podarSelecao(enriched)");
    expect(contatos).toContain("podarSelecao([])");
  });

  it("Contatos recarrega o catálogo de etiquetas na volta, trocando o mapa só quando mudou", () => {
    // Sem o catálogo, etiqueta nova some da linha e a apagada segue filtrando;
    // trocando o mapa sempre, toda volta refaria a lista com spinner.
    expect(contatos).toMatch(/useAoVoltarParaOApp\(\(\) => \{\s*void fetchTags\(\);/);
    expect(contatos).toContain("return igual ? prev : map;");
  });

  it("o Funil descarta a resposta de outro funil e mantém o quadro quando a consulta falha", () => {
    expect(funil).toContain("funilAbertoRef.current !== funil");
    expect(funil).toContain("if (!etapas || !negocios) return;");
  });

  it("o Funil descarta a resposta que saiu antes de uma mudança local", () => {
    // Uma recarga que partiu antes de um arrasto e voltou depois dele
    // devolveria o card à etapa antiga.
    expect(funil).toContain("versaoDoQuadroRef.current !== versao");
    expect(funil).toMatch(
      /const handleDealMoved = useCallback\(\s*async \(dealId: string, newStageId: string\) => \{[\s\S]{0,300}versaoDoQuadroRef\.current \+= 1;/,
    );
    expect(funil).toMatch(
      /const refreshDeals = useCallback\(async \(\) => \{\s*if \(!selectedPipelineId\) return;\s*versaoDoQuadroRef\.current \+= 1;/,
    );
  });
});

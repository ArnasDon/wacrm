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
    // As visões do funil que têm dados próprios (`useTrajetorias`): a
    // recarga do quadro não as alcança (Codex, PR #216, 3ª rodada).
    "src/components/funil/lista-de-leads.tsx",
    "src/components/funil/desempenho.tsx",
    "src/components/funil/saude.tsx",
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

  it("Contatos refaz a lista em silêncio, com a seleção, quando só o catálogo mudou", () => {
    expect(contatos).toContain(
      "soOCatalogo ? { silencioso: true, preservarSelecao: true } : undefined",
    );
  });

  it("a volta do Funil recarrega quadro, catálogo de funis e automações, com leitores que devolvem null na falha", () => {
    // Uma falha passageira na volta não pode esvaziar o quadro, apagar a
    // lista de funis e a seleção, nem trocar os nomes dos cartões.
    expect(funil).toContain("buscarFunis(),");
    expect(funil).toContain("buscarAutomacoes(),");
    expect(funil).toContain("!extra.falhou");
    expect(funil).toContain("if (etapas && negocios) {");
  });

  it("o Funil só grava com o mesmo funil aberto e sem mudança no meio do caminho", () => {
    expect(funil).toContain(
      "versaoDoQuadroRef.current === versao && funilAbertoRef.current === funil",
    );
    // Toda mudança local ou troca de funil avança a versão: a resposta que
    // partiu antes dela desfaria o arrasto, o salvamento ou a troca.
    for (const quem of [
      /const refreshDeals = useCallback\(async \(\) => \{\s*if \(!selectedPipelineId\) return;\s*versaoDoQuadroRef\.current \+= 1;/,
      /const refreshStages = useCallback\(async \(\) => \{\s*if \(!selectedPipelineId\) return;\s*versaoDoQuadroRef\.current \+= 1;/,
      /const refreshPipelines = useCallback\(async \(\) => \{\s*versaoDoQuadroRef\.current \+= 1;/,
      /const refreshAutomations = useCallback\(async \(\) => \{\s*versaoDoQuadroRef\.current \+= 1;/,
      /const handleDealMoved = useCallback\(\s*async \(dealId: string, newStageId: string\) => \{[\s\S]{0,300}versaoDoQuadroRef\.current \+= 1;/,
      /funilAbertoRef\.current = selectedPipelineId;[\s\S]{0,500}versaoDoQuadroRef\.current \+= 1;/,
    ]) {
      expect(funil).toMatch(quem);
    }
  });
});

describe("as visões do funil recarregam também o que não é trajetória (Codex, merge do PR #216)", () => {
  const desempenho = ler("src/components/funil/desempenho.tsx");
  const gastos = ler("src/hooks/use-gastos-de-anuncios.ts");
  const lista = ler("src/components/funil/lista-de-leads.tsx");
  const canais = ler("src/hooks/use-channels.ts");

  it("o Desempenho recarrega as trajetórias E o gasto dos anúncios", () => {
    // Só as trajetórias misturava leads novos com o gasto de antes da
    // sincronização: custo por lead e CAC errados até trocar de tela.
    expect(desempenho).toMatch(
      /useAoVoltarParaOApp\(\(\) => \{\s*recarregar\(\);\s*anuncios\.recarregar\(\);\s*\}\);/,
    );
    // A versão entra NA CHAVE: sem ela, o resultado velho continuaria vigente.
    expect(gastos).toContain('const chave = `${dias.desde ?? ""}|${dias.ate ?? ""}|${versao}`;');
    expect(gastos).toContain("const recarregar = useCallback(() => setVersao((v) => v + 1), []);");
  });

  it("a Lista recarrega as linhas, o catálogo e as conexões, e a falha não apaga os rótulos", () => {
    expect(lista).toMatch(
      /useAoVoltarParaOApp\(\(\) => \{\s*recarregar\(\);\s*setVersaoDoCatalogo\(\(v\) => v \+ 1\);\s*void recarregarCanais\(\);\s*\}\);/,
    );
    expect(lista).toContain("}, [supabase, versaoDoCatalogo]);");
    // Catálogo vazio tiraria as colunas de campo da tabela até a volta seguinte.
    expect(lista).toContain("falhouAgora && atual !== null");
    // As conexões voltam pela recarga que DESCARTA a falha: a comum trocaria
    // a lista boa pelo vazio e apagaria os nomes da coluna Conexão.
    expect(lista).toContain("recarregarEmSilencio: recarregarCanais");
    expect(canais).toContain("if (montadoRef.current && !r.falhou) setResultado(r);");
  });
});

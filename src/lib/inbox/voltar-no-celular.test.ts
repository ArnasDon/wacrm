import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aoAndarNoHistorico, navegacaoAoAbrir } from "./voltar-no-celular";

describe("navegacaoAoAbrir", () => {
  it("no celular, abrindo da lista: push — o passo que o gesto de voltar desfaz", () => {
    expect(
      navegacaoAoAbrir({ ehDesktop: false, haviaConversaAberta: false }),
    ).toBe("push");
  });

  it("no celular, com outra conversa já aberta: replace", () => {
    expect(
      navegacaoAoAbrir({ ehDesktop: false, haviaConversaAberta: true }),
    ).toBe("replace");
  });

  it("no computador: replace, sempre — nada de um passo por clique", () => {
    expect(
      navegacaoAoAbrir({ ehDesktop: true, haviaConversaAberta: false }),
    ).toBe("replace");
    expect(
      navegacaoAoAbrir({ ehDesktop: true, haviaConversaAberta: true }),
    ).toBe("replace");
  });
});

describe("aoAndarNoHistorico", () => {
  it("voltou para a lista com uma conversa na tela: fecha", () => {
    expect(
      aoAndarNoHistorico({ conversaNaUrl: null, conversaAberta: "a" }),
    ).toBe("fechar");
  });

  it("lista na URL e nada aberto: nada a fazer", () => {
    expect(
      aoAndarNoHistorico({ conversaNaUrl: null, conversaAberta: null }),
    ).toBe("nada");
  });

  it("avançou de novo para a conversa que tinha fechado: reabre", () => {
    expect(
      aoAndarNoHistorico({ conversaNaUrl: "a", conversaAberta: null }),
    ).toBe("reabrir");
  });

  it("URL com outra conversa que não a da tela: reabre a da URL", () => {
    expect(
      aoAndarNoHistorico({ conversaNaUrl: "b", conversaAberta: "a" }),
    ).toBe("reabrir");
  });

  it("URL e tela na mesma conversa: nada", () => {
    expect(
      aoAndarNoHistorico({ conversaNaUrl: "a", conversaAberta: "a" }),
    ).toBe("nada");
  });
});

describe("a caixa de entrada usa as regras", () => {
  const pagina = readFileSync(
    join(process.cwd(), "src/app/(dashboard)/inbox/page.tsx"),
    "utf8",
  );

  it("escuta o histórico andar — sem isso o gesto de voltar muda a URL e a conversa fica na tela", () => {
    expect(pagina).toContain('addEventListener("popstate"');
    expect(pagina).toContain("aoAndarNoHistorico(");
  });

  it("decide push ou replace pela regra ao abrir", () => {
    expect(pagina).toContain("navegacaoAoAbrir(");
  });

  it("o botão voltar da tela desfaz o passo que a abertura criou", () => {
    expect(pagina).toContain("router.back()");
  });
});

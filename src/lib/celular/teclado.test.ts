import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARRASTO_QUE_RECOLHE_PX,
  ATRIBUTO_ACIMA_DO_TECLADO,
  DIFERENCA_DO_TECLADO_PX,
  MIDIA_DE_TOQUE,
  ajusteDoTeclado,
  arrastoRecolheTeclado,
  enterEnvia,
} from "./teclado";

const IPHONE = 844;
const COM_TECLADO = 508;

function leitura(parcial: Partial<Parameters<typeof ajusteDoTeclado>[0]> = {}) {
  return {
    alturaVisivel: IPHONE,
    escala: 1,
    alturaDaJanela: IPHONE,
    focoNaArea: true,
    ...parcial,
  };
}

describe("ajusteDoTeclado", () => {
  it("teclado aberto com o foco na conversa: a casca mede a área visível e o empurrão é desfeito", () => {
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: COM_TECLADO }), false),
    ).toEqual({ altura: COM_TECLADO, desfazerEmpurrao: true, ajustada: true });
  });

  it("arredonda a altura — o iPhone entrega fração de pixel", () => {
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: 507.6 }), false).altura,
    ).toBe(508);
  });

  it("teclado aberto com o foco FORA da conversa: não mexe em nada", () => {
    // Formulário de outra tela ou diálogo: o empurrão do iPhone é o que
    // revela o campo acima do teclado.
    expect(
      ajusteDoTeclado(
        leitura({ alturaVisivel: COM_TECLADO, focoNaArea: false }),
        false,
      ),
    ).toEqual({ altura: null, desfazerEmpurrao: false, ajustada: false });
  });

  it("o teclado fechou depois do ajuste: devolve a altura e desfaz o empurrão uma última vez", () => {
    // É o "desconfigurado" do relato: recolhido o teclado, a tela ficava
    // deslocada.
    expect(ajusteDoTeclado(leitura({ focoNaArea: false }), true)).toEqual({
      altura: null,
      desfazerEmpurrao: true,
      ajustada: false,
    });
  });

  it("sem ajuste anterior e sem teclado: nada a desfazer", () => {
    expect(ajusteDoTeclado(leitura(), false)).toEqual({
      altura: null,
      desfazerEmpurrao: false,
      ajustada: false,
    });
  });

  it("barra do navegador aparecendo não conta como teclado", () => {
    const quase = IPHONE - DIFERENCA_DO_TECLADO_PX + 1;
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: quase }), false).altura,
    ).toBeNull();
    expect(
      ajusteDoTeclado(
        leitura({ alturaVisivel: IPHONE - DIFERENCA_DO_TECLADO_PX }),
        false,
      ).altura,
    ).toBe(IPHONE - DIFERENCA_DO_TECLADO_PX);
  });

  it("pinça de zoom: não ajusta, e não briga com o dedo nem se estava ajustada", () => {
    expect(
      ajusteDoTeclado(
        leitura({ alturaVisivel: COM_TECLADO, escala: 2 }),
        true,
      ),
    ).toEqual({ altura: null, desfazerEmpurrao: false, ajustada: false });
  });
});

describe("arrastoRecolheTeclado", () => {
  it("o dedo desce, rumo às mensagens antigas: recolhe (o gesto do WhatsApp)", () => {
    expect(arrastoRecolheTeclado(300, 300 + ARRASTO_QUE_RECOLHE_PX)).toBe(true);
    expect(arrastoRecolheTeclado(300, 520)).toBe(true);
  });

  it("o dedo sobe, rumo ao fim: não recolhe — é quem continua escrevendo", () => {
    expect(arrastoRecolheTeclado(300, 180)).toBe(false);
  });

  it("toque trêmulo abaixo do limiar não recolhe", () => {
    expect(
      arrastoRecolheTeclado(300, 300 + ARRASTO_QUE_RECOLHE_PX - 1),
    ).toBe(false);
  });

  it("sem o início do toque não decide nada", () => {
    expect(arrastoRecolheTeclado(null, 500)).toBe(false);
    expect(arrastoRecolheTeclado(300, undefined)).toBe(false);
  });
});

describe("enterEnvia", () => {
  it("no computador, Enter envia e Shift+Enter pula linha", () => {
    expect(enterEnvia({ key: "Enter", shiftKey: false }, false)).toBe(true);
    expect(enterEnvia({ key: "Enter", shiftKey: true }, false)).toBe(false);
  });

  it("no aparelho de toque, o retorno nunca envia (decisão do operador)", () => {
    expect(enterEnvia({ key: "Enter", shiftKey: false }, true)).toBe(false);
    expect(enterEnvia({ key: "Enter", shiftKey: true }, true)).toBe(false);
  });

  it("outra tecla não envia", () => {
    expect(enterEnvia({ key: "a", shiftKey: false }, false)).toBe(false);
  });
});

describe("as peças que o ajuste amarra", () => {
  const ler = (caminho: string) =>
    readFileSync(join(process.cwd(), caminho), "utf8");

  it("o CSS dos 16 px usa a mesma consulta de toque do código", () => {
    expect(ler("src/app/globals.css")).toContain(`@media ${MIDIA_DE_TOQUE}`);
  });

  it("o fio da conversa marca a área — sem a marca o ajuste nunca liga, sem erro nenhum", () => {
    expect(ler("src/components/inbox/message-thread.tsx")).toContain(
      ATRIBUTO_ACIMA_DO_TECLADO,
    );
  });

  it("o arrasto da conversa passa pela regra que recolhe o teclado", () => {
    const fio = ler("src/components/inbox/message-thread.tsx");
    expect(fio).toContain("onTouchStart={aoTocarNoFio}");
    expect(fio).toContain("onTouchMove={aoArrastarOFio}");
  });

  it("o Enter do compositor passa pela regra do toque", () => {
    expect(ler("src/components/inbox/message-composer.tsx")).toContain(
      "enterEnvia(e, window.matchMedia(MIDIA_DE_TOQUE).matches)",
    );
  });

  it("a casca e a caixa de entrada medem a altura pela variável que o hook escreve", () => {
    expect(ler("src/app/(dashboard)/dashboard-shell.tsx")).toContain(
      "var(--altura-visivel,100dvh)",
    );
    expect(ler("src/app/(dashboard)/inbox/page.tsx")).toContain(
      "var(--altura-visivel,100dvh)",
    );
    expect(ler("src/hooks/use-tela-acima-do-teclado.ts")).toContain(
      '"--altura-visivel"',
    );
  });
});

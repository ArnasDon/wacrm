import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARRASTO_QUE_RECOLHE_PX,
  ATRIBUTO_ACIMA_DO_TECLADO,
  MIDIA_DE_TOQUE,
  ajusteDoTeclado,
  arrastoRecolheTeclado,
  enterEnvia,
} from "./teclado";

const IPHONE = 844;
const COM_TECLADO = 508;
const EMPURRAO = IPHONE - COM_TECLADO;

function leitura(parcial: Partial<Parameters<typeof ajusteDoTeclado>[0]> = {}) {
  return {
    alturaVisivel: IPHONE,
    deslocamentoVisivel: 0,
    escala: 1,
    toque: true,
    focoNaArea: true,
    ...parcial,
  };
}

const SEM_AJUSTE = { altura: null, deslocamento: null, desfazerEmpurrao: false, ajustada: false };

describe("ajusteDoTeclado", () => {
  it("teclado aberto com o foco na conversa: a casca mede a área visível e desce junto com o empurrão", () => {
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: COM_TECLADO, deslocamentoVisivel: EMPURRAO }), false),
    ).toEqual({ altura: COM_TECLADO, deslocamento: EMPURRAO, desfazerEmpurrao: false, ajustada: true });
  });

  it("não precisa perceber o teclado: sem empurrão, a casca só mede a área visível", () => {
    // A 1ª versão exigia 120 px de diferença entre a janela e a área visível,
    // e no iPhone do operador o ajuste nunca ligou (print de 15/09/2026). Sem
    // teclado, a área visível é a tela inteira: medir não muda nada.
    expect(ajusteDoTeclado(leitura(), false)).toEqual({
      altura: IPHONE,
      deslocamento: 0,
      desfazerEmpurrao: false,
      ajustada: true,
    });
  });

  it("arredonda altura e deslocamento — o iPhone entrega fração de pixel", () => {
    const ajuste = ajusteDoTeclado(leitura({ alturaVisivel: 507.6, deslocamentoVisivel: 336.4 }), false);
    expect(ajuste.altura).toBe(508);
    expect(ajuste.deslocamento).toBe(336);
  });

  it("enquanto ajustada, não rola a janela: com o teclado aberto a rolagem ou não pega, ou pisca", () => {
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: COM_TECLADO, deslocamentoVisivel: EMPURRAO }), true)
        .desfazerEmpurrao,
    ).toBe(false);
  });

  it("teclado aberto com o foco FORA da conversa: não mexe em nada", () => {
    // Formulário de outra tela ou diálogo: o empurrão do iPhone é o que
    // revela o campo acima do teclado.
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: COM_TECLADO, focoNaArea: false }), false),
    ).toEqual(SEM_AJUSTE);
  });

  it("no computador (sem toque) nunca ajusta", () => {
    expect(ajusteDoTeclado(leitura({ toque: false }), false)).toEqual(SEM_AJUSTE);
  });

  it("o foco saiu depois do ajuste: devolve altura e posição e desfaz o empurrão uma última vez", () => {
    // É o "desconfigurado" do relato: recolhido o teclado, a tela ficava
    // deslocada.
    expect(ajusteDoTeclado(leitura({ focoNaArea: false }), true)).toEqual({
      ...SEM_AJUSTE,
      desfazerEmpurrao: true,
    });
  });

  it("pinça de zoom: não ajusta, e não briga com o dedo nem se estava ajustada", () => {
    expect(
      ajusteDoTeclado(leitura({ alturaVisivel: COM_TECLADO, escala: 2 }), true),
    ).toEqual(SEM_AJUSTE);
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
  const hook = ler("src/hooks/use-tela-acima-do-teclado.ts");
  const casca = ler("src/app/(dashboard)/dashboard-shell.tsx");

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
    expect(casca).toContain("var(--altura-visivel,100dvh)");
    expect(ler("src/app/(dashboard)/inbox/page.tsx")).toContain(
      "var(--altura-visivel,100dvh)",
    );
    expect(hook).toContain('"--altura-visivel"');
  });

  it("a casca desce pelo deslocamento que o hook escreve — com `top`, nunca com `transform`", () => {
    // `transform` faria todo `fixed` de dentro da casca (menu, painéis) se
    // posicionar por ela.
    expect(casca).toContain("relative top-[var(--deslocamento-visivel)]");
    expect(casca).not.toMatch(/translate-y-\[var\(--deslocamento-visivel/);
    expect(hook).toContain('"--deslocamento-visivel"');
  });

  it("o hook decide pelo toque e pelo foco, nunca pela altura da janela", () => {
    // Comparar com a janela foi a regra que nunca ligou no iPhone do operador
    // (15/09/2026). A crase exclui a menção no comentário do próprio hook.
    expect(hook).not.toMatch(/window\.innerHeight(?!`)/);
    expect(hook).toContain("toque: toque.matches");
    // `pageTop`, e não só `offsetTop`: quando o iPhone ROLA a janela para
    // revelar a caixa, o `offsetTop` fica em zero e a casca ficaria acima da
    // área visível (Codex, PR #219) — e a rolagem da janela precisa reler.
    expect(hook).toContain("deslocamentoVisivel: vv.pageTop");
    expect(hook).toContain('window.addEventListener("scroll", agendar');
  });
});

describe("a formatação na linha dos botões do celular (pedido do operador, 15/09/2026)", () => {
  const compositor = readFileSync(
    join(process.cwd(), "src/components/inbox/message-composer.tsx"),
    "utf8",
  );

  it("sobe só quando cabe: sem o botão de modelos e a partir de 390 px", () => {
    // A conta é de pixel (366 px livres a 390 px, 358 ocupados): com o botão
    // de modelos, gravar, agendar e enviar desceriam para uma terceira linha.
    expect(compositor).toContain("const formatacaoNaLinha = !mostraModelos;");
    expect(compositor).toContain("min-[390px]:max-sm:flex");
    expect(compositor).toContain('formatacaoNaLinha && "min-[390px]:max-sm:hidden"');
    // O botão de modelos segue a MESMA régua que a condição acima lê.
    expect(compositor).toContain("{mostraModelos && (");
  });

  it("a etiqueta da hora agendada tem linha própria no celular — ao lado do relógio ela não cabia a 390 px", () => {
    // Medido em 15/09/2026: com a etiqueta na linha, o botão de agendar descia
    // para uma linha a mais, com ou sem a formatação.
    expect(compositor).toContain(
      'etiquetaEmLinhaPropria && "max-sm:order-first max-sm:basis-full max-sm:justify-between"',
    );
    expect(compositor).toContain(
      "<SeletorDeHorario ag={ag} disabled={inputsDisabled} t={tAgendadas} etiquetaEmLinhaPropria />",
    );
  });
});

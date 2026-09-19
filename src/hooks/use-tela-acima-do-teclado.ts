"use client";

import { useEffect } from "react";
import {
  ATRIBUTO_ACIMA_DO_TECLADO,
  MIDIA_DE_TOQUE,
  ajusteDoTeclado,
} from "@/lib/celular/teclado";

/**
 * Mantém a conversa acima do teclado do celular. As regras e o porquê estão
 * em `src/lib/celular/teclado.ts`.
 *
 * Escreve no `<html>` as duas variáveis que a casca do app lê:
 * `--altura-visivel` (a área acima do teclado — a caixa de entrada também a
 * lê, com queda em `100dvh`) e `--deslocamento-visivel` (onde a área visível
 * começa, contada do topo da página; a casca desce até lá e fica parada na
 * tela). Ao sair do ajuste, rola a janela de volta ao topo.
 *
 * ⚠️ O deslocamento é `visualViewport.pageTop`, NUNCA só o `offsetTop`: este
 * é contado da janela, e quando o iPhone revela a caixa ROLANDO a janela
 * (`window.scrollY > 0`) ele fica em zero — a casca ficaria acima da área
 * visível pela rolagem inteira, e o cabeçalho sumiria do mesmo jeito (Codex,
 * PR #219). Pelo mesmo motivo o hook relê na rolagem da JANELA, que não
 * dispara o `scroll` do `visualViewport`.
 *
 * ⚠️ NÃO lê `window.innerHeight`: a primeira versão comparava a área visível
 * com ela para decidir se o teclado estava aberto, e no iPhone do operador o
 * ajuste nunca ligou (print de 15/09/2026). Há pino em `teclado.test.ts`.
 *
 * ⚠️ Lê dentro do `requestAnimationFrame`: no `focusout` o foco ainda não
 * chegou ao próximo campo, e ler ali diria "foco fora da conversa" no meio de
 * uma simples troca de campo. O quadro também junta os eventos que chegam
 * juntos (o teclado abre com `focusin`, `resize` e `scroll` em sequência).
 */
export function useTelaAcimaDoTeclado() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;
    const toque = window.matchMedia(MIDIA_DE_TOQUE);
    let ajustada = false;
    let quadro = 0;

    const escrever = (variavel: string, px: number | null) => {
      if (px === null) raiz.style.removeProperty(variavel);
      else raiz.style.setProperty(variavel, `${px}px`);
    };

    const ler = () => {
      const foco = document.activeElement;
      const ajuste = ajusteDoTeclado(
        {
          alturaVisivel: vv.height,
          deslocamentoVisivel: vv.pageTop,
          escala: vv.scale,
          toque: toque.matches,
          focoNaArea:
            foco instanceof Element &&
            foco.closest(`[${ATRIBUTO_ACIMA_DO_TECLADO}]`) !== null,
        },
        ajustada,
      );
      ajustada = ajuste.ajustada;

      escrever("--altura-visivel", ajuste.altura);
      escrever("--deslocamento-visivel", ajuste.deslocamento);
      if (
        ajuste.desfazerEmpurrao &&
        (window.scrollY !== 0 || vv.offsetTop !== 0)
      ) {
        window.scrollTo(0, 0);
      }
    };

    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(ler);
    };

    vv.addEventListener("resize", agendar);
    vv.addEventListener("scroll", agendar);
    window.addEventListener("scroll", agendar, { passive: true });
    document.addEventListener("focusin", agendar);
    document.addEventListener("focusout", agendar);
    return () => {
      vv.removeEventListener("resize", agendar);
      vv.removeEventListener("scroll", agendar);
      window.removeEventListener("scroll", agendar);
      document.removeEventListener("focusin", agendar);
      document.removeEventListener("focusout", agendar);
      cancelAnimationFrame(quadro);
      raiz.style.removeProperty("--altura-visivel");
      raiz.style.removeProperty("--deslocamento-visivel");
    };
  }, []);
}

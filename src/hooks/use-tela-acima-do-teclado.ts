"use client";

import { useEffect } from "react";
import {
  ATRIBUTO_ACIMA_DO_TECLADO,
  ajusteDoTeclado,
} from "@/lib/celular/teclado";

/**
 * Mantém a conversa acima do teclado do celular. As regras e o porquê estão
 * em `src/lib/celular/teclado.ts`.
 *
 * Escreve `--altura-visivel` no `<html>` — a casca do app e a caixa de
 * entrada medem a altura por ela, com queda em `100dvh` — e rola a janela de
 * volta ao topo quando o iPhone a empurrou.
 *
 * ⚠️ Lê dentro do `requestAnimationFrame`: no `focusout` o foco ainda não
 * chegou ao próximo campo, e ler ali diria "foco fora da conversa" no meio de
 * uma simples troca de campo. O quadro também junta os eventos que chegam
 * juntos (o teclado abre com `focusin`, `resize` e `scroll` em sequência).
 *
 * No computador a área visível é a janela inteira: a regra nunca ajusta nada.
 */
export function useTelaAcimaDoTeclado() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;
    let ajustada = false;
    let quadro = 0;

    const ler = () => {
      const foco = document.activeElement;
      const ajuste = ajusteDoTeclado(
        {
          alturaVisivel: vv.height,
          escala: vv.scale,
          alturaDaJanela: window.innerHeight,
          focoNaArea:
            foco instanceof Element &&
            foco.closest(`[${ATRIBUTO_ACIMA_DO_TECLADO}]`) !== null,
        },
        ajustada,
      );
      ajustada = ajuste.ajustada;

      if (ajuste.altura === null) {
        raiz.style.removeProperty("--altura-visivel");
      } else {
        raiz.style.setProperty("--altura-visivel", `${ajuste.altura}px`);
      }
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
    document.addEventListener("focusin", agendar);
    document.addEventListener("focusout", agendar);
    return () => {
      vv.removeEventListener("resize", agendar);
      vv.removeEventListener("scroll", agendar);
      document.removeEventListener("focusin", agendar);
      document.removeEventListener("focusout", agendar);
      cancelAnimationFrame(quadro);
      raiz.style.removeProperty("--altura-visivel");
    };
  }, []);
}

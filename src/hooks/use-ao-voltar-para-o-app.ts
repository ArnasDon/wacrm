"use client";

import { useEffect, useRef } from "react";
import { voltouDepoisDeAusencia } from "@/lib/celular/ao-voltar";

/**
 * Recarrega a tela quando a pessoa VOLTA para o app depois de um tempo fora.
 * O porquê está em `src/lib/celular/ao-voltar.ts`.
 *
 * ⚠️ O `recarregar` passado aqui precisa ser SILENCIOSO: manter o que está na
 * tela até a resposta chegar. Um recarregar que liga o "carregando" troca a
 * lista pelo spinner toda vez que a pessoa volta do WhatsApp — e, no quadro
 * do funil, desmontaria as colunas e perderia a rolagem.
 *
 * A função mais recente é lida por ref: quem chama pode passar uma função
 * nova a cada render sem re-assinar o evento.
 */
export function useAoVoltarParaOApp(recarregar: () => void) {
  const recarregarRef = useRef(recarregar);
  useEffect(() => {
    recarregarRef.current = recarregar;
  });

  useEffect(() => {
    let saiuEm: number | null =
      document.visibilityState === "hidden" ? Date.now() : null;

    const aoMudar = () => {
      if (document.visibilityState === "hidden") {
        saiuEm = Date.now();
        return;
      }
      if (voltouDepoisDeAusencia(saiuEm, Date.now())) {
        recarregarRef.current();
      }
      saiuEm = null;
    };

    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, []);
}

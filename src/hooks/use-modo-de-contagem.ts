"use client";

import { useState } from "react";

import { CHAVE_DO_MODO, lerModo, MODO_PADRAO, type ModoDeContagem } from "@/lib/funil/por-periodo";

/**
 * Preferência por dispositivo, lida no INICIALIZADOR do estado. Isso só é
 * seguro porque a página nunca chega ao HTML do servidor: a casca
 * (`dashboard-shell.tsx`) devolve o spinner enquanto `loading`/
 * `profileLoading` — que nascem `true` — não resolvem no cliente, e as vistas
 * do funil montam depois disso, com `window` presente. É o mesmo padrão das
 * colunas da Lista (`lista-de-leads.tsx`). Se um dia a casca deixar a página
 * no HTML do servidor, isto vira hydration mismatch (Codex, PR #224): a
 * saída é `useSyncExternalStore` com `getServerSnapshot` devolvendo o padrão.
 */
function lerModoGravado(): ModoDeContagem {
  if (typeof window === "undefined") return MODO_PADRAO;
  try {
    return lerModo(window.localStorage.getItem(CHAVE_DO_MODO));
  } catch {
    return MODO_PADRAO;
  }
}

/**
 * Como o Desempenho e a Saúde contam: por período (o padrão) ou por mês de
 * entrada. Cada vista chama o hook por conta própria — elas não convivem na
 * tela (a página monta uma por vez), então a que abre lê o que a outra gravou
 * e as duas seguem a mesma escolha sem estado compartilhado.
 */
export function useModoDeContagem(): [ModoDeContagem, (modo: ModoDeContagem) => void] {
  const [modo, setModo] = useState<ModoDeContagem>(lerModoGravado);
  const mudar = (proximo: ModoDeContagem) => {
    setModo(proximo);
    try {
      window.localStorage.setItem(CHAVE_DO_MODO, proximo);
    } catch {
      // preferência por dispositivo: sem storage, vale até esta vista
      // desmontar — a outra vista lê o storage ao montar e cai no padrão
    }
  };
  return [modo, mudar];
}

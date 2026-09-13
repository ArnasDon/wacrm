"use client";

// ============================================================
// Quem está INADIMPLENTE — a resposta em LOTE para a caixa de entrada.
//
// Montado UMA vez na página do inbox (que é irmã da lista, do fio e do
// painel) e repassado por prop aos três. Ver a rota `/api/cb/asaas/resumo`.
//
// ⚠️ `null` enquanto não carregou ou quando a carga FALHOU — nunca `{}`: os
// dois significam coisas diferentes na tela. Com `null` nada afirma "em
// dia": a faixa cala, o ícone não aparece, o filtro é neutralizado. É a
// mesma régua do `useSinalDeExecucoes` (985) e a armadilha do
// vazio-como-afirmação que este projeto documenta cinco vezes.
//
// Recarrega no `resyncToken` da página, no evento global `cb:asaas-mudou`
// (ligar, desligar ou sincronizar numa outra árvore — o cartão de
// Configurações, a aba do painel) e a cada 5 minutos com a aba visível.
// ============================================================

import { useCallback, useEffect, useState } from "react";

import { EVENTO_ASAAS_MUDOU } from "@/lib/asaas/aviso";
import { lerRespostaDoResumo, type RespostaDoResumo } from "@/lib/asaas/aviso-na-conversa";

/** De quanto em quanto tempo a caixa relê a inadimplência com a aba visível. */
export const RECARGA_MS = 5 * 60_000;

export function useInadimplencia(resyncToken: number = 0): { resumo: RespostaDoResumo | null; recarregar: () => void } {
  const [resumo, setResumo] = useState<RespostaDoResumo | null>(null);
  const [nonce, setNonce] = useState(0);

  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const aoMudar = () => setNonce((n) => n + 1);
    window.addEventListener(EVENTO_ASAAS_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_ASAAS_MUDOU, aoMudar);
  }, []);

  // O relógio da recarga só anda com a aba visível: a caixa fica aberta o
  // expediente inteiro, e uma leitura de 100 KB a cada 5 min em aba
  // escondida seria tráfego para ninguém.
  useEffect(() => {
    const tique = setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, RECARGA_MS);
    return () => clearInterval(tique);
  }, []);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const res = await fetch("/api/cb/asaas/resumo", { cache: "no-store" }).catch(() => null);
      if (cancelado) return;
      if (!res?.ok) {
        // Rede ou 500: continua "não sei" — e se JÁ tinha uma resposta, ela
        // fica: número velho com a marca de "de quando" é melhor do que sumir
        // com o aviso de quem deve. ⚠️ O `leituraFresca` retido NÃO vale
        // para sempre: quem consome deriva a frescura pelo relógio
        // (`leituraAindaFresca`), senão meia hora de falhas deixaria a
        // faixa afirmando dado velho sem o "dados do Asaas de …".
        return;
      }
      const json = await res.json().catch(() => null);
      if (cancelado) return;
      const lido = lerRespostaDoResumo(json);
      if (lido) setResumo(lido);
    })();
    return () => {
      cancelado = true;
    };
  }, [nonce, resyncToken]);

  return { resumo, recarregar };
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { EVENTO_ASAAS_MUDOU } from "@/lib/asaas/aviso";
import { lerRespostaDoContato, type RespostaDoContato } from "@/lib/asaas/aviso-na-conversa";

/**
 * As cobranças de UM contato (a aba Cobranças do painel e da ficha) — a rota
 * `/api/cb/asaas/contato/[contactId]`.
 *
 * ⚠️ Guarda `{ de, dados }` e DERIVA `carregando` de `de !== contactId`: o
 * painel da conversa não remonta ao trocar de cliente — a instância fica, só
 * a prop muda —, então entre a troca e a resposta existe um render com o
 * contato NOVO e os dados do ANTERIOR. Guardar os dados sozinhos e "limpar
 * num efeito" deixa esse render passar (efeito é passivo): mostraria a
 * dívida de um cliente na conversa de outro. É a guarda dos campos
 * personalizados (`{ de, mapa }`) e das reuniões transcritas.
 */
export function useCobrancasDoContato(contactId: string | null | undefined): {
  dados: RespostaDoContato | null;
  carregando: boolean;
  falhou: boolean;
  /**
   * O Asaas está conectado nesta CONTA? `null` = ainda não se sabe. É da
   * conta, não do contato, então SOBREVIVE à troca de contato — é o que
   * deixa a aba Cobranças sumir de vez numa conta sem Asaas, em vez de
   * piscar (aparecer no `carregando` e sumir na resposta) a cada cliente.
   */
  conectado: boolean | null;
  recarregar: () => void;
} {
  const [estado, setEstado] = useState<{ de: string | null; dados: RespostaDoContato | null; falhou: boolean }>({ de: null, dados: null, falhou: false });
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const aoMudar = () => setNonce((n) => n + 1);
    window.addEventListener(EVENTO_ASAAS_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_ASAAS_MUDOU, aoMudar);
  }, []);

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void (async () => {
      const res = await fetch(`/api/cb/asaas/contato/${contactId}`, { cache: "no-store" }).catch(() => null);
      if (!vivo) return;
      if (!res?.ok) {
        setEstado({ de: contactId, dados: null, falhou: true });
        return;
      }
      const json = await res.json().catch(() => null);
      if (!vivo) return;
      const lido = lerRespostaDoContato(json);
      setEstado({ de: contactId, dados: lido, falhou: lido === null });
      if (lido) setConectado(lido.conectado);
    })();
    return () => {
      vivo = false;
    };
  }, [contactId, nonce]);

  const doContatoAtual = !!contactId && estado.de === contactId;
  return {
    dados: doContatoAtual ? estado.dados : null,
    carregando: !!contactId && !doContatoAtual,
    falhou: doContatoAtual && estado.falhou,
    conectado,
    recarregar,
  };
}

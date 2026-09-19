'use client';

// ============================================================
// A saúde das conexões, para o cabeçalho.
//
// Dois mecanismos, e cada um cobre o que o outro não vê:
//
//  · POLLING (30s) — o único que detecta MORTE SILENCIOSA. Servidor
//    Evolution fora do ar não emite evento nenhum; sem alguém perguntando,
//    a tela ficaria verde para sempre.
//  · REALTIME — o webhook `connection.update` já grava `cb_channels`, e a
//    tabela entrou na publicação na 909. Uma queda avisada pelo provedor
//    vira vermelho em menos de um segundo em vez de esperar o ciclo.
//
// Aba oculta não pede nada: o indicador só importa para quem está olhando.
// ============================================================

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { CbChannelKind } from '@/lib/cb-channels/repo';

export type HealthTone = 'ok' | 'warn' | 'down' | 'unknown';

export interface ChannelHealth {
  id: string;
  label: string;
  kind: CbChannelKind;
  phone: string | null;
  isDefault: boolean;
  tone: HealthTone;
  status: 'disconnected' | 'connecting' | 'connected';
  connectedAt: string | null;
  checkedAt: string | null;
  detail: string | null;
  webhookOk: boolean | null;
  /**
   * Nível 3 (1002): quanto a última mensagem levou do WhatsApp até aqui, em
   * segundos. `null` = nunca medido nesta conexão — "não sei", nunca zero.
   */
  atrasoSeg: number | null;
  /** Quando essa medição foi feita (ISO). */
  atrasoMedidoEm: string | null;
}

const POLL_MS = 30_000;
/** Depois de uma falha, espaça — servidor fora do ar não melhora em 30s. */
const BACKOFF_MAX_MS = 5 * 60_000;

export interface SaudeDosCanais {
  channels: ChannelHealth[];
  loading: boolean;
  /**
   * A última conferência não respondeu — erro de rede, 5xx, ou o
   * `{ unavailable: true }` da janela pré-migration.
   *
   * ⚠️ Existe porque lista vazia aqui tem DOIS significados: "nenhuma
   * conexão fora do ar" e "não consegui perguntar". Para o indicador do
   * cabeçalho os dois dão no mesmo (ele some), e por anos isso bastou —
   * mas o bloco "o que precisa ser corrigido" do Meu dia AFIRMA "tudo em
   * ordem" a partir desse zero, e afirmar isso sobre uma sonda que falhou
   * é o oposto do que aquele bloco existe para fazer (Codex, PR #202).
   */
  falhou: boolean;
  /** Confere agora — o "Atualizar" da aba /meu-dia. */
  recarregar: () => void;
}

export function useChannelHealth(): SaudeDosCanais {
  const [channels, setChannels] = useState<ChannelHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [falhou, setFalhou] = useState(false);
  /** Nome próprio do canal realtime desta instância — ver a nota no efeito. */
  const instancia = useId();
  const falhasRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivoRef = useRef(true);
  /** A primeira busca ignora a visibilidade da aba — ver `tick`. */
  const primeiraRef = useRef(true);

  const buscar = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/channels/health', { cache: 'no-store' });
      if (!res.ok) {
        falhasRef.current++;
        if (vivoRef.current) setFalhou(true);
        return;
      }
      const payload = await res.json();
      if (!vivoRef.current) return;
      falhasRef.current = 0;
      // `unavailable` é 200 com lista vazia (tabela ou coluna ausente): o
      // indicador some, e quem AFIRMA a partir do zero precisa saber que a
      // pergunta não foi respondida.
      setFalhou(payload.unavailable === true);
      setChannels((payload.channels ?? []) as ChannelHealth[]);
    } catch {
      // Silêncio deliberado para o INDICADOR, igual ao `use-channels`: conta
      // sem canais, deploy anterior à migration ou rede caindo devolvem lista
      // vazia, e lista vazia esconde o indicador. Nenhuma tela quebra por
      // isso — mas o sinalizador sobe, para quem afirma a partir do zero.
      falhasRef.current++;
      if (vivoRef.current) setFalhou(true);
    } finally {
      if (vivoRef.current) setLoading(false);
    }
  }, []);

  // Laço de polling. Reagenda a si mesmo em vez de usar setInterval: assim o
  // backoff funciona e duas respostas lentas não empilham requisições.
  useEffect(() => {
    vivoRef.current = true;

    const agendar = () => {
      const espera = Math.min(POLL_MS * 2 ** falhasRef.current, BACKOFF_MAX_MS);
      timerRef.current = setTimeout(tick, espera);
    };
    const tick = async () => {
      // ⚠️ A PRIMEIRA busca sempre roda, mesmo com a aba oculta. Abrir o CRM
      // em nova aba em segundo plano — coisa de todo dia — entrega
      // `visibilityState: 'hidden'` no primeiro render; pular aqui deixava o
      // indicador vazio até alguém focar a aba, e sem nunca sair do estado de
      // carregamento (o `setLoading(false)` mora dentro de `buscar`).
      // Só o POLLING seguinte é que respeita a aba oculta.
      if (primeiraRef.current || document.visibilityState === 'visible') {
        primeiraRef.current = false;
        await buscar();
      }
      if (vivoRef.current) agendar();
    };

    void tick();

    // Voltar para a aba é o momento em que o dado velho mais engana — o
    // operador olha o indicador justamente aí.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void buscar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);

    return () => {
      vivoRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [buscar]);

  // Realtime: o webhook grava `cb_channels` e nós refazemos a sonda. Não
  // aplicamos o payload direto de propósito — ele traz `status` cru, e a cor
  // depende também do frescor, que só a rota sabe compor.
  //
  // ⚠️⚠️ O nome do canal leva o `useId()`, NUNCA um literal fixo. O
  // supabase-js guarda os canais por NOME: com duas instâncias deste hook
  // vivas ao mesmo tempo — o indicador do cabeçalho e a aba /meu-dia — a
  // segunda reencontra o canal que a primeira já assinou e estoura
  // "cannot add 'postgres_changes' callbacks for realtime:… after
  // 'subscribe()'", derrubando a PÁGINA inteira para o error boundary.
  // Medido no preview em 13/09/2026, na primeira abertura da aba; nenhum
  // teste pega (não há render aqui), e o hook funcionou por meses porque só
  // existia um consumidor. É o mesmo `useId()` de `use-reunioes.ts`.
  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`cb-channels-health:${instancia}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cb_channels' },
        () => {
          if (document.visibilityState === 'visible') void buscar();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [buscar, instancia]);

  return { channels, loading, falhou, recarregar: buscar };
}

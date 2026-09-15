'use client';

// ============================================================
// Os canais de WhatsApp da conta, para o browser.
//
// Antes disto o mesmo `fetch('/api/cb/channels')` estava copiado em quatro
// telas (lista de conversas, thread, gestor de modelos, visão geral de
// ajustes) e a Fase F ia levar isso para uma dúzia. Cada cópia repetia o
// mesmo cuidado — flag de cancelamento e catch mudo — e cada nova cópia
// era uma chance de esquecer um dos dois.
//
// O contrato de erro tem DUAS metades, e a diferença é o achado #06:
//
//  - `channels: []` continua sendo o comportamento de sempre no erro: toda
//    tela que usa a lista para rótulo/filtro esconde o seletor e se comporta
//    como no mundo de um número só. Vazio-durante-a-falha é cosmético ali.
//  - `falhou` existe para o consumidor que converte a lista numa AFIRMAÇÃO
//    (a janela de 24h do fio, o "sem conexão" do diálogo de nova conversa,
//    o recorte de privacidade do Radar). Para esses, "não consegui
//    perguntar" e "a conta não tem canal" são respostas OPOSTAS — e antes
//    deste campo elas eram byte por byte o mesmo estado.
//
// ⚠️ A rota devolve 200 com `{ channels: [], unavailable: true }` quando o
// banco falha (o ramo pré-migration). Isso É falha para o consumidor grave —
// jogá-la fora reabriria o caminho 200-com-erro do achado #06.
//
// O cache de módulo existe pelo M14: a carga do inbox monta 3 consumidores
// (lista, fio, faixa de agendadas) e cada um disparava o MESMO GET. Um vôo
// compartilhado + validade curta colapsam a rajada sem deixar a lista
// envelhecer numa navegação Settings → inbox (conectou canal novo, voltou).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CbChannel } from '@/lib/cb-channels/repo';

export interface UseChannelsResult {
  channels: CbChannel[];
  /** `true` até a primeira resposta chegar (ou falhar). */
  loading: boolean;
  /**
   * `true` quando a última tentativa NÃO trouxe uma lista confiável (rede,
   * não-200, ou o `unavailable: true` que a rota devolve com 200). Quem só
   * usa a lista para rótulo pode ignorar; quem AFIRMA algo a partir do vazio
   * precisa conferir isto antes (#06).
   */
  falhou: boolean;
  /** Busca de novo, ignorando o cache — a saída do "tentar de novo" (#08). */
  recarregar: () => Promise<void>;
  /**
   * Busca de novo SEM trocar uma lista boa por uma falha — para a volta ao
   * app (`useAoVoltarParaOApp`), onde a lista só dá nome às conexões. O
   * celular volta ao app antes da rede: com o `recarregar`, a falha apagava
   * os nomes da tela até a volta seguinte. Resposta boa entra; a que falha é
   * descartada. Quem precisa SABER da falha usa `recarregar`.
   */
  recarregarEmSilencio: () => Promise<void>;
}

interface Resultado {
  channels: CbChannel[];
  falhou: boolean;
}

/**
 * Traduz a resposta da rota no resultado do hook. Pura e exportada para o
 * teste fixar as três formas de falha (não-200, `unavailable`, corpo torto).
 */
export function resultadoDaResposta(ok: boolean, payload: unknown): Resultado {
  if (!ok) return { channels: [], falhou: true };
  const corpo = payload as { channels?: unknown; unavailable?: unknown } | null;
  if (corpo?.unavailable === true) return { channels: [], falhou: true };
  if (!Array.isArray(corpo?.channels)) return { channels: [], falhou: true };
  return { channels: corpo.channels as CbChannel[], falhou: false };
}

// ---- cache de módulo (M14) --------------------------------------------
// Só o browser escreve aqui (o fetch vive em efeito/callback), então não há
// estado compartilhado entre usuários no SSR.

/** Curto de propósito: colapsa a rajada da montagem do inbox e nada mais. */
const VALIDADE_MS = 15_000;

let cache: { em: number; resultado: Resultado } | null = null;
let emVoo: Promise<Resultado> | null = null;
/** Sobe a cada invalidação: resposta de uma geração anterior não escreve o cache. */
let geracao = 0;

/**
 * Esvazia o cache — para quem acabou de MUDAR um canal.
 *
 * ⚠️ O painel de Conexões não passa por este hook (tem o fetch próprio), então
 * sem isto conectar/apagar/trocar o padrão e voltar ao inbox dentro dos 15s
 * servia a lista de ANTES da mudança: o fio resolvia o canal apagado e o Radar
 * seguia mostrando análise de canal cujo `radar_enabled` acabou de ser
 * desligado (achado do Codex no PR #96). O `load()` do painel chama isto a
 * cada recarga — que é exatamente depois de cada escrita.
 *
 * ⚠️ Invalidar é TRÊS coisas, não uma. Zerar só o `cache` deixava o voo
 * antigo de pé: uma busca iniciada ANTES da mutação e resolvida DEPOIS
 * repovoava o cache com a lista velha, e quem montasse em seguida ainda
 * recebia a promessa antiga por `emVoo` (Codex no PR #104). Daí a geração —
 * a resposta só escreve se ninguém invalidou no meio — e o `emVoo` solto,
 * para a próxima montagem buscar de novo.
 */
export function invalidarCacheDeCanais(): void {
  geracao += 1;
  cache = null;
  emVoo = null;
}

async function buscar(): Promise<Resultado> {
  try {
    const res = await fetch('/api/cb/channels');
    const payload = res.ok ? await res.json().catch(() => null) : null;
    return resultadoDaResposta(res.ok, payload);
  } catch {
    return { channels: [], falhou: true };
  }
}

/** Exportada só para o teste da geração; o hook é o único chamador de verdade. */
export function obterCanais(forcar: boolean): Promise<Resultado> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_MS) {
    return Promise.resolve(cache.resultado);
  }
  if (!emVoo) {
    const minha = geracao;
    const promessa: Promise<Resultado> = buscar().then((r) => {
      // Falha NÃO entra no cache: a próxima montagem tenta de novo em vez
      // de repetir "falhou" por 15s a quem acabou de abrir a tela. E resposta
      // de geração ANTERIOR também não — ver `invalidarCacheDeCanais`.
      if (!r.falhou && minha === geracao) cache = { em: Date.now(), resultado: r };
      // Só solta o voo se ainda for o SEU: uma invalidação pode já ter posto
      // outro no lugar, e zerá-lo faria a montagem seguinte buscar de novo.
      if (emVoo === promessa) emVoo = null;
      return r;
    });
    emVoo = promessa;
  }
  return emVoo;
}

export function useChannels(): UseChannelsResult {
  // Nasce nulo SEMPRE (mesmo com cache quente): o initializer roda também na
  // hidratação, e um valor que o servidor não tinha divergiria do HTML.
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    // Cache quente resolve num microtask — o `loading` inicial não chega a
    // pintar, e o setState fica assíncrono (regra do React Compiler).
    void obterCanais(false).then((r) => {
      if (montadoRef.current) setResultado(r);
    });
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    const r = await obterCanais(true);
    if (montadoRef.current) setResultado(r);
  }, []);

  // A falha é descartada, e só aqui: para quem usa a lista como rótulo, a
  // lista boa na tela vale mais que a afirmação "não consegui perguntar".
  const recarregarEmSilencio = useCallback(async () => {
    const r = await obterCanais(true);
    if (montadoRef.current && !r.falhou) setResultado(r);
  }, []);

  return {
    channels: resultado?.channels ?? SEM_CANAIS,
    loading: resultado === null,
    falhou: resultado?.falhou ?? false,
    recarregar,
    recarregarEmSilencio,
  };
}

// Identidade estável para o estado "ainda não carregou" — cada render
// devolvendo um `[]` novo re-renderizaria os memos de todo consumidor.
const SEM_CANAIS: CbChannel[] = [];

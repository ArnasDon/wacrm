"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buscarPorChave, PAGINA } from "@/lib/supabase/paginar";
import type { Conversation } from "@/types";

/**
 * O mapa `{id: unread_count}` da carga, com os eventos de tempo real que
 * chegaram DURANTE ela aplicados por cima (`null` = conversa apagada).
 *
 * ⚠️ Um evento que chega enquanto as páginas carregam é mais novo que a foto
 * de alguma delas. Publicar só o mapa da carga o atropelava: a conversa lida
 * no meio continuava contada até o próximo evento DELA, que pode não vir
 * nunca (Codex, PR #247).
 */
export function mapaDaCarga(
  linhas: { id: string; unread_count: number | null }[],
  duranteACarga: ReadonlyMap<string, number | null>,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) mapa.set(l.id, l.unread_count ?? 0);
  for (const [id, n] of duranteACarga) {
    if (n === null) mapa.delete(id);
    else mapa.set(id, n);
  }
  return mapa;
}

/** Quantas conversas passam de zero — o número do menu. */
export function contarNaoLidas(mapa: ReadonlyMap<string, number>): number {
  let n = 0;
  for (const v of mapa.values()) if (v > 0) n += 1;
  return n;
}

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    // Os eventos que chegam enquanto a carga não terminou — ver `mapaDaCarga`.
    let carregando = true;
    const duranteACarga = new Map<string, number | null>();

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    //
    // Grupo fica FORA deste contador (ver 906_cb_grupos). O badge significa
    // "tem cliente esperando resposta"; um grupo ativo o deixaria aceso o dia
    // inteiro e ele pararia de significar qualquer coisa. Grupo mostra o
    // próprio contador na linha dele, dentro da lista.
    (async () => {
      // ⚠️⚠️ PAGINADA desde 19/09/2026, e aqui o corte de 1000 do PostgREST
      // era PIOR que na lista do inbox: sem `order`, ele escolhe as linhas
      // ARBITRARIAMENTE (seq scan), então a conversa com não lidas podia
      // simplesmente não vir — o badge do menu subcontava sem erro nenhum.
      // `null` = não dá para confiar: o contador fica como está em vez de
      // afirmar um número menor.
      // ⚠️⚠️ POR CHAVE, não por OFFSET (Codex, PR #247): o recorte abaixo muda
      // a cada conversa lida, e por OFFSET a linha que sai da 1ª página
      // empurra uma não lida para fora da 2ª — ela nunca era contada. Ver
      // `buscarPorChave`.
      const { linhas } = await buscarPorChave<{
        id: string;
        unread_count: number;
      }>(async (depoisDe) => {
        let consulta = supabase
          .from("conversations")
          .select("id, unread_count")
          .is("group_id", null)
          // Só quem TEM não lida: o total é "quantas passam de zero", e o
          // tempo real acrescenta ao mapa qualquer conversa que mudar depois.
          // Sem o filtro, o menu de TODA tela baixava a conta inteira (1.400+
          // conversas, e crescendo) para contar meia dúzia.
          .gt("unread_count", 0);
        if (depoisDe) consulta = consulta.gt("id", depoisDe);
        const { data, error } = await consulta
          .order("id", { ascending: true })
          .limit(PAGINA);
        return {
          data: (data ?? null) as { id: string; unread_count: number }[] | null,
          error,
        };
      });
      if (cancelled) return;
      carregando = false;
      if (!linhas) return;

      const map = mapaDaCarga(linhas, duranteACarga);
      countsRef.current = map;
      setTotal(contarNaoLidas(map));
    })();

    const channel = supabase
      .channel("total-unread-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) {
              map.delete(oldRow.id);
              if (carregando) duranteACarga.set(oldRow.id, null);
            }
          } else {
            const row = payload.new as Conversation;
            // O filtro do `select` acima não alcança o tempo real: sem esta
            // linha, a primeira mensagem de qualquer grupo entraria no mapa
            // pelo evento e acenderia o badge assim mesmo.
            if (row.group_id) return;
            map.set(row.id, row.unread_count ?? 0);
            if (carregando) duranteACarga.set(row.id, row.unread_count ?? 0);
          }
          // Recompute — cheap, conversations per user stay small.
          setTotal(contarNaoLidas(map));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return total;
}

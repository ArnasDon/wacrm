"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buscarPaginado } from "@/lib/supabase/paginar";
import type { Conversation } from "@/types";

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
      const { linhas } = await buscarPaginado<{
        id: string;
        unread_count: number;
      }>(async (de, ate) => {
        const { data, error, count } = await supabase
          .from("conversations")
          .select("id, unread_count", { count: "exact" })
          .is("group_id", null)
          // Só quem TEM não lida: o total é "quantas passam de zero", e o
          // tempo real acrescenta ao mapa qualquer conversa que mudar depois.
          // Sem o filtro, o menu de TODA tela baixava a conta inteira (1.400+
          // conversas, e crescendo) para contar meia dúzia.
          .gt("unread_count", 0)
          .order("id", { ascending: true })
          .range(de, ate);
        return {
          data: (data ?? null) as { id: string; unread_count: number }[] | null,
          error,
          count,
        };
      });
      if (cancelled || !linhas) return;

      const map = new Map<string, number>();
      let sum = 0;
      for (const row of linhas) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
        if (n > 0) sum += 1;
      }
      countsRef.current = map;
      setTotal(sum);
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
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            // O filtro do `select` acima não alcança o tempo real: sem esta
            // linha, a primeira mensagem de qualquer grupo entraria no mapa
            // pelo evento e acenderia o badge assim mesmo.
            if (row.group_id) return;
            map.set(row.id, row.unread_count ?? 0);
          }
          // Recompute — cheap, conversations per user stay small.
          let sum = 0;
          for (const n of map.values()) if (n > 0) sum += 1;
          setTotal(sum);
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

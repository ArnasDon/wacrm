"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useVisibilidad } from "@/modulos/visibilidad/contexto";
import { contarNoLeidas } from "@/modulos/visibilidad/visibilidad";
import type { Conversation } from "@/types";

interface FilaNoLeidas {
  id: string;
  unread_count: number | null;
  assigned_agent_id?: string | null;
}

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Con el módulo de visibilidad encendido, solo cuenta las conversaciones
 * que el usuario puede ver (por eso guarda `assigned_agent_id`).
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const vis = useVisibilidad();
  // Mirror of the visible-relevant columns by id so INSERT/UPDATE/DELETE
  // events can adjust the total without refetching.
  const [filas, setFilas] = useState<Map<string, FilaNoLeidas>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, unread_count, assigned_agent_id");
      if (cancelled || error || !data) return;

      const map = new Map<string, FilaNoLeidas>();
      for (const row of data as FilaNoLeidas[]) map.set(row.id, row);
      // Merge sobre lo que ya llegó por realtime durante la carga.
      setFilas((prev) => new Map([...map, ...prev]));
    })();

    const channel = supabase
      .channel("total-unread-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            const id = oldRow.id;
            if (id) {
              setFilas((prev) => {
                const next = new Map(prev);
                next.delete(id);
                return next;
              });
            }
          } else {
            const row = payload.new as Conversation;
            setFilas((prev) =>
              new Map(prev).set(row.id, {
                id: row.id,
                unread_count: row.unread_count ?? 0,
                assigned_agent_id: row.assigned_agent_id ?? null,
              }),
            );
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return useMemo(() => contarNoLeidas([...filas.values()], vis), [filas, vis]);
}

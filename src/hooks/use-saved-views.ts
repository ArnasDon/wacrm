"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  ContactsViewConfig,
  SavedView,
  SavedViewResource,
} from "@/lib/saved-views/types";

/**
 * CRUD for saved list views of one `resource`, backed by
 * `/api/saved-views`. The server enforces ownership + tenancy; this
 * hook just keeps a local copy in sync and surfaces toasts on failure.
 */
export function useSavedViews(resource: SavedViewResource) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/saved-views?resource=${resource}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { saved_views: SavedView[] };
      setViews(json.saved_views ?? []);
    } catch {
      // A views bar that fails to load shouldn't block the page —
      // stay silent, the "Todos" tab still works.
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, config: ContactsViewConfig): Promise<SavedView | null> => {
      try {
        const res = await fetch("/api/saved-views", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resource, name, config }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? String(res.status));
        setViews((v) => [...v, json.saved_view]);
        return json.saved_view as SavedView;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar la vista");
        return null;
      }
    },
    [resource],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Partial<Pick<SavedView, "name" | "config" | "is_shared" | "position">>,
    ): Promise<boolean> => {
      try {
        const res = await fetch(`/api/saved-views/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? String(res.status));
        setViews((v) => v.map((x) => (x.id === id ? (json.saved_view as SavedView) : x)));
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo actualizar la vista");
        return false;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/saved-views/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setViews((v) => v.filter((x) => x.id !== id));
      return true;
    } catch {
      toast.error("No se pudo eliminar la vista");
      return false;
    }
  }, []);

  return { views, loading, refresh, create, update, remove };
}

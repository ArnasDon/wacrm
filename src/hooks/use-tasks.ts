'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { Task, TaskStatus } from '@/lib/tasks/types';

interface CreateInput {
  title: string;
  due_at?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  assigned_to?: string | null;
}

/**
 * Tasks for one contact, backed by `/api/tasks`. The server enforces
 * tenancy + the `agent` write gate; this hook keeps a local copy in
 * sync and toasts on failure.
 */
export function useTasks(contactId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!contactId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?contact_id=${contactId}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { tasks: Task[] };
      setTasks(json.tasks ?? []);
    } catch {
      // Non-blocking — the rest of the panel still works.
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateInput): Promise<Task | null> => {
      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contact_id: contactId, ...input }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? String(res.status));
        setTasks((t) => [json.task as Task, ...t]);
        return json.task as Task;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se pudo crear la tarea');
        return null;
      }
    },
    [contactId],
  );

  const patch = useCallback(
    async (id: string, body: Partial<Pick<Task, 'title' | 'notes' | 'due_at' | 'status' | 'assigned_to'>>) => {
      // Optimistic for the common toggle.
      setTasks((t) => t.map((x) => (x.id === id ? { ...x, ...body } : x)));
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? String(res.status));
        setTasks((t) => t.map((x) => (x.id === id ? (json.task as Task) : x)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se pudo actualizar la tarea');
        void refresh();
      }
    },
    [refresh],
  );

  const toggleDone = useCallback(
    (task: Task) => patch(task.id, { status: (task.status === 'done' ? 'open' : 'done') as TaskStatus }),
    [patch],
  );

  const remove = useCallback(async (id: string) => {
    setTasks((t) => t.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      toast.error('No se pudo eliminar la tarea');
      void refresh();
    }
  }, [refresh]);

  return { tasks, loading, refresh, create, patch, toggleDone, remove };
}

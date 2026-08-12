'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BrainCog, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCan } from '@/hooks/use-can';

interface MemoryRow {
  id: string;
  summary: string;
  source_last_message_at: string | null;
  expires_at: string | null;
  updated_at: string;
  contact: { id: string; name: string | null; phone: string | null } | null;
}

/**
 * Memória: read-only visibility + delete over wacrm.contact_memories —
 * deliberately does NOT let an admin edit categories or turn extraction
 * off. Structuring memory into fields (preferences/sizes/colours) would
 * mean changing the LLM extraction prompt in contact-memory.ts and its
 * schema; this tab only exposes what already exists.
 */
export function AgentMemory() {
  const canEdit = useCan('edit-settings');
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ai/memory', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar a memória.');
      setMemories((data.memories ?? []) as MemoryRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a memória.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/ai/memory/${id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível apagar esta memória.');
      setMemories((current) => (current ? current.filter((m) => m.id !== id) : current));
      toast.success('Memória apagada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível apagar esta memória.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <BrainCog className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Memória</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumos que o agente guarda sobre conversas fechadas ou inactivas, para se lembrar de
          contexto útil da próxima vez que o mesmo contacto escrever. Gerados e expirados
          automaticamente (365 dias) — aqui só podes ver e apagar, não editar categorias.
        </p>
      </div>

      {!memories || memories.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          Ainda não há memórias guardadas.
        </div>
      ) : (
        <div className="space-y-3">
          {memories.map((memory) => (
            <Card key={memory.id}>
              <CardContent className="flex items-start justify-between gap-4 pt-4">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {memory.contact?.name || memory.contact?.phone || 'Contacto desconhecido'}
                  </p>
                  <p className="text-sm text-muted-foreground">{memory.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    Actualizada em {new Date(memory.updated_at).toLocaleDateString('pt-PT')}
                    {memory.expires_at &&
                      ` · expira em ${new Date(memory.expires_at).toLocaleDateString('pt-PT')}`}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deletingId !== null}
                    onClick={() => void remove(memory.id)}
                    aria-label={`Apagar memória de ${memory.contact?.name || memory.contact?.phone || 'contacto desconhecido'}`}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    {deletingId === memory.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

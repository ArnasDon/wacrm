'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';

interface Visit {
  id: string;
  scheduled_at: string;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  contact: { id: string; name: string | null; phone: string } | null;
}

const STATUS_META: Record<
  Visit['status'],
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  scheduled: { label: 'Marcada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'outline' },
  cancelled: { label: 'Cancelada', variant: 'outline' },
  no_show: { label: 'Não compareceu', variant: 'destructive' },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('pt-PT', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function VisitsPage() {
  const canManage = useCan('edit-settings');
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/scheduled-visits', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as visitas.');
      setVisits(data.visits ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as visitas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: 'completed' | 'cancelled' | 'no_show') => {
    setActing(id);
    try {
      const response = await fetch(`/api/scheduled-visits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível actualizar a visita.');
      setVisits((current) =>
        current?.map((visit) => (visit.id === id ? { ...visit, status } : visit)) ?? null,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível actualizar a visita.');
    } finally {
      setActing(null);
    }
  };

  const upcoming = (visits ?? []).filter((visit) => visit.status === 'scheduled');
  const past = (visits ?? []).filter((visit) => visit.status !== 'scheduled');

  return (
    <div>
      <div className="flex items-center gap-2">
        <CalendarClock className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Visitas agendadas</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Visitas à loja marcadas pelo agente de IA (ferramenta &quot;Agendar visita&quot;) ou pela equipa.
      </p>

      {loading ? (
        <div className="mt-8 flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-medium text-foreground">
              Por vir ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Nenhuma visita marcada ainda.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Data e hora</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead>Estado</TableHead>
                    {canManage && <TableHead className="text-right">Acções</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcoming.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {visit.contact?.name || 'Sem nome'}
                        </p>
                        <p className="text-xs text-muted-foreground">{visit.contact?.phone}</p>
                      </TableCell>
                      <TableCell>{DATE_FORMATTER.format(new Date(visit.scheduled_at))}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {visit.notes || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_META[visit.status].variant}>
                          {STATUS_META[visit.status].label}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={acting === visit.id}
                              onClick={() => void setStatus(visit.id, 'completed')}
                            >
                              <Check className="h-3.5 w-3.5" /> Concluída
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={acting === visit.id}
                              onClick={() => void setStatus(visit.id, 'cancelled')}
                            >
                              <X className="h-3.5 w-3.5" /> Cancelar
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-foreground">Histórico</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Data e hora</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell>
                        <p className="text-foreground">{visit.contact?.name || 'Sem nome'}</p>
                        <p className="text-xs text-muted-foreground">{visit.contact?.phone}</p>
                      </TableCell>
                      <TableCell>{DATE_FORMATTER.format(new Date(visit.scheduled_at))}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_META[visit.status].variant}>
                          {STATUS_META[visit.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { HeartPulse, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { readResponseJson } from '@/lib/http/response-json';
import type { ChatToRead, GradedHealth, HealthStatus } from '@/lib/admin/weekly-health';

type Company = GradedHealth & { chats: ChatToRead[] };

const STATUS: Record<HealthStatus, { label: string; dot: string }> = {
  red: { label: 'Rojo', dot: 'bg-destructive' },
  yellow: { label: 'Amarillo', dot: 'bg-amber-500' },
  green: { label: 'Verde', dot: 'bg-emerald-500' },
};

const SENDER: Record<string, string> = { customer: 'Cliente', agent: 'Equipo', bot: 'Bot' };

export function WeeklyHealthPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/weekly-health', { cache: 'no-store' });
      const body = await readResponseJson<{ error?: string; companies: Company[] }>(response);
      if (!response.ok) throw new Error(body.error ?? 'No se pudo cargar la salud semanal');
      setCompanies(body.companies);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la salud semanal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card id="weekly-health" className="scroll-mt-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="size-5" /> Salud semanal
          </CardTitle>
          <CardDescription>
            Últimos 7 días por empresa, de peor a mejor. Cada lunes a las 7:10 a.m. llega este resumen por correo.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead className="text-right">Convers.</TableHead>
                <TableHead className="text-right">Mensajes (sem. ant.)</TableHead>
                <TableHead className="text-right">1ª respuesta</TableHead>
                <TableHead className="text-right">Esperando +2 h</TableHead>
                <TableHead className="text-right">Pases (sin atender)</TableHead>
                <TableHead className="text-right">Registros IA</TableHead>
                <TableHead className="text-right">Seguimientos</TableHead>
                <TableHead className="text-right">Tokens IA</TableHead>
                <TableHead>Revisar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.account_id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <span className={`mr-2 inline-block size-2.5 rounded-full ${STATUS[c.status].dot}`} title={STATUS[c.status].label} />
                    {c.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.conversations}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.inbound} <span className="text-muted-foreground">({c.inbound_prev})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.first_response_median_min == null ? '—' : `${c.first_response_median_min} min`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.waiting_over_2h}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.handoffs} <span className="text-muted-foreground">({c.handoffs_unattended})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.ai_records}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.followups_sent}
                    {c.followups_failed ? <span className="text-destructive"> / {c.followups_failed} fallidos</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.ai_tokens.toLocaleString('es-GT')}</TableCell>
                  <TableCell className="text-sm">
                    {c.reasons.length ? c.reasons.join(' · ') : <span className="text-muted-foreground">Todo en orden</span>}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-muted-foreground text-center">
                    No hay empresas activas.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        {companies.some((c) => c.chats.length) ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Chats para leer esta semana</h3>
            {companies.flatMap((c) =>
              c.chats.map((chat) => (
                <details key={chat.conversation_id} className="rounded-lg border px-4 py-3">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{c.name}</span> · {chat.contact_name ?? 'Sin nombre'} ·{' '}
                    <span className="text-muted-foreground">{chat.why}</span>
                  </summary>
                  <ol className="mt-3 space-y-2 text-sm">
                    {chat.messages.map((m, i) => (
                      <li key={i} className={m.sender_type === 'customer' ? '' : 'pl-6'}>
                        <span className="text-muted-foreground text-xs">
                          {m.ai_generated ? 'IA' : (SENDER[m.sender_type] ?? m.sender_type)} ·{' '}
                          {new Date(m.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        <p className="whitespace-pre-wrap">{m.text}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              )),
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

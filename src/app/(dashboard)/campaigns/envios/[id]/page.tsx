'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Play, Pause, Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Envio, EnvioLote, EnvioLead } from '@/types';
import { getLoteStatus, getEnvioLeadStatus } from '@/lib/envio-status';
import { isLote2Blocked } from '@/lib/envios/lote-engine';

const POLL_INTERVAL_MS = 5_000;

export default function EnvioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Envios.detail');
  const tStatus = useTranslations('Envios.status');
  const envioId = params.id as string;

  const [envio, setEnvio] = useState<Envio | null>(null);
  const [lotes, setLotes] = useState<EnvioLote[]>([]);
  const [leads, setLeads] = useState<EnvioLead[]>([]);
  const [selectedLote, setSelectedLote] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLote, setBusyLote] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchData() {
    try {
      const supabase = createClient();
      const { data: envioData, error: envioErr } = await supabase
        .from('envios')
        .select('*')
        .eq('id', envioId)
        .single();
      if (envioErr) throw envioErr;
      setEnvio(envioData);

      const { data: lotesData, error: lotesErr } = await supabase
        .from('envio_lotes')
        .select('*')
        .eq('envio_id', envioId)
        .order('numero_lote', { ascending: true });
      if (lotesErr) throw lotesErr;
      setLotes(lotesData ?? []);

      const currentLote = (lotesData ?? []).find((l) => l.numero_lote === selectedLote);
      if (currentLote) {
        const { data: leadsData, error: leadsErr } = await supabase
          .from('envio_leads')
          .select('*')
          .eq('lote_id', currentLote.id)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true });
        if (leadsErr) throw leadsErr;
        setLeads(leadsData ?? []);
      } else {
        setLeads([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envioId, selectedLote]);

  const anyActive = useMemo(() => lotes.some((l) => l.status === 'em_andamento'), [lotes]);

  useEffect(() => {
    if (anyActive) {
      if (!pollTimer.current) pollTimer.current = setInterval(fetchData, POLL_INTERVAL_MS);
    } else if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyActive]);

  async function callLoteAction(numeroLote: number, action: 'iniciar' | 'pausar') {
    setBusyLote(numeroLote);
    try {
      const res = await fetch(`/api/envios/${envioId}/lotes/${numeroLote}/${action}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t('actionFailed'));
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setBusyLote(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !envio) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/campaigns')}>
          {t('back')}
        </Button>
      </div>
    );
  }

  const lote1 = lotes.find((l) => l.numero_lote === 1);
  const lote2Blocked = isLote2Blocked(lote1?.status ?? 'aguardando');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => router.push('/campaigns')} className="border-border">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{envio.nome}</h1>
        </div>
      </div>

      {envio.mensagem_imagem_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={envio.mensagem_imagem_url}
          alt=""
          className="max-h-40 rounded-lg border border-border object-contain"
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {lotes.map((lote) => {
          const status = getLoteStatus(lote.status);
          const sentCount = lote.numero_lote === selectedLote
            ? leads.filter((l) => l.status === 'enviado').length
            : null;
          const blocked = lote.numero_lote === 2 && lote2Blocked;
          const canStart = (lote.status === 'aguardando' || lote.status === 'pausado') && !blocked;
          const canPause = lote.status === 'em_andamento';

          return (
            <div
              key={lote.id}
              onClick={() => setSelectedLote(lote.numero_lote)}
              className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                selectedLote === lote.numero_lote ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-foreground">{t('lote', { numero: lote.numero_lote })}</p>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}>
                  {status.pulse && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                    </span>
                  )}
                  {tStatus(status.label)}
                </span>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                {t('leadsCount', { count: lote.quantidade_leads })}
                {lote.iniciado_em && (
                  <> · {t('startedAt', { date: new Date(lote.iniciado_em).toLocaleString() })}</>
                )}
              </p>

              {sentCount !== null && lote.quantidade_leads > 0 && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.round((sentCount / lote.quantidade_leads) * 100)}%` }}
                  />
                </div>
              )}

              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                {lote.status === 'concluido' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-primary">
                    <Check className="h-3.5 w-3.5" /> {t('done')}
                  </span>
                ) : canPause ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyLote === lote.numero_lote}
                    onClick={() => callLoteAction(lote.numero_lote, 'pausar')}
                    className="border-border text-muted-foreground hover:bg-muted"
                  >
                    {busyLote === lote.numero_lote ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                    {t('pauseLote')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!canStart || busyLote === lote.numero_lote}
                    title={blocked ? t('blockedReason') : undefined}
                    onClick={() => callLoteAction(lote.numero_lote, 'iniciar')}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                  >
                    {busyLote === lote.numero_lote ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {lote.status === 'pausado' ? t('resumeLote') : t('startLote')}
                  </Button>
                )}
                {blocked && <p className="mt-1 text-[11px] text-muted-foreground">{t('blockedReason')}</p>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {t('leadsHeader', { numero: selectedLote, count: leads.length })}
          </h2>
        </div>
        {leads.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('noLeads')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t('table.name')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.phone')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.message')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.status')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.sentAt')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.error')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => {
                  const status = getEnvioLeadStatus(lead.status);
                  return (
                    <TableRow key={lead.id} className="border-border">
                      <TableCell className="font-medium text-foreground">{lead.nome ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{lead.telefone}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={lead.mensagem}>
                        {lead.mensagem}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}>
                          {tStatus(status.label)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lead.enviado_em ? new Date(lead.enviado_em).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {lead.erro ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

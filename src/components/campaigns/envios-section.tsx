'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MessageSquareText, Plus, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { GatedButton } from '@/components/ui/gated-button';
import { useCan } from '@/hooks/use-can';
import type { Envio, EnvioLote, EnvioLead } from '@/types';

const POLL_INTERVAL_MS = 5_000;

type LoteWithLeads = EnvioLote & { envio_leads: Pick<EnvioLead, 'status'>[] };
type EnvioWithLotes = Envio & { envio_lotes: LoteWithLeads[] };

function progressFor(envio: EnvioWithLotes) {
  const total = envio.envio_lotes.reduce((sum, l) => sum + l.quantidade_leads, 0);
  const sent = envio.envio_lotes.reduce(
    (sum, l) => sum + l.envio_leads.filter((lead) => lead.status === 'enviado').length,
    0,
  );
  const lotes = [...envio.envio_lotes].sort((a, b) => a.numero_lote - b.numero_lote);
  const active = lotes.find((l) => l.status === 'em_andamento');
  return { total, sent, lotes, active };
}

export function EnviosSection() {
  const router = useRouter();
  const t = useTranslations('Envios.section');
  const canCreate = useCan('send-messages');

  const [envios, setEnvios] = useState<EnvioWithLotes[]>([]);
  const [loading, setLoading] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchEnvios() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('envios')
        .select('*, envio_lotes(id, numero_lote, status, quantidade_leads, envio_leads(status))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setEnvios((data ?? []) as EnvioWithLotes[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEnvios();
  }, []);

  const anyActive = envios.some((e) => e.envio_lotes.some((l) => l.status === 'em_andamento'));

  useEffect(() => {
    if (anyActive) {
      if (!pollTimer.current) {
        pollTimer.current = setInterval(fetchEnvios, POLL_INTERVAL_MS);
      }
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
  }, [anyActive]);

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="criar envios"
          onClick={() => router.push('/campaigns/envios/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newEnvio')}
        </GatedButton>
      </div>

      {envios.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <MessageSquareText className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('noEnviosYet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {envios.map((envio) => {
            const { total, sent, active } = progressFor(envio);
            const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
            const summary =
              envio.status === 'concluido'
                ? t('summaryDone')
                : active
                  ? t('summaryActive', {
                      lote: active.numero_lote,
                      sent: active.envio_leads.filter((l) => l.status === 'enviado').length,
                      total: active.quantidade_leads,
                    })
                  : t('summaryDraft');

            return (
              <Card
                key={envio.id}
                onClick={() => router.push(`/campaigns/envios/${envio.id}`)}
                className="cursor-pointer border border-border ring-0 transition-colors hover:border-primary/30"
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                        <MessageSquareText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{envio.nome}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t('cardTotalLeads', { total })} · {t('cardLotes', { count: envio.envio_lotes.length })}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                      {t('channelBadge')}
                    </span>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{summary}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

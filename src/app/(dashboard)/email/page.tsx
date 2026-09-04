'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Plus, Send, Play, Pause, Ban } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { EmailNav } from '@/components/email/email-nav';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type { ListmonkCampaign } from '@/lib/listmonk/types';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

/** Poll while any campaign is mid-flight, same cadence as broadcasts. */
const POLL_INTERVAL_MS = 5_000;

const STATUS_CLASSES: Record<string, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  scheduled: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
  running: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
  paused: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  finished: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  cancelled: 'border-red-500/40 bg-red-500/10 text-red-400',
};

function percent(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

export default function EmailCampaignsPage() {
  return (
    <div className="space-y-6">
      <EmailHeader />
      <EmailNav />
      <ListmonkGate>{() => <CampaignsTable />}</ListmonkGate>
    </div>
  );
}

function EmailHeader() {
  const t = useTranslations('Email.page');
  return (
    <div>
      <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
    </div>
  );
}

function CampaignsTable() {
  const router = useRouter();
  const t = useTranslations('Email.page');
  const tStatus = useTranslations('Email.campaignStatus');
  const canSend = useCan('send-messages');
  const [campaigns, setCampaigns] = useState<ListmonkCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/email/campaigns');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const anyRunning = campaigns.some((c) => c.status === 'running');

  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(fetchCampaigns, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [anyRunning, fetchCampaigns]);

  async function changeStatus(
    id: number,
    status: 'running' | 'paused' | 'cancelled'
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/email/campaigns/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      toast.success(t('statusChanged', { status: tStatus(status) }));
      await fetchCampaigns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <GatedButton
          canAct={canSend}
          gateReason="create email campaigns"
          onClick={() => router.push('/email/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newCampaign')}
        </GatedButton>
      </div>

      {campaigns.length === 0 ? (
        <div className="border-border bg-card flex h-64 flex-col items-center justify-center rounded-xl border">
          <Send className="text-muted-foreground mb-3 h-10 w-10" />
          <p className="text-foreground text-sm font-medium">
            {t('noCampaigns')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('createFirst')}
          </p>
        </div>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">
                  {t('table.name')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden md:table-cell">
                  {t('table.lists')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden text-right sm:table-cell">
                  {t('table.sent')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  {t('table.opens')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  {t('table.clicks')}
                </TableHead>
                <TableHead className="text-muted-foreground">
                  {t('table.status')}
                </TableHead>
                <TableHead className="text-muted-foreground text-right">
                  {t('table.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow
                  key={c.id}
                  className="border-border hover:bg-muted/50"
                >
                  <TableCell className="text-foreground font-medium">
                    <div>{c.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {c.subject}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">
                    {c.lists.map((l) => l.name).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                    {c.sent}
                    {c.to_send > 0 && (
                      <span className="text-xs"> / {c.to_send}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden tabular-nums lg:table-cell">
                    {c.views}{' '}
                    <span className="text-xs">
                      ({percent(c.views, c.sent)}%)
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden tabular-nums lg:table-cell">
                    {c.clicks}{' '}
                    <span className="text-xs">
                      ({percent(c.clicks, c.sent)}%)
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                        STATUS_CLASSES[c.status] ?? STATUS_CLASSES.draft
                      }`}
                    >
                      {c.status === 'running' && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                        </span>
                      )}
                      {tStatus(c.status)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div
                      className="flex justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(c.status === 'draft' || c.status === 'paused') && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canSend || busyId === c.id}
                          onClick={() => changeStatus(c.id, 'running')}
                          title={t('actions.start')}
                        >
                          {busyId === c.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      {c.status === 'running' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canSend || busyId === c.id}
                            onClick={() => changeStatus(c.id, 'paused')}
                            title={t('actions.pause')}
                          >
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canSend || busyId === c.id}
                            onClick={() => changeStatus(c.id, 'cancelled')}
                            title={t('actions.cancel')}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

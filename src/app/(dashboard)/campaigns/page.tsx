'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Megaphone, Plus, Loader2, Play } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { EnviosSection } from '@/components/campaigns/envios-section';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

/**
 * Campaigns is Broadcasts renamed + evolved (migration 075) — same
 * `broadcasts` table, same send engine. This page is the old
 * /broadcasts list page.tsx moved under /campaigns, with the
 * vocabulary switched and a "resume sending" action added for
 * campaigns that were interrupted mid-send (section 7/5 of the spec).
 */

/**
 * Poll cadence while any campaign is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateStat({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  const pct = percent(value, total);
  return (
    <div className="rounded-lg bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const t = useTranslations('Campaigns.page');
  const tStatus = useTranslations('Campaigns.status');
  const canCreate = useCan('send-messages');
  const { startCampaignSending } = useBroadcastSending();
  const [campaigns, setCampaigns] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchCampaigns() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setCampaigns(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const anySending = useMemo(
    () => campaigns.some((c) => c.status === 'sending'),
    [campaigns],
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchCampaigns, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchCampaigns();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  async function handleResume(e: React.MouseEvent, campaignId: string) {
    e.stopPropagation();
    setResumingId(campaignId);
    try {
      await startCampaignSending(campaignId);
      toast.success(t('toastSendingResumed'));
      await fetchCampaigns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastResumeFailed'));
    } finally {
      setResumingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a campaign
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Campaign in progress"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-primary" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="criar campanhas"
          onClick={() => router.push('/campaigns/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newCampaign')}
        </GatedButton>
      </div>

      {campaigns.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <Megaphone className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t('noCampaignsYet')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('createFirst')}
          </p>
          <GatedButton
            canAct={canCreate}
            gateReason="criar campanhas"
            onClick={() => router.push('/campaigns/new')}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('newCampaign')}
          </GatedButton>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => {
            const status = getBroadcastStatus(campaign.status);
            const isExternal = campaign.send_channel === 'external';
            // 'external' campaigns are never dispatched from WACRM
            // (spec section 4/7) — no Start/Resume action for them.
            const canResume =
              !isExternal && (campaign.status === 'ready' || campaign.status === 'sending');
            const preview = isExternal ? campaign.message_text : campaign.template_name;
            return (
              <Card
                key={campaign.id}
                onClick={() => router.push(`/campaigns/${campaign.id}`)}
                className="cursor-pointer border border-border ring-0 transition-colors hover:border-primary/30"
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Megaphone className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{campaign.name}</p>
                        {campaign.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {campaign.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                        isExternal
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                          : 'border-primary/20 bg-primary/10 text-primary'
                      }`}
                    >
                      {isExternal ? t('channelExternal') : t('channelApi')}
                    </span>
                  </div>

                  {preview && (
                    <div className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
                      <p className="line-clamp-2">{preview}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/30 p-2">
                      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t('table.recipients')}
                      </p>
                      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {campaign.total_recipients}
                      </p>
                    </div>
                    <RateStat
                      label={t('table.delivery')}
                      value={campaign.delivered_count}
                      total={campaign.total_recipients}
                      color="bg-primary"
                    />
                    <RateStat
                      label={t('table.read')}
                      value={campaign.read_count}
                      total={campaign.total_recipients}
                      color="bg-blue-500"
                    />
                  </div>
                </CardContent>

                <CardFooter className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                    >
                      {status.pulse && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                        </span>
                      )}
                      {tStatus(status.label)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {new Date(campaign.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {canResume && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resumingId === campaign.id}
                      onClick={(e) => handleResume(e, campaign.id)}
                      className="shrink-0 border-border text-muted-foreground hover:bg-muted"
                    >
                      {resumingId === campaign.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {campaign.status === 'sending'
                        ? t('resumeSending')
                        : t('startSending')}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <EnviosSection />
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  Play,
  Ban,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
} from '@/lib/broadcast-status';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { useTranslations } from 'next-intl';

/**
 * Campaign detail — the old /broadcasts/[id]/page.tsx moved under
 * /campaigns (migration 075), with `description`, a Pending stat
 * card, and Start/Resume/Cancel actions added. Everything else
 * (stats, funnel, recipient table, CSV export, delete) already
 * covered sections 7/8 of the Campaigns spec as-is.
 */

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars.
 * Width is relative to the largest step (typically Sent) so we
 * always render a full bar at the top and proportional tails.
 */
function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">Funnel</h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfMax = Math.max(5, Math.round((step.value / max) * 100));
          const pctOfSent =
            steps[0].value > 0
              ? Math.round((step.value / steps[0].value) * 100)
              : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">
                {step.label}
              </span>
              <div className="relative h-7 flex-1 rounded-full bg-muted">
                <div
                  className={`h-7 rounded-full ${step.color} transition-[width] duration-500`}
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-foreground">
                  {step.value.toLocaleString()}
                  <span className="ml-2 text-muted-foreground/80">
                    ({pctOfSent}%)
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Campaigns.detail');
  const tStatus = useTranslations('Campaigns.status');
  const { startCampaignSending } = useBroadcastSending();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all',
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [sending, setSending] = useState(false);

  async function fetchData() {
    try {
      const supabase = createClient();

      const { data: bc, error: bcError } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (bcError) throw bcError;
      setCampaign(bc);

      const { data: recs, error: recsError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', campaignId)
        .order('created_at', { ascending: false });

      if (recsError) throw recsError;
      setRecipients(recs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  const pendingCount = useMemo(
    () => recipients.filter((r) => r.status === 'pending').length,
    [recipients],
  );

  function handleExport() {
    if (!campaign) return;
    const header = [
      t('table.contact'),
      t('table.phone'),
      t('table.status'),
      t('table.sent'),
      t('table.delivered'),
      t('table.read'),
      t('table.error'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = campaign.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`campaign-${safeName}-${campaignId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', campaignId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('toastFailedDelete', { error: delErr.message }));
      return;
    }
    toast.success(t('toastDeleted'));
    router.push('/campaigns');
  }

  async function handleStartOrResume() {
    setSending(true);
    try {
      await startCampaignSending(campaignId);
      toast.success(t('toastSendingStarted'));
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastSendFailed'));
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    const supabase = createClient();
    const { error: cancelErr } = await supabase
      .from('broadcasts')
      .update({ status: 'cancelled' })
      .eq('id', campaignId);
    setCancelling(false);
    setConfirmCancel(false);
    if (cancelErr) {
      toast.error(t('toastCancelFailed', { error: cancelErr.message }));
      return;
    }
    toast.success(t('toastCancelled'));
    await fetchData();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/campaigns')}>
          {t('backToBroadcasts')}
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(campaign.status);
  const isExternal = campaign.send_channel === 'external';
  // 'external' campaigns are never dispatched from WACRM (spec section
  // 4/7) — no Start/Resume button for them, ever, regardless of status.
  const canStartOrResume =
    !isExternal && (campaign.status === 'ready' || campaign.status === 'sending');
  const canCancel = campaign.status === 'draft' || campaign.status === 'ready';

  const funnelSteps: FunnelStep[] = [
    { label: t('stats.sent'), value: campaign.sent_count, color: 'bg-primary' },
    { label: t('stats.delivered'), value: campaign.delivered_count, color: 'bg-teal-500' },
    { label: t('stats.read'), value: campaign.read_count, color: 'bg-blue-500' },
    { label: t('stats.replied'), value: campaign.replied_count, color: 'bg-indigo-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/campaigns')}
            className="border-border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{campaign.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
              >
                {tStatus(status.label)}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                  isExternal
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                    : 'border-primary/20 bg-primary/10 text-primary'
                }`}
              >
                {isExternal ? t('channelExternal') : t('channelApi')}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                {isExternal
                  ? t('externalMessage')
                  : t('template', { name: campaign.template_name ?? '' })}
              </span>
              <span>-</span>
              <span>
                {t('createdAt', { date: new Date(campaign.created_at).toLocaleDateString() })}
              </span>
            </div>
            {campaign.description && (
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{campaign.description}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canStartOrResume && (
            <Button
              size="sm"
              disabled={sending}
              onClick={handleStartOrResume}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {campaign.status === 'sending' ? t('resumeSending') : t('startSending')}
            </Button>
          )}

          {canCancel &&
            (confirmCancel ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-sm">
                <span className="text-muted-foreground">{t('cancelPrompt')}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmCancel(false)}
                  disabled={cancelling}
                  className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted"
                >
                  {t('cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="h-7"
                  variant="outline"
                >
                  {t('confirm')}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmCancel(true)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                <Ban className="h-3.5 w-3.5" />
                {t('cancelCampaign')}
              </Button>
            ))}

          {/* Delete — inline-confirm pattern matches the pipeline-settings
              "Delete Pipeline" flow. Mid-send campaigns can't be deleted
              because orphaning in-flight Meta messages would leave the
              funnel inconsistent. */}
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
              <span className="text-red-300">{t('deletePrompt')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? t('deleting') : t('confirm')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={campaign.status === 'sending'}
              onClick={() => setConfirmDelete(true)}
              title={
                campaign.status === 'sending'
                  ? t('cannotDeleteSending')
                  : t('deleteHover')
              }
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('delete')}
            </Button>
          )}
        </div>
      </div>

      {/* Stats — 7 cards: Total / Pending / Sent / Delivered / Read / Replied / Failed */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatCard
          label={t('stats.totalRecipients')}
          value={campaign.total_recipients}
          total={campaign.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-muted text-muted-foreground"
        />
        <StatCard
          label={t('stats.pending')}
          value={pendingCount}
          total={campaign.total_recipients}
          icon={<Clock className="h-4 w-4" />}
          color="bg-slate-500/10 text-muted-foreground"
        />
        <StatCard
          label={t('stats.sent')}
          value={campaign.sent_count}
          total={campaign.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label={t('stats.delivered')}
          value={campaign.delivered_count}
          total={campaign.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
        <StatCard
          label={t('stats.read')}
          value={campaign.read_count}
          total={campaign.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label={t('stats.replied')}
          value={campaign.replied_count}
          total={campaign.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label={t('stats.failed')}
          value={campaign.failed_count}
          total={campaign.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      {isExternal && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">{t('externalPanelTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('externalPanelDesc')}</p>
          <div className="mt-3 rounded-lg border border-border bg-card/50 p-3">
            <p className="whitespace-pre-wrap text-sm text-foreground">{campaign.message_text}</p>
            {campaign.header_media_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={campaign.header_media_url}
                alt="Campaign"
                className="mt-2 max-h-32 rounded-lg border border-border object-contain"
              />
            )}
          </div>
        </div>
      )}

      <FunnelChart steps={funnelSteps} />

      {/* Recipients Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {statusFilter !== 'all'
              ? t('recipientsHeader', { filtered: filteredRecipients.length, total: recipients.length })
              : t('recipientsHeaderAll', { total: recipients.length })}
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-muted-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? t('allStatuses')
                  : tStatus(getRecipientStatus(statusFilter).label)}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-primary' : 'text-popover-foreground'
                  }
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    }
                  >
                    {tStatus(getRecipientStatus(s).label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              {t('exportCsv')}
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0
                ? t('noRecipients')
                : t('noRecipientsFilter')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t('table.contact')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.phone')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.status')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.sent')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.delivered')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.read')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.error')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="font-medium text-foreground">
                        {recipient.contact?.name ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.contact?.phone ?? '-'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {tStatus(rStatus.label)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {recipient.error_message ?? '-'}
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

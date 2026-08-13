'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { EmailCampaign, EmailCampaignRecipient, EmailRecipientStatus } from '@/types';
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
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  Filter,
  Download,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getEmailCampaignStatus,
  getEmailRecipientStatus,
} from '@/lib/email-campaign-status';
import { useTranslations } from 'next-intl';
import { toCsv, downloadCsv } from '@/lib/csv/export';

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

const RECIPIENT_STATUSES: readonly EmailRecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
];

export default function EmailCampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('EmailCampaigns.detail');
  const tStatus = useTranslations('EmailCampaigns.status');
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [recipients, setRecipients] = useState<EmailCampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EmailRecipientStatus | 'all'>(
    'all',
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const supabase = createClient();

        const { data: camp, error: campError } = await supabase
          .from('email_campaigns')
          .select('*')
          .eq('id', campaignId)
          .single();

        if (campError) throw campError;
        setCampaign(camp);

        const { data: recs, error: recsError } = await supabase
          .from('email_campaign_recipients')
          .select('*, contact:contacts(*)')
          .eq('email_campaign_id', campaignId)
          .order('created_at', { ascending: false });

        if (recsError) throw recsError;
        setRecipients(recs ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('notFound'));
      } finally {
        setLoading(false);
      }
    }

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

  function handleExport() {
    if (!campaign) return;
    const header = [
      t('table.contact'),
      t('table.email'),
      t('table.status'),
      t('table.sent'),
      t('table.delivered'),
      t('table.opened'),
      t('table.clicked'),
      t('table.error'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.email ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.opened_at ?? '',
      r.clicked_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = campaign.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadCsv(`email-campaign-${safeName}-${campaignId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // email_campaign_recipients cascades on email_campaigns.id (migration 052),
    // so a single delete is sufficient. Recipient counts update on delete via
    // the row-level RLS policies + the aggregate trigger only fires on its own
    // row changes, not on cascaded drops of en masse parent rows.
    const { error: delErr } = await supabase
      .from('email_campaigns')
      .delete()
      .eq('id', campaignId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('toastFailedDelete', { error: delErr.message }));
      return;
    }
    toast.success(t('toastDeleted'));
    router.push('/email');
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
        <Button variant="outline" onClick={() => router.push('/email')}>
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
      </div>
    );
  }

  const status = getEmailCampaignStatus(campaign.status);
  const funnelSteps: FunnelStep[] = [
    { label: t('funnel.sent'), value: campaign.sent_count, color: 'bg-blue-500' },
    { label: t('funnel.delivered'), value: campaign.delivered_count, color: 'bg-primary' },
    { label: t('funnel.opened'), value: campaign.opened_count, color: 'bg-emerald-500' },
    { label: t('funnel.clicked'), value: campaign.clicked_count, color: 'bg-purple-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            onClick={() => router.push('/email')}
            className="mb-2 -ml-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('back')}
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{campaign.name}</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
            >
              {status.pulse && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yellow-400" />
                </span>
              )}
              {tStatus(status.label)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{campaign.subject}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            {t('export')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard
          label={t('stats.total')}
          value={campaign.total_recipients}
          total={campaign.total_recipients}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          color="bg-muted"
        />
        <StatCard
          label={t('stats.sent')}
          value={campaign.sent_count}
          total={campaign.total_recipients}
          icon={<Send className="h-4 w-4 text-blue-400" />}
          color="bg-blue-500/10"
        />
        <StatCard
          label={t('stats.delivered')}
          value={campaign.delivered_count}
          total={campaign.total_recipients}
          icon={<CheckCheck className="h-4 w-4 text-primary" />}
          color="bg-primary/10"
        />
        <StatCard
          label={t('stats.opened')}
          value={campaign.opened_count}
          total={campaign.total_recipients}
          icon={<Eye className="h-4 w-4 text-emerald-400" />}
          color="bg-emerald-500/10"
        />
        <StatCard
          label={t('stats.failed')}
          value={campaign.failed_count}
          total={campaign.total_recipients}
          icon={<AlertCircle className="h-4 w-4 text-red-400" />}
          color="bg-red-500/10"
        />
      </div>

      {/* Funnel */}
      <FunnelChart steps={funnelSteps} />

      {/* Body preview */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">{t('bodyPreview')}</h3>
        <iframe
          title={t('bodyPreview')}
          sandbox=""
          srcDoc={`<!doctype html><html><body style="margin:0;padding:16px;font-family:system-ui,sans-serif;background:#fff;color:#111">${campaign.body_html ?? ''}</body></html>`}
          className="h-64 w-full rounded-md border border-border bg-white"
        />
      </div>

      {/* Recipients */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{t('recipients')}</p>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as EmailRecipientStatus | 'all')
              }
              className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="all">{t('table.allStatuses')}</option>
              {RECIPIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tStatus(s)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">{t('table.contact')}</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">{t('table.email')}</TableHead>
                <TableHead className="text-muted-foreground">{t('table.status')}</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">{t('table.sent')}</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">{t('table.opened')}</TableHead>
                {statusFilter === 'bounced' || statusFilter === 'failed' ? (
                  <TableHead className="text-muted-foreground">{t('table.error')}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecipients.map((r) => {
                const rStatus = getEmailRecipientStatus(r.status);
                return (
                  <TableRow key={r.id} className="border-border hover:bg-muted/50">
                    <TableCell className="font-medium text-foreground">
                      {r.contact?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {r.contact?.email ?? '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                      >
                        {tStatus(rStatus.label)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {r.opened_at ? new Date(r.opened_at).toLocaleString() : '—'}
                    </TableCell>
                    {statusFilter === 'bounced' || statusFilter === 'failed' ? (
                      <TableCell className="max-w-[220px] truncate text-xs text-red-400">
                        {r.error_message ?? '—'}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
              {filteredRecipients.length === 0 && (
                <TableRow className="border-border">
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {t('noRecipients')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Danger zone */}
      <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <div>
          <p className="text-sm font-medium text-red-400">{t('delete.title')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('delete.desc')}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" />
          {t('delete.button')}
        </Button>
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">{t('delete.confirmTitle')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t('delete.confirmBody')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(false)}
                className="border-border text-muted-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-500 text-white hover:bg-red-600"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <Trash2 className="h-4 w-4" />
                )}
                {t('delete.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
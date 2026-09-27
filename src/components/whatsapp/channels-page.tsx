'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  Briefcase,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Unplug,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PageHero } from '@/components/layout/page-hero';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { AddChannelDialog } from './add-channel-dialog';
import {
  channelQuality,
  channelState,
  describeApiError,
  tierLimit,
  type Channel,
  type ChannelState,
  type Quality,
  type WebhookInfo,
} from './channel-types';

const STATE_STYLE: Record<ChannelState, string> = {
  connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  disconnected: 'bg-muted text-muted-foreground',
  restricted: 'bg-red-500/10 text-red-600 dark:text-red-400',
  flagged: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

const QUALITY_DOT: Record<Quality, string> = {
  GREEN: 'bg-emerald-500',
  YELLOW: 'bg-amber-500',
  RED: 'bg-red-500',
  UNKNOWN: 'bg-muted-foreground/40',
};

const ROW_GRID =
  'md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] md:items-center md:gap-4';

export function ChannelsPage() {
  const t = useTranslations('WhatsAppChannels');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [quality, setQuality] = useState<'all' | Quality>('all');
  const [tier, setTier] = useState('all');

  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Channel | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/channels', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(describeApiError(body, t('loadFailed')));
        return;
      }
      setChannels(body.channels ?? []);
      setWebhook(body.webhook ?? null);
      setCanManage(!!body.can_manage);
      setLoadError(null);
    } catch {
      setLoadError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function replaceChannel(next: Channel) {
    setChannels((prev) =>
      prev.map((c) =>
        c.id === next.id ? next : next.is_default ? { ...c, is_default: false } : c,
      ),
    );
  }

  async function patch(channel: Channel, update: Record<string, unknown>, success: string) {
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(describeApiError(body, t('updateFailed')));
        return false;
      }
      replaceChannel(body.channel);
      toast.success(success);
      return true;
    } catch {
      toast.error(t('updateFailed'));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function refresh(channel: Channel) {
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}/refresh`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t('refreshFailed', { name: channel.name ?? '' }), {
          description: describeApiError(body, t('refreshFailed', { name: channel.name ?? '' })),
        });
        return;
      }
      replaceChannel(body.channel);
      toast.success(t('refreshed', { name: body.channel.name ?? '' }));
    } catch {
      toast.error(t('refreshFailed', { name: channel.name ?? '' }));
    } finally {
      setBusyId(null);
    }
  }

  // Take the number's webhooks back from another platform's override.
  async function takeWebhook(channel: Channel) {
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}/webhook`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(describeApiError(body, t('webhookFixFailed')));
        return;
      }
      replaceChannel(body.channel);
      toast.success(t('webhookFixed', { name: channel.name ?? '' }));
    } catch {
      toast.error(t('webhookFixFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(channel: Channel) {
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(describeApiError(body, t('removeFailed')));
        return;
      }
      toast.success(t('removed', { name: channel.name ?? '' }));
      setConfirmRemove(null);
      // The server may have promoted another channel to default.
      await load();
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const s = { connected: 0, pending: 0, disconnected: 0, restricted: 0, flagged: 0 };
    for (const c of channels) {
      const state = channelState(c);
      const q = channelQuality(c);
      // Flagged by Meta, or trending there on a low/medium quality rating.
      if (state === 'flagged' || q === 'YELLOW' || q === 'RED') s.flagged++;
      if (state !== 'flagged') s[state]++;
    }
    return s;
  }, [channels]);

  const tiers = useMemo(
    () => Array.from(new Set(channels.map(tierLimit).filter((x): x is string => !!x))),
    [channels],
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = channels.filter((c) => {
      if (quality !== 'all' && channelQuality(c) !== quality) return false;
      if (tier !== 'all' && tierLimit(c) !== tier) return false;
      if (!q) return true;
      return [c.name, c.verified_name, c.display_phone_number, c.waba_name, c.waba_id, c.phone_number_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    const byWaba = new Map<string, Channel[]>();
    for (const c of visible) {
      const key = c.waba_id ?? '';
      byWaba.set(key, [...(byWaba.get(key) ?? []), c]);
    }
    return Array.from(byWaba.entries());
  }, [channels, search, quality, tier]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" onClick={() => void load()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHero
        icon={WhatsAppIcon}
        iconClassName="bg-emerald-500/15 text-emerald-500"
        title={t('title')}
        description={t('subtitle')}
        actions={
          <GatedButton
            canAct={canManage}
            gateReason="connect WhatsApp channels"
            onClick={() => setAddOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('connectNew')}
          </GatedButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={CheckCircle2} tone="text-emerald-500 bg-emerald-500/10" value={stats.connected} label={t('stats.connected')} />
        <StatCard icon={Clock} tone="text-amber-500 bg-amber-500/10" value={stats.pending} label={t('stats.pending')} />
        <StatCard icon={XCircle} tone="text-muted-foreground bg-muted" value={stats.disconnected} label={t('stats.disconnected')} />
        <StatCard icon={Ban} tone="text-red-500 bg-red-500/10" value={stats.restricted} label={t('stats.restricted')} />
        <StatCard icon={AlertTriangle} tone="text-orange-500 bg-orange-500/10" value={stats.flagged} label={t('stats.flagged')} />
      </div>

      {channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
            <WhatsAppIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium text-foreground">{t('empty.title')}</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
          </div>
          {canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('connectNew')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('adminOnly')}</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-8"
              />
            </div>
            <FilterSelect
              value={quality}
              onChange={(v) => setQuality(v as 'all' | Quality)}
              options={[
                ['all', t('filters.allQuality')],
                ['GREEN', t('quality.GREEN')],
                ['YELLOW', t('quality.YELLOW')],
                ['RED', t('quality.RED')],
                ['UNKNOWN', t('quality.UNKNOWN')],
              ]}
              label={t('filters.quality')}
            />
            <FilterSelect
              value={tier}
              onChange={setTier}
              options={[
                ['all', t('filters.allTiers')],
                ...tiers.map((x) => [x, tierText(t, x)] as [string, string]),
              ]}
              label={t('filters.tier')}
            />
          </div>

          <div className={cn('hidden px-6 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase', ROW_GRID)}>
            <span>{t('columns.channel')}</span>
            <span>{t('columns.phone')}</span>
            <span>{t('columns.status')}</span>
            <span>{t('columns.quality')}</span>
            <span>{t('columns.tier')}</span>
            <span>{t('columns.throughput')}</span>
            <span className="text-right">{t('columns.actions')}</span>
          </div>

          <div className="space-y-4 p-4 pt-2">
            {groups.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('noMatches')}</p>
            ) : (
              groups.map(([wabaId, rows]) => (
                <section key={wabaId} className="overflow-hidden rounded-xl border border-border bg-muted/30">
                  <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                      <Briefcase className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        {t('wabaHeading')}
                      </p>
                      <p className="truncate text-sm">
                        <span className="font-semibold text-foreground">
                          {rows[0].waba_name || t('unnamedWaba')}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {wabaId || '—'} · {t('numbers', { count: rows.length })}
                        </span>
                      </p>
                    </div>
                    {/* The messaging limit belongs to the business portfolio,
                        shared by all its numbers — shown once per group. */}
                    {tierLimit(rows[0]) ? (
                      <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {tierText(t, tierLimit(rows[0])!)}
                        <span className="ml-1.5 font-normal opacity-70">{t('shared')}</span>
                      </span>
                    ) : null}
                  </header>
                  <ul className="divide-y divide-border bg-card">
                    {rows.map((c) => (
                      <ChannelRow
                        key={c.id}
                        channel={c}
                        canManage={canManage}
                        busy={busyId === c.id}
                        onRename={(name) => patch(c, { name }, t('renamed', { name }))}
                        onMakeDefault={() => patch(c, { is_default: true }, t('defaultSet', { name: c.name ?? '' }))}
                        onRefresh={() => refresh(c)}
                        ourWebhookUrl={webhook?.url ?? null}
                        onTakeWebhook={() => takeWebhook(c)}
                        onRemove={() => setConfirmRemove(c)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      )}

      {canManage && webhook ? <WebhookCard webhook={webhook} /> : null}

      <AddChannelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => void load()}
      />

      <Dialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('removeTitle', { name: confirmRemove?.name ?? '' })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('removeBody')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmRemove || busyId === confirmRemove.id}
              onClick={() => confirmRemove && void remove(confirmRemove)}
            >
              {confirmRemove && busyId === confirmRemove.id ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('removeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<'WhatsAppChannels'>>;

function tierText(t: Translate, limit: string): string {
  return limit === 'UNLIMITED' ? t('tierUnlimited') : t('tierLimit', { limit });
}

/** NOT_VERIFIED → "Not verified". */
function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function MetaChip({ tone, children }: { tone: 'amber' | 'red'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'amber'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {children}
    </span>
  );
}

function StatCard({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: typeof CheckCircle2;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', tone)}>
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-40 dark:bg-input/30"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function ChannelRow({
  channel: c,
  canManage,
  busy,
  onRename,
  onMakeDefault,
  onRefresh,
  onRemove,
  ourWebhookUrl,
  onTakeWebhook,
}: {
  channel: Channel;
  ourWebhookUrl: string | null;
  onTakeWebhook: () => void;
  canManage: boolean;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onMakeDefault: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('WhatsAppChannels');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.name ?? '');

  const state = channelState(c);
  const quality = channelQuality(c);
  const limit = tierLimit(c);
  // Another platform's override is receiving this number's messages.
  const norm = (u: string) => u.trim().replace(/\/+$/, '');
  const webhookElsewhere =
    !!c.webhook_url && !!ourWebhookUrl && norm(c.webhook_url) !== norm(ourWebhookUrl);

  async function saveName() {
    const next = draft.trim();
    if (!next || next === c.name) {
      setDraft(c.name ?? '');
      setEditing(false);
      return;
    }
    if (await onRename(next)) setEditing(false);
  }

  return (
    <li>
    <div className={cn('space-y-2 px-4 py-3 md:space-y-0', ROW_GRID)}>
      {/* Channel name — inline editable */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
        {editing ? (
          <Input
            value={draft}
            autoFocus
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName();
              if (e.key === 'Escape') {
                setDraft(c.name ?? '');
                setEditing(false);
              }
            }}
            className="h-7"
            aria-label={t('renameLabel')}
          />
        ) : (
          <>
            <span className="truncate font-medium text-foreground">{c.name || c.verified_name || '—'}</span>
            {c.is_default ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase">
                {t('default')}
              </span>
            ) : null}
            {canManage ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t('renameLabel')}
                title={t('renameLabel')}
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="min-w-0 text-sm">
        <p className="flex items-center gap-1 truncate text-foreground">
          <span className="truncate">{c.verified_name || '—'}</span>
          {c.is_official_business_account ? (
            <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-label={t('officialAccount')} />
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{c.display_phone_number || c.phone_number_id}</p>
        <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
          {c.account_mode && c.account_mode.toUpperCase() !== 'LIVE' ? (
            <MetaChip tone="amber">{t('chips.sandbox')}</MetaChip>
          ) : null}
          {c.name_status && !['APPROVED', 'AVAILABLE_WITHOUT_REVIEW'].includes(c.name_status.toUpperCase()) ? (
            <MetaChip tone="amber">{t('chips.name', { status: humanize(c.name_status) })}</MetaChip>
          ) : null}
          {c.code_verification_status && c.code_verification_status.toUpperCase() !== 'VERIFIED' ? (
            <MetaChip tone="red">{t('chips.notVerified')}</MetaChip>
          ) : null}
        </div>
      </div>

      <div>
        <span
          className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATE_STYLE[state])}
          title={c.last_registration_error ?? undefined}
        >
          {t(`state.${state}`)}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm text-foreground">
        <span className={cn('size-2 rounded-full', QUALITY_DOT[quality])} aria-hidden />
        {t(`quality.${quality}`)}
      </div>

      <div className="text-sm text-foreground">{limit ? tierText(t, limit) : '—'}</div>

      {/* Meta's messages-per-second class: STANDARD, HIGH, … */}
      <div className="text-sm text-foreground">
        {c.throughput_level && c.throughput_level.toUpperCase() !== 'NOT_APPLICABLE'
          ? humanize(c.throughput_level)
          : '—'}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        {canManage ? (
          <>
            {!c.is_default ? (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                onClick={onMakeDefault}
                title={t('makeDefault')}
                aria-label={t('makeDefault')}
              >
                <Star className="size-4" />
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon-sm"
              disabled={busy}
              onClick={onRefresh}
              title={t('refresh')}
              aria-label={t('refresh')}
              className="text-primary"
            >
              <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
            </Button>
            <Button
              variant="destructive"
              size="icon-sm"
              disabled={busy}
              onClick={onRemove}
              title={t('remove')}
              aria-label={t('remove')}
            >
              <Unplug className="size-4" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
    {webhookElsewhere ? (
      <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {t('webhookElsewhere')}{' '}
          <code className="break-all text-[11px] opacity-80">{c.webhook_url}</code>
        </span>
        {canManage ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onTakeWebhook} className="h-7">
            {t('webhookFix')}
          </Button>
        ) : null}
      </div>
    ) : null}
    </li>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookInfo }) {
  const t = useTranslations('WhatsAppChannels.webhook');

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <CopyField label={t('callbackUrl')} value={webhook.url} onCopy={copy} copyLabel={t('copy')} />
      {webhook.verify_token ? (
        <CopyField label={t('verifyToken')} value={webhook.verify_token} onCopy={copy} copyLabel={t('copy')} />
      ) : (
        <p className="text-xs text-muted-foreground">{t('noVerifyToken')}</p>
      )}
    </div>
  );
}

function CopyField({
  label,
  value,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
  copyLabel: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground">
          {value}
        </code>
        <Button variant="outline" size="icon-sm" onClick={() => onCopy(value)} aria-label={copyLabel} title={copyLabel}>
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

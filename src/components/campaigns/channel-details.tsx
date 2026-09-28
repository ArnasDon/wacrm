'use client';

import {
  Activity,
  AlertTriangle,
  Gauge,
  ShieldCheck,
  Signal,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  channelQuality,
  channelState,
  tierLimit,
  type Channel,
  type ChannelState,
  type Quality,
} from '@/components/whatsapp/channel-types';

const STATE_STYLE: Record<ChannelState, string> = {
  connected: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  disconnected: 'bg-muted text-muted-foreground',
  restricted: 'bg-red-500/10 text-red-700 dark:text-red-400',
  flagged: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
};

const QUALITY_STYLE: Record<Quality, { dot: string; text: string }> = {
  GREEN: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
  YELLOW: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  RED: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  UNKNOWN: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};

/** NOT_APPLICABLE / HIGH → "High"; null when Meta gave nothing useful. */
function humanize(value: string | null): string | null {
  if (!value || value.toUpperCase() === 'NOT_APPLICABLE') return null;
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const channelDisplayName = (c: Channel) =>
  c.name || c.verified_name || c.display_phone_number || c.phone_number_id;

/**
 * A channel's health at a glance — what matters before sending a
 * campaign through it: Meta status, quality rating, daily messaging
 * limit, throughput and live / sandbox mode.
 */
export function ChannelDetails({
  channel,
  compact = false,
  className,
}: {
  channel: Channel;
  /** Smaller tiles, for lists of several channels. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('Broadcasts.channelInfo');
  const tc = useTranslations('WhatsAppChannels');
  const state = channelState(channel);
  const quality = channelQuality(channel);
  const limit = tierLimit(channel);
  const throughput = humanize(channel.throughput_level);
  const sandbox = (channel.account_mode ?? '').toUpperCase() === 'SANDBOX';

  const tiles = [
    {
      icon: Activity,
      label: t('status'),
      value: (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            STATE_STYLE[state]
          )}
        >
          {tc(`state.${state}`)}
        </span>
      ),
    },
    {
      icon: Signal,
      label: t('quality'),
      value: (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 font-medium',
            QUALITY_STYLE[quality].text
          )}
        >
          <span
            className={cn('size-2 rounded-full', QUALITY_STYLE[quality].dot)}
          />
          {tc(`quality.${quality}`)}
        </span>
      ),
    },
    {
      icon: Gauge,
      label: t('limit'),
      value: (
        <span className="text-foreground font-medium">
          {limit
            ? limit === 'UNLIMITED'
              ? tc('tierUnlimited')
              : tc('tierLimit', { limit })
            : t('unknown')}
        </span>
      ),
    },
    {
      icon: Zap,
      label: t('throughput'),
      value: (
        <span className="text-foreground font-medium">
          {throughput ?? t('unknown')}
        </span>
      ),
    },
    {
      icon: ShieldCheck,
      label: t('mode'),
      value: (
        <span
          className={cn(
            'font-medium',
            sandbox ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'
          )}
        >
          {channel.account_mode
            ? sandbox
              ? t('sandbox')
              : t('live')
            : t('unknown')}
        </span>
      ),
    },
  ];

  return (
    <div
      className={cn(
        'border-border bg-background/60 rounded-xl border p-4',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: channel.color || '#25D366' }}
        >
          {channelDisplayName(channel).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-semibold">
            {channelDisplayName(channel)}
          </p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {channel.display_phone_number ?? channel.phone_number_id}
            {channel.waba_name ? ` · ${channel.waba_name}` : ''}
          </p>
        </div>
      </div>
      <dl
        className={cn(
          'mt-3 grid gap-2',
          compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-5'
        )}
      >
        {tiles.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="border-border bg-card rounded-lg border px-3 py-2"
          >
            <dt className="text-muted-foreground flex items-center gap-1 text-[11px] tracking-wide uppercase">
              <Icon className="size-3" />
              {label}
            </dt>
            <dd className="mt-1 text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {quality === 'RED' ? (
        <p className="mt-3 flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t('lowQuality')}
        </p>
      ) : null}
    </div>
  );
}

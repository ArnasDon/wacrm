'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCheck, Check, Clock, Copy, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** One test send as the window shows it; fields fill in as they arrive. */
export interface TestRun {
  to: string;
  /** Meta's raw API response (success or error body). */
  response?: unknown;
  /** Set once Meta accepted the message. */
  wamid?: string | null;
  /** Human-readable failure, when Meta or the app refused. */
  error?: string;
  /** True while the send request is in flight. */
  pending: boolean;
}

type StatusEvent = { status: string } & Record<string, unknown>;

const POLL_MS = 2000;
// Stop polling after this long — the webhook may not be connected.
const POLL_LIMIT_MS = 3 * 60 * 1000;
// Terminal states: nothing further will come for this message.
const FINAL = new Set(['read', 'failed']);

/**
 * "Message Testing" — Meta's API response, then the
 * status webhooks Meta posts for the message (sent → delivered → read, or
 * failed), polled live. Mirrors what a developer would watch in Meta's
 * API explorer.
 */
export function MessageTestingView({
  run,
  onClose,
  onReset,
}: {
  run: TestRun;
  onClose: () => void;
  onReset: () => void;
}) {
  const t = useTranslations('Settings.templates');
  // Fresh per message: the dialog remounts this view for each wamid.
  const [statuses, setStatuses] = useState<StatusEvent[]>([]);
  const [waiting, setWaiting] = useState(() => !!run.wamid);
  const [timedOut, setTimedOut] = useState(false);

  // Poll for status webhooks once Meta has accepted the message.
  useEffect(() => {
    if (!run.wamid) return;
    let stopped = false;
    const started = Date.now();

    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/whatsapp/templates/test-sends/${encodeURIComponent(run.wamid!)}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          const list = (data.statuses ?? []) as StatusEvent[];
          if (!stopped) setStatuses(list);
          if (list.some((s) => FINAL.has(s.status))) {
            setWaiting(false);
            return;
          }
        }
      } catch {
        // Transient — try again on the next tick.
      }
      if (Date.now() - started > POLL_LIMIT_MS) {
        setWaiting(false);
        setTimedOut(true);
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [run.wamid]);

  const latest = statuses[statuses.length - 1];
  // Meta's numeric reason for a failed delivery, explained in plain words
  // for the codes people hit most (issue #535 records them on messages).
  const failureCode =
    latest?.status === 'failed'
      ? (latest.errors as { code?: number }[] | undefined)?.[0]?.code
      : undefined;
  const failureKey = failureCode != null ? `failure.${failureCode}` : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{t('testingReceiver')}</p>
        <p className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground">
          {run.to}
        </p>
      </div>

      <JsonSection
        title={t('testingApiResponse')}
        value={run.response}
        pending={run.pending}
        tone={run.error ? 'error' : undefined}
      />

      {run.error ? (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-xs text-red-400"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{run.error}</span>
        </div>
      ) : null}

      {run.wamid ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{t('testingMetaResponse')}</p>
            {/* Status trail: sent → delivered → read (or failed). */}
            <div className="flex flex-wrap items-center gap-1">
              {statuses.map((s, i) => (
                <StatusChip key={i} status={s.status} />
              ))}
              {waiting ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  {t('testingWaiting')}
                </span>
              ) : null}
            </div>
          </div>
          {latest?.status === 'failed' ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {t('failureTitle', { code: failureCode != null ? String(failureCode) : '—' })}
                </p>
                <p>
                  {failureKey && t.has(failureKey) ? t(failureKey) : t('failure.generic')}
                </p>
              </div>
            </div>
          ) : null}
          {latest ? (
            <JsonBlock value={latest} tone={latest.status === 'failed' ? 'error' : undefined} />
          ) : waiting ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              {t('testingWaitingHelp')}
            </p>
          ) : null}
          {timedOut && statuses.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('testingNoWebhook')}</p>
          ) : null}
        </div>
      ) : null}

      <DialogFooter className="border-border bg-popover">
        <Button type="button" variant="outline" onClick={onReset} disabled={run.pending}>
          {t('testingReset')}
        </Button>
        <Button type="button" onClick={onClose} disabled={run.pending}>
          {t('cloneClose')}
        </Button>
      </DialogFooter>
    </div>
  );
}

function JsonSection({
  title,
  value,
  pending,
  tone,
}: {
  title: string;
  value: unknown;
  pending: boolean;
  tone?: 'error';
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {pending ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />…
        </p>
      ) : value !== undefined ? (
        <JsonBlock value={value} tone={tone} />
      ) : null}
    </div>
  );
}

function JsonBlock({ value, tone }: { value: unknown; tone?: 'error' }) {
  const t = useTranslations('Settings.templates');
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      <pre
        className={cn(
          'max-h-60 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground',
          tone === 'error' ? 'border-red-900/40' : 'border-border',
        )}
      >
        {text}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 text-muted-foreground"
        aria-label={t('testingCopy')}
        title={t('testingCopy')}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast.success(t('testingCopied'));
          } catch {
            // Clipboard blocked — the JSON stays selectable.
          }
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const style =
    status === 'failed'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : status === 'read'
        ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
        : status === 'delivered'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground';
  const Icon =
    status === 'failed' ? XCircle : status === 'read' || status === 'delivered' ? CheckCheck : status === 'sent' ? Check : Clock;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', style)}>
      <Icon className="size-3" />
      {status}
    </span>
  );
}

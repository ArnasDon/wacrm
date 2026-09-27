'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Dices,
  Loader2,
  Square,
  Timer,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { cloneName, cloneNames } from '@/lib/whatsapp/template-clone-names';
import { TEMPLATE_LIMITS } from '@/lib/whatsapp/template-validators';
import type { MessageTemplate } from '@/types';
import { TemplatePreview, fillVariables } from './template-preview';

/** The channel fields the clone dialog needs. */
export interface CloneChannel {
  id: string;
  name: string | null;
  waba_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
}

// Meta allows 100 template creates per WABA per hour; keep one batch
// comfortably under that.
const MAX_CLONES = 20;
const DELAY_PRESETS = [0, 10, 30, 60] as const;
const COUNT_PRESETS = [1, 5, 10] as const;
const MAX_DELAY_SECONDS = 3600;

type ItemStatus = 'pending' | 'creating' | 'done' | 'failed' | 'skipped';
interface Item {
  name: string;
  status: ItemStatus;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function label(c: CloneChannel): string {
  const name = c.name || c.verified_name || c.display_phone_number || c.id;
  return c.display_phone_number && c.display_phone_number !== name
    ? `${name} · ${c.display_phone_number}`
    : name;
}

/**
 * Clone one template N times. Names default to `<original>_<abc>` (three
 * random letters, unique within the target channel's WABA) and stay
 * editable. Copies are created one after another, optionally spaced by a
 * timer the user picks — a live countdown shows the wait — and the batch
 * can be stopped at any point.
 */
export function CloneTemplateDialog({
  source,
  channels,
  defaultChannelId,
  templates,
  onClose,
  onCreated,
}: {
  /** The template to clone; null keeps the dialog closed. */
  source: MessageTemplate | null;
  channels: CloneChannel[];
  defaultChannelId: string | null;
  /** Every template of the account — for "name already taken" checks. */
  templates: MessageTemplate[];
  onClose: () => void;
  /** After at least one copy was created in `channelId`. */
  onCreated: (channelId: string | null) => void;
}) {
  const t = useTranslations('Settings.templates');

  const [channelId, setChannelId] = useState<string | null>(defaultChannelId);
  const [count, setCount] = useState(1);
  // What the user is typing in the count box — may be empty or out of
  // range mid-edit; `count` only takes valid values.
  const [countText, setCountText] = useState('1');
  const [names, setNames] = useState<string[]>([]);
  const [delayPreset, setDelayPreset] = useState<number | 'custom'>(0);
  const [customDelay, setCustomDelay] = useState(45);
  const [phase, setPhase] = useState<'setup' | 'running' | 'finished'>('setup');
  const [items, setItems] = useState<Item[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const delay = delayPreset === 'custom' ? customDelay : delayPreset;

  // Names already used in the target WABA — a clone must not reuse one.
  const taken = useMemo(() => {
    const wabaId = channel?.waba_id ?? null;
    return new Set(
      templates.filter((tpl) => (tpl.waba_id ?? null) === wabaId).map((tpl) => tpl.name),
    );
  }, [templates, channel?.waba_id]);

  // Fresh state each time a template is opened for cloning.
  useEffect(() => {
    if (!source) return;
    stopRef.current = false;
    setChannelId(defaultChannelId);
    setCount(1);
    setCountText('1');
    setDelayPreset(0);
    setPhase('setup');
    setItems([]);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  // Keep one generated name per copy: extra rows get new names, existing
  // (possibly hand-edited) names are kept unless they clash with the
  // target channel's templates.
  useEffect(() => {
    if (!source || phase !== 'setup') return;
    setNames((prev) => {
      const used = new Set(taken);
      const next: string[] = [];
      for (let i = 0; i < count; i++) {
        const keep = prev[i] && !used.has(prev[i]) ? prev[i] : cloneName(source.name, used);
        used.add(keep);
        next.push(keep);
      }
      return next;
    });
  }, [source, count, taken, phase]);

  function regenerate(index?: number) {
    if (!source) return;
    setNames((prev) => {
      if (index === undefined) return cloneNames(source.name, prev.length, taken);
      const used = new Set([...taken, ...prev.filter((_, i) => i !== index)]);
      return prev.map((n, i) => (i === index ? cloneName(source.name, used) : n));
    });
  }

  function validate(): string | null {
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim();
      if (!name) return t('cloneNameRequired');
      if (!TEMPLATE_LIMITS.nameRegex.test(name)) return t('cloneNameInvalidNamed', { name });
      if (taken.has(name)) return t('cloneNameTaken', { name });
      if (seen.has(name)) return t('cloneNameDuplicate', { name });
      seen.add(name);
    }
    if (delayPreset === 'custom' && (!Number.isInteger(customDelay) || customDelay < 1 || customDelay > MAX_DELAY_SECONDS)) {
      return t('cloneDelayInvalid', { max: MAX_DELAY_SECONDS });
    }
    return null;
  }

  async function run() {
    if (!source) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    stopRef.current = false;
    const queue: Item[] = names.map((n) => ({ name: n.trim(), status: 'pending' }));
    setItems(queue);
    setPhase('running');

    const update = (i: number, patch: Partial<Item>) =>
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));

    let created = 0;
    for (let i = 0; i < queue.length; i++) {
      if (i > 0 && delay > 0) {
        for (let left = delay; left > 0 && !stopRef.current; left--) {
          setCountdown(left);
          await sleep(1000);
        }
        setCountdown(0);
      }
      if (stopRef.current) {
        for (let j = i; j < queue.length; j++) update(j, { status: 'skipped' });
        break;
      }

      update(i, { status: 'creating' });
      try {
        const res = await fetch(`/api/whatsapp/templates/${source.id}/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: queue[i].name, channel_id: channelId ?? undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          created++;
          update(i, { status: 'done' });
        } else {
          update(i, {
            status: 'failed',
            error: data?.error || t('cloneFailedHttp', { status: res.status }),
          });
        }
      } catch (err) {
        update(i, { status: 'failed', error: err instanceof Error ? err.message : t('cloneFailed') });
      }
    }

    setPhase('finished');
    if (created > 0) {
      onCreated(channelId);
      toast.success(t('cloneSummary', { done: created, total: queue.length }));
    } else {
      toast.error(t('cloneNoneCreated'));
    }
  }

  const running = phase === 'running';
  const doneCount = items.filter((i) => i.status === 'done').length;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const totalSeconds = Math.max(0, count - 1) * delay;

  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        // A running batch has to be stopped explicitly first.
        if (!open && !running) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Copy className="size-4" />
            </span>
            {t('cloneDialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('cloneDialogDesc', { name: source?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {/* The template being copied — scrolls when it's long. */}
        {source ? (
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border">
            <TemplatePreview
              className="rounded-none"
              headerType={source.header_type}
              headerText={fillVariables(source.header_content ?? '', source.sample_values?.header ?? [])}
              mediaUrl={
                source.header_media_url ||
                (source.header_handle && /^https?:\/\//i.test(source.header_handle) ? source.header_handle : null)
              }
              body={fillVariables(source.body_text ?? '', source.sample_values?.body ?? [])}
              footer={source.footer_text}
              buttons={source.buttons}
              mediaLabel={source.header_type ?? ''}
            />
          </div>
        ) : null}

        {phase === 'setup' ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="clone-count" className="text-muted-foreground">
                  {t('cloneCount')}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="clone-count"
                    inputMode="numeric"
                    autoComplete="off"
                    value={countText}
                    onChange={(e) => {
                      const text = e.target.value.replace(/\D/g, '').slice(0, 2);
                      setCountText(text);
                      const n = Number(text);
                      if (n >= 1 && n <= MAX_CLONES) setCount(n);
                    }}
                    onBlur={() => setCountText(String(count))}
                    className="w-16 border-border bg-muted text-center text-foreground"
                  />
                  {COUNT_PRESETS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setCount(n);
                        setCountText(String(n));
                      }}
                      className={cn(
                        'h-8 min-w-8 rounded-md border px-2 text-xs font-medium transition-colors',
                        count === n
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('cloneCountHint', { max: MAX_CLONES })}</p>
              </div>
              {channels.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="clone-channel" className="text-muted-foreground">
                    {t('cloneTarget')}
                  </Label>
                  <select
                    id="clone-channel"
                    value={channelId ?? ''}
                    onChange={(e) => setChannelId(e.target.value || null)}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">{t('cloneNames')}</Label>
                <button
                  type="button"
                  onClick={() => regenerate()}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Dices className="size-3.5" />
                  {t('cloneRegenerateAll')}
                </button>
              </div>
              <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                {names.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Input
                      value={name}
                      maxLength={512}
                      autoComplete="off"
                      aria-label={t('cloneNameN', { n: i + 1 })}
                      onChange={(e) => {
                        const v = e.target.value.toLowerCase().replace(/\s+/g, '_');
                        setNames((prev) => prev.map((p, j) => (j === i ? v : p)));
                      }}
                      className="h-8 border-border bg-muted font-mono text-xs text-foreground"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => regenerate(i)}
                      title={t('cloneRegenerate')}
                      aria-label={t('cloneRegenerate')}
                    >
                      <Dices className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('cloneNameHint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-muted-foreground">
                <Timer className="size-3.5" />
                {t('cloneDelay')}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {DELAY_PRESETS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setDelayPreset(sec)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      delayPreset === sec
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {sec === 0 ? t('cloneDelayNone') : t('cloneDelaySeconds', { seconds: sec })}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDelayPreset('custom')}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    delayPreset === 'custom'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {t('cloneDelayCustom')}
                </button>
                {delayPreset === 'custom' ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={MAX_DELAY_SECONDS}
                      value={customDelay}
                      onChange={(e) => setCustomDelay(Math.floor(Number(e.target.value)))}
                      aria-label={t('cloneDelayCustomLabel')}
                      className="h-7 w-20 border-border bg-muted text-xs text-foreground"
                    />
                    <span className="text-xs text-muted-foreground">{t('cloneDelayUnit')}</span>
                  </div>
                ) : null}
              </div>
              {count > 1 && delay > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('cloneDelayTotal', { count, time: formatClock(totalSeconds) })}
                </p>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-1.5 rounded border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-xs text-red-400"
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <DialogFooter className="border-border bg-popover">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button type="submit">
                <Copy className="size-4" />
                {t('cloneStart', { count })}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Progress: overall bar + the live timer between copies. */}
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {t('cloneProgress', { done: doneCount + failedCount, total: items.length })}
                </span>
                {running && countdown > 0 ? (
                  <span className="flex items-center gap-1 font-mono text-sm font-semibold text-primary tabular-nums">
                    <Clock className="size-3.5" />
                    {t('cloneNextIn', { time: formatClock(countdown) })}
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${items.length ? ((doneCount + failedCount) / items.length) * 100 : 0}%`,
                  }}
                />
              </div>
              {running && countdown > 0 && delay > 0 ? (
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-1000 ease-linear"
                    style={{ width: `${(countdown / delay) * 100}%` }}
                  />
                </div>
              ) : null}
            </div>

            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-foreground">{item.name}</p>
                    {item.error ? <p className="mt-0.5 text-xs text-red-400">{item.error}</p> : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t(`cloneStatus.${item.status}`)}
                  </span>
                </li>
              ))}
            </ul>

            <DialogFooter className="border-border bg-popover">
              {running ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    stopRef.current = true;
                  }}
                >
                  <Square className="size-3.5" />
                  {t('cloneStop')}
                </Button>
              ) : (
                <Button onClick={onClose}>{t('cloneClose')}</Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: ItemStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />;
    case 'failed':
      return <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />;
    case 'creating':
      return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />;
    case 'skipped':
      return <Square className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
    default:
      return <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  }
}

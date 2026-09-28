'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Gauge,
  Layers,
  Plus,
  ListPlus,
  ListX,
  Search,
  Send,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { SPEED_MAX, SPEED_MIN, templateKey } from '@/lib/campaigns/advanced';
import type { Channel } from '@/components/whatsapp/channel-types';
import { channelLabel, type TemplateGroup, type WizardState } from './types';
import { ChannelPicker } from '@/components/campaigns/channel-picker';
import { ChannelDetails } from '@/components/campaigns/channel-details';

const CATEGORY_STYLE: Record<string, string> = {
  Marketing: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  Utility: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  Authentication: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
};

export function StepSetup({
  state,
  update,
  channels,
  groups,
  templateCountByChannel,
  onTest,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  channels: Channel[];
  groups: TemplateGroup[];
  templateCountByChannel: Map<string, number>;
  onTest: (group: TemplateGroup) => void;
}) {
  const t = useTranslations('Broadcasts.advanced');
  const [query, setQuery] = useState('');

  const byKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);
  const chosenKeys = state.templates.map(templateKey);
  const filtered = groups.filter((g) =>
    g.ref.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const addTemplate = (g: TemplateGroup) => {
    if (chosenKeys.includes(g.key)) return;
    update({ templates: [...state.templates, g.ref] });
  };
  const addAll = () => {
    const missing = filtered.filter((g) => !chosenKeys.includes(g.key));
    if (missing.length)
      update({ templates: [...state.templates, ...missing.map((g) => g.ref)] });
  };
  const removeAll = () => {
    const keys = new Set(filtered.map((g) => g.key));
    update({
      templates: state.templates.filter((ref) => !keys.has(templateKey(ref))),
    });
  };
  const allAdded =
    filtered.length > 0 && filtered.every((g) => chosenKeys.includes(g.key));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...state.templates];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update({ templates: next });
  };
  const remove = (i: number) =>
    update({ templates: state.templates.filter((_, x) => x !== i) });

  // Selected channels that none of the chosen templates can go out on.
  const uncovered = channels.filter(
    (c) =>
      state.channelIds.includes(c.id) &&
      state.templates.length > 0 &&
      !state.templates.some((ref) =>
        byKey.get(templateKey(ref))?.channelIds.includes(c.id)
      )
  );

  return (
    <div className="space-y-6">
      {/* Channels */}
      <section className="border-border bg-card rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
              <Layers className="text-primary size-4" />
              {t('channels.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('channels.hint')}
            </p>
          </div>
          {state.channelIds.length > 0 ? (
            <span className="bg-primary/10 text-primary rounded-full px-3 py-1 font-mono text-xs">
              {t('channels.selected', { count: state.channelIds.length })}
            </span>
          ) : null}
        </div>

        {channels.length === 0 ? (
          <div className="border-border text-muted-foreground mt-4 rounded-lg border border-dashed p-6 text-center text-sm">
            <p>{t('channels.empty')}</p>
            <Link
              href="/whatsapp"
              className="text-primary mt-2 inline-block font-medium hover:underline"
            >
              {t('channels.connect')}
            </Link>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <ChannelPicker
              multiple
              channels={channels}
              value={state.channelIds}
              onChange={(channelIds) => update({ channelIds })}
              hint={(c) =>
                c.status === 'connected'
                  ? t('channels.templates', {
                      count: templateCountByChannel.get(c.id) ?? 0,
                    })
                  : t('channels.disconnected')
              }
            />
            {state.channelIds.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {channels
                  .filter((c) => state.channelIds.includes(c.id))
                  .map((c) => (
                    <ChannelDetails key={c.id} channel={c} compact />
                  ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Templates */}
      <section className="border-border bg-card rounded-xl border p-5">
        <h2 className="text-foreground text-base font-semibold">
          {t('templates.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('templates.hint')}
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Available */}
          <div className="border-border flex min-h-72 flex-col rounded-lg border">
            <div className="border-border border-b p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
                  {t('templates.available')}
                </p>
                {filtered.length === 0 ? null : allAdded ? (
                  <button
                    type="button"
                    onClick={removeAll}
                    className="text-muted-foreground inline-flex items-center gap-1 text-xs font-medium hover:text-red-600 dark:hover:text-red-400"
                  >
                    <ListX className="size-3.5" />
                    {t('templates.removeAll')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={addAll}
                    className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  >
                    <ListPlus className="size-3.5" />
                    {t('templates.addAll')}
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('templates.search')}
                  aria-label={t('templates.search')}
                  className="border-border bg-background focus-visible:border-ring h-9 w-full rounded-md border pr-3 pl-9 text-sm outline-none"
                />
              </div>
            </div>
            <ul className="divide-border max-h-80 flex-1 divide-y overflow-y-auto">
              {state.channelIds.length === 0 ? (
                <li className="text-muted-foreground p-6 text-center text-sm">
                  {t('templates.pickChannels')}
                </li>
              ) : filtered.length === 0 ? (
                <li className="text-muted-foreground p-6 text-center text-sm">
                  {t('templates.none')}
                </li>
              ) : (
                filtered.map((g) => {
                  const added = chosenKeys.includes(g.key);
                  const missing = state.channelIds.filter(
                    (id) => !g.channelIds.includes(id)
                  );
                  return (
                    <li
                      key={g.key}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {g.ref.name}
                        </p>
                        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-mono">{g.ref.language}</span>
                          <span
                            className={cn(
                              'rounded px-1.5 py-px',
                              CATEGORY_STYLE[g.row.category] ?? 'bg-muted'
                            )}
                          >
                            {g.row.category}
                          </span>
                          <span>
                            {t('templates.onChannels', {
                              count: g.channelIds.length,
                            })}
                          </span>
                        </p>
                        {missing.length > 0 ? (
                          <p className="mt-0.5 truncate text-xs text-amber-600 dark:text-amber-400">
                            {t('templates.missingOn', {
                              channels: missing
                                .map((id) => channels.find((c) => c.id === id))
                                .filter(Boolean)
                                .map((c) => channelLabel(c!))
                                .join(', '),
                            })}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          added
                            ? update({
                                templates: state.templates.filter(
                                  (ref) => templateKey(ref) !== g.key
                                ),
                              })
                            : addTemplate(g)
                        }
                        aria-pressed={added}
                        title={added ? t('templates.remove') : undefined}
                        className={cn(
                          'inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors',
                          added
                            ? 'border-primary/30 bg-primary/10 text-primary hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600'
                            : 'border-border text-foreground hover:border-primary hover:text-primary'
                        )}
                      >
                        {added ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Plus className="size-3.5" />
                        )}
                        {added ? t('templates.added') : t('templates.add')}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {/* Order */}
          <div className="border-border flex min-h-72 flex-col rounded-lg border">
            <p className="border-border text-muted-foreground border-b p-3 font-mono text-[11px] tracking-[0.15em] uppercase">
              {t('templates.order')}
            </p>
            {state.templates.length === 0 ? (
              <p className="text-muted-foreground m-auto p-6 text-center text-sm">
                {t('templates.empty')}
              </p>
            ) : (
              <ol className="flex-1 space-y-2 p-3">
                {state.templates.map((ref, i) => (
                  <li
                    key={templateKey(ref)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-2.5',
                      i === 0
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-background'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold',
                        i === 0
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-medium">
                        {ref.name}
                      </p>
                      <p className="text-muted-foreground font-mono text-[11px] tracking-[0.1em] uppercase">
                        {i === 0
                          ? t('templates.primary')
                          : t('templates.fallback', { n: i })}{' '}
                        · {ref.language}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <IconBtn
                        label={t('templates.moveUp')}
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                      >
                        <ArrowUp className="size-4" />
                      </IconBtn>
                      <IconBtn
                        label={t('templates.moveDown')}
                        onClick={() => move(i, 1)}
                        disabled={i === state.templates.length - 1}
                      >
                        <ArrowDown className="size-4" />
                      </IconBtn>
                      <IconBtn
                        label={t('templates.test')}
                        onClick={() => {
                          const g = byKey.get(templateKey(ref));
                          if (g) onTest(g);
                        }}
                      >
                        <Send className="size-4" />
                      </IconBtn>
                      <IconBtn
                        label={t('templates.remove')}
                        onClick={() => remove(i)}
                      >
                        <X className="size-4" />
                      </IconBtn>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {uncovered.length > 0 ? (
          <div className="mt-3 space-y-1">
            {uncovered.map((c) => (
              <p
                key={c.id}
                className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {t('templates.noTemplateFor', { channel: channelLabel(c) })}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      {/* Speed */}
      <section className="border-border bg-card rounded-xl border p-5">
        <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
          <Gauge className="text-primary size-4" />
          {t('speed.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('speed.hint')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            value={state.speed}
            onChange={(e) => update({ speed: Number(e.target.value) })}
            aria-label={t('speed.title')}
            className="accent-primary h-2 min-w-48 flex-1 cursor-pointer"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={SPEED_MIN}
              max={SPEED_MAX}
              value={state.speed}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n))
                  update({
                    speed: Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)),
                  });
              }}
              aria-label={t('speed.unit')}
              className="border-border bg-background focus-visible:border-ring h-9 w-20 rounded-md border px-2 text-center font-mono text-sm outline-none"
            />
            <span className="text-muted-foreground text-sm">
              {t('speed.unit')}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

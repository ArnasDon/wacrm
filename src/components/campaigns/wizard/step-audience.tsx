'use client';

import {
  Filter,
  Keyboard,
  Loader2,
  ShieldCheck,
  Tags,
  Upload,
  Users,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { guessColumn } from '@/lib/campaigns/advanced';
import { CsvAudiencePanel } from '@/components/campaigns/csv-audience-panel';
import type {
  AudienceSourceUI,
  AudienceState,
  AudienceStats,
  CustomFieldOption,
  TagOption,
  WizardState,
} from './state';

export function StepAudience({
  state,
  update,
  stats,
  checking,
  previewError,
  contactCount,
  tags,
  customFields,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  stats: AudienceStats | null;
  checking: boolean;
  previewError: boolean;
  contactCount: number | null;
  tags: TagOption[];
  customFields: CustomFieldOption[];
}) {
  const t = useTranslations('Campaigns.wizard.audience');
  const format = useFormatter();
  const a = state.audience;
  const setAudience = (patch: Partial<AudienceState>) =>
    update({ audience: { ...a, ...patch } });
  // A new audience means different fields: CSV columns vs contact fields.
  const pick = (source: AudienceSourceUI) =>
    source !== a.source &&
    update({ audience: { ...a, source }, shared: { body: {} } });

  const manualCount = a.manualText
    .split(/[\n,;]+/)
    .filter((s) => s.trim()).length;
  const sources: {
    key: AudienceSourceUI;
    icon: typeof Users;
    count: string | null;
  }[] = [
    {
      key: 'all',
      icon: Users,
      count:
        contactCount != null ? t('contacts', { count: contactCount }) : null,
    },
    {
      key: 'tags',
      icon: Tags,
      count:
        a.source === 'tags' && stats
          ? t('contacts', { count: stats.total })
          : null,
    },
    {
      key: 'segment',
      icon: Filter,
      count:
        a.source === 'segment' && stats
          ? t('contacts', { count: stats.total })
          : null,
    },
    {
      key: 'manual',
      icon: Keyboard,
      count: manualCount ? t('contacts', { count: manualCount }) : null,
    },
    {
      key: 'csv',
      icon: Upload,
      count: a.csv ? t('contacts', { count: a.csv.rows.length }) : null,
    },
  ];

  const chip = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-border hover:bg-muted'
    );
  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const input =
    'border-border bg-background focus-visible:border-primary h-10 rounded-lg border px-3 text-sm outline-none';

  return (
    <div className="space-y-6">
      <section className="border-border bg-card rounded-2xl border p-4 sm:p-6 lg:p-8">
        <h2 className="text-foreground text-base font-semibold sm:text-lg">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map(({ key, icon: Icon, count }) => {
            const active = a.source === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => pick(key)}
                className={cn(
                  'flex min-h-28 flex-col rounded-xl border p-4 text-left transition-colors sm:min-h-36 sm:p-5',
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border hover:bg-muted/40'
                )}
              >
                <Icon
                  className={cn(
                    'size-5',
                    active ? 'text-background' : 'text-muted-foreground'
                  )}
                />
                <span className="mt-3 font-semibold">
                  {t(`sources.${key}`)}
                </span>
                <span
                  className={cn(
                    'text-sm',
                    active ? 'text-background/70' : 'text-muted-foreground'
                  )}
                >
                  {t(`sources.${key}Hint`)}
                </span>
                {count ? (
                  <span
                    className={cn(
                      'mt-auto pt-3 text-sm',
                      active ? 'text-emerald-300' : 'text-muted-foreground'
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Source settings */}
        {a.source === 'tags' ? (
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('includeTags')}</p>
              <div className="flex gap-1.5">
                {(['any', 'all'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAudience({ tagMatch: m })}
                    className={chip(a.tagMatch === m)}
                  >
                    {m === 'any' ? t('matchAny') : t('matchAll')}
                  </button>
                ))}
              </div>
            </div>
            {tags.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noTags')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setAudience({ tagIds: toggleIn(a.tagIds, tag.id) })
                    }
                    className={chip(a.tagIds.includes(tag.id))}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {a.source === 'segment' ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_10rem_1fr]">
            {customFields.length === 0 ? (
              <p className="text-muted-foreground text-sm sm:col-span-3">
                {t('noFields')}
              </p>
            ) : (
              <>
                <select
                  aria-label={t('field')}
                  value={a.segment.fieldId}
                  onChange={(e) =>
                    setAudience({
                      segment: { ...a.segment, fieldId: e.target.value },
                    })
                  }
                  className={input}
                >
                  <option value="">{t('chooseField')}</option>
                  {customFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.field_name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="operator"
                  value={a.segment.operator}
                  onChange={(e) =>
                    setAudience({
                      segment: {
                        ...a.segment,
                        operator: e.target
                          .value as AudienceState['segment']['operator'],
                      },
                    })
                  }
                  className={input}
                >
                  {(['is', 'is_not', 'contains'] as const).map((op) => (
                    <option key={op} value={op}>
                      {t(`operators.${op}`)}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('value')}
                  placeholder={t('value')}
                  value={a.segment.value}
                  onChange={(e) =>
                    setAudience({
                      segment: { ...a.segment, value: e.target.value },
                    })
                  }
                  className={input}
                />
              </>
            )}
          </div>
        ) : null}

        {a.source === 'manual' ? (
          <div className="mt-6">
            <textarea
              value={a.manualText}
              onChange={(e) => setAudience({ manualText: e.target.value })}
              placeholder={t('manualPlaceholder')}
              rows={7}
              className="border-border bg-background focus-visible:border-primary w-full rounded-lg border p-3 font-mono text-sm outline-none"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {t('manualHint')}
            </p>
          </div>
        ) : null}

        {a.source && a.source !== 'csv' && tags.length > 0 ? (
          <div className="mt-6">
            <p className="mb-2 text-sm font-medium">{t('excludeTags')}</p>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() =>
                    setAudience({
                      excludeTagIds: toggleIn(a.excludeTagIds, tag.id),
                    })
                  }
                  className={cn(
                    chip(false),
                    a.excludeTagIds.includes(tag.id) &&
                      'border-red-500/50 bg-red-500/10 text-red-700 line-through dark:text-red-300'
                  )}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {a.source === 'csv' ? (
        <CsvAudiencePanel
          hideStats
          value={{
            csv: a.csv,
            phoneColumn: a.phoneColumn,
            nameColumn: a.nameColumn,
          }}
          stats={{
            valid: stats?.valid ?? 0,
            invalid: stats?.invalid ?? 0,
            duplicates: stats?.duplicates ?? 0,
          }}
          onChange={(patch) => {
            const next = { ...a, ...patch };
            if (patch.csv) {
              next.phoneColumn =
                patch.phoneColumn ??
                guessColumn(patch.csv.headers, 'phone') ??
                patch.csv.headers[0];
            }
            // New columns: the variable mapping pointed at the old ones.
            update({
              audience: next,
              ...(patch.csv ? { shared: { body: {} } } : {}),
            });
          }}
        />
      ) : null}

      {a.source ? (
        <section className="border-border bg-card rounded-2xl border p-4 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
                {t('health')}
              </p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="text-foreground text-3xl font-bold tabular-nums sm:text-4xl">
                  {stats ? format.number(stats.total) : '—'}
                </span>
                <span className="text-muted-foreground">
                  {t('selectedCount')}
                </span>
              </p>
            </div>
            {checking ? (
              <span className="text-muted-foreground inline-flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t('checking')}
              </span>
            ) : stats ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="size-4" />
                {t('reachable', { count: format.number(stats.valid) })}
              </span>
            ) : null}
          </div>
          {previewError ? (
            <p className="mt-2 text-sm text-red-600">{t('previewFailed')}</p>
          ) : null}

          {stats && stats.total > 0 ? (
            <div
              className="bg-muted mt-5 flex h-3 overflow-hidden rounded-full"
              aria-hidden
            >
              <span
                className="bg-emerald-500"
                style={{ width: `${(stats.valid / stats.total) * 100}%` }}
              />
              <span
                className="bg-red-500"
                style={{ width: `${(stats.invalid / stats.total) * 100}%` }}
              />
              <span
                className="bg-amber-400"
                style={{ width: `${(stats.duplicates / stats.total) * 100}%` }}
              />
              <span
                className="bg-neutral-400"
                style={{ width: `${(stats.excluded / stats.total) * 100}%` }}
              />
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['valid', 'bg-emerald-500', stats?.valid],
                ['invalid', 'bg-red-500', stats?.invalid],
                ['duplicates', 'bg-amber-400', stats?.duplicates],
                ['excluded', 'bg-neutral-400', stats?.excluded],
              ] as const
            ).map(([key, dot, value]) => (
              <div key={key} className="border-border rounded-xl border p-4">
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <span className={cn('size-2 rounded-full', dot)} />
                  {t(key)}
                </p>
                <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                  {value != null ? format.number(value) : '—'}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t(`${key}Hint`)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

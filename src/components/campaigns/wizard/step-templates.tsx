'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Eye,
  Radio,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  templateKey,
  templateSlots,
  type TemplateMapping,
  type ValueSource,
} from '@/lib/campaigns/advanced';
import type { Channel } from '@/components/whatsapp/channel-types';
import type { MessageTemplate } from '@/types';
import { MediaField } from './media-field';
import { PhonePreview, previewPropsFor } from './phone-preview';
import {
  channelLabel,
  chosenTemplates,
  missingCount,
  refOf,
  rowFor,
  sourceComplete,
  templatesForChannel,
  unionSlots,
  type CustomFieldOption,
  type WizardState,
} from './state';

export function StepTemplates({
  state,
  update,
  channels,
  templates,
  customFields,
  sampleRow,
  onTest,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  channels: Channel[];
  templates: MessageTemplate[];
  customFields: CustomFieldOption[];
  /** First valid uploaded row, for the preview (CSV / manual audiences). */
  sampleRow: Record<string, string> | null;
  onTest: (template: MessageTemplate, channel: Channel) => void;
}) {
  const t = useTranslations('Campaigns.wizard.templates');
  const standard = state.mode === 'standard';
  const [query, setQuery] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const selected = channels.filter((c) => state.channelIds.includes(c.id));
  const setFor = (channelId: string, list: ReturnType<typeof refOf>[]) =>
    update({
      channelTemplates: { ...state.channelTemplates, [channelId]: list },
    });

  const toggle = (channelId: string, tpl: MessageTemplate) => {
    const ref = refOf(tpl);
    const current = state.channelTemplates[channelId] ?? [];
    if (standard) return setFor(channelId, [ref]);
    const has = current.some((r) => templateKey(r) === templateKey(ref));
    setFor(
      channelId,
      has
        ? current.filter((r) => templateKey(r) !== templateKey(ref))
        : [...current, ref]
    );
  };

  const cloneToAll = (fromId: string) => {
    const source = state.channelTemplates[fromId] ?? [];
    const next = { ...state.channelTemplates };
    for (const c of selected) {
      if (c.id === fromId) continue;
      const available = new Set(
        templatesForChannel(templates, c).map((x) => templateKey(refOf(x)))
      );
      next[c.id] = source.filter((r) => available.has(templateKey(r)));
    }
    update({ channelTemplates: next });
  };

  // Pairs: channel × chosen template.
  const pairs = selected.flatMap((c) =>
    (state.channelTemplates[c.id] ?? []).map((ref) => ({
      channel: c,
      ref,
      row: rowFor(templates, c, ref),
    }))
  );
  const union = chosenTemplates(state);
  const rows = union
    .map((ref) => rowFor(templates, undefined, ref))
    .filter((r): r is MessageTemplate => !!r);
  const slots = unionSlots(rows);
  const m = state.shared;
  const toMap = missingCount(slots, m);
  const mediaKinds = [
    ...new Set(rows.map((r) => templateSlots(r).headerMedia).filter(Boolean)),
  ] as ('image' | 'video' | 'document')[];

  // Options a variable can read.
  const fromRows =
    state.audience.source === 'csv' || state.audience.source === 'manual';
  const fieldOptions = useMemo(() => {
    if (state.audience.source === 'csv')
      return (state.audience.csv?.headers ?? []).map((h) => ({
        value: h,
        label: h,
      }));
    if (state.audience.source === 'manual')
      return [{ value: 'phone', label: t('fields.phone') }];
    return [
      ...(['name', 'phone', 'email', 'company'] as const).map((f) => ({
        value: f,
        label: t(`fields.${f}`),
      })),
      ...customFields.map((f) => ({
        value: `cf:${f.id}`,
        label: f.field_name,
      })),
    ];
  }, [state.audience.source, state.audience.csv, customFields, t]);

  const setShared = (patch: Partial<TemplateMapping>) =>
    update({ shared: { ...state.shared, ...patch } });
  const withSource = (
    map: Record<string, ValueSource> | undefined,
    key: string,
    s: ValueSource | undefined
  ) => {
    const next = { ...(map ?? {}) };
    if (s) next[key] = s;
    else delete next[key];
    return next;
  };

  // Preview
  const preview =
    pairs.find((p) => `${p.channel.id}|${templateKey(p.ref)}` === previewKey) ??
    pairs[0] ??
    null;
  const previewRow = preview?.row;
  const previewProps =
    preview && previewRow
      ? previewPropsFor({
          channelName: channelLabel(preview.channel),
          channelPhone: preview.channel.display_phone_number,
          template: previewRow,
          mapping: m,
          media: state.media,
          sampleRow,
        })
      : null;

  const card = 'border-border bg-card rounded-2xl border p-4 sm:p-6';

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        {/* Templates per channel */}
        <section className={card}>
          <h2 className="text-foreground text-base font-semibold sm:text-lg">
            {standard ? t('titleStandard') : t('title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {standard ? t('subtitleStandard') : t('subtitle')}
          </p>
          <div className="relative mt-4 max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="border-border bg-background focus-visible:border-primary h-9 w-full rounded-lg border pr-3 pl-9 text-sm outline-none"
            />
          </div>

          <div className="mt-4 space-y-4">
            {selected.map((c) => {
              const available = templatesForChannel(templates, c);
              const shown = available.filter((x) =>
                x.name.toLowerCase().includes(query.trim().toLowerCase())
              );
              const chosen = state.channelTemplates[c.id] ?? [];
              return (
                <div
                  key={c.id}
                  className="border-border overflow-hidden rounded-xl border"
                >
                  <div className="border-border bg-muted/30 flex flex-wrap items-center gap-3 border-b px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {channelLabel(c)}
                      </p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {c.display_phone_number}
                      </p>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {t('count', { count: chosen.length })}
                    </span>
                    {!standard ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setFor(c.id, available.map(refOf))}
                          className="border-border bg-background hover:bg-muted rounded-md border px-2.5 py-1 text-xs"
                        >
                          {t('selectAll')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setFor(c.id, [])}
                          className="text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-xs"
                        >
                          {t('deselectAll')}
                        </button>
                        {selected.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => cloneToAll(c.id)}
                            className="text-primary inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs hover:underline"
                          >
                            <Copy className="size-3.5" />
                            {t('cloneToAll')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 p-4">
                    {available.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('none')}
                      </p>
                    ) : shown.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t('noMatch')}
                      </p>
                    ) : (
                      shown.map((tpl) => {
                        const key = templateKey(refOf(tpl));
                        const on = chosen.some((r) => templateKey(r) === key);
                        const order = chosen.findIndex(
                          (r) => templateKey(r) === key
                        );
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle(c.id, tpl)}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-xs transition-colors',
                              on
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border hover:border-primary/50 bg-background'
                            )}
                          >
                            {on && !standard && chosen.length > 1 ? (
                              <span className="bg-primary-foreground/25 rounded-full px-1.5 text-[10px]">
                                {order + 1}
                              </span>
                            ) : null}
                            {tpl.name}
                            <span
                              className={cn(
                                'font-sans text-[10px]',
                                on ? 'opacity-80' : 'text-muted-foreground'
                              )}
                            >
                              {tpl.language}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Message set */}
        {pairs.length > 0 ? (
          <section className={card}>
            <h2 className="text-foreground text-base font-semibold sm:text-lg">
              {t('messageSet')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('messageSetHint')}
            </p>
            <ul className="mt-4 space-y-2">
              {pairs.map((p) => {
                const key = `${p.channel.id}|${templateKey(p.ref)}`;
                const active =
                  preview &&
                  `${preview.channel.id}|${templateKey(preview.ref)}` === key;
                return (
                  <li
                    key={key}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
                      active ? 'border-foreground' : 'border-border'
                    )}
                  >
                    <Radio className="size-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate font-mono text-sm">
                        {p.ref.name}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {t('via', { channel: channelLabel(p.channel) })} ·{' '}
                        {p.row?.category ?? '—'} · {p.ref.language}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!p.row}
                      onClick={() => p.row && onTest(p.row, p.channel)}
                      className="border-border hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      <Send className="size-3.5" />
                      {t('sendTest')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewKey(key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                        active
                          ? 'bg-foreground text-background'
                          : 'border-border hover:bg-muted border'
                      )}
                    >
                      <Eye className="size-3.5" />
                      {t('preview')}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Variable mapping */}
        {rows.length > 0 ? (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-foreground flex items-center gap-2 text-base font-semibold sm:text-lg">
                <Sparkles className="size-4 text-amber-500" />
                {t('mapping')}
              </h2>
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-medium',
                  toMap === 0
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                )}
              >
                {toMap === 0 ? t('allMapped') : t('toMap', { count: toMap })}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('mappingHint')}
            </p>

            <div className="mt-4 space-y-3">
              {slots.body.length === 0 &&
              !slots.headerText &&
              slots.urlButtons.length === 0 &&
              mediaKinds.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('noVars')}</p>
              ) : null}
              {slots.headerText ? (
                <MappingRow
                  tag="{{1}}"
                  label={t('header')}
                  source={m.header_text}
                  onChange={(s) => setShared({ header_text: s })}
                  options={fieldOptions}
                  fromRows={fromRows}
                />
              ) : null}
              {slots.body.map((n) => (
                <MappingRow
                  key={n}
                  tag={`{{${n}}}`}
                  source={m.body?.[String(n)]}
                  onChange={(s) =>
                    setShared({ body: withSource(m.body, String(n), s) })
                  }
                  options={fieldOptions}
                  fromRows={fromRows}
                />
              ))}
              {slots.urlButtons.map((i) => (
                <MappingRow
                  key={`b${i}`}
                  tag="{{1}}"
                  label={t('button', { n: i + 1 })}
                  source={m.buttons?.[String(i)]}
                  onChange={(s) =>
                    setShared({ buttons: withSource(m.buttons, String(i), s) })
                  }
                  options={fieldOptions}
                  fromRows={fromRows}
                />
              ))}
              {mediaKinds.map((kind) => {
                const first = rows.find(
                  (r) => templateSlots(r).headerMedia === kind
                );
                return (
                  <div
                    key={kind}
                    className="border-border rounded-xl border p-4"
                  >
                    <MediaField
                      label={t('media', { type: kind })}
                      kind={kind}
                      value={state.media[kind] ?? ''}
                      fallback={first?.header_media_url}
                      onChange={(url) =>
                        update({ media: { ...state.media, [kind]: url } })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {/* Phone preview */}
      <aside className="xl:sticky xl:top-0">
        {preview && previewProps ? (
          <>
            <PhonePreview {...previewProps} />
            <p className="text-muted-foreground mt-3 text-center text-xs">
              {t('livePreview')}
            </p>
            <p className="text-muted-foreground text-center text-xs">
              {t('previewing', {
                template: preview.ref.name,
                channel: channelLabel(preview.channel),
              })}
            </p>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function MappingRow({
  tag,
  label,
  source,
  onChange,
  options,
  fromRows,
}: {
  tag: string;
  label?: string;
  source: ValueSource | undefined;
  onChange: (s: ValueSource | undefined) => void;
  options: { value: string; label: string }[];
  fromRows: boolean;
}) {
  const t = useTranslations('Campaigns.wizard.templates');
  const mode: 'column' | 'static' =
    source?.type === 'static' ? 'static' : 'column';
  const done = sourceComplete(source);
  return (
    <div className="border-border rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <code className="bg-muted text-foreground rounded-md px-2 py-1 font-mono text-xs">
          {tag}
        </code>
        {label ? <span className="text-sm font-medium">{label}</span> : null}
        <ArrowRight className="text-muted-foreground size-4" />
        <div className="border-border inline-flex overflow-hidden rounded-md border text-xs">
          {(['column', 'static'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() =>
                onChange(
                  k === 'static'
                    ? { type: 'static', value: '' }
                    : source?.type === 'column'
                      ? source
                      : undefined
                )
              }
              className={cn(
                'px-2.5 py-1.5 transition-colors',
                mode === k ? 'bg-foreground text-background' : 'hover:bg-muted'
              )}
            >
              {k === 'static'
                ? t('staticValue')
                : fromRows
                  ? t('csvColumn')
                  : t('contactField')}
            </button>
          ))}
        </div>
        {done ? (
          <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
            {t('mapped')}
          </span>
        ) : null}
      </div>
      <div className="mt-3">
        {mode === 'static' ? (
          <input
            value={source?.value ?? ''}
            onChange={(e) =>
              onChange({ type: 'static', value: e.target.value })
            }
            placeholder={t('staticPlaceholder')}
            className="border-border bg-background focus-visible:border-primary h-9 w-full max-w-sm rounded-lg border px-3 text-sm outline-none"
          />
        ) : (
          <select
            value={source?.type === 'column' ? source.value : ''}
            onChange={(e) =>
              onChange(
                e.target.value
                  ? { type: 'column', value: e.target.value }
                  : undefined
              )
            }
            className={cn(
              'bg-background focus-visible:border-primary h-9 w-full max-w-sm rounded-lg border px-3 text-sm outline-none',
              done ? 'border-border' : 'border-amber-500/60'
            )}
          >
            <option value="">{t('chooseField')}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

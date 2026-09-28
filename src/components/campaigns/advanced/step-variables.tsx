'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Upload,
  Undo2,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  templateKey,
  templateSlots,
  type TemplateMapping,
  type TemplateSlots,
  type ValueSource,
} from '@/lib/campaigns/advanced';
import { MEDIA_HEADER_SPECS } from '@/lib/whatsapp/media-header-types';
import {
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';
import {
  TemplatePreview,
  fillVariables,
} from '@/components/templates/template-preview';
import type { MessageTemplate } from '@/types';
import {
  effectiveMappings,
  rowObject,
  type AudienceStats,
  type TemplateGroup,
  type WizardState,
} from './types';

const STATIC = '__static__';

/** `map` with `key` set to `source`, or removed when it's cleared. */
function withSource(
  map: Record<string, ValueSource>,
  key: string,
  source: ValueSource | undefined
): Record<string, ValueSource> {
  const next = { ...map };
  if (source) next[key] = source;
  else delete next[key];
  return next;
}

/** Every per-send value any of the templates needs. */
function unionSlots(rows: MessageTemplate[]): TemplateSlots {
  const all = rows.map((r) => templateSlots(r));
  return {
    body: [...new Set(all.flatMap((s) => s.body))].sort((a, b) => a - b),
    headerText: all.some((s) => s.headerText),
    headerMedia: null,
    urlButtons: [...new Set(all.flatMap((s) => s.urlButtons))].sort(
      (a, b) => a - b
    ),
  };
}

export function StepVariables({
  state,
  update,
  groups,
  stats,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  groups: TemplateGroup[];
  stats: AudienceStats;
}) {
  const t = useTranslations('Broadcasts.advanced');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const csv = state.csv;
  const firstRow =
    csv && stats.validRows.length ? rowObject(csv, stats.validRows[0]) : {};

  const chosen = state.templates
    .map((ref) => groups.find((g) => g.key === templateKey(ref)))
    .filter((g): g is TemplateGroup => !!g);
  const effective = effectiveMappings(state);

  const setMapping = (key: string, patch: Partial<TemplateMapping>) => {
    const current = state.mappings[key] ?? { body: {} };
    update({
      mappings: { ...state.mappings, [key]: { ...current, ...patch } },
    });
  };
  const setShared = (patch: Partial<TemplateMapping>) =>
    update({ shared: { ...state.shared, ...patch } });

  /** Controls for the text variables of one mapping. */
  const variableFields = (
    slots: TemplateSlots,
    m: TemplateMapping,
    set: (patch: Partial<TemplateMapping>) => void
  ) => (
    <>
      {slots.headerText ? (
        <SourcePicker
          label={t('variables.header')}
          tag="{{1}}"
          source={m.header_text}
          onChange={(s) => set({ header_text: s })}
          state={state}
          stats={stats}
        />
      ) : null}
      {slots.body.map((n) => (
        <SourcePicker
          key={n}
          label={t('variables.variable', { n })}
          tag={`{{${n}}}`}
          source={m.body?.[String(n)]}
          onChange={(s) =>
            set({ body: withSource(m.body ?? {}, String(n), s) })
          }
          state={state}
          stats={stats}
        />
      ))}
      {slots.urlButtons.map((i) => (
        <SourcePicker
          key={`b${i}`}
          label={t('variables.button', { n: i + 1 })}
          tag="{{1}}"
          source={m.buttons?.[String(i)]}
          onChange={(s) =>
            set({ buttons: withSource(m.buttons ?? {}, String(i), s) })
          }
          state={state}
          stats={stats}
        />
      ))}
    </>
  );

  const preview = (g: TemplateGroup) => {
    const row = g.row;
    const m = effective[g.key] ?? { body: {} };
    const read = (s?: ValueSource) =>
      !s ? undefined : s.type === 'static' ? s.value : firstRow[s.value];
    const slots = templateSlots(row);
    const bodyValues = Array.from(
      { length: Math.max(0, ...slots.body) },
      (_, i) => read(m.body?.[String(i + 1)])
    );
    return (
      <TemplatePreview
        headerType={row.header_type}
        headerText={
          row.header_type === 'text'
            ? fillVariables(row.header_content ?? '', [read(m.header_text)])
            : null
        }
        mediaUrl={m.header_media_url?.trim() || row.header_media_url}
        body={fillVariables(row.body_text, bodyValues)}
        footer={row.footer_text}
        buttons={row.buttons}
      />
    );
  };

  const orderBadge = (index: number) => (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold',
        index === 0
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-foreground'
      )}
    >
      {index + 1}
    </span>
  );

  const mediaTemplates = chosen.filter((g) => templateSlots(g.row).headerMedia);
  const mediaKinds = [
    ...new Set(mediaTemplates.map((g) => templateSlots(g.row).headerMedia!)),
  ];
  const shared = unionSlots(chosen.map((g) => g.row));
  const sharedHasVars =
    shared.body.length > 0 || shared.headerText || shared.urlButtons.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-foreground text-base font-semibold">
            {t('variables.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('variables.hint')}
          </p>
        </div>
        {chosen.length > 1 ? (
          <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3">
            <input
              type="checkbox"
              checked={state.sameValues}
              onChange={(e) => update({ sameValues: e.target.checked })}
              className="accent-primary mt-0.5 size-4"
            />
            <span>
              <span className="text-foreground block text-sm font-medium">
                {t('variables.sameForAll')}
              </span>
              <span className="text-muted-foreground block text-xs">
                {t('variables.sameForAllHint')}
              </span>
            </span>
          </label>
        ) : null}
      </div>

      {state.sameValues ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="border-border bg-card overflow-hidden rounded-xl border">
            <header className="border-border flex flex-wrap items-center gap-2 border-b px-5 py-3">
              <p className="text-foreground font-medium">
                {t('variables.allTemplates')}
              </p>
              <span className="flex flex-wrap gap-1.5">
                {chosen.map((g, i) => (
                  <span
                    key={g.key}
                    className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
                  >
                    {i + 1}. {g.ref.name}
                  </span>
                ))}
              </span>
            </header>
            <div className="space-y-4 p-5">
              {sharedHasVars ? (
                variableFields(shared, state.shared, setShared)
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t('variables.noVars')}
                </p>
              )}
              {/* One link / upload per media type, applied to every
                  selected template with that header type. */}
              {mediaKinds.map((kind) => {
                const group = mediaTemplates.filter(
                  (g) => templateSlots(g.row).headerMedia === kind
                );
                return (
                  <MediaField
                    key={kind}
                    label={t('variables.mediaUrl', { type: kind })}
                    hint={t('variables.mediaAppliesAll', { type: kind })}
                    kind={kind}
                    value={state.mappings[group[0].key]?.header_media_url ?? ''}
                    fallback={group[0].row.header_media_url}
                    onChange={(url) => {
                      const mappings = { ...state.mappings };
                      for (const g of group) {
                        mappings[g.key] = {
                          ...(mappings[g.key] ?? { body: {} }),
                          header_media_url: url,
                        };
                      }
                      update({ mappings });
                    }}
                  />
                );
              })}
            </div>
          </section>

          {/* One preview; the chips switch which template it shows. The
              values are shared, so every template reflects the mapping. */}
          <section className="border-border bg-card rounded-xl border p-4 lg:sticky lg:top-0">
            <p className="text-muted-foreground mb-3 font-mono text-[11px] tracking-[0.15em] uppercase">
              {t('variables.previewFirst')}
            </p>
            {chosen.length > 1 ? (
              <TemplateSwitcher
                label={t('variables.previewTemplate')}
                templates={chosen}
                value={previewing ?? chosen[0].key}
                onChange={setPreviewing}
              />
            ) : null}
            {(() => {
              const g = chosen.find((x) => x.key === previewing) ?? chosen[0];
              return g ? preview(g) : null;
            })()}
          </section>
        </div>
      ) : (
        chosen.map((g, index) => {
          const slots = templateSlots(g.row);
          const m: TemplateMapping = state.mappings[g.key] ?? { body: {} };
          const hasVars =
            slots.body.length > 0 ||
            slots.headerText ||
            slots.headerMedia ||
            slots.urlButtons.length > 0;
          return (
            <section
              key={g.key}
              className="border-border bg-card overflow-hidden rounded-xl border"
            >
              <header className="border-border flex flex-wrap items-center gap-3 border-b px-5 py-3">
                {orderBadge(index)}
                <p className="text-foreground font-medium">{g.ref.name}</p>
                <span className="text-muted-foreground font-mono text-xs">
                  {g.ref.language}
                </span>
                <span className="text-muted-foreground ml-auto font-mono text-[11px] tracking-[0.1em] uppercase">
                  {index === 0
                    ? t('templates.primary')
                    : t('templates.fallback', { n: index })}
                </span>
              </header>
              <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="space-y-4">
                  {!hasVars ? (
                    <p className="text-muted-foreground text-sm">
                      {t('variables.noVars')}
                    </p>
                  ) : null}
                  {slots.headerMedia ? (
                    <MediaField
                      label={t('variables.mediaUrl', {
                        type: slots.headerMedia,
                      })}
                      kind={slots.headerMedia}
                      value={m.header_media_url ?? ''}
                      fallback={g.row.header_media_url}
                      onChange={(url) =>
                        setMapping(g.key, { header_media_url: url })
                      }
                    />
                  ) : null}
                  {variableFields(slots, m, (patch) =>
                    setMapping(g.key, patch)
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground mb-2 font-mono text-[11px] tracking-[0.15em] uppercase">
                    {t('variables.previewFirst')}
                  </p>
                  {preview(g)}
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/**
 * Media-header link for one template: paste a link or upload a new file
 * (to the account's chat-media bucket). Empty = the template's own media.
 */
export function MediaField({
  label,
  hint,
  kind,
  value,
  fallback,
  onChange,
}: {
  label: string;
  /** Extra line above the default hint. */
  hint?: string;
  kind: 'image' | 'video' | 'document';
  value: string;
  fallback?: string | null;
  onChange: (url: string) => void;
}) {
  const t = useTranslations('Broadcasts.advanced.variables');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const spec = MEDIA_HEADER_SPECS[kind];

  async function upload(file: File) {
    if (!spec.mimeTypes.includes(file.type)) {
      toast.error(spec.formats);
      return;
    }
    const max = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > max) {
      toast.error(t('tooLarge', { size: Math.round(max / 1024 / 1024) }));
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      onChange(publicUrl);
      toast.success(t('uploaded'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="text-foreground mb-1.5 block text-sm font-medium">
        {label}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row">
        {kind === 'image' && (value || fallback) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value || fallback || ''}
            alt=""
            className="border-border size-10 shrink-0 rounded-md border object-cover"
          />
        ) : null}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback ?? 'https://'}
          className="border-border bg-background focus-visible:border-ring h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none"
        />
        <input
          ref={inputRef}
          type="file"
          accept={spec.mimeTypes.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="border-border text-foreground hover:border-primary hover:text-primary inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading ? t('uploading') : t('upload')}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            title={t('useTemplateMedia')}
            aria-label={t('useTemplateMedia')}
            className="text-muted-foreground hover:text-foreground inline-flex h-10 shrink-0 items-center justify-center rounded-md px-2"
          >
            <Undo2 className="size-4" />
          </button>
        ) : null}
      </div>
      <span className="text-muted-foreground mt-1 block text-xs">
        {hint ? `${hint} ` : ''}
        {t('mediaUrlHint')}
      </span>
    </div>
  );
}

function SourcePicker({
  label,
  tag,
  source,
  onChange,
  state,
  stats,
}: {
  label: string;
  tag: string;
  source: ValueSource | undefined;
  onChange: (s: ValueSource | undefined) => void;
  state: WizardState;
  stats: AudienceStats;
}) {
  const t = useTranslations('Broadcasts.advanced.variables');
  const headers = state.csv?.headers ?? [];
  const value = !source
    ? ''
    : source.type === 'static'
      ? STATIC
      : `col:${source.value}`;

  // Rows that would send with this variable empty — they'll fail.
  let empty = 0;
  if (source?.type === 'column' && state.csv) {
    const col = state.csv.headers.indexOf(source.value);
    for (const i of stats.validRows)
      if (!(state.csv.rows[i]?.[col] ?? '').trim()) empty++;
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-foreground text-sm font-medium">{label}</span>
        <code className="bg-muted text-muted-foreground rounded px-1.5 py-px font-mono text-xs">
          {tag}
        </code>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) onChange(undefined);
            else if (v === STATIC)
              onChange({
                type: 'static',
                value: source?.type === 'static' ? source.value : '',
              });
            else onChange({ type: 'column', value: v.slice(4) });
          }}
          className={cn(
            'bg-background text-foreground focus-visible:border-ring h-10 rounded-md border px-3 text-sm outline-none sm:w-56',
            source ? 'border-border' : 'border-amber-500/60'
          )}
        >
          <option value="">{t('choose')}</option>
          {headers.map((h) => (
            <option key={h} value={`col:${h}`}>
              {h}
            </option>
          ))}
          <option value={STATIC}>{t('fixed')}</option>
        </select>
        {source?.type === 'static' ? (
          <input
            autoFocus
            value={source.value}
            onChange={(e) =>
              onChange({ type: 'static', value: e.target.value })
            }
            placeholder={t('fixedPlaceholder')}
            className="border-border bg-background focus-visible:border-ring h-10 flex-1 rounded-md border px-3 text-sm outline-none"
          />
        ) : null}
      </div>
      {empty > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5" />
          {t('emptyWarning', { count: empty })}
        </p>
      ) : null}
    </div>
  );
}

/** Dropdown choosing which selected template the preview shows. */
function TemplateSwitcher({
  label,
  templates,
  value,
  onChange,
}: {
  label: string;
  templates: TemplateGroup[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const index = Math.max(
    0,
    templates.findIndex((g) => g.key === value)
  );
  const current = templates[index];
  const badge = (i: number, active: boolean) => (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-foreground'
      )}
    >
      {i + 1}
    </span>
  );
  return (
    <div className="mb-3">
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="border-border bg-background hover:border-primary/50 focus-visible:border-ring flex h-10 w-full items-center gap-2 rounded-lg border px-2 text-left text-sm outline-none">
          {badge(index, true)}
          <span className="text-foreground min-w-0 flex-1 truncate font-medium">
            {current?.ref.name}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {current?.ref.language}
          </span>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 transition-transform',
              open && 'rotate-180'
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--anchor-width) min-w-64 gap-0 p-1.5"
        >
          <ul className="max-h-72 overflow-y-auto">
            {templates.map((g, i) => {
              const active = g.key === value;
              const header = g.row.header_type;
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(g.key);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left',
                      active ? 'bg-primary/10' : 'hover:bg-muted'
                    )}
                  >
                    {badge(i, active)}
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {g.ref.name}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {g.ref.language}
                        {header ? ` · ${header}` : ''} · {g.row.category}
                      </span>
                    </span>
                    {active ? <Check className="text-primary size-4" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Campaign wizard — state shape and the pure helpers every step shares
// (template availability, pairs, mappings, validation, estimates).

import type { MessageTemplate } from '@/types';
import type { Channel } from '@/components/whatsapp/channel-types';
import {
  SPEED_DEFAULT,
  SPEED_MAX,
  normalizeCsvPhone,
  referencedColumns,
  templateKey,
  templateSlots,
  type CampaignTemplateRef,
  type TemplateMapping,
  type TemplateSlots,
  type ValueSource,
} from '@/lib/campaigns/advanced';
import {
  buildPairs,
  channelTotals,
  planDistribution,
  type DistributionMode,
  type PairPlan,
} from '@/lib/campaigns/distribution';
import { channelMaxRate, effectiveRate } from '@/lib/campaigns/rate-limiter';

export type Mode = 'standard' | 'advanced';
export type AudienceSourceUI = 'all' | 'tags' | 'segment' | 'manual' | 'csv';
export type StepKey =
  'basics' | 'audience' | 'templates' | 'distribution' | 'review';

export interface CsvData {
  fileName: string;
  headers: string[];
  rows: string[][];
}

export interface AudienceState {
  source: AudienceSourceUI | null;
  tagIds: string[];
  tagMatch: 'any' | 'all';
  excludeTagIds: string[];
  segment: {
    fieldId: string;
    operator: 'is' | 'is_not' | 'contains';
    value: string;
  };
  manualText: string;
  csv: CsvData | null;
  phoneColumn: string | null;
  nameColumn: string | null;
}

export interface DeliveryState {
  /** Start ≥ 30 s after the previous campaign started. */
  interval: boolean;
  /** Pause when Meta holds a message for quality assessment. */
  pauseOnQualityHold: boolean;
  /** Pause this campaign on a Meta API error. */
  stopOnMetaError: boolean;
}

export const DEFAULT_DELIVERY: DeliveryState = {
  interval: false,
  pauseOnQualityHold: false,
  stopOnMetaError: false,
};

export interface WizardState {
  mode: Mode;
  name: string;
  channelIds: string[];
  audience: AudienceState;
  /** Templates chosen per channel (fallback order). */
  channelTemplates: Record<string, CampaignTemplateRef[]>;
  /** One variable mapping for every template. */
  shared: TemplateMapping;
  /** Header media link per media type ('image' | 'video' | 'document'). */
  media: Record<string, string>;
  distribution: DistributionMode;
  maxContacts: number;
  speed: number;
  /** Advanced delivery settings (older drafts may lack it). */
  delivery?: DeliveryState;
  scheduleAt: string;
  /** Set when editing a saved draft. */
  draftId: string | null;
}

export interface AudienceStats {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  excluded: number;
}

export interface CustomFieldOption {
  id: string;
  field_name: string;
}

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

/** `datetime-local` value for a Date, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initialState(mode: Mode = 'advanced', name = ''): WizardState {
  return {
    mode,
    name,
    channelIds: [],
    audience: {
      source: null,
      tagIds: [],
      tagMatch: 'any',
      excludeTagIds: [],
      segment: { fieldId: '', operator: 'is', value: '' },
      manualText: '',
      csv: null,
      phoneColumn: null,
      nameColumn: null,
    },
    channelTemplates: {},
    shared: { body: {} },
    media: {},
    distribution: 'channel',
    maxContacts: 0,
    speed: SPEED_DEFAULT * 8,
    delivery: { ...DEFAULT_DELIVERY },
    scheduleAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
    draftId: null,
  };
}

export const stepsFor = (mode: Mode): StepKey[] =>
  mode === 'standard'
    ? ['basics', 'audience', 'templates', 'review']
    : ['basics', 'audience', 'templates', 'distribution', 'review'];

export const channelLabel = (
  c: Pick<
    Channel,
    'name' | 'verified_name' | 'display_phone_number' | 'phone_number_id'
  >
) => c.name || c.verified_name || c.display_phone_number || c.phone_number_id;

/** Approved templates a channel can send (its WABA's, or unscoped). */
export function templatesForChannel(
  templates: MessageTemplate[],
  channel: Channel
): MessageTemplate[] {
  return templates.filter(
    (t) =>
      t.status === 'APPROVED' &&
      (!t.waba_id || !channel.waba_id || t.waba_id === channel.waba_id)
  );
}

export const refOf = (t: MessageTemplate): CampaignTemplateRef => ({
  name: t.name,
  language: t.language ?? 'en_US',
});

/** The template row a (channel, ref) pair sends. */
export function rowFor(
  templates: MessageTemplate[],
  channel: Channel | undefined,
  ref: CampaignTemplateRef
): MessageTemplate | undefined {
  const candidates = templates.filter(
    (t) => t.name === ref.name && (t.language ?? 'en_US') === ref.language
  );
  return (
    candidates.find((t) => channel && t.waba_id === channel.waba_id) ??
    candidates[0]
  );
}

/** Every distinct chosen template (union over channels), in order. */
export function chosenTemplates(state: WizardState): CampaignTemplateRef[] {
  const out: CampaignTemplateRef[] = [];
  for (const id of state.channelIds) {
    for (const t of state.channelTemplates[id] ?? []) {
      if (!out.some((o) => templateKey(o) === templateKey(t))) out.push(t);
    }
  }
  return out;
}

/** Variables across all chosen templates (union). */
export function unionSlots(rows: MessageTemplate[]): TemplateSlots {
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

export const sourceComplete = (s: ValueSource | undefined) =>
  !!s && s.value.trim() !== '';

export function slotsComplete(
  slots: TemplateSlots,
  m: TemplateMapping
): boolean {
  return (
    slots.body.every((n) => sourceComplete(m.body?.[String(n)])) &&
    (!slots.headerText || sourceComplete(m.header_text)) &&
    slots.urlButtons.every((i) => sourceComplete(m.buttons?.[String(i)]))
  );
}

/** Count of variables still unmapped. */
export function missingCount(slots: TemplateSlots, m: TemplateMapping): number {
  return (
    slots.body.filter((n) => !sourceComplete(m.body?.[String(n)])).length +
    (slots.headerText && !sourceComplete(m.header_text) ? 1 : 0) +
    slots.urlButtons.filter((i) => !sourceComplete(m.buttons?.[String(i)]))
      .length
  );
}

/** The mapping sent for each template: the shared one + its media type's link. */
export function effectiveMappings(
  state: WizardState,
  rows: Map<string, MessageTemplate>
): Record<string, TemplateMapping> {
  const out: Record<string, TemplateMapping> = {};
  for (const ref of chosenTemplates(state)) {
    const key = templateKey(ref);
    const kind = templateSlots(
      rows.get(key) ?? ({ body_text: '' } as MessageTemplate)
    ).headerMedia;
    out[key] = {
      ...state.shared,
      ...(kind && state.media[kind]
        ? { header_media_url: state.media[kind] }
        : {}),
    };
  }
  return out;
}

// ── Audience (browser side, for uploaded / pasted numbers) ─────────

/** Pasted numbers → one-column rows. */
export function manualRows(text: string): Record<string, string>[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((phone) => ({ phone }));
}

/** Health of uploaded / pasted rows (exclusion is applied server-side). */
export function rowStats(
  rows: Record<string, string>[],
  phoneColumn: string
): AudienceStats & { validRows: number[] } {
  const seen = new Set<string>();
  const out = {
    total: rows.length,
    valid: 0,
    invalid: 0,
    duplicates: 0,
    excluded: 0,
    validRows: [] as number[],
  };
  rows.forEach((r, i) => {
    const phone = normalizeCsvPhone(r[phoneColumn] ?? '');
    if (!phone) out.invalid++;
    else if (seen.has(phone)) out.duplicates++;
    else {
      seen.add(phone);
      out.valid++;
      out.validRows.push(i);
    }
  });
  return out;
}

export const csvRowObjects = (csv: CsvData): Record<string, string>[] =>
  csv.rows.map((r) =>
    Object.fromEntries(csv.headers.map((h, i) => [h, r[i] ?? '']))
  );

// ── Distribution + estimates ───────────────────────────────────────

export function planFor(state: WizardState, recipients: number): PairPlan[] {
  const total =
    state.maxContacts > 0
      ? Math.min(recipients, state.maxContacts)
      : recipients;
  return planDistribution(
    buildPairs(state.channelIds, state.channelTemplates),
    state.mode === 'standard' ? 'channel' : state.distribution,
    total
  );
}

/** Seconds to send the plan: the slowest channel decides. */
export function estimateSeconds(
  state: WizardState,
  plan: PairPlan[],
  channels: Channel[]
): number {
  const totals = channelTotals(plan);
  let worst = 0;
  for (const c of channels) {
    const t = totals.get(c.id);
    if (!t) continue;
    worst = Math.max(
      worst,
      t.receivers / effectiveRate(state.speed, c.throughput_level)
    );
  }
  return worst;
}

export function combinedRate(state: WizardState, channels: Channel[]): number {
  return channels
    .filter((c) => state.channelIds.includes(c.id))
    .reduce(
      (sum, c) => sum + effectiveRate(state.speed, c.throughput_level),
      0
    );
}

export const maxSpeedFor = (channels: Channel[], ids: string[]) =>
  Math.max(
    80,
    ...channels
      .filter((c) => ids.includes(c.id))
      .map((c) => channelMaxRate(c.throughput_level))
  );

// ── Launch ─────────────────────────────────────────────────────────

/** The approved template rows the campaign's chosen templates refer to. */
export function templateRowMap(
  state: WizardState,
  templates: MessageTemplate[]
): Map<string, MessageTemplate> {
  return new Map(
    chosenTemplates(state)
      .map(
        (ref) => [templateKey(ref), rowFor(templates, undefined, ref)] as const
      )
      .filter((e): e is [string, MessageTemplate] => !!e[1])
  );
}

/** Uploaded / pasted rows and which of them are valid (null for contact audiences). */
export function localAudience(state: WizardState) {
  const a = state.audience;
  const rows =
    a.source === 'csv' && a.csv
      ? { rows: csvRowObjects(a.csv), phone: a.phoneColumn ?? a.csv.headers[0] }
      : a.source === 'manual'
        ? { rows: manualRows(a.manualText), phone: 'phone' }
        : null;
  return rows ? { ...rows, stats: rowStats(rows.rows, rows.phone) } : null;
}

export type LaunchSchedule = { mode: 'now' } | { mode: 'later'; at: string };

/**
 * The POST /api/campaigns/advanced body for a wizard state — used by the
 * wizard's Launch / Schedule buttons and by "Launch" on a draft's page,
 * so both send exactly the same campaign.
 */
export function buildCampaignPayload(
  state: WizardState,
  templates: MessageTemplate[],
  schedule: LaunchSchedule
) {
  const a = state.audience;
  const mappings = effectiveMappings(state, templateRowMap(state, templates));
  const keep = referencedColumns({ mappings, name_column: a.nameColumn });
  const local = localAudience(state);
  let rows: Record<string, string>[] | undefined;
  if (local) {
    const cols = [...new Set([local.phone, ...keep])];
    rows = local.stats.validRows.map((i) =>
      Object.fromEntries(cols.map((c) => [c, local.rows[i][c] ?? '']))
    );
  }
  return {
    name: state.name.trim(),
    mode: state.mode,
    channel_ids: state.channelIds,
    channel_templates: Object.fromEntries(
      state.channelIds.map((id) => [id, state.channelTemplates[id] ?? []])
    ),
    distribution: state.mode === 'standard' ? 'channel' : state.distribution,
    max_contacts: state.maxContacts,
    // No fixed cap: each channel sends at its Meta tier (80 or 1 000/s),
    // read when the campaign starts — an upgraded number sends faster.
    speed: SPEED_MAX,
    delivery: state.delivery ?? DEFAULT_DELIVERY,
    mappings,
    audience: {
      source: a.source,
      tagIds: a.tagIds,
      tagMatch: a.tagMatch,
      segment: a.segment,
      excludeTagIds: a.excludeTagIds,
      rows,
      phoneColumn: local?.phone,
      nameColumn: a.source === 'csv' ? a.nameColumn : null,
    },
    schedule,
    draft_id: state.draftId,
  };
}

export type DraftProblem =
  'name' | 'channels' | 'templates' | 'variables' | 'audience';

/**
 * What still stops a saved draft from launching — the same rules as the
 * wizard's steps. Contact audiences (all / tags / segment) are counted by
 * the server at launch; uploaded / pasted ones need at least one valid
 * number here (a draft whose CSV was too big to keep has none).
 */
export function draftProblems(
  state: WizardState,
  channels: Channel[],
  templates: MessageTemplate[]
): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!state.name.trim()) out.push('name');
  const selected = channels.filter((c) => state.channelIds.includes(c.id));
  if (
    (state.mode === 'standard'
      ? state.channelIds.length !== 1
      : state.channelIds.length === 0) ||
    selected.length !== state.channelIds.length ||
    selected.some((c) => c.status !== 'connected')
  )
    out.push('channels');
  const templatesOk =
    state.channelIds.length > 0 &&
    state.channelIds.every((id) => {
      const list = state.channelTemplates[id] ?? [];
      const ch = channels.find((c) => c.id === id);
      if (
        !ch ||
        list.length === 0 ||
        (state.mode === 'standard' && list.length !== 1)
      )
        return false;
      const available = new Set(
        templatesForChannel(templates, ch).map(
          (x) => `${x.name}:${x.language ?? 'en_US'}`
        )
      );
      return list.every((r) => available.has(templateKey(r)));
    });
  if (!templatesOk) out.push('templates');
  const slots = unionSlots([...templateRowMap(state, templates).values()]);
  if (missingCount(slots, state.shared) > 0) out.push('variables');
  const a = state.audience;
  const local = localAudience(state);
  if (
    !a.source ||
    (local && local.stats.valid === 0) ||
    (a.source === 'csv' && !a.csv) ||
    (a.source === 'segment' && !a.segment.fieldId)
  )
    out.push('audience');
  return out;
}

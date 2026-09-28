import type { MessageTemplate } from '@/types';
import type { Channel } from '@/components/whatsapp/channel-types';
import {
  normalizeCsvPhone,
  templateKey,
  templateSlots,
  type CampaignTemplateRef,
  type TemplateMapping,
  type ValueSource,
} from '@/lib/campaigns/advanced';

export interface CsvData {
  fileName: string;
  headers: string[];
  rows: string[][];
}

export interface WizardState {
  channelIds: string[];
  templates: CampaignTemplateRef[];
  speed: number;
  csv: CsvData | null;
  phoneColumn: string | null;
  nameColumn: string | null;
  /** Per-template mappings; with `sameValues` only media links live here. */
  mappings: Record<string, TemplateMapping>;
  /** One mapping for every template (the default). */
  sameValues: boolean;
  shared: TemplateMapping;
  name: string;
  scheduleMode: 'now' | 'later';
  /** `<input type="datetime-local">` value. */
  scheduleAt: string;
}

/** One approved template (name + language) and where it can be sent. */
export interface TemplateGroup {
  key: string;
  ref: CampaignTemplateRef;
  /** Representative row — structure, preview, category. */
  row: MessageTemplate;
  /** Selected channels whose WABA has this template approved. */
  channelIds: string[];
}

export const channelLabel = (
  c: Pick<
    Channel,
    'name' | 'verified_name' | 'display_phone_number' | 'phone_number_id'
  >
) => c.name || c.verified_name || c.display_phone_number || c.phone_number_id;

/** Approved templates available on the selected channels, grouped by name + language. */
export function groupTemplates(
  templates: MessageTemplate[],
  channels: Channel[],
  selected: string[]
): TemplateGroup[] {
  const chosen = channels.filter((c) => selected.includes(c.id));
  const groups = new Map<string, TemplateGroup>();
  for (const row of templates) {
    if (row.status !== 'APPROVED') continue;
    const ref = { name: row.name, language: row.language ?? 'en_US' };
    const on = chosen
      .filter((c) => !row.waba_id || row.waba_id === c.waba_id)
      .map((c) => c.id);
    if (on.length === 0) continue;
    const key = templateKey(ref);
    const g = groups.get(key);
    if (g) g.channelIds = [...new Set([...g.channelIds, ...on])];
    else groups.set(key, { key, ref, row, channelIds: on });
  }
  return [...groups.values()].sort((a, b) =>
    a.ref.name.localeCompare(b.ref.name)
  );
}

export const sourceComplete = (s: ValueSource | undefined) =>
  !!s && s.value.trim() !== '';

/**
 * The mapping each chosen template is sent with. In "same values" mode
 * every template shares one mapping (variables are matched by number),
 * keeping only its own media link, since media type differs per template.
 */
export function effectiveMappings(
  state: Pick<WizardState, 'templates' | 'mappings' | 'sameValues' | 'shared'>
): Record<string, TemplateMapping> {
  if (!state.sameValues) return state.mappings;
  return Object.fromEntries(
    state.templates.map((ref) => {
      const key = templateKey(ref);
      const media = state.mappings[key]?.header_media_url;
      return [key, { ...state.shared, header_media_url: media }];
    })
  );
}

/** Every variable of every chosen template has a source. */
export function mappingsComplete(
  groups: TemplateGroup[],
  state: WizardState
): boolean {
  const mappings = effectiveMappings(state);
  return state.templates.every((ref) => {
    const g = groups.find((x) => x.key === templateKey(ref));
    if (!g) return false;
    const slots = templateSlots(g.row);
    const m = mappings[g.key];
    return (
      slots.body.every((n) => sourceComplete(m?.body?.[String(n)])) &&
      (!slots.headerText || sourceComplete(m?.header_text)) &&
      slots.urlButtons.every((i) => sourceComplete(m?.buttons?.[String(i)]))
    );
  });
}

export interface AudienceStats {
  valid: number;
  invalid: number;
  duplicates: number;
  /** Index of every row that will be sent. */
  validRows: number[];
}

export function audienceStats(
  csv: CsvData | null,
  phoneColumn: string | null
): AudienceStats {
  const out: AudienceStats = {
    valid: 0,
    invalid: 0,
    duplicates: 0,
    validRows: [],
  };
  if (!csv || !phoneColumn) return out;
  const col = csv.headers.indexOf(phoneColumn);
  if (col < 0) return out;
  const seen = new Set<string>();
  csv.rows.forEach((r, i) => {
    const phone = normalizeCsvPhone(r[col] ?? '');
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

export const rowObject = (
  csv: CsvData,
  index: number
): Record<string, string> =>
  Object.fromEntries(
    csv.headers.map((h, i) => [h, csv.rows[index]?.[i] ?? ''])
  );

/**
 * The recipients a CSV selection yields: valid, de-duplicated numbers
 * as "+digits", with the name column when one is chosen.
 */
export function csvContacts(
  csv: CsvData | null,
  phoneColumn: string | null,
  nameColumn: string | null
): { phone: string; name?: string }[] {
  if (!csv || !phoneColumn) return [];
  const p = csv.headers.indexOf(phoneColumn);
  const n = nameColumn ? csv.headers.indexOf(nameColumn) : -1;
  if (p < 0) return [];
  const seen = new Set<string>();
  const out: { phone: string; name?: string }[] = [];
  for (const r of csv.rows) {
    const digits = normalizeCsvPhone(r[p] ?? '');
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    const name = n >= 0 ? (r[n] ?? '').trim() : '';
    out.push(name ? { phone: `+${digits}`, name } : { phone: `+${digits}` });
  }
  return out;
}

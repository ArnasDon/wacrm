// ============================================================
// Advanced campaigns — the pure parts: the plan shape stored on
// `broadcasts.config`, CSV parsing, phone normalisation, per-template
// variable resolution, and deciding which Meta errors mean "this
// template can't be used any more, move on to the next one".
//
// The runner (advanced-runner.ts) and the create route use these; the
// wizard uses the CSV + variable helpers so what it previews is what
// the server sends.
// ============================================================

import type { MessageTemplate } from '@/types';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';

/** Where one template variable's value comes from. */
export type ValueSource =
  { type: 'column'; value: string } | { type: 'static'; value: string };

/** How one template's variables are filled for each recipient. */
export interface TemplateMapping {
  /** Body {{N}} → source, keyed by N. */
  body: Record<string, ValueSource>;
  /** TEXT header {{1}}. */
  header_text?: ValueSource;
  /** Media-header link; the template's stored link when empty. */
  header_media_url?: string;
  /** URL-button {{1}} suffix, keyed by the button's index. */
  buttons?: Record<string, ValueSource>;
}

export interface CampaignTemplateRef {
  name: string;
  language: string;
}

/** `broadcasts.config` for an advanced campaign. */
export interface AdvancedCampaignConfig {
  version: 1;
  channel_ids: string[];
  /** Priority order: the first usable one is sent, the next on a pause. */
  templates: CampaignTemplateRef[];
  phone_column: string;
  name_column: string | null;
  /** Mapping per template, keyed by {@link templateKey}. */
  mappings: Record<string, TemplateMapping>;
  /** Messages per second, per channel. */
  speed: number;
  /**
   * Runtime: template keys each channel gave up on (paused, disabled,
   * deleted), keyed by channel id, with the reason Meta gave.
   */
  exhausted?: Record<string, Record<string, string>>;
  /** Runtime (Kafka mode): when the pending recipients were last queued. */
  kafka_dispatched_at?: string | null;
  /** Wizard mode it was created in (display only). */
  mode?: 'standard' | 'advanced';
  /**
   * Templates chosen per channel, in fallback order. When set, a channel
   * only sends its own list; `templates` is then their union.
   */
  channel_templates?: Record<string, CampaignTemplateRef[]>;
  /** How the audience was split over channel × template pairs. */
  distribution?: 'channel' | 'template' | 'matrix';
  /** Where the audience came from (display only). */
  audience_source?: 'all' | 'tags' | 'segment' | 'manual' | 'csv';
  /** A saved draft's wizard state (status 'draft' only). */
  draft_state?: unknown;
  /** "Advanced delivery settings" chosen in the wizard. */
  delivery?: DeliverySettings;
  /** Runtime: when the campaign first started sending (interval gate). */
  started_at?: string | null;
  /** Runtime: why the campaign was paused (status 'paused'). */
  paused_reason?: string | null;
  /**
   * Runtime: why a delivery setting stopped the campaign for good
   * (status 'failed'). Set → the campaign can never be resumed.
   */
  stopped_reason?: string | null;
  /** Runtime: when that stop happened. */
  stopped_at?: string | null;
}

export interface DeliverySettings {
  /** Start at least this many seconds after the previous campaign started (0/undefined = off). */
  interval_seconds?: number;
  /** Stop (permanently) when Meta accepts a message as 'held_for_quality_assessment'. */
  pause_on_quality_hold?: boolean;
  /** Stop this campaign (permanently) when a send fails with a Meta API error. */
  stop_on_meta_error?: boolean;
}

/** Gap between campaign starts when "Campaign interval" is on. */
export const CAMPAIGN_INTERVAL_SECONDS = 30;
/** Meta's message_status for a message held back to check its quality. */
export const QUALITY_HOLD_STATUS = 'held_for_quality_assessment';

/** Per-recipient row_data keys for the planned channel / template. */
export const ROW_CHANNEL = '__channel';
export const ROW_TEMPLATE = '__template';

export const SPEED_MIN = 1;
/**
 * Meta caps each number at 80 msg/s (standard) or 1 000 msg/s (high
 * throughput tier); the sender also caps each channel at its own tier.
 */
export const SPEED_MAX = 1000;
export const SPEED_DEFAULT = 10;
export const MAX_CHANNELS = 20;
export const MAX_TEMPLATES = 10;
export const MAX_ROWS = 100_000;

/**
 * A running pass heartbeats `delivery_locked_at` every ~15 s; a lock
 * older than this means its runner went away (restart, timeout).
 */
export const LOCK_STALE_MS = 2 * 60 * 1000;

export const templateKey = (t: CampaignTemplateRef) =>
  `${t.name}:${t.language}`;

export interface CampaignTemplateUse extends CampaignTemplateRef {
  /** Channels sending this template (same Meta account). */
  channelIds: string[];
}

/**
 * The templates a campaign actually sends, one per (Meta business
 * account, name, language): two channels on different WABAs using a
 * template of the same name send two different templates; two channels
 * on the same WABA share one. Channels without a known WABA count on
 * their own.
 */
export function campaignTemplateUses(
  config: Pick<
    AdvancedCampaignConfig,
    'channel_ids' | 'templates' | 'channel_templates'
  >,
  channels: { id: string; waba_id?: string | null }[]
): CampaignTemplateUse[] {
  const uses = new Map<string, CampaignTemplateUse>();
  for (const id of config.channel_ids) {
    const waba = channels.find((c) => c.id === id)?.waba_id || `channel:${id}`;
    for (const ref of config.channel_templates?.[id] ?? config.templates) {
      const key = `${waba}|${templateKey(ref)}`;
      const use = uses.get(key) ?? { ...ref, channelIds: [] };
      use.channelIds.push(id);
      uses.set(key, use);
    }
  }
  return [...uses.values()];
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/**
 * RFC 4180-ish CSV parse: quoted cells, doubled quotes, newlines inside
 * quotes, CRLF. The delimiter (comma, semicolon or tab) is sniffed from
 * the header line — spreadsheet exports in many locales use `;`.
 * Blank lines are dropped; duplicate or empty headers get a suffix so
 * every column can be picked by name.
 */
export function parseCsvTable(text: string): CsvTable {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t']
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const seen = new Map<string, number>();
  const headers = nonEmpty[0].map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = nonEmpty
    .slice(1)
    .map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  return { headers, rows };
}

/** The column most likely to hold phone numbers / names, or null. */
export function guessColumn(
  headers: string[],
  kind: 'phone' | 'name'
): string | null {
  const patterns =
    kind === 'phone'
      ? [
          /^phone$/i,
          /^mobile$/i,
          /^whatsapp$/i,
          /phone|mobile|whatsapp|number|msisdn|contact/i,
        ]
      : [/^name$/i, /^full.?name$/i, /^first.?name$/i, /name/i];
  // "Contact name" is a name, not a number.
  const candidates =
    kind === 'phone' ? headers.filter((h) => !/name|mail/i.test(h)) : headers;
  for (const p of patterns) {
    const hit = candidates.find((h) => p.test(h.trim()));
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------
// Phones
// ------------------------------------------------------------

/**
 * A CSV phone cell → Meta's digits-only international form, or null.
 *
 * `+` numbers are taken as written. Numbers without `+` are the common
 * spreadsheet case: with a `countryCode` given, a national number (a
 * trunk 0 is dropped) gets the code prefixed unless it already starts
 * with it; without one, the digits must already include the country
 * code (e.g. 919812345678). The wizard asks for the code so this is an
 * explicit choice rather than a guess (issue #586).
 */
export function normalizeCsvPhone(
  raw: string,
  countryCode?: string | null
): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const hasPlus = text.startsWith('+') || text.startsWith('00');
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;

  if (!hasPlus) {
    const cc = (countryCode ?? '').replace(/\D/g, '');
    if (cc) {
      const national = digits.replace(/^0+/, '');
      // Already carries the code: "91 98123 45678" with code 91.
      const withCode =
        digits.startsWith(cc) && digits.length > 10 ? digits : cc + national;
      digits = withCode;
    }
  }
  return isValidE164(digits) ? digits : null;
}

// ------------------------------------------------------------
// Variables
// ------------------------------------------------------------

export interface TemplateSlots {
  body: number[];
  headerText: boolean;
  headerMedia: 'image' | 'video' | 'document' | null;
  /** Indexes of URL buttons whose link ends in {{1}}. */
  urlButtons: number[];
}

/** The per-send values a template needs. */
export function templateSlots(
  t: Pick<
    MessageTemplate,
    'body_text' | 'header_type' | 'header_content' | 'buttons'
  >
): TemplateSlots {
  const headerType = t.header_type;
  return {
    body: extractVariableIndices(t.body_text ?? ''),
    headerText:
      headerType === 'text' &&
      extractVariableIndices(t.header_content ?? '').length > 0,
    headerMedia:
      headerType === 'image' ||
      headerType === 'video' ||
      headerType === 'document'
        ? headerType
        : null,
    urlButtons: (t.buttons ?? []).flatMap((b, i) =>
      b.type === 'URL' && extractVariableIndices(b.url ?? '').length > 0
        ? [i]
        : []
    ),
  };
}

const readSource = (
  src: ValueSource | undefined,
  row: Record<string, string>
) => (!src ? '' : src.type === 'static' ? src.value : (row[src.value] ?? ''));

/**
 * The send-time values for one recipient on one template. Throws when a
 * required variable resolves empty — Meta would reject the send anyway,
 * and this names the variable.
 */
export function resolveSendParams(
  template: Pick<
    MessageTemplate,
    'body_text' | 'header_type' | 'header_content' | 'buttons'
  >,
  mapping: TemplateMapping | undefined,
  row: Record<string, string>
): SendTimeParams {
  const slots = templateSlots(template);
  const m: TemplateMapping = mapping ?? { body: {} };
  const out: SendTimeParams = {};

  if (slots.body.length > 0) {
    const max = Math.max(...slots.body);
    out.body = Array.from({ length: max }, (_, i) => {
      const value = readSource(m.body[String(i + 1)], row).trim();
      if (!value)
        throw new Error(`Variable {{${i + 1}}} is empty for this recipient`);
      return value;
    });
  }
  if (slots.headerText) {
    const value = readSource(m.header_text, row).trim();
    if (!value)
      throw new Error('Header variable {{1}} is empty for this recipient');
    out.headerText = value;
  }
  if (slots.headerMedia && m.header_media_url?.trim()) {
    out.headerMediaUrl = m.header_media_url.trim();
  }
  if (slots.urlButtons.length > 0) {
    out.buttonParams = {};
    for (const i of slots.urlButtons) {
      const value = readSource(m.buttons?.[String(i)], row).trim();
      if (!value)
        throw new Error(
          `Button ${i + 1} URL variable is empty for this recipient`
        );
      out.buttonParams[i] = value;
    }
  }
  return out;
}

/** CSV columns a mapping reads — the only cells stored per recipient. */
export function referencedColumns(
  config: Pick<AdvancedCampaignConfig, 'mappings' | 'name_column'>
): string[] {
  const cols = new Set<string>();
  if (config.name_column) cols.add(config.name_column);
  const add = (s?: ValueSource) => {
    if (s?.type === 'column' && s.value) cols.add(s.value);
  };
  for (const m of Object.values(config.mappings)) {
    Object.values(m.body ?? {}).forEach(add);
    add(m.header_text);
    Object.values(m.buttons ?? {}).forEach(add);
  }
  return [...cols];
}

// ------------------------------------------------------------
// Meta errors
// ------------------------------------------------------------

/**
 * Meta error codes that mean the TEMPLATE can't be sent (on this WABA),
 * whoever the recipient is — so the runner moves the rest of the
 * audience to the next template instead of failing everyone.
 *
 *   132001  template does not exist (in this language)
 *   132015  template is paused (low quality)
 *   132016  template is disabled (paused too many times)
 *   132068  flow is blocked
 *   132069  flow is throttled
 */
export const TEMPLATE_UNAVAILABLE_CODES = new Set([
  132001, 132015, 132016, 132068, 132069,
]);

export function isTemplateUnavailable(
  code: number | null | undefined,
  message = ''
): boolean {
  if (code != null && TEMPLATE_UNAVAILABLE_CODES.has(code)) return true;
  return /template (is )?(paused|disabled)|template name does not exist/i.test(
    message
  );
}

/** Template statuses a campaign can't send with. */
export const UNSENDABLE_TEMPLATE_STATUSES = new Set([
  'PAUSED',
  'DISABLED',
  'REJECTED',
  'PENDING_DELETION',
]);

/**
 * Meta error codes that stop the whole CHANNEL (token revoked, number
 * blocked, account restricted) — retrying other templates is pointless.
 *
 *   190     access token expired / invalid
 *   131031  business account locked
 *   131042  payment issue on the account
 *   133010  phone number not registered
 *   368     temporarily blocked for policy violations
 */
export const CHANNEL_FATAL_CODES = new Set([190, 131031, 131042, 133010, 368]);

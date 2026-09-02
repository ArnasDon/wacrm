// ============================================================
// Follow-up nudges — pure logic shared by the config route (validation
// on save) and the cron sweep (which step is due, and may it go out
// now). No DB, no I/O here so it stays unit-testable; the sweep that
// reads/writes Supabase lives in `followups-sweep.ts`.
//
// Why a sweep and not the auto-reply path: the AI only ever runs when
// an inbound message arrives (`dispatchInboundToAiReply` is called from
// the webhooks). "Message the customer an hour after THEY went quiet"
// has no inbound to hang off of, so a scheduler has to look for it.
// ============================================================

export const FOLLOWUP_MIN_MINUTES = 15;
/** 14 days — a nudge older than this is almost certainly unwanted, and
 *  well past WhatsApp's 24h free-form window anyway (text steps are
 *  blocked past 24h regardless — see `nextDueFollowup`). */
export const FOLLOWUP_MAX_MINUTES = 20_160;
export const FOLLOWUP_MAX_STEPS = 5;
export const FOLLOWUP_TEXT_MAXLEN = 1000;

/** Per-account objective for a follow-up sequence. The sweep stops
 *  nudging a conversation once the goal is reached. See migration 101. */
export const FOLLOWUP_GOALS = [
  'reply',
  'appointment',
  'deal_won',
  'quote_sent',
] as const;
export type FollowupGoal = (typeof FOLLOWUP_GOALS)[number];

/** Coerce an arbitrary value to a valid goal; unknown / missing → 'reply'. */
export function normalizeFollowupGoal(raw: unknown): FollowupGoal {
  return (FOLLOWUP_GOALS as readonly string[]).includes(raw as string)
    ? (raw as FollowupGoal)
    : 'reply';
}

export interface FollowupStep {
  /** Delay before this step fires, measured from the previous anchor:
   *  the customer's last inbound for step 0, the previous follow-up's
   *  send time for later steps. */
  after_minutes: number;
  type: 'text' | 'template';
  /** Free-form body for `type: 'text'`. Supports `{{nombre}}` /
   *  `{{name}}` placeholders (see `renderFollowupText`). */
  text: string;
  /** Approved WhatsApp template name for `type: 'template'`. */
  template_name: string;
  /** Template language tag (e.g. `es`, `en_US`); the send path tolerates
   *  the en/en_US split, so an empty string is acceptable. */
  template_language: string;
}

export type ParseFollowupsResult =
  | { ok: true; steps: FollowupStep[] }
  | { ok: false; error: string };

/**
 * Validate + normalize the `followups` array coming off the settings
 * form (or an API client) before it is persisted to `ai_configs`.
 * Tolerant of `undefined`/`null` (→ empty list); strict about shape so
 * the sweep never has to defend against a malformed step.
 */
export function parseFollowupSteps(raw: unknown): ParseFollowupsResult {
  if (raw == null) return { ok: true, steps: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'followups must be an array' };
  if (raw.length > FOLLOWUP_MAX_STEPS) {
    return { ok: false, error: `At most ${FOLLOWUP_MAX_STEPS} follow-up steps` };
  }

  const steps: FollowupStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object') {
      return { ok: false, error: `Step ${i + 1} is not an object` };
    }
    const rec = s as Record<string, unknown>;

    const type = rec.type === 'template' ? 'template' : 'text';

    let after = Number(rec.after_minutes);
    if (!Number.isFinite(after)) {
      return { ok: false, error: `Step ${i + 1}: "after_minutes" must be a number` };
    }
    after = Math.round(after);
    if (after < FOLLOWUP_MIN_MINUTES) after = FOLLOWUP_MIN_MINUTES;
    if (after > FOLLOWUP_MAX_MINUTES) after = FOLLOWUP_MAX_MINUTES;

    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    const templateName =
      typeof rec.template_name === 'string' ? rec.template_name.trim() : '';
    const templateLanguage =
      typeof rec.template_language === 'string' ? rec.template_language.trim() : '';

    if (type === 'text') {
      if (!text) return { ok: false, error: `Step ${i + 1}: message text is required` };
      if (text.length > FOLLOWUP_TEXT_MAXLEN) {
        return {
          ok: false,
          error: `Step ${i + 1}: message is over ${FOLLOWUP_TEXT_MAXLEN} characters`,
        };
      }
    } else if (!templateName) {
      return { ok: false, error: `Step ${i + 1}: choose a template` };
    }

    steps.push({
      after_minutes: after,
      type,
      text: type === 'text' ? text : '',
      template_name: type === 'template' ? templateName : '',
      template_language: type === 'template' ? templateLanguage : '',
    });
  }
  return { ok: true, steps };
}

/**
 * Fill `{{nombre}}` / `{{name}}` / `{{first_name}}` / `{{primer_nombre}}`
 * in a text-step body. An unknown placeholder is left untouched; a
 * missing contact name collapses the placeholder to nothing and tidies
 * the surrounding whitespace so "Hola {{nombre}}, " doesn't ship a
 * dangling comma.
 */
const PLACEHOLDER = /\{\{\s*(nombre|name|first_name|primer_nombre)\s*\}\}/gi;

export function renderFollowupText(
  body: string,
  vars: { contactName?: string | null },
): string {
  const full = (vars.contactName ?? '').trim();
  if (!full) {
    // No name to insert — swallow the placeholder together with an
    // adjacent comma and surrounding spaces so "Hola {{nombre}}, ¿..."
    // reads "Hola ¿..." rather than "Hola , ¿...".
    return body
      .replace(new RegExp(`\\s*,?\\s*${PLACEHOLDER.source}\\s*,?`, 'gi'), ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  const first = full.split(/\s+/)[0] ?? full;
  return body.replace(PLACEHOLDER, (_m, key: string) =>
    /first|primer/i.test(key) ? first : full,
  );
}

/** Local hour (0-23) of `date` read in `timeZone`. */
export function hourInTimeZone(date: Date, timeZone: string): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : 0;
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Is `date` inside the [startHour, endHour) local window? `0..24` with
 * `start === end` (or 0→24) means "no restriction". A window whose
 * start is after its end wraps past midnight (e.g. 20→6).
 */
export function withinBusinessHours(
  date: Date,
  timeZone: string,
  startHour: number,
  endHour: number,
): boolean {
  const s = Math.max(0, Math.min(24, Math.floor(startHour)));
  const e = Math.max(0, Math.min(24, Math.floor(endHour)));
  if (s === e) return true; // 8→8, 0→0, 24→24 : always open
  if (s === 0 && e === 24) return true;
  const h = hourInTimeZone(date, timeZone);
  return s < e ? h >= s && h < e : h >= s || h < e;
}

export interface NextDueArgs {
  steps: FollowupStep[];
  /** Instant of the contact's most recent inbound message. */
  lastCustomerAt: Date;
  /** Follow-up attempts already made in THIS silence streak (rows whose
   *  `sent_at` is after `lastCustomerAt`), oldest first. */
  priorLog: { stepIndex: number; sentAt: Date }[];
  now: Date;
  businessHoursOnly: boolean;
  windowStartHour: number;
  windowEndHour: number;
  timeZone: string;
}

/**
 * The single decision: given the streak so far, is there a follow-up
 * step whose delay has elapsed AND that is allowed to send right now?
 * Returns the step + its index, or null (nothing due / streak finished /
 * outside business hours / past the 24h window for a text step).
 */
export function nextDueFollowup(
  args: NextDueArgs,
): { stepIndex: number; step: FollowupStep } | null {
  const { steps, lastCustomerAt, priorLog, now } = args;
  const doneCount = priorLog.length;
  if (doneCount >= steps.length) return null; // streak finished

  const step = steps[doneCount];

  // Delay is measured from the previous anchor: last inbound for the
  // first nudge, the previous nudge's send time afterwards.
  const anchor =
    doneCount === 0
      ? lastCustomerAt
      : priorLog[doneCount - 1].sentAt;
  const dueAt = anchor.getTime() + step.after_minutes * 60_000;
  if (now.getTime() < dueAt) return null;

  // WhatsApp only allows free-form text within 24h of the customer's
  // last message; past that a template is the only thing that will
  // deliver, so a text step is simply skipped (permanently, for this
  // streak — the customer has to write again).
  if (
    step.type === 'text' &&
    now.getTime() - lastCustomerAt.getTime() > 24 * 60 * 60_000
  ) {
    return null;
  }

  if (
    args.businessHoursOnly &&
    !withinBusinessHours(now, args.timeZone, args.windowStartHour, args.windowEndHour)
  ) {
    return null;
  }

  return { stepIndex: doneCount, step };
}

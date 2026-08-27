// ============================================================
// System alert sink.
//
// `dispatchSystemAlert()` is the single entry point for every
// "something is operationally wrong" signal — a dead credential, a
// stale cron, a health check failing, an AI-spend anomaly. It:
//
//   1. upserts a row in `system_alerts`, deduped by `dedupKey` (one
//      active row per key; repeats bump `occurrences` instead of
//      opening new rows), and
//   2. fans the alert out to Telegram (primary) and email (fallback),
//      throttled so a flapping condition doesn't spam the channel.
//
// `resolveSystemAlert()` closes the active row for a key once the
// condition clears (e.g. the cron ran again), so a later recurrence
// opens a fresh alert + re-notifies.
//
// Best-effort throughout — it is called from error paths, so it never
// throws.
// ============================================================

import { platformAdminClient } from '@/lib/platform/admin-client';
import { sendEmail } from '@/lib/email/send';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface DispatchAlertInput {
  severity: AlertSeverity;
  /** Short machine tag for where this came from, e.g. 'cron_heartbeat',
   *  'ai_key_invalid', 'google_calendar', 'health'. */
  source: string;
  title: string;
  detail?: Record<string, unknown>;
  /** Stable identity for this condition — repeats with the same key
   *  fold into one active row. Include the subject (account id, cron
   *  name, …) so distinct subjects alert separately. */
  dedupKey: string;
  /** Tenant this concerns, when applicable. */
  accountId?: string | null;
  /** Don't re-notify a still-open alert more than once per this many
   *  minutes. Default 30. */
  throttleMinutes?: number;
}

const DEFAULT_THROTTLE_MIN = 30;
const TELEGRAM_TIMEOUT_MS = 8_000;

interface ActiveAlertRow {
  id: string;
  occurrences: number;
  notified_at: string | null;
}

export interface DispatchResult {
  /** True when THIS call opened a fresh alert row (vs. folding into an
   *  already-open one). The signal the triage bot keys off. */
  opened: boolean;
  /** True when this call fanned out to the notification channels. */
  notified: boolean;
  alertId: string | null;
}

const NOOP_RESULT: DispatchResult = { opened: false, notified: false, alertId: null };

/**
 * Record + (throttled) notify an operational alert. Never throws — on
 * any failure it returns `NOOP_RESULT`.
 */
export async function dispatchSystemAlert(
  input: DispatchAlertInput,
): Promise<DispatchResult> {
  const throttleMs = (input.throttleMinutes ?? DEFAULT_THROTTLE_MIN) * 60_000;
  try {
    const db = platformAdminClient();

    const { data: existing } = await db
      .from('system_alerts')
      .select('id, occurrences, notified_at')
      .eq('dedup_key', input.dedupKey)
      .is('resolved_at', null)
      .maybeSingle<ActiveAlertRow>();

    const nowIso = new Date().toISOString();
    let shouldNotify: boolean;
    let alertId: string;
    let opened = false;

    if (existing) {
      const lastNotified = existing.notified_at ? new Date(existing.notified_at).getTime() : 0;
      shouldNotify = Date.now() - lastNotified >= throttleMs;
      alertId = existing.id;
      await db
        .from('system_alerts')
        .update({
          severity: input.severity,
          title: input.title,
          detail: input.detail ?? {},
          last_seen_at: nowIso,
          occurrences: existing.occurrences + 1,
          ...(shouldNotify ? { notified_at: nowIso } : {}),
        })
        .eq('id', existing.id);
    } else {
      const { data: inserted, error: insErr } = await db
        .from('system_alerts')
        .insert({
          severity: input.severity,
          source: input.source,
          title: input.title,
          detail: input.detail ?? {},
          dedup_key: input.dedupKey,
          account_id: input.accountId ?? null,
          notified_at: nowIso,
        })
        .select('id')
        .single();
      if (insErr) {
        // Lost the race against a concurrent dispatch for the same key
        // (the partial unique index rejected the second insert). Bump
        // the winner instead; skip notifying (the winner just did).
        if (insErr.code === '23505') {
          await db
            .from('system_alerts')
            .update({ last_seen_at: nowIso })
            .eq('dedup_key', input.dedupKey)
            .is('resolved_at', null);
          return NOOP_RESULT;
        }
        console.error('[alerts] insert failed:', insErr.message);
        return NOOP_RESULT;
      }
      alertId = inserted.id as string;
      shouldNotify = true;
      opened = true;
    }

    let notified = false;
    if (shouldNotify) {
      notified = await notify(input, alertId)
        .then(() => true)
        .catch((err) => {
          console.error('[alerts] notify failed:', err instanceof Error ? err.message : err);
          return false;
        });
    }
    return { opened, notified, alertId };
  } catch (err) {
    console.error('[alerts] dispatch threw:', err instanceof Error ? err.message : err);
    return NOOP_RESULT;
  }
}

/**
 * Close the active alert for `dedupKey`, if any. Call when the
 * condition clears so a future recurrence notifies again.
 */
export async function resolveSystemAlert(dedupKey: string): Promise<void> {
  try {
    await platformAdminClient()
      .from('system_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('dedup_key', dedupKey)
      .is('resolved_at', null);
  } catch (err) {
    console.error('[alerts] resolve threw:', err instanceof Error ? err.message : err);
  }
}

// ---- notification channels --------------------------------------------

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🔴',
};

async function notify(input: DispatchAlertInput, alertId: string): Promise<void> {
  const lines = [
    `${SEVERITY_ICON[input.severity]} *${input.severity.toUpperCase()}* — ${input.title}`,
    `source: ${input.source}`,
    input.accountId ? `account: ${input.accountId}` : null,
    input.detail && Object.keys(input.detail).length
      ? '```\n' + JSON.stringify(input.detail, null, 2).slice(0, 1500) + '\n```'
      : null,
    `alert id: ${alertId}`,
  ].filter(Boolean) as string[];
  const text = lines.join('\n');

  await Promise.allSettled([sendTelegramMessage(text), sendEmailAlert(input, text)]);
}

/**
 * Post a raw message to the ops Telegram channel. Shared by the alert
 * fan-out and the triage bot. Returns false (no throw) when Telegram
 * isn't configured; throws on an actual API failure.
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
  if (!token || !chatId) return false; // not configured — silently skip

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

async function sendEmailAlert(input: DispatchAlertInput, text: string): Promise<void> {
  const to = process.env.ALERTS_EMAIL?.trim();
  if (!to) return; // not configured — Telegram-only

  // Only email for warning+ to keep the inbox useful; info stays in the
  // table + Telegram.
  if (input.severity === 'info') return;

  await sendEmail({
    account: 'support',
    to,
    subject: `[${input.severity}] ${input.title}`,
    text: text.replace(/[*`]/g, ''),
  });
}

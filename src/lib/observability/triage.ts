// ============================================================
// AI triage bot — advisory only.
//
// When a fresh operational alert opens (see `dispatchSystemAlert` →
// `opened: true`), `runAlertTriage()` gathers the surrounding
// telemetry, asks a platform-level LLM "what is most likely wrong and
// what should a human check", and posts the answer into the same
// Telegram channel as a follow-up to the alert.
//
// It NEVER changes code, config, or data and it never opens PRs. It is
// a second pair of eyes that types its notes into the channel — the
// human still drives the fix (docs/RUNBOOK.md).
//
// Uses its OWN key, separate from every account's BYO AI key:
//   OPS_AI_PROVIDER   'anthropic' | 'openai'   (default 'anthropic')
//   OPS_AI_API_KEY    platform key for that provider
//   OPS_AI_MODEL      model id (defaults per provider below)
// Unset OPS_AI_API_KEY → triage is a silent no-op, exactly like an
// unconfigured Telegram channel.
// ============================================================

import { platformAdminClient } from '@/lib/platform/admin-client';
import { generateAnthropic } from '@/lib/ai/providers/anthropic';
import { generateOpenAi } from '@/lib/ai/providers/openai';
import type { ProviderArgs } from '@/lib/ai/providers/shared';
import { sendTelegramMessage } from './alerts';
import { HEARTBEATS } from './heartbeat';

const DEFAULT_MODEL = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o-mini',
} as const;

const TRIAGE_TIMEOUT_MS = 30_000;

export interface TriageAlert {
  severity: 'info' | 'warning' | 'critical';
  source: string;
  title: string;
  detail?: Record<string, unknown> | null;
  dedupKey: string;
  alertId?: string | null;
}

interface OpsAiConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
}

function loadOpsAiConfig(): OpsAiConfig | null {
  const apiKey = process.env.OPS_AI_API_KEY?.trim();
  if (!apiKey) return null;
  const provider =
    process.env.OPS_AI_PROVIDER?.trim() === 'openai' ? 'openai' : 'anthropic';
  const model = process.env.OPS_AI_MODEL?.trim() || DEFAULT_MODEL[provider];
  return { provider, apiKey, model };
}

/** Small, bounded telemetry snapshot to ground the model. */
async function gatherContext(): Promise<string> {
  const db = platformAdminClient();
  const lines: string[] = [];

  try {
    const { data: hb } = await db
      .from('system_heartbeats')
      .select('name, last_run_at, last_status, last_detail, expected_interval_seconds, runs_total');
    lines.push('HEARTBEATS (expected jobs: ' + Object.keys(HEARTBEATS).join(', ') + '):');
    for (const name of Object.keys(HEARTBEATS)) {
      const row = (hb ?? []).find((r) => r.name === name);
      if (!row) {
        lines.push(`  - ${name}: NEVER RECORDED`);
        continue;
      }
      const ageMin = Math.round(
        (Date.now() - new Date(row.last_run_at).getTime()) / 60000,
      );
      lines.push(
        `  - ${name}: last ${ageMin}m ago, status=${row.last_status}` +
          (row.last_detail ? `, detail="${String(row.last_detail).slice(0, 120)}"` : '') +
          `, runs_total=${row.runs_total}`,
      );
    }
  } catch {
    lines.push('HEARTBEATS: (could not read)');
  }

  try {
    const { data: open } = await db
      .from('system_alerts')
      .select('severity, source, title, occurrences, first_seen_at, last_seen_at')
      .is('resolved_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(15);
    lines.push('');
    lines.push(`OPEN ALERTS (${open?.length ?? 0}):`);
    for (const a of open ?? []) {
      lines.push(
        `  - [${a.severity}] ${a.source}: ${a.title} (x${a.occurrences}, since ${a.first_seen_at})`,
      );
    }
  } catch {
    lines.push('OPEN ALERTS: (could not read)');
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are the on-call operations diagnostician for SANDÍA, a multi-tenant
WhatsApp CRM built on Next.js 16 + Supabase, deployed as a single
container on EasyPanel. Background jobs run via Supabase pg_cron calling
secret-gated /api/**/cron routes. There is a recovery runbook at
docs/RUNBOOK.md with sections: 1 app down, 2 database down, 3 missing env
var, 4 per-function failures, 5 cron/heartbeat recovery, 6 credential
rotation, 8 escalation.

Given ONE alert plus a telemetry snapshot, reply with THREE short
sections, plain text, no markdown headers, under 180 words total:
CAUSE: the single most likely root cause, stated plainly.
CHECK: 2-4 concrete things a human should verify now, each naming the
tool/place (EasyPanel logs, Supabase SQL, the cron.job table, an env
var name) and the relevant RUNBOOK section number.
FIX: the most probable remedy, and whether it is safe to apply directly
or needs a human decision.
Do not invent facts not supported by the input. If the cause is
genuinely unclear, say so and list what additional signal would
disambiguate.`;

/**
 * Diagnose one alert and post the result to Telegram. Best-effort:
 * returns the diagnosis text on success, null if triage is not
 * configured or anything failed. Never throws.
 */
export async function runAlertTriage(alert: TriageAlert): Promise<string | null> {
  const cfg = loadOpsAiConfig();
  if (!cfg) return null;

  try {
    const context = await gatherContext();
    const userMsg =
      `ALERT\n` +
      `severity: ${alert.severity}\n` +
      `source: ${alert.source}\n` +
      `title: ${alert.title}\n` +
      `dedup_key: ${alert.dedupKey}\n` +
      (alert.detail && Object.keys(alert.detail).length
        ? `detail: ${JSON.stringify(alert.detail).slice(0, 1200)}\n`
        : '') +
      `\nTELEMETRY\n${context}`;

    const args: ProviderArgs = {
      apiKey: cfg.apiKey,
      model: cfg.model,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
      timeoutMs: TRIAGE_TIMEOUT_MS,
    };

    const { text } =
      cfg.provider === 'openai'
        ? await generateOpenAi(args)
        : await generateAnthropic(args);

    const diagnosis = text.trim();
    if (!diagnosis) return null;

    const header = `🩺 *TRIAGE* — ${alert.title}` +
      (alert.alertId ? `\nalert id: ${alert.alertId}` : '') +
      `\nmodel: ${cfg.provider}/${cfg.model}\n`;
    await sendTelegramMessage(header + '```\n' + diagnosis.slice(0, 3500) + '\n```').catch(
      (err) => console.error('[triage] telegram post failed:', err instanceof Error ? err.message : err),
    );

    return diagnosis;
  } catch (err) {
    console.error('[triage] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** True when OPS_AI_API_KEY is set — lets callers skip the work entirely. */
export function isTriageConfigured(): boolean {
  return Boolean(process.env.OPS_AI_API_KEY?.trim());
}

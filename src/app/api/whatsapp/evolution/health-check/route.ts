// ============================================================
// /api/whatsapp/evolution/health-check
//
// Evolution Go's whatsmeow session can go silently dead (network
// blip, DNS hiccup on its host, stale websocket) without ever firing
// a 'Disconnected'/'LoggedOut' webhook — confirmed live: a session
// sat disconnected for ~3 hours with zero CONNECTION events reaching
// wacrm, while whatsapp_config.status stayed 'connected' the entire
// time (no inbound message can arrive to trigger anything either, so
// nothing else in the app would ever notice). This cron closes that
// gap by polling Evolution Go's own GET /instance/status directly —
// see migration 041 for the backoff-tracking columns.
//
// Auth: same shared-secret pattern as /api/automations/cron
// (`x-cron-secret` header against AUTOMATION_CRON_SECRET) — this is
// operational plumbing, not a second secret to provision.
//
// Deliberately conservative about what it does on a disconnect, per
// the "don't get the number banned" concern this was built to answer:
//   - Never creates a new instance or re-pairs — only resumes an
//     already-paired session via connectInstance, the same call a
//     normal WhatsApp client makes on its own after a network drop.
//   - Backs off between reconnect attempts (5 / 10 / 20 / 30min,
//     capped) instead of retrying every run, so a prolonged outage on
//     the Evolution Go host doesn't turn into a retry storm.
//   - Never retries a `loggedIn: false` instance — that means WhatsApp
//     itself revoked the pairing, and connectInstance can't fix that;
//     it just flips the DB status so the UI stops lying and stops.
// ============================================================

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstanceStatus, connectInstance } from '@/lib/whatsapp/evolution-api'

// Minutes to wait before the Nth reconnect attempt (0-indexed by
// evolution_reconnect_attempt_count), capped at the last entry so a
// standing outage settles into a steady 30min poll instead of
// escalating forever.
const BACKOFF_MINUTES = [5, 10, 20, 30]

interface EvolutionConfigRow {
  id: string
  account_id: string
  evolution_api_url: string
  evolution_instance_token: string
  status: string
  evolution_reconnect_attempt_count: number
  evolution_last_reconnect_attempt_at: string | null
}

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A reconnect needs a webhook URL to re-register — same one saved
  // at connect time (see ../route.ts). There's no per-request Origin
  // to derive it from here (this is a server-to-server cron hit), so
  // this deployment must have it configured explicitly.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_SITE_URL not configured — cannot rebuild webhook URL for reconnects' },
      { status: 503 }
    )
  }
  const webhookUrl = `${siteUrl}/api/whatsapp/webhook/evolution`

  const admin = supabaseAdmin()
  const { data: configs, error } = await admin
    .from('whatsapp_config')
    .select(
      'id, account_id, evolution_api_url, evolution_instance_token, status, evolution_reconnect_attempt_count, evolution_last_reconnect_attempt_at'
    )
    .eq('provider', 'evolution')
    .not('evolution_instance_uuid', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!configs || configs.length === 0) return NextResponse.json({ checked: 0 })

  const results = await Promise.all(
    (configs as EvolutionConfigRow[]).map((config) => checkAndHeal(config, webhookUrl))
  )

  return NextResponse.json({
    checked: results.length,
    connected: results.filter((r) => r === 'connected').length,
    reconnect_attempted: results.filter((r) => r === 'reconnect_attempted').length,
    backing_off: results.filter((r) => r === 'backing_off').length,
    logged_out: results.filter((r) => r === 'logged_out').length,
    skipped: results.filter((r) => r === 'skipped').length,
  })
}

type CheckOutcome =
  | 'connected'
  | 'reconnect_attempted'
  | 'backing_off'
  | 'logged_out'
  | 'skipped'

async function checkAndHeal(
  config: EvolutionConfigRow,
  webhookUrl: string
): Promise<CheckOutcome> {
  const admin = supabaseAdmin()

  let instanceToken: string
  try {
    instanceToken = decrypt(config.evolution_instance_token)
  } catch (err) {
    console.error(`[evolution-health-check] decrypt failed for config ${config.id}:`, err)
    return 'skipped'
  }

  let status: { connected: boolean; loggedIn: boolean }
  try {
    status = await getInstanceStatus({ apiUrl: config.evolution_api_url, instanceToken })
  } catch (err) {
    // Can't reach Evolution Go itself (host down, DNS, etc.) — nothing
    // to act on this run; don't touch reconnect bookkeeping or status,
    // next run will try again.
    console.warn(
      `[evolution-health-check] status check unreachable for config ${config.id}:`,
      err instanceof Error ? err.message : err
    )
    return 'skipped'
  }

  if (status.connected) {
    if (config.status !== 'connected' || config.evolution_reconnect_attempt_count > 0) {
      await admin
        .from('whatsapp_config')
        .update({
          status: 'connected',
          connected_at: new Date().toISOString(),
          evolution_reconnect_attempt_count: 0,
          evolution_last_reconnect_attempt_at: null,
        })
        .eq('id', config.id)
    }
    return 'connected'
  }

  if (!status.loggedIn) {
    // WhatsApp itself revoked the pairing — connectInstance can't fix
    // this, it needs a fresh QR scan from Settings. Stop retrying and
    // make the DB status honest.
    if (config.status !== 'disconnected') {
      await admin
        .from('whatsapp_config')
        .update({
          status: 'disconnected',
          evolution_reconnect_attempt_count: 0,
          evolution_last_reconnect_attempt_at: null,
        })
        .eq('id', config.id)
      console.warn(
        `[evolution-health-check] config ${config.id} logged out — needs re-pairing, not retrying`
      )
    }
    return 'logged_out'
  }

  // loggedIn but not connected: a live, still-paired session whose
  // socket dropped — the exact case a normal WhatsApp client resumes
  // from on its own. Respect backoff before poking it again.
  const backoffMinutes =
    BACKOFF_MINUTES[Math.min(config.evolution_reconnect_attempt_count, BACKOFF_MINUTES.length - 1)]
  const lastAttempt = config.evolution_last_reconnect_attempt_at
    ? new Date(config.evolution_last_reconnect_attempt_at).getTime()
    : null
  if (lastAttempt !== null && Date.now() - lastAttempt < backoffMinutes * 60_000) {
    return 'backing_off'
  }

  try {
    await connectInstance({ apiUrl: config.evolution_api_url, instanceToken, webhookUrl })
    console.warn(`[evolution-health-check] reconnected config ${config.id} after socket drop`)
  } catch (err) {
    console.error(
      `[evolution-health-check] reconnect attempt failed for config ${config.id}:`,
      err instanceof Error ? err.message : err
    )
    // Still counts as an attempt for backoff purposes either way —
    // otherwise a persistently-failing reconnect would retry every run.
  }

  await admin
    .from('whatsapp_config')
    .update({
      evolution_last_reconnect_attempt_at: new Date().toISOString(),
      evolution_reconnect_attempt_count: config.evolution_reconnect_attempt_count + 1,
    })
    .eq('id', config.id)

  return 'reconnect_attempted'
}

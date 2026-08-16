import type { CronHeartbeat } from './repo/cron-heartbeats.repo'
import { sendWhatsAppAdminAlert } from '../notifications/whatsapp-admin-alert'

// ============================================================
// Shared "is this cron still alive" check for the app's internal
// x-cron-secret-gated cron endpoints. See migration
// 044_cron_heartbeats.sql for the underlying table.
//
// IMPORTANT LIMITATION, documented rather than hidden: this only runs
// from WITHIN a cron invocation. If the scheduler itself is never
// provisioned (or stops firing entirely), this code never executes and
// no alert fires — catching THAT case needs an external monitor
// (crontab health-check ping, an uptime service hitting a
// "did-it-run-at-all" endpoint), out of scope for this repo. What this
// DOES catch: the cron firing on schedule but failing before reaching
// its own heartbeat write (auth misconfiguration, a persistent DB
// outage, a bug) — each such failure leaves the previous heartbeat
// aging, and the next invocation that at least reaches this check
// reports the growing gap.
// ============================================================

export interface CheckCronStalenessOptions {
  cronName: string
  /** How long the gap since the last recorded success may grow before
   *  this fires an alert. Pick ~3x the cron's intended schedule
   *  interval — tolerates one missed tick (a deploy restart, one slow
   *  invocation) without a false positive, while still catching a
   *  genuinely broken scheduler well within an hour. */
  thresholdMs: number
  previousHeartbeat: CronHeartbeat | null
  now?: Date
}

/**
 * Compares `previousHeartbeat.lastSuccessAt` (read BEFORE this
 * invocation records its own) against `now`. Fires a loud admin alert
 * when the gap exceeds `thresholdMs`. Never throws — a failure to
 * alert must not fail the cron response, the sweep this guards may
 * already have completed successfully by the time this runs.
 *
 * No per-account context to scope the alert to (these crons are
 * cross-account operational sweeps, not tied to one WhatsApp Business
 * number) — uses `AISDR_ALERT_ACCOUNT_ID` if set, otherwise logs the
 * impossibility loudly instead of guessing an account.
 */
export async function checkCronStaleness(opts: CheckCronStalenessOptions): Promise<void> {
  const { cronName, thresholdMs, previousHeartbeat, now = new Date() } = opts

  try {
    if (!previousHeartbeat) {
      // No prior successful run recorded — expected on the very first
      // deploy of a cron; not alerted (nothing to compare against
      // yet), but logged so it's visible during rollout.
      console.log(`[${cronName}] sem heartbeat anterior registado (primeira execução?).`)
      return
    }

    const gapMs = now.getTime() - previousHeartbeat.lastSuccessAt.getTime()
    if (gapMs <= thresholdMs) return

    const gapMinutes = Math.round(gapMs / 60_000)
    const message =
      `[${cronName}] SEM execução bem sucedida há ${gapMinutes} minutos ` +
      `(limiar: ${Math.round(thresholdMs / 60_000)} min) — última em ` +
      `${previousHeartbeat.lastSuccessAt.toISOString()}. Verificar o agendamento do cron ` +
      '(x-cron-secret / AUTOMATION_CRON_SECRET) e os logs recentes.'
    console.error(message)

    const accountId = process.env.AISDR_ALERT_ACCOUNT_ID
    if (!accountId) {
      console.error(
        `[${cronName}] AISDR_ALERT_ACCOUNT_ID não configurada — alerta de heartbeat parado ` +
          'apenas no log acima, sem envio por WhatsApp.',
      )
      return
    }

    await sendWhatsAppAdminAlert(message, { accountId })
  } catch (err) {
    console.error(`[${cronName}] staleness check itself failed:`, err)
  }
}

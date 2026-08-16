import type { SupabaseClient } from '@supabase/supabase-js'
import {
  claimForwardAttempt,
  claimFailedForwardForRetry,
  findForwardedByApprovalId,
  getFailedForwardsForRetry,
  insertSkippedDuplicateForward,
  markForwardFailed,
  markForwardForwarded,
  type AisdrForwardDecision,
} from '@/lib/eter/repo/aisdr-approval-forwards.repo'
import { alertAisdrApprovalForwardFailed } from '@/lib/notifications/aisdr-approval-alert'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// ============================================================
// Forwards the Ricardo's WhatsApp button decisions ([Enviar]/
// [Descartar]) on AI SDR approval requests to the AI SDR worker's
// POST /api/approvals/decision.
//
// Contract with the AI SDR worker (confirmed by reading
// tools/ai-sdr/src/approvals.ts, src/index.ts and the button ids the
// old tools/eter-whatsapp-agent/src/approvals.ts used to send):
//   - Button reply ids: `aisdr_send_{approval_id}` / `aisdr_discard_{approval_id}`.
//   - POST {AI_SDR_WORKER_URL}/api/approvals/decision
//     headers: Content-Type: application/json, X-Approvals-Secret: <raw secret>
//     body: { approval_id: number, decision: 'send' | 'discard' }
//   - The AI SDR endpoint is itself idempotent by pending_approval
//     state (ACTIONABLE_APPROVAL_STATES) — a second decision on an
//     already-resolved approval returns 200 { ok: true, already: state }
//     rather than erroring. That does NOT remove the need for
//     idempotency on this side: it protects the AI SDR's own data, not
//     this repo's obligation to not hammer it or lose track of a failed
//     attempt (see aisdr_approval_forwards, migration 042).
// ============================================================

const BUTTON_ID_PATTERN = /^aisdr_(send|discard)_(\d+)$/

export interface ParsedApprovalButton {
  decision: AisdrForwardDecision
  approvalId: number
}

/** Parses `aisdr_send_{id}` / `aisdr_discard_{id}`. Returns null for
 *  any button id that doesn't match this exact shape. */
export function parseApprovalButtonId(buttonId: string): ParsedApprovalButton | null {
  const match = buttonId.match(BUTTON_ID_PATTERN)
  if (!match) return null
  const approvalId = Number(match[2])
  if (!Number.isSafeInteger(approvalId)) return null
  return { decision: match[1] as AisdrForwardDecision, approvalId }
}

let loggedForwardFlagState = false

/**
 * Feature flag gate — off by default. Lets the forwarding behaviour be
 * disabled without reverting any code (required by spec).
 *
 * Logs its resolved state loudly, once per process (module-scope
 * guard — cheap and correct enough for a serverless cold start, which
 * is the closest thing this app has to a "startup" hook). A flag
 * silently left off (or on) in production was exactly how 9 approvals
 * sat stuck for days before this feature existed at all — this makes
 * that state impossible to miss in the logs, in either direction.
 */
export function isAisdrApprovalForwardEnabled(): boolean {
  const enabled = (process.env.AISDR_APPROVAL_FORWARD_ENABLED ?? 'false').toLowerCase() === 'true'
  if (!loggedForwardFlagState) {
    loggedForwardFlagState = true
    console.log(
      `[aisdr-approval-forward] AISDR_APPROVAL_FORWARD_ENABLED=${enabled ? 'true (a reencaminhar aprovações)' : 'false (DESLIGADO — botões [Enviar]/[Descartar] não são reencaminhados)'}`,
    )
  }
  return enabled
}

// ============================================================
// Authorized-sender allowlist (forgery fix).
//
// The webhook guard used to accept ANY inbound `interactive` message
// whose `button_reply.id` matched the `aisdr_(send|discard)_{id}`
// shape, with no check on who sent it. `approval_id` is a small
// sequential integer — trivially guessable — so anyone who controls a
// WhatsApp number and can craft a raw protocol message (an unofficial
// WhatsApp library, not the Business API) could forge a
// [Enviar]/[Descartar] decision and make the AI SDR send or discard a
// real message to a real lead. This allowlist is the primary fix:
// only a sender phone number Ricardo has explicitly configured may
// ever reach `forwardApprovalDecision`.
//
// Fails CLOSED by design: an unset/empty AISDR_APPROVER_PHONES
// rejects every sender, never "allow everyone". A misconfiguration
// here must silently break approvals (loud in logs, fixable by
// setting the env var), never silently open the forgery hole back up.
// ============================================================

let loggedMissingApproverPhones = false

/**
 * Parses `AISDR_APPROVER_PHONES` (comma-separated phone numbers, any
 * formatting — normalized the same way inbound `message.from` is) into
 * a normalized allowlist. Returns null when unset or empty — callers
 * MUST treat null as "reject every sender", never as "allow everyone".
 *
 * Logs a loud, one-time warning per process when the flag
 * (`AISDR_APPROVAL_FORWARD_ENABLED`) is on but this is missing, so a
 * forgotten env var in production is never silent — approvals simply
 * stop working instead of accepting forged decisions.
 */
export function getAuthorizedApproverPhones(): Set<string> | null {
  const raw = process.env.AISDR_APPROVER_PHONES
  if (!raw || !raw.trim()) {
    if (isAisdrApprovalForwardEnabled() && !loggedMissingApproverPhones) {
      loggedMissingApproverPhones = true
      console.error(
        '[aisdr-approval-forward] SEGURANÇA: AISDR_APPROVAL_FORWARD_ENABLED está activa mas ' +
          'AISDR_APPROVER_PHONES não está configurada — TODAS as tentativas de aprovação AI SDR ' +
          'via WhatsApp serão recusadas até a variável ser definida (ver docs/eter-agent-config.md).',
      )
    }
    return null
  }
  const phones = raw
    .split(',')
    .map((p) => normalizePhone(p.trim()))
    .filter(Boolean)
  return new Set(phones)
}

/**
 * True when `fromPhone` (the WhatsApp sender of the interactive tap)
 * is on the authorized-approvers allowlist. Fails closed: an
 * unconfigured or empty allowlist rejects every sender, even a
 * correctly-shaped `aisdr_send_{id}` button id.
 */
export function isAuthorizedApprover(fromPhone: string): boolean {
  const allowed = getAuthorizedApproverPhones()
  if (!allowed || allowed.size === 0) return false
  return allowed.has(normalizePhone(fromPhone))
}

// ============================================================
// Context-id verification — PREPARED BUT INACTIVE.
//
// `message.context.id` (the wamid of the message this interactive tap
// replies to — the webhook route already uses the same field to
// resolve swipe-reply parents, see `lookupInternalIdByMetaId`) would
// let us additionally require that the tap actually replies to the
// specific approval message we sent for `approvalId`, closing the
// residual gap the allowlist alone doesn't cover (an authorized
// approver's own number being used to approve/discard a DIFFERENT,
// unrelated approval than the one they meant to act on).
//
// This is not wired up to reject anything today: this repo has no
// stored mapping from `approval_id` to the wamid of the outbound
// approval message. That message is sent by a DIFFERENT service
// (the AI SDR worker's `requestApproval`, tools/ai-sdr/src/approvals.ts,
// posts to `WHATSAPP_AGENT_URL/api/approvals`) — `aisdr_approval_forwards`
// (migration 042) only records the wamid of the REPLY tap, not the
// original outbound message. Wiring this up for real would need
// either the AI SDR worker to report back the outbound wamid when it
// sends the approval message (a new callback / column), or this repo
// to look it up from `messages` by content pattern (fragile).
//
// Documented decision: NOT built in this pass — the allowlist above
// already closes the exploitable vector (an unauthorized sender can
// never reach here at all), and a new cross-repo contract felt like
// too much for this fix. See the report for the follow-up
// recommendation. `verifyApprovalContext` always returns
// 'unverifiable' until that's wired up; the caller logs the result for
// future audit but never rejects solely on it.
// ============================================================

export type ApprovalContextVerification = 'not_provided' | 'unverifiable' | 'match' | 'mismatch'

export function verifyApprovalContext(
  contextMessageId: string | undefined,
  // Not read yet — see the doc comment above. Kept in the signature so
  // call sites are already shaped for when this is wired up for real.
  approvalId: number,
): ApprovalContextVerification {
  void approvalId
  if (!contextMessageId) return 'not_provided'
  return 'unverifiable'
}

// Per-attempt timeout for the outbound call to the AI SDR worker.
const REQUEST_TIMEOUT_MS = 10_000
// Retries WITHIN one attempt group (one webhook delivery, or one
// reprocessing-cron pickup). >= 3 per the spec.
const ATTEMPT_GROUP_TRIES = 3
const BACKOFF_MS = [500, 1500]
// Attempt GROUPS (webhook delivery counts as 1, each reprocessing-cron
// pickup counts as 1 more) before a `failed` row is given up on for
// good (`gave_up`, terminal — see migration 042).
const MAX_QUEUE_ATTEMPTS = 5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One attempt group: up to ATTEMPT_GROUP_TRIES tries, each with its own
 * timeout, exponential backoff between tries. Throws the last error if
 * every try fails.
 */
async function sendDecisionWithRetries(
  approvalId: number,
  decision: AisdrForwardDecision,
): Promise<void> {
  const workerUrl = process.env.AI_SDR_WORKER_URL
  const secret = process.env.APPROVALS_CALLBACK_SECRET
  if (!workerUrl || !secret) {
    throw new Error(
      'AI_SDR_WORKER_URL / APPROVALS_CALLBACK_SECRET não configurados — ver .env.local.example',
    )
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPT_GROUP_TRIES; attempt++) {
    try {
      const res = await fetch(`${workerUrl}/api/approvals/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Approvals-Secret': secret,
        },
        body: JSON.stringify({ approval_id: approvalId, decision }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.ok) return
      const body = await res.text().catch(() => '')
      lastError = new Error(`AI SDR devolveu ${res.status}: ${body}`)
    } catch (err) {
      lastError =
        err instanceof Error && err.name === 'TimeoutError'
          ? new Error(`timeout (${REQUEST_TIMEOUT_MS}ms) a contactar o AI SDR (${workerUrl})`)
          : err
    }

    if (attempt < ATTEMPT_GROUP_TRIES) {
      await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1])
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export interface ForwardApprovalDecisionInput {
  accountId: string
  /** WhatsApp message id of the button tap — the idempotency key
   *  against Meta redelivering the same webhook. */
  waMessageId: string
  approvalId: number
  decision: AisdrForwardDecision
}

export type ForwardApprovalDecisionOutcome = 'forwarded' | 'skipped_duplicate' | 'failed_queued'

/**
 * Forward one button-tap decision to the AI SDR worker, with the two
 * idempotency guards described in migration 042 and a persistent
 * failure queue (never a mute best-effort fire-and-forget).
 *
 * Called from the webhook route BEFORE the normal inbound cascade —
 * see src/app/api/whatsapp/webhook/route.ts. Never throws: every
 * failure path ends in a queued row + alert, not an exception the
 * caller has to handle.
 */
export async function forwardApprovalDecision(
  db: SupabaseClient,
  input: ForwardApprovalDecisionInput,
): Promise<ForwardApprovalDecisionOutcome> {
  // Idempotency guard #2 — double-tap: this approval_id already has a
  // successfully forwarded decision (possibly under a different
  // wa_message_id). Never forward the same decision twice, even if the
  // AI SDR's own endpoint would tolerate it.
  const alreadyForwarded = await findForwardedByApprovalId(db, input.approvalId)
  if (alreadyForwarded) {
    await insertSkippedDuplicateForward(db, input)
    console.log(
      `[aisdr-approval-forward] approval ${input.approvalId} já reencaminhada ` +
        `(wa_message_id=${alreadyForwarded.waMessageId}) — ignorando novo toque duplicado.`,
    )
    return 'skipped_duplicate'
  }

  // Idempotency guard #1 — Meta redelivery: claim this exact
  // wa_message_id before attempting the HTTP call.
  const claim = await claimForwardAttempt(db, input)
  if (!claim.created) {
    console.log(
      `[aisdr-approval-forward] wa_message_id=${input.waMessageId} já processado ` +
        `(estado=${claim.row.status}) — webhook duplicado do Meta ignorado.`,
    )
    return claim.row.status === 'forwarded' ? 'forwarded' : 'skipped_duplicate'
  }

  try {
    await sendDecisionWithRetries(input.approvalId, input.decision)
    await markForwardForwarded(db, claim.row.id)
    console.log(
      `[aisdr-approval-forward] approval ${input.approvalId} (${input.decision}) reencaminhada com sucesso.`,
    )
    return 'forwarded'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markForwardFailed(db, claim.row.id, message)
    console.error(
      `[aisdr-approval-forward] falha a reencaminhar approval ${input.approvalId} após ` +
        `${ATTEMPT_GROUP_TRIES} tentativas — em fila para reprocessamento:`,
      message,
    )
    await alertAisdrApprovalForwardFailed({
      approvalId: input.approvalId,
      decision: input.decision,
      waMessageId: input.waMessageId,
      attempts: claim.row.attempts,
      error: message,
      gaveUp: false,
      accountId: input.accountId,
    })
    return 'failed_queued'
  }
}

export interface ReprocessResult {
  attempted: number
  recovered: number
  stillFailing: number
  gaveUp: number
}

/**
 * Reprocessing sweep for `failed` rows — called from the cron route
 * (src/app/api/eter-agent/aisdr-approvals/cron/route.ts). Claims each
 * row (`failed` -> `pending`, guarded by status so overlapping
 * invocations can't double-retry the same row), attempts another full
 * ATTEMPT_GROUP_TRIES-try group, and either marks it forwarded, requeues
 * it as `failed` again, or gives up (`gave_up`, terminal, fresh alert)
 * once MAX_QUEUE_ATTEMPTS attempt groups have been spent on it.
 *
 * Each row's entire handling is wrapped so one row's unexpected failure
 * (e.g. a transient DB error writing its own outcome) can never abort
 * the sweep or skip the rest of the batch — same pattern as
 * /api/eter-agent/cron.
 */
export async function reprocessFailedApprovalForwards(
  db: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<ReprocessResult> {
  const due = await getFailedForwardsForRetry(db, opts)
  let recovered = 0
  let stillFailing = 0
  let gaveUp = 0

  for (const row of due) {
    try {
      const claimed = await claimFailedForwardForRetry(db, row.id, row.attempts)
      if (!claimed) continue // lost the claim race to another invocation

      try {
        await sendDecisionWithRetries(claimed.approvalId, claimed.decision)
        await markForwardForwarded(db, claimed.id)
        recovered++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const giveUp = claimed.attempts >= MAX_QUEUE_ATTEMPTS
        await markForwardFailed(db, claimed.id, message, { giveUp })
        if (giveUp) {
          gaveUp++
          console.error(
            `[aisdr-approval-forward] approval ${claimed.approvalId} desistido após ` +
              `${claimed.attempts} tentativas — precisa de intervenção manual.`,
          )
        } else {
          stillFailing++
        }
        await alertAisdrApprovalForwardFailed({
          approvalId: claimed.approvalId,
          decision: claimed.decision,
          waMessageId: claimed.waMessageId,
          attempts: claimed.attempts,
          error: message,
          // Explicit key, not shorthand: the outer `gaveUp` COUNTER
          // (incremented just above) shadows the local `giveUp`
          // boolean under shorthand-property resolution — using
          // `{ gaveUp }` here silently sent the running tally instead
          // of this row's outcome. Caught by the reprocessing cron
          // unit tests.
          gaveUp: giveUp,
          accountId: claimed.accountId,
        })
      }
    } catch (err) {
      console.error('[aisdr-approval-forward] erro irrecuperável a reprocessar linha', row.id, err)
      stillFailing++
    }
  }

  return { attempted: due.length, recovered, stillFailing, gaveUp }
}

import { getLeadQualification, upsertLeadQualification } from '@/lib/eter/repo/lead-qualification.repo'
import { createAgentNotification } from '@/lib/eter/repo/notifications.repo'
import {
  computeQualification,
  parseStoredDimensions,
  urgencyFromDimension,
  DIMENSIONS,
  type Dimension,
  type DimensionScore,
} from '@/lib/eter/lead-scoring'
import { scheduleFollowUpCadence } from '@/lib/eter/followups'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalInteger, optionalString, ToolInputError } from './parse-input'

/** Case/whitespace-insensitive — `stage` is free-form text (see
 *  migration 037's design note), so "morno", "Morno", " morno " all
 *  mean the same qualification bucket for cadence-scheduling purposes.
 *  Since `computeQualification` writes `stage` as exactly one of
 *  'frio' | 'morno' | 'quente', this mostly guards against any legacy
 *  row written before this handler existed. */
function normalizeStage(stage: string | null | undefined): string | null {
  return stage ? stage.trim().toLowerCase() : null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseDimensionScore(value: unknown, dimension: Dimension): DimensionScore {
  const n = typeof value === 'number' ? value : Number(value)
  if (n !== 0 && n !== 1 && n !== 2) {
    throw new ToolInputError(`O argumento "dimensions.${dimension}" tem de ser 0, 1 ou 2.`)
  }
  return n as DimensionScore
}

/** Only reads the dimensions the model actually sent this call — a
 *  missing key means "not reported this time", not "zero". Merging
 *  with previously stored dimensions happens in the handler below. */
function parseDimensionsInput(input: Record<string, unknown>): Partial<Record<Dimension, DimensionScore>> {
  const raw = input.dimensions
  if (raw === undefined || raw === null) return {}
  if (!isPlainObject(raw)) {
    throw new ToolInputError('O argumento "dimensions" tem de ser um objecto.')
  }
  const result: Partial<Record<Dimension, DimensionScore>> = {}
  for (const dimension of DIMENSIONS) {
    if (raw[dimension] !== undefined) result[dimension] = parseDimensionScore(raw[dimension], dimension)
  }
  return result
}

/** save_lead_qualification — executes directly (not write-gated: it
 *  mutates the agent's own working notes on the lead, not an external
 *  system, and the tool's own description explicitly wants it called
 *  incrementally throughout the conversation).
 *
 *  CRITICAL: the total score / stage are NEVER taken from the model.
 *  The model reports facts (which of the 5 rubric dimensions it just
 *  learned, 0-2 each); this handler merges them into whatever
 *  dimensions were already recorded for the contact, then calls
 *  `computeQualification` (lead-scoring.ts) on the FULL merged set to
 *  get the authoritative score/classification, which is what actually
 *  gets persisted. If a model still sends legacy `score`/`stage`
 *  arguments (schema.ts no longer declares them, but providers vary in
 *  how strictly they enforce `additionalProperties: false`), they are
 *  read only to keep parsing tolerant and then discarded — never used.
 *
 *  Also owns two side effects of a qualification update, both
 *  best-effort (never allowed to turn a successful save into a tool
 *  error):
 *    - notify_admin when the new classification is 'quente' or the
 *      urgência dimension maxes out (2), exactly once per qualifying
 *      transition (see the notified_admin_at note below).
 *    - scheduling the quiet-lead follow-up cadence (T+1/T+3/T+7,
 *      followups.ts) the moment the classification transitions INTO
 *      'morno' — not on every subsequent save while already there,
 *      which would keep resetting the clock. */
export async function saveLeadQualificationHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const contactId = requireString(input, 'contact_id')
    const newDimensions = parseDimensionsInput(input)
    const freeAnswers = isPlainObject(input.answers) ? input.answers : undefined
    const qualified = input.qualified === true

    // Legacy fields — intentionally parsed-and-ignored, see doc comment above.
    void optionalInteger(input, 'score')
    void optionalString(input, 'stage')

    const existing = await getLeadQualification(ctx.db, ctx.accountId, contactId)
    const existingDimensions = parseStoredDimensions(existing?.answers.dimensions)
    const mergedDimensions = { ...existingDimensions, ...newDimensions }
    const previousStage = normalizeStage(existing?.stage)

    const result = computeQualification(mergedDimensions)
    const urgency = urgencyFromDimension(mergedDimensions.urgencia)

    // notify_admin trigger — "quente OU urgência máxima" (product rule),
    // fired exactly once per qualifying transition: `notified_admin_at`
    // (additive key inside the existing `answers` JSONB, no migration
    // needed) is cleared whenever the lead is NOT currently
    // quente/urgent, so a later re-qualification (e.g. frio → quente
    // again after new info) can notify again instead of staying
    // permanently silenced by a stale flag.
    const qualifiesForNotify = result.classification === 'quente' || result.urgent
    const previouslyNotifiedAt = isPlainObject(existing?.answers) ? existing!.answers.notified_admin_at : undefined
    let notifiedAdminAt: string | null = null
    let notifiedNow = false

    if (qualifiesForNotify) {
      if (typeof previouslyNotifiedAt === 'string') {
        notifiedAdminAt = previouslyNotifiedAt // already notified for this transition — keep as-is
      } else if (ctx.defaultNotifyUserId) {
        await createAgentNotification(ctx.db, ctx.accountId, {
          userId: ctx.defaultNotifyUserId,
          title:
            result.classification === 'quente'
              ? `Lead quente (${result.score}/10)`
              : `Lead com urgência máxima (${result.score}/10)`,
          body: `Classificação: ${result.classification}. Pontuação: ${result.score}/10.`,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId ?? contactId,
        })
        notifiedAdminAt = new Date().toISOString()
        notifiedNow = true
      }
      // else: qualifies but no admin is configured (ctx.defaultNotifyUserId
      // is null) — leave notifiedAdminAt null so the next tool call in
      // this same qualifying state retries instead of being silenced.
    }

    const answersPayload: Record<string, unknown> = {
      ...(freeAnswers ?? {}),
      dimensions: mergedDimensions,
      notified_admin_at: notifiedAdminAt,
    }

    const upserted = await upsertLeadQualification(ctx.db, ctx.accountId, contactId, {
      score: result.score,
      stage: result.classification,
      urgency,
      answers: answersPayload,
      qualified,
    })

    // Eter agent — quiet-lead follow-up cadence (agent_scheduled_messages,
    // migration 039 / followups.ts). Only on the actual transition INTO
    // 'morno' (never on a re-save while already there, which would keep
    // resetting the T+1/T+3/T+7 clock), and only when the conversation
    // this agent turn is running in is known (always true on the
    // WhatsApp path; a Playground/test call without one has nothing to
    // follow up on). Never allowed to fail the tool call — a scheduling
    // hiccup shouldn't turn a successful qualification save into a tool
    // error.
    if (result.classification === 'morno' && previousStage !== 'morno' && ctx.conversationId) {
      await scheduleFollowUpCadence(ctx.db, ctx.accountId, {
        conversationId: ctx.conversationId,
        contactId,
      }).catch((err) => console.error('[save-lead-qualification] failed to schedule follow-up cadence:', err))
    }

    return {
      isError: false,
      content: JSON.stringify({
        score: upserted.score,
        stage: upserted.stage,
        urgency: upserted.urgency,
        qualified: upserted.qualifiedAt !== null,
        missingDimensions: result.missingDimensions,
        notifiedAdmin: notifiedNow,
      }),
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}

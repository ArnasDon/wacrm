import {
  getLeadQualification,
  upsertLeadQualification,
  type LeadUrgency,
} from '@/lib/eter/repo/lead-qualification.repo'
import { scheduleFollowUpCadence } from '@/lib/eter/followups'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalString, optionalInteger, optionalEnum, ToolInputError } from './parse-input'

const URGENCIES: readonly LeadUrgency[] = ['low', 'medium', 'high', 'urgent']

/** Case/whitespace-insensitive — `stage` is free-form text (see
 *  migration 037's design note), so "morno", "Morno", " morno " all
 *  mean the same qualification bucket for cadence-scheduling purposes. */
function normalizeStage(stage: string | null | undefined): string | null {
  return stage ? stage.trim().toLowerCase() : null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** save_lead_qualification — executes directly (not write-gated: it
 *  mutates the agent's own working notes on the lead, not an external
 *  system, and the tool's own description explicitly wants it called
 *  incrementally throughout the conversation). */
export async function saveLeadQualificationHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const contactId = requireString(input, 'contact_id')
    const score = optionalInteger(input, 'score')
    const stage = optionalString(input, 'stage')
    const urgency = optionalEnum(input, 'urgency', URGENCIES)
    const answers = isPlainObject(input.answers) ? input.answers : undefined
    const qualified = input.qualified === true

    // Read the PRE-update stage so cadence-scheduling only fires on the
    // actual transition INTO 'morno' — not on every subsequent
    // incremental save.repo call while the lead is already in that
    // bucket (which would keep resetting the T+1/T+3/T+7 clock).
    const previousStage = stage !== undefined ? await getLeadQualification(ctx.db, ctx.accountId, contactId) : null

    const result = await upsertLeadQualification(ctx.db, ctx.accountId, contactId, {
      score,
      stage,
      urgency,
      answers,
      qualified,
    })

    // Eter agent — quiet-lead follow-up cadence (agent_scheduled_messages,
    // migration 039 / followups.ts). Only when the conversation the
    // agent turn is running in is known (it always is on the WhatsApp
    // path; a Playground/test call without one has nothing to follow
    // up on) and only on the transition, never on a re-save. Never
    // allowed to fail the tool call — a scheduling hiccup shouldn't
    // turn a successful qualification save into a tool error.
    if (
      normalizeStage(stage) === 'morno' &&
      normalizeStage(previousStage?.stage) !== 'morno' &&
      ctx.conversationId
    ) {
      await scheduleFollowUpCadence(ctx.db, ctx.accountId, {
        conversationId: ctx.conversationId,
        contactId,
      }).catch((err) => console.error('[save-lead-qualification] failed to schedule follow-up cadence:', err))
    }

    return {
      isError: false,
      content: JSON.stringify({
        score: result.score,
        stage: result.stage,
        urgency: result.urgency,
        qualified: result.qualifiedAt !== null,
      }),
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}

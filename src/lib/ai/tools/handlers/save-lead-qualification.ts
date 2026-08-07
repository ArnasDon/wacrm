import { upsertLeadQualification, type LeadUrgency } from '@/lib/eter/repo/lead-qualification.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalString, optionalInteger, optionalEnum, ToolInputError } from './parse-input'

const URGENCIES: readonly LeadUrgency[] = ['low', 'medium', 'high', 'urgent']

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

    const result = await upsertLeadQualification(ctx.db, ctx.accountId, contactId, {
      score,
      stage,
      urgency,
      answers,
      qualified,
    })

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

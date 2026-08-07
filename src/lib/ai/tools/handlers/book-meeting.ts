import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, requireIsoDate, optionalString, ToolInputError } from './parse-input'
import { proposeWriteAction } from './propose-write'

/** book_meeting — WRITE-GATED (see write-gate.ts). Only ever creates a
 *  pending proposal; the real Google Calendar event + `bookings` row
 *  are created by `confirmPendingAction` after explicit lead
 *  confirmation. */
export async function bookMeetingHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const contactId = requireString(input, 'contact_id')
    const startsAt = requireIsoDate(input, 'starts_at')
    const endsAt = requireIsoDate(input, 'ends_at')
    if (endsAt <= startsAt) {
      return { isError: true, content: '"ends_at" tem de ser depois de "starts_at".' }
    }
    const service = optionalString(input, 'service')

    return proposeWriteAction(
      ctx,
      'book_meeting',
      { contact_id: contactId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), service, notes: optionalString(input, 'notes') },
      `nova reunião${service ? ` (${service})` : ''} em ${startsAt.toISOString()}`,
    )
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}

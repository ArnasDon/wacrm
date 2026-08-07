import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { checkAvailabilityHandler } from './check-availability'
import { findEventHandler } from './find-event'
import { bookMeetingHandler } from './book-meeting'
import { rescheduleHandler } from './reschedule'
import { cancelBookingHandler } from './cancel-booking'
import { saveLeadQualificationHandler } from './save-lead-qualification'
import { notifyAdminHandler } from './notify-admin'
import { escalateToHumanHandler } from './escalate-to-human'
import { sendReminderHandler } from './send-reminder'

export type { ToolHandlerContext } from './context'
export { confirmPendingAction, rejectPendingAction, PendingActionError } from './confirm-pending-action'

type Handler = (ctx: ToolHandlerContext, input: Record<string, unknown>) => Promise<ToolExecutionResult>

/** Every tool in `ETER_AGENT_TOOLS` (schema.ts) must have exactly one
 *  entry here — `createEterToolExecutor` throws at startup-of-turn if
 *  the two lists drift, rather than letting an unregistered tool call
 *  fall through to a generic "unknown tool" error deep in a request. */
const HANDLERS: Record<string, Handler> = {
  check_availability: checkAvailabilityHandler,
  find_event: findEventHandler,
  book_meeting: bookMeetingHandler,
  reschedule: rescheduleHandler,
  cancel_booking: cancelBookingHandler,
  save_lead_qualification: saveLeadQualificationHandler,
  notify_admin: notifyAdminHandler,
  escalate_to_human: escalateToHumanHandler,
  send_reminder: sendReminderHandler,
}

/**
 * Build the `ToolExecutor` the Anthropic/OpenAI tool loops
 * (providers/anthropic.ts `runAnthropicToolLoop`, providers/openai.ts
 * `runOpenAiToolLoop`) call for every tool_use the model emits. Binds
 * every handler to one account/conversation context for the duration
 * of a single agent turn.
 */
export function createEterToolExecutor(ctx: ToolHandlerContext): ToolExecutor {
  return async (call: ToolCall): Promise<ToolExecutionResult> => {
    const handler = HANDLERS[call.name]
    if (!handler) {
      return {
        isError: true,
        content: `Ferramenta desconhecida: "${call.name}".`,
      }
    }
    return handler(ctx, call.input)
  }
}

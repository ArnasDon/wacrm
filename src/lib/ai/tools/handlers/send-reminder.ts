import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, ToolInputError } from './parse-input'

/**
 * send_reminder — NOT YET IMPLEMENTED.
 *
 * There is no reminder-scheduling infrastructure in this codebase yet
 * (no table, no cron/queue to fire a delayed WhatsApp send) — building
 * one is a real feature (a scheduler + the 24h-template-window logic
 * the tool's own schema.ts description calls out) and was out of scope
 * for this pass. Rather than silently pretend to schedule something
 * that never fires, this handler reports a clean, honest tool error so
 * the model tells the lead/admin it can't do this yet instead of
 * fabricating a confirmation — see the "sem engolir" logging rule this
 * whole tool layer follows (tools/log.ts).
 *
 * To implement: a `reminders` table (send_at, booking_id, channel,
 * message_template, status), a repo module in
 * src/lib/eter/repo/reminders.repo.ts, and a delivery worker — none of
 * which exist today.
 */
export async function sendReminderHandler(
  _ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    requireString(input, 'booking_id')
    requireString(input, 'send_at')
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }

  return {
    isError: true,
    content:
      'send_reminder ainda não está implementado nesta instalação — não há infraestrutura de agendamento de lembretes. Informa o utilizador em vez de assumir que o lembrete foi agendado.',
  }
}

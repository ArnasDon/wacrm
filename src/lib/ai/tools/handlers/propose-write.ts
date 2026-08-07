import {
  createPendingAction,
  getPendingActionForConversation,
  type PendingActionToolName,
} from '@/lib/eter/repo/pending-actions.repo'
import type { ToolExecutionResult } from '../loop-types'
import type { ToolHandlerContext } from './context'

/**
 * Shared body for the three write-gated tool handlers (book_meeting,
 * reschedule, cancel_booking — see write-gate.ts). Never touches
 * Google Calendar or `bookings`; only ever writes a proposal row. This
 * is what makes the gate a mechanism rather than a prompt instruction —
 * there is no code path in this function (or anywhere in
 * handlers/book-meeting.ts, reschedule.ts, cancel-booking.ts) that can
 * reach the calendar API. That happens exclusively in
 * `confirmPendingAction` (confirm-pending-action.ts), which is not part
 * of the tool loop at all.
 */
export async function proposeWriteAction(
  ctx: ToolHandlerContext,
  toolName: PendingActionToolName,
  toolInput: Record<string, unknown>,
  humanSummary: string,
): Promise<ToolExecutionResult> {
  if (!ctx.conversationId) {
    return {
      isError: true,
      content: 'Esta ferramenta só pode ser usada dentro de uma conversa de WhatsApp.',
    }
  }

  // At most one pending proposal per thread (also enforced by a unique
  // index at the DB level — see migration 038) so the lead is never
  // asked to disambiguate between two stacked, half-explained proposals.
  const existing = await getPendingActionForConversation(ctx.db, ctx.accountId, ctx.conversationId)
  if (existing) {
    return {
      isError: true,
      content:
        'Já existe uma proposta pendente de confirmação nesta conversa. Pede ao lead para confirmar ou recusar essa antes de propores outra.',
    }
  }

  await createPendingAction(ctx.db, ctx.accountId, {
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    toolName,
    toolInput,
  })

  return {
    isError: false,
    content: `Proposta registada (${humanSummary}). NÃO está confirmada — pede ao lead uma confirmação explícita antes de dares a marcação como feita. Só depois de o lead confirmar é que a acção é realmente aplicada ao calendário.`,
  }
}

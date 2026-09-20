import {
  bookCommercialSlot,
  CommercialCalendarNotConfiguredError,
  findCommercialSlots,
} from '@/lib/calendar/commercial-availability'
import type { ToolCall, ToolExecutionResult, ToolExecutor } from '../loop-types'
import type { ToolHandlerContext } from './context'
import { requireString, optionalString, ToolInputError } from './parse-input'

// ============================================================
// Bloco 3-A — handlers for check_commercial_availability /
// book_commercial_meeting (commercial-schema.ts). Bound into their own
// tiny executor (`createCommercialToolExecutor`) rather than folded
// into `createEterToolExecutor` (handlers/index.ts) — that one drives
// ETER_AGENT_TOOLS, the personal-calendar tool set; commercial mode
// intentionally never sees book_meeting/reschedule/cancel_booking (see
// COMMERCIAL_MODE_DISABLED_TOOL_NAMES in ../schema.ts) and never runs
// alongside them in the same turn.
// ============================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function checkCommercialAvailabilityHandler(
  ctx: ToolHandlerContext,
): Promise<ToolExecutionResult> {
  try {
    const { config, slots } = await findCommercialSlots(ctx.db, ctx.accountId)
    if (slots.length === 0) {
      return {
        isError: false,
        content: JSON.stringify({
          timezone: config.timezone,
          slots: [],
          note:
            'Não há horários livres na janela configurada. Não inventes uma hora — diz ao lead que a equipa confirma um horário por WhatsApp/email em breve.',
        }),
      }
    }
    return {
      isError: false,
      content: JSON.stringify({
        timezone: config.timezone,
        duration_min: config.meetingDurationMin,
        slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
      }),
    }
  } catch (err) {
    if (err instanceof CommercialCalendarNotConfiguredError) {
      return {
        isError: true,
        content:
          'Não há calendário comercial configurado para esta conta. Não uses esta ferramenta — pede o email do lead e diz que a equipa entra em contacto (ou, se houver um link de agendamento no contexto de negócio, envia esse link).',
      }
    }
    throw err
  }
}

export async function bookCommercialMeetingHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  try {
    const startsAtRaw = requireString(input, 'starts_at')
    const startsAt = new Date(startsAtRaw)
    if (Number.isNaN(startsAt.getTime())) {
      return {
        isError: true,
        content: `"starts_at" não é uma data ISO 8601 válida: "${startsAtRaw}".`,
      }
    }

    const leadEmail = requireString(input, 'lead_email')
    if (!EMAIL_RE.test(leadEmail)) {
      return {
        isError: true,
        content: `"lead_email" não parece um email válido: "${leadEmail}". Confirma o email com o lead antes de marcar.`,
      }
    }
    const leadName = optionalString(input, 'lead_name')

    const outcome = await bookCommercialSlot(ctx.db, {
      accountId: ctx.accountId,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      leadEmail,
      leadName,
      start: startsAt,
    })

    if (outcome.status === 'booked') {
      return {
        isError: false,
        content: JSON.stringify({
          booked: true,
          starts_at: startsAt.toISOString(),
          lead_email: leadEmail,
        }),
      }
    }
    if (outcome.status === 'conflict') {
      return {
        isError: true,
        content:
          'Essa hora deixou de estar livre entretanto (alguém a ocupou noutro calendário). Chama check_commercial_availability outra vez e propõe uma hora diferente ao lead — não digas que já está marcado.',
      }
    }
    // outcome.status === 'not_configured'
    return {
      isError: true,
      content:
        'Não há calendário comercial configurado para esta conta. Não uses esta ferramenta — pede o email do lead e diz que a equipa entra em contacto.',
    }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: err.message }
    throw err
  }
}

/**
 * Build the `ToolExecutor` for `COMMERCIAL_TOOLS` (commercial-schema.ts),
 * bound to one account/conversation context for a single agent turn —
 * mirrors `createEterToolExecutor` (handlers/index.ts) but for this
 * separate, smaller tool set.
 */
export function createCommercialToolExecutor(ctx: ToolHandlerContext): ToolExecutor {
  return async (call: ToolCall): Promise<ToolExecutionResult> => {
    switch (call.name) {
      case 'check_commercial_availability':
        return checkCommercialAvailabilityHandler(ctx)
      case 'book_commercial_meeting':
        return bookCommercialMeetingHandler(ctx, call.input)
      default:
        return {
          isError: true,
          content: `Ferramenta desconhecida no modo comercial: "${call.name}".`,
        }
    }
  }
}

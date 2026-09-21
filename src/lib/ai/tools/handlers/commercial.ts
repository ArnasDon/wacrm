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

interface CommercialBookingContext {
  company: string | null
  phone: string | null
  reason: string | null
}

/** Lê `contacts.company`/`contacts.phone` e `conversations.escalation_reason`
 *  para a conversa actual — usados pela trava de `bookCommercialMeetingHandler`
 *  (Ricardo, 21/09/2026: sem o nome concreto da empresa, não marca reunião)
 *  e para preencher o título/descrição do evento no Google Calendar (Ricardo,
 *  21/09/2026: título "Reunião [Empresa]<>Eter Growth", descrição com nome,
 *  telefone, email e motivo). Devolve tudo a `null` quando não há `contactId`
 *  na conversa (ex.: chamada de Playground) ou quando a coluna está vazia —
 *  os dois casos tratam-se da mesma forma: falta o dado. */
async function getCommercialBookingContext(
  ctx: ToolHandlerContext,
): Promise<CommercialBookingContext> {
  const empty: CommercialBookingContext = { company: null, phone: null, reason: null }
  if (!ctx.contactId) return empty

  const [{ data: contact }, conversation] = await Promise.all([
    ctx.db.from('contacts').select('company, phone').eq('id', ctx.contactId).maybeSingle(),
    ctx.conversationId
      ? ctx.db
          .from('conversations')
          .select('escalation_reason')
          .eq('id', ctx.conversationId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ])

  const row = contact as { company?: string | null; phone?: string | null } | null
  const convRow = conversation as { escalation_reason?: string | null } | null
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

  return {
    company: clean(row?.company),
    phone: clean(row?.phone),
    reason: clean(convRow?.escalation_reason),
  }
}

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

    // Regra do Ricardo (21/09/2026): nunca marcar sem o nome CONCRETO
    // da empresa (contacts.company) — um sector ("logística") não
    // conta. Verificado aqui, em código, pela mesma razão que a trava
    // do handoff também vive em código (commercial-handoff.ts): um
    // prompt cede a quem insista.
    const { company, phone, reason } = await getCommercialBookingContext(ctx)
    if (!company) {
      return {
        isError: true,
        content:
          'Ainda não tenho o nome concreto da empresa do lead (um sector como "logística" não chega). Pergunta como se chama a empresa, guarda com save_lead_details (campo company) e só depois chama book_commercial_meeting outra vez.',
      }
    }

    const outcome = await bookCommercialSlot(ctx.db, {
      accountId: ctx.accountId,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      leadEmail,
      leadName,
      company,
      leadPhone: phone,
      reason,
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
 * Handler for save_lead_details — persists whatever the model has
 * learned about the lead (name, email, escalation reason) onto
 * `contacts` / `conversations`. Every field is individually optional
 * (the model reports what it knows as it learns it), but at least one
 * must be present. This is the write side of the handoff gate in
 * commercial-handoff.ts: dispatchInboundToAiReply reads back
 * `contacts.name` / `contacts.email` / `conversations.escalation_reason`
 * before letting a handoff go through.
 */
export async function saveLeadDetailsHandler(
  ctx: ToolHandlerContext,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const name = optionalString(input, 'name')
  const email = optionalString(input, 'email')
  const escalationReason = optionalString(input, 'escalation_reason')
  const company = optionalString(input, 'company')

  if (!name && !email && !escalationReason && !company) {
    return {
      isError: true,
      content:
        'Não enviaste nenhum dado para guardar. Envia pelo menos um de: name, email, escalation_reason, company.',
    }
  }

  if (email && !EMAIL_RE.test(email)) {
    return {
      isError: true,
      content: `"email" não parece um email válido: "${email}". Confirma o email com a pessoa antes de o guardares.`,
    }
  }

  try {
    if ((name || email || company) && ctx.contactId) {
      const contactUpdate: Record<string, unknown> = {}
      if (name) contactUpdate.name = name
      if (email) contactUpdate.email = email
      if (company) contactUpdate.company = company
      const { error } = await ctx.db.from('contacts').update(contactUpdate).eq('id', ctx.contactId)
      if (error) throw error
    }
    if (escalationReason && ctx.conversationId) {
      const { error } = await ctx.db
        .from('conversations')
        .update({ escalation_reason: escalationReason })
        .eq('id', ctx.conversationId)
      if (error) throw error
    }
  } catch (err) {
    return {
      isError: true,
      content: `Falha ao guardar os dados: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
    }
  }

  const saved: string[] = []
  if (name) saved.push('name')
  if (email) saved.push('email')
  if (escalationReason) saved.push('escalation_reason')
  if (company) saved.push('company')

  return {
    isError: false,
    content: JSON.stringify({ saved }),
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
      case 'save_lead_details':
        return saveLeadDetailsHandler(ctx, call.input)
      default:
        return {
          isError: true,
          content: `Ferramenta desconhecida no modo comercial: "${call.name}".`,
        }
    }
  }
}

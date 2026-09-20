import type { ToolDefinition } from './schema'

// ============================================================
// Bloco 3-A — tool-calling contract for REAL scheduling in commercial
// mode, against the dedicated leads calendar (service account, see
// src/lib/calendar/commercial-availability.ts). Deliberately a
// SEPARATE, small tool set from `ETER_AGENT_TOOLS` (schema.ts) rather
// than reusing `check_availability`/`book_meeting`: those two are
// bound to the per-account Google OAuth calendar connection
// (`calendar_configs`, one calendar per account, connected via a
// consent screen) — a structurally different auth/ownership model from
// the fixed, deployment-wide service account + explicit
// busy/booking-calendar-id pair Bloco 3-A uses. Reusing the same tool
// names for two different backends would make the model's behaviour
// depend on which persona is active in a way that's invisible from the
// tool name alone.
// ============================================================

export const checkCommercialAvailabilityTool: ToolDefinition = {
  name: 'check_commercial_availability',
  description:
    'Lista até 3 horários concretos e livres para uma reunião comercial, já cruzados com TODOS os calendários relevantes (incluindo o pessoal) e dentro do horário útil configurado. Usa isto para PROPOR horários ao lead — nunca perguntes "quando te dá jeito", propõe sempre 2 ou 3 opções concretas devolvidas por esta ferramenta. Nunca inventes um horário que não venha daqui.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

export const bookCommercialMeetingTool: ToolDefinition = {
  name: 'book_commercial_meeting',
  description:
    'Marca a reunião na hora que o lead escolheu (tem de ser uma das horas devolvidas por check_commercial_availability). Cria o evento no calendário de leads e convida o lead pelo email dado — a Google envia o convite automaticamente. Se a hora tiver deixado de estar livre entretanto, esta ferramenta devolve um conflito em vez de marcar por cima: nesse caso chama check_commercial_availability outra vez e propõe uma hora diferente ao lead, sem rebentar a conversa.',
  parameters: {
    type: 'object',
    properties: {
      starts_at: {
        type: 'string',
        format: 'date-time',
        description:
          'Início da reunião, ISO 8601 com offset — uma das horas devolvidas por check_commercial_availability.',
      },
      lead_email: {
        type: 'string',
        description: 'Email do lead, para o Google enviar o convite. Confirma-o antes de marcar.',
      },
      lead_name: {
        type: 'string',
        description: 'Nome do lead, opcional — usado só no título do evento.',
      },
    },
    required: ['starts_at', 'lead_email'],
    additionalProperties: false,
  },
}

export const COMMERCIAL_TOOLS: readonly ToolDefinition[] = [
  checkCommercialAvailabilityTool,
  bookCommercialMeetingTool,
]

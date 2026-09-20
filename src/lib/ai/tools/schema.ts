// ============================================================
// Tool-calling contract for the EterWA agent (Fase 1 — schemas only).
//
// These are JSON-Schema *definitions* for the tools the WhatsApp agent
// will call once tool-calling lands (not yet implemented — today
// `src/lib/ai/generate.ts` only produces text). No handler exists yet;
// this file is the contract implementers on both sides (prompt
// building + execution) code against.
//
// Design rules these schemas follow:
//   - `parameters` is plain JSON Schema (draft-07-ish, object root),
//     directly usable as OpenAI's `function.parameters`. Anthropic's
//     `tool_use` wants the same object under the key `input_schema` —
//     the (future) provider adapters do that renaming, not this file.
//   - Every date/time parameter is an ISO 8601 string with an explicit
//     UTC offset (e.g. "2026-08-20T09:00:00+01:00"), already resolved
//     by `src/lib/calendar/date-resolver.ts`. The model never receives
//     or produces relative phrases like "amanhã" as a tool argument —
//     the resolver runs first, in the account's timezone
//     (`calendar_configs.timezone`), and only the resolved instant is
//     passed down. This is what keeps date handling deterministic.
//   - IDs (`contact_id`, `conversation_id`, `booking_id`, ...) are
//     UUIDs matching the corresponding columns in migration
//     037_eter_agent.sql (`bookings`, `lead_qualification`) or the
//     base wacrm schema (`contacts`, `conversations`).
//   - Every tool is account-scoped implicitly: the executor injects
//     `account_id` from the calling context (the WhatsApp account the
//     conversation belongs to) — it is never a model-supplied argument,
//     so the model can't be tricked into cross-account access.
// ============================================================

export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  enum?: readonly string[] | readonly number[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: readonly string[]
  additionalProperties?: boolean
  format?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
}

// ------------------------------------------------------------
// check_availability — find open slots on the account's calendar
// within a resolved date range, honoring business_hours, buffer_min,
// and min_lead_time_min from `calendar_configs`.
// ------------------------------------------------------------
export const checkAvailabilityTool: ToolDefinition = {
  name: 'check_availability',
  description:
    'Lista os horários livres no calendário da conta dentro de um intervalo de datas já resolvido. Usa isto antes de propor um horário ao lead — nunca inventes disponibilidade.',
  parameters: {
    type: 'object',
    properties: {
      range_start: {
        type: 'string',
        format: 'date-time',
        description: 'Início do intervalo a verificar, ISO 8601 com offset (já resolvido pelo date-resolver).',
      },
      range_end: {
        type: 'string',
        format: 'date-time',
        description: 'Fim do intervalo a verificar, ISO 8601 com offset.',
      },
      duration_min: {
        type: 'integer',
        description: 'Duração pretendida da reunião em minutos. Por omissão usa calendar_configs.default_duration_min.',
      },
    },
    required: ['range_start', 'range_end'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// find_event — locate an existing booking (own agent or external), to
// support "quando é a minha reunião?" / pre-reschedule lookups.
// ------------------------------------------------------------
export const findEventTool: ToolDefinition = {
  name: 'find_event',
  description:
    'Procura uma reunião já agendada para este contacto (por conversa, contacto, ou intervalo de datas). Usa antes de reschedule/cancel para confirmares qual reunião o lead quer alterar.',
  parameters: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', format: 'uuid', description: 'UUID do contacto (contacts.id).' },
      conversation_id: { type: 'string', format: 'uuid', description: 'UUID da conversa (conversations.id).' },
      range_start: { type: 'string', format: 'date-time', description: 'Início do intervalo a procurar (opcional).' },
      range_end: { type: 'string', format: 'date-time', description: 'Fim do intervalo a procurar (opcional).' },
      status: {
        type: 'string',
        enum: ['proposed', 'confirmed', 'cancelled', 'no_show'],
        description: 'Filtra por estado da reserva. Por omissão devolve proposed + confirmed.',
      },
    },
    required: [],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// book_meeting — create a booking + the Google Calendar event.
// ------------------------------------------------------------
export const bookMeetingTool: ToolDefinition = {
  name: 'book_meeting',
  description:
    'Confirma uma reunião: cria o evento no Google Calendar e a linha em bookings. Só chamar depois de check_availability confirmar que o horário está livre e o lead confirmar explicitamente.',
  parameters: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', format: 'uuid', description: 'UUID do contacto (contacts.id).' },
      conversation_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID da conversa de WhatsApp que originou o agendamento.',
      },
      starts_at: { type: 'string', format: 'date-time', description: 'Início da reunião, ISO 8601 com offset.' },
      ends_at: { type: 'string', format: 'date-time', description: 'Fim da reunião, ISO 8601 com offset.' },
      service: {
        type: 'string',
        description: 'O que a reunião é sobre (ex.: "Demo EterShield", "Chamada de descoberta").',
      },
      notes: { type: 'string', description: 'Notas livres a incluir no evento/booking.' },
    },
    required: ['contact_id', 'starts_at', 'ends_at'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// reschedule — move an existing booking to a new time.
// ------------------------------------------------------------
export const rescheduleTool: ToolDefinition = {
  name: 'reschedule',
  description:
    'Move uma reunião já confirmada para um novo horário. Actualiza o evento no Google Calendar e a linha em bookings (mantém o mesmo booking_id).',
  parameters: {
    type: 'object',
    properties: {
      booking_id: { type: 'string', format: 'uuid', description: 'UUID da reserva a alterar (bookings.id).' },
      new_starts_at: { type: 'string', format: 'date-time', description: 'Novo início, ISO 8601 com offset.' },
      new_ends_at: { type: 'string', format: 'date-time', description: 'Novo fim, ISO 8601 com offset.' },
      reason: { type: 'string', description: 'Motivo da remarcação (opcional, para o histórico).' },
    },
    required: ['booking_id', 'new_starts_at', 'new_ends_at'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// cancel_booking — cancel an existing booking.
// ------------------------------------------------------------
export const cancelBookingTool: ToolDefinition = {
  name: 'cancel_booking',
  description:
    'Cancela uma reunião: apaga/cancela o evento no Google Calendar e marca bookings.status = cancelled.',
  parameters: {
    type: 'object',
    properties: {
      booking_id: { type: 'string', format: 'uuid', description: 'UUID da reserva a cancelar (bookings.id).' },
      reason: { type: 'string', description: 'Motivo do cancelamento (opcional, para o histórico).' },
    },
    required: ['booking_id'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// save_lead_qualification — persist the qualification rubric outcome.
// ------------------------------------------------------------
// NOTE on this schema's shape (deviates from an earlier free `score`
// integer field): the product rubric requires the total score and
// stage to be DERIVED, never invented by the model — see
// src/lib/eter/lead-scoring.ts. So this tool no longer accepts `score`
// or `stage` at all: the model can only report FACTS (one rubric
// dimension at a time, 0-2, as it learns them across the conversation),
// and the handler computes score/stage server-side from every
// dimension recorded so far. The old free-text `urgency` enum is also
// gone — it duplicated/could contradict the `urgencia` rubric
// dimension, which is now the single source of truth the handler
// derives `lead_qualification.urgency` from (lead-scoring.ts,
// `urgencyFromDimension`).
export const saveLeadQualificationTool: ToolDefinition = {
  name: 'save_lead_qualification',
  description:
    'Regista o que aprendeste sobre UMA (ou mais) das 5 dimensões da qualificação do lead (necessidade, autoridade, urgência, enquadramento, dimensão da empresa) — nunca uma pontuação total, essa é sempre calculada a partir das respostas guardadas. Chama assim que aprenderes uma dimensão nova, não como questionário — nunca voltes a perguntar uma dimensão já respondida (consulta o resultado devolvido para saberes quais faltam).',
  parameters: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', format: 'uuid', description: 'UUID do contacto (contacts.id).' },
      dimensions: {
        type: 'object',
        description:
          'Uma ou mais das 5 dimensões da rubrica, cada uma 0, 1 ou 2. Envia só as que aprendeste nesta troca — as já registadas não precisam de ser repetidas.',
        properties: {
          necessidade: {
            type: 'integer',
            enum: [0, 1, 2],
            description: '0 = sem problema identificado / curiosidade, 1 = problema vago, 2 = dor concreta + o seu custo.',
          },
          autoridade: {
            type: 'integer',
            enum: [0, 1, 2],
            description: '0 = sem poder de decisão/influência, 1 = influencia mas outra pessoa decide, 2 = é quem decide (sócio/gerente/CEO).',
          },
          urgencia: {
            type: 'integer',
            enum: [0, 1, 2],
            description: '0 = "um dia destes", 1 = próximos meses, 2 = já esta semana / prazo definido.',
          },
          enquadramento: {
            type: 'integer',
            enum: [0, 1, 2],
            description: '0 = fora do que a Eter faz, 1 = adjacente, 2 = encaixa num serviço Eter.',
          },
          dimensao: {
            type: 'integer',
            enum: [0, 1, 2],
            description: '0 = sem operação (particular/projecto pessoal), 1 = micro-empresa, 2 = tem equipa + receita recorrente.',
          },
        },
        additionalProperties: false,
      },
      answers: {
        type: 'object',
        description: 'Mapa livre pergunta→resposta adicional recolhido na conversa (auditável, fora das 5 dimensões da rubrica).',
        additionalProperties: true,
      },
      qualified: {
        type: 'boolean',
        description: 'true quando a qualificação está concluída (define lead_qualification.qualified_at).',
      },
    },
    required: ['contact_id'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// notify_admin — push an alert to a human (new hot lead, booking made,
// something the agent can't resolve).
// ------------------------------------------------------------
export const notifyAdminTool: ToolDefinition = {
  name: 'notify_admin',
  description:
    'Avisa um administrador/agente humano da conta (ex.: lead urgente qualificado, reunião agendada, pedido fora do âmbito do bot). Usa notifications (migração 027) como canal de entrega.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', format: 'uuid', description: 'UUID da conversa relevante.' },
      contact_id: { type: 'string', format: 'uuid', description: 'UUID do contacto relevante.' },
      message: { type: 'string', description: 'Texto da notificação, curto e acionável.' },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent'],
        description: 'Prioridade — tipicamente espelha lead_qualification.urgency quando aplicável.',
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// escalate_to_human — hand the conversation off (reuses the existing
// handoff sentinel concept from src/lib/ai/handoff.ts, but as an
// explicit tool call rather than a text sentinel).
// ------------------------------------------------------------
export const escalateToHumanTool: ToolDefinition = {
  name: 'escalate_to_human',
  description:
    'Entrega a conversa a um humano e desliga o auto-reply para esta thread (conversations.ai_autoreply_disabled = true). Usa quando o lead pede explicitamente para falar com uma pessoa, ou quando o pedido está fora do que o agente consegue resolver com segurança.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', format: 'uuid', description: 'UUID da conversa a entregar.' },
      reason: { type: 'string', description: 'Motivo da escalada (para o agente humano que recebe a conversa).' },
      agent_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID do agente humano a atribuir. Se omitido, cai na fila partilhada (unassigned).',
      },
    },
    required: ['conversation_id', 'reason'],
    additionalProperties: false,
  },
}

// ------------------------------------------------------------
// send_reminder — schedule/send a reminder ahead of a booking. Follow-
// up delivery for confirmed meetings must go through an approved Meta
// template when outside the 24h customer-service window (see
// message_templates) — that constraint is enforced by the (future)
// implementation, not expressed in this schema.
// ------------------------------------------------------------
export const sendReminderTool: ToolDefinition = {
  name: 'send_reminder',
  description:
    'Agenda um lembrete de follow-up para uma reunião (ex.: 24h e 1h antes). Fora da janela de 24h de atendimento ao cliente, o envio tem de usar um template Meta aprovado (message_templates) em vez de texto livre.',
  parameters: {
    type: 'object',
    properties: {
      booking_id: { type: 'string', format: 'uuid', description: 'UUID da reserva a lembrar (bookings.id).' },
      send_at: { type: 'string', format: 'date-time', description: 'Quando enviar o lembrete, ISO 8601 com offset.' },
      channel: {
        type: 'string',
        enum: ['whatsapp'],
        description: 'Canal de envio. Por agora só WhatsApp é suportado.',
      },
      message_template: {
        type: 'string',
        description: 'Nome do template Meta aprovado a usar quando o envio cai fora da janela de 24h (opcional).',
      },
    },
    required: ['booking_id', 'send_at'],
    additionalProperties: false,
  },
}

export const ETER_AGENT_TOOLS: readonly ToolDefinition[] = [
  checkAvailabilityTool,
  findEventTool,
  bookMeetingTool,
  rescheduleTool,
  cancelBookingTool,
  saveLeadQualificationTool,
  notifyAdminTool,
  escalateToHumanTool,
  sendReminderTool,
]

// ------------------------------------------------------------
// Bloco 3-A — commercial-mode tool exclusion.
//
// The commercial persona (see src/lib/ai/commercial.ts /
// src/lib/ai/defaults.ts `mode: 'commercial_reply'`) qualifies a lead
// and hands over a scheduling link — it must never book, move, or
// cancel a meeting on someone's behalf. `getEterAgentTools` is how any
// caller that wires ETER_AGENT_TOOLS into a model turn should build its
// tool list, so this exclusion is enforced in one place.
//
// NOTE (as of this migration): nothing in the webhook/auto-reply
// cascade calls `generateReplyWithTools` / `createEterToolExecutor`
// yet — `dispatchInboundToAiReply` (auto-reply.ts) only calls the
// plain-text `generateReply`, tools and all. This helper is added so
// that whenever the agentic tool loop IS wired into that inbound path,
// the commercial exclusion is already correct and covered by a test,
// rather than something a future change has to remember to add.
// ------------------------------------------------------------
export const COMMERCIAL_MODE_DISABLED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'book_meeting',
  'reschedule',
  'cancel_booking',
])

export function getEterAgentTools(opts: { commercial: boolean }): readonly ToolDefinition[] {
  if (!opts.commercial) return ETER_AGENT_TOOLS
  return ETER_AGENT_TOOLS.filter((tool) => !COMMERCIAL_MODE_DISABLED_TOOL_NAMES.has(tool.name))
}

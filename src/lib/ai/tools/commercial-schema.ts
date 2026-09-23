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

// ============================================================
// Bloco 3-A — save_lead_details, para o modelo registar nome, email e
// motivo de contacto do lead assim que os aprender. É a peça do
// código (não do prompt) que impede o handoff sem estes três dados:
// a trava propriamente dita vive em src/lib/ai/commercial-handoff.ts,
// lida pela dispatchInboundToAiReply (auto-reply.ts) sempre que o
// modelo emite o sinal de handoff — esta tool é só a forma de o
// modelo alimentar essa trava com o que vai aprendendo na conversa.
// ============================================================

export const saveLeadDetailsTool: ToolDefinition = {
  name: 'save_lead_details',
  description:
    'Guarda o nome, o email, o cargo, o motivo de contacto e/ou a empresa do lead assim que os souberes na conversa — chama sempre que aprenderes um destes dados, nunca esperes até ao fim para os registares todos de uma vez. Podes enviar só um campo de cada vez. Nome, email, motivo e empresa têm de estar guardados antes de a conversa poder ser passada para a equipa (ou uma reunião marcada), por isso regista-os assim que os tiveres, mesmo antes de a pessoa pedir para falar com alguém. O cargo (role) não bloqueia nada disto — regista-o apenas quando a conversa o revelar.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Nome da pessoa com quem estás a falar.',
      },
      role: {
        type: 'string',
        description:
          'Cargo da pessoa na empresa, nas próprias palavras dela — por exemplo "CEO", "director comercial", "dono do negócio", ou uma frase curta se ela negar o cargo sugerido na abertura da conversa (ex.: "trata disto outra pessoa"). Regista assim que a pessoa confirmar ou corrigir o cargo perguntado na primeira mensagem.',
      },
      email: {
        type: 'string',
        description: 'Email de contacto da pessoa.',
      },
      escalation_reason: {
        type: 'string',
        description:
          'Motivo pelo qual a pessoa quer (ou pode vir a querer) falar com alguém da equipa. Regista assim que o souberes, não só depois de a pessoa pedir explicitamente para falar com uma pessoa.',
      },
      company: {
        type: 'string',
        description:
          'Nome CONCRETO da empresa do lead (ex.: "Clínica Sorriso Lda"), nunca o sector ou tipo de negócio (ex.: "logística", "restauração" não contam — isso é contexto, não o campo company). Se a pessoa disser só o sector, continua a conversa normalmente e pergunta o nome da empresa mais tarde, no momento de marcar a reunião ou de escalar. Se a pessoa for trabalhador independente / não tiver empresa, guarda isso mesmo (ex.: "trabalhador independente") — não insistas.',
      },
    },
    required: [],
    additionalProperties: false,
  },
}

export const COMMERCIAL_TOOLS: readonly ToolDefinition[] = [
  checkCommercialAvailabilityTool,
  bookCommercialMeetingTool,
  saveLeadDetailsTool,
]

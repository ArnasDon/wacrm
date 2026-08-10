import type { AgentToolKey } from './tool-permissions'
import type { AgentModelTier, ConversationIntent } from './trace'

export interface RouteDecision {
  intent: ConversationIntent
  modelTier: AgentModelTier
  toolKeys: AgentToolKey[]
  forceHandoff: boolean
}

export const DEFAULT_FRUSTRATION_KEYWORDS = [
  'absurdo',
  'inadmissível',
  'insatisfeito',
  'insatisfeita',
  'péssimo',
  'reclamação',
  'queixa',
  'furioso',
  'furiosa',
  'terrible',
  'complaint',
  'angry',
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-PT')
    .replace(/\s+/g, ' ')
    .trim()
}

const HUMAN_OR_COMPLAINT =
  /\b(humano|pessoa real|atendente|supervisor|gerente|reclamar|reclamacao|queixa|inadmissivel|absurdo|pessimo|furios[oa]|decepcionad[oa]|insatisfeit[oa]|roubo|fraude|human|manager|supervisor|complaint|terrible|angry)\b/
const EXPLICIT_HUMAN =
  /\b(quero|preciso)\b.{0,20}\b(falar|atendimento|ser atendid[oa])\b.{0,30}\b(pessoa|humano|atendente|supervisor|gerente)\b/
const SENSITIVE_ACCOUNT =
  /\b(reembolso|estorno|cobranca indevida|cobraram|debitad[oa]|fraude|senha|password|pin|iban)\b|\b(alterar|mudar|trocar|actualizar|atualizar|cancelar|apagar|remover)\b.{0,50}\b(conta|dados|titular|iban|cartao|pagamento|assinatura)\b/
const SALES =
  /\b(preco|quanto custa|comprar|compra|produto|catalogo|stock|estoque|tamanho|cor|disponivel|disponibilidade|encomendar|reservar|fotografia|foto|price|buy|product|catalog|size|colour|color|available)\b/
const SMALLTALK =
  /^(ola|oi|bom dia|boa tarde|boa noite|hello|hi|hey|obrigad[oa]?|muito obrigad[oa]?|thanks|thank you|ate logo|tchau|bye)[!.? ]*$/

/**
 * Deterministic first-pass router. It intentionally favours a safe, cheap
 * decision over an extra classifier-model call. Unknown messages fall back to
 * FAQ and can still be resolved or handed off by the main agent.
 */
export function classifyIntent(ctx: {
  lastMessageText: string
  frustrationKeywords?: string[]
}): RouteDecision {
  const text = normalize(ctx.lastMessageText)
  const keywordComplaint = (
    ctx.frustrationKeywords ?? DEFAULT_FRUSTRATION_KEYWORDS
  ).some((keyword) => {
    const normalizedKeyword = normalize(keyword)
    return normalizedKeyword.length > 0 && text.includes(normalizedKeyword)
  })

  if (
    keywordComplaint ||
    HUMAN_OR_COMPLAINT.test(text) ||
    EXPLICIT_HUMAN.test(text)
  ) {
    return {
      intent: 'complaint',
      modelTier: 'smart',
      toolKeys: [],
      forceHandoff: true,
    }
  }
  if (SENSITIVE_ACCOUNT.test(text)) {
    return {
      intent: 'account',
      modelTier: 'smart',
      toolKeys: [],
      forceHandoff: true,
    }
  }
  if (SMALLTALK.test(text)) {
    return {
      intent: 'smalltalk',
      modelTier: 'fast',
      toolKeys: [],
      forceHandoff: false,
    }
  }
  if (SALES.test(text)) {
    return {
      intent: 'sales',
      modelTier: 'smart',
      toolKeys: [
        'search_catalog',
        'send_product',
        'create_deal',
        'add_tag',
        'handoff_human',
      ],
      forceHandoff: false,
    }
  }
  // 'faq' is the catch-all for anything the keyword lists above didn't
  // recognise — not "definitely not sales". A fixed keyword list can never
  // keep up with one account's own product vocabulary ("legging", "top",
  // a colour name spoken alone as a one-word reply, "mostra as duas
  // opções" as a natural follow-up with no product noun in it at all) —
  // live bug report: an entire real shopping conversation about leggings
  // never matched SALES once, so every turn — including "show me both
  // options" answering the bot's own question — lost catalogue access
  // and the bot had nothing left to do but hand off. Keeping the
  // catalogue tools available here is safe: routeToolPermissions still
  // intersects with the account's actual configured permissions below,
  // so this can only ever restore capability the account already has —
  // it can never grant what isn't configured.
  return {
    intent: 'faq',
    modelTier: 'fast',
    toolKeys: [
      'search_knowledge',
      'search_catalog',
      'send_product',
      'handoff_human',
    ],
    forceHandoff: false,
  }
}

export function routeToolPermissions(
  permissions: Record<AgentToolKey, boolean>,
  route: RouteDecision,
): Record<AgentToolKey, boolean> {
  const allowed = new Set(route.toolKeys)
  return Object.fromEntries(
    (Object.keys(permissions) as AgentToolKey[]).map((key) => [
      key,
      permissions[key] && allowed.has(key),
    ]),
  ) as Record<AgentToolKey, boolean>
}

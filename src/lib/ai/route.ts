import type { AgentModelTier, ConversationIntent } from './trace'

export interface RouteDecision {
  intent: ConversationIntent
  modelTier: AgentModelTier
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
    .replace(/[̀-ͯ]/g, '')
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
const SMALLTALK =
  /^(ola|oi|bom dia|boa tarde|boa noite|hello|hi|hey|obrigad[oa]?|muito obrigad[oa]?|thanks|thank you|ate logo|tchau|bye)[!.? ]*$/
// Deliberately loose and only ever used to pick modelTier (never to gate
// tools — see the module doc above). A false negative here just means a
// negotiation-heavy turn ran on the cheap model instead of the smart one:
// a quality/cost trade-off, never a capability the customer can't reach.
const LIKELY_SALES =
  /\b(preco|quanto custa|comprar|compra|produto|catalogo|stock|estoque|tamanho|cor|disponivel|disponibilidade|encomendar|reservar|fotografia|foto|desconto|negociar|price|buy|product|catalog|size|colour|color|available|discount)\b/

/**
 * Deterministic first-pass router — SaaS-wide, not tuned to any one
 * tenant's product vocabulary. It used to also narrow which tools the
 * agent could use per intent (a SALES keyword list gating catalogue
 * access, etc.), but a fixed word list can never keep up with an
 * arbitrary business's own vocabulary — a live bug report showed a real
 * shopping conversation ("Legging" -> "Azul" -> "Me mostre as duas
 * opções") never matching the SALES pattern once, silently losing
 * catalogue access on every turn until the bot had nothing left to
 * fulfil an ordinary request with and handed off unnecessarily. That is
 * fundamentally unfixable by growing the keyword list — the next tenant
 * sells something else.
 *
 * This router now only ever does two things, both of them safe in a
 * multi-tenant SaaS precisely because they DON'T require anticipating a
 * tenant's vocabulary:
 *   - modelTier: a cost/quality dial (cheap model by default, upgraded
 *     for turns that need more reasoning). Picking the wrong tier costs
 *     money or quality, never correctness.
 *   - forceHandoff: a conservative safety net for complaints and
 *     sensitive account/payment requests. Erring toward "hand off to a
 *     human" is the right default for ANY business when this fires —
 *     unlike capability-gating, a false positive here only costs a
 *     human a few extra seconds, never leaves a customer stuck.
 *
 * Which tools the agent may call is decided ONLY by what the account
 * itself configured (see auto-reply.ts) — never narrowed further here.
 * The model decides which of its available tools to use and when; that
 * judgement call belongs to the model, not to a keyword list.
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
    return { intent: 'complaint', modelTier: 'smart', forceHandoff: true }
  }
  if (SENSITIVE_ACCOUNT.test(text)) {
    return { intent: 'account', modelTier: 'smart', forceHandoff: true }
  }
  if (SMALLTALK.test(text)) {
    return { intent: 'smalltalk', modelTier: 'fast', forceHandoff: false }
  }
  if (LIKELY_SALES.test(text)) {
    return { intent: 'sales', modelTier: 'smart', forceHandoff: false }
  }
  return { intent: 'faq', modelTier: 'fast', forceHandoff: false }
}

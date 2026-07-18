export type AiAgentDecision =
  | { action: 'reply'; text: string; deal_action?: DealAction; confidence: number }
  | { action: 'no_reply'; reason: string; deal_action?: DealAction; confidence: number }
  | { action: 'handoff'; reason: string; confidence: number }

export type DealAction =
  | { type: 'none' }
  | { type: 'create'; pipeline_id: string; stage_id: string; title: string; value?: number }
  | { type: 'move'; deal_id: string; stage_id: string; reason: string }
  | { type: 'update'; deal_id: string; title?: string; value?: number; expected_close_date?: string }

export class AiAgentDecisionValidationError extends Error {
  readonly code: 'invalid_json' | 'invalid_decision'

  constructor(code: 'invalid_json' | 'invalid_decision', message: string) {
    super(message)
    this.name = 'AiAgentDecisionValidationError'
    this.code = code
  }
}

export interface AiAgentDecisionProvider {
  complete(input: { model: string; system: string; user: string; maxOutputTokens?: number }): Promise<string>
}

export interface RequestAiAgentDecisionInput {
  model: string
  instructions: string
  context: unknown
  provider: AiAgentDecisionProvider
  maxOutputTokens?: number
}

const DEFAULT_AI_AGENT_MAX_OUTPUT_TOKENS = 700
const MIN_AI_AGENT_MAX_OUTPUT_TOKENS = 128
const MAX_AI_AGENT_MAX_OUTPUT_TOKENS = 2_000

export function getAiAgentMaxOutputTokens(value = process.env.AI_AGENT_MAX_OUTPUT_TOKENS): number {
  const normalized = value?.trim()
  if (!normalized) return DEFAULT_AI_AGENT_MAX_OUTPUT_TOKENS

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return DEFAULT_AI_AGENT_MAX_OUTPUT_TOKENS

  return Math.min(
    MAX_AI_AGENT_MAX_OUTPUT_TOKENS,
    Math.max(MIN_AI_AGENT_MAX_OUTPUT_TOKENS, Math.trunc(parsed)),
  )
}

export function parseAiAgentDecisionJson(raw: string): AiAgentDecision {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw invalidJson()
  }

  return validateAiAgentDecision(value)
}

export function validateAiAgentDecision(value: unknown): AiAgentDecision {
  if (!isRecord(value) || !isConfidence(value.confidence) || typeof value.action !== 'string') {
    throw invalidDecision()
  }

  if (value.action === 'reply') {
    const text = requiredString(value.text)
    const deal_action = optionalDealAction(value.deal_action)
    return deal_action
      ? { action: 'reply', text, confidence: value.confidence, deal_action }
      : { action: 'reply', text, confidence: value.confidence }
  }

  if (value.action === 'no_reply') {
    const reason = requiredString(value.reason)
    const deal_action = optionalDealAction(value.deal_action)
    return deal_action
      ? { action: 'no_reply', reason, confidence: value.confidence, deal_action }
      : { action: 'no_reply', reason, confidence: value.confidence }
  }

  if (value.action === 'handoff') {
    if ('deal_action' in value) throw invalidDecision()
    return { action: 'handoff', reason: requiredString(value.reason), confidence: value.confidence }
  }

  throw invalidDecision()
}

export function buildAiAgentDecisionMessages(input: {
  instructions: string
  context: unknown
}): { system: string; user: string } {
  return {
    system: `You are an AI inbox agent for a CRM. Return only strict JSON matching this decision schema, with no markdown or extra text.\n\n${input.instructions}\n\nSchema:\n- reply: { "action": "reply", "text": "non-empty string", "confidence": 0..1, "deal_action"?: deal action }\n- no_reply: { "action": "no_reply", "reason": "non-empty string", "confidence": 0..1, "deal_action"?: deal action }\n- handoff: { "action": "handoff", "reason": "non-empty string", "confidence": 0..1 }\n- deal action: { "type": "none" } | { "type": "create", "pipeline_id": "string", "stage_id": "string", "title": "string", "value"?: "non-negative number" } | { "type": "move", "deal_id": "string", "stage_id": "string", "reason": "string" } | { "type": "update", "deal_id": "string", "title"?: "string", "value"?: "non-negative number", "expected_close_date"?: "YYYY-MM-DD" }\n\nUse deal_action only for reply or no_reply. Handoff must not include deal_action.`,
    user: `CRM context:\n${JSON.stringify(input.context, null, 2)}`,
  }
}

export async function requestAiAgentDecision(input: RequestAiAgentDecisionInput): Promise<AiAgentDecision> {
  const { system, user } = buildAiAgentDecisionMessages(input)
  const raw = await input.provider.complete({
    model: input.model,
    system,
    user,
    maxOutputTokens: input.maxOutputTokens,
  })
  return parseAiAgentDecisionJson(raw)
}

function optionalDealAction(value: unknown): DealAction | undefined {
  return value === undefined ? undefined : validateDealAction(value)
}

function validateDealAction(value: unknown): DealAction {
  if (!isRecord(value) || typeof value.type !== 'string') throw invalidDecision()

  if (value.type === 'none') return { type: 'none' }

  if (value.type === 'create') {
    const action: DealAction = {
      type: 'create',
      pipeline_id: requiredString(value.pipeline_id),
      stage_id: requiredString(value.stage_id),
      title: requiredString(value.title),
    }
    if (value.value !== undefined) {
      if (!isNonNegativeNumber(value.value)) throw invalidDecision()
      action.value = value.value
    }
    return action
  }

  if (value.type === 'move') {
    return {
      type: 'move',
      deal_id: requiredString(value.deal_id),
      stage_id: requiredString(value.stage_id),
      reason: requiredString(value.reason),
    }
  }

  if (value.type === 'update') {
    const action: Extract<DealAction, { type: 'update' }> = {
      type: 'update',
      deal_id: requiredString(value.deal_id),
    }
    if (value.title !== undefined) action.title = requiredString(value.title)
    if (value.value !== undefined) {
      if (!isNonNegativeNumber(value.value)) throw invalidDecision()
      action.value = value.value
    }
    if (value.expected_close_date !== undefined) {
      if (typeof value.expected_close_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.expected_close_date)) {
        throw invalidDecision()
      }
      action.expected_close_date = value.expected_close_date
    }
    if (action.title === undefined && action.value === undefined && action.expected_close_date === undefined) {
      throw invalidDecision()
    }
    return action
  }

  throw invalidDecision()
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw invalidDecision()
  const trimmed = value.trim()
  if (!trimmed) throw invalidDecision()
  return trimmed
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidJson(): AiAgentDecisionValidationError {
  return new AiAgentDecisionValidationError('invalid_json', 'AI agent decision is not valid JSON')
}

function invalidDecision(): AiAgentDecisionValidationError {
  return new AiAgentDecisionValidationError('invalid_decision', 'AI agent decision has an invalid shape')
}

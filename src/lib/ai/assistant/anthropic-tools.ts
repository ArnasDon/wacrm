import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError, type AiUsage, type ChatMessage } from '@/lib/ai/types'
import { mergeConsecutive, providerHttpError, toNetworkError } from '@/lib/ai/providers/shared'
import { ASSISTANT_TOOLS, executeReadTool, isWriteTool } from './tools'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// A chat turn here can legitimately need several read-tool round trips
// (search a contact, then search its deals, then list pipeline stages,
// then answer) before it either answers in text or proposes one write
// action — higher than the single-shot auto-reply's budget.
const MAX_OUTPUT_TOKENS = 2048
const MAX_TOOL_ROUNDS = 6

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface LoopMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

interface AnthropicToolResponse {
  content?: ContentBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** One proposed write action the model wants to take. Never executed by
 *  this module — the caller (route.ts) hands it to the frontend, which
 *  must get the owner's explicit confirmation before anything runs. */
export interface PendingAction {
  action: string
  input: Record<string, unknown>
}

export interface AssistantTurnResult {
  reply: string
  pendingAction: PendingAction | null
  usage: AiUsage | null
}

/** Mirrors providers/anthropic.ts's `normalizeForAnthropic` (not
 *  exported there) for the plain-text history this turn starts from —
 *  tool_use/tool_result turns added by the loop itself are already
 *  well-formed and don't need this pass. */
function seedMessages(messages: ChatMessage[]): LoopMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift()
  if (merged.length === 0) {
    return [{ role: 'user', content: '(No message yet.)' }]
  }
  return merged.map((m) => ({ role: m.role, content: m.content }))
}

async function callAnthropic(args: {
  apiKey: string
  model: string
  systemPrompt: string
  messages: LoopMessage[]
  timeoutMs: number
}): Promise<AnthropicToolResponse> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: ASSISTANT_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('Anthropic', res)
  const data = (await res.json().catch(() => null)) as AnthropicToolResponse | null
  if (!data) throw new AiError('Anthropic returned an unparseable response.', { code: 'empty_response' })
  return data
}

/**
 * Run one owner turn of the assistant to completion: calls Anthropic
 * with the tool catalog, executes every READ tool the model asks for
 * immediately (server-side, scoped to `accountId` via `db`'s RLS), and
 * feeds results back — bounded by `MAX_TOOL_ROUNDS`. The moment the
 * model calls a WRITE tool, the loop stops without executing it and
 * returns it as `pendingAction`; nothing is ever mutated inside this
 * function.
 */
export async function runAssistantTurn(args: {
  db: SupabaseClient
  accountId: string
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  timeoutMs: number
}): Promise<AssistantTurnResult> {
  const { db, accountId, apiKey, model, systemPrompt, messages, timeoutMs } = args

  const loopMessages: LoopMessage[] = seedMessages(messages)
  let promptTokens = 0
  let completionTokens = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callAnthropic({ apiKey, model, systemPrompt, messages: loopMessages, timeoutMs })
    promptTokens += data.usage?.input_tokens ?? 0
    completionTokens += data.usage?.output_tokens ?? 0

    const blocks = data.content ?? []
    const textBlocks = blocks.filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    const toolUseBlocks = blocks.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use',
    )
    const replyText = textBlocks.map((b) => b.text).join('').trim()

    if (toolUseBlocks.length === 0) {
      return { reply: replyText, pendingAction: null, usage: toUsage(promptTokens, completionTokens) }
    }

    const writeCall = toolUseBlocks.find((b) => isWriteTool(b.name))
    if (writeCall) {
      return {
        reply: replyText,
        pendingAction: { action: writeCall.name, input: writeCall.input },
        usage: toUsage(promptTokens, completionTokens),
      }
    }

    // Every block this round is a read tool — execute them all, then
    // feed results back as one user turn carrying every tool_result.
    loopMessages.push({ role: 'assistant', content: blocks })
    const results: ContentBlock[] = []
    for (const call of toolUseBlocks) {
      try {
        const result = await executeReadTool(db, accountId, call.name, call.input)
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.push({ type: 'tool_result', tool_use_id: call.id, content: message, is_error: true })
      }
    }
    loopMessages.push({ role: 'user', content: results })
  }

  return {
    reply: 'I looked into this but need a more specific question to finish — could you narrow it down?',
    pendingAction: null,
    usage: toUsage(promptTokens, completionTokens),
  }
}

function toUsage(promptTokens: number, completionTokens: number): AiUsage | null {
  if (promptTokens === 0 && completionTokens === 0) return null
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
}

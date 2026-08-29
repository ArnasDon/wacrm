import { AiError, type ChatMessage, type ProviderResult, type ToolCallLogEntry } from '../types'
import { MAX_OUTPUT_TOKENS, MAX_TOOL_TURNS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

/** One block of the REQUEST's `system` field — distinct from
 *  `AnthropicContentBlock` above (which models the RESPONSE's content
 *  array and tool-result turns). `cache_control` is the only field
 *  prompt caching adds (AI optimization project, FASE 8): Anthropic
 *  caches everything from the start of `system` up through a block that
 *  carries it. Never present on a block built from dynamic content —
 *  see `toAnthropicSystem` below. */
type AnthropicSystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }

/**
 * Build the `system` field for the wire request. When the caller
 * supplied `systemPromptBlocks` (see providers/shared.ts and
 * ../defaults.ts::buildSystemPromptBlocks), this returns TWO blocks:
 * the stable/rule prefix marked as an ephemeral cache breakpoint, then
 * (only if non-empty) everything dynamic — current message context,
 * retrieved Knowledge, catalog context, Business Profile data — with NO
 * `cache_control`, exactly matching FASE 8's explicit "never cache
 * dynamic content" rule. The leading `\n\n` on the second block
 * reproduces the same separator `buildSystemPrompt`'s plain-string
 * `parts.join('\n\n')` would have inserted there, so the text Anthropic
 * actually sees is identical to the flat string other providers get —
 * just split at a different point (see buildSystemPromptBlocks's doc for
 * why the two blocks are ordered stable-then-dynamic rather than
 * following the original interleaved order).
 *
 * Falls back to the plain string (no array, no cache_control) when
 * `systemPromptBlocks` is absent — the exact behavior this feature
 * didn't change, still the only path for OpenAI/OpenRouter and for any
 * caller that hasn't been updated to pass blocks.
 */
function toAnthropicSystem(systemPrompt: string, blocks?: { stable: string; dynamic: string }): string | AnthropicSystemBlock[] {
  if (!blocks) return systemPrompt
  const result: AnthropicSystemBlock[] = [
    { type: 'text', text: blocks.stable, cache_control: { type: 'ephemeral' } },
  ]
  if (blocks.dynamic) {
    result.push({ type: 'text', text: `\n\n${blocks.dynamic}` })
  }
  return result
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  stop_reason?: string
  // `cache_creation_input_tokens`/`cache_read_input_tokens` (AI
  // optimization project, FASE 8's follow-up — Usage integration) are
  // ONLY present on a response when prompt caching actually wrote to or
  // read from a cache entry this call; a request with no
  // `systemPromptBlocks` (no cache_control on the wire — see
  // toAnthropicSystem above) never has them at all. Kept strictly
  // separate from `input_tokens`, which Anthropic already reports net
  // of both — never add them together.
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): AnthropicMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged.map((m) => ({ role: m.role, content: m.content }))
}

function toAnthropicTools(tools: NonNullable<ProviderArgs['tools']>) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`). Runs a bounded tool-calling loop internally when
 * `args.tools`/`args.executeTool` are set — see
 * docs/integrations/ai-data-integration/01_MASTER_EXECUTION.md
 * ("TOOL CALLING").
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, systemPromptBlocks, messages, timeoutMs, tools, executeTool } = args
  const maxTurns = args.maxToolTurns ?? MAX_TOOL_TURNS

  const wireMessages = normalizeForAnthropic(messages)
  const aggregatedUsage = { prompt: 0, completion: 0, cacheCreation: 0, cacheRead: 0 }
  // Tracked separately from the running sums above: a turn that never
  // reports cache fields at all (caching not configured for this call)
  // must leave the final AiUsage without these keys entirely — summing
  // absent fields as 0 would otherwise be indistinguishable from "this
  // call genuinely created/read zero cache tokens", which is a real,
  // different, reportable state (see normalizeUsage's doc).
  let sawCacheCreation = false
  let sawCacheRead = false
  const toolCallLog: ToolCallLogEntry[] = []
  const wireTools = tools && tools.length > 0 ? toAnthropicTools(tools) : undefined
  // Built ONCE, outside the loop — the same value is sent on every turn
  // of the tool-calling exchange below (turns 2+ are exactly where the
  // cache breakpoint pays off: identical `system` content, cheaper
  // "cache read" pricing instead of full input reprocessing).
  const wireSystem = toAnthropicSystem(systemPrompt, systemPromptBlocks)

  for (let turn = 0; ; turn++) {
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
          system: wireSystem,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: wireMessages,
          ...(wireTools ? { tools: wireTools } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('Anthropic', res)
    }

    const data = (await res.json().catch(() => null)) as AnthropicResponse | null
    const blocks = data?.content ?? []

    aggregatedUsage.prompt += data?.usage?.input_tokens ?? 0
    aggregatedUsage.completion += data?.usage?.output_tokens ?? 0
    if (typeof data?.usage?.cache_creation_input_tokens === 'number') {
      aggregatedUsage.cacheCreation += data.usage.cache_creation_input_tokens
      sawCacheCreation = true
    }
    if (typeof data?.usage?.cache_read_input_tokens === 'number') {
      aggregatedUsage.cacheRead += data.usage.cache_read_input_tokens
      sawCacheRead = true
    }

    const toolUseBlocks = blocks.filter((b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')

    if (toolUseBlocks.length > 0 && executeTool && turn < maxTurns) {
      wireMessages.push({ role: 'assistant', content: blocks })
      const resultBlocks: AnthropicContentBlock[] = []
      for (const block of toolUseBlocks) {
        const result = await executeTool({ id: block.id, name: block.name, input: block.input })
        toolCallLog.push({ name: block.name, input: block.input, result })
        resultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }
      wireMessages.push({ role: 'user', content: resultBlocks })
      continue // ask the model again with the tool results in context
    }

    const text = blocks
      .filter((b): b is Extract<AnthropicContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    // Anthropic reports input/output but no total — normalizeUsage sums.
    // Cache fields are passed through only when at least one turn this
    // call actually reported them — see the sawCacheCreation/sawCacheRead
    // doc above.
    const usage = normalizeUsage({
      prompt: aggregatedUsage.prompt,
      completion: aggregatedUsage.completion,
      cacheCreationInputTokens: sawCacheCreation ? aggregatedUsage.cacheCreation : undefined,
      cacheReadInputTokens: sawCacheRead ? aggregatedUsage.cacheRead : undefined,
    })

    if (!text) {
      if (toolCallLog.length > 0) {
        return {
          text: 'Un momento, permíteme confirmar esa información.',
          usage,
          toolCalls: toolCallLog,
        }
      }
      throw new AiError('Anthropic returned an empty response.', { code: 'empty_response' })
    }

    return { text, usage, toolCalls: toolCallLog }
  }
}

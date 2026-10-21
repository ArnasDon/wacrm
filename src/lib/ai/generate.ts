import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
  type ToolExecutor,
  type ToolSpec,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenRouter } from './providers/openrouter'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Stable/dynamic split of the SAME system prompt (see
   *  `buildSystemPromptBlocks`, AI optimization project FASE 8) —
   *  threaded straight through to the provider adapters; only the
   *  Anthropic one reads it (to mark a prompt-cache breakpoint on the
   *  stable prefix). Omitted entirely reproduces today's behavior for
   *  every provider, Anthropic included. */
  systemPromptBlocks?: { stable: string; dynamic: string }
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  /** Catalog tools to attach (see src/lib/ai/tools/catalog-tools.ts).
   *  Omitted for accounts with no active catalog source — the request
   *  goes out exactly as it did before this feature existed. */
  tools?: ToolSpec[]
  executeTool?: ToolExecutor
  /** Override for MAX_TOOL_TURNS (defaults.ts) — mainly for tests. */
  maxToolTurns?: number
  /** Override for MAX_TOOL_CALLS_PER_GENERATE (defaults.ts) — mainly for
   *  tests. */
  maxToolCalls?: number
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, systemPromptBlocks, messages, tools, executeTool, maxToolTurns, maxToolCalls } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    systemPromptBlocks,
    messages,
    timeoutMs,
    tools,
    executeTool,
    maxToolTurns,
    maxToolCalls,
  }

  let result: {
    text: string
    usage: AiUsage | null
    toolCalls?: GenerateResult['toolCalls']
    finishReason?: string
    toolTurnsExhausted?: boolean
  }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'openrouter':
      result = await generateOpenRouter(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage, result.toolCalls, result.finishReason, result.toolTurnsExhausted)
}

/**
 * Split the raw model output into `{ text, handoff, usage, toolCalls }`.
 * The sentinel can appear alone or trailing a partial reply; either way
 * we treat the turn as a handoff and strip the marker from any
 * remaining text. `usage` is passed straight through (null when the
 * provider didn't report it).
 *
 * Playground/WhatsApp reliability audit (Oct 2026) — `toolTurnsExhausted`
 * ALSO forces `handoff: true`, regardless of mode. Previously this flag
 * was purely diagnostic (logged, never acted on): a model cut off mid
 * tool-investigation fell through to a canned "Un momento, permíteme
 * confirmar esa información." string reported as an ordinary successful
 * reply — auto-reply.ts's `if (handoff || !text)` never fired because
 * `text` was non-empty, so the customer got a promise of a follow-up
 * that nothing ever sent, and no human was ever notified. Exhausting the
 * tool budget/turn cap means the investigation is, by definition,
 * incomplete — that is never a resolved query, so it is routed through
 * the SAME existing handoff path a model-requested [[HANDOFF]] already
 * uses, rather than inventing a second mechanism.
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
  toolCalls: GenerateResult['toolCalls'] = [],
  finishReason?: string,
  toolTurnsExhausted?: boolean,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL) || toolTurnsExhausted === true
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage, toolCalls, finishReason, toolTurnsExhausted }
}

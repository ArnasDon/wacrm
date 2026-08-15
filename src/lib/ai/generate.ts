import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { sumUsage } from './providers/shared'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import type { ToolDef } from './tag-tool'
import type { ProviderToolCall } from './providers/shared'
import {
  generateOpenAi,
  generateOpenAiTurn,
  continueOpenAiAfterTools,
} from './providers/openai'
import {
  generateAnthropic,
  generateAnthropicTurn,
  continueAnthropicAfterTools,
} from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}

/** Outcome of applying (or not) one `add_tag` call, reported back by
 *  the caller so a tool-result ack can be built for the follow-up turn. */
export interface AppliedTagResult {
  tagId: string
  applied: boolean
  tagName?: string
}

export interface GenerateWithToolsArgs extends GenerateArgs {
  /** The `add_tag` tool to offer, or `null` when the account has no
   *  AI-assignable tags — in which case this behaves exactly like
   *  `generateReply`. */
  tool: ToolDef | null
  /** Runs the actual tag-apply side effect for whatever calls the model
   *  made (deduping/capping is the caller's responsibility — every call
   *  the model made is passed through here). Must resolve one result
   *  per call, used to build the tool-result acks for the follow-up. */
  onToolCalls: (calls: ProviderToolCall[]) => Promise<AppliedTagResult[]>
}

function buildToolAck(call: ProviderToolCall, results: AppliedTagResult[]): string {
  const result = results.find((r) => r.tagId === call.tagId)
  return result?.applied ? `Tag applied: ${result.tagName ?? result.tagId}.` : 'Not applied.'
}

/**
 * Like `generateReply`, but offers the `add_tag` tool when `tool` is
 * non-null. If the model calls it, `onToolCalls` performs the actual
 * side effect (this function stays side-effect-free — the DB write and
 * audit belong to the caller), then exactly one follow-up request
 * replays the tool call(s) and their result(s) to get the final
 * natural-language reply. Never more than one extra round trip.
 */
export async function generateReplyWithTools(
  args: GenerateWithToolsArgs,
): Promise<GenerateResult> {
  const { config, systemPrompt, messages, tool, onToolCalls } = args

  if (!tool) {
    return generateReply({ config, systemPrompt, messages })
  }

  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  switch (config.provider) {
    case 'openai': {
      const turn = await generateOpenAiTurn({ ...providerArgs, tool })
      if (turn.toolCalls.length === 0) {
        return parseGeneration(turn.text ?? '', turn.usage)
      }
      const results = await onToolCalls(turn.toolCalls)
      const { text, usage } = await continueOpenAiAfterTools({
        ...providerArgs,
        assistantMessage: turn.assistantMessage,
        toolResults: turn.toolCalls.map((c) => ({ id: c.id, content: buildToolAck(c, results) })),
      })
      return {
        ...parseGeneration(text, sumUsage(turn.usage, usage)),
        toolCalls: turn.toolCalls.map(({ tagId, reason }) => ({ tagId, reason })),
      }
    }
    case 'anthropic': {
      const turn = await generateAnthropicTurn({ ...providerArgs, tool })
      if (turn.toolCalls.length === 0) {
        return parseGeneration(turn.text ?? '', turn.usage)
      }
      const results = await onToolCalls(turn.toolCalls)
      const { text, usage } = await continueAnthropicAfterTools({
        ...providerArgs,
        assistantContent: turn.assistantContent,
        toolResults: turn.toolCalls.map((c) => ({ id: c.id, content: buildToolAck(c, results) })),
      })
      return {
        ...parseGeneration(text, sumUsage(turn.usage, usage)),
        toolCalls: turn.toolCalls.map(({ tagId, reason }) => ({ tagId, reason })),
      }
    }
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}

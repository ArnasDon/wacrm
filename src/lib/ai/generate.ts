import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL,
  MAX_TOOL_ITERATIONS,
  MAX_TOOL_LOOP_MS,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateDeepSeek } from './providers/deepseek'
import type { ToolLoopArgs } from './providers/shared'
import { executeTool } from './tools/execute'
import { toAnthropicTool, toOpenAiTool } from './tools/schema'
import type { AiTool, ToolCallRecord } from './tools/types'

export interface GenerateArgs {
  config: AiConfig
  /** Stable portion of the system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Knowledge-base excerpts for this question — kept separate from
   *  `systemPrompt` so Anthropic can cache the stable part independent
   *  of turn-to-turn KB variation. Omitted when there's nothing to
   *  ground the reply in. */
  knowledgeBlock?: string
  /** Condensed summary of history older than the current context window
   *  — see `buildContextWithHistorySummary`. Omitted when the account
   *  hasn't enabled history summarization or the conversation hasn't
   *  exceeded the window yet. */
  historyBlock?: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  /** Account's active tools. Omitted/empty ⇒ the provider request is
   *  identical to before tool calling existed — no `tools` param, no
   *  loop, single call. */
  tools?: AiTool[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 *
 * When `tools` is non-empty, wires a `ToolLoopArgs` into the provider
 * call: the adapter runs its own agentic loop (see
 * `providers/{openai,anthropic}.ts`), calling `executeTool` by name for
 * every tool_use the model requests, up to `MAX_TOOL_ITERATIONS` round
 * trips. Every call made is collected into `toolCalls` for the caller
 * to persist/display.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, knowledgeBlock, historyBlock, messages, tools } = args
  const timeoutMs = aiRequestTimeoutMs()

  const toolCalls: ToolCallRecord[] = []
  const toolLoop: ToolLoopArgs | undefined =
    tools && tools.length > 0
      ? {
          toolDefs:
            config.provider === 'anthropic'
              ? tools.map(toAnthropicTool)
              : tools.map(toOpenAiTool),
          maxIterations: MAX_TOOL_ITERATIONS,
          deadlineAt: Date.now() + MAX_TOOL_LOOP_MS,
          onToolCall: (record) => toolCalls.push(record),
          runTool: async (toolName, toolArgs) => {
            const tool = tools.find((t) => t.name === toolName)
            if (!tool) {
              return {
                ok: false,
                status: null,
                statusText: null,
                body: null,
                durationMs: 0,
                error: `Unknown tool "${toolName}".`,
                request: { method: 'GET', url: '', headers: {}, body: null },
              }
            }
            return executeTool(tool, toolArgs)
          },
        }
      : undefined

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    knowledgeBlock,
    historyBlock,
    messages,
    timeoutMs,
    toolLoop,
    temperature: config.temperature,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'deepseek':
      result = await generateDeepSeek(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage, toolCalls)
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 *
 * `toolCalls`, when given a non-empty array, is attached to the result;
 * otherwise the returned object has no `toolCalls` key at all — keeps
 * the shape exactly what it was before tool calling existed for every
 * call that didn't use one (existing callers that do `toEqual` on the
 * whole result keep passing).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
  toolCalls: ToolCallRecord[] = [],
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage, ...(toolCalls.length > 0 ? { toolCalls } : {}) }
}

import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi, runOpenAiToolLoop } from './providers/openai'
import { generateAnthropic, runAnthropicToolLoop } from './providers/anthropic'
import { generateClaudeAgentSdk, runClaudeAgentSdkToolLoop } from './providers/claude-agent-sdk'
import type { ToolDefinition } from './tools/schema'
import type { ToolExecutor } from './tools/loop-types'

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
    case 'claude-agent-sdk':
      result = await generateClaudeAgentSdk(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

export interface GenerateWithToolsArgs extends GenerateArgs {
  tools: readonly ToolDefinition[]
  executor: ToolExecutor
  maxIterations?: number
  toolTimeoutMs?: number
}

export interface GenerateWithToolsResult extends GenerateResult {
  iterations: number
  hitIterationLimit: boolean
}

/**
 * Same contract as `generateReply`, but runs the full agentic
 * tool-calling loop (see providers/anthropic.ts `runAnthropicToolLoop` /
 * providers/openai.ts `runOpenAiToolLoop`) before parsing the handoff
 * sentinel out of whatever text the model settles on. Use this for the
 * EterWA agent turn; plain `generateReply` stays as-is for the existing
 * draft / auto-reply paths that don't call tools.
 */
export async function generateReplyWithTools(
  args: GenerateWithToolsArgs,
): Promise<GenerateWithToolsResult> {
  const { config, systemPrompt, messages, tools, executor, maxIterations, toolTimeoutMs } = args
  const timeoutMs = aiRequestTimeoutMs()
  const loopArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
    tools,
    executor,
    maxIterations,
    toolTimeoutMs,
  }

  let result: { text: string; usage: AiUsage | null; iterations: number; hitIterationLimit: boolean }
  switch (config.provider) {
    case 'openai':
      result = await runOpenAiToolLoop(loopArgs)
      break
    case 'anthropic':
      result = await runAnthropicToolLoop(loopArgs)
      break
    case 'claude-agent-sdk':
      result = await runClaudeAgentSdkToolLoop(loopArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  const parsed = parseGeneration(result.text, result.usage)
  return { ...parsed, iterations: result.iterations, hitIterationLimit: result.hitIterationLimit }
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

import type { ToolDefinition } from './schema'
import type { AiUsage } from '../types'

// ============================================================
// Provider-agnostic tool-calling contract. The Anthropic and OpenAI
// adapters translate to/from these types at their own boundary — see
// `ETER_AGENT_TOOLS` (schema.ts) for where `ToolDefinition` comes from,
// and providers/anthropic.ts / providers/openai.ts for the wire-format
// mapping (`input_schema` vs `function.parameters`, `tool_use` vs
// `tool_calls`, etc.).
// ============================================================

/** One tool invocation the model asked for, already parsed. */
export interface ToolCall {
  /** Provider-native call id — must be echoed back on the matching
   *  result so the provider can pair them up (`tool_use_id` /
   *  `tool_call_id`). Opaque to callers. */
  id: string
  name: string
  input: Record<string, unknown>
}

/** What a tool handler hands back to `runToolLoop`. */
export interface ToolExecutionResult {
  /** Sent back to the model as the tool_result content — plain text or
   *  a JSON string, whichever reads better to the model for this tool. */
  content: string
  /** True marks this as a tool-level failure (`is_error` on Anthropic,
   *  a failed function result on OpenAI) so the model treats it as a
   *  recoverable error rather than a real answer. */
  isError: boolean
}

/** Executes one resolved tool call. Implemented by
 *  `src/lib/ai/tools/handlers/index.ts`, bound to the account/
 *  conversation context for a single agent turn. Must never throw for
 *  an expected/handled failure — return `{ isError: true, ... }`
 *  instead; `runToolLoop` treats an actual thrown error as a bug and
 *  still recovers (logs + turns it into an error tool_result) but that
 *  path exists as a safety net, not the intended one. */
export type ToolExecutor = (call: ToolCall) => Promise<ToolExecutionResult>

export interface ToolLoopArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  timeoutMs: number
  tools: readonly ToolDefinition[]
  executor: ToolExecutor
  /** Hard cap on request↔tool round-trips. Defaults to
   *  `DEFAULT_MAX_TOOL_ITERATIONS` (see defaults.ts) — this is what
   *  stands between a confused model and an unbounded bill. */
  maxIterations?: number
  /** Per-tool-call wall-clock budget. Defaults to
   *  `DEFAULT_TOOL_TIMEOUT_MS`. A timed-out call is reported back to
   *  the model as an error tool_result, not thrown. */
  toolTimeoutMs?: number
}

/** Sum two normalized usage blocks, tolerant of either being null (a
 *  provider that didn't report usage on a given turn). Shared by both
 *  provider tool loops (anthropic.ts `runAnthropicToolLoop`, openai.ts
 *  `runOpenAiToolLoop`) so they don't each carry their own copy. */
export function sumUsage(a: AiUsage | null, b: AiUsage | null): AiUsage | null {
  if (!a) return b
  if (!b) return a
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

export interface ToolLoopResult {
  /** Final assistant text once the model stops calling tools. */
  text: string
  /** Summed token usage across every request in the loop (null only
   *  when the provider never reported usage on any turn). */
  usage: AiUsage | null
  /** How many request↔tool round-trips actually ran. */
  iterations: number
  /** True when the loop stopped because it hit `maxIterations`, not
   *  because the model naturally finished — callers may want to warn
   *  the user the agent gave up mid-task. */
  hitIterationLimit: boolean
}

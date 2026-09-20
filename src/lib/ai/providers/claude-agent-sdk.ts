// ============================================================
// Provider "claude-agent-sdk" — talks to Claude via
// `@anthropic-ai/claude-agent-sdk` (`query()`), authenticated with
// `CLAUDE_CODE_OAUTH_TOKEN` instead of a per-account BYO key. This is
// the Eter Growth subscription, shared by the whole service — never an
// `ai_configs.api_key` row, and never `ANTHROPIC_API_KEY`.
//
// Pattern copied from the AI SDR's brain-driver-agent-sdk.ts (same
// repo family, same SDK, same auth model) — see that file's header for
// the reasoning on `query()` vs the raw Messages API, and on the SDK
// inheriting `process.env` by default (so the OAuth token never has to
// be threaded through `Options.env` explicitly). The one real
// difference from the AI SDR's driver: that one runs with `tools: []`
// (it only ever classifies/decides text). EterWA's commercial persona
// needs real tool-calling (check_commercial_availability /
// book_commercial_meeting), so this file also implements the
// tool-calling loop — see `runClaudeAgentSdkToolLoop` below.
//
// SECURITY (non-negotiable, see commercial-schema.ts's own header and
// the task that introduced this file): this agent talks to strangers
// who clicked a Meta ad. It must NEVER get access to the Agent SDK's
// built-in tools (Bash, Read, Write, WebFetch, Task/subagents, Skill,
// ...). Every call this file makes to `query()` sets:
//   - `tools: []`               — disables every built-in tool.
//   - `mcpServers: { eter_tools: <in-process server> }` — the ONLY
//     tools this agent can ever see are the ones `buildToolServer`
//     wraps from the caller's own `ToolDefinition[]` (commercial mode
//     passes `COMMERCIAL_TOOLS` — see tools/commercial-schema.ts).
//   - `allowedTools: [...]`     — explicitly names just those MCP tool
//     names, auto-approved without a permission prompt (this runs
//     headless, server-side — there is no human to answer one).
//   - `settingSources: []`      — no filesystem settings/CLAUDE.md/
//     skills are loaded from whatever `cwd` happens to be, so a stray
//     project file can never inject extra instructions or tools into
//     a customer-facing conversation.
// See generateClaudeAgentSdk (plain, no tools) and
// runClaudeAgentSdkToolLoop (with tools) — both build the same locked-
// down `Options` baseline via `baseOptions()`.
// ============================================================

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { AiError, type AiUsage, type ChatMessage, type ProviderResult } from '../types'
import { aiMaxToolIterations, aiToolTimeoutMs } from '../defaults'
import { mergeConsecutive, type ProviderArgs } from './shared'
import { executeToolCallWithTimeout } from '../tools/execute'
import { logToolEvent } from '../tools/log'
import type { ToolDefinition } from '../tools/schema'
import { toolParametersToZodShape } from '../tools/json-schema-to-zod'
import { sumUsage, type ToolExecutor, type ToolLoopArgs, type ToolLoopResult } from '../tools/loop-types'

/** Guard margin over the caller's `timeoutMs` before we give up on the
 *  subprocess independently of `AbortController` — mirrors the AI
 *  SDR's double-guard in brain-driver-agent-sdk.ts `runStructuredQuery`
 *  (a subprocess that never reacts to abort() must still not hang the
 *  conversation turn forever). */
const TIMEOUT_GUARD_MARGIN_MS = 5_000

/**
 * Race `consumeQuery` against the caller's timeout, aborting the SDK
 * query first and forcing rejection shortly after if the abort itself
 * doesn't land in time. Shared by both the plain and tool-loop paths.
 */
async function consumeQueryWithTimeout(
  prompt: string,
  options: Omit<Options, 'abortController'>,
  timeoutMs: number,
  queryImpl: QueryFn,
): Promise<{ text: string; usage: AiUsage | null; numTurns: number; hitMaxTurns: boolean }> {
  const abortController = new AbortController()
  const abortTimer = setTimeout(() => abortController.abort(), timeoutMs)

  let guardFired = false
  let guardTimer: ReturnType<typeof setTimeout>
  const guardPromise = new Promise<never>((_, reject) => {
    guardTimer = setTimeout(() => {
      guardFired = true
      abortController.abort()
      reject(
        new AiError(
          `Agent SDK excedeu o timeout e não reagiu ao abort (${timeoutMs + TIMEOUT_GUARD_MARGIN_MS}ms).`,
          { code: 'timeout', status: 504 },
        ),
      )
    }, timeoutMs + TIMEOUT_GUARD_MARGIN_MS)
  })

  try {
    return await Promise.race([
      consumeQuery(prompt, { ...options, abortController }, queryImpl),
      guardPromise,
    ])
  } catch (err) {
    if (guardFired) throw err
    if (abortController.signal.aborted) {
      throw new AiError('The AI provider took too long to respond.', {
        code: 'timeout',
        status: 504,
      })
    }
    throw err
  } finally {
    clearTimeout(abortTimer)
    clearTimeout(guardTimer!)
  }
}

/** Env var this provider authenticates with. Never `ANTHROPIC_API_KEY`
 *  — see this file's header. Exported for the settings UI/docs to
 *  reference the exact name in one place. */
export const CLAUDE_CODE_OAUTH_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'

/**
 * Fails loudly (never silently) when the Eter subscription token isn't
 * configured. `ai_configs.api_key` is irrelevant to this provider — a
 * missing token is a deploy/ops problem, not something an account
 * admin can fix from the settings form.
 *
 * This is NOT a new token to generate: it's the SAME
 * `CLAUDE_CODE_OAUTH_TOKEN` already live in production for the AI SDR
 * (`/etc/ai-sdr/.env`, loaded via `EnvironmentFile=` in its systemd
 * units — see e.g. tools/ai-sdr/deploy/ai-sdr-heartbeat.service). This
 * error only fires when EterWA's OWN process environment doesn't have
 * it — see docs/eter-agent-config.md for how to wire the existing
 * value into the Docker container (`docker-compose.yml` `environment`/
 * `env_file`, never baked into the image).
 */
export function requireClaudeCodeOAuthToken(): string {
  const token = process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV]
  if (!token || !token.trim()) {
    throw new AiError(
      `Falta a variável de ambiente ${CLAUDE_CODE_OAUTH_TOKEN_ENV} no ambiente deste serviço. O ` +
        'provider "claude-agent-sdk" autentica-se pela subscrição Claude Code da Eter, não por uma ' +
        'chave de conta — é o MESMO token que já está em produção para o AI SDR ' +
        '(/etc/ai-sdr/.env no OVH). Copia esse valor para o ambiente do container EterWA ' +
        '(docker-compose.yml, environment/env_file — nunca hardcoded, nunca em texto simples fora ' +
        `de um .env). Ver docs/eter-agent-config.md. Só se esse token deixar de existir é que se ` +
        'gera um novo com "claude setup-token".',
      { code: 'missing_oauth_token', status: 500 },
    )
  }
  return token
}

/** Same injectable-query pattern as the AI SDR's `QueryFn` (see
 *  brain-driver-agent-sdk.ts) — lets tests mock `query()` without
 *  spawning the real Claude Code subprocess. `query()`'s actual return
 *  type (`Query`) is an `AsyncGenerator<SDKMessage, void>`, which
 *  satisfies this narrower shape structurally. */
export type QueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>

const ROLE_LABEL: Record<ChatMessage['role'], string> = {
  user: 'cliente',
  assistant: 'assistente',
}

/**
 * The Agent SDK takes one `prompt` string per turn, not a message list
 * — flatten the transcript the same way the AI SDR's
 * `splitForAgentSdk` does (role-labelled lines), except there is no
 * separate "system" role to peel off here: `ProviderArgs.systemPrompt`
 * already carries that (see generate.ts), so it's passed straight to
 * `Options.systemPrompt` and only the user/assistant turns are
 * flattened into the prompt text.
 */
function toPrompt(messages: readonly ChatMessage[]): string {
  return mergeConsecutive([...messages])
    .map((m) => `[${ROLE_LABEL[m.role]}] ${m.content}`)
    .join('\n\n')
}

/**
 * Locked-down `Options` baseline shared by every call this provider
 * makes — see this file's header for why each field is here. Callers
 * layer `model`/`mcpServers`/`allowedTools`/`maxTurns` on top.
 */
function baseOptions(systemPrompt: string): Options {
  return {
    systemPrompt,
    tools: [], // no built-in tools whatsoever — see header.
    settingSources: [], // no filesystem CLAUDE.md/settings/skills.
  }
}

/**
 * Consume the SDK's message stream to its terminal `result` message.
 * Mirrors the AI SDR driver's `consumeQuery`, but reads the plain-text
 * `result` field (this provider never asks for `outputFormat:
 * json_schema` — EterWA's replies are free text, not a structured
 * decision object) instead of `structured_output`.
 */
async function consumeQuery(
  prompt: string,
  options: Options,
  queryImpl: QueryFn,
): Promise<{ text: string; usage: AiUsage | null; numTurns: number; hitMaxTurns: boolean }> {
  let finalText: string | undefined
  // Last assistant text seen before a `result`, tracked so an
  // `error_max_turns` outcome can still return whatever the model had
  // drafted — mirrors the Anthropic/OpenAI tool loops, which return
  // `lastText` + `hitIterationLimit: true` instead of throwing when
  // they hit their own round-trip cap (see anthropic.ts's
  // `runAnthropicToolLoop`). Every other failure subtype throws: those
  // are real execution failures, not "ran out of turns".
  let lastAssistantText = ''
  let usage: AiUsage | null = null
  let numTurns = 0
  let hitMaxTurns = false
  let failureDetail: string | undefined
  let sawResult = false

  for await (const message of queryImpl({ prompt, options })) {
    if (message.type === 'assistant') {
      const text = message.message.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
      if (text) lastAssistantText = text
      continue
    }
    if (message.type !== 'result') continue
    sawResult = true
    numTurns = message.num_turns
    usage = {
      promptTokens: message.usage.input_tokens ?? 0,
      completionTokens: message.usage.output_tokens ?? 0,
      totalTokens: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
    }
    if (message.subtype === 'success') {
      finalText = message.result
    } else if (message.subtype === 'error_max_turns') {
      hitMaxTurns = true
      finalText = lastAssistantText
    } else {
      failureDetail = `Agent SDK falhou (${message.subtype}): ${message.errors.join('; ') || 'sem detalhe'}`
    }
  }

  if (!sawResult) {
    throw new AiError('Agent SDK não devolveu resultado (mensagem "result" em falta).', {
      code: 'empty_response',
    })
  }
  if (finalText === undefined) {
    throw new AiError(failureDetail ?? 'Agent SDK falhou sem detalhe.', {
      code: 'provider_error',
    })
  }
  return { text: finalText, usage, numTurns, hitMaxTurns }
}

/**
 * Plain, tool-free generation — the `generateReply` path (drafts,
 * non-commercial auto-reply, the settings "Test key" liveness check).
 * Same `ProviderArgs` in / `ProviderResult` out contract as
 * `generateAnthropic`/`generateOpenAi` (generate.ts dispatches to
 * whichever provider by a plain switch) — `apiKey` is accepted but
 * unused: this provider never reads `ai_configs.api_key`, see this
 * file's header.
 */
export async function generateClaudeAgentSdk(
  args: ProviderArgs,
  queryImpl: QueryFn = query,
): Promise<ProviderResult> {
  requireClaudeCodeOAuthToken()

  const prompt = toPrompt(args.messages)
  const options: Omit<Options, 'abortController'> = {
    ...baseOptions(args.systemPrompt),
    ...(args.model ? { model: args.model } : {}),
  }

  const { text, usage } = await consumeQueryWithTimeout(prompt, options, args.timeoutMs, queryImpl)
  if (!text.trim()) {
    throw new AiError('Claude Agent SDK returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { text, usage }
}

/** Name of the in-process MCP server every commercial/tool-loop call
 *  mounts — also the namespace prefix in the resulting tool names
 *  (`mcp__eter_tools__<tool name>`), which is what `allowedTools` below
 *  names explicitly. */
export const ETER_TOOLS_MCP_SERVER_NAME = 'eter_tools'

/**
 * Build one Agent-SDK tool definition per `ToolDefinition`, each
 * delegating execution to `executor` via the SAME timeout+logging
 * wrapper the Anthropic/OpenAI loops use (`executeToolCallWithTimeout`
 * — keeps behaviour identical across all three providers: a slow or
 * throwing tool becomes an `isError` result the model sees, never a
 * hang or an unhandled rejection). The MCP tool-call id the SDK
 * assigns internally isn't ours to see through this API —
 * `randomUUID()` here only feeds the shared logging/timeout plumbing,
 * it plays no role in pairing the call with its result (that's the MCP
 * transport's job).
 *
 * Exported separately from `buildToolServer` (rather than only as part
 * of the assembled MCP server) so tests can call a tool's `.handler`
 * directly — asserting the executor is actually invoked, and that its
 * `ToolExecutionResult` is mapped to `CallToolResult` correctly —
 * without spinning up the real MCP transport (see
 * claude-agent-sdk.test.ts).
 */
export function buildEterToolDefinitions(
  tools: readonly ToolDefinition[],
  executor: ToolExecutor,
  toolTimeoutMs: number,
) {
  return tools.map((def) =>
    tool(def.name, def.description, toolParametersToZodShape(def), async (input) => {
      const result = await executeToolCallWithTimeout(
        { id: randomUUID(), name: def.name, input: input as Record<string, unknown> },
        executor,
        toolTimeoutMs,
      )
      return {
        content: [{ type: 'text' as const, text: result.content }],
        isError: result.isError,
      }
    }),
  )
}

/** Wraps `buildEterToolDefinitions` in the in-process MCP server
 *  `Options.mcpServers` expects — see this file's header for why this
 *  is the ONLY source of tools the commercial persona ever gets. */
function buildToolServer(
  tools: readonly ToolDefinition[],
  executor: ToolExecutor,
  toolTimeoutMs: number,
) {
  return createSdkMcpServer({
    name: ETER_TOOLS_MCP_SERVER_NAME,
    tools: buildEterToolDefinitions(tools, executor, toolTimeoutMs),
  })
}

/**
 * Run the agentic tool-calling loop against the Agent SDK. Unlike the
 * Anthropic/OpenAI adapters (which manually loop request↔tool_result
 * round-trips over the raw Messages/Chat Completions API), `query()`
 * runs the ENTIRE multi-turn tool loop internally in one call — we
 * just hand it the locked-down tool server (see `buildToolServer`) and
 * read off the terminal `result` message. `iterations`/
 * `hitIterationLimit` map onto the SDK's own `num_turns` /
 * `error_max_turns`, so callers (generate.ts, auto-reply.ts) see the
 * exact same `ToolLoopResult` shape regardless of which provider ran.
 */
export async function runClaudeAgentSdkToolLoop(
  args: ToolLoopArgs,
  queryImpl: QueryFn = query,
): Promise<ToolLoopResult> {
  requireClaudeCodeOAuthToken()

  const {
    systemPrompt,
    messages,
    tools,
    executor,
    timeoutMs,
    maxIterations = aiMaxToolIterations(),
    toolTimeoutMs = aiToolTimeoutMs(),
    model,
  } = args

  const prompt = toPrompt(messages)
  const toolServer = buildToolServer(tools, executor, toolTimeoutMs)
  const allowedTools = tools.map((t) => `mcp__${ETER_TOOLS_MCP_SERVER_NAME}__${t.name}`)

  const options: Omit<Options, 'abortController'> = {
    ...baseOptions(systemPrompt),
    ...(model ? { model } : {}),
    mcpServers: { [ETER_TOOLS_MCP_SERVER_NAME]: toolServer },
    allowedTools,
    maxTurns: maxIterations,
  }

  let text: string
  let usage: AiUsage | null
  let numTurns: number
  let hitMaxTurns: boolean
  try {
    ;({ text, usage, numTurns, hitMaxTurns } = await consumeQueryWithTimeout(
      prompt,
      options,
      timeoutMs,
      queryImpl,
    ))
  } catch (err) {
    console.error('[claude-agent-sdk] runClaudeAgentSdkToolLoop falhou a contactar o Agent SDK', err)
    throw err
  }

  if (hitMaxTurns) {
    logToolEvent('iteration_limit_reached', {
      iterations: numTurns,
      detail: `Agent SDK tool loop hit maxTurns=${maxIterations} without reaching a final answer.`,
    })
  }

  return {
    text,
    usage: sumUsage(null, usage),
    iterations: numTurns,
    hitIterationLimit: hitMaxTurns,
  }
}

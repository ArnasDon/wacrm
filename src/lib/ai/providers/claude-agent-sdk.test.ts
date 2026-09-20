import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  generateClaudeAgentSdk,
  runClaudeAgentSdkToolLoop,
  requireClaudeCodeOAuthToken,
  buildEterToolDefinitions,
  ETER_TOOLS_MCP_SERVER_NAME,
  CLAUDE_CODE_OAUTH_TOKEN_ENV,
  type QueryFn,
} from './claude-agent-sdk'
import type { ToolDefinition } from '../tools/schema'
import type { ToolExecutor } from '../tools/loop-types'
import { AiError } from '../types'

const ORIGINAL_TOKEN = process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV]

beforeEach(() => {
  process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV] = 'test-oauth-token'
})
afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV]
  else process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV] = ORIGINAL_TOKEN
  vi.restoreAllMocks()
})

function resultSuccess(text: string, overrides: Partial<SDKMessage> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: text,
    num_turns: 1,
    usage: { input_tokens: 12, output_tokens: 4 },
    ...overrides,
  } as unknown as SDKMessage
}

function resultError(subtype: string, errors: string[], numTurns = 1): SDKMessage {
  return {
    type: 'result',
    subtype,
    errors,
    num_turns: numTurns,
    usage: { input_tokens: 5, output_tokens: 0 },
  } as unknown as SDKMessage
}

function fakeQuery(messages: SDKMessage[]): QueryFn {
  return () =>
    (async function* () {
      for (const m of messages) yield m
    })()
}

const baseArgs = {
  systemPrompt: 'És um agente de teste.',
  messages: [{ role: 'user' as const, content: 'Olá' }],
  apiKey: '', // unused by this provider — see requireClaudeCodeOAuthToken.
  model: 'claude-sonnet-4-6',
  timeoutMs: 5_000,
}

describe('requireClaudeCodeOAuthToken', () => {
  it('returns the token when set', () => {
    expect(requireClaudeCodeOAuthToken()).toBe('test-oauth-token')
  })

  it('throws a clear AiError when the env var is missing', () => {
    delete process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV]
    expect(() => requireClaudeCodeOAuthToken()).toThrow(AiError)
    try {
      requireClaudeCodeOAuthToken()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AiError)
      expect((err as AiError).code).toBe('missing_oauth_token')
      expect((err as AiError).message).toContain(CLAUDE_CODE_OAUTH_TOKEN_ENV)
      expect((err as AiError).message).toContain('AI SDR')
    }
  })

  it('throws on a blank/whitespace-only token, not just an absent one', () => {
    process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV] = '   '
    expect(() => requireClaudeCodeOAuthToken()).toThrow(AiError)
  })
})

describe('generateClaudeAgentSdk', () => {
  it('fails fast when CLAUDE_CODE_OAUTH_TOKEN is missing, without calling query()', async () => {
    delete process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV]
    const queryImpl = vi.fn() as unknown as QueryFn
    await expect(generateClaudeAgentSdk(baseArgs, queryImpl)).rejects.toThrow(AiError)
    expect(queryImpl).not.toHaveBeenCalled()
  })

  it('returns the model text + normalized usage on success', async () => {
    const queryImpl = vi.fn(fakeQuery([resultSuccess('Olá! Como posso ajudar?')]))
    const result = await generateClaudeAgentSdk(baseArgs, queryImpl)
    expect(result.text).toBe('Olá! Como posso ajudar?')
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 })
  })

  it('never enables any built-in tool and disables filesystem settings', async () => {
    const queryImpl = vi.fn(fakeQuery([resultSuccess('ok')]))
    await generateClaudeAgentSdk(baseArgs, queryImpl)
    const options = queryImpl.mock.calls[0][0].options as Options
    expect(options.tools).toEqual([])
    expect(options.settingSources).toEqual([])
    expect(options.mcpServers).toBeUndefined()
    expect(options.model).toBe('claude-sonnet-4-6')
    expect(options.systemPrompt).toBe(baseArgs.systemPrompt)
  })

  it('throws when the Agent SDK reports a non-success result', async () => {
    const queryImpl = vi.fn(fakeQuery([resultError('error_during_execution', ['boom'])]))
    await expect(generateClaudeAgentSdk(baseArgs, queryImpl)).rejects.toThrow(/boom/)
  })

  it('throws when the model returns only whitespace', async () => {
    const queryImpl = vi.fn(fakeQuery([resultSuccess('   ')]))
    await expect(generateClaudeAgentSdk(baseArgs, queryImpl)).rejects.toThrow(AiError)
  })
})

const commercialTools: ToolDefinition[] = [
  {
    name: 'check_commercial_availability',
    description: 'Lista horários livres',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'book_commercial_meeting',
    description: 'Marca a reunião',
    parameters: {
      type: 'object',
      properties: {
        starts_at: { type: 'string', format: 'date-time' },
        lead_email: { type: 'string' },
      },
      required: ['starts_at', 'lead_email'],
      additionalProperties: false,
    },
  },
]

function toolLoopArgs(overrides: Partial<Parameters<typeof runClaudeAgentSdkToolLoop>[0]> = {}) {
  return {
    ...baseArgs,
    tools: commercialTools,
    executor: (async () => ({ content: 'ok', isError: false })) as ToolExecutor,
    ...overrides,
  }
}

describe('runClaudeAgentSdkToolLoop', () => {
  it('fails fast when CLAUDE_CODE_OAUTH_TOKEN is missing, without calling query()', async () => {
    delete process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV]
    const queryImpl = vi.fn() as unknown as QueryFn
    await expect(runClaudeAgentSdkToolLoop(toolLoopArgs(), queryImpl)).rejects.toThrow(AiError)
    expect(queryImpl).not.toHaveBeenCalled()
  })

  it('returns the final answer, iterations, and usage on success', async () => {
    const queryImpl = vi.fn(
      fakeQuery([resultSuccess('Tenho as 09:00 e as 10:00 livres.', { num_turns: 2 })]),
    )
    const result = await runClaudeAgentSdkToolLoop(toolLoopArgs(), queryImpl)
    expect(result.text).toBe('Tenho as 09:00 e as 10:00 livres.')
    expect(result.iterations).toBe(2)
    expect(result.hitIterationLimit).toBe(false)
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 })
  })

  it('reports hitIterationLimit when the SDK stops on error_max_turns', async () => {
    const queryImpl = vi.fn(fakeQuery([resultError('error_max_turns', ['too many turns'], 6)]))
    const result = await runClaudeAgentSdkToolLoop(toolLoopArgs({ maxIterations: 6 }), queryImpl)
    expect(result.hitIterationLimit).toBe(true)
    expect(result.iterations).toBe(6)
  })

  // ── SECURITY (non-negotiable — see this file's header) ──────────────
  // The commercial persona talks to strangers who clicked a Meta ad. It
  // must NEVER see a built-in tool (Bash/Read/Write/WebFetch/Task/...),
  // only the two business tools it was explicitly handed.
  it('disables every built-in tool and exposes ONLY the given business tools', async () => {
    const queryImpl = vi.fn(fakeQuery([resultSuccess('ok')]))
    await runClaudeAgentSdkToolLoop(toolLoopArgs(), queryImpl)
    const options = queryImpl.mock.calls[0][0].options as Options

    // No built-in tools at all — this is the root of the guarantee.
    expect(options.tools).toEqual([])
    // No filesystem CLAUDE.md/settings/skills can inject extra tools
    // or instructions into a customer-facing conversation.
    expect(options.settingSources).toEqual([])

    // Only the two commercial MCP tools are auto-allowed — nothing
    // resembling a system tool name.
    expect(options.allowedTools).toEqual([
      `mcp__${ETER_TOOLS_MCP_SERVER_NAME}__check_commercial_availability`,
      `mcp__${ETER_TOOLS_MCP_SERVER_NAME}__book_commercial_meeting`,
    ])
    for (const name of options.allowedTools ?? []) {
      expect(name).not.toMatch(/Bash|^Read$|^Write$|WebFetch|^Task$|^Skill$/)
    }

    // The MCP server is registered under the expected namespace, and
    // is the only server present (no accidental extra connectors).
    expect(Object.keys(options.mcpServers ?? {})).toEqual([ETER_TOOLS_MCP_SERVER_NAME])
  })

  it('caps maxTurns from maxIterations', async () => {
    const queryImpl = vi.fn(fakeQuery([resultSuccess('ok')]))
    await runClaudeAgentSdkToolLoop(toolLoopArgs({ maxIterations: 3 }), queryImpl)
    const options = queryImpl.mock.calls[0][0].options as Options
    expect(options.maxTurns).toBe(3)
  })
})

describe('buildEterToolDefinitions (executor wiring)', () => {
  it('invokes the executor with the tool name + input and maps a success result', async () => {
    const executor = vi.fn(async () => ({
      content: JSON.stringify({ slots: ['09:00'] }),
      isError: false,
    })) as ToolExecutor

    const [checkAvailability] = buildEterToolDefinitions(
      [commercialTools[0]],
      executor,
      5_000,
    )
    const result = await checkAvailability.handler({}, undefined)

    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'check_commercial_availability', input: {} }),
    )
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ slots: ['09:00'] }) }],
      isError: false,
    })
  })

  it('maps an executor error result to an MCP isError result instead of throwing', async () => {
    const executor = vi.fn(async () => ({
      content: 'Essa hora deixou de estar livre.',
      isError: true,
    })) as ToolExecutor

    const [, bookMeeting] = buildEterToolDefinitions(commercialTools, executor, 5_000)
    const result = await bookMeeting.handler(
      { starts_at: '2026-09-22T10:00:00+01:00', lead_email: 'lead@example.com' },
      undefined,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: 'Essa hora deixou de estar livre.' },
    ])
  })

  it('never lets a throwing executor crash the tool call (executeToolCallWithTimeout safety net)', async () => {
    const executor = (async () => {
      throw new Error('kaboom')
    }) as ToolExecutor

    const [checkAvailability] = buildEterToolDefinitions([commercialTools[0]], executor, 5_000)
    const result = await checkAvailability.handler({}, undefined)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('kaboom') },
    ])
  })
})

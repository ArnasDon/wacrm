import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_TOOLS } from '@/lib/ai/tool-permissions'
import { agentFlowAccountState, buildAgentFlowGraph } from './agent-flow-panel'

describe('agentFlowAccountState', () => {
  it('waits only while the profile is still loading', () => {
    expect(agentFlowAccountState(null, true)).toBe('loading')
  })

  it('uses the account id without requiring the account summary object', () => {
    expect(agentFlowAccountState('account-1', false)).toBe('ready')
  })

  it('stops loading when the profile settled without an account id', () => {
    expect(agentFlowAccountState(null, false)).toBe('unavailable')
  })
})

describe('buildAgentFlowGraph', () => {
  it('shows every known tool, wires the pipeline through the active ones only', () => {
    const graph = buildAgentFlowGraph({
      config: {
        configured: true,
        provider: 'openai',
        model: 'gpt-test',
        buffer_window_seconds: 12,
        max_reply_chunks: 3,
        context_message_limit: 20,
      },
      agentId: 'agent-1',
      tools: {
        ...DEFAULT_AGENT_TOOLS,
        search_catalog: false,
        send_product: false,
        add_tag: true,
      },
      counts: { add_tag: 4, handoff_human: 2 },
    })

    // All 6 tools always render as nodes — disabled ones stay visible
    // (dimmed, toolEnabled: false) so they can be turned on from the canvas.
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'whatsapp',
      'buffer',
      'agent',
      'tool:search_catalog',
      'tool:send_product',
      'tool:search_knowledge',
      'tool:add_tag',
      'tool:create_deal',
      'tool:handoff_human',
      'response',
    ])
    // Only enabled tools are wired into the actual pipeline.
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'whatsapp', target: 'buffer' }),
        expect.objectContaining({ source: 'buffer', target: 'agent' }),
        expect.objectContaining({ source: 'agent', target: 'tool:add_tag' }),
        expect.objectContaining({ source: 'tool:add_tag', target: 'response' }),
      ]),
    )
    expect(graph.edges).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 'tool:search_catalog' })]),
    )
    expect(
      graph.nodes.find((node) => node.id === 'tool:add_tag')?.data,
    ).toMatchObject({ count: 4, toolEnabled: true })
    expect(
      graph.nodes.find((node) => node.id === 'tool:search_catalog')?.data,
    ).toMatchObject({ toolEnabled: false, detail: 'Desligada' })
  })

  it('marks a tool live only when its most recent call is within the last 5 minutes', () => {
    const now = Date.now()
    const graph = buildAgentFlowGraph({
      config: { configured: true },
      agentId: 'agent-1',
      tools: { ...DEFAULT_AGENT_TOOLS },
      counts: { handoff_human: 2, add_tag: 1 },
      recentByTool: {
        handoff_human: [
          { tool_key: 'handoff_human', called_at: new Date(now - 60_000).toISOString(), succeeded: true },
        ],
        add_tag: [
          { tool_key: 'add_tag', called_at: new Date(now - 30 * 60_000).toISOString(), succeeded: false },
        ],
      },
    })

    expect(graph.nodes.find((node) => node.id === 'tool:handoff_human')?.data).toMatchObject({
      live: true,
    })
    expect(graph.nodes.find((node) => node.id === 'tool:add_tag')?.data).toMatchObject({
      live: false,
    })
  })

  it('connects the agent directly to the response when every tool is off', () => {
    const graph = buildAgentFlowGraph({
      config: { configured: true },
      agentId: 'agent-1',
      tools: Object.fromEntries(
        Object.keys(DEFAULT_AGENT_TOOLS).map((key) => [key, false]),
      ) as typeof DEFAULT_AGENT_TOOLS,
      counts: {},
    })
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-response',
          source: 'agent',
          target: 'response',
        }),
      ]),
    )
  })
})

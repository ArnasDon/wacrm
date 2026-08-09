import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_TOOLS } from '@/lib/ai/tool-permissions'
import { buildAgentFlowGraph } from './agent-flow-panel'

describe('buildAgentFlowGraph', () => {
  it('connects WhatsApp, buffer, agent, active tools and response', () => {
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

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'whatsapp',
      'buffer',
      'agent',
      'tool:search_knowledge',
      'tool:add_tag',
      'tool:handoff_human',
      'response',
    ])
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'whatsapp', target: 'buffer' }),
        expect.objectContaining({ source: 'buffer', target: 'agent' }),
        expect.objectContaining({ source: 'agent', target: 'tool:add_tag' }),
        expect.objectContaining({ source: 'tool:add_tag', target: 'response' }),
      ]),
    )
    expect(
      graph.nodes.find((node) => node.id === 'tool:add_tag')?.data,
    ).toMatchObject({ count: 4 })
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

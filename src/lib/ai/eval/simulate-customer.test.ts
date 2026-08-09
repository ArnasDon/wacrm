import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from '../commercial-strategy'
import type { AiConfig } from '../types'
import { simulateCustomerConversation } from './simulate-customer'

const config: AiConfig = {
  provider: 'openai',
  model: 'test-model',
  apiKey: 'test-key',
  systemPrompt: null,
  commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  bufferWindowSeconds: 12,
  maxReplyChunks: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
}

describe('customer simulation', () => {
  it('runs a multi-turn customer, agent and final evaluator loop', async () => {
    let customerTurn = 0
    const generate = vi.fn(async ({ systemPrompt }: { systemPrompt: string }) => {
      if (systemPrompt.includes('Role-play one realistic')) {
        customerTurn += 1
        return {
          text: customerTurn === 1 ? 'Bom dia, preciso de ajuda.' : '[DONE]',
          handoff: false,
          usage: null,
        }
      }
      if (systemPrompt.includes('Evaluate the full simulated')) {
        return {
          text: '{"completed_goal":true,"issues":[]}',
          handoff: false,
          usage: null,
        }
      }
      return { text: 'Como posso ajudar?', handoff: false, usage: null }
    })

    const result = await simulateCustomerConversation(
      config,
      {
        id: 'persona-1',
        description: 'Cliente breve',
        goal: 'Obter ajuda',
        maxTurns: 3,
      },
      { generate },
    )

    expect(result.completedGoal).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.transcript).toEqual([
      { role: 'user', content: 'Bom dia, preciso de ajuda.' },
      { role: 'assistant', content: 'Como posso ajudar?' },
    ])
  })
})

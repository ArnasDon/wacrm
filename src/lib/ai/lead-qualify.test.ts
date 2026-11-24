import { describe, expect, it, vi } from 'vitest'
import { qualifyLead } from './lead-qualify'
import * as configModule from './config'
import * as contextModule from './context'
import * as generateModule from './generate'
import * as adminClientModule from './admin-client'

describe('qualifyLead', () => {
  it('returns null if AI config is missing', async () => {
    vi.spyOn(configModule, 'loadAiConfig').mockResolvedValue(null)
    const result = await qualifyLead({
      accountId: 'acc-1',
      conversationId: 'conv-1',
    })
    expect(result).toBeNull()
  })

  it('qualifies a hot lead correctly', async () => {
    vi.spyOn(configModule, 'loadAiConfig').mockResolvedValue({
      provider: 'google',
      model: 'gemini-2.5-flash',
      baseUrl: null,
      apiKey: 'test-key',
      systemPrompt: null,
      isActive: true,
      autoReplyEnabled: false,
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
      embeddingsApiKey: null,
    })

    vi.spyOn(contextModule, 'buildConversationContext').mockResolvedValue([
      { role: 'user', content: 'Hi, I want to purchase the premium plan today. Send invoice.' },
    ])

    vi.spyOn(generateModule, 'generateReply').mockResolvedValue({
      text: 'hot',
      handoff: false,
      usage: { promptTokens: 50, completionTokens: 1, totalTokens: 51 },
    })

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const mockDb = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    }
    vi.spyOn(adminClientModule, 'supabaseAdmin').mockReturnValue(mockDb as unknown as ReturnType<typeof adminClientModule.supabaseAdmin>)

    const result = await qualifyLead({
      accountId: 'acc-1',
      conversationId: 'conv-1',
    })

    expect(result).toBe('hot')
    expect(mockUpdate).toHaveBeenCalledWith({ lead_score: 'hot' })
  })

  it('qualifies warm and cold leads accurately', async () => {
    vi.spyOn(configModule, 'loadAiConfig').mockResolvedValue({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      baseUrl: null,
      apiKey: 'test-key',
      systemPrompt: null,
      isActive: true,
      autoReplyEnabled: false,
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
      embeddingsApiKey: null,
    })

    vi.spyOn(contextModule, 'buildConversationContext').mockResolvedValue([
      { role: 'user', content: 'What features do you have?' },
    ])

    vi.spyOn(generateModule, 'generateReply').mockResolvedValue({
      text: 'WARM',
      handoff: false,
      usage: null,
    })

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const mockDb = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    }
    vi.spyOn(adminClientModule, 'supabaseAdmin').mockReturnValue(mockDb as unknown as ReturnType<typeof adminClientModule.supabaseAdmin>)

    const result = await qualifyLead({
      accountId: 'acc-1',
      conversationId: 'conv-1',
    })

    expect(result).toBe('warm')
  })
})

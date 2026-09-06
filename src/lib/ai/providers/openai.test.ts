import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOpenAi } from './openai'
import type { ChatMessage } from '../types'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const baseArgs = {
  apiKey: 'sk-test',
  systemPrompt: 'be helpful',
  timeoutMs: 5000,
}
const okBody = { choices: [{ message: { content: 'ok' } }] }

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

function sentBody() {
  return JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
}

describe('generateOpenAi — inbound photos', () => {
  it('a plain turn stays content:string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(okBody))
    await generateOpenAi({ ...baseArgs, model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
    expect(sentBody().messages).toEqual([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('on a vision model, a turn with images becomes text + image_url parts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(okBody))
    const messages: ChatMessage[] = [
      { role: 'user', content: 'this one?', images: [{ mimeType: 'image/jpeg', dataBase64: 'AAAA' }] },
    ]
    await generateOpenAi({ ...baseArgs, model: 'gpt-4o-mini', messages })
    expect(sentBody().messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'this one?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    })
  })

  it('on a non-vision model, images are dropped and the text still goes through', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(okBody))
    const messages: ChatMessage[] = [
      { role: 'user', content: 'this one?', images: [{ mimeType: 'image/jpeg', dataBase64: 'AAAA' }] },
    ]
    await generateOpenAi({ ...baseArgs, model: 'gpt-3.5-turbo', messages })
    expect(sentBody().messages[1]).toEqual({ role: 'user', content: 'this one?' })
  })
})

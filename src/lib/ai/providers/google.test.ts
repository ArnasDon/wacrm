import { describe, expect, it, vi, afterEach } from 'vitest'
import { generateGoogle } from './google'

describe('generateGoogle', () => {
  const origFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it('formats request payload for Gemini and parses reply with usage', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url
      capturedBody = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello from Gemini!' }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 6,
            totalTokenCount: 21,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const result = await generateGoogle({
      apiKey: 'test-google-key',
      model: 'gemini-2.5-flash',
      systemPrompt: 'Be a helpful assistant',
      messages: [
        { role: 'user', content: 'Hi there' },
        { role: 'assistant', content: 'How can I help?' },
        { role: 'user', content: 'What is the price?' },
      ],
      timeoutMs: 5000,
    })

    expect(capturedUrl).toContain('models/gemini-2.5-flash:generateContent?key=test-google-key')
    expect(capturedBody.system_instruction).toEqual({
      parts: [{ text: 'Be a helpful assistant' }],
    })
    expect(result.text).toBe('Hello from Gemini!')
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 6,
      totalTokens: 21,
    })
  })

  it('prepends user turn if context starts with assistant', async () => {
    let capturedBody: { contents?: { role: string }[] } = {}

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
        { status: 200 },
      )
    })

    await generateGoogle({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      systemPrompt: '',
      messages: [{ role: 'assistant', content: 'Welcome' }],
      timeoutMs: 5000,
    })

    expect(capturedBody.contents?.[0].role).toBe('user')
    expect(capturedBody.contents?.[1].role).toBe('model')
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAnthropic } from './anthropic'
import type { ChatMessage } from '../types'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const baseArgs = {
  apiKey: 'sk-ant-test',
  model: 'claude-test',
  systemPrompt: 'be helpful',
  timeoutMs: 5000,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('normalizeForAnthropic (via generateAnthropic)', () => {
  it('strips a leading assistant turn (greeting before the customer spoke)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
      { role: 'user', content: 'Quiero información' },
    ]
    await generateAnthropic({ ...baseArgs, messages })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'Quiero información' }])
  })

  it('strips a trailing assistant turn — the exact shape a racing debounced dispatch produces (2026-09-03/04 incident)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    // buildConversationContext just returns the newest messages in
    // order; a second dispatch for the same burst can read this AFTER
    // an earlier dispatch already inserted its own reply.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Se dedica a dar créditos' },
      { role: 'assistant', content: '¡Buenos días! Contame más...' },
    ]
    await generateAnthropic({ ...baseArgs, messages })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'Se dedica a dar créditos' }])
    // Never send Anthropic a transcript ending on assistant — it 400s
    // outright ("must end with a user message"), not transiently.
    expect(body.messages[body.messages.length - 1].role).toBe('user')
  })

  it('falls back to a placeholder user turn when everything was assistant', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'Hola' }]
    await generateAnthropic({ ...baseArgs, messages })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([
      { role: 'user', content: '(The customer has not sent a message yet.)' },
    ])
  })

  it('merges consecutive same-role turns before trimming', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Primero' },
      { role: 'assistant', content: 'Segundo' },
    ]
    await generateAnthropic({ ...baseArgs, messages })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    // Both trailing assistant turns collapse to one, then that one is
    // stripped entirely — never sent as two separate assistant turns.
    expect(body.messages).toEqual([{ role: 'user', content: 'Hola' }])
  })
})

describe('generateAnthropic — inbound photos', () => {
  it('a plain turn stays content:string (byte-identical to before)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    await generateAnthropic({ ...baseArgs, messages: [{ role: 'user', content: 'hola' }] })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'hola' }])
  })

  it('a turn with images becomes a text block + one image block per photo', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: '¿tienen este?',
        images: [
          { mimeType: 'image/jpeg', dataBase64: 'AAAA' },
          { mimeType: 'image/png', dataBase64: 'BBBB' },
        ],
      },
    ]
    await generateAnthropic({ ...baseArgs, messages })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '¿tienen este?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
        ],
      },
    ])
  })

  it('merges photos from consecutive customer turns onto one message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const messages: ChatMessage[] = [
      { role: 'user', content: 'foto 1', images: [{ mimeType: 'image/jpeg', dataBase64: 'A' }] },
      { role: 'user', content: 'foto 2', images: [{ mimeType: 'image/jpeg', dataBase64: 'B' }] },
    ]
    await generateAnthropic({ ...baseArgs, messages })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'foto 1\n\nfoto 2' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'A' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'B' } },
    ])
  })
})

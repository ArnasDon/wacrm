import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendZernioText } from './api'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const args = { apiKey: 'key', conversationId: 'conv-1', accountId: 'acct-1', text: 'hi' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('zernioFetch (via sendZernioText)', () => {
  it('resolves normally on a successful call, passing an abort signal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: { messageId: 'zmsg-1' } }))
    const result = await sendZernioText(args)
    expect(result).toEqual({ messageId: 'zmsg-1' })
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a timeout abort into a clear, non-generic error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('The operation was aborted.', 'TimeoutError'))
    await expect(sendZernioText(args)).rejects.toThrow('Zernio API request timed out.')
  })

  it('turns any other fetch failure into a clear "could not reach" error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(sendZernioText(args)).rejects.toThrow('Could not reach the Zernio API: fetch failed')
  })

  it('still surfaces Zernio\'s own error message on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Conversation not found' }),
    } as unknown as Response)
    await expect(sendZernioText(args)).rejects.toThrow('Conversation not found')
  })
})

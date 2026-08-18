import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendTextMessage } from './meta-api'

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

const args = { phoneNumberId: 'phone-1', accessToken: 'token', to: '15550001234', text: 'hi' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('metaFetch (via sendTextMessage)', () => {
  it('resolves normally on a successful call, passing an abort signal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ messages: [{ id: 'wamid.1' }] }))
    const result = await sendTextMessage(args)
    expect(result).toEqual({ messageId: 'wamid.1' })
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a timeout abort into a clear, non-generic error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('The operation was aborted.', 'TimeoutError'))
    await expect(sendTextMessage(args)).rejects.toThrow('Meta API request timed out.')
  })

  it('turns any other fetch failure into a clear "could not reach" error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(sendTextMessage(args)).rejects.toThrow('Could not reach the Meta API: fetch failed')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribeAudio } from './transcription'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

const audio = Buffer.from('fake-ogg-bytes')

describe('transcribeAudio', () => {
  it('returns trimmed transcript text and sends the API key', async () => {
    const fetchMock = vi.fn(
      async (url: string, opts: { headers: Record<string, string> }) => {
        expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
        expect(opts.headers.Authorization).toBe('Bearer sk-x')
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: '  ola, preciso de ajuda  ' }),
        } as unknown as Response
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeAudio({
      apiKey: 'sk-x',
      audio,
      mimeType: 'audio/ogg; codecs=opus',
    })

    expect(text).toBe('ola, preciso de ajuda')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null instead of throwing on a provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 401,
            text: async () => 'invalid key',
          }) as unknown as Response,
      ),
    )

    await expect(
      transcribeAudio({ apiKey: 'bad', audio, mimeType: 'audio/ogg' }),
    ).resolves.toBeNull()
  })

  it('returns null instead of throwing on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed')
      }),
    )

    await expect(
      transcribeAudio({ apiKey: 'sk-x', audio, mimeType: 'audio/ogg' }),
    ).resolves.toBeNull()
  })

  it('returns null when the provider returns an empty transcript', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ text: '   ' }),
          }) as unknown as Response,
      ),
    )

    await expect(
      transcribeAudio({ apiKey: 'sk-x', audio, mimeType: 'audio/ogg' }),
    ).resolves.toBeNull()
  })
})

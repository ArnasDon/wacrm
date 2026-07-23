import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError } from '../types'
import { generateOpenAiEmbedding } from './embeddings'

describe('generateOpenAiEmbedding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls OpenAI embeddings and returns the vector', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }),
    )

    await expect(
      generateOpenAiEmbedding({ apiKey: 'sk-test', model: 'text-embedding-3-small', input: 'hello' }),
    ).resolves.toEqual([0.1, 0.2, 0.3])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer sk-test' }),
      }),
    )
  })

  it('throws AiError for provider failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 401 }))

    await expect(
      generateOpenAiEmbedding({ apiKey: 'bad', model: 'text-embedding-3-small', input: 'hello' }),
    ).rejects.toMatchObject({ code: 'embedding_provider_error' } satisfies Partial<AiError>)
  })
})

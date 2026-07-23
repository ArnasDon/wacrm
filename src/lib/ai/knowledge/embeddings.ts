import { AiError } from '../types'

const DEFAULT_TIMEOUT_MS = 30_000

export async function generateOpenAiEmbedding(args: {
  apiKey: string
  model: string
  input: string
  timeoutMs?: number
}): Promise<number[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({ model: args.model, input: args.input }),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AiError('Embedding request timed out.', { code: 'embedding_timeout', status: 504 })
    }
    throw new AiError('Could not reach the embeddings provider.', {
      code: 'embedding_provider_unreachable',
      status: 502,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AiError(`Embedding request failed (${res.status}): ${body.slice(0, 300)}`, {
      code: 'embedding_provider_error',
      status: 502,
    })
  }

  let json: { data?: { embedding?: unknown }[] }
  try {
    json = (await res.json()) as { data?: { embedding?: unknown }[] }
  } catch {
    throw new AiError('Embedding provider returned an invalid response.', {
      code: 'embedding_invalid_response',
      status: 502,
    })
  }

  const embedding = json.data?.[0]?.embedding
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    !embedding.every((value) => typeof value === 'number')
  ) {
    throw new AiError('Embedding provider returned an invalid vector.', {
      code: 'embedding_invalid_response',
      status: 502,
    })
  }

  return embedding
}

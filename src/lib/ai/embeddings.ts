import { AiError } from './types';
import { aiRequestTimeoutMs } from './defaults';
import { providerHttpError, toNetworkError } from './providers/shared';

// ============================================================
// Embeddings (OpenAI-compatible).
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval. Anthropic has
// no embeddings endpoint, so this is always OpenAI's — the account
// supplies a (possibly separate) embeddings key. 1536-dim
// text-embedding-3-small matches the `vector(1536)` column in
// migration 030.
// ============================================================

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96;

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[];
}

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Embed a list of strings, preserving input order. Batched; throws
 * `AiError` on provider/network failure so callers can decide whether
 * to degrade (retrieval) or surface (ingest).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[]
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const timeoutMs = aiRequestTimeoutMs();
  const out: number[][] = [];

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE);

    let res: Response;
    try {
      res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw toNetworkError(err);
    }

    if (!res.ok) {
      throw await providerHttpError('OpenAI embeddings', res);
    }

    const data = (await res
      .json()
      .catch(() => null)) as EmbeddingResponse | null;
    const rows = data?.data;
    if (!rows || rows.length !== batch.length) {
      throw new AiError('Embeddings response was malformed.', {
        code: 'embeddings_malformed',
      });
    }

    // Sort by index so order matches the input batch regardless of how
    // the provider returns them. Require a real numeric index — defaulting
    // a missing one to 0 would silently misalign chunks with their
    // vectors (chunk N gets chunk M's embedding), so fail loud instead.
    if (rows.some((r) => typeof r.index !== 'number')) {
      throw new AiError('Embeddings response was missing result indices.', {
        code: 'embeddings_malformed',
      });
    }
    const ordered = [...rows].sort((a, b) => a.index! - b.index!);
    for (const r of ordered) {
      if (!Array.isArray(r.embedding)) {
        throw new AiError('Embeddings response missing a vector.', {
          code: 'embeddings_malformed',
        });
      }
      out.push(r.embedding);
    }
  }

  return out;
}

import type { AiRouteContext } from './local-route';
import { loadEmbeddingsKey } from './config';
import { ingestDocument } from './knowledge';
/** The document is already saved. An unavailable embedding provider retains keyword search. */
export async function indexDocument(
  ctx: AiRouteContext,
  id: string,
  content: string
) {
  const { key, corrupt } = await loadEmbeddingsKey(ctx.db, ctx.accountId);
  try {
    await ingestDocument(
      ctx.run,
      ctx.accountId,
      { embeddingsApiKey: key },
      id,
      content
    );
  } catch {
    return {
      success: true,
      id,
      warning: 'Saved, but indexing was incomplete. Use Reindex to retry.',
    };
  }
  return {
    success: true,
    id,
    ...(corrupt
      ? {
          warning:
            'Saved with keyword search only. Re-enter your embeddings key to enable semantic search.',
        }
      : {}),
  };
}

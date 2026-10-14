import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
import { indexDocument } from '@/lib/ai/index-document';
import { loadEmbeddingsKey } from '@/lib/ai/config';
import { ingestDocument } from '@/lib/ai/knowledge';
export function POST(request: Request) {
  return aiRoute(request, 'admin', async (ctx) => {
    const { key, corrupt } = await loadEmbeddingsKey(ctx.db, ctx.accountId);
    if (corrupt)
      return {
        success: false,
        reindexed: 0,
        error: 'Re-enter your embeddings key first. Nothing was reindexed.',
      };
    const docs = await new AiStore(ctx.db, ctx.accountId).documents();
    let reindexed = 0;
    for (const doc of docs) {
      try {
        await ingestDocument(
          ctx.run,
          ctx.accountId,
          { embeddingsApiKey: key },
          doc.id,
          doc.content
        );
        reindexed++;
      } catch {
        return {
          success: false,
          reindexed,
          total: docs.length,
          error: 'Indexing failed. Retry Reindex.',
        };
      }
    }
    return { success: true, reindexed };
  });
}

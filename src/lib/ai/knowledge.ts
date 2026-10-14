import type { SqlConnection } from '@/lib/db/transaction';
import { AiStore } from '@/lib/db/ai-store';
import type { AiConfig } from './types';
import { chunkText } from './chunk';
import { embedTexts } from './embeddings';
export type AiSqlRunner = <T>(
  work: (db: SqlConnection) => Promise<T>
) => Promise<T>;
/** Embed outside the transaction, then atomically replace the unchanged document's index. */
export async function ingestDocument(
  run: AiSqlRunner,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string
): Promise<void> {
  const chunks = chunkText(content);
  let embeddings: number[][] | null = null;
  let embedError: unknown = null;
  if (config.embeddingsApiKey && chunks.length) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks);
    } catch (error) {
      embedError = error;
    }
  }
  await run((db) =>
    new AiStore(db, accountId).replaceChunks(
      documentId,
      content,
      chunks.map((content, i) => ({
        content,
        embedding: embeddings?.[i] ?? null,
      }))
    )
  );
  if (embedError) throw embedError;
}
export async function retrieveKnowledge(
  db: SqlConnection,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 5
): Promise<string[]> {
  const query = queryText.trim();
  k = Math.min(20, Math.floor(k));
  if (!query || k <= 0) return [];
  const store = new AiStore(db, accountId);
  try {
    if (!(await store.hasChunks())) return [];
  } catch {
    return [];
  }
  const picked = new Map<string, string>();
  if (config.embeddingsApiKey) {
    try {
      const [vector] = await embedTexts(config.embeddingsApiKey, [query]);
      if (vector)
        for (const row of await store.semantic(vector, k))
          picked.set(row.id, row.content);
    } catch {
      console.error(
        '[ai knowledge] semantic retrieval failed; using keyword search.'
      );
    }
  }
  if (picked.size < k) {
    try {
      for (const row of await store.lexical(query, k)) {
        if (picked.size >= k) break;
        if (!picked.has(row.id)) picked.set(row.id, row.content);
      }
    } catch {
      console.error('[ai knowledge] keyword retrieval failed.');
    }
  }
  return [...picked.values()].slice(0, k);
}

import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'
import { retrieveNovyraKnowledge } from './novyra-knowledge'
import { isNovyraEnabledForAgent } from './knowledge-sources'

interface MatchRow {
  id: string
  content: string
}

export async function ingestDocument(
  db: WacrmSupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<void> {
  const chunks = chunkText(content)
  const { error: delErr } = await db
    .from('ai_knowledge_chunks')
    .delete()
    .eq('document_id', documentId)
  if (delErr) throw delErr
  if (chunks.length === 0) return

  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    account_id: accountId,
    chunk_index: i,
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }))
  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
  if (insErr) throw insErr
  if (embedError) throw embedError
}

export async function retrieveKnowledge(
  db: WacrmSupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'agentId' | 'embeddingsApiKey'>,
  queryText: string,
  k = 5,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  let externalKnowledge: string[] = []
  try {
    const enabled = await isNovyraEnabledForAgent(db, accountId, config.agentId)
    if (enabled) externalKnowledge = await retrieveNovyraKnowledge(query, k)
  } catch (error) {
    // External knowledge is deliberately fail-safe: local instructions and
    // the account knowledge base must continue to work if NOVYRA is down.
    console.error('[ai knowledge] NOVYRA policy/retrieval failed; continuing:', error)
  }

  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return externalKnowledge.slice(0, k)
  } catch {
    return externalKnowledge.slice(0, k)
  }

  const picked = new Map<string, string>()
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  return [...externalKnowledge, ...Array.from(picked.values())].slice(0, k)
}

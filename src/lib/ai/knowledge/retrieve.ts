import type { SupabaseClient } from '@supabase/supabase-js'
import { generateOpenAiEmbedding } from './embeddings'

export interface RetrievedKnowledge {
  chunkId: string
  documentId: string
  content: string
  score: number
  mode: 'fts' | 'semantic'
}

export async function retrieveKnowledge(
  supabase: SupabaseClient,
  args: {
    accountId: string
    query: string
    matchCount?: number
    embedding?: { apiKey: string; model: string } | null
  },
): Promise<RetrievedKnowledge[]> {
  const query = args.query.trim()
  if (!query) return []

  const matchCount = args.matchCount ?? 6
  const { data: ftsRows, error: ftsError } = await supabase.rpc('match_ai_knowledge_fts', {
    p_account_id: args.accountId,
    p_query: query,
    p_match_count: matchCount,
  })

  if (ftsError) throw new Error(`Knowledge FTS retrieval failed: ${ftsError.message}`)

  const results = new Map<string, RetrievedKnowledge>()
  for (const row of (ftsRows ?? []) as { id: string; document_id: string; content: string; rank: number }[]) {
    results.set(row.id, {
      chunkId: row.id,
      documentId: row.document_id,
      content: row.content,
      score: row.rank,
      mode: 'fts',
    })
  }

  if (args.embedding) {
    const embedding = await generateOpenAiEmbedding({
      apiKey: args.embedding.apiKey,
      model: args.embedding.model,
      input: query,
    })
    const { data: semanticRows, error: semanticError } = await supabase.rpc('match_ai_knowledge_semantic', {
      p_account_id: args.accountId,
      p_query_embedding: `[${embedding.join(',')}]`,
      p_match_count: matchCount,
    })

    if (semanticError) throw new Error(`Knowledge semantic retrieval failed: ${semanticError.message}`)

    for (const row of (semanticRows ?? []) as {
      id: string
      document_id: string
      content: string
      distance: number
    }[]) {
      const score = 1 - row.distance
      const existing = results.get(row.id)
      if (!existing || score > existing.score) {
        results.set(row.id, {
          chunkId: row.id,
          documentId: row.document_id,
          content: row.content,
          score,
          mode: 'semantic',
        })
      }
    }
  }

  return [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, matchCount)
}

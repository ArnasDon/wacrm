import type { SupabaseClient } from '@supabase/supabase-js'
import { chunkKnowledgeText } from './chunk'
import { generateOpenAiEmbedding } from './embeddings'

export interface IngestKnowledgeDocumentArgs {
  accountId: string
  userId: string
  documentId?: string
  title: string
  content: string
  sourceType?: 'manual' | 'url' | 'file' | 'api'
  sourceUri?: string | null
  metadata?: Record<string, unknown>
  embedding?: { apiKey: string; model: string } | null
}

export async function ingestKnowledgeDocument(
  supabase: SupabaseClient,
  args: IngestKnowledgeDocumentArgs,
): Promise<{ documentId: string; chunkCount: number; embeddedCount: number }> {
  const title = args.title.trim()
  const content = args.content.trim()
  if (!title) throw new Error('title is required')
  if (!content) throw new Error('content is required')

  const { data: document, error: documentError } = await supabase
    .from('ai_knowledge_documents')
    .upsert({
      ...(args.documentId ? { id: args.documentId } : {}),
      account_id: args.accountId,
      created_by: args.userId,
      title,
      content,
      source_type: args.sourceType ?? 'manual',
      source_uri: args.sourceUri ?? null,
      metadata: args.metadata ?? {},
    })
    .select('id')
    .single()

  if (documentError) throw new Error(`Failed to save knowledge document: ${documentError.message}`)

  const documentId = (document as { id: string }).id
  const { error: deleteError } = await supabase
    .from('ai_knowledge_chunks')
    .delete()
    .eq('account_id', args.accountId)
    .eq('document_id', documentId)

  if (deleteError) throw new Error(`Failed to replace knowledge chunks: ${deleteError.message}`)

  const chunks = chunkKnowledgeText(content)
  let embeddedCount = 0
  const rows: {
    account_id: string
    document_id: string
    chunk_index: number
    content: string
    token_estimate: number
    embedding: string | null
  }[] = []

  for (const chunk of chunks) {
    let embedding: string | null = null
    if (args.embedding) {
      const vector = await generateOpenAiEmbedding({
        apiKey: args.embedding.apiKey,
        model: args.embedding.model,
        input: chunk.content,
      })
      embedding = `[${vector.join(',')}]`
      embeddedCount += 1
    }

    rows.push({
      account_id: args.accountId,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_estimate: chunk.tokenEstimate,
      embedding,
    })
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('ai_knowledge_chunks').insert(rows)
    if (insertError) throw new Error(`Failed to insert knowledge chunks: ${insertError.message}`)
  }

  return { documentId, chunkCount: chunks.length, embeddedCount }
}

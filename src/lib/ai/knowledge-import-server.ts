import type { SupabaseClient } from '@supabase/supabase-js'

import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import type { ImportDoc } from '@/lib/ai/knowledge-import'

/**
 * Upsert knowledge-base documents by title (case-insensitive) and
 * (re)index them. A failing document never aborts the rest — it is
 * reported in `warnings`. Shared by POST /api/ai/knowledge/import and
 * the workspace bundle import.
 */
export async function upsertKnowledgeDocs(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  docs: ImportDoc[],
): Promise<{ created: number; updated: number; warnings: string[] }> {
  const { data: existing, error: listErr } = await supabase
    .from('ai_knowledge_documents')
    .select('id, title')
    .eq('account_id', accountId)
  if (listErr) throw new Error('Failed to load knowledge base')

  const idByTitle = new Map(
    ((existing ?? []) as Array<{ id: string; title: string }>).map((d) => [
      d.title.trim().toLowerCase(),
      d.id,
    ]),
  )
  const { key: embeddingsApiKey } = await loadEmbeddingsKey(supabase, accountId)

  let created = 0
  let updated = 0
  const warnings: string[] = []

  for (const doc of docs) {
    const existingId = idByTitle.get(doc.title.toLowerCase())
    let id = existingId
    if (existingId) {
      const { error } = await supabase
        .from('ai_knowledge_documents')
        .update({ title: doc.title, content: doc.content })
        .eq('id', existingId)
        .eq('account_id', accountId)
      if (error) {
        warnings.push(`"${doc.title}": could not be updated.`)
        continue
      }
      updated++
    } else {
      const { data, error } = await supabase
        .from('ai_knowledge_documents')
        .insert({
          account_id: accountId,
          created_by: userId,
          title: doc.title,
          content: doc.content,
        })
        .select('id')
        .single()
      if (error || !data) {
        warnings.push(`"${doc.title}": could not be saved.`)
        continue
      }
      id = (data as { id: string }).id
      created++
    }
    try {
      await ingestDocument(supabase, accountId, { embeddingsApiKey }, id as string, doc.content)
    } catch (err) {
      console.error('[ai/knowledge] ingest error:', err)
      warnings.push(`"${doc.title}": saved, but indexing failed (use Reindex).`)
    }
  }
  return { created, updated, warnings }
}

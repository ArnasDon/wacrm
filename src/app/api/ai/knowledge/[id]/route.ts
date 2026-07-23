import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { ingestKnowledgeDocument } from '@/lib/ai/knowledge/ingest'

const MAX_CONTENT_LENGTH = 200_000

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''

    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: `content is too long (max ${MAX_CONTENT_LENGTH} characters)` }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId)
    const embedding =
      config?.knowledgeEnabled && config.embeddingsApiKey && config.embeddingsModel.trim()
        ? { apiKey: config.embeddingsApiKey, model: config.embeddingsModel }
        : null

    const result = await ingestKnowledgeDocument(supabase, {
      accountId,
      userId,
      documentId: id,
      title,
      content,
      sourceType: 'manual',
      metadata: {},
      embedding,
    })

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_knowledge_documents')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

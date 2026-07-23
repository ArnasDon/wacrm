import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ingestKnowledgeDocument } from '@/lib/ai/knowledge/ingest'

const MAX_CONTENT_LENGTH = 200_000

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, source_type, source_uri, metadata, created_at, updated_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''

    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json({ error: `content is too long (max ${MAX_CONTENT_LENGTH} characters)` }, { status: 400 })
    }

    const result = await ingestKnowledgeDocument(supabase, {
      accountId,
      userId,
      title,
      content,
      sourceType: 'manual',
      metadata: {},
      embedding: null,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

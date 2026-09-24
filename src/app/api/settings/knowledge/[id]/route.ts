import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { KnowledgeDoc } from '@/lib/db/types'
import { NotFoundError, readJson } from '@/lib/http/errors'
import { bool, str } from '@/lib/http/validate'
import { MAX_ANSWER, MAX_QUESTION } from '@/lib/sales/knowledge'

type Params = { params: Promise<{ id: string }> }

/** PATCH { question?, answer?, isActive? } — Admin+. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const entries = await scopedCollection<KnowledgeDoc>(ctx, 'knowledge_entries')
    if (!(await entries.findById(id))) throw new NotFoundError('Knowledge entry not found')
    const set: Partial<KnowledgeDoc> = {}
    if ('question' in body) set.question = str(body.question, 'question', { max: MAX_QUESTION })
    if ('answer' in body) set.answer = str(body.answer, 'answer', { max: MAX_ANSWER })
    if ('isActive' in body) set.isActive = bool(body.isActive, 'isActive')
    if (Object.keys(set).length) await entries.updateById(id, { $set: set })
    const fresh = await entries.findById(id)
    if (!fresh) throw new NotFoundError('Knowledge entry not found')
    return NextResponse.json({
      entry: { id: fresh._id, question: fresh.question, answer: fresh.answer, isActive: fresh.isActive },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — Admin+. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const entries = await scopedCollection<KnowledgeDoc>(ctx, 'knowledge_entries')
    const existing = await entries.findById(id)
    if (!existing) throw new NotFoundError('Knowledge entry not found')
    await entries.deleteOne({ _id: id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

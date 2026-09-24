import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAccount } from '@/lib/auth/accounts'
import { getDb } from '@/lib/db/mongo'
import { scopedCollection } from '@/lib/db/scoped'
import type { AccountDoc, KnowledgeDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { bool, str } from '@/lib/http/validate'
import { MAX_ABOUT, MAX_ANSWER, MAX_ENTRIES, MAX_QUESTION } from '@/lib/sales/knowledge'

// ============================================================
// Knowledge base — what the sales rep knows beyond the catalogue:
// turnaround, revisions, opening hours, delivery areas, policies.
// Everything here is read out to customers, so it is plain text the
// merchant wrote; no secrets belong in it.
// ============================================================

/** GET — the description and the quick answers. Any member. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const account = await loadAccount(ctx.accountId)
    if (!account) throw new NotFoundError('Account not found')
    const entries = await scopedCollection<KnowledgeDoc>(ctx, 'knowledge_entries')
    const rows = await entries.find({}).sort({ createdAt: 1 }).toArray()
    return NextResponse.json({
      about: account.knowledgeAbout ?? '',
      entries: rows.map((r) => ({ id: r._id, question: r.question, answer: r.answer, isActive: r.isActive })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST { question, answer, isActive? } — add an entry. Admin+. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const question = str(body.question, 'question', { max: MAX_QUESTION })
    const answer = str(body.answer, 'answer', { max: MAX_ANSWER })
    const entries = await scopedCollection<KnowledgeDoc>(ctx, 'knowledge_entries')
    if ((await entries.countDocuments({})) >= MAX_ENTRIES) {
      throw new ValidationError(`You can save up to ${MAX_ENTRIES} knowledge entries`)
    }
    const created = await entries.insertOne({
      question,
      answer,
      isActive: body.isActive === undefined ? true : bool(body.isActive, 'isActive'),
    })
    return NextResponse.json(
      { entry: { id: created._id, question: created.question, answer: created.answer, isActive: created.isActive } },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PUT { about } — the free-text description of the business. Admin+. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const about = str(body.about, 'about', { max: MAX_ABOUT, optional: true }) ?? ''
    const db = await getDb()
    await db
      .collection<AccountDoc>('accounts')
      .updateOne({ _id: ctx.accountId }, { $set: { knowledgeAbout: about, updatedAt: new Date() } })
    return NextResponse.json({ about })
  } catch (err) {
    return toErrorResponse(err)
  }
}

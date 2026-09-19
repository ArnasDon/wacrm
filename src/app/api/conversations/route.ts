import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { ContactDoc, ConversationDoc } from '@/lib/db/types'

/** GET ?status=open|closed|all&q= — inbox list with contact info. */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? 'all'
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 60)

    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
    const filter = status === 'open' || status === 'closed' ? { status } : {}
    const rows = await conversations.find(filter as object).sort({ lastMessageAt: -1 }).limit(200).toArray()

    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    const byId = new Map(
      (await contacts.find({ _id: { $in: rows.map((r) => r.contactId) } }).toArray()).map((c) => [c._id, c]),
    )
    const list = rows
      .map((c) => ({ ...c, contact: byId.get(c.contactId) ?? null }))
      .filter((c) => {
        if (!q) return true
        const name = c.contact?.name?.toLowerCase() ?? ''
        return name.includes(q) || (c.contact?.phone ?? '').includes(q)
      })
    return NextResponse.json({ conversations: list })
  } catch (err) {
    return toErrorResponse(err)
  }
}

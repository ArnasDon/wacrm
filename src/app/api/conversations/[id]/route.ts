import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { ContactDoc, ConversationDoc, MessageDoc, OrderDoc } from '@/lib/db/types'
import { NotFoundError, readJson } from '@/lib/http/errors'
import { bool, oneOf } from '@/lib/http/validate'

type Params = { params: Promise<{ id: string }> }

/** GET — conversation + contact + last 200 messages + recent orders. Marks it read. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await getCurrentAccount()
    const id = parseId((await params).id)
    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
    const conversation = await conversations.findById(id)
    if (!conversation) throw new NotFoundError('Conversation not found')

    const [contact, messages, orders] = await Promise.all([
      scopedCollection<ContactDoc>(ctx, 'contacts').then((c) => c.findById(conversation.contactId)),
      scopedCollection<MessageDoc>(ctx, 'messages').then((m) =>
        m.find({ conversationId: id }).sort({ createdAt: -1 }).limit(200).toArray(),
      ),
      scopedCollection<OrderDoc>(ctx, 'orders').then((o) =>
        o.find({ contactId: conversation.contactId }).sort({ createdAt: -1 }).limit(10).toArray(),
      ),
    ])
    if (conversation.unreadCount > 0) await conversations.updateById(id, { $set: { unreadCount: 0 } })
    return NextResponse.json({ conversation, contact, messages: messages.reverse(), orders })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH { aiPaused?, status? } — take over from / hand back to the AI; open/close. Agent+. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const set: Partial<ConversationDoc> = {}
    if ('aiPaused' in body) {
      set.aiPaused = bool(body.aiPaused, 'aiPaused')
      set.aiPausedReason = set.aiPaused ? 'Paused by a team member' : null
    }
    if ('status' in body) set.status = oneOf(body.status, 'status', ['open', 'closed'] as const)
    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
    const updated = await conversations.findOneAndUpdate({ _id: id }, { $set: set })
    if (!updated) throw new NotFoundError('Conversation not found')
    return NextResponse.json({ conversation: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

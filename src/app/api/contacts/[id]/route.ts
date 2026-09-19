import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { ContactDoc, ConversationDoc, MessageDoc, OrderDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { optStr, strList } from '@/lib/http/validate'

type Params = { params: Promise<{ id: string }> }

/** PATCH { name?, email?, notes?, tags? } — agent+. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const set: Partial<ContactDoc> = {}
    if ('name' in body) set.name = optStr(body.name, 'name', 120)
    if ('email' in body) {
      const email = optStr(body.email, 'email', 254)?.toLowerCase() ?? null
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('email is not valid')
      set.email = email
    }
    if ('notes' in body) set.notes = optStr(body.notes, 'notes', 2000)
    if ('tags' in body) set.tags = strList(body.tags, 'tags', 20, 40)
    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    const updated = await contacts.findOneAndUpdate({ _id: id }, { $set: set })
    if (!updated) throw new NotFoundError('Contact not found')
    return NextResponse.json({ contact: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE — removes the contact and their conversation + messages
 * (the explicit replacement for Postgres ON DELETE CASCADE). Orders
 * are kept for the books, with the contact link cleared. Admin+.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    const res = await contacts.deleteOne({ _id: id })
    if (res.deletedCount === 0) throw new NotFoundError('Contact not found')
    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
    const messages = await scopedCollection<MessageDoc>(ctx, 'messages')
    await messages.deleteMany({ contactId: id })
    await conversations.deleteMany({ contactId: id })
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    await orders.updateMany({ contactId: id }, { $set: { contactId: null, conversationId: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

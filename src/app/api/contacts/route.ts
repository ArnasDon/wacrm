import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { ContactDoc } from '@/lib/db/types'
import { readJson } from '@/lib/http/errors'
import { optStr, str, strList } from '@/lib/http/validate'
import { getOrCreateConversation, upsertContactByPhone } from '@/lib/whatsapp/store'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** GET ?q= — contacts (sandbox test customers hidden). */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 60)
    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    const filter: Record<string, unknown> = { isSandbox: { $ne: true } }
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i')
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }]
    }
    const rows = await contacts.find(filter).sort({ createdAt: -1 }).limit(500).toArray()
    return NextResponse.json({ contacts: rows })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST { phone, name?, email?, notes?, tags? } — agent+. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = await readJson(request)
    const contact = await upsertContactByPhone(ctx, str(body.phone, 'phone', { max: 30 }), optStr(body.name, 'name', 120))
    const contacts = await scopedCollection<ContactDoc>(ctx, 'contacts')
    const email = optStr(body.email, 'email', 254)
    await contacts.updateById(contact._id, {
      $set: {
        ...(email ? { email: email.toLowerCase() } : {}),
        ...(body.notes !== undefined ? { notes: optStr(body.notes, 'notes', 2000) } : {}),
        ...(body.tags !== undefined ? { tags: strList(body.tags, 'tags', 20, 40) } : {}),
      },
    })
    await getOrCreateConversation(ctx, contact._id)
    return NextResponse.json({ contact: await contacts.findById(contact._id) }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { isId, parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { OrderDoc } from '@/lib/db/types'
import { readJson, ValidationError } from '@/lib/http/errors'
import { num, optStr } from '@/lib/http/validate'
import { createOrder } from '@/lib/sales/orders'
import { getOrCreateConversation, upsertContactByPhone } from '@/lib/whatsapp/store'

const STATUSES = ['draft', 'awaiting_payment', 'paid', 'fulfilled', 'cancelled']

/** GET ?status=&q=&contactId= — orders, newest first. Any member. */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const filter: Record<string, unknown> = {}
    const status = url.searchParams.get('status')
    if (status && STATUSES.includes(status)) filter.status = status
    if (status === 'proof_submitted') filter['payment.status'] = 'proof_submitted'
    const contactId = url.searchParams.get('contactId')
    if (contactId && isId(contactId)) filter.contactId = contactId
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 60)
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      filter.$or = [{ number: rx }, { 'customer.name': rx }, { 'customer.phone': rx }]
    }
    const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
    const rows = await orders.find(filter).sort({ createdAt: -1 }).limit(300).toArray()
    return NextResponse.json({ orders: rows })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST — staff creates an order. Body:
 *   { items: [{productId, quantity}], contactId? | customer: {name, phone, email},
 *     deliveryFee? (major units), discount? (major units), notes?, allowBackorder? }
 * Agent+.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = await readJson(request)
    if (!Array.isArray(body.items)) throw new ValidationError('items must be a list')
    const lines = (body.items as Array<Record<string, unknown>>).map((i, idx) => ({
      productId: parseId(i.productId, `items[${idx}].productId`),
      quantity: num(i.quantity, `items[${idx}].quantity`, { integer: true, min: 1, max: 10_000 }),
    }))

    let contactId: string | null = null
    let conversationId: string | null = null
    const customerIn = (body.customer ?? {}) as Record<string, unknown>
    if (body.contactId) {
      contactId = parseId(body.contactId, 'contactId')
    } else if (customerIn.phone) {
      const contact = await upsertContactByPhone(
        ctx,
        String(customerIn.phone).slice(0, 30),
        optStr(customerIn.name, 'customer.name', 120),
      )
      contactId = contact._id
    }
    if (contactId) conversationId = (await getOrCreateConversation(ctx, contactId))._id

    const email = optStr(customerIn.email, 'customer.email', 254)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('customer email is not valid')

    const order = await createOrder(ctx, {
      lines,
      contactId,
      conversationId,
      customer: { name: optStr(customerIn.name, 'customer.name', 120), email: email?.toLowerCase() ?? null },
      source: 'manual',
      notes: optStr(body.notes, 'notes', 1000),
      deliveryFee: body.deliveryFee ? Math.round(num(body.deliveryFee, 'deliveryFee', { min: 0, max: 10_000_000 }) * 100) : 0,
      discount: body.discount ? Math.round(num(body.discount, 'discount', { min: 0, max: 10_000_000 }) * 100) : 0,
      allowBackorder: body.allowBackorder === true,
      status: 'awaiting_payment',
    })
    return NextResponse.json({ order }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

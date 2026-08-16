import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendCatalogToConversation, SendCatalogError } from '@/lib/products/send-catalog'

/**
 * POST /api/products/send-catalog  (agent+)
 *
 * Body: { conversation_id }. Sends a link to the account's public
 * catalog page to the given conversation, via the same channel-agnostic
 * send core the quote-send route uses.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const body = await request.json().catch(() => null)
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    if (!conversationId) return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })

    const db = supabaseAdmin()

    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    try {
      const { catalogUrl } = await sendCatalogToConversation(db, ctx.accountId, conversationId)
      return NextResponse.json({ ok: true, catalog_url: catalogUrl })
    } catch (err) {
      if (err instanceof SendCatalogError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

// ============================================================
// DELETE /api/whatsapp/conversations/reset
//
// Wipes every conversation (and, via ON DELETE CASCADE, every
// message + notification) for the caller's account. Intended for the
// moment an operator disconnects one WhatsApp number and connects a
// different one (Meta -> Evolution Go, or a different Evolution Go
// instance/number): leftover conversations still carry the old
// number's message_ids and provider-specific state, which can surface
// as confusing send errors (e.g. a reply trying to quote a message id
// format the new provider doesn't recognise) once the new number is
// live.
//
// Contacts are deliberately NOT deleted — a phone number identity
// isn't tied to which WhatsApp number/provider you're sending FROM,
// so keeping contacts (and pipeline deals, which key off contact_id)
// avoids destroying unrelated CRM data for a purely messaging-side
// reset. Admin-gated: this is as destructive as it gets short of
// deleting the account itself.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { error, count } = await supabase
      .from('conversations')
      .delete({ count: 'exact' })
      .eq('account_id', accountId)

    if (error) {
      console.error('[whatsapp/conversations/reset] delete failed:', error)
      return NextResponse.json(
        { error: 'Failed to delete conversations' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, deleted: count ?? 0 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

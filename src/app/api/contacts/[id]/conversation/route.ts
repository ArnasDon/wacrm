// ============================================================
// POST /api/contacts/[id]/conversation
//
// Find-or-create the conversation for a contact, scoped to the
// caller's account. Used by the pipeline deal card's "open
// conversation" button: after a "reset conversations" wipe (see
// whatsapp/conversations/reset), a deal's contact may have no
// conversation left, and the card just errored instead of starting
// a fresh thread.
//
// Race-safe by construction, not by a check-then-insert: migration
// 036 put a UNIQUE index on (account_id, contact_id), so a concurrent
// duplicate insert (two agents clicking the same deal at once) always
// fails with 23505 rather than creating a second thread — the
// unique-violation branch below just re-reads the winner. Mirrors the
// same find-or-create shape the Evolution/Meta webhooks use.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { id: contactId } = await params

    // Confirms the contact is actually this account's (RLS would also
    // block a cross-account row, but an explicit check gives a clean
    // 404 instead of a confusing empty-result fall-through).
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (contactError) {
      console.error('[contacts/conversation] contact lookup failed:', contactError)
      return NextResponse.json({ error: 'Failed to load contact' }, { status: 500 })
    }
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (findError) {
      console.error('[contacts/conversation] conversation lookup failed:', findError)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json({ id: existing.id, created: false })
    }

    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
      .select('id')
      .single()

    if (createError) {
      if (isUniqueViolation(createError)) {
        const { data: winner, error: raceError } = await supabase
          .from('conversations')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
          .maybeSingle()
        if (!raceError && winner) {
          return NextResponse.json({ id: winner.id, created: false })
        }
      }
      console.error('[contacts/conversation] conversation create failed:', createError)
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
    }

    return NextResponse.json({ id: created.id, created: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

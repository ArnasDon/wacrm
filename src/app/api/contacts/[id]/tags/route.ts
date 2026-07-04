import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { addContactTag } from '@/lib/automations/engine'

/**
 * POST /api/contacts/:id/tags  (agent+)
 *
 * Body: { tag_id }
 *
 * Manual "add tag" from the contact detail view. Server-side on purpose
 * (unlike the rest of that view, which writes to Supabase directly from
 * the browser) — `addContactTag` needs a service-role client to dispatch
 * `tag_added` automations, and that can't run in client code.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId } = await requireRole('agent')
    const { id: contactId } = await params

    const body = await request.json().catch(() => null)
    const tagId = body && typeof body.tag_id === 'string' ? body.tag_id : ''
    if (!tagId) {
      return NextResponse.json({ error: 'tag_id is required' }, { status: 400 })
    }

    const { added } = await addContactTag({ accountId, contactId, tagId })
    if (!added) {
      return NextResponse.json(
        { error: 'Could not add tag — contact or tag not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({ added: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

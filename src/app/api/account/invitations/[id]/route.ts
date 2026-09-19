import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { InvitationDoc } from '@/lib/db/types'
import { NotFoundError } from '@/lib/http/errors'

/** DELETE — revoke a pending invitation. Admin+. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole('admin')
    const id = parseId((await ctx.params).id)
    const invitations = await scopedCollection<InvitationDoc>(actor, 'invitations')
    const res = await invitations.deleteOne({ _id: id, acceptedAt: null })
    if (res.deletedCount === 0) throw new NotFoundError('Invitation not found')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

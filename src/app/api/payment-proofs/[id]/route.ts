import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseId } from '@/lib/db/ids'
import { readJson } from '@/lib/http/errors'
import { num, oneOf, optStr } from '@/lib/http/validate'
import { approveProof, rejectProof } from '@/lib/sales/payment-proofs'

/**
 * POST { action: approve, amount? (major units) } → order paid + receipt sent
 * POST { action: reject, reason? }               → customer is told
 * Agent+.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const action = oneOf(body.action, 'action', ['approve', 'reject'] as const)
    if (action === 'approve') {
      const amount = body.amount ? Math.round(num(body.amount, 'amount', { min: 0 }) * 100) : null
      return NextResponse.json(await approveProof(ctx, id, amount))
    }
    return NextResponse.json({ proof: await rejectProof(ctx, id, optStr(body.reason, 'reason', 300)) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

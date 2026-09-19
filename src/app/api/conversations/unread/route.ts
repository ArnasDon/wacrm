import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { ConversationDoc, PaymentProofDoc } from '@/lib/db/types'
import { kickBackgroundWork } from '@/lib/jobs/background'

/** GET — cheap counters for the sidebar badges. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    // This poll runs every ~20s while anyone on the team has the app
    // open — it doubles as the background-work heartbeat (no cron).
    kickBackgroundWork(ctx.accountId)
    const conversations = await scopedCollection<ConversationDoc>(ctx, 'conversations')
    const proofs = await scopedCollection<PaymentProofDoc>(ctx, 'payment_proofs')
    const [unread, pendingProofs] = await Promise.all([
      conversations.countDocuments({ unreadCount: { $gt: 0 } }),
      proofs.countDocuments({ status: 'pending' }),
    ])
    return NextResponse.json({ unread, pendingProofs })
  } catch (err) {
    return toErrorResponse(err)
  }
}

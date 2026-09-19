import 'server-only'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { CounterDoc } from '@/lib/db/types'

/**
 * Per-account sequential numbers (ORD-00012, INV-00012, RCT-00012).
 * A single atomic $inc upsert — safe under concurrency on a
 * standalone server.
 */
export async function nextSequence(ctx: AuthContext, name: string): Promise<number> {
  const counters = await scopedCollection<CounterDoc>(ctx, 'counters')
  const doc = await counters.findOneAndUpdate({ name }, { $inc: { seq: 1 } }, { upsert: true })
  return doc?.seq ?? 1
}

export async function nextNumber(ctx: AuthContext, name: string, prefix: string): Promise<string> {
  const n = await nextSequence(ctx, name)
  return `${prefix}-${String(n).padStart(5, '0')}`
}

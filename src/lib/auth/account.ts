import 'server-only'
import { cache } from 'react'
import { getDb } from '@/lib/db/mongo'
import type { AuthContext } from '@/lib/db/scoped'
import type { AccountDoc, UserDoc } from '@/lib/db/types'
import { ForbiddenError, UnauthorizedError } from '@/lib/http/errors'
import { hasMinRole, isAccountRole, type AccountRole } from './roles'
import { getSessionUser } from './session'

// ============================================================
// Server-side account context for route handlers.
//
// EVERY route handler that touches tenant data starts with
// `requireRole(min)`. There is no database-level safety net
// any more (no RLS) — this call plus `scopedCollection()` IS the
// authorization layer. Minimum roles mirror the old 017 policy
// tiers:
//
//   viewer  read anything in the account
//   agent   operational writes: messages, contacts, orders,
//           inventory stock, conversations
//   admin   settings: WhatsApp, payments, email, AI providers,
//           business profile, products catalogue, members
//   owner   ownership transfer, account deletion
//
//   try {
//     const ctx = await requireRole('agent')
//     const orders = await scopedCollection<OrderDoc>(ctx, 'orders')
//   } catch (err) {
//     return toErrorResponse(err)
//   }
// ============================================================

export { UnauthorizedError, ForbiddenError }
export { toErrorResponse } from '@/lib/http/errors'

export interface AccountContext extends AuthContext {
  kind: 'user'
  sessionId: string
  user: Pick<UserDoc, '_id' | 'email' | 'fullName' | 'avatarUrl' | 'role'>
  account: { id: string; name: string }
}

/**
 * Resolve the caller's session → user → account. Memoised per
 * request with React `cache`, so calling it from several helpers
 * costs one DB round trip.
 */
export const getCurrentAccount = cache(async (): Promise<AccountContext> => {
  const resolved = await getSessionUser()
  if (!resolved) throw new UnauthorizedError()
  const { session, user } = resolved

  if (!isAccountRole(user.role)) throw new ForbiddenError('Unknown account role')

  const db = await getDb()
  const account = await db
    .collection<AccountDoc>('accounts')
    .findOne({ _id: user.accountId }, { projection: { name: 1 } })
  if (!account) throw new ForbiddenError('User is not linked to an account')

  return {
    kind: 'user',
    sessionId: session._id,
    userId: user._id,
    accountId: user.accountId,
    role: user.role,
    user: {
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role,
    },
    account: { id: account._id, name: account.name },
  }
})

/** Resolve the account context and enforce a minimum role. */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount()
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(`This action requires the '${min}' role or higher`)
  }
  return ctx
}

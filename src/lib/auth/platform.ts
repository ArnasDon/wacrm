import 'server-only'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db/mongo'
import type { AccountDoc, UserDoc } from '@/lib/db/types'
import { ForbiddenError, UnauthorizedError } from '@/lib/http/errors'
import { getSessionUser } from './session'

// ============================================================
// The platform operator — you, not a merchant.
//
// Merchant roles (viewer → owner) only ever mean something inside one
// account. This is the layer above: setting up each merchant's
// WhatsApp, AI, Telegram and storage, watching what they spend, and
// switching them off. Every route under /api/admin starts with
// `requirePlatformAdmin()`, which is the only thing standing between
// one merchant and everybody else's data.
//
// Who qualifies: the flag on the user row, or an email listed in
// PLATFORM_ADMIN_EMAILS. The env var exists so the very first admin
// can exist before anyone can grant the flag; it is checked against
// the session's own email, never against anything a caller sends.
// ============================================================

export const ACTING_ACCOUNT_COOKIE = 'wacrm_admin_account'

function seedEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformAdmin(user: Pick<UserDoc, 'email' | 'platformRole'>): boolean {
  return user.platformRole === 'superadmin' || seedEmails().includes(user.email.toLowerCase())
}

export interface PlatformContext {
  userId: string
  email: string
  fullName: string | null
}

/** Throws unless the caller runs the platform. */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const resolved = await getSessionUser()
  if (!resolved) throw new UnauthorizedError()
  const { user } = resolved
  if (!isPlatformAdmin(user)) throw new ForbiddenError('Administrator access only')
  return { userId: user._id, email: user.email, fullName: user.fullName }
}

/**
 * The account a platform admin is currently working inside, set by
 * "open this merchant" in the admin area. Returns null for everyone
 * else, so a merchant cookie can never redirect their own session
 * into another tenant.
 */
export async function actingAccountId(): Promise<string | null> {
  const resolved = await getSessionUser()
  if (!resolved || !isPlatformAdmin(resolved.user)) return null
  const jar = await cookies()
  const wanted = jar.get(ACTING_ACCOUNT_COOKIE)?.value
  if (!wanted || !/^[a-f0-9]{24}$/.test(wanted) || wanted === resolved.user.accountId) return null
  const db = await getDb()
  const exists = await db.collection<AccountDoc>('accounts').findOne({ _id: wanted }, { projection: { _id: 1 } })
  return exists ? wanted : null
}

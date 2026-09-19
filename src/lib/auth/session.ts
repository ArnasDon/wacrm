import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { getDb } from '@/lib/db/mongo'
import { newId } from '@/lib/db/ids'
import type { SessionDoc, UserDoc } from '@/lib/db/types'

// ============================================================
// Opaque server-side sessions.
//
// The cookie holds a random 256-bit token; the DB holds only its
// SHA-256. A leaked DB snapshot can't be replayed as cookies, and
// revoking a session is a single delete. HttpOnly + SameSite=Lax:
// JS can't read it, and cross-site POSTs don't carry it (the proxy
// adds an Origin check on top for mutating API calls).
// ============================================================

export const SESSION_COOKIE = 'wacrm_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOUCH_INTERVAL_MS = 60 * 60 * 1000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers()
  const xff = h.get('x-forwarded-for')
  return {
    ip: xff ? xff.split(',')[0].trim() : h.get('x-real-ip'),
    userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
  }
}

export async function createSession(userId: string): Promise<void> {
  const token = generateToken()
  const now = new Date()
  const { ip, userAgent } = await requestMeta()
  const db = await getDb()
  await db.collection<SessionDoc>('sessions').insertOne({
    _id: newId(),
    tokenHash: hashToken(token),
    userId,
    ip,
    userAgent,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    lastSeenAt: now,
    createdAt: now,
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

/** Resolve the current request's session → user. Null when signed out. */
export async function getSessionUser(): Promise<{ session: SessionDoc; user: UserDoc } | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token || token.length > 200) return null

  const db = await getDb()
  const session = await db
    .collection<SessionDoc>('sessions')
    .findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } })
  if (!session) return null

  const user = await db.collection<UserDoc>('users').findOne({ _id: session.userId })
  if (!user) return null

  // Sliding expiry, written at most hourly to keep reads cheap.
  const now = Date.now()
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    void db
      .collection<SessionDoc>('sessions')
      .updateOne(
        { _id: session._id },
        { $set: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) } },
      )
      .catch(() => {})
  }
  return { session, user }
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    const db = await getDb()
    await db.collection<SessionDoc>('sessions').deleteOne({ tokenHash: hashToken(token) })
  }
  jar.delete(SESSION_COOKIE)
}

/** Sign a user out everywhere (password change, removal from account). */
export async function destroyAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const db = await getDb()
  await db
    .collection<SessionDoc>('sessions')
    .deleteMany(exceptSessionId ? { userId, _id: { $ne: exceptSessionId } } : { userId })
}

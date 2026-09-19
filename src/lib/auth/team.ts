import 'server-only'
import { getDb } from '@/lib/db/mongo'
import { newId } from '@/lib/db/ids'
import type { AccountDoc, InvitationDoc, UserDoc } from '@/lib/db/types'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/http/errors'
import { defaultBusinessProfile, defaultSalesAgentSettings } from './accounts'
import { destroyAllSessions } from './session'
import { roleRank, type AccountRole } from './roles'

// ============================================================
// Team membership operations — the Mongo port of the 018/019
// SECURITY DEFINER RPCs. Every function re-checks the caller's
// authority itself (not just the route) so these stay safe if
// reused from another entry point.
// ============================================================

/** Collections whose presence means "this workspace has real data". */
const DATA_COLLECTIONS = ['products', 'orders', 'contacts', 'whatsapp_configs']

async function accountHasData(accountId: string): Promise<boolean> {
  const db = await getDb()
  for (const name of DATA_COLLECTIONS) {
    if (await db.collection(name).findOne({ accountId }, { projection: { _id: 1 } })) return true
  }
  return false
}

async function loadMember(accountId: string, userId: string): Promise<UserDoc> {
  const db = await getDb()
  const user = await db.collection<UserDoc>('users').findOne({ _id: userId, accountId })
  if (!user) throw new NotFoundError('Member not found')
  return user
}

/**
 * Change a member's role. Rules (same as the SQL RPC):
 *   - nobody changes their own role or the owner's role;
 *   - 'owner' is only granted via ownership transfer;
 *   - you can only manage members strictly below your own rank.
 */
export async function setMemberRole(
  actor: { accountId: string; userId: string; role: AccountRole },
  targetUserId: string,
  newRole: AccountRole,
): Promise<void> {
  if (newRole === 'owner') throw new ValidationError('Use ownership transfer to make someone the owner')
  if (targetUserId === actor.userId) throw new ForbiddenError('You cannot change your own role')
  const target = await loadMember(actor.accountId, targetUserId)
  if (target.role === 'owner') throw new ForbiddenError("The owner's role cannot be changed")
  if (roleRank(target.role) >= roleRank(actor.role) || roleRank(newRole) >= roleRank(actor.role)) {
    if (actor.role !== 'owner') throw new ForbiddenError('You can only manage members below your role')
  }
  const db = await getDb()
  await db
    .collection<UserDoc>('users')
    .updateOne({ _id: targetUserId, accountId: actor.accountId }, { $set: { role: newRole, updatedAt: new Date() } })
}

/**
 * Remove a member. They're moved into a fresh personal workspace
 * (they keep their login) and signed out everywhere.
 */
export async function removeMember(
  actor: { accountId: string; userId: string; role: AccountRole },
  targetUserId: string,
): Promise<{ newPersonalAccountId: string }> {
  if (targetUserId === actor.userId) throw new ForbiddenError('You cannot remove yourself')
  const target = await loadMember(actor.accountId, targetUserId)
  if (target.role === 'owner') throw new ForbiddenError('The owner cannot be removed')
  if (roleRank(target.role) >= roleRank(actor.role) && actor.role !== 'owner') {
    throw new ForbiddenError('You can only remove members below your role')
  }

  const db = await getDb()
  const now = new Date()
  const name = target.fullName ? `${target.fullName}'s business` : 'My business'
  const personal: AccountDoc = {
    _id: newId(),
    name,
    ownerUserId: target._id,
    currency: 'NGN',
    business: defaultBusinessProfile(name),
    salesAgent: defaultSalesAgentSettings(),
    createdAt: now,
    updatedAt: now,
  }
  await db.collection<AccountDoc>('accounts').insertOne(personal)
  const res = await db
    .collection<UserDoc>('users')
    .updateOne(
      { _id: target._id, accountId: actor.accountId },
      { $set: { accountId: personal._id, role: 'owner', updatedAt: now } },
    )
  if (res.matchedCount === 0) {
    await db.collection<AccountDoc>('accounts').deleteOne({ _id: personal._id })
    throw new NotFoundError('Member not found')
  }
  await destroyAllSessions(target._id)
  return { newPersonalAccountId: personal._id }
}

/** Owner hands the account to another member; old owner becomes admin. */
export async function transferOwnership(
  actor: { accountId: string; userId: string; role: AccountRole },
  newOwnerUserId: string,
): Promise<void> {
  if (actor.role !== 'owner') throw new ForbiddenError('Only the owner can transfer ownership')
  if (newOwnerUserId === actor.userId) throw new ValidationError('You already own this account')
  await loadMember(actor.accountId, newOwnerUserId)
  const db = await getDb()
  const now = new Date()
  // Order matters without transactions: promote first, then demote,
  // so a crash in between leaves two owners (recoverable) rather
  // than zero (locked out).
  await db
    .collection<UserDoc>('users')
    .updateOne({ _id: newOwnerUserId, accountId: actor.accountId }, { $set: { role: 'owner', updatedAt: now } })
  await db
    .collection<AccountDoc>('accounts')
    .updateOne({ _id: actor.accountId }, { $set: { ownerUserId: newOwnerUserId, updatedAt: now } })
  await db
    .collection<UserDoc>('users')
    .updateOne({ _id: actor.userId, accountId: actor.accountId }, { $set: { role: 'admin', updatedAt: now } })
}

export type PeekResult =
  | { ok: true; account_name: string; role: 'admin' | 'agent' | 'viewer'; expires_at: string }
  | { ok: false; reason: 'not_found' | 'used' | 'expired' }

export async function peekInvitation(tokenHash: string): Promise<PeekResult> {
  const db = await getDb()
  const inv = await db.collection<InvitationDoc>('invitations').findOne({ tokenHash })
  if (!inv) return { ok: false, reason: 'not_found' }
  if (inv.acceptedAt) return { ok: false, reason: 'used' }
  if (inv.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' }
  const account = await db.collection<AccountDoc>('accounts').findOne({ _id: inv.accountId })
  if (!account) return { ok: false, reason: 'not_found' }
  return { ok: true, account_name: account.name, role: inv.role, expires_at: inv.expiresAt.toISOString() }
}

/**
 * Move the caller into the inviting account. Refused (409) when the
 * caller's current workspace has teammates or data — joining would
 * orphan it. The invitation is claimed with a single conditional
 * update, so two concurrent redeems can't both succeed.
 */
export async function redeemInvitation(userId: string, tokenHash: string): Promise<string> {
  const db = await getDb()
  const user = await db.collection<UserDoc>('users').findOne({ _id: userId })
  if (!user) throw new NotFoundError('User not found')

  const preview = await db.collection<InvitationDoc>('invitations').findOne({ tokenHash })
  if (!preview || preview.acceptedAt || preview.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError('This invitation is not valid any more')
  }
  if (preview.accountId === user.accountId) throw new ConflictError('You are already a member of this account')

  const teammates = await db
    .collection<UserDoc>('users')
    .countDocuments({ accountId: user.accountId, _id: { $ne: userId } })
  if (teammates > 0) {
    throw new ConflictError('You are already in a shared account. Sign in with a different email to join this one.')
  }
  if (await accountHasData(user.accountId)) {
    throw new ConflictError(
      'Your current workspace already has products, orders or contacts. Sign in with a different email to join this team.',
    )
  }

  const now = new Date()
  const claimed = await db.collection<InvitationDoc>('invitations').findOneAndUpdate(
    { tokenHash, acceptedAt: null, expiresAt: { $gt: now } },
    { $set: { acceptedAt: now, acceptedByUserId: userId, updatedAt: now } },
    { returnDocument: 'after' },
  )
  if (!claimed) throw new ValidationError('This invitation is not valid any more')

  const oldAccountId = user.accountId
  await db
    .collection<UserDoc>('users')
    .updateOne({ _id: userId }, { $set: { accountId: claimed.accountId, role: claimed.role, updatedAt: now } })
  // The old personal workspace is empty (checked above) — drop it.
  await db.collection<AccountDoc>('accounts').deleteOne({ _id: oldAccountId, ownerUserId: userId })
  return claimed.accountId
}

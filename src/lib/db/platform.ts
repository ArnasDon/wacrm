import 'server-only'
import { getDb } from './mongo'
import type { AccountDoc, AIRunDoc, OrderDoc, UserDoc } from './types'

// ============================================================
// Cross-tenant reads for the platform admin.
//
// Everything here deliberately ignores account scoping, which is why
// it lives in one file with one rule: **every export is called only
// after `requirePlatformAdmin()`**. Nothing in here may be reachable
// from a merchant route.
// ============================================================

export interface AccountSummary {
  id: string
  name: string
  business: string
  currency: string
  createdAt: Date
  suspendedAt: Date | null
  suspendedReason: string | null
  owner: { email: string; fullName: string | null } | null
  users: number
  /** Integrations the platform admin is responsible for. */
  whatsapp: { connected: boolean; number: string | null }
  ai: { providers: number; model: string | null; mode: 'ai' | 'rules'; enabled: boolean }
  telegram: { connected: boolean; chats: number }
  storage: { provider: string | null }
  activity: {
    contacts: number
    conversations: number
    lastCustomerMessageAt: Date | null
    orders: number
    paidRevenue: number
  }
  usage: { runs7d: number; tokens7d: number; failures7d: number }
}

const DAY = 86_400_000

/** One row per merchant for the admin list. */
export async function listAccountSummaries(limit = 200): Promise<AccountSummary[]> {
  const db = await getDb()
  const accounts = await db.collection<AccountDoc>('accounts').find({}).sort({ createdAt: -1 }).limit(limit).toArray()
  const ids = accounts.map((a) => a._id)
  if (ids.length === 0) return []
  const since = new Date(Date.now() - 7 * DAY)

  // One grouped query per collection rather than per account: a
  // hundred merchants must not mean six hundred round trips.
  const countBy = async (collection: string, extra: Record<string, unknown> = {}) => {
    const rows = await db
      .collection(collection)
      .aggregate<{ _id: string; n: number }>([
        { $match: { accountId: { $in: ids }, ...extra } },
        { $group: { _id: '$accountId', n: { $sum: 1 } } },
      ])
      .toArray()
    return new Map(rows.map((r) => [r._id, r.n]))
  }

  const [
    users,
    contacts,
    conversations,
    orderStats,
    lastMessages,
    whatsapp,
    providers,
    telegram,
    storage,
    usage,
    owners,
  ] = await Promise.all([
    countBy('users'),
    countBy('contacts'),
    countBy('conversations'),
    db
      .collection<OrderDoc>('orders')
      .aggregate<{ _id: string; orders: number; paid: number }>([
        { $match: { accountId: { $in: ids } } },
        {
          $group: {
            _id: '$accountId',
            orders: { $sum: 1 },
            paid: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['paid', 'fulfilled']] },
                  { $ifNull: ['$payment.amountPaid', '$total'] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray(),
    db
      .collection('messages')
      .aggregate<{ _id: string; at: Date }>([
        { $match: { accountId: { $in: ids }, direction: 'inbound' } },
        { $group: { _id: '$accountId', at: { $max: '$createdAt' } } },
      ])
      .toArray(),
    db
      .collection<{ accountId: string; displayPhone: string | null }>('whatsapp_configs')
      .find({ accountId: { $in: ids } }, { projection: { accountId: 1, displayPhone: 1 } })
      .toArray(),
    countBy('ai_providers'),
    db
      .collection<{ accountId: string; chats: unknown[]; enabled: boolean }>('telegram_configs')
      .find({ accountId: { $in: ids } }, { projection: { accountId: 1, chats: 1, enabled: 1 } })
      .toArray(),
    db
      .collection<{ accountId: string; provider: string; isActive?: boolean }>('storage_configs')
      .find({ accountId: { $in: ids } }, { projection: { accountId: 1, provider: 1, isActive: 1 } })
      .toArray(),
    db
      .collection<AIRunDoc>('ai_runs')
      .aggregate<{ _id: string; runs: number; tokens: number; failures: number }>([
        { $match: { accountId: { $in: ids }, createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$accountId',
            runs: { $sum: 1 },
            tokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
            failures: { $sum: { $cond: ['$ok', 0, 1] } },
          },
        },
      ])
      .toArray(),
    db
      .collection<UserDoc>('users')
      .find({ accountId: { $in: ids }, role: 'owner' }, { projection: { accountId: 1, email: 1, fullName: 1 } })
      .toArray(),
  ])

  const orderMap = new Map(orderStats.map((o) => [o._id, o]))
  const messageMap = new Map(lastMessages.map((m) => [m._id, m.at]))
  const waMap = new Map(whatsapp.map((w) => [w.accountId, w]))
  const tgMap = new Map(telegram.map((t) => [t.accountId, t]))
  const storeMap = new Map(storage.filter((s) => s.isActive !== false).map((s) => [s.accountId, s.provider]))
  const usageMap = new Map(usage.map((u) => [u._id, u]))
  const ownerMap = new Map(owners.map((o) => [o.accountId, o]))

  return accounts.map((a) => ({
    id: a._id,
    name: a.name,
    business: a.business?.displayName ?? a.name,
    currency: a.currency,
    createdAt: a.createdAt,
    suspendedAt: a.suspendedAt ?? null,
    suspendedReason: a.suspendedReason ?? null,
    owner: ownerMap.get(a._id) ? { email: ownerMap.get(a._id)!.email, fullName: ownerMap.get(a._id)!.fullName } : null,
    users: users.get(a._id) ?? 0,
    whatsapp: { connected: waMap.has(a._id), number: waMap.get(a._id)?.displayPhone ?? null },
    ai: {
      providers: providers.get(a._id) ?? 0,
      model: null,
      mode: a.salesAgent?.mode ?? 'rules',
      enabled: a.salesAgent?.enabled ?? false,
    },
    telegram: { connected: tgMap.has(a._id), chats: tgMap.get(a._id)?.chats?.length ?? 0 },
    storage: { provider: storeMap.get(a._id) ?? null },
    activity: {
      contacts: contacts.get(a._id) ?? 0,
      conversations: conversations.get(a._id) ?? 0,
      lastCustomerMessageAt: messageMap.get(a._id) ?? null,
      orders: orderMap.get(a._id)?.orders ?? 0,
      paidRevenue: orderMap.get(a._id)?.paid ?? 0,
    },
    usage: {
      runs7d: usageMap.get(a._id)?.runs ?? 0,
      tokens7d: usageMap.get(a._id)?.tokens ?? 0,
      failures7d: usageMap.get(a._id)?.failures ?? 0,
    },
  }))
}

export interface UsageRow {
  accountId: string
  name: string
  days: Array<{ date: string; runs: number; tokens: number }>
  totalRuns: number
  totalTokens: number
  failures: number
  lastError: { message: string; kind: string; at: Date } | null
}

/** AI usage per merchant per day — who is burning credit, and on what. */
export async function usageByAccount(days = 14): Promise<UsageRow[]> {
  const db = await getDb()
  const since = new Date(Date.now() - days * DAY)
  const grouped = await db
    .collection<AIRunDoc>('ai_runs')
    .aggregate<{ _id: { accountId: string; date: string }; runs: number; tokens: number; failures: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            accountId: '$accountId',
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } },
          },
          runs: { $sum: 1 },
          tokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
          failures: { $sum: { $cond: ['$ok', 0, 1] } },
        },
      },
      { $sort: { '_id.date': 1 } },
    ])
    .toArray()
  if (grouped.length === 0) return []

  const ids = [...new Set(grouped.map((g) => g._id.accountId))]
  const [accounts, errors] = await Promise.all([
    db.collection<AccountDoc>('accounts').find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray(),
    db
      .collection<AIRunDoc>('ai_runs')
      .aggregate<{ _id: string; error: string; errorKind: string; at: Date }>([
        { $match: { accountId: { $in: ids }, ok: false, createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$accountId',
            error: { $first: '$error' },
            errorKind: { $first: '$errorKind' },
            at: { $first: '$createdAt' },
          },
        },
      ])
      .toArray(),
  ])
  const nameMap = new Map(accounts.map((a) => [a._id, a.name]))
  const errorMap = new Map(errors.map((e) => [e._id, e]))

  return ids
    .map((accountId) => {
      const rows = grouped.filter((g) => g._id.accountId === accountId)
      const err = errorMap.get(accountId)
      return {
        accountId,
        name: nameMap.get(accountId) ?? accountId,
        days: rows.map((r) => ({ date: r._id.date, runs: r.runs, tokens: r.tokens })),
        totalRuns: rows.reduce((s, r) => s + r.runs, 0),
        totalTokens: rows.reduce((s, r) => s + r.tokens, 0),
        failures: rows.reduce((s, r) => s + r.failures, 0),
        lastError: err ? { message: err.error, kind: err.errorKind ?? 'other', at: err.at } : null,
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.totalRuns - a.totalRuns)
}

/** Everything that belongs to one merchant, for the detail screen. */
export async function accountDetail(accountId: string) {
  const db = await getDb()
  const account = await db.collection<AccountDoc>('accounts').findOne({ _id: accountId })
  if (!account) return null
  const [users, providers, recentRuns, orders] = await Promise.all([
    db
      .collection<UserDoc>('users')
      .find({ accountId }, { projection: { email: 1, fullName: 1, role: 1, lastLoginAt: 1, createdAt: 1 } })
      .toArray(),
    db
      .collection<{ _id: string; label: string; model: string; lastTestOk: boolean | null; lastTestError?: string | null }>('ai_providers')
      .find({ accountId }, { projection: { label: 1, model: 1, lastTestOk: 1, lastTestError: 1 } })
      .toArray(),
    db
      .collection<AIRunDoc>('ai_runs')
      .find({ accountId }, { projection: { ok: 1, model: 1, latencyMs: 1, tokens: 1, error: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray(),
    db
      .collection<OrderDoc>('orders')
      .find({ accountId }, { projection: { number: 1, status: 1, total: 1, currency: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray(),
  ])
  return { account, users, providers, recentRuns, orders }
}

/**
 * Remove a merchant and everything belonging to them. No transactions
 * on standalone Mongo, so the account row goes last: a crash halfway
 * leaves an account whose data is partly gone, which is visible and
 * fixable, rather than orphaned data with no owner.
 */
export async function deleteAccountCascade(accountId: string): Promise<number> {
  const db = await getDb()
  // Sessions hang off the user, not the account, so they need the ids.
  const users = await db
    .collection<UserDoc>('users')
    .find({ accountId }, { projection: { _id: 1 } })
    .toArray()
  const userIds = users.map((u) => u._id)

  const scoped = [
    'ai_providers', 'ai_runs', 'knowledge_entries', 'contacts', 'conversations', 'messages',
    'orders', 'payment_proofs', 'payment_events', 'payment_configs', 'products', 'stock_movements',
    'documents', 'counters', 'email_accounts', 'telegram_configs', 'storage_configs',
    'whatsapp_configs', 'account_assets', 'invitations', 'users',
  ]
  let removed = 0
  for (const name of scoped) {
    const res = await db
      .collection<{ accountId: string }>(name)
      .deleteMany({ accountId })
      .catch(() => ({ deletedCount: 0 }))
    removed += res.deletedCount ?? 0
  }
  if (userIds.length) {
    await db
      .collection<{ userId: string }>('sessions')
      .deleteMany({ userId: { $in: userIds } })
      .catch(() => undefined)
    await db
      .collection<{ userId: string }>('password_resets')
      .deleteMany({ userId: { $in: userIds } })
      .catch(() => undefined)
  }
  await db.collection<{ _id: string }>('job_leases').deleteOne({ _id: accountId }).catch(() => undefined)
  await db.collection<AccountDoc>('accounts').deleteOne({ _id: accountId })
  return removed
}

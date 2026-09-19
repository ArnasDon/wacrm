import 'server-only'
import type {
  Document,
  Filter,
  FindOptions,
  OptionalUnlessRequiredId,
  UpdateFilter,
} from 'mongodb'
import { getDb } from './mongo'
import { newId } from './ids'
import type { AccountRole } from '@/lib/auth/roles'

// ============================================================
// Tenant-scoped data access — the replacement for Postgres RLS.
//
// Route code never touches a raw collection. It asks for
// `scopedCollection(ctx, name)`, and every read/write on the
// returned handle carries `accountId: ctx.accountId`:
//
//   - filters: accountId is merged LAST, so a caller-supplied
//     `accountId` in the filter can never widen the scope;
//   - inserts: accountId, _id and timestamps are stamped;
//   - updates: touching `accountId` / `_id` is refused (no
//     moving rows between tenants).
//
// There is no "service role". Background work (webhooks, cron,
// the AI sales rep) uses `systemContext(accountId)` — still
// scoped to exactly one tenant. The rare genuinely cross-tenant
// lookup (which account owns this WhatsApp phone_number_id?)
// lives in ./unscoped.ts, kept small and grep-able on purpose.
// ============================================================

export interface AuthContext {
  kind: 'user' | 'system'
  /** Acting user id, or `system:<reason>` for background work. */
  userId: string
  accountId: string
  role: AccountRole
}

export function systemContext(accountId: string, reason = 'system'): AuthContext {
  return { kind: 'system', userId: `system:${reason}`, accountId, role: 'owner' }
}

/** Base shape every tenant-scoped document has. */
export interface ScopedDoc {
  _id: string
  accountId: string
  createdAt: Date
  updatedAt: Date
}

export type NewDoc<T extends ScopedDoc> = Omit<
  T,
  '_id' | 'accountId' | 'createdAt' | 'updatedAt'
> & { _id?: string }

const BANNED_OPERATORS = new Set(['$where', '$function', '$accumulator', '$expr'])

function assertSafeFilter(filter: unknown, depth = 0): void {
  if (depth > 8 || !filter || typeof filter !== 'object') return
  for (const [key, value] of Object.entries(filter as Record<string, unknown>)) {
    if (BANNED_OPERATORS.has(key)) {
      throw new Error(`Refusing unsafe query operator ${key}`)
    }
    assertSafeFilter(value, depth + 1)
  }
}

function assertSafeUpdate(update: Record<string, unknown>): void {
  for (const [op, body] of Object.entries(update)) {
    if (!body || typeof body !== 'object') continue
    if ('accountId' in body) throw new Error(`Refusing to modify accountId via ${op}`)
    if ('_id' in body && op !== '$setOnInsert') {
      throw new Error(`Refusing to modify _id via ${op}`)
    }
  }
}

export async function scopedCollection<T extends ScopedDoc>(ctx: AuthContext, name: string) {
  if (!ctx?.accountId) throw new Error('scopedCollection called without accountId')
  const db = await getDb()
  const col = db.collection<T>(name)
  const accountId = ctx.accountId

  const scope = (filter: Filter<T> = {}): Filter<T> => {
    assertSafeFilter(filter)
    return { ...filter, accountId } as Filter<T>
  }

  const stampUpdate = (update: UpdateFilter<T>): UpdateFilter<T> => {
    assertSafeUpdate(update as Record<string, unknown>)
    return {
      ...update,
      $set: { ...((update.$set as object) ?? {}), updatedAt: new Date() },
    } as UpdateFilter<T>
  }

  return {
    find(filter: Filter<T> = {}, options?: FindOptions) {
      return col.find(scope(filter), options)
    },
    findOne(filter: Filter<T> = {}, options?: FindOptions): Promise<T | null> {
      return col.findOne(scope(filter), options) as Promise<T | null>
    },
    findById(id: string, options?: FindOptions): Promise<T | null> {
      return col.findOne(scope({ _id: id } as Filter<T>), options) as Promise<T | null>
    },
    countDocuments(filter: Filter<T> = {}) {
      return col.countDocuments(scope(filter))
    },
    async insertOne(doc: NewDoc<T>): Promise<T> {
      const now = new Date()
      const full = {
        ...doc,
        _id: doc._id ?? newId(),
        accountId,
        createdAt: now,
        updatedAt: now,
      } as unknown as T
      await col.insertOne(full as OptionalUnlessRequiredId<T>)
      return full
    },
    updateOne(filter: Filter<T>, update: UpdateFilter<T>) {
      return col.updateOne(scope(filter), stampUpdate(update))
    },
    updateMany(filter: Filter<T>, update: UpdateFilter<T>) {
      return col.updateMany(scope(filter), stampUpdate(update))
    },
    updateById(id: string, update: UpdateFilter<T>) {
      return col.updateOne(scope({ _id: id } as Filter<T>), stampUpdate(update))
    },
    /**
     * Atomic read-modify-write on ONE document — the building block
     * for idempotent state transitions on a standalone Mongo (no
     * multi-document transactions). Upserts stamp tenancy via
     * $setOnInsert.
     */
    findOneAndUpdate(
      filter: Filter<T>,
      update: UpdateFilter<T>,
      opts?: { upsert?: boolean },
    ): Promise<T | null> {
      const stamped = stampUpdate(update) as Record<string, unknown>
      if (opts?.upsert) {
        const now = new Date()
        stamped.$setOnInsert = {
          ...((stamped.$setOnInsert as object) ?? {}),
          _id: newId(),
          createdAt: now,
        }
      }
      return col.findOneAndUpdate(scope(filter), stamped as UpdateFilter<T>, {
        returnDocument: 'after',
        upsert: opts?.upsert,
      }) as Promise<T | null>
    },
    deleteOne(filter: Filter<T>) {
      return col.deleteOne(scope(filter))
    },
    deleteMany(filter: Filter<T>) {
      return col.deleteMany(scope(filter))
    },
    aggregate<R extends Document = Document>(pipeline: Document[]) {
      assertSafeFilter(pipeline)
      return col.aggregate<R>([{ $match: { accountId } }, ...pipeline])
    },
  }
}

export type ScopedCollection<T extends ScopedDoc> = Awaited<
  ReturnType<typeof scopedCollection<T>>
>

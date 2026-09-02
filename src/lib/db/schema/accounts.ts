/**
 * Accounts, profiles, invitations, presence — the tenancy root.
 *
 * Every other table in this schema hangs off `accounts.id`. In Postgres
 * that isolation was enforced by 155 RLS policies calling
 * `is_account_member(account_id, min_role)`. D1 has no RLS, so from
 * Phase 3 onward the equivalent check lives in the data-access layer and
 * every query filters on `account_id` explicitly.
 *
 * One deliberate difference from the Postgres schema: `user_id` columns
 * referenced `auth.users(id)`, a Supabase-owned table. Better Auth owns
 * the user table now (see `./auth.ts`), so those FKs point at `user.id`.
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { ACCOUNT_ROLES, id, timestamp, timestampNow, timestamps } from './_shared'
import { user } from './auth'

const roleCheck = (column: string) =>
  sql.raw(`${column} IN (${ACCOUNT_ROLES.map((r) => `'${r}'`).join(', ')})`)

export const accounts = sqliteTable('accounts', {
  id: id(),
  name: text('name').notNull(),
  /**
   * Denormalised for fast "is this user the owner" reads and for the
   * one-account-per-user invariant below. Source of truth for
   * membership remains `profiles.account_id`.
   *
   * Postgres used ON DELETE RESTRICT here. SQLite honours the same
   * clause, but D1 only enforces FKs when `PRAGMA foreign_keys=ON`,
   * which the Workers binding sets per-session — see
   * `docs/d1-migration/README.md`.
   */
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  /** Added in migration 021. */
  defaultCurrency: text('default_currency').notNull().default('USD'),
  ...timestamps,
})

export const accountsIndexes = {
  /** One account per user — the locked single-membership design decision. */
  onePerOwner: uniqueIndex('idx_accounts_one_per_owner').on(accounts.ownerUserId),
}

export const profiles = sqliteTable(
  'profiles',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    avatarUrl: text('avatar_url'),
    /** Legacy, unused — flagged for removal in migration 017's notes. Carried for parity. */
    role: text('role').default('user'),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accountRole: text('account_role').notNull(),
    /**
     * Was `TEXT[]` in Postgres (migration 011). Now a JSON array.
     * Membership tests like `'account_sharing' = ANY(beta_features)`
     * become a JSON1 `json_each` EXISTS clause or an in-memory
     * `.includes()` once the row is loaded.
     */
    betaFeatures: text('beta_features', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (t) => [
    index('idx_profiles_account_role').on(t.accountId, t.accountRole),
    check('profiles_account_role_check', roleCheck('account_role')),
  ],
)

/**
 * One row per outstanding invite link.
 *
 * `token_hash` stores SHA-256 of the token, never the plaintext, so a
 * leaked snapshot yields no usable invite. Unchanged from Postgres.
 */
export const accountInvitations = sqliteTable(
  'account_invitations',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    label: text('label'),
    createdAt: timestampNow('created_at'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: timestamp('accepted_at'),
    acceptedByUserId: text('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    /**
     * Postgres had this as a partial index (`WHERE accepted_at IS NULL`).
     * SQLite supports partial indexes, so the predicate is preserved.
     */
    index('idx_account_invitations_account_pending')
      .on(t.accountId, t.expiresAt)
      .where(sql`accepted_at IS NULL`),
    check('account_invitations_role_check', roleCheck('role')),
    /** An invite can grant any role except owner — ownership transfers via its own path. */
    check('account_invitations_not_owner', sql`role <> 'owner'`),
  ],
)

export const memberPresence = sqliteTable(
  'member_presence',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('online'),
    lastSeenAt: timestampNow('last_seen_at'),
  },
  (t) => [check('member_presence_status_check', sql`${t.status} IN ('online', 'away')`)],
)

/**
 * Better Auth tables — the replacement for Supabase's `auth` schema.
 *
 * Supabase owned `auth.users`, `auth.sessions` and the refresh-token
 * machinery in a schema the app could reference but not modify. Better
 * Auth keeps the equivalent tables in the same database as the domain
 * data, which is what makes a D1-only deployment possible.
 *
 * Table and column names follow Better Auth's core schema exactly —
 * its adapter queries them by name, so renaming to project convention
 * (plural, snake_case throughout) would break the adapter. The rest of
 * this schema uses plural table names; these four are the exception,
 * and deliberately so.
 *
 * Two things the Postgres schema did that have to move:
 *
 *   1. `handle_new_user()` — an AFTER INSERT trigger on `auth.users`
 *      that created an account + profile for every signup. There is no
 *      trigger on a Better Auth table to hook, so this becomes an
 *      explicit post-registration hook. See
 *      `docs/d1-migration/postgres-function-inventory.md`.
 *
 *   2. Password hashes do not transfer between auth systems. Any
 *      existing user must re-register or go through a password reset.
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { timestamp, timestampNow, timestamps } from './_shared'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  ...timestamps,
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  ...timestamps,
})

/**
 * Credential and OAuth provider records. `password` holds the hash for
 * email+password accounts; provider rows leave it null and carry tokens
 * instead.
 */
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  ...timestamps,
})

/** Email verification and password-reset tokens. */
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: timestampNow('created_at'),
  updatedAt: timestampNow('updated_at'),
})

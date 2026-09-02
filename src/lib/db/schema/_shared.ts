/**
 * Shared column builders for the D1 (SQLite) schema.
 *
 * Postgres → SQLite type mapping used throughout this schema:
 *
 *   UUID PRIMARY KEY DEFAULT uuid_generate_v4()
 *     → TEXT primary key, id generated in application code via
 *       `crypto.randomUUID()`. SQLite has no UUID type and D1 has no
 *       uuid-ossp/pgcrypto, so generation moves to the writer. Values
 *       stay in canonical 36-char hyphenated form so existing data and
 *       any external references remain valid.
 *
 *   TIMESTAMPTZ
 *     → INTEGER epoch milliseconds. SQLite has no date type at all;
 *       storing millis (not seconds) keeps `Date` round-trips lossless
 *       and sorts correctly as an integer. Every read/write goes
 *       through Drizzle's timestamp_ms mode, so application code still
 *       sees a `Date`.
 *
 *   JSONB
 *     → TEXT holding serialized JSON, via Drizzle's `{ mode: 'json' }`.
 *       SQLite's JSON1 functions (json_extract, json_array_length) work
 *       on this representation when a query needs to reach inside.
 *
 *   BOOLEAN
 *     → INTEGER 0/1, via Drizzle's boolean mode.
 *
 *   TEXT[] (e.g. api_keys.scopes, profiles.beta_features)
 *     → TEXT holding a JSON array. SQLite has no array type. Membership
 *       tests that were `'x' = ANY(col)` in Postgres become either a
 *       JSON1 `EXISTS (SELECT 1 FROM json_each(col) ...)` or an
 *       in-application check — see each call site.
 *
 *   ENUM (account_role_enum)
 *     → TEXT with a CHECK constraint, plus a TypeScript union so the
 *       type is still closed at compile time.
 */
import { sql } from 'drizzle-orm'
import { integer, text } from 'drizzle-orm/sqlite-core'

/**
 * Primary key column. The default is a SQLite-side fallback only —
 * application code should pass an explicit `crypto.randomUUID()` so the
 * id is known before the insert round-trips. `randomblob` produces a
 * v4-shaped value for any writer that forgets.
 */
export const id = () =>
  text('id')
    .primaryKey()
    .default(
      sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`,
    )

/** Epoch-millis timestamp defaulting to now. Replaces `TIMESTAMPTZ DEFAULT NOW()`. */
export const timestampNow = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

/** Nullable epoch-millis timestamp. Replaces a bare `TIMESTAMPTZ`. */
export const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })

/**
 * `created_at` / `updated_at` pair.
 *
 * In Postgres these were maintained by the `update_updated_at_column()`
 * trigger applied to 8 tables. SQLite supports triggers, but the port
 * keeps `updated_at` in the data-access layer instead: the trigger was
 * invisible at the call site, and an explicit `.set({ updatedAt: new Date() })`
 * in one shared update helper is easier to audit than a trigger per table.
 * See `docs/d1-migration/postgres-function-inventory.md`.
 */
export const timestamps = {
  createdAt: timestampNow('created_at'),
  updatedAt: timestampNow('updated_at'),
}

/** Account roles, ordered. Was `account_role_enum` in Postgres. */
export const ACCOUNT_ROLES = ['owner', 'admin', 'agent', 'viewer'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

/**
 * Numeric rank for each role, mirroring the CASE ladder inside the old
 * `is_account_member()` SECURITY DEFINER function. Phase 3's
 * authorization helper uses this instead of a SQL function.
 */
export const ROLE_RANK: Record<AccountRole, number> = {
  owner: 4,
  admin: 3,
  agent: 2,
  viewer: 1,
}

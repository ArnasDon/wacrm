/**
 * D1 database client.
 *
 * Unlike the Supabase client this replaces, there is no module-level
 * singleton and no client created from environment variables. A D1
 * binding is per-request state handed to the Worker, so the handle must
 * be threaded through from the request context — `getDb()` reads it
 * from the Cloudflare context that `@opennextjs/cloudflare` exposes.
 *
 * Phase 3 builds the account-scoped data-access layer on top of this.
 * Until then, `getDb()` is the only sanctioned way to reach D1, and raw
 * queries belong behind that layer rather than in route handlers —
 * unscoped access is exactly the failure mode RLS used to prevent.
 */
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'

import * as schema from './schema'

export type Database = DrizzleD1Database<typeof schema>

/**
 * Wrap a raw D1 binding. Use this in tests and scripts, which have a
 * binding in hand and no Cloudflare request context to read from.
 */
export function createDb(binding: D1Database): Database {
  return drizzle(binding, { schema, logger: false })
}

export { schema }

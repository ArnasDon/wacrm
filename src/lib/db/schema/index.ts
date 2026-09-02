/**
 * The complete D1 schema — 36 domain tables ported from the 39
 * Postgres migrations under `supabase/migrations/`, plus Better Auth's
 * four tables replacing Supabase's `auth` schema.
 *
 * Read `docs/d1-migration/README.md` for the type-mapping rationale and
 * `docs/d1-migration/postgres-function-inventory.md` for where each of
 * the 28 stored functions went.
 */
export * from './_shared'
export * from './auth'
export * from './accounts'
export * from './crm'
export * from './messaging'
export * from './automation'
export * from './ai'

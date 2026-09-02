import type { Config } from 'drizzle-kit'

/**
 * Drizzle Kit configuration for the D1 (SQLite) schema.
 *
 * `dialect: 'sqlite'` with `driver: 'd1-http'` lets `drizzle-kit push`
 * talk to a remote D1 database. Day-to-day the workflow is:
 *
 *   npm run db:generate   → emit SQL into ./drizzle from the schema
 *   npm run db:migrate    → apply it to the local D1 via wrangler
 *
 * Generating SQL rather than pushing directly keeps every schema change
 * reviewable in the diff, which matters here because the whole point of
 * Phase 1 is a schema someone can audit against the Postgres original.
 */
export default {
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
  verbose: true,
  strict: true,
} satisfies Config

# Supabase Migrations

Scope: `supabase/migrations/*.sql`

## Numbering

Files are `NNN_description.sql`, zero-padded to 3 digits, strictly increasing, one migration ahead of the current highest number. Check the current max before creating a new one:

```bash
ls supabase/migrations | sort | tail -1
```

Never renumber or edit an already-merged migration — a migration that already ran in some deployment is immutable. If a merged migration was wrong, write a new migration that corrects it.

## Idempotency — every migration must be safe to run twice

Postgres has no `CREATE POLICY IF NOT EXISTS`, so the pattern throughout this repo is:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- For anything without an `IF NOT EXISTS` form (policies, triggers, some functions): `DROP ... IF EXISTS` immediately before the `CREATE`
- `CREATE OR REPLACE FUNCTION` for functions

Follow this even when you're confident the migration will only ever run once — it's load-bearing for re-applying migrations against a fresh Supabase project.

## Header comment block

Every migration opens with a `-- ====...` banner comment: filename + one-line summary, then prose sections as needed — "Design notes" (why this shape, not just what), "RLS" (policy summary in words), "What this migration does NOT touch" for anything non-obvious it deliberately leaves alone, and always closing with the idempotency note. See `017_account_sharing.sql` or `026_api_keys.sql` for the calibration — this is prose that explains a decision, not a changelog of the SQL below it.

## RLS is mandatory on every new table

1. `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` immediately after creating the table.
2. Every account-owned table gets an `account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` column and an index on it.
3. Policies are gated through the `is_account_member(account_id, min_role)` SECURITY DEFINER helper (defined in `017_account_sharing.sql`), never a raw `auth.uid() = user_id` check — that pattern is legacy and pre-dates multi-tenancy.
   - Default role tiers used across the codebase: **viewer+** can `SELECT` operational data; **agent+** can write operational data (contacts, messages, deals); **admin+** can write settings-class data (tags, custom fields, API keys, webhooks). Match the tier to the table's blast radius, not to what's convenient.
4. `DROP POLICY IF EXISTS <name> ON <table>;` before every `CREATE POLICY`, so the file re-applies cleanly.
5. If the table needs to be readable/writable from the public API's service-role client (`src/lib/auth/api-context.ts`), that client bypasses RLS entirely — the policy still matters for the dashboard's cookie-session path, but don't assume it's the only enforcement. The app-layer `.eq('account_id', ctx.accountId)` filter is what protects the service-role path.

## Money / secrets / other constrained columns

- Store secrets as a hash (`text` SHA-256 hex, see `api_keys.key_hash`) or encrypted ciphertext (see `whatsapp_config` token columns), never plaintext. A short non-secret `_prefix` display column is fine for UI (`key_prefix`).
- `ON DELETE SET NULL` for an audit/attribution FK (`created_by`) so removing a teammate doesn't cascade-delete data others depend on; `ON DELETE CASCADE` for genuine ownership (`account_id`).

## After writing the migration

Update `docs/public-api.md` if the change touches anything the public API surfaces (new scope, new endpoint, new response field) — that doc is user-facing and doesn't auto-derive from the schema.

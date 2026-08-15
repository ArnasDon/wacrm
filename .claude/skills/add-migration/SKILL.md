---
name: add-migration
description: Scaffold a new numbered Supabase migration file in supabase/migrations/ with the repo's standard header comment, idempotency pattern, and RLS boilerplate. Use when the user asks to add/change a table, column, policy, or Postgres function.
disable-model-invocation: false
allowed-tools: Bash, Read, Write
argument-hint: "<short_description>"
---

# Add Migration

Scaffold a new `supabase/migrations/NNN_description.sql` file following this repo's conventions (full detail in `.claude/rules/supabase-migrations.md` — read it if you haven't already).

## Arguments

- `$ARGUMENTS` — short snake_case description, e.g. `contact_notes` or `webhook_retry_count`. If omitted, derive one from the user's request.

## Instructions

### 1. Determine the next migration number

```bash
ls supabase/migrations | sort | tail -1
```

Increment the numeric prefix by one, zero-padded to 3 digits.

### 2. Understand what's being added

Read the relevant existing table's migration (if this alters an existing table) or the closest analog (if this is a new table) to match naming and shape — e.g. `017_account_sharing.sql` for the `account_id` + `is_account_member` pattern, `026_api_keys.sql` for a settings-class table with a secret-shaped column.

Confirm with the user (or infer from context) which role tier gates writes: **agent+** for operational data (contacts, messages, deals) or **admin+** for settings-class data (config, keys, webhooks, tags).

### 3. Write the file

`supabase/migrations/<NNN>_<description>.sql`, structured as:

```sql
-- ============================================================
-- <NNN>_<description>.sql — <one-line summary>
--
-- <Design notes: why this shape, not just what the SQL does.>
--
-- RLS
--   <policy summary in prose>
--
-- Idempotent — safe to run multiple times. <IF NOT EXISTS columns>;
-- <DROP-before-CREATE items> are dropped before recreate (Postgres
-- has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS <table> (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- ... columns ...
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS <table>_account_id_idx ON <table> (account_id);

ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_select ON <table>;
CREATE POLICY <table>_select ON <table> FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS <table>_insert ON <table>;
CREATE POLICY <table>_insert ON <table> FOR INSERT
  WITH CHECK (is_account_member(account_id, '<tier>'));

-- ... update/delete policies as needed ...
```

Adapt columns/policies to what's actually being built — this is a starting skeleton, not a template to fill blindly. If the migration adds a secret-shaped column, use a hash or `src/lib/whatsapp/encryption.ts`'s `encrypt`/`decrypt` — never a plaintext secret column (see `.claude/rules/security.md`).

### 4. Note follow-ups, don't do them silently

Tell the user, don't just do it: if the new table/column needs to be surfaced in the public API, `docs/public-api.md` and `src/lib/api-keys/scopes.ts` need updates too (see `add-api-endpoint` skill and `.claude/rules/api-v1-routes.md`).

## Example Usage

```
/add-migration contact_notes
/add-migration add retry_count to webhook_deliveries
```

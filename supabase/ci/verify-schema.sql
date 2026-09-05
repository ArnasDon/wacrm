-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_connections') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_connections is missing — migrations did not apply';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_connections_status_check'
  ) THEN
    RAISE EXCEPTION 'the 040 status CHECK (whatsapp_connections_status_check) was not installed';
  END IF;
  -- 040 replaces 036's (account_id, contact_id) unique index with a
  -- (account_id, contact_id, connection_id) one. connection_id is
  -- nullable until 1b/1c, so the index MUST be NULLS NOT DISTINCT or
  -- the duplicate-conversation race guard from 036 is silently lost.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_conversations_account_contact_connection'
      AND i.indnullsnotdistinct
  ) THEN
    RAISE EXCEPTION 'idx_conversations_account_contact_connection missing or not NULLS NOT DISTINCT — 036 dedup guard would be lost';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- 041: conversations.connection_id NOT NULL
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'conversations' AND column_name = 'connection_id') <> 'NO' THEN
    RAISE EXCEPTION 'verify-schema: conversations.connection_id is nullable';
  END IF;

  -- 041: FK ON DELETE RESTRICT
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_connection_id_fkey' AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'verify-schema: conversations FK is not ON DELETE RESTRICT';
  END IF;

  -- 041: is_primary EXCLUDE constraint, deferível
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_connections_one_primary'
      AND contype = 'x' AND condeferrable
  ) THEN
    RAISE EXCEPTION 'verify-schema: one_primary is not a deferrable exclusion constraint';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.

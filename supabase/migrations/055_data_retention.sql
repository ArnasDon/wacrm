-- ============================================================
-- 055: Data retention — keep the last N days (DATA_RETENTION_DAYS,
-- default 15), delete everything older, except:
--
--   * profiles (always kept), and accounts (always kept — every profile
--     belongs to an account and account deletion cascades to profiles);
--   * maintenance_jobs (this job's own state);
--   * any extra tables the caller passes in p_keep
--     (DATA_RETENTION_KEEP_TABLES).
--
-- Generic: the tables, their timestamp columns and the foreign keys
-- between them are read from the Postgres catalog, so tables added later
-- are covered too. For each table a row is deleted only when
--
--   1. EVERY timestamp column on it is empty or older than the cutoff —
--      i.e. the row wasn't created, updated, sent, advanced, used or
--      scheduled within the period (a future run_at / scheduled_at /
--      expires_at keeps it), and
--   2. NO row in any table still references it through a foreign key.
--      A parent is only removed after all its children are gone, so a
--      delete never cascades into newer data: a contact with a recent
--      chat, a channel with recent conversations, an automation with
--      recent logs all stay.
--
-- Deletes run in batches (p_limit rows per call, each call its own short
-- transaction; the app loops), children before parents (retention_tables
-- orders them), picking rows with FOR UPDATE SKIP LOCKED so they never
-- wait on — or block — rows the application is using. Idempotent: an
-- interrupted run just continues next time.
--
-- Scheduling: maintenance_jobs is a lease table, so across any number of
-- app instances / workers the cleanup runs once per UTC day.
-- ============================================================

-- ---- Job lease ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_jobs (
  job             TEXT PRIMARY KEY,
  locked_until    TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_result     JSONB,
  last_error      TEXT
);
-- Server-only (service role bypasses RLS); no client policies.
ALTER TABLE public.maintenance_jobs ENABLE ROW LEVEL SECURITY;

-- Claim today's run: true for exactly one caller per UTC day, and only
-- when no other caller holds a live lease.
CREATE OR REPLACE FUNCTION public.claim_maintenance_job(
  p_job           TEXT,
  p_lease_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  INSERT INTO maintenance_jobs (job) VALUES (p_job)
  ON CONFLICT (job) DO NOTHING;

  UPDATE maintenance_jobs
     SET locked_until    = v_now + make_interval(secs => p_lease_seconds),
         last_started_at = v_now
   WHERE job = p_job
     AND (locked_until IS NULL OR locked_until < v_now)
     AND (last_success_at IS NULL
          OR (last_success_at AT TIME ZONE 'UTC')::date
             < (v_now AT TIME ZONE 'UTC')::date);
  RETURN FOUND;
END;
$$;

-- Record the outcome and release the lease. A failed run keeps a short
-- lease (p_retry_seconds) so it's retried later, not on every tick.
CREATE OR REPLACE FUNCTION public.finish_maintenance_job(
  p_job           TEXT,
  p_ok            BOOLEAN,
  p_result        JSONB,
  p_error         TEXT,
  p_retry_seconds INTEGER DEFAULT 3600
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE maintenance_jobs
     SET last_success_at = CASE WHEN p_ok THEN now() ELSE last_success_at END,
         locked_until    = CASE WHEN p_ok THEN NULL
                                ELSE now() + make_interval(secs => p_retry_seconds) END,
         last_result     = p_result,
         last_error      = p_error
   WHERE job = p_job;
$$;

-- ---- Which tables ------------------------------------------------
-- Never deleted, whatever the caller passes.
CREATE OR REPLACE FUNCTION public.retention_protected_tables()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['profiles', 'accounts', 'maintenance_jobs']::TEXT[] $$;

-- Tables the cleanup covers, children before parents: `level` is the
-- length of the longest chain of tables referencing it (0 = nothing
-- references it). Only tables with at least one timestamp column.
CREATE OR REPLACE FUNCTION public.retention_tables(p_keep TEXT[] DEFAULT '{}')
RETURNS TABLE (table_name TEXT, level INTEGER)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH RECURSIVE
  t AS (
    SELECT c.oid, c.relname::TEXT AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT (c.relname::TEXT = ANY (
             public.retention_protected_tables() || COALESCE(p_keep, '{}')))
       AND EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                AND a.atttypid IN ('timestamptz'::regtype, 'timestamp'::regtype))
  ),
  edges AS (
    SELECT DISTINCT con.confrelid AS parent, con.conrelid AS child
      FROM pg_constraint con
     WHERE con.contype = 'f' AND con.confrelid <> con.conrelid
  ),
  depth (oid, d) AS (
    SELECT oid, 0 FROM t
    UNION ALL
    SELECT e.parent, depth.d + 1
      FROM depth JOIN edges e ON e.child = depth.oid
     WHERE depth.d < 12
  )
  SELECT t.name, max(depth.d)::INTEGER
    FROM t JOIN depth ON depth.oid = t.oid
   GROUP BY t.name
   ORDER BY 2, 1;
$$;

-- ---- One batch of deletes ---------------------------------------
CREATE OR REPLACE FUNCTION public.retention_delete_batch(
  p_table  TEXT,
  p_cutoff TIMESTAMPTZ,
  p_limit  INTEGER,
  p_keep   TEXT[] DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
-- Never queue behind a long lock: fail this batch and retry later.
SET lock_timeout = '5s'
AS $$
DECLARE
  v_rel     REGCLASS;
  v_age     TEXT;
  v_any     TEXT;
  v_guard   TEXT := '';
  v_match   TEXT;
  v_deleted INTEGER;
  r         RECORD;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'retention: batch size must be 1..10000, got %', p_limit;
  END IF;
  -- Safety net against a misconfiguration: never delete anything from
  -- the last 24 hours, whatever the caller asks for.
  IF p_cutoff IS NULL OR p_cutoff > now() - INTERVAL '1 day' THEN
    RAISE EXCEPTION 'retention: cutoff % is less than 1 day old', p_cutoff;
  END IF;
  -- Only tables retention_tables() lists (never profiles / accounts).
  IF NOT EXISTS (
    SELECT 1 FROM public.retention_tables(p_keep) rt WHERE rt.table_name = p_table
  ) THEN
    RAISE EXCEPTION 'retention: table % is not covered', p_table;
  END IF;
  v_rel := format('public.%I', p_table)::REGCLASS;

  -- 1. Every timestamp column empty or older than the cutoff, at least
  --    one of them set.
  SELECT string_agg(format('(t.%1$I IS NULL OR t.%1$I < $1)', a.attname), ' AND ' ORDER BY a.attnum),
         string_agg(format('t.%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_age, v_any
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid IN ('timestamptz'::regtype, 'timestamp'::regtype);

  -- 2. Not referenced by any row, through any foreign key.
  FOR r IN
    SELECT con.conrelid, con.conkey, con.confkey
      FROM pg_constraint con
     WHERE con.contype = 'f' AND con.confrelid = v_rel
  LOOP
    SELECT string_agg(format('c.%I = t.%I', ca.attname, pa.attname), ' AND ')
      INTO v_match
      FROM unnest(r.conkey, r.confkey) AS k(ck, pk)
      JOIN pg_attribute ca ON ca.attrelid = r.conrelid AND ca.attnum = k.ck
      JOIN pg_attribute pa ON pa.attrelid = v_rel AND pa.attnum = k.pk;
    v_guard := v_guard || format(
      ' AND NOT EXISTS (SELECT 1 FROM %s c WHERE %s)', r.conrelid::REGCLASS, v_match);
  END LOOP;

  EXECUTE format(
    'DELETE FROM %1$s WHERE ctid = ANY (ARRAY(
       SELECT t.ctid FROM %1$s t
        WHERE %2$s AND COALESCE(%3$s) IS NOT NULL%4$s
        LIMIT %5$s
        FOR UPDATE OF t SKIP LOCKED))',
    v_rel, v_age, v_any, v_guard, p_limit)
  USING p_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---- Indexes ------------------------------------------------------
-- The "not referenced" check looks up every child table by its foreign
-- key column, and the age check filters on created_at: index both where
-- no index starts with that column yet (small tables today; each index
-- is a brief lock while it builds).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conrelid, con.conname,
           (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public'
       AND NOT EXISTS (
             SELECT 1 FROM pg_index i
              WHERE i.indrelid = con.conrelid AND i.indkey[0] = con.conkey[1])
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)',
                   left('idx_fk_' || r.conname, 63), r.conrelid::REGCLASS, r.cols);
  END LOOP;

  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'created_at' AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (
             SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (created_at)',
                   left('idx_' || r.relname || '_created_at', 63), r.oid::REGCLASS);
  END LOOP;
END;
$$;

-- ---- Server only ------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_maintenance_job(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_maintenance_job(TEXT, BOOLEAN, JSONB, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retention_tables(TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retention_delete_batch(TEXT, TIMESTAMPTZ, INTEGER, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_maintenance_job(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_maintenance_job(TEXT, BOOLEAN, JSONB, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.retention_tables(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.retention_delete_batch(TEXT, TIMESTAMPTZ, INTEGER, TEXT[]) TO service_role;

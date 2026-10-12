-- CI negative control for the tenant-isolation gate.
--
-- The gate (src/lib/tenant/isolation.sql) is a psql script that fails a
-- CI step only if a *raised SQL exception* propagates as a non-zero
-- exit through `supabase db query`. This sentinel proves that
-- propagation exists: it raises on purpose and MUST make its step fail.
-- If the sentinel step ever passes, the isolation gate below it is not
-- a gate and the job must not be trusted.
\set ON_ERROR_STOP on
DO $$ BEGIN
  RAISE EXCEPTION 'sentinel: error propagation check (this step must fail)';
END $$;

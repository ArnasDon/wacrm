-- ============================================================
-- Migration 067 — Grant all table permissions comprehensively
--
-- This migration grants SELECT, INSERT, UPDATE, DELETE permissions
-- to the authenticated role on ALL public tables, and ALL permissions
-- to the service_role.
--
-- This is the final fix to ensure no "permission denied" errors occur.
-- ============================================================

-- Grant permissions on all existing tables
DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', tbl.tablename);
        EXECUTE format('GRANT ALL ON %I TO service_role', tbl.tablename);
    END LOOP;
END $$;

-- Grant USAGE on all sequences (for auto-increment IDs)
DO $$
DECLARE
    seq record;
BEGIN
    FOR seq IN 
        SELECT sequencename 
        FROM pg_sequences 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO authenticated', seq.sequencename);
        EXECUTE format('GRANT ALL ON SEQUENCE %I TO service_role', seq.sequencename);
    END LOOP;
END $$;

-- Grant execute permissions on all functions
DO $$
DECLARE
    func record;
BEGIN
    FOR func IN 
        SELECT routine_name, routine_schema
        FROM information_schema.routines 
        WHERE routine_schema = 'public'
          AND routine_type = 'FUNCTION'
    LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I TO authenticated', func.routine_schema, func.routine_name);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I TO service_role', func.routine_schema, func.routine_name);
    END LOOP;
END $$;

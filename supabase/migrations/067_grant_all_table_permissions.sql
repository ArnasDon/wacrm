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
-- Note: We use pg_proc instead of information_schema to handle overloaded functions properly
DO $$
DECLARE
    func_record record;
BEGIN
    FOR func_record IN 
        SELECT 
            n.nspname as schema_name,
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'  -- functions only, not aggregates or procedures
    LOOP
        BEGIN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated', 
                func_record.schema_name, func_record.function_name, func_record.args);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', 
                func_record.schema_name, func_record.function_name, func_record.args);
        EXCEPTION WHEN OTHERS THEN
            -- Skip functions that cause errors (e.g., system functions)
            RAISE NOTICE 'Skipped function %.% with args %: %', 
                func_record.schema_name, func_record.function_name, func_record.args, SQLERRM;
        END;
    END LOOP;
END $$;

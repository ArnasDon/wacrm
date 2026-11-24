-- ============================================================
-- Grant permissions for ALL tables to authenticated and service_role
-- ============================================================

-- Get list of all tables and grant permissions
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

-- Also grant USAGE on all sequences (for auto-increment IDs)
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

SELECT 'Granted permissions on all tables and sequences' as status;

-- Verify by listing some key tables
SELECT 
    tablename,
    has_table_privilege('authenticated', tablename, 'SELECT') as can_select,
    has_table_privilege('authenticated', tablename, 'INSERT') as can_insert
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('contact_tags', 'contacts', 'conversations', 'messages', 'accounts', 'profiles')
ORDER BY tablename;

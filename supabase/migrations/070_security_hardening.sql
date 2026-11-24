DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        '_bcast_bump',
        'bump_conversation_on_inbound',
        'claim_ai_reply_slot',
        'create_broadcast_with_recipients',
        'increment_automation_execution_count',
        'increment_flow_execution_count',
        'list_timed_out_flow_runs',
        'merge_duplicate_contacts',
        'merge_duplicate_conversations',
        'recompute_broadcast_counts',
        'record_webhook_failure'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;

  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.ensure_user_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile() TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.pending_message_statuses') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.pending_message_statuses FROM anon, authenticated;
  END IF;
END $$;

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;
DROP POLICY IF EXISTS notifications_delete ON notifications;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON notifications FROM anon, authenticated;
GRANT UPDATE (read_at) ON notifications TO authenticated;

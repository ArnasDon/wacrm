-- ============================================================
-- 095_notifications_push_fanout.sql
--
-- Every row inserted into `notifications` (assignment via the
-- `on_conversation_assigned` trigger, plus the service-role inserts for
-- ai_key_invalid / google_calendar_error / google_sheets_error) now
-- also fires a Web Push to that user's devices — one integration point,
-- so any future notification type is covered for free.
--
-- Mechanism: an AFTER INSERT trigger does a fire-and-forget
-- `net.http_post` (pg_net, already enabled) to
-- `<base_url>/api/push/fanout` with an `x-cron-secret` header. That
-- route loads the row, builds the payload, and calls `sendPushToUser`.
-- The trigger swallows every error — a push must never block the
-- insert that triggered it.
--
-- Also fixes a pre-existing gap: `google_sheets_error` (used by
-- src/lib/google-sheets/oauth.ts since migration 090) was never added
-- to `notifications_type_check`, so that insert has been failing the
-- constraint silently.
--
-- SECRETS ARE NOT COMMITTED. Apply in the Supabase SQL editor (or via
-- psql) with the two :'...' tokens replaced. Easiest is to reuse the
-- existing WEBHOOK_CRON_SECRET (the route accepts it as a fallback) so
-- nothing new goes in the app env:
--
--   psql "$DATABASE_URL" \
--     -v base_url="https://sandia-sandia-crm.kmencc.easypanel.host" \
--     -v push_secret="$WEBHOOK_CRON_SECRET" \
--     -f supabase/migrations/095_notifications_push_fanout.sql
--
-- Idempotent (CREATE OR REPLACE + DROP/CREATE TRIGGER).
-- ============================================================

\if :{?base_url}
\else
  \set base_url 'https://REPLACE_ME.example'
\endif
\if :{?push_secret}
\else
  \set push_secret 'REPLACE_ME_WEBHOOK_CRON_SECRET'
\endif

-- 1. Extend the type CHECK to cover google_sheets_error (migration 090 omission).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'ai_key_invalid',
    'google_calendar_error',
    'google_sheets_error'
  ));

-- 2. Fanout trigger.
CREATE OR REPLACE FUNCTION public.push_fanout_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM net.http_post(
    url := :'base_url' || '/api/push/fanout',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', :'push_secret'
    ),
    body := jsonb_build_object('notification_id', NEW.id),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push fanout failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$fn$;

ALTER FUNCTION public.push_fanout_on_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.push_fanout_on_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_notification_push_fanout ON public.notifications;
CREATE TRIGGER on_notification_push_fanout
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_fanout_on_notification();

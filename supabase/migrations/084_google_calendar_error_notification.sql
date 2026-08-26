-- ============================================================
-- Notification type for a dead Google Calendar connection.
--
-- getValidAccessToken() (src/lib/google-calendar/oauth.ts) used to
-- swallow a refresh-token failure ("invalid_grant" — expired or
-- revoked) the same as any other Calendar error: every autonomous
-- reply that tried to check availability just silently lost the
-- scheduling capability for that turn, and nothing in the product
-- surfaced it — an account's calendar can go dead until someone
-- happens to open Settings and notice (real incident, 2026-08-26: the
-- AI kept promising appointments it could never actually book, for
-- days, before anyone found the "Problema de conexión" banner).
-- Reuses the existing `notifications` table (migration 027, extended
-- for ai_key_invalid in 079) rather than a new mechanism.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_key_invalid', 'google_calendar_error'));

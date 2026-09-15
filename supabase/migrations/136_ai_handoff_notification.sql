-- ============================================================
-- Notification type for an AI handoff that landed on nobody.
--
-- `handOffToHuman()` (src/lib/ai/auto-reply.ts) pauses the bot and
-- writes an internal note whenever it can't continue (reply cap hit,
-- provider error, explicit customer request, etc.). When the account
-- has a configured `ai_configs.handoff_agent_id` it also sets
-- `conversations.assigned_agent_id`, which fires the existing
-- `on_conversation_assigned` trigger (migration 027) and notifies that
-- agent. Accounts with NO configured handoff agent got nothing: the
-- conversation just sat open/unassigned until the idle-reassignment
-- sweep (up to `unclaimed_conversation_timeout_minutes`, default 60)
-- happened to run with someone online — invisible in the meantime
-- unless a teammate happened to open the thread. Reuses the existing
-- `notifications` table/UI (migrations 027, 079) rather than a new
-- mechanism.
-- ============================================================

-- Keep every existing value (migration 097's set) and add 'ai_handoff'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'ai_key_invalid',
    'google_calendar_error',
    'google_sheets_error',
    'task_due',
    'ai_handoff'
  ));

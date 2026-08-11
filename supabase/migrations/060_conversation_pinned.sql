-- ============================================================
-- 060_conversation_pinned.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Adds a manual "pin to top" flag for the Inbox conversation list
-- (swipe-right action on mobile, right-click context menu on desktop).
-- Independent of `status`/`unread_count` — purely a display-order hint.
-- ============================================================

alter table conversations
  add column if not exists pinned boolean not null default false;

-- ============================================================
-- 045_group_community_cleanup.sql
--
-- WhatsApp group/community messages (delivered through the uazapi
-- and Z-API webhooks, which forward every chat type — not just 1:1
-- customer conversations) were being persisted as ordinary contacts.
-- The webhook routes now classify and skip these before they ever
-- reach the database (see src/lib/whatsapp/chat-classify.ts and the
-- uazapi/z-api webhook routes) — this migration is the one-time
-- cleanup of rows that were already created before that fix shipped.
--
-- Detection: a real E.164 phone number is at most 15 digits. The
-- numeric id of a WhatsApp group/community JID (`<id>@g.us`) runs
-- 18-20 digits. Any `contacts.phone` longer than 15 digits is not a
-- real phone number and can only have come from a group/community
-- chat being misfiled as a contact.
--
-- Scope check before running in a new environment: this was
-- verified against production on 2026-08-13 — exactly 3 contacts, 3
-- conversations, 26 messages, 0 broadcast_recipients, 0
-- message_reactions matched the predicate below. Re-run the SELECT
-- first if applying this somewhere else, to confirm the blast radius
-- before deleting.
-- ============================================================

begin;

with victims as (
  select id from contacts
  where length(regexp_replace(phone, '\D', '', 'g')) > 15
),
convs as (
  select id from conversations where contact_id in (select id from victims)
),
msgs as (
  select id from messages where conversation_id in (select id from convs)
)
delete from message_reactions where message_id in (select id from msgs);

with victims as (
  select id from contacts
  where length(regexp_replace(phone, '\D', '', 'g')) > 15
),
convs as (
  select id from conversations where contact_id in (select id from victims)
)
delete from messages where conversation_id in (select id from convs);

delete from conversations
where contact_id in (
  select id from contacts
  where length(regexp_replace(phone, '\D', '', 'g')) > 15
);

delete from contacts
where length(regexp_replace(phone, '\D', '', 'g')) > 15;

commit;

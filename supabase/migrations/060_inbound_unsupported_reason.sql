-- ============================================================
-- 060_inbound_unsupported_reason
--
-- Follow-up to 042. Meta hands over an inbound message as
-- `type: 'unsupported'` when WhatsApp itself cannot represent what the
-- customer sent — a view-once photo, a poll, a disappearing message, or
-- anything from an old or unofficial WhatsApp build. That delivery
-- carries NO content, only an `errors[0]` entry saying why, and there is
-- no Cloud API endpoint to fetch the original afterwards.
--
-- The webhook dropped that entry and stored only the placeholder
-- "[Unsupported message type: unsupported]", so an agent had no idea
-- what had arrived or what to ask the customer for. It now keeps the
-- reason in the same three columns 042 added for failed outbound
-- statuses, which already hold exactly this shape of data (code /
-- title / details).
--
-- Schema-wise this changes nothing: the columns already exist and stay
-- nullable. Only their documented meaning widens, from "set when our
-- outbound message failed" to "set when Meta reported an error about
-- this message, in either direction". Inbound rows are still inserted
-- with status='delivered', so the inbox's failure line in
-- `message-bubble.tsx` — which gates on status='failed' — is untouched.
--
-- No backfill is possible, for the same reason as in 042: the payloads
-- already received were discarded at the door.
--
-- Idempotent — safe to re-run.
-- ============================================================

COMMENT ON COLUMN messages.error_code IS
  'Meta''s numeric error code for this message (errors[0].code): from a '
  'failed status on an outbound message, or from a `type: unsupported` '
  'delivery on an inbound one. NULL when Meta reported no error. Not '
  'cleared by a later status update.';

COMMENT ON COLUMN messages.error_title IS
  'Meta''s short error label for this message (errors[0].title). NULL when '
  'Meta reported no error. See messages.error_code for when it is set.';

COMMENT ON COLUMN messages.error_details IS
  'Meta''s human-readable explanation for this message '
  '(errors[0].error_data.details, falling back to errors[0].message). NULL '
  'when Meta reported no error or supplied no explanation.';

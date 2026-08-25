-- ============================================================
-- 083_internal_note_content_type.sql
--
-- Adds 'internal_note' as an allowed messages.content_type — a system
-- note left inline in the conversation thread (not a real customer/
-- agent/bot turn), used first by the AI handoff flow
-- (src/lib/ai/auto-reply.ts's handOffToHuman) to record WHY it handed
-- a conversation to a human, right where an agent is already looking
-- instead of only in the easy-to-miss thread banner
-- (conversations.ai_handoff_summary, which this doesn't replace —
-- both are set together).
--
-- Never sent over WhatsApp/Instagram/Facebook (inserted directly into
-- `messages`, not through any provider send path) and deliberately
-- excluded from the AI's own conversation context
-- (src/lib/ai/context.ts's buildConversationContext only ever selects
-- content_type in ('text', 'template')) — an internal note must never
-- be fed back to the model as if it were something said to the
-- customer.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'internal_note'
  ));

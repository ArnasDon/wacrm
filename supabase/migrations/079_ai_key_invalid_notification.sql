-- ============================================================
-- Notification type for a broken AI provider key.
--
-- `dispatchInboundToAiReply` (src/lib/ai/auto-reply.ts) used to swallow
-- a 401 'invalid_key' AiError the same as any other AI failure: logged
-- to the server console only, customer gets no reply, and nothing in
-- the product itself ever surfaces it — an account's bot can go
-- silently dead until someone happens to notice from the customer
-- side. Reuses the existing `notifications` table (migration 027)
-- rather than a new mechanism.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_key_invalid'));

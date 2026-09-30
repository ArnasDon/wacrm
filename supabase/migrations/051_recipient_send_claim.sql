-- ============================================================
-- 051_recipient_send_claim
--
-- Campaign sending over Kafka is at-least-once: a message can be
-- redelivered after a consumer crash or rebalance, and a campaign can be
-- re-dispatched to recover stragglers. Before sending, a worker claims
-- the recipient with one conditional UPDATE
--   SET claimed_at = now()
--   WHERE status = 'pending' AND (claimed_at IS NULL OR claimed_at < stale)
-- so exactly one delivery of the message sends it. A claim left by a
-- worker that died goes stale and the row is picked up again.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN broadcast_recipients.claimed_at IS
  'Set by the Kafka campaign worker that is sending this recipient; NULL when unclaimed. See 051_recipient_send_claim.sql.';

-- The dispatcher pages a campaign's unclaimed pending recipients.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending_claim
  ON broadcast_recipients (broadcast_id, id)
  WHERE status = 'pending';

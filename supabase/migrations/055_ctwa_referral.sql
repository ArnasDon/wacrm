-- ============================================================
-- 055_ctwa_referral.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- Click-to-WhatsApp Ads (CTWA) leads arrive with a `referral` object on
-- the FIRST inbound message (Meta Cloud API `messages[].referral`) that
-- identifies which ad/creative sent the lead — source_id, source_url,
-- source_type, headline, body, media_type, image_url, video_url,
-- thumbnail_url, ctwa_clid. The webhook previously discarded this
-- entirely (no column to hold it, no code reading it), so every CTWA
-- lead looked identical regardless of which ad/apartment brought it in.
--
-- Stored as a single JSONB blob (not one column per field) because the
-- shape is Meta's, not ours: fields are optional and may gain siblings
-- over time, and the app only ever reads it as a unit (display card),
-- never queries by an individual sub-field. One ALTER, no new table —
-- conversations is already the one-row-per-lead-thread surface both the
-- Inbox and Pipeline read from.
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ctwa_referral JSONB;

COMMENT ON COLUMN conversations.ctwa_referral IS
  'Meta CTWA referral object captured from the first inbound message that carried one (messages[].referral). Never overwritten once set — see webhook route processMessage(). Null when the lead did not arrive via a Click-to-WhatsApp ad.';

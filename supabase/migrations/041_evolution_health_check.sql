-- ============================================================
-- Evolution Go connection health-check tracking
--
-- Why this exists:
--   Evolution Go's whatsmeow session can go silently dead (network
--   blip, DNS hiccup on its host, stale websocket) without ever
--   firing a 'Disconnected' or 'LoggedOut' webhook — confirmed live:
--   a session sat disconnected for ~3 hours with zero CONNECTION
--   events reaching wacrm, while whatsapp_config.status stayed
--   'connected' the entire time (see the webhook route's 'Connected'
--   /'LoggedOut' handling — both are push-based and this failure mode
--   never pushed anything). A polling health-check
--   (/api/whatsapp/evolution/health-check) closes that gap by asking
--   Evolution Go's own GET /instance/status directly.
--
--   These two columns back that cron's reconnect backoff so a
--   persistent outage (e.g. the Evolution Go host itself is down)
--   doesn't turn into a tight retry loop hammering /instance/connect
--   every few minutes — each failed attempt pushes the next allowed
--   attempt further out (see health-check/route.ts for the schedule).
--   Reset to 0 / NULL the moment a status check finds the instance
--   connected again.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_reconnect_attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evolution_last_reconnect_attempt_at TIMESTAMPTZ;

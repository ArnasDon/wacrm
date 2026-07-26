-- ============================================================
-- 028_webhook_endpoints.sql — Outbound event webhooks (public API)
--
-- Lets an account register HTTPS endpoints that wacrm POSTs to when
-- something happens (an inbound message arrives, a delivery status
-- changes, a conversation is created). This is the "react to inbound"
-- half of the public API (#245): instead of polling
-- `GET /api/v1/conversations`, an automation subscribes once and is
-- pushed the events it cares about.
--
-- Design notes
--   - Account-scoped, never user-scoped (same as `api_keys`).
--     `created_by` records who registered it (audit); ON DELETE SET
--     NULL so removing a teammate doesn't drop their integration's
--     endpoint.
--   - `secret` is the HMAC signing key. UNLIKE `api_keys` (where we
--     store only a hash because the key is a bearer credential the
--     *client* presents), here *we* sign each outgoing payload with
--     the secret and the receiver verifies it — so we need the
--     plaintext at delivery time. We store it AES-256-GCM-encrypted
--     at rest (same `encrypt()`/`decrypt()` as `whatsapp_config.
--     access_token`), and return the plaintext to the creator exactly
--     once so they can configure their verifier.
--   - `events[]` is the subscription filter (free text[], validated
--     in the app layer against `src/lib/webhooks/events.ts` — a new
--     event type is a code change, not a migration, mirroring scopes).
--   - `failure_count` counts *consecutive* delivery failures; the
--     deliverer auto-sets `is_active = false` once it crosses a
--     threshold so a permanently-dead endpoint stops being retried.
--     A successful delivery resets it to 0.
--
-- RLS
--   Settings-class, mirroring `api_keys`: any member may read the
--   roster; only admin+ may create/update/delete. The delivery path
--   and the public-API management routes both use the service-role
--   client (an API caller has no `auth.uid()`), so RLS is the guard
--   for any dashboard UI that reads the table directly.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  url              text NOT NULL,             -- HTTPS endpoint we POST to
  secret           text NOT NULL,             -- AES-256-GCM-encrypted HMAC signing secret
  events           text[] NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,               -- last successful delivery
  failure_count    integer NOT NULL DEFAULT 0, -- consecutive failures; reset to 0 on success
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Every delivery + management query filters by account_id.
CREATE INDEX IF NOT EXISTS webhook_endpoints_account_id_idx
  ON webhook_endpoints (account_id);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
DROP POLICY IF EXISTS webhook_endpoints_select ON webhook_endpoints;
CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS webhook_endpoints_insert ON webhook_endpoints;
CREATE POLICY webhook_endpoints_insert ON webhook_endpoints FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_endpoints_update ON webhook_endpoints;
CREATE POLICY webhook_endpoints_update ON webhook_endpoints FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_endpoints_delete ON webhook_endpoints;
CREATE POLICY webhook_endpoints_delete ON webhook_endpoints FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Atomic consecutive-failure counter.
--
-- The deliverer records failures through this function rather than a
-- read-modify-write: two deliveries to the same endpoint can run
-- concurrently (e.g. conversation.created + message.received for one
-- inbound message), and a client-side `count = count + 1` would lose
-- increments, so a dead endpoint might never reach the auto-disable
-- threshold. The `+ 1` and the disable decision happen in one UPDATE.
-- Only ever disables (never re-enables) — re-enabling is an explicit
-- PATCH by an admin, which resets the counter.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_webhook_failure(
  endpoint_id uuid,
  max_failures int
)
RETURNS void AS $$
  UPDATE webhook_endpoints
  SET failure_count = failure_count + 1,
      is_active = CASE
        WHEN failure_count + 1 >= max_failures THEN false
        ELSE is_active
      END
  WHERE id = endpoint_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

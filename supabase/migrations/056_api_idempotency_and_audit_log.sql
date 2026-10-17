-- ============================================================
-- 056_api_idempotency_and_audit_log.sql — API-N1 + API-N2
--                                           (Public API v1 audit)
--
-- API-N1 — Idempotency for POST /api/v1/messages and
--          POST /api/v1/broadcasts
--
--   `api_idempotency_keys` stores one row per (account_id,
--   idempotency_key) the caller supplied via the `Idempotency-Key`
--   header. Three SECURITY DEFINER RPCs (called exclusively from the
--   service-role client `requireApiKey()` hands every /api/v1 route —
--   see src/lib/auth/api-context.ts) implement the state machine:
--
--     begin_idempotent_request    — atomically claim the key or report
--                                    what to do about an existing claim
--     complete_idempotent_request — cache the real response on success
--     fail_idempotent_request     — release the claim on failure, so a
--                                    request that never reached Meta
--                                    can be retried with the same key
--
--   Concurrency: `begin_idempotent_request` relies on the UNIQUE
--   constraint below (INSERT ... ON CONFLICT DO NOTHING) to let exactly
--   one concurrent caller "win" and proceed, and a `SELECT ... FOR
--   UPDATE` on the loser's path to serialize against a second, third,
--   etc. loser — the same lock-then-check pattern already used by
--   `insert_inbound_customer_message` (053) for the analogous
--   check-then-act race. Only Postgres guarantees are relied on here;
--   nothing about this is JS-only.
--
--   TTL (~24h): enforced lazily. `begin_idempotent_request` deletes an
--   expired row for the exact key before attempting the claim, so an
--   idempotency key becomes reusable again after `expires_at` without
--   needing a cron/cleanup job. A periodic DELETE WHERE expires_at <
--   now() is still recommended for table bloat, but is not required
--   for correctness — out of scope here (no cron infrastructure was
--   requested for this fix).
--
--   Stale-lock recovery: a `status = 'processing'` row older than 2
--   minutes is treated as abandoned (e.g. the process that owned it
--   crashed between claiming the key and calling complete/fail) and
--   reclaimed by the next caller, rather than permanently blocking
--   that key until the 24h TTL. 2 minutes comfortably exceeds any
--   realistic Meta API round trip.
--
--   Payload-mismatch detection: `request_hash` is a SHA-256 of the
--   endpoint name + a canonicalised (key-sorted) JSON representation of
--   the request body, computed in TypeScript
--   (`src/lib/api/v1/idempotency.ts`) — never the raw body itself, so
--   this table never stores message/contact content. Reusing the same
--   key for a materially different request — including reusing it
--   across the two different endpoints — always fails the hash
--   comparison and is rejected (409), never silently executed twice
--   under an ambiguous meaning.
--
-- API-N2 — Lightweight audit/request log for /api/v1/*
--
--   `api_request_log` — one row per request, written best-effort
--   (fire-and-forget, via `after()`) by a shared wrapper
--   (`withApiKey()` in src/lib/auth/api-context.ts) so every one of
--   the 11 public-API routes is covered uniformly without repeating
--   logging logic per file. Deliberately minimal columns — no request
--   body, no response body, no header values, no message/contact
--   content, ever.
--
-- RLS — both tables are service-role only (no client, human or API
-- key, ever reads/writes them directly): RLS is enabled with zero
-- policies, matching the existing convention for
-- `automation_pending_executions` and similar service-only tables —
-- this means only `service_role` (which bypasses RLS entirely) can
-- touch them at all.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- api_idempotency_keys
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key   text NOT NULL,
  -- Which endpoint this claim belongs to — folded into request_hash
  -- (not the UNIQUE constraint) so reusing a key across endpoints is
  -- simply a hash mismatch, handled by the same 409 path as any other
  -- payload change.
  endpoint          text NOT NULL,
  request_hash      text NOT NULL,
  status            text NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('processing', 'completed')),
  response_status   integer,
  response_body     jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- The actual concurrency/idempotency guarantee — two account-scoped
-- claims of the same key can never both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_idempotency_keys_account_key
  ON api_idempotency_keys (account_id, idempotency_key);

ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only (see header note above).

-- ------------------------------------------------------------
-- begin_idempotent_request(account_id, idempotency_key, endpoint, request_hash)
--
-- Returns exactly one row:
--   outcome = 'proceed'     — caller should perform the real operation
--                              and later call complete/fail
--   outcome = 'replay'      — caller should return cached_status /
--                              cached_body verbatim, without re-running
--                              anything
--   outcome = 'conflict'    — same key, different payload — caller
--                              should reject with 409
--   outcome = 'in_progress' — a live claim on this exact key+payload is
--                              still being processed — caller should
--                              reject with 409 (ask the client to retry
--                              shortly), never proceed
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_idempotent_request(
  p_account_id      uuid,
  p_idempotency_key text,
  p_endpoint        text,
  p_request_hash    text
)
RETURNS TABLE(
  outcome         text,
  cached_status   integer,
  cached_body     jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row api_idempotency_keys%ROWTYPE;
BEGIN
  -- Lazily purge an expired claim for this exact key so it becomes
  -- reusable past its TTL without a cleanup job.
  DELETE FROM api_idempotency_keys
  WHERE account_id = p_account_id
    AND idempotency_key = p_idempotency_key
    AND expires_at < now();

  -- Try to claim it. ON CONFLICT DO NOTHING makes this atomic: exactly
  -- one concurrent caller ever sees a row back here.
  INSERT INTO api_idempotency_keys (
    account_id, idempotency_key, endpoint, request_hash
  ) VALUES (
    p_account_id, p_idempotency_key, p_endpoint, p_request_hash
  )
  ON CONFLICT (account_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT 'proceed'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  -- Someone else already holds (or held) this key. Lock the row so a
  -- concurrent stale-reclaim attempt below serializes against this one
  -- rather than racing it.
  SELECT * INTO v_row FROM api_idempotency_keys
  WHERE account_id = p_account_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  -- Row disappeared between the DELETE/INSERT above and this SELECT
  -- (a concurrent completer's retry deleted it, e.g. a fail() raced
  -- in) — treat as if we'd won the claim.
  IF NOT FOUND THEN
    INSERT INTO api_idempotency_keys (
      account_id, idempotency_key, endpoint, request_hash
    ) VALUES (
      p_account_id, p_idempotency_key, p_endpoint, p_request_hash
    )
    ON CONFLICT (account_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_row;
    IF FOUND THEN
      RETURN QUERY SELECT 'proceed'::text, NULL::integer, NULL::jsonb;
      RETURN;
    END IF;
    -- Extremely unlikely double-race; ask the caller to retry rather
    -- than loop here.
    RETURN QUERY SELECT 'in_progress'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  IF v_row.request_hash <> p_request_hash THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN QUERY SELECT 'replay'::text, v_row.response_status, v_row.response_body;
    RETURN;
  END IF;

  -- status = 'processing'. Reclaim an abandoned attempt (the owning
  -- process crashed before calling complete/fail) rather than blocking
  -- this key until the 24h TTL.
  IF v_row.created_at < now() - interval '2 minutes' THEN
    UPDATE api_idempotency_keys
    SET created_at = now()
    WHERE id = v_row.id AND status = 'processing'
    RETURNING * INTO v_row;
    IF FOUND THEN
      RETURN QUERY SELECT 'proceed'::text, NULL::integer, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT 'in_progress'::text, NULL::integer, NULL::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_idempotent_request(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_idempotent_request(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.begin_idempotent_request(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.begin_idempotent_request(uuid, text, text, text) TO service_role;

-- ------------------------------------------------------------
-- complete_idempotent_request — cache the real response on success.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_idempotent_request(
  p_account_id      uuid,
  p_idempotency_key text,
  p_response_status integer,
  p_response_body   jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE api_idempotency_keys
  SET status = 'completed',
      response_status = p_response_status,
      response_body = p_response_body
  WHERE account_id = p_account_id AND idempotency_key = p_idempotency_key;
$$;

REVOKE ALL ON FUNCTION public.complete_idempotent_request(uuid, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_idempotent_request(uuid, text, integer, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.complete_idempotent_request(uuid, text, integer, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_idempotent_request(uuid, text, integer, jsonb) TO service_role;

-- ------------------------------------------------------------
-- fail_idempotent_request — release the claim so a request that never
-- reached the real operation (validation error, thrown exception, a
-- non-2xx result) can be retried with the same key. Only a genuine
-- SUCCESS gets cached by complete_idempotent_request above; guards
-- against locking a client out after e.g. a typo'd phone number.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_idempotent_request(
  p_account_id      uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM api_idempotency_keys
  WHERE account_id = p_account_id
    AND idempotency_key = p_idempotency_key
    AND status = 'processing';
$$;

REVOKE ALL ON FUNCTION public.fail_idempotent_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_idempotent_request(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fail_idempotent_request(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_idempotent_request(uuid, text) TO service_role;

-- ============================================================
-- Manual validation (run against a live instance — no automated SQL
-- test harness exists in this repo; same caveat as migrations
-- 034/054/055):
--
--   1. Two concurrent `SELECT begin_idempotent_request(...)` calls
--      with the SAME (account_id, idempotency_key, endpoint,
--      request_hash) from two separate sessions, issued at the same
--      time: exactly one must return 'proceed'; the other must return
--      'in_progress' (issue the second call, e.g., from a second psql
--      session, before the first session's transaction commits).
--   2. After the 'proceed' caller runs `complete_idempotent_request`,
--      a THIRD call with the same key must return 'replay' with the
--      cached status/body.
--   3. A call with the same key but a different request_hash must
--      return 'conflict'.
--   4. The same idempotency_key under a DIFFERENT account_id must be
--      completely independent (its own 'proceed').
--   5. After `fail_idempotent_request`, a fresh call with the same key
--      must return 'proceed' again (the row was released).
--   6. Manually back-date a row's `created_at` by more than 2 minutes
--      while `status = 'processing'`: the next call must reclaim it
--      ('proceed'), not return 'in_progress' forever.
-- ============================================================

-- ------------------------------------------------------------
-- api_request_log (API-N2)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_request_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Nullable: a request that failed authentication (bad/missing/
  -- revoked key) never resolves to an account or a key.
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  key_id      uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  method      text NOT NULL,
  path        text NOT NULL,
  status      integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_request_log_account_created
  ON api_request_log (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_key_created
  ON api_request_log (key_id, created_at DESC);

ALTER TABLE api_request_log ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only, written exclusively by
-- withApiKey() (src/lib/auth/api-context.ts). No dashboard route
-- reads this table today; RLS is enabled anyway as the same defense-
-- in-depth default every other table in this schema gets.

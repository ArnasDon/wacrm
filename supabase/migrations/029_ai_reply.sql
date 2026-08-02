-- ============================================================
-- 029_ai_reply.sql — AI reply assistant (bring-your-own-key)
--
-- Adds the account-level config for the AI reply assistant plus the
-- two per-conversation columns the auto-reply bot needs to stay
-- bounded.
--
-- Design notes
--   - `ai_configs` is account-scoped and UNIQUE(account_id) — one AI
--     setup per workspace, exactly like `whatsapp_config`. Teammates
--     inside an account share it.
--   - `api_key` is the caller's own OpenAI / Anthropic key. We call
--     the provider *with* it on every draft/auto-reply, so we need the
--     plaintext at call time — stored AES-256-GCM-encrypted at rest
--     (same `encrypt()`/`decrypt()` as `whatsapp_config.access_token`
--     and `webhook_endpoints.secret`) and never returned to the client
--     after save (the settings UI shows a masked placeholder).
--   - `created_by` records who saved it (audit); ON DELETE SET NULL so
--     removing a teammate doesn't drop the workspace's AI config.
--   - `is_active` is the master switch (draft + auto-reply both off
--     when false). `auto_reply_enabled` gates only the inbound bot;
--     `auto_reply_max_per_conversation` caps how many times the bot
--     will answer one thread before going quiet (prevents runaway
--     loops / bill blowout on a chatty customer).
--
--   - `conversations.ai_autoreply_disabled` — set true when the model
--     signals a human handoff, or when someone turns the bot off for
--     that one thread. Sticky: once a conversation is handed off it
--     stays off until explicitly re-enabled.
--   - `conversations.ai_reply_count` — running count of bot auto-
--     replies in the thread, checked against
--     `auto_reply_max_per_conversation`.
--
-- RLS
--   Settings-class, mirroring `whatsapp_config` / `webhook_endpoints`:
--   any member (viewer+) may read the config — the inbox draft button
--   needs to know whether AI is on — but only admin+ may create /
--   update / delete it. The auto-reply path runs under the service-role
--   client (a webhook has no `auth.uid()`), so RLS guards dashboard
--   reads, not the engine.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_configs (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                        uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by                        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider                          text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model                             text NOT NULL,
  api_key                           text NOT NULL,            -- AES-256-GCM-encrypted BYO provider key
  system_prompt                     text,                     -- business context / persona / tone
  is_active                         boolean NOT NULL DEFAULT false,
  auto_reply_enabled                boolean NOT NULL DEFAULT false,
  auto_reply_max_per_conversation   integer NOT NULL DEFAULT 3
                                      CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 20),
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the config so
-- the inbox knows whether the "Draft with AI" affordance is live.
DROP POLICY IF EXISTS ai_configs_select ON ai_configs;
CREATE POLICY ai_configs_select ON ai_configs FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS ai_configs_insert ON ai_configs;
CREATE POLICY ai_configs_insert ON ai_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_configs_update ON ai_configs;
CREATE POLICY ai_configs_update ON ai_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_configs_delete ON ai_configs;
CREATE POLICY ai_configs_delete ON ai_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.update_ai_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_configs_updated_at ON ai_configs;
CREATE TRIGGER ai_configs_updated_at
  BEFORE UPDATE ON ai_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_configs_updated_at();

-- ============================================================
-- Per-conversation auto-reply control.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_autoreply_disabled boolean NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_reply_count integer NOT NULL DEFAULT 0;

-- ============================================================
-- Atomic auto-reply slot claim.
--
-- The bot claims a reply slot through this function rather than a
-- read-then-write from the app: two inbound messages on one
-- conversation can be processed concurrently, and a client-side
-- "read count, check < cap, then increment" would let both pass the
-- check and overshoot the per-conversation cap. Here the cap check and
-- the `+ 1` happen in a single UPDATE, so exactly `max_replies` slots
-- can ever be claimed. Returns true when a slot was claimed (the caller
-- may send), false when the cap is already reached (skip).
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- The auto-reply bot claims slots under the service-role client (the
-- inbound webhook has no auth.uid()), so it needs EXECUTE. SECURITY
-- DEFINER alone is not enough — it sets the privileges the function runs
-- *with*, not who may call it. Without this grant the RPC fails with
-- permission-denied on instances where the default PUBLIC execute
-- privilege has been revoked (hardened / self-hosted Supabase), and the
-- bot silently never replies. Only the service role claims slots, so we
-- grant to it alone (mirrors 007 / 012). See migration 031 / issue #345.
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;

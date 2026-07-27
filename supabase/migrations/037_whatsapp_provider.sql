-- ============================================================
-- whatsapp_config: add a second provider (uazapi, QR-pairing)
--
-- Until now every whatsapp_config row was implicitly "Meta Cloud
-- API" — phone_number_id + waba_id + access_token, business-verified
-- number, no QR code. This migration adds a `provider` discriminator
-- and a parallel set of nullable columns for uazapi, an unofficial
-- API that pairs a personal WhatsApp number via QR code scan.
--
-- Credential model: uazapi is operated in "reseller" mode — this
-- wacrm deployment holds ONE uazapi admin subscription
-- (UAZAPI_ADMIN_TOKEN / UAZAPI_BASE_URL, server-side env vars only,
-- never persisted here) and creates one uazapi "instance" per
-- account on connect. Only the per-instance token (uazapi_token)
-- lives in this table, encrypted the same way access_token already
-- is (see src/lib/whatsapp/encryption.ts).
--
-- Why two full sets of columns instead of one generic JSONB blob:
-- the Meta columns are already typed, indexed (phone_number_id
-- UNIQUE, migration 013), and read by a lot of existing code
-- (webhook routing, registration flow). Rewriting that to a JSONB
-- shape would touch every one of those call sites for no benefit —
-- additive nullable columns is the lower-risk move for an
-- already-in-production table.
--
-- Mutual exclusivity: a row is either fully Meta-shaped or fully
-- uazapi-shaped, never both. This matters because Settings lets a
-- user switch providers on an existing account (forcing an explicit
-- disconnect of the old one first) — the CHECK constraint below is
-- the DB-level backstop against ending up with two live sets of
-- credentials, or a hybrid row nothing can route correctly.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Provider discriminator. Existing rows default to 'meta', which
--    matches their actual (only) provider today.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi'));

-- 2. Relax the Meta-only columns so a uazapi row can leave them
--    NULL. Every existing row already has both populated (they were
--    NOT NULL until now), so this is a pure loosening — no backfill
--    needed, no existing row is affected.
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token    DROP NOT NULL;

-- 3. uazapi-only columns, all nullable.
--    uazapi_status is deliberately separate from the existing
--    generic `status` column (connected|disconnected) — uazapi has
--    a richer state machine (disconnected/connecting/connected/
--    hibernated per its own API) and reusing `status` would either
--    lose that nuance or require widening its CHECK in a way that's
--    meaningless for Meta rows.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_token TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_status TEXT
    CHECK (uazapi_status IN ('disconnected', 'connecting', 'connected', 'hibernated')),
  ADD COLUMN IF NOT EXISTS uazapi_paired_phone TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_connected_at TIMESTAMPTZ,
  -- Embedded in the inbound webhook URL path
  -- (/api/uazapi/webhook/[accountId]/[secret]) as a stand-in for the
  -- HMAC signature Meta provides and uazapi does not. Encrypted at
  -- rest with the same encrypt()/decrypt() as access_token /
  -- verify_token, for the same reason: a DB leak shouldn't hand out
  -- a live webhook URL for free.
  ADD COLUMN IF NOT EXISTS uazapi_webhook_secret TEXT;

-- 4. One uazapi instance maps to exactly one account, mirroring the
--    UNIQUE(phone_number_id) precedent from migration 013 — the
--    uazapi webhook route will look up the owning account by
--    uazapi_instance_id the same way the Meta webhook looks up by
--    phone_number_id. Multiple NULLs (every Meta row) are allowed
--    under a UNIQUE constraint, so this doesn't affect existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_uazapi_instance_id_key'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_uazapi_instance_id_key
      UNIQUE (uazapi_instance_id);
  END IF;
END $$;

-- 5. Mutual exclusivity: a 'meta' row must have its Meta columns
--    populated and its uazapi columns empty; a 'uazapi' row the
--    exact opposite. Every existing row is 'meta' with
--    phone_number_id/access_token already populated (they were
--    NOT NULL until step 2) and the new uazapi_* columns default to
--    NULL, so this constraint is satisfied by all current data with
--    no backfill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_provider_columns_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_columns_check
      CHECK (
        (
          provider = 'meta'
          AND phone_number_id IS NOT NULL
          AND access_token IS NOT NULL
          AND uazapi_instance_id IS NULL
          AND uazapi_token IS NULL
        )
        OR (
          provider = 'uazapi'
          AND uazapi_instance_id IS NOT NULL
          AND uazapi_token IS NOT NULL
          AND phone_number_id IS NULL
          AND access_token IS NULL
        )
      );
  END IF;
END $$;

-- No RLS changes needed — whatsapp_config_select/insert/update/delete
-- (migration 017) already gate on is_account_member(account_id[, 'admin']),
-- which covers these new columns for free.

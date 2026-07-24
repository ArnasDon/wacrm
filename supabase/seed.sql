-- ============================================================
-- LOCAL DEVELOPMENT SEED — never runs against production
--
-- `supabase start` / `supabase db reset` applies this after the
-- migrations. Production is migrated by hand in the Supabase Cloud
-- SQL editor and never sees this file.
--
-- Two jobs:
--   1. Grant the API roles access to the tables the migrations create
--      (Supabase Cloud does this in its own bootstrap; a local stack
--      does not, so without it every service-role query fails with
--      "permission denied for table ...").
--   2. Seed the minimum fixture the inbound webhook needs to resolve
--      tenancy — an account, its profile, and a connected WhatsApp
--      number — so scripts/dev/simulate-inbound.mjs works right after
--      a reset.
-- ============================================================

-- ============================================================
-- 1. API ROLE GRANTS
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Anything created later in this session inherits the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- RLS still applies to anon/authenticated; only service_role bypasses
-- it. These grants restore the table-level privileges RLS builds on,
-- they do not weaken any policy.

-- ============================================================
-- 2. DEV FIXTURE
--
-- The auth user is a bare row with no usable password: it exists so
-- the account/profile trigger fires and the FKs resolve. To sign in
-- through the UI, register normally at /login — that creates your own
-- account alongside this one.
-- ============================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'dev@local.test',
  '', NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- The account and profile are created by the new-user trigger; just
-- give them recognisable values.
UPDATE accounts SET name = 'Cuenta de prueba', default_currency = 'PEN'
WHERE owner_user_id = '11111111-1111-1111-1111-111111111111';

UPDATE profiles SET full_name = 'Dev Local'
WHERE user_id = '11111111-1111-1111-1111-111111111111';

-- Connected WhatsApp number. `phone_number_id` is what
-- simulate-inbound.mjs passes as --phone-number-id.
--
-- access_token is the string 'DEV_FAKE_TOKEN' encrypted (AES-GCM)
-- under the fixed local dev key below. The webhook decrypts it
-- eagerly, so it has to be real ciphertext — but it is never sent
-- anywhere, since no local test calls Meta.
--
--   ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
--
-- Use exactly that key in .env.local for local development. (In
-- production the key is a real secret and this row does not exist.)
INSERT INTO whatsapp_config (
  user_id, account_id, phone_number_id, waba_id, access_token, status
)
SELECT
  '11111111-1111-1111-1111-111111111111',
  a.id,
  '999888777',
  'WABA_TEST',
  '070707070707070707070707:6f9fac071a9bbe264ee118b8d2ff:2a79c2a52a59fdd9e64e0ccb8227e5cd',
  'connected'
FROM accounts a
WHERE a.owner_user_id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT (phone_number_id) DO NOTHING;

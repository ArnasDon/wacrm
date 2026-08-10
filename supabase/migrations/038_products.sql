-- ============================================================
-- 038_products.sql — Products & digital commerce
--
-- Sells digital / physical products over WhatsApp:
--
--   1. A prospect sends a keyword -> the automation `send_product`
--      step (migration 006's automations engine) creates a pending
--      `product_orders` row and WhatsApps them the product details
--      plus a payment link, with an order reference
--      (`wacrm_<order-id>`) embedded in the message.
--
--   2. The payment gateway calls the generic, provider-agnostic
--      webhook (`/api/payments/webhook?account_id=…`) with that
--      `payment_reference`. Fulfillment flips the order to `paid`
--      and WhatsApps the buyer a confirmation + download link
--      (digital products) or a shipping confirmation (physical).
--
--   3. Fallback: an admin marks the order Paid manually in the
--      Products -> Orders view (the webhook is optional).
--
-- New tables
-- ----------
--   products          catalog rows: price, currency, payment link,
--                     and the file for digital fulfilment
--   product_orders    per-buyer orders; `payment_reference` is the
--                     idempotency key the webhook echoes back
--   payment_settings  one row per account holding the webhook
--                     secret. The plaintext secret NEVER lives here —
--                     the app layer stores AES-256-GCM ciphertext
--                     (same as whatsapp_config.access_token) plus a
--                     display prefix for the Settings UI.
--
-- New storage bucket
-- ------------------
--   product-files     PRIVATE bucket for digital product files.
--                     Fulfilment hands paid buyers short-lived
--                     signed URLs; the objects are never public.
--                     Path convention (same as flow-media/chat-media):
--                       product-files/account-<account_id>/<timestamp>-<name>.<ext>
--
-- RLS
-- ---
--   products / product_orders / payment_settings follow the
--   migration 017 account-membership pattern: members read,
--   agents+ manage products, admins+ manage orders' payment state
--   and the payment settings (both are settings-class actions).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Tenancy: every product belongs to one account.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Audit / creator only — never consulted for tenancy (post-017).
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  -- Whole-unit price like deals; formatted with the account currency.
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- ISO-4217 3-letter code; same format constraint as accounts.default_currency.
  currency TEXT NOT NULL DEFAULT 'USD',
  kind TEXT NOT NULL DEFAULT 'digital',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Merchant-provided checkout URL, sent to the buyer at order time.
  payment_link TEXT,
  -- Digital fulfilment. file_path is the storage object path inside
  -- the private `product-files` bucket (account-scoped). The remaining
  -- columns are display metadata only.
  file_path TEXT,
  file_name TEXT,
  file_size_bytes BIGINT,
  file_mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_kind_check CHECK (kind IN ('digital', 'physical')),
  CONSTRAINT products_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT products_price_nonnegative CHECK (price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_account_id ON products (account_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Products are readable by account members" ON products;
CREATE POLICY "Products are readable by account members"
  ON products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Agents can create products" ON products;
CREATE POLICY "Agents can create products"
  ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents can update products" ON products;
CREATE POLICY "Agents can update products"
  ON products FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Agents can delete products" ON products;

-- ============================================================
-- 2. product_orders
--
-- Orders are created by the automations engine (service role). The
-- client-side INSERT policy exists for future API/UI paths and stays
-- agent+ to match the rest of operational data; UPDATE is admin+
-- because flipping payment state is a settings-class action.
-- ============================================================
CREATE TABLE IF NOT EXISTS product_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Automation author / admin who created or fulfilled the order. Audit only.
  user_id UUID NOT NULL REFERENCES auth.users(id),
  -- RESTRICT (not CASCADE): an order is a financial record and must
  -- survive the product being deleted. The app snapshot-copies the
  -- display fields below so a deleted product doesn't leave a blank row.
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  -- Both nullable: a contact could be deleted (SET NULL) and the
  -- conversation id is absent on manually-created orders.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- Idempotency key for webhook callbacks: `wacrm_<order-id>`. The
  -- unique partial index turns a gateway replay into a no-op.
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Snapshot of the product at purchase time, so the order row stays
  -- self-contained for display and fulfilment even if the product
  -- row changes later.
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  -- 'manual' for the Mark-as-Paid fallback, or whatever gateway name
  -- the webhook callback carries (stripe, paypal, razorpay, ...).
  payment_provider TEXT,
  paid_at TIMESTAMPTZ,
  -- Free-form gateway payload snapshot (transaction ids, event shape)
  -- for auditability. Kept opaque — the app never depends on it.
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_orders_status_check
    CHECK (status IN ('pending', 'paid', 'cancelled', 'failed')),
  CONSTRAINT product_orders_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS idx_product_orders_account_id ON product_orders (account_id);
CREATE INDEX IF NOT EXISTS idx_product_orders_product_id ON product_orders (product_id);
CREATE INDEX IF NOT EXISTS idx_product_orders_status ON product_orders (status);
-- Partial (not plain) on purpose: payment_reference is NULL until an
-- order is created through a flow that stamps one, and Postgres treats
-- NULLs as distinct in a unique index anyway.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_orders_payment_reference
  ON product_orders (payment_reference)
  WHERE payment_reference IS NOT NULL;

ALTER TABLE product_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Orders are readable by account members" ON product_orders;
CREATE POLICY "Orders are readable by account members"
  ON product_orders FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Agents can create orders" ON product_orders;
CREATE POLICY "Agents can create orders"
  ON product_orders FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Admins+ own payment state (mark paid / cancel). The engine and
-- webhook write via the service role, which bypasses RLS anyway.
DROP POLICY IF EXISTS "Admins can update orders" ON product_orders;
CREATE POLICY "Admins can update orders"
  ON product_orders FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Admins can delete orders" ON product_orders;
CREATE POLICY "Admins can delete orders"
  ON product_orders FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE POLICY "Agents can delete products"
  ON products FOR DELETE
  USING (is_account_member(account_id, 'agent'));


-- ============================================================
-- 3. payment_settings — one row per account.
--
-- `webhook_secret` holds ciphertext produced by the app's encryption
-- module (@/lib/whatsapp/encryption, AES-256-GCM); the plaintext is
-- shown exactly once at generation time. `webhook_secret_prefix` is
-- a safe display fragment (e.g. "sk_wacrm_ab12…") for the UI.
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  webhook_secret TEXT NOT NULL DEFAULT '',
  webhook_secret_prefix TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Payment settings are readable by account members" ON payment_settings;
CREATE POLICY "Payment settings are readable by account members"
  ON payment_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage payment settings" ON payment_settings;
CREATE POLICY "Admins can manage payment settings"
  ON payment_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 4. product-files storage bucket (PRIVATE)
--
-- Writes follow the same account-scoped path convention as the
-- public flow-media/chat-media buckets; reads are member-only
-- because product files are never meant to be public — fulfilment
-- hands buyers short-lived signed URLs instead. Bucket is private
-- (`public = FALSE`), so even the path convention can't be fetched
-- anonymously.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-files',
  'product-files',
  FALSE,
  52428800, -- 50 MB — Supabase's default object cap; digital goods (PDFs, zips, mp4 courses) fit.
  ARRAY[
    'application/pdf',
    'application/zip',
    'application/octet-stream',
    'text/plain',
    'text/csv',
    -- Office docs
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- Images / video / audio
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Product files are readable by account members" ON storage.objects;
CREATE POLICY "Product files are readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Agents can upload product files" ON storage.objects;
CREATE POLICY "Agents can upload product files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin', 'agent')
    )
  );

DROP POLICY IF EXISTS "Agents can update product files" ON storage.objects;
CREATE POLICY "Agents can update product files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin', 'agent')
    )
  );

DROP POLICY IF EXISTS "Agents can delete product files" ON storage.objects;
CREATE POLICY "Agents can delete product files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND p.account_role IN ('owner', 'admin', 'agent')
    )
  );

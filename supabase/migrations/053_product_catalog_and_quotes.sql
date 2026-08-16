-- ============================================================
-- 053_product_catalog_and_quotes.sql
--
-- Catálogo de productos + Cotizaciones (Chat Sandía). Nuevo dominio
-- "commerce" mínimo: precio/información de producto (sin inventario,
-- sin categorías/variantes — fuera de alcance por decisión explícita),
-- y cotizaciones que combinan el catálogo con datos del cliente
-- (NIT/correo/celular/dirección), vinculadas automáticamente a un
-- negocio (deal) del pipeline.
--
-- Mismo patrón de tenancy que el resto del esquema: `account_id` propio
-- por tabla (no solo vía FK, para RLS directa — igual que `deals`),
-- lectura abierta a cualquier miembro, escritura agent+
-- (`is_account_member(account_id, 'agent')`, mismo lenguaje que
-- `quick_replies_*` en la migración 035).
--
-- Idempotente — seguro de volver a correr.
-- ============================================================

-- ============================================================
-- 1. products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- creador, solo auditoría
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_account ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_account_active ON products(account_id) WHERE is_active = TRUE;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_select ON products;
DROP POLICY IF EXISTS products_insert ON products;
DROP POLICY IF EXISTS products_update ON products;
DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_select ON products FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY products_delete ON products FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. quotes
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- creador (humano o dueño de la config de IA), auditoría
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  -- Datos del cliente requeridos para la cotización — snapshot propio,
  -- no en `contacts` (que hoy no tiene NIT/dirección y no todo contacto
  -- necesita esta información fuera de una cotización puntual).
  customer_nit TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  pdf_url TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_account ON quotes(account_id);
CREATE INDEX IF NOT EXISTS idx_quotes_contact ON quotes(contact_id);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotes_select ON quotes;
DROP POLICY IF EXISTS quotes_insert ON quotes;
DROP POLICY IF EXISTS quotes_update ON quotes;
DROP POLICY IF EXISTS quotes_delete ON quotes;
CREATE POLICY quotes_select ON quotes FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY quotes_insert ON quotes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY quotes_update ON quotes FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY quotes_delete ON quotes FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON quotes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. quote_items
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  -- NULL = ítem libre (solo un humano puede crear uno — validado
  -- app-side en src/lib/quotes/create-quote.ts, nunca la IA).
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL, -- snapshot del nombre del producto, o texto libre
  unit_price NUMERIC(12,2) NOT NULL, -- snapshot — releído de `products` en el momento de crear la cotización
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_items_select ON quote_items;
DROP POLICY IF EXISTS quote_items_insert ON quote_items;
DROP POLICY IF EXISTS quote_items_update ON quote_items;
DROP POLICY IF EXISTS quote_items_delete ON quote_items;
CREATE POLICY quote_items_select ON quote_items FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY quote_items_insert ON quote_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY quote_items_update ON quote_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
CREATE POLICY quote_items_delete ON quote_items FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- 4. ai_action_log — extiende el CHECK con la nueva acción `create_quote`
-- ============================================================
ALTER TABLE public.ai_action_log DROP CONSTRAINT IF EXISTS ai_action_log_action_check;
ALTER TABLE public.ai_action_log ADD CONSTRAINT ai_action_log_action_check
  CHECK (action IN ('close_conversation', 'mark_deal_won', 'move_deal', 'set_lead_temperature', 'create_quote'));

-- ============================================================
-- 5. Storage buckets
--
-- Mismo patrón exacto que `chat-media` (migración 023): bucket público
-- (para que Meta/Zernio puedan descargar el archivo sin autenticación)
-- + RLS por prefijo de path `account-<account_id>`.
-- ============================================================

-- 5a. product-media — imágenes de producto, sube el cliente (mismo
--     flujo que uploadAccountMedia ya usa para chat-media).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-media',
  'product-media',
  TRUE,
  5242880, -- 5 MB, igual que MEDIA_MAX_BYTES_BY_KIND.image
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Product media is publicly readable" ON storage.objects;
CREATE POLICY "Product media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "Members can upload product media" ON storage.objects;
CREATE POLICY "Members can upload product media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update product media" ON storage.objects;
CREATE POLICY "Members can update product media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete product media" ON storage.objects;
CREATE POLICY "Members can delete product media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- 5b. catalog-documents — PDFs generados server-side (cotización o
--     catálogo completo). Solo el service role escribe aquí (las rutas
--     de generación de PDF usan el cliente admin) — a propósito NO se
--     agregan políticas de INSERT/UPDATE/DELETE para `authenticated`,
--     mismo patrón ya aceptado en el proyecto para tablas de
--     escritura exclusiva por service_role (ver advisory
--     `rls_enabled_no_policy` en `automation_pending_executions`/
--     `rate_limit_buckets`). Solo lectura pública (para que Meta/Zernio
--     puedan descargar el PDF al enviarlo).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalog-documents',
  'catalog-documents',
  TRUE,
  10485760, -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Catalog documents are publicly readable" ON storage.objects;
CREATE POLICY "Catalog documents are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'catalog-documents');

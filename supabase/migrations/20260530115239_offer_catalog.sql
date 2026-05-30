CREATE TABLE IF NOT EXISTS public.offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  price_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  benefits TEXT[] NOT NULL DEFAULT '{}',
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  requirements TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_user_active
  ON public.offers(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_offers_category
  ON public.offers(user_id, category);

CREATE INDEX IF NOT EXISTS idx_offers_provider
  ON public.offers(user_id, provider);

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO authenticated;

DROP POLICY IF EXISTS "Users can manage own offers"
  ON public.offers;

CREATE POLICY "Users can manage own offers"
  ON public.offers
  FOR ALL
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.offers;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

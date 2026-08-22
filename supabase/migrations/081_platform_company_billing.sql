-- Editable subscription charge per company for the platform operator.
-- Additive only: existing billing dates, payment history and suspension
-- behavior remain unchanged.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS subscription_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS subscription_currency TEXT NOT NULL DEFAULT 'GTQ';

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_subscription_amount_check,
  ADD CONSTRAINT accounts_subscription_amount_check
    CHECK (subscription_amount IS NULL OR subscription_amount >= 0);

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_subscription_currency_check,
  ADD CONSTRAINT accounts_subscription_currency_check
    CHECK (subscription_currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN public.accounts.subscription_amount IS
  'Editable recurring amount charged to this company. NULL means not configured.';
COMMENT ON COLUMN public.accounts.subscription_currency IS
  'ISO-4217 currency for subscription_amount, managed by the platform operator.';

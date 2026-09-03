-- ============================================================
-- 040_default_currency_lkr
--
-- Make LKR (Sri Lankan Rupee) the out-of-the-box default currency.
--
-- Migration 021 made the deal currency configurable per account but
-- kept 'USD' as the column default, and `deals.currency` has carried
-- a static 'USD' default since 001. The app now ships with LKR as
-- DEFAULT_CURRENCY and as the first picker option, so the DB
-- defaults are moved to match — otherwise a freshly created account
-- would still land on USD and disagree with the UI.
--
-- Scope: DEFAULTS ONLY. Existing rows are deliberately left alone —
-- an account already tracking deals in USD (or any other currency)
-- keeps its setting, and historical `deals.currency` values stay
-- verbatim. Changing them would silently relabel recorded money.
-- Accounts that want LKR can switch in Settings → Deals.
--
-- The `accounts_default_currency_format` CHECK from 021 still
-- applies ('^[A-Z]{3}$') and 'LKR' satisfies it, so no constraint
-- work is needed.
--
-- RLS: no change. This touches column defaults only.
-- ============================================================

ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'LKR';

ALTER TABLE deals
  ALTER COLUMN currency SET DEFAULT 'LKR';

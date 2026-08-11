-- usd_to_mzn_rate (added in 20260811090000) becomes a cache of the
-- automatically-fetched BCI rate (https://www.bci.co.mz/cambio/)
-- instead of a hand-typed value — this column tracks when it was last
-- refreshed so src/lib/ai/exchange-rate.ts knows whether to trust the
-- cache or fetch again.

alter table wacrm.ai_configs
  add column if not exists usd_to_mzn_rate_updated_at timestamptz;

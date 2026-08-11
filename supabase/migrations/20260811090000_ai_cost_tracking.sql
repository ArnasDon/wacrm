-- USD->MZN conversion rate for the token-spend dashboard, editable per
-- account since forex moves and the account owner should be able to
-- correct it without a code deploy. Actual USD cost is computed at
-- display time from provider pricing (src/lib/ai/pricing.ts) x the
-- existing prompt/completion token counts already in ai_usage_log — no
-- new columns needed there.

alter table wacrm.ai_configs
  add column if not exists usd_to_mzn_rate numeric(10, 4) not null default 63.91
  check (usd_to_mzn_rate > 0);

comment on column wacrm.ai_configs.usd_to_mzn_rate is
  'USD-to-MZN rate used to show AI token spend in Metical. Editable in Settings; not fetched live.';

-- ============================================================
-- 043_lulu_engagement_foundation.sql — LuLu Customer Engagement
--
-- Adds the LuLu-specific decision layer (PRD §90) WITHOUT touching
-- any WACRM core table. All objects are prefixed `lulu_` so they are
-- trivially separable from upstream and merge cleanly.
--
-- System-of-record rule (PRD §4):
--   BigQuery owns ecommerce truth (orders, RFM, LTV). `lulu_customer_profiles`
--   is a *synced read-model* of only the fields the CRM needs (PRD §86-87).
--   WACRM owns communication truth. These tables own decision truth:
--   campaigns, offers, contact policy, action queue, campaign events.
--
-- RLS mirrors 026_api_keys: any account member may read; admin+ may
-- write config. The engagement service uses the service-role client
-- (RLS-bypassing) for queue/event writes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---------- customer profiles (synced from BigQuery) ----------
CREATE TABLE IF NOT EXISTS lulu_customer_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  customer_id         text NOT NULL,              -- LuLu / BigQuery customer id
  loyalty_id          text,
  mobile              text NOT NULL,
  name                text,
  language            text NOT NULL DEFAULT 'ar', -- 'ar' | 'en' | ...
  birthday            date,
  first_order_date    date,
  last_order_date     date,
  total_orders        integer NOT NULL DEFAULT 0,
  total_sales         numeric(14,2) NOT NULL DEFAULT 0,
  average_order_value numeric(12,2) NOT NULL DEFAULT 0,
  orders_30d          integer NOT NULL DEFAULT 0,
  orders_90d          integer NOT NULL DEFAULT 0,
  median_interval_days numeric(8,2),              -- personal purchase cycle (PRD §66)
  stddev_interval_days numeric(8,2),
  preferred_store     text,
  preferred_category  text,
  preferred_send_dow  smallint,                   -- 0=Sun..6=Sat (phase 2)
  preferred_send_hour smallint,
  customer_segment    text,                       -- RFM label: Champions, Loyal...
  lifecycle_stage     text,                       -- NEW|FIRST_ORDER|ACTIVE|AT_RISK|DORMANT|LOST
  rfm_recency         smallint,
  rfm_frequency       smallint,
  rfm_monetary        smallint,
  lifetime_value      numeric(14,2) NOT NULL DEFAULT 0,
  vip_flag            boolean NOT NULL DEFAULT false,
  marketing_opt_in    boolean NOT NULL DEFAULT true,
  active_complaint    boolean NOT NULL DEFAULT false,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, customer_id)
);
CREATE INDEX IF NOT EXISTS lulu_cp_account_stage_idx ON lulu_customer_profiles (account_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS lulu_cp_mobile_idx ON lulu_customer_profiles (account_id, mobile);
CREATE INDEX IF NOT EXISTS lulu_cp_contact_idx ON lulu_customer_profiles (contact_id);

-- ---------- offers (PRD §53) ----------
CREATE TABLE IF NOT EXISTS lulu_offers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  offer_code           text NOT NULL,
  name                 text NOT NULL,
  offer_type           text NOT NULL CHECK (offer_type IN ('FREE_DELIVERY','FIXED_VOUCHER','PERCENT_DISCOUNT','CATEGORY_DISCOUNT','NONE')),
  value                numeric(12,2) NOT NULL DEFAULT 0,
  minimum_order        numeric(12,2) NOT NULL DEFAULT 0,
  maximum_discount     numeric(12,2),
  start_date           date,
  end_date             date,
  eligible_segments    text[] NOT NULL DEFAULT '{}',
  eligible_categories  text[] NOT NULL DEFAULT '{}',
  eligible_stores      text[] NOT NULL DEFAULT '{}',
  usage_limit          integer,
  customer_usage_limit integer NOT NULL DEFAULT 1,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, offer_code)
);

-- ---------- campaigns (PRD §32) ----------
CREATE TABLE IF NOT EXISTS lulu_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_code    text NOT NULL,                 -- e.g. WINBACK_30
  name             text NOT NULL,
  campaign_type    text NOT NULL,                 -- see src/lib/lulu/types.ts CampaignType
  description      text,
  trigger_type     text NOT NULL DEFAULT 'RULE',  -- RULE | EVENT | MANUAL
  rule_params      jsonb NOT NULL DEFAULT '{}',   -- thresholds etc. (configurable, PRD §100)
  template_name_ar text,
  template_name_en text,
  offer_id         uuid REFERENCES lulu_offers(id) ON DELETE SET NULL,
  priority         integer NOT NULL DEFAULT 50,   -- lower = more important
  frequency_limit  jsonb NOT NULL DEFAULT '{}',
  budget_sar       numeric(14,2),
  budget_used_sar  numeric(14,2) NOT NULL DEFAULT 0,
  start_date       date,
  end_date         date,
  status           text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','REVIEW','APPROVED','SCHEDULED','RUNNING','PAUSED','COMPLETED','REJECTED','CANCELLED')),
  mode             text NOT NULL DEFAULT 'DRY_RUN' CHECK (mode IN ('DRY_RUN','TEST','LIVE')),
  test_phones      text[] NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, campaign_code)
);

-- ---------- contact policy (PRD §55, §82) — one row per account ----------
CREATE TABLE IF NOT EXISTS lulu_contact_policy (
  account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  max_promo_per_window    integer NOT NULL DEFAULT 3,
  promo_window_days       integer NOT NULL DEFAULT 7,
  max_marketing_per_window integer NOT NULL DEFAULT 5,
  marketing_window_days   integer NOT NULL DEFAULT 14,
  suppress_after_order_hours integer NOT NULL DEFAULT 24,
  quiet_hours_start       smallint NOT NULL DEFAULT 22,  -- local hour
  quiet_hours_end         smallint NOT NULL DEFAULT 9,
  timezone                text NOT NULL DEFAULT 'Asia/Riyadh',
  priority_order          text[] NOT NULL DEFAULT ARRAY['SERVICE_RECOVERY','BIRTHDAY','ORDER_COMMUNICATION','VIP','WINBACK','PERSONALIZED_OFFER','GENERAL_PROMOTION'],
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------- action queue (PRD §68-69) ----------
CREATE TABLE IF NOT EXISTS lulu_customer_next_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  customer_id      text NOT NULL,
  profile_id       uuid REFERENCES lulu_customer_profiles(id) ON DELETE CASCADE,
  campaign_id      uuid REFERENCES lulu_campaigns(id) ON DELETE SET NULL,
  offer_id         uuid REFERENCES lulu_offers(id) ON DELETE SET NULL,
  action_type      text NOT NULL,
  reason           text,
  language         text NOT NULL DEFAULT 'ar',
  priority         integer NOT NULL DEFAULT 50,
  idempotency_key  text NOT NULL,                  -- e.g. WINBACK30_20260924_CUSTOMER12345 (PRD §73)
  scheduled_at     timestamptz,
  status           text NOT NULL DEFAULT 'READY'
                   CHECK (status IN ('READY','SCHEDULED','SENT','SKIPPED','CANCELLED','FAILED')),
  skip_reason      text,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  UNIQUE (account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS lulu_nba_due_idx ON lulu_customer_next_actions (account_id, status, scheduled_at);

-- ---------- campaign events / log (PRD §58) ----------
CREATE TABLE IF NOT EXISTS lulu_campaign_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  action_id       uuid REFERENCES lulu_customer_next_actions(id) ON DELETE SET NULL,
  campaign_id     uuid REFERENCES lulu_campaigns(id) ON DELETE SET NULL,
  customer_id     text NOT NULL,
  offer_id        uuid REFERENCES lulu_offers(id) ON DELETE SET NULL,
  wa_message_id   text,
  event_type      text NOT NULL CHECK (event_type IN ('SENT','DELIVERED','READ','CLICKED','REPLIED','FAILED','OPT_OUT','ORDER_ATTRIBUTED')),
  order_id        text,
  order_value     numeric(14,2),
  discount_cost   numeric(14,2),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS lulu_ce_campaign_idx ON lulu_campaign_events (account_id, campaign_id, event_type);
CREATE INDEX IF NOT EXISTS lulu_ce_customer_idx ON lulu_campaign_events (account_id, customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS lulu_ce_wamid_idx ON lulu_campaign_events (wa_message_id);

-- ---------- sync log (PRD §86) ----------
CREATE TABLE IF NOT EXISTS lulu_customer_sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_received integer NOT NULL DEFAULT 0,
  rows_upserted integer NOT NULL DEFAULT 0,
  rows_failed   integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','OK','PARTIAL','FAILED')),
  error         text
);

-- ---------- RLS ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lulu_customer_profiles','lulu_offers','lulu_campaigns','lulu_contact_policy',
    'lulu_customer_next_actions','lulu_campaign_events','lulu_customer_sync_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (is_account_member(account_id))', t || '_select', t);
  END LOOP;

  -- Config tables: admin+ may write. Queue/events/profiles/sync are
  -- written by the engagement service (service role) only.
  FOREACH t IN ARRAY ARRAY['lulu_offers','lulu_campaigns','lulu_contact_policy'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (is_account_member(account_id, ''admin'')) WITH CHECK (is_account_member(account_id, ''admin''))', t || '_write', t);
  END LOOP;
END $$;

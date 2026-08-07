-- ============================================================
-- 037_eter_agent.sql — EterWA agent: calendar + lead qualification
--
-- Foundation for the EterWA vertical (Eter Growth fork of wacrm):
-- a WhatsApp agent that qualifies leads and books meetings directly
-- on the account's Google Calendar. This migration adds no business
-- logic — just the tables the tool-calling layer (src/lib/ai/tools)
-- and the calendar engine (src/lib/calendar) will read/write.
--
-- Design notes
--   - `calendar_configs` is account-scoped and UNIQUE(account_id) —
--     one calendar connection per workspace, exactly like
--     `ai_configs` / `whatsapp_config`. `refresh_token` is the
--     Google OAuth refresh token, AES-256-GCM-encrypted at rest with
--     the same `encrypt()`/`decrypt()` helpers as `ai_configs.api_key`
--     and `whatsapp_config.access_token` (src/lib/whatsapp/encryption.ts)
--     — never returned to the client after save.
--   - `business_hours` is JSONB rather than a fixed set of columns so
--     the booking engine can support per-weekday open/close ranges
--     (and later, holidays/exceptions) without another migration.
--     Shape: { "mon": [["09:00","13:00"],["14:00","19:00"]], ... },
--     empty array/missing key = closed that day. Interpreted in
--     `timezone`, never UTC or the server's local zone — see
--     src/lib/calendar/date-resolver.ts.
--   - `default_duration_min` / `buffer_min` / `min_lead_time_min`
--     mirror the knobs a human scheduler would apply by hand: how
--     long a meeting is by default, how much gap to leave around it,
--     and how soon from "now" a slot may be booked (so the bot can't
--     offer a meeting starting in 5 minutes).
--
--   - `bookings` is one row per meeting the agent proposes/confirms.
--     `contact_id` + `conversation_id` tie it back to the WhatsApp
--     thread that produced it (both nullable: a booking made outside
--     a conversation — e.g. manually — still has an account_id).
--     `external_event_id` is the Google Calendar event id, needed for
--     reschedule/cancel round-trips against the Calendar API; nullable
--     because a `proposed` booking (offered, not yet confirmed) may
--     not have a calendar event yet.
--   - `status` follows the same lifecycle the `book_meeting` /
--     `reschedule` / `cancel_booking` tools (see
--     src/lib/ai/tools/schema.ts) drive: proposed → confirmed →
--     (cancelled | no_show). No `completed` state — wacrm doesn't
--     currently track meeting outcomes past no-show; a future
--     migration can add it if the qualification funnel needs it.
--
--   - `lead_qualification` is 1:1 with `contacts` (UNIQUE(account_id,
--     contact_id), not a global unique on contact_id, so the same
--     phone number shared across two accounts — see
--     `contact_phone_dedup`, migration 022 — still gets independent
--     qualification per workspace). `score` and `stage` are free-form
--     (INT / TEXT) rather than enums: the qualification rubric is
--     product logic that will evolve per-vertical and shouldn't
--     require a migration to tune. `urgency` IS an enum because the
--     agent's tool schema (`save_lead_qualification`) needs a closed,
--     stable vocabulary to reliably steer follow-up cadence and
--     `notify_admin` priority. `answers` is JSONB — the raw
--     question→answer map the qualification conversation collected,
--     kept for audit/debugging and to let the rubric change without
--     losing history.
--
-- RLS
--   Settings-class for `calendar_configs` (mirrors `ai_configs`):
--   any member may read (the inbox needs to know whether booking is
--   live), only admin+ may write the connection itself.
--   Operational-class for `bookings` / `lead_qualification` (mirrors
--   `deals` / `contact_notes`): any member may read and write — these
--   are working data produced by the agent and edited by whoever is
--   handling the lead, not a settings surface.
--   All three are additionally driven by the service-role client from
--   the webhook/automation paths (no auth.uid()), same as ai_configs.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- CALENDAR_CONFIGS
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_configs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider               text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  refresh_token          text NOT NULL,            -- AES-256-GCM-encrypted Google OAuth refresh token
  calendar_id            text NOT NULL,             -- Google Calendar id (e.g. "primary" or a calendar email)
  timezone               text NOT NULL DEFAULT 'UTC', -- IANA tz, e.g. "Europe/Lisbon" — never assume UTC/server tz
  business_hours         jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_duration_min   integer NOT NULL DEFAULT 30 CHECK (default_duration_min > 0),
  buffer_min             integer NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  min_lead_time_min      integer NOT NULL DEFAULT 60 CHECK (min_lead_time_min >= 0),
  is_active              boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE calendar_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_configs_select ON calendar_configs;
CREATE POLICY calendar_configs_select ON calendar_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS calendar_configs_insert ON calendar_configs;
CREATE POLICY calendar_configs_insert ON calendar_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS calendar_configs_update ON calendar_configs;
CREATE POLICY calendar_configs_update ON calendar_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS calendar_configs_delete ON calendar_configs;
CREATE POLICY calendar_configs_delete ON calendar_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_calendar_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calendar_configs_updated_at ON calendar_configs;
CREATE TRIGGER calendar_configs_updated_at
  BEFORE UPDATE ON calendar_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_calendar_configs_updated_at();

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,
  external_event_id   text,                        -- Google Calendar event id; null until confirmed on the calendar
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL CHECK (ends_at > starts_at),
  status              text NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed', 'confirmed', 'cancelled', 'no_show')),
  service              text,                        -- what the meeting is for (free text; product-defined)
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_account_id_idx ON bookings (account_id);
CREATE INDEX IF NOT EXISTS bookings_contact_id_idx ON bookings (contact_id);
CREATE INDEX IF NOT EXISTS bookings_conversation_id_idx ON bookings (conversation_id);
-- Availability checks (check_availability / reschedule) scan by
-- account + time range — this index carries both.
CREATE INDEX IF NOT EXISTS bookings_account_starts_at_idx ON bookings (account_id, starts_at);
-- Fast lookup back to the Google Calendar event for reschedule/cancel;
-- partial because most historical rows may lack one (proposed-only).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_external_event_id_idx
  ON bookings (external_event_id) WHERE external_event_id IS NOT NULL;

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bookings_select ON bookings;
CREATE POLICY bookings_select ON bookings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS bookings_insert ON bookings;
CREATE POLICY bookings_insert ON bookings FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS bookings_update ON bookings;
CREATE POLICY bookings_update ON bookings FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS bookings_delete ON bookings;
CREATE POLICY bookings_delete ON bookings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_bookings_updated_at();

-- ============================================================
-- LEAD_QUALIFICATION — 1:1 with contacts, scoped per account (the
-- same contact can be shared/duplicated across accounts, see 022).
-- ============================================================
DO $$ BEGIN
  CREATE TYPE lead_urgency AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS lead_qualification (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  score         integer,
  stage         text,
  urgency       lead_urgency,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualified_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS lead_qualification_account_id_idx ON lead_qualification (account_id);
CREATE INDEX IF NOT EXISTS lead_qualification_contact_id_idx ON lead_qualification (contact_id);

ALTER TABLE lead_qualification ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_qualification_select ON lead_qualification;
CREATE POLICY lead_qualification_select ON lead_qualification FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS lead_qualification_insert ON lead_qualification;
CREATE POLICY lead_qualification_insert ON lead_qualification FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS lead_qualification_update ON lead_qualification;
CREATE POLICY lead_qualification_update ON lead_qualification FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS lead_qualification_delete ON lead_qualification;
CREATE POLICY lead_qualification_delete ON lead_qualification FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_lead_qualification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lead_qualification_updated_at ON lead_qualification;
CREATE TRIGGER lead_qualification_updated_at
  BEFORE UPDATE ON lead_qualification
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lead_qualification_updated_at();

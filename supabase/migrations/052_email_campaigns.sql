-- ============================================================
-- 052_email_campaigns.sql — Email campaigns (mailing).
--
-- Replica el modelo de `broadcasts` (migraciones 001/003/005/017)
-- pero para email vía Resend, sobre la infra ya existente
-- (`email_templates`, `email_sends`, `email_config`).
--
-- Dos tablas:
--
--   1. `email_campaigns` — la campaña. Espeja `broadcasts`
--      (status ladder draft/scheduled/sending/sent/failed) + conteos
--      agregados + `audience_filter`, `template_variables`. Guarda
--      snapshot de `subject`/`body_html` para que el envío no dependa
--      de ediciones posteriores del template (§7.1 DAD-analog).
--
--   2. `email_campaign_recipients` — una fila por destinatario.
--      Espejo de `broadcast_recipients` con un `resend_message_id`
--      (UNIQUE parcial) para que el webhook de Resend pueda espejear
--      delivered/opened/clicked/bounced sobre la fila.
--
-- RLS (mismo modelo que 017): agent+ lee y escribe filas del account;
--   `is_account_member(account_id, 'agent')`. La tabla de recipients
--   se comprueba vía su campaña padre (igual que broadcast_recipients
--   mira broadcasts).
--
-- Agregación incremental: `email_campaign_recipient_aggregate_trigger()`
-- copia el patrón O(1) de 005 para sent/delivered/opened/clicked/failed.
-- Webhook: `_on_email_webhook` (048) ya existe; para campañas se usará
-- el `resend_message_id` de la fila (fase webhook en una migración
-- posterior, igual que broadcast hizo con 003).
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

-- ============================================================
-- 1. email_campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id          uuid REFERENCES accounts(id) ON DELETE CASCADE,
  name                text NOT NULL,
  -- Snapshot del template al momento de crear/enviar (no FK frágil).
  subject             text NOT NULL,
  body_html           text NOT NULL,
  template_id         uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  template_variables  jsonb,
  audience_filter     jsonb,
  scheduled_at        timestamptz,
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  total_recipients    integer NOT NULL DEFAULT 0,
  sent_count          integer NOT NULL DEFAULT 0,
  delivered_count     integer NOT NULL DEFAULT 0,
  opened_count        integer NOT NULL DEFAULT 0,
  clicked_count       integer NOT NULL DEFAULT 0,
  failed_count        integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_account
  ON email_campaigns (account_id);

ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_campaigns_select ON email_campaigns;
CREATE POLICY email_campaigns_select ON email_campaigns FOR SELECT
  USING (is_account_member(account_id));

-- `DROP POLICY` no admite `FOR INSERT ... WITH CHECK`, y estas tres
-- sentencias además no traían su `CREATE POLICY`. Tal cual estaban,
-- Postgres abortaba el archivo aquí por error de sintaxis y ninguna
-- migración posterior llegaba a correr. Ver 056, que las crea de forma
-- idempotente sobre bases donde 052 ya se aplicó a medias.
DROP POLICY IF EXISTS email_campaigns_insert ON email_campaigns;
CREATE POLICY email_campaigns_insert ON email_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS email_campaigns_update ON email_campaigns;
CREATE POLICY email_campaigns_update ON email_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS email_campaigns_delete ON email_campaigns;
CREATE POLICY email_campaigns_delete ON email_campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON email_campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. email_campaign_recipients
-- ============================================================
CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_campaign_id   uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','opened','clicked','bounced','failed')),
  resend_message_id   text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_campaign
  ON email_campaign_recipients (email_campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_campaign_status
  ON email_campaign_recipients (email_campaign_id, status);
-- UNIQUE parcial para que el webhook de Resend pueda correlacionar
-- sin duplicados en reintentos (igual que broadcast con wamid, 003).
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_campaign_recipients_resend_message
  ON email_campaign_recipients (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_campaign_recipients_select ON email_campaign_recipients;
CREATE POLICY email_campaign_recipients_select ON email_campaign_recipients FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM email_campaigns ec
    WHERE ec.id = email_campaign_recipients.email_campaign_id
      AND is_account_member(ec.account_id)
  )
);

DROP POLICY IF EXISTS email_campaign_recipients_modify ON email_campaign_recipients;
CREATE POLICY email_campaign_recipients_modify ON email_campaign_recipients FOR ALL USING (
  EXISTS (
    SELECT 1 FROM email_campaigns ec
    WHERE ec.id = email_campaign_recipients.email_campaign_id
      AND is_account_member(ec.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM email_campaigns ec
    WHERE ec.id = email_campaign_recipients.email_campaign_id
      AND is_account_member(ec.account_id, 'agent')
  )
);

-- ============================================================
-- 3. Agregación incremental de conteos (patrón de 005, adaptado)
-- ============================================================
CREATE OR REPLACE FUNCTION public._ec_bump(cid UUID, col TEXT, delta INT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'UPDATE email_campaigns SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, cid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Columnas que cada estado de recipient contribuye (ladder forward-only).
-- delivered/bounced/failed pueden venir sin 'sent' previo en ciertos
-- flujos de Resend, así que cada rung cuenta su propio apoyo.
CREATE OR REPLACE FUNCTION public._ec_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'opened'    THEN RETURN ARRAY['sent_count','delivered_count','opened_count']; END IF;
  IF s = 'clicked'   THEN RETURN ARRAY['sent_count','delivered_count','opened_count','clicked_count']; END IF;
  IF s = 'bounced'   THEN RETURN ARRAY['failed_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.email_campaign_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _ec_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _ec_bump(NEW.email_campaign_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _ec_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _ec_bump(OLD.email_campaign_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _ec_cols_for_status(OLD.status);
    new_cols := _ec_cols_for_status(NEW.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _ec_bump(NEW.email_campaign_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _ec_bump(NEW.email_campaign_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS email_campaign_recipients_aggregate ON email_campaign_recipients;
CREATE TRIGGER email_campaign_recipients_aggregate
AFTER INSERT OR UPDATE OR DELETE ON email_campaign_recipients
FOR EACH ROW EXECUTE FUNCTION public.email_campaign_recipient_aggregate_trigger();

-- Safety net: recompute the counters from scratch (igual que el de
-- broadcasts, para corrientes de drift post-bulk-surgery).
CREATE OR REPLACE FUNCTION public.recompute_email_campaign_counts(cid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE email_campaigns c SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    opened_count    = agg.opened_count,
    clicked_count   = agg.clicked_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','opened','clicked'))         AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('opened','clicked'))                     AS opened_count,
      COUNT(*) FILTER (WHERE status = 'clicked')                                 AS clicked_count,
      COUNT(*) FILTER (WHERE status IN ('bounced','failed'))                     AS failed_count
    FROM email_campaign_recipients
    WHERE email_campaign_id = cid
  ) agg
  WHERE c.id = cid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
-- ============================================================
-- 059_meta_leads.sql — Bloco Lead Ads: formulário nativo da Meta
-- (Lead Ads) como segunda origem de leads, ao lado do Click to
-- WhatsApp (Bloco 3-A, migração 045).
--
-- Contexto: quando alguém submete um formulário `leadgen` na Meta, a
-- Página recebe um evento de webhook `leadgen` (campo diferente do
-- `messages`/`statuses` que já tratamos) com apenas o `leadgen_id` —
-- os dados do lead têm de ser lidos à parte via
-- GET /{leadgen_id}?fields=field_data,... (ver
-- src/lib/meta/leads.ts). Este bloco:
--   1. regista o lead (idempotente por `leadgen_id`);
--   2. cria/reaproveita o contacto e a conversa no EterWA
--      (`conversations.source = 'meta_lead_ad'`, mesma coluna livre
--      que já guarda 'meta_ad' desde a migração 045);
--   3. envia um template WhatsApp de abertura.
--
-- `whatsapp_config.meta_page_id` — o webhook de leadgen chega por
-- Página (entry.id = page id), não por phone_number_id como o webhook
-- de mensagens. Esta coluna mapeia page_id → a config (e portanto a
-- account_id/waba_id/access_token) certa, mesmo padrão de lookup que
-- phone_number_id já faz para mensagens.
--
-- `meta_leads` guarda uma linha por lead, incluindo o estado do envio
-- do template (`template_status`) para nunca reenviar por engano nem
-- perder o rasto de uma falha por template ainda não aprovado.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_page_id text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_meta_page_id
  ON whatsapp_config (meta_page_id)
  WHERE meta_page_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta_leads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Meta's leadgen id — the single idempotency key. A row is claimed
  -- by inserting with only this + account_id populated, BEFORE the
  -- Graph API fetch, so a Meta webhook redelivery (or two concurrent
  -- deliveries) can never process the same lead twice.
  leadgen_id              text NOT NULL,
  page_id                 text,
  form_id                 text,
  ad_id                   text,
  adset_id                text,
  campaign_id             text,
  platform                text,
  full_name               text,
  email                   text,
  phone                   text,
  company                 text,
  consentimento_whatsapp  boolean,
  lead_created_time       timestamptz,
  contact_id              uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  -- Twenty person id (text — Twenty ids are UUID-shaped strings but
  -- not FK-checkable from here, same discipline as
  -- conversations.crm_person_id from the Bloco 3-A sync).
  crm_person_id           text,
  -- pending             — row claimed, Graph API fetch / processing not finished
  -- sent                — template message sent to Meta successfully
  -- template_pendente   — template not found/approved yet at send time
  -- failed              — unexpected error while sending (see template_error)
  -- skipped_no_consent  — form's WhatsApp-consent question answered no
  -- skipped_no_phone    — field_data had no usable phone number
  template_status         text NOT NULL DEFAULT 'pending'
                             CHECK (template_status IN (
                               'pending', 'sent', 'template_pendente',
                               'failed', 'skipped_no_consent', 'skipped_no_phone'
                             )),
  template_name           text,
  template_message_id     text,
  template_error          text,
  raw_field_data          jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leadgen_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_leads_account_id ON meta_leads (account_id);
CREATE INDEX IF NOT EXISTS idx_meta_leads_ad_id ON meta_leads (ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meta_leads_template_status ON meta_leads (template_status);

ALTER TABLE meta_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_leads_select ON meta_leads;
CREATE POLICY meta_leads_select ON meta_leads FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.update_meta_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meta_leads_updated_at ON meta_leads;
CREATE TRIGGER meta_leads_updated_at
  BEFORE UPDATE ON meta_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_meta_leads_updated_at();

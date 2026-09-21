-- ============================================================
-- 055_meta_capi_ctwa.sql — Bloco 4: Conversions API para leads vindos
-- de anúncios Click to WhatsApp (CTWA) da Meta.
--
-- Context: o Bloco 3-A já guarda `ctwa_clid`/`ad_id` na conversa
-- (migração 045) quando o lead chega por um anúncio "Click to
-- WhatsApp". Este bloco fecha o ciclo: quando essa conversa avança
-- (fica pronta para handoff — ver checkHandoffReadiness em
-- commercial-handoff.ts — ou marca reunião via
-- book_commercial_meeting), a app reporta o evento à Meta via
-- Conversions API, ligado ao clique original pelo `ctwa_clid`. Isto
-- permite à Meta optimizar os anúncios por leads reais em vez de só
-- por conversas iniciadas — ver src/lib/meta/conversions-api.ts.
--
-- Design notes
--   - `ai_configs.meta_capi_dataset_id`: id do dataset da Conversions
--     API ligado à WhatsApp Business Account da conta (verificar/criar
--     com GET|POST /{WABA_ID}/dataset — ver developers.facebook.com).
--     Sem esta coluna preenchida, sendCapiEvent regista o evento como
--     `error` (`dataset_not_configured`) e nunca tenta a chamada —
--     mesmo padrão de "coluna opcional, feature desligada por omissão"
--     de `commercial_calendar_id` (migração 045).
--   - `ai_configs.meta_capi_test_event_code`: opcional, só para
--     validar o envio no Events Manager (Test Events) sem afectar a
--     optimização real da campanha.
--   - `meta_capi_events`: tabela de auditoria + guarda de dedup. Uma
--     UNIQUE em `event_id` (formato `${conversation_id}:${event_name}`,
--     ver conversions-api.ts) é o mecanismo de "no máximo uma vez por
--     conversa": sendCapiEvent tenta primeiro um INSERT com
--     status='pending' como reserva atómica — uma segunda chamada
--     concorrente para o mesmo evento perde essa reserva (unique
--     violation) e desiste, sem duplo envio nem duas linhas. O UPDATE
--     seguinte grava o resultado real (`sent`/`error`) sem nunca
--     precisar de outro insert.
--   - `response_summary` guarda só um resumo truncado do corpo devolvido
--     pela Meta (para diagnóstico) — nunca o token, nunca dados
--     pessoais além do que a própria Meta já ecoa (event_id).
--   - Sem RLS: tabela interna/operacional, escrita e lida só pelo
--     código do servidor sob o cliente service-role — mesmo desenho de
--     `cron_heartbeats` (migração 044) e `data_deletion_insert_failures`
--     (migração 043).
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS meta_capi_dataset_id text;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS meta_capi_test_event_code text;

CREATE TABLE IF NOT EXISTS meta_capi_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_name       text NOT NULL CHECK (event_name IN ('Lead', 'Schedule')),
  event_id         text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'error')),
  http_status      int,
  response_summary text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_capi_events_event_id_key
  ON meta_capi_events (event_id);

CREATE INDEX IF NOT EXISTS meta_capi_events_conversation_id_idx
  ON meta_capi_events (conversation_id);

CREATE OR REPLACE FUNCTION public.update_meta_capi_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meta_capi_events_updated_at ON meta_capi_events;
CREATE TRIGGER meta_capi_events_updated_at
  BEFORE UPDATE ON meta_capi_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_meta_capi_events_updated_at();

-- ============================================================
-- 045_bloco_3a_modo_comercial.sql — Bloco 3-A: modo comercial para
-- leads vindos de anúncios Click to WhatsApp da Meta.
--
-- Context: quando alguém clica num anúncio "Click to WhatsApp", a Meta
-- inclui um objecto `referral` na mensagem recebida (source_type,
-- source_id, ctwa_clid, headline, body, source_url — ver
-- src/app/api/whatsapp/webhook/route.ts). Este bloco guarda essa
-- proveniência na conversa e liga um modo comercial opcional no
-- auto-reply (src/lib/ai/auto-reply.ts), sem tocar no comportamento
-- actual da assistente interna (Vera) para o resto dos contactos.
--
-- Design notes
--   - `conversations.source` é um texto livre em vez de um CHECK
--     enumerado — 'direct' é o valor por omissão de sempre, 'meta_ad'
--     é o único valor que este bloco escreve, mas deixamos espaço para
--     futuras origens (ex.: 'meta_post', 'referral_organico') sem nova
--     migração.
--   - `ad_id` / `ctwa_clid` / `referral_headline` / `referral_body` /
--     `referral_source_url` só são preenchidos quando chega um
--     referral com `source_type = 'ad'`. `ctwa_clid` é o identificador
--     de clique necessário mais tarde para a Conversions API — dados
--     pessoais, nunca vão para logs em texto claro (ver o webhook).
--   - `first_referral_at` regista SÓ o primeiro clique que abriu a
--     conversa; um referral novo na mesma conversa actualiza
--     ad_id/ctwa_clid/textos mas nunca reescreve este campo.
--   - `commercial_welcome_sent_at` garante que a mensagem de boas-vindas
--     comercial (que abre a janela de 24h do WhatsApp) só é enviada
--     uma vez por conversa, mesmo com mensagens seguidas do lead ou
--     invocações concorrentes do webhook — ver
--     sendCommercialWelcomeIfNeeded em src/lib/ai/commercial.ts, que
--     reivindica esta coluna com um UPDATE atómico condicionado a
--     IS NULL (mesmo padrão do claim_ai_reply_slot da migração 029).
--   - Em `ai_configs`: `commercial_mode_enabled` é o interruptor
--     dedicado do modo comercial (independente de `auto_reply_enabled`,
--     mas só actua quando este também está ligado — ver
--     dispatchInboundToAiReply). `commercial_system_prompt` é o
--     contexto de negócio da persona comercial (scaffold fixo +
--     este texto, tal como `system_prompt` no modo normal).
--     `commercial_booking_url` é o link de agendamento entregue ao
--     lead; quando null, o agente pede o email e diz que a equipa
--     entra em contacto, nunca inventa um link.
--     `commercial_welcome_message` é o texto enviado de imediato na
--     primeira mensagem de uma conversa de anúncio; quando null, usa o
--     valor por omissão em português de Portugal definido em
--     src/lib/ai/commercial.ts (DEFAULT_COMMERCIAL_WELCOME_MESSAGE).
--
-- Nenhuma política de RLS nova é necessária: estas colunas vivem em
-- tabelas já cobertas por `conversations` (migração 001) e `ai_configs`
-- (migração 029) — o alcance por account_id é herdado sem alteração.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'direct';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ad_id text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ctwa_clid text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS referral_headline text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS referral_body text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS referral_source_url text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS first_referral_at timestamptz;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS commercial_welcome_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_conversations_ctwa_clid
  ON conversations (ctwa_clid)
  WHERE ctwa_clid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_source
  ON conversations (source);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_system_prompt text;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_mode_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_booking_url text;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_welcome_message text;

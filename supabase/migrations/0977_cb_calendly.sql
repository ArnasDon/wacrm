-- 977_cb_calendly.sql
--
-- Integração com o Calendly (docs/PLANO-integracao-calendly.md): o Calendly
-- avisa o CRM por webhook a cada horário marcado, e o CRM dispara o gatilho
-- `calendly_booking` das automações. Duas tabelas, as duas FECHADAS para o
-- navegador (nenhuma policy, nenhum GRANT a `authenticated`), como a
-- `cb_meta_ads_config` da 976: o que a tela precisa vem pela rota
-- `GET /api/cb/calendly` (admin, service role).
--
-- 1) `cb_calendly_config` — UMA linha por conta:
--    - `access_token`: o Personal Access Token do Calendly, CIFRADO com
--      `encrypt()` de `src/lib/whatsapp/encryption.ts` (AES-256-GCM,
--      `ENCRYPTION_KEY` — ⚠️ rotacionar a chave invalida este token junto
--      com os do WhatsApp e do Meta Ads).
--    - `signing_key`: a chave que NÓS informamos ao Calendly ao assinar o
--      webhook; é com ela que a rota confere o HMAC de cada entrega.
--      Cifrada pelo mesmo motivo.
--    - `webhook_token`: o segredo que identifica a CONTA na URL do webhook
--      (`/api/cb/calendly/webhook/<token>`). Único; guardado em claro
--      porque a rota o procura por igualdade — o que protege a entrega é a
--      assinatura, o token só diz "de qual conta".
--    - `webhook_uri`/`webhook_scope`/`webhook_state`: a assinatura criada no
--      Calendly. `state = 'disabled'` é o Calendly desligando depois de 24h
--      de falhas — a única saída é recriar.
--    - `pergunta_telefone`: rótulo da pergunta do formulário que carrega o
--      telefone do cliente (o Calendly não tem campo de telefone).
-- 2) `cb_calendly_eventos` — cada agendamento que chegou e o que aconteceu
--    com ele. `UNIQUE (account_id, evento, invitee_uri)` é a idempotência:
--    o Calendly reenvia a mesma entrega por 24h enquanto não recebe 2xx, e
--    a segunda cópia tem de ser descartada ANTES de disparar automação.
--    Sem `payload` cru: os campos normalizados bastam para depurar, e o
--    telefone/e-mail já são dado de contato.
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda.

-- ---------------------------------------------------------------------------
-- 1) config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_calendly_config (
  account_id        uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  access_token      text NOT NULL,
  signing_key       text NOT NULL,
  webhook_token     text NOT NULL UNIQUE,
  user_uri          text NOT NULL,
  organization_uri  text NOT NULL,
  user_name         text,
  user_email        text,
  scheduling_url    text,
  webhook_uri       text,
  webhook_scope     text CHECK (webhook_scope IS NULL OR webhook_scope IN ('organization', 'user')),
  webhook_state     text CHECK (webhook_state IS NULL OR webhook_state IN ('active', 'disabled')),
  pergunta_telefone text,
  status            text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'erro')),
  last_event_at     timestamptz,
  last_error        text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_calendly_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_calendly_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_calendly_config TO service_role;

-- ---------------------------------------------------------------------------
-- 2) eventos recebidos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_calendly_eventos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  evento           text NOT NULL,
  invitee_uri      text NOT NULL,
  event_type_uri   text,
  event_type_nome  text,
  nome             text,
  email            text,
  telefone         text,
  telefone_origem  text CHECK (telefone_origem IS NULL OR telefone_origem IN ('sms', 'pergunta', 'heuristica')),
  inicio           timestamptz,
  fim              timestamptz,
  link             text,
  perguntas        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- SET NULL, e não CASCADE: apagar o contato não apaga o registro de que o
  -- agendamento chegou. Coluna NOMEADA por hábito (lição da 966), embora a
  -- FK aqui seja simples.
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  resultado        text NOT NULL DEFAULT 'recebido'
                   CHECK (resultado IN ('recebido', 'disparado', 'sem_automacao', 'sem_contato', 'sem_telefone', 'ignorado', 'falhou')),
  detalhe          text,
  recebido_em      timestamptz NOT NULL DEFAULT now(),
  processado_em    timestamptz,
  UNIQUE (account_id, evento, invitee_uri)
);

CREATE INDEX IF NOT EXISTS cb_calendly_eventos_conta_idx
  ON cb_calendly_eventos (account_id, recebido_em DESC);

ALTER TABLE cb_calendly_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_calendly_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_calendly_eventos TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_calendly_config', 'cb_calendly_eventos'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '977: tabela % ausente', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '977: anon ainda alcança %', t;
    END IF;
    -- Fechadas para o membro: nem SELECT. O token cifrado e a chave de
    -- assinatura não passam pelo PostgREST; os eventos vêm pela rota.
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION '977: authenticated alcança % — tudo passa pela rota', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '977: service_role sem acesso a %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_calendly_eventos'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '977: UNIQUE (account_id, evento, invitee_uri) ausente — o Calendly reenvia e a automação dispararia duas vezes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_calendly_config'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '977: webhook_token sem UNIQUE — duas contas com o mesmo token na URL';
  END IF;
END $$;

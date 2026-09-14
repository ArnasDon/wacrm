-- ============================================================
-- 989 — Instagram Direct como conexão (o terceiro transporte)
--
-- Plano: docs/PLANO-instagram-direct.md · Estudo: docs/ESTUDO-instagram-direct.md
--
-- O escritório quer VER e RESPONDER as mensagens do Direct pela caixa de
-- entrada. Medido na Fase 0 (09/09/2026): a API do Instagram com login do
-- Instagram entrega as DMs por webhook sem App Review para a própria conta;
-- o webhook é assinado com o **Instagram App Secret** da aba do produto (não
-- com a chave principal do app); e a conta é identificada pelo `entry.id`
-- do payload (o IG user id), nunca por telefone.
--
-- O que esta migration faz:
--   1. `cb_channels.kind` aceita 'instagram', com as colunas do canal.
--   2. Índice ÚNICO GLOBAL de roteamento de entrada por `ig_user_id` — o
--      webhook só traz a chave, não a conta (mesma regra da 901).
--   3. `contacts` ganha `instagram_id` (IGSID) e `instagram_username`, e
--      `phone` passa a ser NULLABLE, com CHECK "telefone OU instagram".
--
-- ⚠️ POR QUE O IGSID NÃO VAI EM `contacts.phone`
-- `findExistingContact` casa contato pelos ÚLTIMOS 8 DÍGITOS (LIKE) — é a
-- mesma armadilha do JID de grupo (906): um IGSID de 16–17 dígitos pode
-- FUNDIR em silêncio com o celular de um cliente real. Coluna própria, e
-- o único parcial abaixo é quem garante "uma ficha por conta do Instagram".
--
-- ⚠️ `phone` NULLABLE muda um invariante de 2 anos. O `phone_normalized`
-- (coluna GERADA da 022) vira NULL junto, e o índice único
-- `idx_contacts_account_phone_normalized` tem `WHERE phone_normalized <> ''`
-- — NULL <> '' é NULL, então a ficha só-Instagram fica FORA dele, de
-- propósito. `merge_duplicate_contacts` (022) agrupa com o mesmo WHERE e
-- também não a vê. Nada grava NULL antes da Fase 3 do plano.
--
-- ⚠️ Um canal Instagram NUNCA é `is_default`: o padrão da conta é o número
-- de WhatsApp que responde conversa sem canal e alimenta o espelho
-- `whatsapp_config`. O código recusa (set-default.ts, criação); o banco não
-- tem como expressar isso sem trigger, e um trigger aqui seria a segunda
-- barreira para um erro que a primeira já cobre.
--
-- Sem backfill. Sem tabela nova (nada a REVOGAR do `anon`; a 931 já fechou
-- `cb_channels`, e `contacts` é do upstream com RLS própria). Idempotente.
-- Replay em banco vazio: só ALTER/CREATE IF NOT EXISTS e conferências que
-- afirmam AUSÊNCIA ou derivam o dado.
-- ============================================================

-- ------------------------------------------------------------
-- 1. cb_channels: o terceiro kind e as colunas do Instagram
-- ------------------------------------------------------------
ALTER TABLE public.cb_channels
  ADD COLUMN IF NOT EXISTS ig_user_id          text,
  ADD COLUMN IF NOT EXISTS ig_username         text,
  -- Cifrado (AES-256-GCM, como access_token/api_key). É quem ASSINA o
  -- webhook (X-Hub-Signature-256) — medido no Teste B da Fase 0.
  ADD COLUMN IF NOT EXISTS ig_app_secret       text,
  -- O token gerado no painel da Meta dura 60 dias; o cron da Fase 6 renova
  -- por `/refresh_access_token` e compara `expires_in`.
  ADD COLUMN IF NOT EXISTS ig_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS ig_token_refreshed_at timestamptz,
  -- D2 do plano: a tag HUMAN_AGENT (7 dias) só depois de a feature ser
  -- aprovada no painel da Meta. Nasce desligado.
  ADD COLUMN IF NOT EXISTS ig_human_agent      boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cb_channels.ig_user_id IS
  'Instagram: o IG user id da conta profissional (o `entry.id` do webhook e o `/me.user_id`). Chave GLOBAL de roteamento de entrada.';
COMMENT ON COLUMN public.cb_channels.ig_app_secret IS
  'Instagram: o Instagram App Secret da aba do produto, CIFRADO. É quem assina X-Hub-Signature-256 — não é META_APP_SECRET.';
COMMENT ON COLUMN public.cb_channels.ig_human_agent IS
  'Instagram: envia a tag HUMAN_AGENT (janela de 7 dias) fora das 24h. Exige a feature aprovada na Meta; sem ela a API recusa.';

-- O CHECK do kind. A 901 o escreveu INLINE na coluna, então o nome foi dado
-- pelo Postgres (`cb_channels_kind_check`, em produção) — mas um DROP pelo
-- nome que não casasse deixaria o CHECK velho de pé, recusando 'instagram'
-- no primeiro INSERT. Por isso o DROP é pela FORMA (`kind = ANY (ARRAY[…`,
-- que é como o Postgres renderiza `kind IN (…)`), e o ADD dá o nome.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.cb_channels'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'kind = ANY \(ARRAY\['
  LOOP
    EXECUTE format('ALTER TABLE public.cb_channels DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.cb_channels
  ADD CONSTRAINT cb_channels_kind_check
  CHECK (kind IN ('meta', 'evolution', 'instagram'));

-- Cada tipo exige os seus campos. O ramo do Instagram exige o id da conta,
-- o token (na coluna `access_token`, a mesma da Meta — o cliente Graph é o
-- mesmo formato de bearer) e o segredo que assina o webhook.
ALTER TABLE public.cb_channels DROP CONSTRAINT IF EXISTS cb_channels_required_by_kind;
ALTER TABLE public.cb_channels
  ADD CONSTRAINT cb_channels_required_by_kind CHECK (
    (kind = 'meta'      AND phone_number_id IS NOT NULL
                        AND access_token    IS NOT NULL)
    OR
    (kind = 'evolution' AND server_url    IS NOT NULL
                        AND instance_name IS NOT NULL
                        AND api_key       IS NOT NULL)
    OR
    (kind = 'instagram' AND ig_user_id    IS NOT NULL
                        AND access_token  IS NOT NULL
                        AND ig_app_secret IS NOT NULL)
  );

-- ------------------------------------------------------------
-- 2. Roteamento de ENTRADA: único GLOBAL por conta do Instagram
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS cb_channels_instagram_route_idx
  ON public.cb_channels (ig_user_id)
  WHERE kind = 'instagram' AND ig_user_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. contacts: a identidade do Instagram, e o telefone deixa de ser
--    obrigatório
-- ------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS instagram_id       text,
  ADD COLUMN IF NOT EXISTS instagram_username text;

COMMENT ON COLUMN public.contacts.instagram_id IS
  'IGSID: o id da pessoa DENTRO da conversa com esta conta do Instagram (muda de app para app). Nunca em `phone` — findExistingContact casa por sufixo de 8 dígitos.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_instagram_id
  ON public.contacts (account_id, instagram_id)
  WHERE instagram_id IS NOT NULL;

ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_identidade_ck;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_identidade_ck
  CHECK (phone IS NOT NULL OR instagram_id IS NOT NULL);

-- ============================================================
-- Conferência — afirma ausência, deriva o dado, nunca exige linha.
-- ============================================================
DO $$
DECLARE
  v_col int;
BEGIN
  -- 1. As seis colunas do canal existem.
  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'cb_channels'
    AND column_name IN ('ig_user_id','ig_username','ig_app_secret',
                        'ig_token_expires_at','ig_token_refreshed_at','ig_human_agent');
  IF v_col <> 6 THEN
    RAISE EXCEPTION '989: cb_channels ficou com % das 6 colunas do Instagram', v_col;
  END IF;

  -- 2. Sobrou UM CHECK de kind, e ele aceita 'instagram'.
  SELECT count(*) INTO v_col
  FROM pg_constraint
  WHERE conrelid = 'public.cb_channels'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ 'kind = ANY \(ARRAY\[';
  IF v_col <> 1 THEN
    RAISE EXCEPTION '989: cb_channels ficou com % CHECKs de kind (esperado 1)', v_col;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_channels'::regclass
      AND conname = 'cb_channels_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%instagram%'
  ) THEN
    RAISE EXCEPTION '989: cb_channels_kind_check não aceita ''instagram''';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_channels'::regclass
      AND conname = 'cb_channels_required_by_kind'
      AND pg_get_constraintdef(oid) NOT LIKE '%ig_app_secret%'
  ) THEN
    RAISE EXCEPTION '989: cb_channels_required_by_kind ficou sem o ramo do Instagram';
  END IF;

  -- 3. `contacts.phone` é anulável, e o CHECK de identidade está lá.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts'
      AND column_name = 'phone' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '989: contacts.phone continua NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass AND conname = 'contacts_identidade_ck'
  ) THEN
    RAISE EXCEPTION '989: contacts_identidade_ck não existe';
  END IF;

  -- 4. Nenhuma linha viola a identidade (em produção nenhuma tem phone nulo;
  --    em banco vazio não há linha — a afirmação de ausência vale nos dois).
  IF EXISTS (SELECT 1 FROM public.contacts WHERE phone IS NULL AND instagram_id IS NULL) THEN
    RAISE EXCEPTION '989: há contato sem telefone e sem instagram_id';
  END IF;

  RAISE NOTICE '989: ok — kind instagram, colunas do canal, IGSID em contacts, phone anulável.';
END $$;

-- 982_cb_webhooks_de_entrada.sql
--
-- Webhooks de ENTRADA (docs/PLANO-webhooks-de-entrada.md): o operador cria um
-- webhook com nome, cola a URL num sistema de fora (Typebot, n8n) e cada
-- acionamento dispara o gatilho `webhook_received` das automações — ficando
-- registrado num log que responde "isto está recebendo ou não?".
--
-- É a irmã genérica da 977 (Calendly), e segue as mesmas regras: duas tabelas
-- FECHADAS para o navegador (nenhuma policy, nenhum GRANT a `authenticated`);
-- o que a tela precisa vem pela rota `GET /api/cb/webhooks` (admin, service
-- role).
--
-- 1) `cb_webhooks` — N por conta (a 977 tem UMA linha por conta; aqui o
--    operador cria quantos quiser, um por origem):
--    - `token`: identifica QUAL webhook na URL (`/api/cb/entrada/<token>`).
--      Único no banco inteiro, guardado em CLARO porque a rota o procura por
--      igualdade. Não é credencial: é endereço.
--    - `segredo`: a credencial de verdade, conferida contra o cabeçalho
--      `Authorization: Bearer <segredo>` de cada entrega. CIFRADO com
--      `encrypt()` de `src/lib/whatsapp/encryption.ts` (AES-256-GCM,
--      `ENCRYPTION_KEY` — ⚠️ rotacionar a chave invalida este segredo junto
--      com os tokens do WhatsApp, do Meta Ads e do Calendly).
--      ⚠️ O Calendly ASSINA cada entrega com HMAC, e por isso lá o token da
--      URL basta. Typebot e n8n não assinam — sem o segredo no cabeçalho, o
--      token na URL seria a única barreira, e URL vaza em log de proxy,
--      histórico de navegador e captura de tela.
--    - `sem_segredo`: o escape para sistema que não consegue mandar
--      cabeçalho. O CHECK abaixo garante que só existe linha SEGURA (com
--      segredo) ou linha EXPLICITAMENTE aberta — nunca uma aberta por
--      esquecimento.
--    - `campo_telefone`/`campo_nome`/`campo_id`: onde, no JSON achatado,
--      moram o telefone do cliente, o nome e um id estável do evento. Num
--      payload arbitrário não há como adivinhar, e sem o telefone não há
--      contato — e sem contato a automação não tem sobre quem agir.
-- 2) `cb_webhook_eventos` — cada acionamento e o que aconteceu com ele.
--    - `variaveis`: o payload ACHATADO, que é exatamente o que a automação
--      enxerga em `{{vars.*}}`. Sem cópia do corpo cru: a pergunta real do
--      operador é "por que {{vars.nome}} saiu vazio", e ela se responde
--      vendo a lista de variáveis com os valores. Guardar o cru por cima
--      seria uma segunda cópia de dado de cliente para responder a mesma
--      pergunta duas vezes (mesma decisão da 977).
--    - `id_externo` + `UNIQUE (webhook_id, id_externo)` são a idempotência.
--      ⚠️ O DEFAULT aleatório é load-bearing: ele mantém o índice TOTAL, e
--      só índice total serve de alvo para o `ON CONFLICT` do PostgREST
--      (índice PARCIAL não serve — lição da 903). Sem `campo_id`
--      configurado, cada entrega é um evento novo; com ele, a reentrega do
--      mesmo id é descartada ANTES de disparar automação.
--    - `processando_desde`: o cadeado. No deploy `start-first` há dois
--      processos Node vivos, e só o banco serializa (mesma razão da 980).
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda.

-- ---------------------------------------------------------------------------
-- 1) os webhooks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_webhooks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  token          text NOT NULL UNIQUE,
  segredo        text,
  sem_segredo    boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  campo_telefone text,
  campo_nome     text,
  campo_id       text,
  last_event_at  timestamptz,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Ou tem segredo, ou está declaradamente aberto. Sem esta linha, um save
  -- que perdesse o segredo deixaria a porta destrancada em silêncio.
  CONSTRAINT cb_webhooks_credencial_ck
    CHECK (sem_segredo OR segredo IS NOT NULL),
  -- A FK composta de `cb_webhook_eventos` precisa deste par: a rota roda em
  -- service-role e ignora RLS, então FK simples só garantiria "existe uma
  -- linha com esse id", não "é desta conta" (mesma forma da 903/908).
  CONSTRAINT cb_webhooks_id_conta_uk UNIQUE (id, account_id)
);

-- Nome único por conta, aparado e em minúsculas: o log inteiro é lido pelo
-- NOME, e dois "Typebot" tornariam o log ambíguo justamente na tela que
-- existe para desambiguar. O 23505 vira pergunta na tela, não erro cru.
CREATE UNIQUE INDEX IF NOT EXISTS cb_webhooks_nome_uk
  ON cb_webhooks (account_id, lower(btrim(nome)));

ALTER TABLE cb_webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_webhooks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_webhooks TO service_role;

-- ---------------------------------------------------------------------------
-- 2) acionamentos recebidos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_webhook_eventos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  webhook_id        uuid NOT NULL,
  id_externo        text NOT NULL DEFAULT gen_random_uuid()::text,
  nome              text,
  telefone          text,
  variaveis         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- SET NULL, e não CASCADE: apagar o contato não apaga o registro de que o
  -- acionamento chegou.
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  resultado         text NOT NULL DEFAULT 'recebido'
                    CHECK (resultado IN ('recebido', 'disparado', 'em_espera', 'sem_automacao', 'sem_contato', 'sem_telefone', 'ignorado', 'falhou')),
  detalhe           text,
  recebido_em       timestamptz NOT NULL DEFAULT now(),
  processado_em     timestamptz,
  processando_desde timestamptz,
  -- Apagar o webhook leva o log dele: sem o webhook, a linha não tem nome
  -- para escrever nem sobre o que informar.
  CONSTRAINT cb_webhook_eventos_webhook_fk
    FOREIGN KEY (webhook_id, account_id)
    REFERENCES cb_webhooks (id, account_id) ON DELETE CASCADE,
  UNIQUE (webhook_id, id_externo)
);

CREATE INDEX IF NOT EXISTS cb_webhook_eventos_log_idx
  ON cb_webhook_eventos (webhook_id, recebido_em DESC);

ALTER TABLE cb_webhook_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_webhook_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_webhook_eventos TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_webhooks', 'cb_webhook_eventos'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '982: tabela % ausente', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '982: anon ainda alcança %', t;
    END IF;
    -- Fechadas para o membro: nem SELECT. O segredo cifrado não passa pelo
    -- PostgREST, e o log vem pela rota.
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION '982: authenticated alcança % — tudo passa pela rota', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '982: service_role sem acesso a %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_webhooks'::regclass
      AND contype = 'c' AND conname = 'cb_webhooks_credencial_ck'
  ) THEN
    RAISE EXCEPTION '982: CHECK de credencial ausente — webhook poderia nascer sem segredo e sem se declarar aberto';
  END IF;

  -- Procura pela DEFINIÇÃO, não pelo nome nem pela posição das colunas: o
  -- nome é gerado pelo Postgres, e comparar `conkey` quebraria se alguém
  -- reordenasse o CREATE TABLE (forma da 978).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_webhook_eventos'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(webhook_id, id_externo)%'
  ) THEN
    RAISE EXCEPTION '982: UNIQUE (webhook_id, id_externo) ausente — a reentrega do mesmo acionamento dispararia a automação duas vezes';
  END IF;

  -- O DEFAULT do `id_externo` é o que mantém o índice acima TOTAL. Sem ele a
  -- coluna aceitaria NULL, o índice deixaria de arbitrar essas linhas, e o
  -- `ON CONFLICT` do PostgREST perderia o alvo (lição da 903).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.cb_webhook_eventos'::regclass
      AND a.attname = 'id_externo' AND a.attnotnull
  ) THEN
    RAISE EXCEPTION '982: id_externo precisa ser NOT NULL COM DEFAULT — senão o UNIQUE deixa de ser total';
  END IF;
END $$;

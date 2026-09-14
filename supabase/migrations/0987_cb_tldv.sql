-- 987_cb_tldv.sql
--
-- Integração com o tl;dv (docs/PLANO-integracao-tldv.md): o CRM busca, pela
-- API do tl;dv, as reuniões gravadas e a transcrição completa de cada uma, e
-- guarda tudo aqui para a ficha do cliente montar o HISTÓRICO de reuniões —
-- vinculadas ao cliente pelo e-mail do convidado (automático) ou à mão. A
-- mesma tabela recebe a transcrição colada à mão (origem `manual`), porque
-- para a ficha as duas são a mesma coisa: "o que foi dito nesta reunião".
--
-- São duas tabelas com regras DIFERENTES, de propósito:
--
-- 1) `cb_tldv_config` — UMA linha por conta, FECHADA para o navegador
--    (nenhuma policy, nenhum GRANT a `authenticated`), como a 976/977:
--    - `api_key`: a chave pessoal do tl;dv, CIFRADA com `encrypt()` de
--      `src/lib/whatsapp/encryption.ts` (AES-256-GCM, `ENCRYPTION_KEY` —
--      ⚠️ rotacionar a chave invalida esta junto com as do WhatsApp, do Meta
--      Ads e do Calendly). Vai no cabeçalho `x-api-key` de cada pedido,
--      nunca na URL.
--    - `webhook_token`: identifica a conta na URL que o operador cola no
--      painel do tl;dv (`/api/cb/tldv/webhook/<token>`). Em CLARO porque a
--      rota o procura por igualdade. ⚠️ O tl;dv NÃO assina a entrega (não há
--      cabeçalho de assinatura na doc), então o token é a única barreira —
--      e por isso o webhook aqui é só um AVISO: a rota lê o id da reunião e
--      busca a reunião na API com a NOSSA chave. Uma entrega forjada só
--      consegue fazer o CRM consultar o tl;dv por um id, e o tl;dv só
--      devolve o que a chave enxerga. Nada do corpo do webhook é gravado.
--    - `last_sync_at`/`last_error`/`status`: o que o cartão mostra.
--    - `last_sync_attempt_at`: carimbado no COMEÇO de toda varredura, dê
--      certo ou errado. É o rodízio do cron: ele ordena as contas por esta
--      coluna (nunca tentada primeiro), então quem ficou de fora do
--      orçamento de 90 s num ciclo vai para a frente no seguinte. Sem isso a
--      lista vinha sempre na mesma ordem e a cauda nunca sincronizava
--      (achado do Codex no PR #163). Não é `last_sync_at`: a varredura que
--      FALHA não carimba o sucesso e ficaria na frente para sempre.
--
-- 2) `cb_reunioes_transcritas` — N por conta. Molde da `cb_meetings` (945):
--    o navegador LÊ direto sob RLS (a ficha do cliente monta a lista de lá,
--    e a transcrição pode ter dezenas de KB — passar isso por rota não
--    compra nada), e toda ESCRITA passa pela API, que carimba autor, confere
--    o cliente contra a conta e é a única que conhece a chave do tl;dv.
--    - `origem`: `tldv` (importada pela API) ou `manual` (texto colado).
--      O CHECK amarra `tldv_meeting_id` à origem: importada tem id, manual
--      não — e `UNIQUE (account_id, tldv_meeting_id)` é a idempotência da
--      sincronização e do webhook (o `ON CONFLICT` do PostgREST exige índice
--      TOTAL; NULL é distinto de NULL, então as manuais não colidem).
--    - `contact_id`: FK COMPOSTA `(contact_id, account_id)`, como na 945 —
--      a rota roda em service role e uma FK simples só garante "existe um
--      contato com esse id", não "desta conta". `ON DELETE SET NULL
--      (contact_id)`, coluna NOMEADA: `account_id` é NOT NULL e SET NULL sem
--      lista tentaria zerá-la junto (lição da 966).
--    - `status`: `pendente` (reunião conhecida, transcrição ainda não
--      pronta no tl;dv), `pronta`, `sem_transcricao` (desistiu depois das
--      tentativas) e `falhou` (a API recusou; `erro` diz o código). A manual
--      nasce `pronta` COM texto — o CHECK cobra.
--    - `vinculo_origem`: COMO o cliente foi ligado — `email` (automático,
--      pelo e-mail do convidado), `manual` (alguém escolheu) ou
--      `desvinculada` (alguém tirou; a sincronização NÃO religa sozinha —
--      sem isso, desvincular seria desfeito no ciclo seguinte).
--    - `texto`/`segmentos`/`notas`: a transcrição em texto corrido, as
--      frases com orador e tempo (JSON, só na origem tl;dv) e as notas que a
--      IA do tl;dv gera (markdown). Ficam no Postgres, não no Storage: uma
--      reunião de uma hora dá ~80 KB de texto.
--
-- `anon` sem nada (931). `service_role` com tudo, POR ESCRITO — em banco
-- novo não existe default privilege que o conceda. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) config
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_tldv_config (
  account_id     uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  api_key        text NOT NULL,
  webhook_token  text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'erro')),
  last_sync_at   timestamptz,
  last_sync_attempt_at timestamptz,
  last_event_at  timestamptz,
  last_error     text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_tldv_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_tldv_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_tldv_config TO service_role;

-- ---------------------------------------------------------------------------
-- 2) reuniões transcritas (tl;dv + manuais)
-- ---------------------------------------------------------------------------
-- A FK composta abaixo precisa do índice único `(id, account_id)` em
-- `contacts`, que a 945 criou. Repetido aqui por idempotência: esta migration
-- tem de aplicar sozinha num banco onde a 945 já passou (no-op) e num banco
-- reconstruído do zero (também no-op, porque a 945 vem antes).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx ON contacts (id, account_id);

CREATE TABLE IF NOT EXISTS cb_reunioes_transcritas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id         uuid,
  origem             text NOT NULL CHECK (origem IN ('tldv', 'manual')),
  tldv_meeting_id    text,
  titulo             text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  realizada_em       timestamptz NOT NULL,
  duracao_seg        integer CHECK (duracao_seg IS NULL OR duracao_seg >= 0),
  url                text,
  organizador_nome   text,
  organizador_email  text,
  participantes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             text NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'pronta', 'sem_transcricao', 'falhou')),
  texto              text,
  segmentos          jsonb,
  notas              text,
  tentativas         integer NOT NULL DEFAULT 0,
  erro               text,
  vinculo_origem     text CHECK (vinculo_origem IS NULL OR vinculo_origem IN ('email', 'manual', 'desvinculada')),
  vinculado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vinculado_em       timestamptz,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_nome         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- importada tem o id do tl;dv; manual não tem
  CONSTRAINT cb_reunioes_transcritas_origem_ck
    CHECK ((origem = 'tldv') = (tldv_meeting_id IS NOT NULL)),
  -- manual nasce pronta e com texto: não há de onde buscar depois
  CONSTRAINT cb_reunioes_transcritas_manual_ck
    CHECK (origem <> 'manual' OR (status = 'pronta' AND texto IS NOT NULL)),
  CONSTRAINT cb_reunioes_transcritas_tldv_uk UNIQUE (account_id, tldv_meeting_id),
  CONSTRAINT cb_reunioes_transcritas_contato_fk
    FOREIGN KEY (contact_id, account_id) REFERENCES contacts (id, account_id)
    ON DELETE SET NULL (contact_id)
);

-- A ficha do cliente: as reuniões DELE, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS cb_reunioes_transcritas_contato_idx
  ON cb_reunioes_transcritas (account_id, contact_id, realizada_em DESC);
-- A sincronização: o que ainda espera transcrição.
CREATE INDEX IF NOT EXISTS cb_reunioes_transcritas_pendentes_idx
  ON cb_reunioes_transcritas (account_id, realizada_em DESC)
  WHERE status = 'pendente';

ALTER TABLE cb_reunioes_transcritas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_reunioes_transcritas_select ON cb_reunioes_transcritas;
CREATE POLICY cb_reunioes_transcritas_select ON cb_reunioes_transcritas
  FOR SELECT USING (is_account_member(account_id));

REVOKE ALL ON TABLE cb_reunioes_transcritas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_reunioes_transcritas TO authenticated;
GRANT ALL ON TABLE cb_reunioes_transcritas TO service_role;

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_tldv_config', 'cb_reunioes_transcritas'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '987: tabela % ausente', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '987: anon ainda alcança %', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '987: service_role sem acesso a %', t;
    END IF;
  END LOOP;

  -- A config é fechada: a chave cifrada não passa pelo PostgREST.
  IF has_table_privilege('authenticated', 'public.cb_tldv_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_tldv_config', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_tldv_config', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_tldv_config', 'DELETE') THEN
    RAISE EXCEPTION '987: authenticated alcança cb_tldv_config — tudo passa pela rota';
  END IF;

  -- As reuniões: o membro LÊ (a ficha monta a lista de lá) e NÃO escreve.
  IF NOT has_table_privilege('authenticated', 'public.cb_reunioes_transcritas', 'SELECT') THEN
    RAISE EXCEPTION '987: authenticated sem SELECT em cb_reunioes_transcritas — a ficha do cliente não teria de onde ler';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_reunioes_transcritas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_reunioes_transcritas', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_reunioes_transcritas', 'DELETE') THEN
    RAISE EXCEPTION '987: authenticated escreve em cb_reunioes_transcritas — a escrita é da rota';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_reunioes_transcritas'::regclass
      AND conname = 'cb_reunioes_transcritas_tldv_uk'
  ) THEN
    RAISE EXCEPTION '987: UNIQUE (account_id, tldv_meeting_id) ausente — a sincronização importaria a mesma reunião duas vezes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_reunioes_transcritas'::regclass
      AND conname = 'cb_reunioes_transcritas_contato_fk'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION '987: FK composta para contacts ausente — a rota em service role aceitaria contato de outra conta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_tldv_config'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '987: webhook_token sem UNIQUE — duas contas com o mesmo token na URL';
  END IF;
END $$;

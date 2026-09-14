-- ============================================================
-- 906_cb_grupos — grupos de WhatsApp no inbox
--
-- POR QUE UMA TABELA NOVA (e não uma linha em `contacts`)
-- A saída barata seria gravar o grupo como contato com `phone` = JID. Três
-- coisas no código existente impedem:
--   1. `findExistingContact` (src/lib/contacts/dedupe.ts) casa por LIKE nos
--      ÚLTIMOS 8 DÍGITOS e depois `phonesMatch`, que tolera prefixo de tronco.
--      Um JID de grupo tem ~18 dígitos, então pode casar com o celular de um
--      cliente real e FUNDIR as duas conversas — silenciosamente.
--   2. Grupo em `contacts` vaza para a tela de Contatos, a audiência de
--      Broadcast, o seletor de Negócios e a métrica de novos contatos.
--   3. `sanitizePhoneForMeta` + `isValidE164` reprovam o JID antes do envio.
--
-- PRINCÍPIO: uma conversa é OU de contato OU de grupo, nunca as duas e nunca
-- nenhuma. É o CHECK da seção 2 que torna isso uma garantia do banco em vez de
-- uma convenção que o código precisa lembrar.
--
-- ESCOPO DELIBERADO: grupo NÃO dispara automação, flow nem resposta de IA.
-- Isso não é imposto aqui — é imposto por `persistGroupMessage` simplesmente
-- não chamar o fan-out, mesmo padrão de `persistDeviceMessage` (ver o
-- comentário em src/lib/whatsapp/inbound-store.ts). Uma função que não chama
-- não tem como chamar por engano.
--
-- Idempotente: roda mais de uma vez sem erro.
-- ============================================================

-- ------------------------------------------------------------
-- 1) O cadastro de grupos
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cb_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Por qual número vimos este grupo. SET NULL (não CASCADE): apagar o canal
  -- não pode apagar o histórico de conversa do grupo junto.
  channel_id     uuid REFERENCES cb_channels(id) ON DELETE SET NULL,

  -- 120363…@g.us — a identidade do grupo no WhatsApp.
  jid            text NOT NULL,

  -- Nome REAL, como está no WhatsApp. NULL enquanto a busca não resolveu (a
  -- mensagem de grupo não traz o assunto; ele vem de findGroupInfos).
  subject        text,

  -- Apelido só nosso, invisível para os participantes. Tem precedência sobre
  -- `subject` na exibição. São campos separados de propósito: renomear o grupo
  -- de verdade é ação para FORA (todo participante vê); apelidar não é.
  alias          text,

  description    text,
  picture_url    text,
  owner_jid      text,
  participant_count integer,

  -- "Só administradores podem enviar" — o composer bloqueia quando true e não
  -- somos admin. Sem isso o atendente escreve, envia, e recebe erro cru.
  is_announce    boolean,

  -- Libera o botão de renomear de verdade. NULL = ainda não sabemos.
  we_are_admin   boolean,

  -- Última vez que os campos acima vieram do WhatsApp.
  synced_at      timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Um grupo por conta, INDEPENDENTE de canal. Decisão consciente: se dois
-- números nossos estiverem no mesmo grupo, é UMA conversa no inbox, não duas.
-- É o que o operador espera ver, e o dedupe de entrada (que é global por
-- message_id) já colapsa as duas cópias naturalmente.
CREATE UNIQUE INDEX IF NOT EXISTS cb_groups_account_jid_idx
  ON cb_groups (account_id, jid);

CREATE INDEX IF NOT EXISTS cb_groups_channel_idx
  ON cb_groups (channel_id) WHERE channel_id IS NOT NULL;

ALTER TABLE cb_groups ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro. Escrita: agent+ — apelidar e sincronizar são
-- ações de atendimento, não de configuração. (Ligar grupos num canal É
-- configuração, e por isso mora em cb_channels, que é admin+.)
DROP POLICY IF EXISTS cb_groups_select ON cb_groups;
CREATE POLICY cb_groups_select ON cb_groups FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS cb_groups_insert ON cb_groups;
CREATE POLICY cb_groups_insert ON cb_groups FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS cb_groups_update ON cb_groups;
CREATE POLICY cb_groups_update ON cb_groups FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS cb_groups_delete ON cb_groups;
CREATE POLICY cb_groups_delete ON cb_groups FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON cb_groups;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON cb_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 2) A conversa passa a poder ser de grupo
-- ------------------------------------------------------------

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES cb_groups(id) ON DELETE CASCADE;

-- CASCADE aqui (e não SET NULL como no channel_id): uma conversa de grupo sem
-- grupo não é nada — violaria o XOR abaixo e viraria uma linha órfã que
-- nenhuma tela sabe desenhar.

-- ÚNICO, espelhando o idx_conversations_account_contact que já existe no banco
-- para o lado 1:1. Não é só performance: `findOrCreateConversation` trata a
-- corrida de duas entregas simultâneas do webhook capturando a violação de
-- índice único (isUniqueViolation). Sem este índice esse tratamento não
-- dispararia e o mesmo grupo viraria duas conversas.
--
-- O índice do lado contato não cobre grupo: com contact_id NULL o Postgres
-- trata cada linha como distinta (NULLS DISTINCT, o padrão), então ele deixa
-- passar quantas conversas de grupo aparecerem.
CREATE UNIQUE INDEX IF NOT EXISTS cb_conversations_account_group_idx
  ON conversations (account_id, group_id) WHERE group_id IS NOT NULL;

-- ⚠️ ÚNICA mudança que RELAXA regra existente do upstream. Toda linha atual
-- tem contact_id preenchido, então nada quebra na aplicação — mas todo código
-- que faz `conversation.contact.phone` sem checar nulo passa a ter um caminho
-- possível de crash. É por isso que a fase de contenção (manter grupo fora do
-- painel, da API v1 e do seletor de negócios) vai a produção ANTES do código
-- que grava o primeiro grupo.
ALTER TABLE conversations ALTER COLUMN contact_id DROP NOT NULL;

-- O XOR é o que substitui o NOT NULL perdido acima: continua sendo impossível
-- existir conversa sem dono, só que agora "dono" pode ser contato ou grupo.
-- Validado na hora (a tabela tem dezenas de linhas; o lock é irrelevante) e as
-- linhas existentes passam todas, já que toda conversa atual tem contact_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cb_conv_contato_xor_grupo'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT cb_conv_contato_xor_grupo
      CHECK ((contact_id IS NOT NULL) <> (group_id IS NOT NULL));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3) A mensagem passa a saber quem falou
-- ------------------------------------------------------------

-- Denormalizado de propósito, sem FK para contacts: um grupo de 80 pessoas
-- criaria 80 contatos no CRM na primeira mensagem. Duas colunas de texto não
-- poluem nada. ("Salvar participante como contato" pode virar botão depois.)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS group_sender_jid  text,
  ADD COLUMN IF NOT EXISTS group_sender_name text;

-- Marcam o nosso número no grupo → destaque visual no balão. Calculado na
-- entrada porque depende do número do canal, que a UI não conhece.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions_us boolean NOT NULL DEFAULT false;

-- Estado do anexo. NULL = sem mídia, ou mídia já baixada (media_url preenchido).
--   'pending'   — não baixada; dá para buscar sob demanda
--   'failed'    — tentou e falhou; dá para tentar de novo
--   'too_large' — acima do teto de 16 MB do bucket; não adianta tentar
-- Sem esta coluna, `media_url IS NULL` seria ambíguo entre "ainda não baixei"
-- e "falhou" — e o balão não saberia se oferece o botão de baixar.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_state text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_media_state_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_media_state_check
      CHECK (media_state IS NULL OR media_state IN ('pending', 'failed', 'too_large'));
  END IF;
END $$;

-- Aviso de sistema do grupo ("Fulano entrou", "o nome mudou") vira mensagem
-- com content_type='system', para aparecer em ordem cronológica no meio da
-- conversa sem a UI ter que fundir dois streams. Exige estender o CHECK do
-- upstream — aditivo, nenhum valor existente sai.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'system'
  ));

-- ------------------------------------------------------------
-- 4) Ponteiro da mídia (tabela lateral, nunca vai ao navegador)
-- ------------------------------------------------------------

-- Para buscar o anexo DEPOIS, a Evolution precisa do payload cru do Baileys
-- ({key, message}) — que carrega as chaves de decifragem da mídia.
--
-- Tabela separada e não coluna em `messages` porque o thread do inbox faz
-- `.select("*")` em messages: uma coluna ali mandaria essas chaves para o
-- navegador de todo atendente, em toda abertura de conversa, de graça.
--
-- RLS ligada SEM POLICY PERMISSIVA: nenhum usuário logado lê esta tabela.
-- Só a service role (o webhook de entrada e a rota de download) alcança.
CREATE TABLE IF NOT EXISTS cb_message_media_ref (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cb_message_media_ref_account_idx
  ON cb_message_media_ref (account_id);

ALTER TABLE cb_message_media_ref ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 5) O interruptor por canal
-- ------------------------------------------------------------

-- Padrão FALSE é o que impede o estrago no dia do deploy: sem ele, no primeiro
-- rollout TODOS os grupos ativos daquele número despejam no inbox de uma vez —
-- incluindo os grupos pessoais de quem pareou o QR Code.
ALTER TABLE cb_channels
  ADD COLUMN IF NOT EXISTS groups_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cb_channels.groups_enabled IS
  'Recebe mensagens de grupo neste canal. FALSE por padrão — ligar é decisão explícita do operador, canal por canal.';

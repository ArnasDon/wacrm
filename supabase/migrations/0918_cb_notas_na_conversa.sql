-- ============================================================
-- 918 — Anotação interna, na conversa
--
-- Hoje a anotação vive em `contact_notes`, chaveada por CONTATO, e só pode
-- ser escrita pelo menu lateral da ficha. Passa a viver na conversa, aparecer
-- no fio do chat em ordem cronológica, ter autor visível e menção de colega.
--
-- ⚠️ POR QUE TABELA NOVA, E NÃO UMA LINHA EM `messages`
-- Estacionar a nota em `messages` daria ordenação e realtime de graça, mas
-- cobra pedágio em quatro lugares e um deles é grave: `serializeMessage`
-- (src/lib/api/v1/conversations.ts) deriva a direção de `sender_type`, então a
-- nota sairia na API pública rotulada como MENSAGEM ENVIADA AO CLIENTE — e
-- `content_type` é `string` no tipo público, então nada acusaria. Além disso
-- exigiria alargar dois CHECKs do upstream (`sender_type` e `content_type`),
-- que é superfície de conflito no merge.
--
-- ⚠️ POR QUE `conversation_id` E NÃO `contact_id`
-- É a única chave que cobre conversa 1:1 E conversa de grupo. `contact_notes`
-- tem `contact_id NOT NULL` e conversa de grupo tem `contact_id` NULO (906) —
-- reusar aquela tabela deixaria grupo sem anotação, em silêncio. Há 58 grupos
-- já sincronizados esperando o interruptor `groups_enabled`.
--
-- ⚠️ ESTA MIGRATION NÃO APAGA `contact_notes`
-- Ela cria a tabela nova e COPIA as linhas. A tabela antiga só é aposentada
-- depois de as duas telas de ficha (contact-sidebar, contact-detail-view) já
-- lerem a nova — senão o intervalo entre aplicar a migration e publicar o
-- código deixa a ficha quebrada. A remoção é migration própria.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_conversation_notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  conversation_id uuid NOT NULL,

  -- Desnormalizado para as duas telas de ficha lerem por contato sem join.
  -- NULO em conversa de grupo — grupo não tem contato.
  -- A conversão é 1:1 e estável: `idx_conversations_account_contact` é UNIQUE
  -- em (account_id, contact_id) desde a 036, então um contato tem no máximo
  -- uma conversa por conta.
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,

  -- ⚠️ SET NULL, não CASCADE: apagar o membro do `auth.users` não pode levar
  -- junto a anotação que ele deixou sobre um cliente — o histórico é do
  -- escritório, não da pessoa.
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Congelado no momento da escrita, de propósito. Quando o autor sai da
  -- conta, `remove_account_member` (018) NÃO apaga o profile: realoca para
  -- uma conta pessoal nova, e a policy de leitura deixa de enxergá-lo. Sem
  -- este carimbo a autoria vira "—" retroativamente.
  autor_nome text,

  texto text NOT NULL CHECK (btrim(texto) <> ''),

  -- `auth.users.id` dos mencionados. Array e não tabela de junção porque a
  -- menção só é lida junto com a nota, nunca consultada ao contrário.
  mencionados uuid[] NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),

  -- ⚠️ FK COMPOSTA. A ingestão e as rotas de servidor rodam em service-role e
  -- ignoram RLS: uma FK simples só garantiria "existe uma conversa com esse
  -- id", não "é uma conversa DESTA conta". O índice único (id, account_id)
  -- nasceu na 910 justamente para isto.
  CONSTRAINT cb_conversation_notes_conversa_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations(id, account_id) ON DELETE CASCADE
);

COMMENT ON TABLE cb_conversation_notes IS
  'Anotação interna da conversa — nunca sai para o cliente. Aparece no fio do chat e na ficha do contato. Substitui contact_notes.';

CREATE INDEX IF NOT EXISTS cb_conversation_notes_conversa_idx
  ON cb_conversation_notes (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS cb_conversation_notes_contato_idx
  ON cb_conversation_notes (contact_id, created_at)
  WHERE contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2) RLS
-- ------------------------------------------------------------
ALTER TABLE cb_conversation_notes ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro da conta, inclusive `viewer`.
DROP POLICY IF EXISTS cb_conversation_notes_select ON cb_conversation_notes;
CREATE POLICY cb_conversation_notes_select ON cb_conversation_notes FOR SELECT
  USING (is_account_member(account_id));

-- Apagar: o autor, OU um admin da conta.
--
-- ⚠️ O segundo termo não é conveniência, é o conserto de um impasse: como
-- `author_user_id` é ON DELETE SET NULL, assim que o autor sai do
-- `auth.users` a comparação `author_user_id = auth.uid()` vira NULL (falso) e
-- a nota ficaria INDELEVÉL para sempre pelo caminho do cliente.
DROP POLICY IF EXISTS cb_conversation_notes_delete ON cb_conversation_notes;
CREATE POLICY cb_conversation_notes_delete ON cb_conversation_notes FOR DELETE
  USING (
    is_account_member(account_id)
    AND (
      author_user_id = auth.uid()
      OR is_account_member(account_id, 'admin')
    )
  );

-- ⚠️ SEM POLICY DE INSERT, DE PROPÓSITO. A nota nasce numa rota de servidor,
-- não no navegador — porque a notificação da menção precisa gravar em
-- `notifications`, que NÃO tem policy de INSERT (a 027 diz por escrito que as
-- linhas nascem só do trigger SECURITY DEFINER). Um insert de menção vindo do
-- cliente daria 42501. Com nota e notificação saindo do mesmo lugar, também
-- ganhamos validar os mencionados e carimbar `autor_nome` no servidor.
--
-- ⚠️ E SEM POLICY DE UPDATE, porque a nota não é editável (só criar e apagar).
-- O REVOKE abaixo NÃO é redundante com a ausência de policy: verificado neste
-- banco na 912 — sem ele, o comando apenas não encontra linhas e volta
-- "0 linhas afetadas", que um bug de UI leria como sucesso. Com o REVOKE, o
-- Postgres responde 42501 e a tentativa fica visível.
REVOKE INSERT, UPDATE, TRUNCATE ON cb_conversation_notes FROM authenticated, anon;
GRANT SELECT, DELETE ON cb_conversation_notes TO authenticated;

-- ------------------------------------------------------------
-- 3) Realtime
-- ------------------------------------------------------------
-- ⚠️ Aqui o argumento da 912 SE INVERTE. A trilha de atividade ficou fora do
-- realtime porque "nenhuma ação que gera evento acontece na tela onde ela é
-- lida". A anotação é o oposto: é escrita exatamente ali, no compositor, e
-- dois atendentes na mesma conversa é o caso normal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_conversation_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cb_conversation_notes;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) Mudança das anotações que já existem
-- ------------------------------------------------------------
-- A nota de contato vira nota da conversa daquele contato. O JOIN é 1:1 pelo
-- índice único (account_id, contact_id).
--
-- Contato SEM conversa não tem para onde ir e é deixado para trás de
-- propósito: medido antes de escrever esta migration — 65 contatos, 1 sem
-- conversa, 2 anotações, NENHUMA delas de contato sem conversa. A cópia é
-- sem perda hoje. A contagem abaixo existe para que isso seja verificado de
-- novo no momento em que a migration rodar, e não apenas quando foi escrita.
DO $$
DECLARE
  origem integer;
  copiadas integer;
BEGIN
  SELECT count(*) INTO origem FROM contact_notes;

  INSERT INTO cb_conversation_notes (
    account_id, conversation_id, contact_id, author_user_id, texto, created_at
  )
  SELECT n.account_id, v.id, n.contact_id, n.user_id, n.note_text, n.created_at
    FROM contact_notes n
    JOIN conversations v
      ON v.contact_id = n.contact_id
     AND v.account_id = n.account_id
   WHERE btrim(n.note_text) <> '';

  GET DIAGNOSTICS copiadas = ROW_COUNT;

  IF copiadas <> origem THEN
    RAISE WARNING
      'cb_conversation_notes: % de % anotações copiadas. As demais são de contato sem conversa (ou texto vazio) e continuam em contact_notes.',
      copiadas, origem;
  END IF;
END $$;

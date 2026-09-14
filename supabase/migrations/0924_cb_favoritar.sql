-- ============================================================
-- 924 — Favoritar conversa (F2 fatia A, commit 1)
--
-- Marcar uma conversa para achá-la depois. É o único item de schema da fase
-- dos filtros: os outros recortes (status, canal, responsável, etiqueta,
-- empresa, etapa, não lidas) já têm onde ler.
--
-- ⚠️ POR QUE TABELA, E NÃO UMA COLUNA `favorita boolean` EM `conversations`
-- Porque a marca é DE CADA MEMBRO (decisão P2.3 do operador), e a policy
-- `conversations_update` deixa qualquer membro da conta escrever na linha.
-- Uma coluna seria uma marca compartilhada: o colega desmarcaria a sua, e a
-- tela não teria como mostrar isso — some da lista de quem marcou, sem erro,
-- sem aviso. Tabela de junção é a forma que o "por membro" tem no banco.
--
-- ⚠️ POR QUE `auth.users.id` E NÃO `profiles.id`
-- Mesma chave que `conversations.assigned_agent_id` e que
-- `cb_conversation_notes.author_user_id` (918) usam, e a mesma que
-- `auth.uid()` devolve na RLS. Usar o id do profile obrigaria um join no
-- meio de toda policy.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_conversation_favorites (
  -- ⚠️ CASCADE aqui, ao contrário do SET NULL da anotação (918), e a
  -- diferença é de propósito: anotação é histórico DO ESCRITÓRIO sobre um
  -- cliente e sobrevive a quem escreveu; favorito é um marcador PESSOAL, que
  -- não quer dizer nada depois que a pessoa deixa de existir.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  conversation_id uuid NOT NULL,

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Nesta ordem porque a consulta que existe é "quais são as MINHAS", feita
  -- uma vez por montagem da lista. Assim ela sai direto da PK.
  PRIMARY KEY (user_id, conversation_id),

  -- ⚠️ FK COMPOSTA, como em `conversations` (903), `deals` (908) e nas
  -- anotações (918). Uma FK simples em `conversation_id` só garantiria "existe
  -- uma conversa com esse id" — não "é uma conversa DESTA conta". A RLS cobre
  -- o caminho do navegador, mas qualquer rota de servidor roda em service-role
  -- e passa por cima dela; a FK é a garantia que não depende de quem escreve.
  CONSTRAINT cb_conversation_favorites_conversa_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations(id, account_id) ON DELETE CASCADE
);

COMMENT ON TABLE cb_conversation_favorites IS
  'Conversa marcada por um membro para achar depois. É PESSOAL: cada membro tem a sua lista, e ninguém vê nem desmarca a do outro.';

-- Sem este índice o CASCADE de apagar uma conversa varre a tabela inteira: a
-- PK começa por `user_id`, então não serve para procurar por conversa.
CREATE INDEX IF NOT EXISTS cb_conversation_favorites_conversa_idx
  ON cb_conversation_favorites (conversation_id, account_id);

-- ------------------------------------------------------------
-- 2) RLS — cada um só enxerga e mexe no que é seu
-- ------------------------------------------------------------
ALTER TABLE cb_conversation_favorites ENABLE ROW LEVEL SECURITY;

-- ⚠️ `user_id = auth.uid()` em TODAS as três policies, inclusive na leitura.
-- Sem isso, o favorito de um colega apareceria marcado na sua tela — e o
-- filtro "favoritas" mostraria as dele misturadas com as suas, sem nada
-- explicando por quê.
--
-- `is_account_member` continua no AND porque a marca pertence a uma conta:
-- sozinha, `user_id = auth.uid()` deixaria alguém guardar uma linha com o
-- `account_id` de outra conta. A FK composta já barraria a conversa, mas a
-- policy é a defesa que não depende de a FK estar certa.
DROP POLICY IF EXISTS cb_conversation_favorites_select ON cb_conversation_favorites;
CREATE POLICY cb_conversation_favorites_select ON cb_conversation_favorites FOR SELECT
  USING (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS cb_conversation_favorites_insert ON cb_conversation_favorites;
CREATE POLICY cb_conversation_favorites_insert ON cb_conversation_favorites FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS cb_conversation_favorites_delete ON cb_conversation_favorites;
CREATE POLICY cb_conversation_favorites_delete ON cb_conversation_favorites FOR DELETE
  USING (user_id = auth.uid() AND is_account_member(account_id));

-- ⚠️ SEM POLICY DE UPDATE: não há o que atualizar — marcar é INSERT, desmarcar
-- é DELETE. E o REVOKE abaixo NÃO é redundante com a ausência da policy: este
-- banco já provou isso duas vezes (912 e 918). Sem o REVOKE, um UPDATE apenas
-- não encontra linha e volta "0 linhas afetadas" — que qualquer código de tela
-- lê como sucesso. Com o REVOKE, o Postgres responde 42501 e o engano aparece.
REVOKE UPDATE, TRUNCATE ON cb_conversation_favorites FROM authenticated, anon;
REVOKE ALL ON cb_conversation_favorites FROM anon;
GRANT SELECT, INSERT, DELETE ON cb_conversation_favorites TO authenticated;

-- ------------------------------------------------------------
-- 3) Conferir o RESULTADO, não a intenção
-- ------------------------------------------------------------
-- Convenção do CLAUDE.md, escrita depois de três enganos seguidos com REVOKE
-- (903/912 revogaram só dos papéis; 914 revogou só de PUBLIC — nenhum dos dois
-- teve efeito, e só o teste pegou).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_conversation_favorites'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '924: RLS não ficou ligada em cb_conversation_favorites.';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_conversation_favorites'
  ) <> 3 THEN
    RAISE EXCEPTION '924: esperava 3 policies (select/insert/delete), achei %.',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cb_conversation_favorites');
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_conversation_favorites', 'UPDATE') THEN
    RAISE EXCEPTION '924: authenticated ainda pode UPDATE — o REVOKE não pegou.';
  END IF;

  IF has_table_privilege('anon', 'public.cb_conversation_favorites', 'SELECT') THEN
    RAISE EXCEPTION '924: anon ainda enxerga a tabela.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_conversation_favorites', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_conversation_favorites', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.cb_conversation_favorites', 'SELECT') THEN
    RAISE EXCEPTION '924: authenticated perdeu um privilégio que PRECISA ter — marcar/desmarcar sai do navegador.';
  END IF;
END $$;

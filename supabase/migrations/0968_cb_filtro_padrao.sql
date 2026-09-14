-- ============================================================
-- 968 — O filtro PADRÃO da caixa de entrada (Fase A3)
--
-- "Quero abrir o inbox já recortado, e tirar o recorte à mão quando quiser
-- ver tudo." O filtro é da conta (967); a escolha de qual deles nasce
-- aplicado é DE CADA UM.
--
-- ⚠️ POR QUE TABELA, E NÃO UMA COLUNA `padrao boolean` NA 967
-- Porque a 967 é compartilhada: uma coluna ali seria uma marca única para a
-- conta inteira, e o padrão de um apagaria o do outro — em silêncio, e sem a
-- tela ter como mostrar isso. É palavra por palavra o raciocínio que fez a
-- `cb_conversation_favorites` (924) virar tabela em vez de coluna em
-- `conversations`.
--
-- ⚠️ UMA LINHA POR PESSOA POR CONTA. A PK `(user_id, account_id)` é o que
-- torna "trocar o padrão" um upsert de uma linha só — e ela é um índice
-- TOTAL, então serve de alvo de `ON CONFLICT` (não é o caso dos índices
-- parciais da 903, onde o upsert não funciona).
-- ============================================================

-- ------------------------------------------------------------
-- 0) O pai ganha a chave que a FK composta exige
--
-- ⚠️ Redundante com a PK `(id)` para o Postgres, e de propósito: sem um único
-- em `(id, account_id)` não existe FK composta possível, e sem ela um caminho
-- de servidor (service-role, que passa por cima da RLS) poderia gravar o
-- padrão de alguém apontando para o filtro de OUTRA conta. Hoje não há rota
-- nenhuma nesta tabela; a FK é a garantia que não depende disso continuar
-- verdade.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS cb_inbox_saved_filters_id_conta_idx
  ON cb_inbox_saved_filters (id, account_id);

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_inbox_filtro_padrao (
  -- CASCADE: a preferência é PESSOAL e não quer dizer nada depois que a
  -- pessoa deixa de existir (mesma escolha da 924, e o oposto do
  -- `criado_por` da 967, que é autoria de um recorte do escritório).
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  filtro_id uuid NOT NULL,

  definido_em timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, account_id),

  -- ⚠️ CASCADE aqui é load-bearing: apagar um filtro tem de apagar o padrão de
  -- quem o escolheu. Com RESTRICT, um admin não conseguiria apagar o filtro
  -- que alguém usa (e a mensagem de erro não diria quem); com SET NULL,
  -- sobraria uma linha apontando para nada.
  CONSTRAINT cb_inbox_filtro_padrao_filtro_fkey
    FOREIGN KEY (filtro_id, account_id)
    REFERENCES cb_inbox_saved_filters(id, account_id) ON DELETE CASCADE
);

COMMENT ON TABLE cb_inbox_filtro_padrao IS
  'Qual filtro salvo nasce aplicado na caixa de entrada DESTE membro. O filtro é da conta (967); a escolha é pessoal — o "SDR" pode ser o padrão de um e de mais ninguém.';

-- Sem este índice o CASCADE de apagar um filtro varre a tabela: a PK começa
-- por `user_id` e não serve para procurar por filtro.
CREATE INDEX IF NOT EXISTS cb_inbox_filtro_padrao_filtro_idx
  ON cb_inbox_filtro_padrao (filtro_id, account_id);

-- ------------------------------------------------------------
-- 2) RLS — cada um só enxerga e mexe no SEU padrão
-- ------------------------------------------------------------
ALTER TABLE cb_inbox_filtro_padrao ENABLE ROW LEVEL SECURITY;

-- ⚠️ `user_id = auth.uid()` nas QUATRO policies, inclusive na leitura. Sem
-- isso o inbox nasceria recortado pelo padrão de um colega, e não haveria
-- nada na tela dizendo de onde aquilo veio.
--
-- `is_account_member` continua no AND: sozinho, `user_id = auth.uid()`
-- deixaria alguém guardar uma linha com o `account_id` de outra conta.
DROP POLICY IF EXISTS cb_inbox_filtro_padrao_select ON cb_inbox_filtro_padrao;
CREATE POLICY cb_inbox_filtro_padrao_select ON cb_inbox_filtro_padrao FOR SELECT
  USING (user_id = auth.uid() AND is_account_member(account_id));

-- ⚠️ Escolher o padrão é de QUALQUER membro, e não de admin: o filtro é do
-- escritório, a preferência é de quem usa. Um `viewer` que não pudesse
-- escolher o próprio recorte de abertura perderia o ponto inteiro da feature.
DROP POLICY IF EXISTS cb_inbox_filtro_padrao_insert ON cb_inbox_filtro_padrao;
CREATE POLICY cb_inbox_filtro_padrao_insert ON cb_inbox_filtro_padrao FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

-- Trocar o padrão é UPDATE (o upsert cai aqui pela PK). USING e WITH CHECK:
-- só o USING deixaria mover a linha para outro `user_id` no mesmo update.
DROP POLICY IF EXISTS cb_inbox_filtro_padrao_update ON cb_inbox_filtro_padrao;
CREATE POLICY cb_inbox_filtro_padrao_update ON cb_inbox_filtro_padrao FOR UPDATE
  USING (user_id = auth.uid() AND is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS cb_inbox_filtro_padrao_delete ON cb_inbox_filtro_padrao;
CREATE POLICY cb_inbox_filtro_padrao_delete ON cb_inbox_filtro_padrao FOR DELETE
  USING (user_id = auth.uid() AND is_account_member(account_id));

-- As duas metades, sempre (convenção do CLAUDE.md).
REVOKE ALL ON TABLE cb_inbox_filtro_padrao FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cb_inbox_filtro_padrao TO authenticated;

-- ------------------------------------------------------------
-- 3) Conferir o RESULTADO, não a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_policies int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_inbox_filtro_padrao'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '968: RLS não ficou ligada em cb_inbox_filtro_padrao.';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cb_inbox_filtro_padrao';
  IF v_policies <> 4 THEN
    RAISE EXCEPTION '968: esperava 4 policies, achei %.', v_policies;
  END IF;

  IF has_table_privilege('anon', 'public.cb_inbox_filtro_padrao', 'SELECT') THEN
    RAISE EXCEPTION '968: anon ainda enxerga a tabela — o REVOKE não pegou.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_inbox_filtro_padrao', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_inbox_filtro_padrao', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_inbox_filtro_padrao', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.cb_inbox_filtro_padrao', 'DELETE') THEN
    RAISE EXCEPTION '968: authenticated perdeu um privilégio que PRECISA ter.';
  END IF;

  -- A FK composta é o ponto da seção 0 — sem ela a migration "passa" e a
  -- garantia some.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cb_inbox_filtro_padrao_filtro_fkey'
       AND confrelid = 'public.cb_inbox_saved_filters'::regclass
       AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION '968: a FK para o filtro não ficou COMPOSTA (filtro_id, account_id).';
  END IF;
END $$;

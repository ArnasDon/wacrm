-- ============================================================
-- 974 — Filtro salvo da caixa de entrada passa a ser DE CADA MEMBRO
--
-- Decisão do operador em 2026-09-03: "os filtros salvos são individuais por
-- membro — cada um cria e edita os seus; não são distribuíveis para todo
-- mundo". A 967 os fez DA CONTA (qualquer membro lê, admin escreve) com um
-- `criado_por` que não mandava em nada. Agora a linha tem DONO (`user_id`),
-- e a policy é "só as minhas", para qualquer membro da conta.
--
-- ⚠️ `ON DELETE CASCADE` em `auth.users`, DE PROPÓSITO — e é a exceção à
-- regra do CLAUDE.md sobre contatos/conversas: aqueles são dado do
-- ESCRITÓRIO carimbado com quem clicou; isto é preferência PESSOAL de quem
-- saiu, e ninguém mais a enxerga. Mantê-la órfã seria lixo invisível.
--
-- Backfill: `criado_por` quando existe (em produção, os 2 filtros têm), senão
-- o dono da conta. A conferência DERIVA do dado e pula em banco vazio.
--
-- O padrão (968, `cb_inbox_filtro_padrao`) já era por membro e continua: a
-- FK composta `(filtro_id, account_id)` segue de pé; a tela só oferece os
-- filtros do próprio membro, então o padrão só aponta para filtro dele.
-- ============================================================

-- ⚠️ `DEFAULT auth.uid()`: a migration é aplicada ANTES do deploy (como a
-- 973), e nessa janela o app em produção ainda insere sem `user_id` — sem o
-- default, salvar um filtro estouraria o NOT NULL até o rollout. Com ele, o
-- insert antigo carimba quem chamou, que é exatamente a regra nova.
ALTER TABLE cb_inbox_saved_filters
  ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE cb_inbox_saved_filters f
SET user_id = COALESCE(f.criado_por, a.owner_user_id)
FROM accounts a
WHERE a.id = f.account_id AND f.user_id IS NULL;

ALTER TABLE cb_inbox_saved_filters ALTER COLUMN user_id SET NOT NULL;

COMMENT ON COLUMN cb_inbox_saved_filters.user_id IS
  'Dono do filtro (974): só ele lê e escreve. Preferência pessoal — cai junto com o login.';

-- Nome único por MEMBRO, não mais por conta: dois membros podem ter "SDR".
DROP INDEX IF EXISTS cb_inbox_saved_filters_nome_idx;
CREATE UNIQUE INDEX IF NOT EXISTS cb_inbox_saved_filters_nome_por_membro_idx
  ON cb_inbox_saved_filters (account_id, user_id, lower(btrim(nome)));

CREATE INDEX IF NOT EXISTS cb_inbox_saved_filters_user_idx
  ON cb_inbox_saved_filters (user_id, account_id);

-- Policies: "só as minhas", para qualquer membro da conta.
DROP POLICY IF EXISTS cb_inbox_saved_filters_select ON cb_inbox_saved_filters;
DROP POLICY IF EXISTS cb_inbox_saved_filters_insert ON cb_inbox_saved_filters;
DROP POLICY IF EXISTS cb_inbox_saved_filters_update ON cb_inbox_saved_filters;
DROP POLICY IF EXISTS cb_inbox_saved_filters_delete ON cb_inbox_saved_filters;

CREATE POLICY cb_inbox_saved_filters_select ON cb_inbox_saved_filters FOR SELECT
  USING (user_id = auth.uid() AND is_account_member(account_id));

CREATE POLICY cb_inbox_saved_filters_insert ON cb_inbox_saved_filters FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

-- USING e WITH CHECK: só o USING deixaria mover a linha para outro dono no
-- mesmo update; só o WITH CHECK deixaria editar linha que não se pode ver.
CREATE POLICY cb_inbox_saved_filters_update ON cb_inbox_saved_filters FOR UPDATE
  USING (user_id = auth.uid() AND is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

CREATE POLICY cb_inbox_saved_filters_delete ON cb_inbox_saved_filters FOR DELETE
  USING (user_id = auth.uid() AND is_account_member(account_id));

-- Privilégios por escrito (o default privilege do Supabase não existe em
-- banco novo): o anon continua sem nada; authenticated mantém o que a 967 deu.
REVOKE ALL ON TABLE cb_inbox_saved_filters FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cb_inbox_saved_filters TO authenticated;

-- Conferências.
DO $$
DECLARE
  v_sem_dono int;
  v_policies int;
BEGIN
  SELECT count(*) INTO v_sem_dono FROM cb_inbox_saved_filters WHERE user_id IS NULL;
  IF v_sem_dono > 0 THEN
    RAISE EXCEPTION '974: % filtro(s) sem dono depois do backfill', v_sem_dono;
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
  WHERE tablename = 'cb_inbox_saved_filters'
    AND policyname IN (
      'cb_inbox_saved_filters_select', 'cb_inbox_saved_filters_insert',
      'cb_inbox_saved_filters_update', 'cb_inbox_saved_filters_delete'
    )
    AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%');
  IF v_policies <> 4 THEN
    RAISE EXCEPTION '974: esperava 4 policies por dono, achei %', v_policies;
  END IF;

  IF has_table_privilege('anon', 'cb_inbox_saved_filters', 'SELECT') THEN
    RAISE EXCEPTION '974: anon ainda enxerga a tabela — o REVOKE não pegou.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'cb_inbox_saved_filters', 'INSERT') THEN
    RAISE EXCEPTION '974: authenticated perdeu o INSERT.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cb_inbox_saved_filters) THEN
    RAISE NOTICE '974: sem filtro salvo, nada mais a provar.';
  END IF;
END $$;

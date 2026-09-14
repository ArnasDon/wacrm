-- 981_cb_apagar_contato_so_admin.sql
--
-- `contacts_delete` passa de `agent` para `admin`.
--
-- Decisão do operador (08/09/2026, simulando o perfil "Bancário -
-- Jurídico"): o atendente edita nome e telefone do cliente, e NÃO apaga a
-- ficha. Apagar contato é destrutivo de verdade — `conversations` cascateia
-- de `contacts` e leva junto todas as mensagens daquele cliente, que são do
-- escritório, não de quem clicou.
--
-- ⚠️ Só o DELETE muda. `contacts_insert` e `contacts_update` continuam em
-- `agent`: cadastrar e corrigir a ficha é trabalho de atendimento, e subir
-- os três tiraria do atendente o que ele precisa para trabalhar.
--
-- ⚠️ Par obrigatório na tela: os dois caminhos de exclusão da página de
-- contatos (o item do menu da linha e o botão de seleção múltipla) passaram
-- a exigir `canDeleteContacts`. Sem os dois lados, a policy recusaria em
-- silêncio — RLS que barra DELETE devolve 0 linhas SEM erro, e a tela diria
-- "contato excluído" sobre um contato intacto.
--
-- Não afeta `merge_duplicate_contacts` (SECURITY DEFINER, roda com o
-- privilégio do dono) nem os caminhos server-side em service role.

DROP POLICY IF EXISTS contacts_delete ON contacts;

CREATE POLICY contacts_delete ON contacts
  FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

DO $$
DECLARE
  v_qual text;
BEGIN
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_delete';
  IF v_qual IS NULL OR v_qual NOT LIKE '%admin%' THEN
    RAISE EXCEPTION '981: contacts_delete não ficou restrita a admin (%).', coalesce(v_qual, 'ausente');
  END IF;

  -- E as outras duas NÃO podem ter subido junto: o atendente ainda cadastra
  -- e corrige ficha.
  SELECT with_check INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_insert';
  IF v_qual IS NULL OR v_qual NOT LIKE '%agent%' THEN
    RAISE EXCEPTION '981: contacts_insert deveria continuar em agent (%).', coalesce(v_qual, 'ausente');
  END IF;

  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'contacts' AND policyname = 'contacts_update';
  IF v_qual IS NULL OR v_qual NOT LIKE '%agent%' THEN
    RAISE EXCEPTION '981: contacts_update deveria continuar em agent (%).', coalesce(v_qual, 'ausente');
  END IF;
END $$;

-- ============================================================
-- 956 — Quem está com a CONVERSA aberta (presença por conversa)
--
-- O cabeçalho do fio mostra, discreto, quais OUTROS membros estão com a
-- mesma conversa aberta agora (pedido do operador em 2026-08-30, referência
-- Kommo). A `member_presence` do upstream (024) responde "está no sistema?"
-- (online/away); esta responde "está NESTA conversa?" — e é tabela NOSSA,
-- separada de propósito: zero conflito de merge e zero risco de um merge
-- futuro reescrever a RPC do upstream por cima da nossa.
--
-- Desenho (o mesmo da 024):
--   - UMA linha por membro (PK user_id), com a ÚLTIMA conversa aberta;
--     NULL = fora de conversa. O cliente re-marca a cada troca e numa
--     batida de ~30 s; "saiu" NUNCA depende de um write de unload — o
--     leitor deriva por staleness (visto_em velho = não está mais).
--   - Escrita SÓ pela RPC SECURITY DEFINER (sem policy de INSERT/UPDATE/
--     DELETE), com a conta derivada do profile do chamador — cliente não
--     escolhe em qual conta aparece.
--   - Leitura por qualquer membro da conta (is_account_member), como o
--     roster.
-- ============================================================

CREATE TABLE IF NOT EXISTS cb_conversa_aberta (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- CASCADE: apagar a conversa apaga a marcação — linha órfã aqui não
  -- significa nada e seguraria a exclusão sem motivo.
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  visto_em        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cb_conversa_aberta IS
  'Ultima conversa aberta por membro (presenca por conversa, 956). '
  'NULL = fora de conversa; "saiu" deriva de visto_em velho, nunca de '
  'write de unload. Escrita so pela RPC cb_marcar_conversa_aberta.';

CREATE INDEX IF NOT EXISTS cb_conversa_aberta_conta_idx
  ON cb_conversa_aberta (account_id);

-- ---- RLS + privilégios --------------------------------------
-- ⚠️ Banco VAZIO não tem os default privileges do Supabase: todo privilégio
-- conferido abaixo é CONCEDIDO aqui por escrito (regra das nove migrations
-- que reprovaram no primeiro replay do CI).

ALTER TABLE cb_conversa_aberta ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE cb_conversa_aberta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_conversa_aberta TO authenticated;
GRANT ALL    ON TABLE cb_conversa_aberta TO service_role;

DROP POLICY IF EXISTS cb_conversa_aberta_select ON cb_conversa_aberta;
CREATE POLICY cb_conversa_aberta_select ON cb_conversa_aberta FOR SELECT
  USING (is_account_member(account_id));

-- Sem policy de escrita, DE PROPÓSITO: tudo passa pela RPC abaixo.

-- ---- RPC de marcação ----------------------------------------
-- Upsert por PK (índice TOTAL — a armadilha de ON CONFLICT da 903 é só
-- para índices parciais). Conversa de outra conta ou apagada no meio do
-- caminho vira NULL em silêncio: erro aqui derrubaria a batida por causa
-- de uma corrida banal, e responder diferente confirmaria a existência do
-- id a quem chuta.

CREATE OR REPLACE FUNCTION public.cb_marcar_conversa_aberta(
  p_conversation_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_conversa uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account
    FROM profiles
   WHERE user_id = auth.uid();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT id INTO v_conversa
      FROM conversations
     WHERE id = p_conversation_id
       AND account_id = v_account;
  END IF;

  INSERT INTO cb_conversa_aberta (user_id, account_id, conversation_id, visto_em)
  VALUES (auth.uid(), v_account, v_conversa, now())
  ON CONFLICT (user_id) DO UPDATE
    SET conversation_id = excluded.conversation_id,
        account_id      = excluded.account_id,
        visto_em        = now();
END;
$$;

-- É o NAVEGADOR que chama (como touch_presence): revogar de PUBLIC tira de
-- todo mundo que dependia dele — o GRANT de volta é para authenticated E
-- service_role, por escrito (lição da 935).
REVOKE EXECUTE ON FUNCTION cb_marcar_conversa_aberta(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cb_marcar_conversa_aberta(uuid) TO authenticated, service_role;

-- ---- realtime -----------------------------------------------
-- ⚠️ SEM lista de colunas no ADD TABLE (lição da 909: lista fixa congela o
-- payload — coluna adicionada depois não viaja).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cb_conversa_aberta'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cb_conversa_aberta;
  END IF;
END $$;

-- ---- Conferência — o resultado, nunca a intenção -------------
-- Nada aqui exige dado: só catálogo. Funciona igual em produção e no
-- replay do CI contra banco limpo.
DO $$
BEGIN
  IF has_table_privilege('anon', 'cb_conversa_aberta', 'SELECT') THEN
    RAISE EXCEPTION 'anon ainda le cb_conversa_aberta';
  END IF;
  IF NOT has_table_privilege('authenticated', 'cb_conversa_aberta', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated NAO le cb_conversa_aberta';
  END IF;
  IF has_table_privilege('authenticated', 'cb_conversa_aberta', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated ainda escreve direto em cb_conversa_aberta';
  END IF;
  IF NOT has_table_privilege('service_role', 'cb_conversa_aberta', 'SELECT') THEN
    RAISE EXCEPTION 'service_role NAO le cb_conversa_aberta';
  END IF;

  IF has_function_privilege('anon', 'cb_marcar_conversa_aberta(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa cb_marcar_conversa_aberta';
  END IF;
  IF NOT has_function_privilege('authenticated', 'cb_marcar_conversa_aberta(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated NAO executa cb_marcar_conversa_aberta';
  END IF;
  IF NOT has_function_privilege('service_role', 'cb_marcar_conversa_aberta(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role NAO executa cb_marcar_conversa_aberta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cb_conversa_aberta'
  ) THEN
    RAISE EXCEPTION 'cb_conversa_aberta fora da publicacao realtime';
  END IF;

  RAISE NOTICE '956 OK — tabela fechada, RPC aberta a authenticated, realtime ligado';
END $$;

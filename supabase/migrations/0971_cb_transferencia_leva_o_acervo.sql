-- ============================================================
-- 971 — transferir a posse LEVA o acervo do escritório junto
--
-- `contacts.user_id`, `conversations.user_id` e `custom_fields.user_id` são
-- `NOT NULL REFERENCES auth.users ON DELETE CASCADE` (001), e a regra do
-- fork (plano de 31/08, F2) é gravar neles o DONO da conta — nunca o
-- membro que clicou — para o offboarding de uma pessoa não apagar o
-- histórico de todo cliente. A regra tinha um buraco na PRÓPRIA posse: a
-- `transfer_account_ownership` (018/965) trocava `accounts.owner_user_id`
-- e os papéis, e deixava tudo o que foi criado no mandato do dono antigo
-- carimbado com ele. O dono antigo vira admin comum, removível; e
-- `accounts.owner_user_id` é ON DELETE RESTRICT — quer dizer que o dono
-- VIGENTE nunca é apagável do `auth.users`, e o primeiro dia em que o
-- ex-dono pode ser apagado é justamente o dia seguinte à transferência.
-- Apagá-lo levaria contatos, conversas, mensagens e os valores de todo
-- campo personalizado (achado do Codex no PR #90).
--
-- O que muda: a transferência passa a REPARENTAR, na mesma transação, toda
-- linha dessas três tabelas da conta que não esteja no novo dono — e o
-- backfill abaixo faz o mesmo uma vez, para as contas existentes. Medido em
-- produção em 01/09: 0 linhas fora do dono nas três tabelas (o backfill é
-- no-op lá; existe para qualquer outro banco e para fixar o invariante).
--
-- ESCOPO, de propósito: SÓ as três tabelas que o código carimba com o dono
-- (`ownerUserId`) e onde `user_id` não serve de filtro por pessoa. Outras
-- tabelas com o mesmo CASCADE (tags, message_templates, pipelines,
-- automations, flows, broadcasts…) guardam QUEM CRIOU e ainda filtram por
-- essa coluna em telas do upstream (Etiquetas, Modelos, visão geral); movê-las
-- mudaria o que cada pessoa vê — é decisão de produto, registrada na §6 do
-- plano de 31/08 (M24), não carona desta migration.
--
-- Nenhuma constraint única envolve `user_id` nas três tabelas (medido), então
-- o reparent não colide. As FKs compostas por `account_id` continuam
-- garantindo que o novo dono é da MESMA conta (a função já confere isso
-- antes de escrever). `conversations` e `contacts` têm `set_updated_at`:
-- o reparent carimba `updated_at` — aceitável numa operação rara.
--
-- `CREATE OR REPLACE` preserva a ACL (GRANT a authenticated), como a 965.
-- O corpo é o da 965 mais os três UPDATEs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Demote current owner first so the temporary state where the
  -- account has zero owners is never visible — both writes happen
  -- in the same function transaction.
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  -- ⚠️ 965: `perfil_id = NULL` junto com a promoção. Dono não tem perfil
  -- (CHECK da 956 barra papel_base='owner'); deixar o vínculo antigo de pé
  -- criava a divergência papel×perfil que a 962 barra no set_member_role —
  -- aberta por este caminho, e irremovível pela UI (atribuir recusa owner).
  UPDATE profiles SET account_role = 'owner', perfil_id = NULL
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;

  -- ⚠️ 971: o acervo durável vai junto. Tudo o que a conta carimbou com o
  -- dono antigo (ou com qualquer outro membro, por caminho antigo) passa a
  -- ser do novo dono — é o CASCADE de `auth.users` que exige isto: o dono
  -- antigo acaba de virar removível.
  UPDATE contacts SET user_id = p_new_owner_user_id
  WHERE account_id = v_caller_account_id AND user_id <> p_new_owner_user_id;

  UPDATE conversations SET user_id = p_new_owner_user_id
  WHERE account_id = v_caller_account_id AND user_id <> p_new_owner_user_id;

  UPDATE custom_fields SET user_id = p_new_owner_user_id
  WHERE account_id = v_caller_account_id AND user_id <> p_new_owner_user_id;
END;
$$;

-- O par explícito, mesmo sendo REPLACE (a ACL da 018 sobrevive): a regra da
-- casa manda a migration conceder o que confere, sem depender de herança.
ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;

-- ============================================================
-- Backfill (idempotente): o invariante "acervo durável é do dono" para as
-- contas que já existem. Em banco vazio não há linha e o UPDATE é no-op.
-- ============================================================
UPDATE contacts c SET user_id = a.owner_user_id
FROM accounts a
WHERE a.id = c.account_id AND c.user_id <> a.owner_user_id;

UPDATE conversations c SET user_id = a.owner_user_id
FROM accounts a
WHERE a.id = c.account_id AND c.user_id <> a.owner_user_id;

UPDATE custom_fields c SET user_id = a.owner_user_id
FROM accounts a
WHERE a.id = c.account_id AND c.user_id <> a.owner_user_id;

-- ============================================================
-- Conferência — definição + invariante (afirma AUSÊNCIA, seguro em banco
-- vazio; nunca exige dado)
-- ============================================================
DO $$
DECLARE
  v_def TEXT;
  v_fora BIGINT;
BEGIN
  v_def := pg_get_functiondef('public.transfer_account_ownership(uuid)'::regprocedure);

  IF v_def !~ 'UPDATE contacts SET user_id'
     OR v_def !~ 'UPDATE conversations SET user_id'
     OR v_def !~ 'UPDATE custom_fields SET user_id' THEN
    RAISE EXCEPTION '971: a função não reparenta as três tabelas — o REPLACE não pegou';
  END IF;

  -- A 965 tem de continuar dentro: o REPLACE reescreve o corpo inteiro.
  IF v_def !~ 'perfil_id' THEN
    RAISE EXCEPTION '971: o REPLACE perdeu o perfil_id = NULL da 965';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.transfer_account_ownership(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION '971: authenticated perdeu o EXECUTE — conceda de volta';
  END IF;

  SELECT count(*) INTO v_fora FROM (
    SELECT 1 FROM contacts c JOIN accounts a ON a.id = c.account_id WHERE c.user_id <> a.owner_user_id
    UNION ALL
    SELECT 1 FROM conversations c JOIN accounts a ON a.id = c.account_id WHERE c.user_id <> a.owner_user_id
    UNION ALL
    SELECT 1 FROM custom_fields c JOIN accounts a ON a.id = c.account_id WHERE c.user_id <> a.owner_user_id
  ) s;
  IF v_fora > 0 THEN
    RAISE EXCEPTION '971: % linha(s) do acervo durável ainda fora do dono depois do backfill', v_fora;
  END IF;

  RAISE NOTICE '971 OK — transferência reparenta contacts/conversations/custom_fields; backfill sem sobras';
END $$;

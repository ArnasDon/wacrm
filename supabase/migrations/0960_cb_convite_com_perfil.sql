-- ============================================================
-- 960 — o convite carrega o perfil de acesso
--
-- Fase 6 dos perfis. Achado do review do Codex sobre o plano:
-- `account_invitations` (017) guarda só `role`, e `redeem_invitation` copia
-- só esse papel para o profile de quem aceita. Sem esta migration, o perfil
-- escolhido na hora de convidar NÃO sobrevive até o aceite — e como
-- `perfil_id` nulo significa SEM RESTRIÇÃO (956), todo membro novo entraria
-- vendo TUDO. É o oposto exato do objetivo, no caso que motivou a feature:
-- convidar o advogado do trabalhista.
--
-- Duas peças:
--   1. coluna `perfil_id` em `account_invitations`, com a MESMA FK composta
--      da 957 — service-role ignora RLS, e a FK simples aceitaria perfil de
--      outra conta;
--   2. `redeem_invitation` recriada. ⚠️ `CREATE OR REPLACE` substitui o corpo
--      INTEIRO, e a função carrega as guardas que decidem quem entra na conta
--      (sole-owner, conta-sem-dados, convite não expirado) — o corpo abaixo é
--      a reprodução FIEL do vigente (922) com o bloco do perfil enxertado.
--      Omitir um trecho apagaria uma guarda em silêncio; a 922 documenta esse
--      mesmo cuidado.
--
-- No aceite, o papel vem do PERFIL VIGENTE (`papel_base` de agora), não do
-- carimbo do convite: entre convidar e aceitar passam dias, e o operador pode
-- ter reconfigurado o perfil — a rota de criação carimba `role` igual ao
-- papel do perfil só como retrato e fallback (perfil apagado → SET NULL →
-- aceite cai no papel carimbado, sem perfil).
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS perfil_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_invitations_perfil_conta_fkey'
  ) THEN
    ALTER TABLE account_invitations
      ADD CONSTRAINT account_invitations_perfil_conta_fkey
      FOREIGN KEY (perfil_id, account_id)
      REFERENCES cb_perfis_de_acesso (id, account_id)
      ON DELETE SET NULL (perfil_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- redeem_invitation — corpo da 922, com o bloco do perfil (⚠️ 960)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
  -- 960: o papel e o perfil que o aceite vai gravar.
  v_papel account_role_enum;
  v_perfil_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    -- 922: aqui era a tabela antiga de anotacoes por contato. O nome dela
    -- nao pode ser escrito aqui — ver a nota da 922.
    UNION ALL SELECT 1 FROM cb_conversation_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- 960: resolve papel e perfil. O papel vem do PERFIL VIGENTE quando o
  -- convite carrega um; o carimbo do convite é o fallback (perfil apagado
  -- entre convidar e aceitar → SET NULL → v_inv.perfil_id já é NULL).
  v_papel := v_inv.role;
  v_perfil_id := NULL;
  IF v_inv.perfil_id IS NOT NULL THEN
    SELECT papel_base INTO v_papel
    FROM cb_perfis_de_acesso
    WHERE id = v_inv.perfil_id AND account_id = v_inv.account_id;
    IF FOUND THEN
      v_perfil_id := v_inv.perfil_id;
    ELSE
      v_papel := v_inv.role;  -- linha sumiu entre o SELECT do convite e aqui
    END IF;
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  -- (960: perfil_id entra no MESMO update — a FK composta de profiles é
  -- validada contra o account_id novo, que é o da conta do convite.)
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_papel,
      perfil_id = v_perfil_id
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'account_invitations'
      AND column_name = 'perfil_id'
  ) THEN
    RAISE EXCEPTION '960: account_invitations.perfil_id não foi criada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_invitations_perfil_conta_fkey'
  ) THEN
    RAISE EXCEPTION '960: a FK composta do convite não foi criada';
  END IF;
  IF pg_get_functiondef('public.redeem_invitation(text)'::regprocedure) !~ 'perfil_id' THEN
    RAISE EXCEPTION '960: redeem_invitation não menciona perfil_id — o REPLACE não pegou';
  END IF;
  -- A lição da 922, conferida de novo: o REPLACE não pode ter derrubado o
  -- EXECUTE de quem aceita convite — sem ele, NINGUÉM entra na conta.
  IF NOT has_function_privilege('authenticated', 'redeem_invitation(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '960: authenticated perdeu redeem_invitation — ninguém entra na conta';
  END IF;
END $$;

-- ============================================================
-- 922 — aposenta `contact_notes`
--
-- Autorizado pelo operador em 2026-08-01. A 918 COPIOU as anotações para
-- `cb_conversation_notes` e deixou a tabela antiga de pé; desde a Fase 1
-- nenhuma tela a lê ou escreve. Conferido imediatamente antes do DROP:
-- 2 linhas na velha, 2 na nova, **0 sem cópia correspondente** (casadas por
-- contato + texto + created_at).
--
-- ⚠️⚠️ O DROP SOZINHO QUEBRARIA DUAS FUNÇÕES VIVAS, EM SILÊNCIO.
--
-- `DROP TABLE` não reclama de referência dentro de corpo de função: o
-- PL/pgSQL só resolve o nome da tabela na hora de EXECUTAR. O DROP passaria
-- limpo e o estrago apareceria depois, em produção, como
-- "relation contact_notes does not exist" no meio de uma operação:
--
--   · `merge_duplicate_contacts` (022/036) — roda na deduplicação de contato
--     por telefone. Quebrar aqui é quebrar a ingestão de cliente repetido.
--   · `redeem_invitation` (019) — roda quando alguém ACEITA UM CONVITE para
--     a conta. Quebrar aqui é **impedir que gente nova entre no escritório**,
--     que é exatamente o que está para acontecer agora (P1.1).
--
-- Por isso as duas são recriadas ANTES do DROP, na mesma transação.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `merge_duplicate_contacts` — repõe a anotação no contato sobrevivente
-- ------------------------------------------------------------
-- ⚠️ A linha trocada NÃO é cosmética. `cb_conversation_notes.contact_id` é
-- `REFERENCES contacts(id) ON DELETE CASCADE`, e o laço termina com
-- `DELETE FROM contacts WHERE id = ANY(v_losers)`. Sem o repontamento, juntar
-- dois cadastros do mesmo cliente **apagaria as anotações internas** do
-- cadastro perdedor, sem erro e sem aviso. Era justamente o que a linha da
-- `contact_notes` fazia; ela só mudou de tabela.
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- Plain re-point: these tables have no contact-scoped unique
    -- constraint. `conversations` is ON DELETE CASCADE, so this
    -- re-point is what saves its rows (and their messages) from
    -- being deleted with the loser contact.
    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    -- 922: aqui era a tabela antiga de anotacoes por contato. Mesma
    -- funcao, tabela nova. (O nome antigo nao pode ser escrito neste
    -- comentario: a conferencia no fim do arquivo le o corpo da funcao
    -- inteiro, comentarios inclusive, e acusaria a propria explicacao.)
    UPDATE cb_conversation_notes         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    -- Conflict-guarded re-point for UNIQUE(contact_id, tag_id):
    -- move only tags the survivor doesn't already have, drop the rest.
    UPDATE contact_tags ct SET contact_id = v_survivor
      WHERE ct.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_tags s
          WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
        );
    DELETE FROM contact_tags WHERE contact_id = ANY(v_losers);

    -- Same guard for UNIQUE(contact_id, custom_field_id). Survivor's
    -- own value wins on conflict.
    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    -- flow_runs has a partial UNIQUE on active runs per contact.
    -- Re-point only NON-active runs (exempt from the partial index)
    -- to preserve history; any active loser run is left to be
    -- NULLed by its FK's ON DELETE SET NULL when the loser is
    -- removed below — avoids colliding with the survivor's active run.
    UPDATE flow_runs SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$function$;

-- ------------------------------------------------------------
-- 2. `redeem_invitation` — a checagem de "conta vazia"
-- ------------------------------------------------------------
-- Troca só o nome da tabela na lista de "esta conta tem dado?". Semântica
-- idêntica: continua perguntando se a conta pessoal do convidado tem
-- anotação. O resto da função vai reproduzido sem alteração — `CREATE OR
-- REPLACE` substitui o corpo inteiro, então omitir qualquer trecho apagaria
-- guarda de segurança (esta função decide quem entra na conta).
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
    -- nao pode ser escrito aqui — ver a nota no primeiro UPDATE acima.
    UNION ALL SELECT 1 FROM cb_conversation_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
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
-- 3. O DROP e a conferência, no mesmo bloco
-- ------------------------------------------------------------
-- Andam juntos porque a conferência precisa da contagem de ANTES para
-- perguntar a coisa certa: "o DROP levou anotação junto?". Perguntar por um
-- número absoluto — o que ela fazia — só funciona contra ESTE banco, com
-- ESTES dados; num banco novo, onde não há nada a preservar, ela reprovava
-- por não achar linhas que nunca existiram.
--
-- ⚠️ Tudo num bloco só, sem tabela temporária de apoio: `CREATE TEMP TABLE`
-- sem guarda estoura se a migration rodar duas vezes na mesma sessão, e
-- migration aqui é idempotente por regra. Uma variável não tem esse problema
-- e não deixa objeto para trás.
DO $$
DECLARE
  n_refs  integer;
  n_antes integer;
BEGIN
  SELECT count(*) INTO n_antes FROM cb_conversation_notes;

  -- `IF EXISTS` porque numa segunda passada a tabela já não está lá.
  EXECUTE 'DROP TABLE IF EXISTS contact_notes';

  IF to_regclass('public.contact_notes') IS NOT NULL THEN
    RAISE EXCEPTION '922: contact_notes continua existindo';
  END IF;

  -- Nenhuma função pode citar a tabela morta. É a asserção que valeria ouro
  -- se este DROP tivesse sido feito sozinho.
  SELECT count(*) INTO n_refs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ~ '\mcontact_notes\M';
  IF n_refs > 0 THEN
    RAISE EXCEPTION '922: % função(ões) ainda citam contact_notes', n_refs;
  END IF;

  -- As duas continuam existindo e com o privilégio que tinham antes.
  IF to_regprocedure('public.merge_duplicate_contacts()') IS NULL
     OR to_regprocedure('public.redeem_invitation(text)') IS NULL THEN
    RAISE EXCEPTION '922: uma das funções sumiu no CREATE OR REPLACE';
  END IF;
  IF has_function_privilege('anon', 'merge_duplicate_contacts()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'merge_duplicate_contacts()', 'EXECUTE') THEN
    RAISE EXCEPTION '922: o CREATE OR REPLACE reabriu merge_duplicate_contacts (913/915)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'redeem_invitation(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '922: authenticated perdeu redeem_invitation — ninguem entra na conta';
  END IF;

  -- E as anotações seguem lá — TODAS as que havia antes do DROP. Esta
  -- migration não copia nada (a cópia foi na 918); o que ela precisa provar é
  -- que derrubar a tabela velha não levou a nova junto, por uma FK ou um
  -- CASCADE esquecido. Comparar com o antes responde isso em qualquer banco.
  IF (SELECT count(*) FROM cb_conversation_notes) < n_antes THEN
    RAISE EXCEPTION '922: o DROP levou anotacoes junto (antes=%, depois=%)',
      n_antes, (SELECT count(*) FROM cb_conversation_notes);
  END IF;
END $$;

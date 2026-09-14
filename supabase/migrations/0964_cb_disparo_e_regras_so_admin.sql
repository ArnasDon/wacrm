-- ============================================================
-- 964 — automações, fluxos e disparos: a RLS acompanha a rota
--
-- A Fase 2 dos perfis (2026-08-30) decidiu que criar automação, fluxo e
-- disparo em massa é do ADMIN: um clique ali atinge centenas de clientes de
-- uma vez. A decisão foi aplicada nas ROTAS (`requireRole('admin')` em
-- `/api/automations`, `/api/flows`, `/api/whatsapp/broadcast`) e parou aí —
-- as policies de escrita continuaram como a 017 as escreveu, em
-- `is_account_member(account_id, 'agent')`.
--
-- Ou seja: a barreira existia só no caminho que o app usa. Um membro `agent`
-- chamando o PostgREST direto do navegador
-- (`.from('automations').insert(...)`) gravava a regra, e o motor — que roda
-- em service-role e não pergunta quem criou — a executava depois. É o oposto
-- da lição que a 954 registrou para o acervo: guarda que vale precisa estar
-- nas DUAS camadas.
--
-- ⚠️ As tabelas FILHAS entram junto, e não são detalhe. `automation_steps` e
-- `flow_nodes` guardam o que a regra FAZ (as mensagens que saem); deixá-las
-- em 'agent' permitiria reescrever o conteúdo de uma automação existente sem
-- nunca tocar a linha-mãe — um furo maior do que criar automação nova.
--
-- SELECT fica como está, aberto a qualquer membro da conta: ler a automação
-- não dispara nada, e a tela precisa listá-las para quem só acompanha.
--
-- Sem REVOKE nesta migration, logo sem GRANT de volta. Nada aqui depende de
-- privilégio herdado do ambiente Supabase.
-- ============================================================

-- ---- automations -----------------------------------------------
DROP POLICY IF EXISTS automations_insert ON automations;
DROP POLICY IF EXISTS automations_update ON automations;
DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_insert ON automations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY automations_update ON automations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY automations_delete ON automations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- automation_steps ------------------------------------------
DROP POLICY IF EXISTS automation_steps_modify ON automation_steps;
CREATE POLICY automation_steps_modify ON automation_steps FOR ALL USING (
  EXISTS (
    SELECT 1 FROM automations a
    WHERE a.id = automation_steps.automation_id
      AND is_account_member(a.account_id, 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM automations a
    WHERE a.id = automation_steps.automation_id
      AND is_account_member(a.account_id, 'admin')
  )
);

-- ---- flows ------------------------------------------------------
DROP POLICY IF EXISTS flows_insert ON flows;
DROP POLICY IF EXISTS flows_update ON flows;
DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_insert ON flows FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY flows_update ON flows FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY flows_delete ON flows FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- flow_nodes -------------------------------------------------
DROP POLICY IF EXISTS flow_nodes_modify ON flow_nodes;
CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND is_account_member(f.account_id, 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND is_account_member(f.account_id, 'admin')
  )
);

-- ---- broadcasts -------------------------------------------------
DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- broadcast_recipients ---------------------------------------
DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (
    SELECT 1 FROM broadcasts b
    WHERE b.id = broadcast_recipients.broadcast_id
      AND is_account_member(b.account_id, 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM broadcasts b
    WHERE b.id = broadcast_recipients.broadcast_id
      AND is_account_member(b.account_id, 'admin')
  )
);

-- ============================================================
-- Conferência — só schema, nada de dado (roda em banco VAZIO)
-- ============================================================
DO $$
DECLARE
  v_esperadas TEXT[] := ARRAY[
    'automations_insert', 'automations_update', 'automations_delete',
    'automation_steps_modify',
    'flows_insert', 'flows_update', 'flows_delete',
    'flow_nodes_modify',
    'broadcasts_insert', 'broadcasts_update', 'broadcasts_delete',
    'broadcast_recipients_modify'
  ];
  v_achadas INT;
  v_frouxas TEXT;
BEGIN
  -- Policy renomeada por um merge do upstream faria esta migration virar um
  -- no-op silencioso, e o furo voltaria sem ninguém notar.
  SELECT count(*) INTO v_achadas
  FROM pg_policies
  WHERE schemaname = 'public' AND policyname = ANY (v_esperadas);
  IF v_achadas <> array_length(v_esperadas, 1) THEN
    RAISE EXCEPTION '964: esperava % policies, achei % — alguma foi renomeada',
      array_length(v_esperadas, 1), v_achadas;
  END IF;

  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_frouxas
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = ANY (v_esperadas)
    AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%''agent''%';
  IF v_frouxas IS NOT NULL THEN
    RAISE EXCEPTION '964: ainda aceitam agent: %', v_frouxas;
  END IF;

  RAISE NOTICE '964 OK — as 12 policies de escrita exigem admin; SELECT segue aberto à conta';
END $$;

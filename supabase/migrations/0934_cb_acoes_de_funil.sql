-- ============================================================
-- 934 — Ações de funil na automação, e a CADEIA anti-ciclo
--
-- A 933 trouxe o gatilho ("quando o card entrar na etapa X"). Esta traz o
-- outro lado: a automação passa a MOVER o card e a marcá-lo ganho/perdido.
-- É o que fecha a esteira do print do Kommo — etapa dispara robô, robô move
-- para a próxima etapa, que dispara o próximo robô.
--
-- ⚠️ E É EXATAMENTE ISSO QUE CRIA O LAÇO. Mover a etapa gera evento, que
-- dispara automação, que pode mover a etapa. Duas automações apontando uma
-- para a outra (X→Y, Y→X) girariam para sempre, mandando mensagem ao cliente
-- a cada volta.
--
-- O operador RECUSOU teto de profundidade — esteira longa é legítima e um
-- teto a cortaria no meio, em silêncio. A guarda é ANTI-CICLO: a cadeia
-- carrega por onde este encadeamento já passou, e um evento que revisita um
-- par (negócio, etapa) já visitado não dispara. Esteira de 20 etapas passa;
-- círculo é barrado na segunda volta.
--
-- ⚠️ POR QUE UM GUC, E NÃO UM PARÂMETRO
--
-- Quem escreve o evento é o TRIGGER, não o código — foi a decisão da 933,
-- porque há escritores no navegador. O trigger não recebe parâmetros do
-- chamador. A única forma de a cadeia atravessar essa fronteira é uma
-- variável de sessão marcada como LOCAL (`set_config(..., true)`), que vive
-- só até o fim da transação — e o UPDATE está na mesma transação, dentro
-- desta função. Escrita normal (navegador, SQL na mão) não define nada e o
-- trigger lê cadeia vazia, que é o correto: ação de gente começa cadeia nova.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A cadeia no evento
-- ------------------------------------------------------------

ALTER TABLE cb_automation_events
  ADD COLUMN IF NOT EXISTS cadeia jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN cb_automation_events.cadeia IS
  'Por onde este encadeamento ja passou, como lista de chaves '
  '"deal:<id>|stage:<id>". Vazia = acao de gente/conexao (cadeia nova). '
  'O drenador recusa evento que revisita chave ja presente.';

-- ------------------------------------------------------------
-- 2) O trigger passa a copiar a cadeia da transação para o evento
--
-- Reescrito por inteiro (CREATE OR REPLACE) porque o corpo mudou em dois
-- pontos: lê o GUC, e a trava provisória da 933 que impedia card criado por
-- automação de re-enfileirar SAI — a cadeia agora dá conta do laço, e sem
-- isso "card criado pela automação" nunca dispararia a esteira.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION cb_enfileira_evento_de_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_origem   text;
  v_canal    uuid;
  v_cadeia   jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- `UPDATE OF` dispara quando a coluna é MENCIONADA, mesmo sem mudar de
    -- valor, e o formulário manda as três em todo save.
    IF NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
       AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
       AND NEW.status   IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  v_origem := CASE
    WHEN v_actor IS NOT NULL THEN 'usuario'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'channel'    THEN 'conexao'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'automation' THEN 'automacao'
    ELSE 'sistema'
  END;

  -- A cadeia da transação, se houver. `current_setting(..., true)` devolve
  -- NULL quando a variável nunca foi definida — que é o caso de toda escrita
  -- que não veio de `cb_atualizar_negocio`. O `nullif` cobre a string vazia,
  -- que `''::jsonb` recusaria com erro.
  v_cadeia := coalesce(
    nullif(current_setting('cb.cadeia', true), '')::jsonb,
    '[]'::jsonb
  );

  BEGIN
    IF NEW.contact_id IS NOT NULL THEN
      SELECT c.channel_id INTO v_canal
        FROM conversations c
       WHERE c.account_id = NEW.account_id
         AND c.contact_id = NEW.contact_id
         AND c.channel_id IS NOT NULL
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 1;
    END IF;

    IF TG_OP = 'INSERT' THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        to_pipeline_id, to_stage_id, to_status, origem, cadeia
      ) VALUES (
        NEW.account_id, 'deal_stage_changed', NEW.id, NEW.contact_id, v_canal,
        NEW.pipeline_id, NEW.stage_id, NEW.status, v_origem, v_cadeia
      );
      RETURN NEW;
    END IF;

    IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
       OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        from_pipeline_id, to_pipeline_id, from_stage_id, to_stage_id,
        origem, cadeia
      ) VALUES (
        NEW.account_id, 'deal_stage_changed', NEW.id, NEW.contact_id, v_canal,
        OLD.pipeline_id, NEW.pipeline_id, OLD.stage_id, NEW.stage_id,
        v_origem, v_cadeia
      );
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        to_pipeline_id, to_stage_id, from_status, to_status, origem, cadeia
      ) VALUES (
        NEW.account_id, 'deal_status_changed', NEW.id, NEW.contact_id, v_canal,
        NEW.pipeline_id, NEW.stage_id, OLD.status, NEW.status,
        v_origem, v_cadeia
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Engole SEMPRE: re-levantar faria o arrastar do card falhar na cara do
    -- operador por causa de uma automação.
    RAISE WARNING 'cb_enfileira_evento_de_funil falhou para deal %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_enfileira_evento_de_funil()
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3) A escrita do motor: um UPDATE só, com a cadeia carimbada
--
-- ⚠️ UM `UPDATE` SÓ com `pipeline_id` e `stage_id` juntos é EXIGÊNCIA, não
-- estilo. Em dois updates a trilha da 912 grava duas linhas e conta a
-- história errada: que o lead saiu do funil e voltou. E a FK composta
-- `(stage_id, pipeline_id)` recusaria o estado intermediário.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION cb_atualizar_negocio(
  p_deal_id     uuid,
  p_account_id  uuid,
  p_pipeline_id uuid,
  p_stage_id    uuid,
  p_status      text,
  p_cadeia      jsonb
)
RETURNS TABLE (ok boolean, motivo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deal    deals;
  v_funil   uuid;
BEGIN
  -- Posse. O motor roda em service-role e ignora RLS, então o filtro por
  -- conta aqui é a única barreira entre um `deal_id` vindo do contexto e o
  -- negócio de outro escritório.
  SELECT * INTO v_deal FROM deals
   WHERE id = p_deal_id AND account_id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'negocio nao encontrado nesta conta';
    RETURN;
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'won', 'lost') THEN
    RETURN QUERY SELECT false, format('status invalido: %s', p_status);
    RETURN;
  END IF;

  -- Etapa dada sem funil: descobre o funil DELA. Sem isto, mover para uma
  -- etapa de outro funil violaria a FK composta `(stage_id, pipeline_id)` —
  -- que é justamente o caso "Trabalhista → descarte" que o operador cita.
  IF p_stage_id IS NOT NULL THEN
    SELECT s.pipeline_id INTO v_funil FROM pipeline_stages s WHERE s.id = p_stage_id;
    IF v_funil IS NULL THEN
      RETURN QUERY SELECT false, 'etapa nao existe';
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pipelines p WHERE p.id = v_funil AND p.account_id = p_account_id
    ) THEN
      RETURN QUERY SELECT false, 'etapa pertence a um funil de outra conta';
      RETURN;
    END IF;
  END IF;

  -- A cadeia, marcada como LOCAL: vive só até o fim desta transação, e o
  -- UPDATE abaixo está nela. O trigger da 933/934 a copia para o evento.
  PERFORM set_config('cb.cadeia', coalesce(p_cadeia, '[]'::jsonb)::text, true);

  UPDATE deals
     SET pipeline_id = coalesce(v_funil, pipeline_id),
         stage_id    = coalesce(p_stage_id, stage_id),
         status      = coalesce(p_status, status)
   WHERE id = p_deal_id AND account_id = p_account_id;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

-- Só o motor chama (service_role). Aberta ao `authenticated`, esta função
-- moveria card de qualquer conta cujo uuid alguém adivinhasse — ela é
-- SECURITY DEFINER e o filtro de conta é parâmetro, não sessão.
REVOKE EXECUTE ON FUNCTION cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ⚠️ E o `service_role` precisa ganhar de volta, EXPLICITAMENTE. Em Postgres o
-- EXECUTE de função nasce concedido a PUBLIC; revogar de PUBLIC tira de todo
-- mundo que dependia disso — inclusive dele. Em produção não se notou porque o
-- Supabase concede EXECUTE ao service_role por *default privilege*, que nenhuma
-- migration escreveu. Num banco novo esse default não existe, e a conferência
-- logo abaixo reprovava com "service_role NAO executa".
--
-- É o motor/cron/webhook que chama esta função, sempre com service_role.
-- Em produção é no-op; GRANT é idempotente.
GRANT EXECUTE ON FUNCTION cb_atualizar_negocio(uuid, uuid, uuid, uuid, text, jsonb)
  TO service_role;

-- ------------------------------------------------------------
-- 4) Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------

DO $$
BEGIN
  IF has_function_privilege('anon', 'cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa cb_atualizar_negocio';
  END IF;
  IF has_function_privilege('authenticated', 'cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ainda executa cb_atualizar_negocio';
  END IF;
  IF NOT has_function_privilege('service_role', 'cb_atualizar_negocio(uuid,uuid,uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role NAO executa cb_atualizar_negocio';
  END IF;
END $$;

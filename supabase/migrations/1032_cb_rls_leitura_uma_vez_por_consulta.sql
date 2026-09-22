-- ============================================================
-- 1032 — As regras de LEITURA perguntam "de quais contas sou membro" UMA vez
-- por consulta, e não a cada linha lida.
--
-- Até aqui, 61 policies de leitura (52 tabelas) chamavam
-- `is_account_member(account_id)` por LINHA. A função é SECURITY DEFINER —
-- não pode ser incorporada à consulta — e cada chamada faz uma busca em
-- `profiles` e decodifica o JWT de novo (`auth.uid()`). Numa leitura do quadro
-- do funil (card + contato + etiquetas + conversa, por card) isso dá dezenas
-- de milhares de chamadas. MEDIDO em produção em 21/09/2026 pela RLS de
-- verdade (`SET ROLE authenticated` + claims do dono da conta), as policies
-- antigas e as desta migration na MESMA transação, desfeita no fim:
--   · página do quadro do Trabalhista (1.000 de 3.669 cards): 886 ms × 232 ms
--     (224 ms sem RLS nenhuma — o que sobra é o custo da própria consulta);
--   · negócios do filtro de etapa da caixa de entrada: 28 ms × 1 ms — é a
--     consulta do CRM que mais ocupa o banco (2.645 chamadas, média 320 ms,
--     com a contagem de cada página);
--   · página da lista de conversas: 261 ms × 69 ms.
-- O funil Trabalhista - Comercial levava ~9 s para abrir e a caixa de
-- entrada ~4,5 s; o resto do tempo é o mesmo custo multiplicado.
--
-- ⚠️⚠️ A REGRA DE QUEM VÊ O QUÊ NÃO MUDA. `is_account_member(x, papel)` é
-- "existe um perfil meu na conta x com papel >= papel"; a forma nova é
-- "x está no conjunto das contas em que tenho papel >= papel". Mesmo `CASE`
-- de hierarquia, mesma tabela, mesmo `auth.uid()`; conta nula não casa em
-- nenhuma das duas. A conferência logo depois da função compara as duas
-- para todo usuário do banco, em todo papel (ver o custo dela, abaixo).
--
-- ⚠️⚠️ A CONFERÊNCIA DE EQUIVALÊNCIA FOI REESCRITA DEPOIS DE APLICADA
-- (Codex, PR #246). A versão aplicada em produção (histórico
-- 20260921220626) percorria usuário × conta × papel e rodava DEPOIS das
-- ALTER: aqui eram 160 casos em 175 ms, mas numa instalação com mil usuários
-- e mil contas seriam 4 milhões de chamadas, com a trava EXCLUSIVA das 52
-- tabelas presa o tempo todo — `lock_timeout` limita só a ESPERA pela trava,
-- não o que se faz com ela. Hoje ela roda ANTES das ALTER e é LINEAR no
-- número de usuários; a sonda de privilégio do fim virou EXPLAIN (confere
-- os privilégios sem varrer tabela). O que a migration MUDA no banco — a
-- função e as 61 policies — é idêntico ao aplicado; só a verificação mudou.
--
-- ⚠️⚠️ A FORMA É `= ANY (ARRAY(SELECT …))`, NUNCA `IN (SELECT …)`. As duas
-- dizem a mesma coisa, e a primeira versão desta migration usava `IN`.
-- Medida pela RLS de verdade, ela só levava o quadro de 886 a 566 ms: nas 17
-- policies que perguntam pela tabela-mãe (`contact_tags` → `contacts`,
-- `messages` → `conversations`, …), o `IN (SELECT fn())` DENTRO do EXISTS é
-- desdobrado pelo planejador numa semi-junção, e a função volta a rodar UMA
-- VEZ POR LINHA (`loops=7428` no plano, 290 ms só nas etiquetas). Subconsulta
-- `ARRAY(...)` nunca é desdobrada: vira um InitPlan, calculado uma vez por
-- consulta, e `= ANY(array)` ainda pode usar índice.
--
-- ⚠️ POR QUE AS DE "TODOS OS COMANDOS" (FOR ALL) ENTRAM JUNTO: policy FOR ALL
-- vale também para SELECT, e as permissivas são somadas com OU na ordem do
-- NOME — `contact_tags_modify` é avaliada antes de `contact_tags_select`.
-- Reescrever só a de SELECT deixaria o custo inteiro na outra.
--
-- ⚠️ As policies SÓ de escrita (INSERT/UPDATE/DELETE) ficam como estão, de
-- propósito: são avaliadas por linha ESCRITA — uma por vez na prática —, e
-- deixá-las intactas mantém a mudança do tamanho do problema.
--
-- ⚠️ As quatro de leitura que comparam `user_id = auth.uid()` (favoritas,
-- filtros salvos, filtro padrão, perfis) passam a `(SELECT auth.uid())`,
-- que também é avaliado uma vez por consulta.
--
-- ⚠️ `cb_contas_do_usuario` é SECURITY DEFINER pelo mesmo motivo de
-- `is_account_member`: lê `profiles`, cuja própria policy pergunta pela
-- conta — como invoker, entraria em recursão. EXECUTE vai para anon,
-- authenticated e service_role porque as policies são `TO public`: o anon
-- também as avalia (e recebe conjunto vazio — `auth.uid()` é nulo).
--
-- ⚠️ ALTER POLICY toma trava EXCLUSIVA de cada tabela até o fim da
-- transação. `lock_timeout` faz a migration DESISTIR (e desfazer tudo) se
-- alguma tabela estiver ocupada, em vez de enfileirar o sistema inteiro atrás
-- dela. Falhou por trava? É só aplicar de novo num momento mais calmo.
--
-- ⚠️ São policies do UPSTREAM (017 e seguintes). Uma migration futura dele
-- que recrie uma delas traz de volta a forma por linha — só lentidão, não
-- brecha. Policy NOVA de leitura usa a forma desta migration.
--
-- Reversão: as 61 expressões antigas estão no catálogo de hoje; o inverso é
-- `ALTER POLICY … USING (is_account_member(…))` para cada uma. Aplicar a
-- reversão não precisa apagar a função.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cb_contas_do_usuario(
  p_papel_minimo public.account_role_enum DEFAULT 'viewer'
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 3
AS $$
  -- Espelho do corpo de `is_account_member` (017): mesma tabela, mesmo
  -- `auth.uid()`, mesma hierarquia. Só muda a pergunta: em vez de "sou
  -- membro DESTA conta?", "de QUAIS contas sou membro?".
  SELECT p.account_id
    FROM public.profiles p
   WHERE p.user_id = auth.uid()
     AND p.account_id IS NOT NULL
     AND CASE p.account_role
           WHEN 'owner'  THEN 4
           WHEN 'admin'  THEN 3
           WHEN 'agent'  THEN 2
           WHEN 'viewer' THEN 1
         END
         >=
         CASE p_papel_minimo
           WHEN 'owner'  THEN 4
           WHEN 'admin'  THEN 3
           WHEN 'agent'  THEN 2
           WHEN 'viewer' THEN 1
         END
$$;

REVOKE ALL ON FUNCTION public.cb_contas_do_usuario(public.account_role_enum)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cb_contas_do_usuario(public.account_role_enum)
  TO anon, authenticated, service_role;

-- ============================================================
-- Conferência 1 — ANTES das ALTER, sem trava de tabela nenhuma: as duas
-- perguntas dão a MESMA resposta para todo usuário × todo papel deste banco.
--
-- ⚠️ O custo é LINEAR no número de usuários, e é por construção, não por
-- amostragem. `is_account_member(x, papel)` é um EXISTS sobre os perfis do
-- PRÓPRIO usuário com `account_id = x` (017): fora das contas dos perfis
-- dele, é falso sem precisar perguntar. Então a equivalência em TODAS as
-- contas se reduz a
--   (i)   nas contas dos perfis dele, as duas respostas batem;
--   (ii)  a função nova não devolve conta fora dos perfis dele;
--   (iii) numa conta de fora (a primeira que aparecer), as duas batem na
--         prática — a guarda contra uma `is_account_member` que um dia
--         deixe de ser só isso.
-- `profiles.user_id` é único, então cada usuário custa três comparações por
-- papel. A primeira versão percorria usuário × conta × papel (ver o
-- cabeçalho). Em banco vazio não há o que comparar.
-- ============================================================
DO $$
DECLARE
  u uuid;
  a uuid;
  r public.account_role_enum;
  v_fora uuid;
  v_casos int := 0;
BEGIN
  FOR u IN SELECT p.user_id FROM public.profiles p WHERE p.user_id IS NOT NULL LOOP
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated')::text,
      true
    );
    SELECT ac.id INTO v_fora
      FROM public.accounts ac
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.user_id = u AND p.account_id = ac.id
     )
     LIMIT 1;
    FOREACH r IN ARRAY enum_range(NULL::public.account_role_enum) LOOP
      -- (ii)
      IF EXISTS (
        SELECT 1
          FROM public.cb_contas_do_usuario(r) AS x(conta)
         WHERE NOT EXISTS (
           SELECT 1 FROM public.profiles p WHERE p.user_id = u AND p.account_id = x.conta
         )
      ) THEN
        RAISE EXCEPTION '1032: cb_contas_do_usuario devolve conta fora dos perfis do usuário % (papel %)', u, r;
      END IF;
      -- (i) e (iii)
      FOR a IN
        SELECT p.account_id FROM public.profiles p WHERE p.user_id = u AND p.account_id IS NOT NULL
        UNION
        SELECT v_fora WHERE v_fora IS NOT NULL
      LOOP
        IF public.is_account_member(a, r)
           IS DISTINCT FROM (a IN (SELECT public.cb_contas_do_usuario(r))) THEN
          RAISE EXCEPTION '1032: divergência para usuário %, conta %, papel %', u, a, r;
        END IF;
        v_casos := v_casos + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_casos = 0 THEN
    RAISE NOTICE '1032: banco vazio, nada a comparar.';
  ELSE
    RAISE NOTICE '1032: % comparações (usuário × conta dele ou uma de fora × papel) idênticas.', v_casos;
  END IF;
END $$;

-- ============================================================
-- As 61 policies de leitura (SELECT e FOR ALL), geradas do catálogo de
-- produção em 21/09/2026 — a mesma expressão, com a pergunta de membro
-- trocada. Em ordem de tabela.
-- ============================================================

-- account_invitations
ALTER POLICY account_invitations_modify ON public.account_invitations
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))))
 )
 WITH CHECK (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))))
 );
ALTER POLICY account_invitations_select ON public.account_invitations
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))))
 );

-- accounts
ALTER POLICY accounts_select ON public.accounts
 USING (
  (id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- ai_configs
ALTER POLICY ai_configs_select ON public.ai_configs
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- ai_knowledge_chunks
ALTER POLICY ai_knowledge_chunks_select ON public.ai_knowledge_chunks
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- ai_knowledge_documents
ALTER POLICY ai_knowledge_documents_select ON public.ai_knowledge_documents
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- ai_usage_log
ALTER POLICY ai_usage_log_select ON public.ai_usage_log
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))))
 );

-- api_keys
ALTER POLICY api_keys_select ON public.api_keys
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- automation_logs
ALTER POLICY automation_logs_select ON public.automation_logs
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- automation_steps
ALTER POLICY automation_steps_modify ON public.automation_steps
 USING (
  (EXISTS ( SELECT 1
     FROM automations a
    WHERE ((a.id = automation_steps.automation_id) AND (a.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM automations a
    WHERE ((a.id = automation_steps.automation_id) AND (a.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 );
ALTER POLICY automation_steps_select ON public.automation_steps
 USING (
  (EXISTS ( SELECT 1
     FROM automations a
    WHERE ((a.id = automation_steps.automation_id) AND (a.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- automations
ALTER POLICY automations_select ON public.automations
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- broadcast_recipients
ALTER POLICY broadcast_recipients_modify ON public.broadcast_recipients
 USING (
  (EXISTS ( SELECT 1
     FROM broadcasts b
    WHERE ((b.id = broadcast_recipients.broadcast_id) AND (b.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM broadcasts b
    WHERE ((b.id = broadcast_recipients.broadcast_id) AND (b.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 );
ALTER POLICY broadcast_recipients_select ON public.broadcast_recipients
 USING (
  (EXISTS ( SELECT 1
     FROM broadcasts b
    WHERE ((b.id = broadcast_recipients.broadcast_id) AND (b.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- broadcasts
ALTER POLICY broadcasts_select ON public.broadcasts
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_availability
ALTER POLICY cb_availability_select ON public.cb_availability
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_channels
ALTER POLICY cb_channels_select ON public.cb_channels
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_conversa_aberta
ALTER POLICY cb_conversa_aberta_select ON public.cb_conversa_aberta
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_conversation_favorites
ALTER POLICY cb_conversation_favorites_select ON public.cb_conversation_favorites
 USING (
  ((user_id = ( SELECT auth.uid())) AND (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))
 );

-- cb_conversation_insights
ALTER POLICY cb_conversation_insights_select ON public.cb_conversation_insights
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_conversation_notes
ALTER POLICY cb_conversation_notes_select ON public.cb_conversation_notes
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_groups
ALTER POLICY cb_groups_select ON public.cb_groups
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_grupos_de_campos
ALTER POLICY cb_grupos_de_campos_select ON public.cb_grupos_de_campos
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_inbox_filtro_padrao
ALTER POLICY cb_inbox_filtro_padrao_select ON public.cb_inbox_filtro_padrao
 USING (
  ((user_id = ( SELECT auth.uid())) AND (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))
 );

-- cb_inbox_saved_filters
ALTER POLICY cb_inbox_saved_filters_select ON public.cb_inbox_saved_filters
 USING (
  ((user_id = ( SELECT auth.uid())) AND (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))
 );

-- cb_lead_events
ALTER POLICY cb_lead_events_select ON public.cb_lead_events
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_media_library
ALTER POLICY cb_media_library_select ON public.cb_media_library
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_meetings
ALTER POLICY cb_meetings_select ON public.cb_meetings
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_meta_ads_campanhas
ALTER POLICY cb_meta_ads_campanhas_select ON public.cb_meta_ads_campanhas
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_meta_ads_gastos
ALTER POLICY cb_meta_ads_gastos_select ON public.cb_meta_ads_gastos
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_perfis_de_acesso
ALTER POLICY cb_perfis_select ON public.cb_perfis_de_acesso
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_reunioes_transcritas
ALTER POLICY cb_reunioes_transcritas_select ON public.cb_reunioes_transcritas
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_scheduled_messages
ALTER POLICY cb_scheduled_messages_select ON public.cb_scheduled_messages
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- cb_tasks
ALTER POLICY cb_tasks_select ON public.cb_tasks
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- contact_custom_values
ALTER POLICY contact_custom_values_modify ON public.contact_custom_values
 USING (
  (EXISTS ( SELECT 1
     FROM contacts c
    WHERE ((c.id = contact_custom_values.contact_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM contacts c
    WHERE ((c.id = contact_custom_values.contact_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 );
ALTER POLICY contact_custom_values_select ON public.contact_custom_values
 USING (
  (EXISTS ( SELECT 1
     FROM contacts c
    WHERE ((c.id = contact_custom_values.contact_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- contact_tags
ALTER POLICY contact_tags_modify ON public.contact_tags
 USING (
  (EXISTS ( SELECT 1
     FROM contacts c
    WHERE ((c.id = contact_tags.contact_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM contacts c
    WHERE ((c.id = contact_tags.contact_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 );
ALTER POLICY contact_tags_select ON public.contact_tags
 USING (
  (EXISTS ( SELECT 1
     FROM contacts c
    WHERE ((c.id = contact_tags.contact_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- contacts
ALTER POLICY contacts_select ON public.contacts
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- conversations
ALTER POLICY conversations_select ON public.conversations
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- custom_fields
ALTER POLICY custom_fields_select ON public.custom_fields
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- deals
ALTER POLICY deals_select ON public.deals
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- flow_nodes
ALTER POLICY flow_nodes_modify ON public.flow_nodes
 USING (
  (EXISTS ( SELECT 1
     FROM flows f
    WHERE ((f.id = flow_nodes.flow_id) AND (f.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM flows f
    WHERE ((f.id = flow_nodes.flow_id) AND (f.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 );
ALTER POLICY flow_nodes_select ON public.flow_nodes
 USING (
  (EXISTS ( SELECT 1
     FROM flows f
    WHERE ((f.id = flow_nodes.flow_id) AND (f.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- flow_run_events
ALTER POLICY flow_run_events_select ON public.flow_run_events
 USING (
  (EXISTS ( SELECT 1
     FROM flow_runs r
    WHERE ((r.id = flow_run_events.flow_run_id) AND (r.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- flow_runs
ALTER POLICY flow_runs_select ON public.flow_runs
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- flows
ALTER POLICY flows_select ON public.flows
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- member_presence
ALTER POLICY member_presence_select ON public.member_presence
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- message_reactions
ALTER POLICY message_reactions_modify ON public.message_reactions
 USING (
  (EXISTS ( SELECT 1
     FROM (messages m
       JOIN conversations c ON ((c.id = m.conversation_id)))
    WHERE ((m.id = message_reactions.message_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM (messages m
       JOIN conversations c ON ((c.id = m.conversation_id)))
    WHERE ((m.id = message_reactions.message_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 );
ALTER POLICY message_reactions_select ON public.message_reactions
 USING (
  (EXISTS ( SELECT 1
     FROM (messages m
       JOIN conversations c ON ((c.id = m.conversation_id)))
    WHERE ((m.id = message_reactions.message_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- message_templates
ALTER POLICY message_templates_select ON public.message_templates
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- messages
ALTER POLICY messages_modify ON public.messages
 USING (
  (EXISTS ( SELECT 1
     FROM conversations c
    WHERE ((c.id = messages.conversation_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM conversations c
    WHERE ((c.id = messages.conversation_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 );
ALTER POLICY messages_select ON public.messages
 USING (
  (EXISTS ( SELECT 1
     FROM conversations c
    WHERE ((c.id = messages.conversation_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- pipeline_stages
ALTER POLICY pipeline_stages_modify ON public.pipeline_stages
 USING (
  (EXISTS ( SELECT 1
     FROM pipelines p
    WHERE ((p.id = pipeline_stages.pipeline_id) AND (p.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM pipelines p
    WHERE ((p.id = pipeline_stages.pipeline_id) AND (p.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))))))
 );
ALTER POLICY pipeline_stages_select ON public.pipeline_stages
 USING (
  (EXISTS ( SELECT 1
     FROM pipelines p
    WHERE ((p.id = pipeline_stages.pipeline_id) AND (p.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))))
 );

-- pipelines
ALTER POLICY pipelines_select ON public.pipelines
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- profiles
ALTER POLICY profiles_select ON public.profiles
 USING (
  ((( SELECT auth.uid()) = user_id) OR (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario()))))
 );

-- quick_replies
ALTER POLICY quick_replies_select ON public.quick_replies
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- tags
ALTER POLICY tags_select ON public.tags
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- webhook_endpoints
ALTER POLICY webhook_endpoints_select ON public.webhook_endpoints
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- whatsapp_config
ALTER POLICY whatsapp_config_select ON public.whatsapp_config
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario())))
 );

-- ============================================================
-- Conferência do que as ALTER deixaram (a 1, de equivalência, já rodou lá
-- em cima, antes de qualquer trava).
-- ============================================================

-- 2) Nenhuma policy de LEITURA do schema public ainda pergunta por linha.
DO $$
DECLARE
  v_sobrou text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_sobrou
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd IN ('SELECT', 'ALL')
     AND (qual ~ 'is_account_member' OR coalesce(with_check, '') ~ 'is_account_member');
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION '1032: policy de leitura ainda chama is_account_member: %', v_sobrou;
  END IF;
END $$;

-- 3) Quem avalia as policies consegue executar a função; PUBLIC não.
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.cb_contas_do_usuario(public.account_role_enum)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.cb_contas_do_usuario(public.account_role_enum)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_contas_do_usuario(public.account_role_enum)', 'EXECUTE') THEN
    RAISE EXCEPTION '1032: anon/authenticated/service_role sem EXECUTE em cb_contas_do_usuario';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.cb_contas_do_usuario(public.account_role_enum)'::regprocedure
       AND a.grantee = 0  -- PUBLIC
  ) THEN
    RAISE EXCEPTION '1032: PUBLIC ainda tem EXECUTE em cb_contas_do_usuario';
  END IF;
END $$;

-- 4) As policies novas RODAM como authenticated (a função é chamada de dentro
--    da RLS com o privilégio de quem consulta, e as policies por tabela-mãe
--    leem a tabela-mãe com esse mesmo privilégio). EXPLAIN, e não a consulta:
--    o EXPLAIN inicia o executor, que confere o SELECT de toda tabela da
--    consulta — as das policies inclusive — e o EXECUTE de toda função, mas
--    não varre linha nenhuma. A versão anterior fazia `count(*)` com as
--    travas presas: numa base de milhões de mensagens, segundos de sistema
--    parado. Provado num Postgres 16 descartável: sem SELECT na tabela-mãe e
--    sem EXECUTE na função, o EXPLAIN recusa com `insufficient_privilege`.
--    Tabela sem SELECT para authenticated neste banco é pulada — esta
--    migration não concede nem confere privilégio de tabela.
DO $$
DECLARE
  t text;
  v_plano text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deals', 'contacts', 'contact_tags', 'conversations', 'messages', 'profiles'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE NOTICE '1032: authenticated sem SELECT em %, pulada.', t;
      CONTINUE;
    END IF;
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('EXPLAIN SELECT count(*) FROM public.%I', t) INTO v_plano;
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE EXCEPTION '1032: authenticated não consegue ler % pela policy nova: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

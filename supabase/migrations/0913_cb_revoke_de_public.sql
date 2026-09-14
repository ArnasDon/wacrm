-- ============================================================
-- 913 — `REVOKE ... FROM PUBLIC` nas funções SECURITY DEFINER do CB
--
-- ⚠️ O QUE ESTAVA ERRADO, e vale para toda função nova daqui em diante:
--
--   REVOKE EXECUTE ON FUNCTION f() FROM anon, authenticated;   -- NÃO FAZ NADA
--
-- No Postgres, `EXECUTE` em função nasce concedido a **PUBLIC**. `anon` e
-- `authenticated` nunca tiveram concessão própria — eles herdam de PUBLIC.
-- Revogar de quem não tem remove zero privilégios, e o `proacl` continua
-- `{=X/postgres,...}`, onde o `=X` (sem papel antes do `=`) é justamente a
-- concessão a PUBLIC.
--
-- A 903 já tinha o mesmo engano, e a 912 o repetiu. Conferido no banco:
-- `has_function_privilege('authenticated', ..., 'EXECUTE')` devolvia `true`
-- para as cinco funções abaixo, apesar dos REVOKEs.
--
-- Impacto real, sendo honesto sobre o tamanho:
--   • `cb_lead_event_actor` retorna `text` e, portanto, o PostgREST a expõe em
--     `/rest/v1/rpc/cb_lead_event_actor`. Ela devolve o nome do PRÓPRIO
--     chamador (`WHERE user_id = auth.uid()`), então o que vazava era o nome
--     de quem já estava logado para si mesmo — e NULL para `anon`. Ruído de
--     lint mais que brecha, mas a intenção do código era revogar, e código que
--     mente sobre o que faz é o começo do problema seguinte.
--   • As outras quatro retornam `trigger`: o Postgres recusa chamá-las fora de
--     um trigger e o PostgREST não as publica. Aqui é defesa em profundidade.
--
-- ⚠️ Revogar EXECUTE **não** impede o trigger de disparar: o privilégio é
-- verificado no `CREATE TRIGGER`, não a cada disparo. Verificado com
-- insert/update/delete reais depois de aplicar esta migration.
-- ============================================================

REVOKE EXECUTE ON FUNCTION cb_lead_event_actor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cb_log_deal_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cb_log_contact_tag_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cb_unpin_conversations_on_channel_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cb_drop_channel_from_automations() FROM PUBLIC;

-- `service_role` mantém a concessão explícita que já tinha (`service_role=X`),
-- porque o caminho server-side roda com ele. Não é atingido por este REVOKE.

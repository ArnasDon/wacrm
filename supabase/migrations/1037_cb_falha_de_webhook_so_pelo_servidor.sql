-- ============================================================
-- 1037 — `record_webhook_failure` só pelo servidor.
--
-- A função é da 028 (upstream): conta uma falha de entrega de um webhook de
-- saída e, na décima quinta seguida, DESLIGA o endpoint (`is_active = false`).
-- É SECURITY DEFINER — roda como dono, por cima da RLS — e nunca teve o
-- EXECUTE fechado. MEDIDO em produção em 23/09/2026:
--
--   proacl = {=X/postgres, postgres=X/postgres, anon=X/postgres,
--             authenticated=X/postgres, service_role=X/postgres}
--             ^^ PUBLIC       e, além dele, anon e authenticated explícitos
--
-- Ou seja: QUALQUER pessoa, sem login, com a chave anônima (que viaja no
-- navegador de todo mundo) e o id de um endpoint conseguia desligá-lo chamando
-- `POST /rest/v1/rpc/record_webhook_failure` quinze vezes. E o id não é
-- segredo: ele vai no cabeçalho `X-Wacrm-Webhook-Id` de TODA entrega — quem
-- recebe os avisos (ou lê o log de um proxy no meio) o tem. O efeito é o pior
-- tipo de falha: o n8n do escritório para de receber, sem erro em lugar
-- nenhum, até alguém abrir a tela e religar.
--
-- O único chamador legítimo é `src/lib/webhooks/deliver.ts`, sempre com o
-- cliente de service role (as quatro portas de ingestão e o dreno do funil).
--
-- ⚠️ As DUAS metades do REVOKE — PUBLIC E os papéis —, porque o `proacl`
-- acima tem as duas formas ao mesmo tempo, e revogar só uma não tira nada
-- (a 903/912 e a 914 erraram cada uma uma metade; ver a 913 e a 915). E o
-- GRANT de volta ao service_role por escrito: em banco NOVO o EXECUTE nasce
-- em PUBLIC, e revogar de PUBLIC levaria o do service_role junto (regra 1 da
-- seção de migrations do CLAUDE.md).
--
-- Idempotente: REVOKE/GRANT repetidos são no-op. Não recria a função (o corpo
-- é o da 028, intocado), então não há o que CHAMAR para provar o corpo — a
-- conferência abaixo prova os PRIVILÉGIOS, trocando de papel onde a migration
-- consegue.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) TO service_role;

-- ------------------------------------------------------------
-- Conferência. Confere o RESULTADO, não a intenção.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_funcao regprocedure := to_regprocedure('public.record_webhook_failure(uuid,integer)');
BEGIN
  IF v_funcao IS NULL THEN
    RAISE EXCEPTION '1037: record_webhook_failure(uuid, integer) não existe';
  END IF;

  -- `anon` herda o que PUBLIC tem: false aqui prova as DUAS metades.
  IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION '1037: anon ainda executa record_webhook_failure';
  END IF;
  IF has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION '1037: authenticated ainda executa record_webhook_failure';
  END IF;
  IF NOT has_function_privilege('service_role', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION '1037: o service_role perdeu o EXECUTE de record_webhook_failure';
  END IF;

  -- Trocando de papel, como o PostgREST faria. O id é sorteado: o UPDATE de
  -- dentro da função não acha linha nenhuma, então nada muda no banco.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.record_webhook_failure(gen_random_uuid(), 15);
    RESET ROLE;
    RAISE EXCEPTION '1037: authenticated conseguiu chamar record_webhook_failure';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- o esperado
  END;

  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM public.record_webhook_failure(gen_random_uuid(), 15);
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '1037: service_role não consegue chamar record_webhook_failure: %', SQLERRM;
  END;

  RAISE NOTICE '1037: record_webhook_failure fechada para anon/authenticated; service_role executa.';
END $$;

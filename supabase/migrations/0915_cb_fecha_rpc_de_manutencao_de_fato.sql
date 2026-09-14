-- ============================================================
-- 915 — O que a 914 tentou fazer e NÃO fez
--
-- A 914 revogou de PUBLIC, seguindo a regra descoberta na 913. Testado logo
-- depois: `anon` **continuava** conseguindo chamar as duas funções.
--
-- Motivo — e é a correção da regra da 913: **a forma da concessão varia por
-- função**, e olhar só uma delas engana.
--
--   funções cb_* (901/903/912):
--     {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--      ^^ `=X` sem papel antes do `=` é PUBLIC → revogar de PUBLIC resolve
--
--   merge_duplicate_* (upstream, 022/036):
--     {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}
--      ^^ concessão EXPLÍCITA por papel, sem entrada PUBLIC nenhuma
--         → revogar de PUBLIC não remove nada
--
-- Ou seja: nem "revogue de PUBLIC" nem "revogue dos papéis" está certo
-- sozinho. **Faça os dois e confira o resultado**, porque o `proacl` depende
-- de qual `ALTER DEFAULT PRIVILEGES` estava valendo quando a função nasceu:
--
--   REVOKE EXECUTE ON FUNCTION f() FROM PUBLIC, anon, authenticated;
--   SELECT has_function_privilege('anon', 'f()', 'EXECUTE');  -- tem de dar false
--
-- Conferir o resultado, nunca a intenção. Foi só o teste que pegou isto.
-- ============================================================

REVOKE EXECUTE ON FUNCTION merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 920 — fecha os GRANTs que a 918 e a 919 deixaram abertos
--
-- Achados na revisão de segurança da Fase 1, conferindo o RESULTADO no banco
-- em vez da intenção do arquivo. Nenhum é explorável hoje — a RLS segura os
-- dois casos —, mas a regra deste projeto é não deixar a RLS ser a única
-- coisa segurando a porta, e este é o **quarto** episódio da mesma classe
-- (903, 912 e 914 foram os anteriores).
--
-- ⚠️ A causa é sempre a mesma e vale escrever de novo: o `ALTER DEFAULT
-- PRIVILEGES` do Supabase concede TUDO a `anon` e `authenticated` no
-- `CREATE TABLE`. Um REVOKE que nomeia só alguns verbos deixa os outros de
-- pé, e um REVOKE que nomeia só alguns papéis deixa os outros de pé. Só o
-- teste depois de aplicar mostra qual das duas metades faltou.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `cb_conversation_notes` — `anon` nunca perdeu SELECT nem DELETE
-- ------------------------------------------------------------
-- A 918 escreveu `REVOKE INSERT, UPDATE, TRUNCATE ... FROM authenticated,
-- anon` e logo abaixo `GRANT SELECT, DELETE ... TO authenticated`. Os dois
-- verbos que ela concedeu de propósito a `authenticated` ela nunca tirou de
-- `anon` — e `anon` já os tinha por padrão. Conferido antes desta migration:
--   anon → SELECT true, DELETE true
--
-- Não vaza nada hoje: a RLS está ligada e `is_account_member()` é falso
-- quando `auth.uid()` é NULL, então a chave anônima lê zero linhas. Mas
-- anotação interna de escritório de advocacia não é o lugar de deixar isso
-- na palavra da RLS.
REVOKE ALL ON cb_conversation_notes FROM anon;

-- ------------------------------------------------------------
-- 2. `notifications` — o que a 919 auditou e não fechou
-- ------------------------------------------------------------
-- A 919 revogou INSERT e DELETE, mas olhou só `authenticated`. Conferido:
--   anon          → UPDATE (tabela inteira, todas as colunas) true, TRUNCATE true
--   authenticated → TRUNCATE true
--
-- O UPDATE largo de `anon` vem da 027, que escreveu `REVOKE UPDATE ... FROM
-- authenticated` e parou aí — o GRANT de coluna (`read_at`) que ela fez
-- depois é só para `authenticated`, então `anon` ficou podendo reescrever
-- `title` e `body`. TRUNCATE não é alcançável pelo PostgREST, mas ignora RLS
-- por completo se um dia for.
REVOKE ALL ON notifications FROM anon;
REVOKE TRUNCATE ON notifications FROM authenticated;

-- ⚠️ O acesso do `service_role` tem de ser ESCRITO, não herdado (achado pelo CI
-- de migrations, 2026-08-26 — mesma causa da 919). Ele vinha do *default
-- privilege* do Supabase, que num banco novo não se repete, e a conferência
-- abaixo reprovaria por um motivo que não é o que ela investiga. Concedido o
-- que a produção já tem; lá é no-op.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_conversation_notes TO service_role;
-- E em `notifications`, que a conferência abaixo também exige: é o
-- `service_role` que grava a notificação de menção (a rota escreve com ele,
-- porque a 027 não deixou policy de INSERT para ninguém no navegador).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO service_role;

-- ------------------------------------------------------------
-- 3. Devolve a autoria das anotações copiadas pela 918
-- ------------------------------------------------------------
-- A 918 copiou `author_user_id` mas não `autor_nome`, e a coluna existe
-- justamente para a autoria sobreviver à saída do membro. Resultado: as duas
-- anotações migradas aparecem como "Alguém da equipe" no fio, embora o autor
-- ainda esteja no `profiles`. Recuperável agora; deixar para depois seria
-- apostar que ninguém sai da conta nesse meio-tempo.
UPDATE cb_conversation_notes n
   SET autor_nome = COALESCE(NULLIF(BTRIM(p.full_name), ''), p.email)
  FROM profiles p
 WHERE p.user_id = n.author_user_id
   AND n.autor_nome IS NULL;

-- ------------------------------------------------------------
-- 4. Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
BEGIN
  -- O que tinha de fechar.
  IF has_table_privilege('anon', 'cb_conversation_notes', 'SELECT')
     OR has_table_privilege('anon', 'cb_conversation_notes', 'DELETE') THEN
    RAISE EXCEPTION '920: anon ainda alcança cb_conversation_notes';
  END IF;
  IF has_table_privilege('anon', 'notifications', 'UPDATE')
     OR has_table_privilege('anon', 'notifications', 'TRUNCATE') THEN
    RAISE EXCEPTION '920: anon ainda alcança notifications';
  END IF;
  IF has_table_privilege('authenticated', 'notifications', 'TRUNCATE') THEN
    RAISE EXCEPTION '920: authenticated ainda pode TRUNCATE notifications';
  END IF;

  -- E o que NÃO podia quebrar junto. Um REVOKE ALL largo demais derrubaria
  -- a tela de anotações e o sino inteiros, então cada um vira asserção.
  IF NOT has_table_privilege('authenticated', 'cb_conversation_notes', 'SELECT') THEN
    RAISE EXCEPTION '920: authenticated perdeu o SELECT das anotações';
  END IF;
  IF NOT has_table_privilege('authenticated', 'cb_conversation_notes', 'DELETE') THEN
    RAISE EXCEPTION '920: authenticated perdeu o DELETE das anotações';
  END IF;
  IF NOT has_table_privilege('authenticated', 'notifications', 'SELECT') THEN
    RAISE EXCEPTION '920: authenticated perdeu o SELECT do sino';
  END IF;
  IF NOT has_column_privilege('authenticated', 'notifications', 'read_at', 'UPDATE') THEN
    RAISE EXCEPTION '920: authenticated perdeu o UPDATE(read_at) da 027';
  END IF;
  IF NOT has_table_privilege('service_role', 'cb_conversation_notes', 'INSERT')
     OR NOT has_table_privilege('service_role', 'notifications', 'INSERT') THEN
    RAISE EXCEPTION '920: service_role perdeu INSERT — a rota da anotação para';
  END IF;

  -- A autoria recuperada.
  IF EXISTS (
    SELECT 1 FROM cb_conversation_notes n
      JOIN profiles p ON p.user_id = n.author_user_id
     WHERE n.autor_nome IS NULL
  ) THEN
    RAISE EXCEPTION '920: sobrou anotação sem autor_nome com autor vivo no profiles';
  END IF;
END $$;

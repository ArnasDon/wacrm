-- ============================================================
-- 919 — menção de colega na anotação interna
--
-- A 918 criou `cb_conversation_notes` com a coluna `mencionados uuid[]`, mas
-- deixou o sino de fora. Esta migration abre o único portão que faltava: o
-- CHECK de `notifications.type`, que desde a 027 aceita UM literal só.
--
-- ⚠️ NÃO cria trigger, de propósito. A `cb_lead_events` (912) é escrita por
-- trigger porque é evento DERIVADO, com seis escritores espalhados e nenhum
-- autor. A menção é o oposto: é intenção declarada de uma pessoa, nasce num
-- caminho só (`POST /api/cb/notes`) e precisa validar contra a lista de
-- membros antes de notificar ninguém. Isso é trabalho de código, não de
-- gatilho — e pôr no gatilho esconderia a validação da revisão.
--
-- ⚠️ Continua SEM policy de INSERT em `notifications`. A 027 escreveu que
-- aquelas linhas nascem exclusivamente de função SECURITY DEFINER; a nossa
-- rota escreve com service-role, que ignora RLS. Um insert vindo do navegador
-- continua dando 42501, e é assim que tem de ser: quem chama decidiria a quem
-- notificar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O CHECK de tipo passa a conhecer a menção
-- ------------------------------------------------------------
-- Idempotente: o DROP não reclama se a migration for reaplicada, e o nome do
-- constraint é o mesmo que a 027 deu (confirmado em pg_constraint antes).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'note_mention'));

-- ------------------------------------------------------------
-- 2. Fecha o INSERT/DELETE de `notifications` no privilégio, não só na RLS
-- ------------------------------------------------------------
-- Achado ao conferir o resultado da parte 1: `has_table_privilege(
-- 'authenticated','notifications','INSERT')` dava **true**. A 027 confiou só
-- na ausência de policy. Para INSERT isso até funciona — sem policy o
-- WITH CHECK falha e o cliente leva 42501 —, mas é a única coisa segurando a
-- porta, e o CLAUDE.md tem uma seção inteira sobre revogar de fato em vez de
-- confiar na intenção. Passar a escrever notificação por código (a menção)
-- torna o assunto nosso.
--
-- Não quebra nada, e isso foi conferido antes:
--   · o trigger `notify_conversation_assigned` é SECURITY DEFINER (roda como
--     o dono, não como `authenticated`) — confirmado em `pg_proc.prosecdef`;
--   · a nossa rota escreve com service-role, que tem concessão própria;
--   · o único cliente que toca a tabela é a página de notificações, e ela só
--     faz SELECT e UPDATE (read_at) — o GRANT de coluna da 027 fica de pé.
REVOKE INSERT, DELETE ON notifications FROM PUBLIC, anon, authenticated;

-- ⚠️ O SELECT tem de ser ESCRITO, não herdado (achado pelo CI de migrations,
-- 2026-08-26).
--
-- A tela de notificações lê esta tabela como `authenticated`, e esse SELECT
-- nunca foi concedido por nenhuma migration: ele vinha do *default privilege*
-- do Supabase, que dá tudo a anon/authenticated/service_role para tabela nova
-- criada por `postgres`. Em produção isso valeu — daí a conferência abaixo ter
-- passado quando esta migration foi aplicada.
--
-- Num banco NOVO esse ambiente não se repete, e aí a conferência reprovava com
-- "o REVOKE derrubou o SELECT" — mensagem enganosa: o REVOKE acima só nomeia
-- INSERT e DELETE, e o SELECT simplesmente nunca existiu ali. É o mesmo
-- princípio que esta migration aplica ao INSERT, agora na direção contrária:
-- não confiar em privilégio ambiente, nem para fechar nem para abrir.
--
-- Em produção é no-op — o privilégio já está lá.
GRANT SELECT ON notifications TO authenticated;

-- ------------------------------------------------------------
-- 3. Índice para achar as menções de uma anotação
-- ------------------------------------------------------------
-- GIN porque `mencionados` é array e a pergunta útil é "quem foi mencionado
-- aqui" / "onde fulano foi mencionado" (`@>`). Sem ele um dia isso vira
-- sequential scan na tabela inteira de anotações da conta.
CREATE INDEX IF NOT EXISTS cb_conversation_notes_mencionados_idx
  ON cb_conversation_notes USING GIN (mencionados);

-- ------------------------------------------------------------
-- 4. Conferência
-- ------------------------------------------------------------
-- O CHECK tem de aceitar o valor novo e continuar recusando lixo, e o REVOKE
-- tem de ter pegado. Vale a regra do CLAUDE.md: conferir o RESULTADO, não a
-- intenção — foi só o teste que pegou os três enganos de REVOKE anteriores.
DO $$
DECLARE
  def text;
BEGIN
  IF has_table_privilege('authenticated', 'notifications', 'INSERT') THEN
    RAISE EXCEPTION '919: authenticated ainda pode INSERT em notifications';
  END IF;
  IF NOT has_table_privilege('authenticated', 'notifications', 'SELECT') THEN
    RAISE EXCEPTION '919: o REVOKE derrubou o SELECT de notifications';
  END IF;
  IF NOT has_column_privilege('authenticated', 'notifications', 'read_at', 'UPDATE') THEN
    RAISE EXCEPTION '919: o REVOKE derrubou o UPDATE(read_at) da 027';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND conname = 'notifications_type_check';

  IF def IS NULL OR def NOT LIKE '%note_mention%' THEN
    RAISE EXCEPTION '919: notifications_type_check não conhece note_mention (def=%)', def;
  END IF;
  IF def NOT LIKE '%conversation_assigned%' THEN
    RAISE EXCEPTION '919: notifications_type_check PERDEU conversation_assigned (def=%)', def;
  END IF;
END $$;

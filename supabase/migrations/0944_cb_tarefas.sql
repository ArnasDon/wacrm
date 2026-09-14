-- ============================================================
-- 944 — Tarefas por cliente
--
-- "Ligar para o cliente X na terça" encaminhado a um colega, com data, hora
-- opcional, baixa, resposta e desdobramento. Hoje isso vive em conversa de
-- WhatsApp entre a equipe e não vive em lugar nenhum do CRM.
--
-- ⚠️ POR QUE TABELA NOVA, E NÃO UM TIPO DE `cb_lead_events`
-- A trilha de atividade (912) é EVENTO PASSADO, escrito por trigger, imutável
-- e sem dono. Tarefa é o oposto nos três eixos: aponta para o FUTURO, tem
-- destinatário, e muda de estado a vida inteira (lida, importante, concluída).
-- Enfiá-la lá obrigaria a alargar o CHECK de `event_type`, dar UPDATE numa
-- tabela que é deliberadamente append-only, e a trilha do lead passaria a
-- misturar "o que aconteceu" com "o que falta fazer".
--
-- ⚠️ POR QUE O CLIENTE É `contact_id`, E NÃO `conversation_id`
-- Ao contrário da anotação (918), a tarefa é sobre a PESSOA, não sobre o fio.
-- Grupo de WhatsApp não recebe tarefa — não há a quem ligar. E a ficha do
-- contato, que é onde a tarefa nasce e é lida, é chaveada por contato.
-- O link para a conversa é DERIVADO na tela: `idx_conversations_account_contact`
-- é UNIQUE em (account_id, contact_id) desde a 036, então a conversa se acha
-- por contato numa consulta. Guardar `conversation_id` aqui seria uma segunda
-- cópia da mesma verdade, que envelhece quando a conversa é apagada e recriada.
--
-- ⚠️ TODA ESCRITA PASSA PELA API, e isso é o desenho, não um detalhe.
-- Não há policy de INSERT/UPDATE/DELETE e os privilégios são revogados. Três
-- razões, nesta ordem:
--   1. criar tarefa GRAVA EM `notifications`, que não tem policy de INSERT
--      desde a 027 — do navegador daria 42501, como a menção da 919 já
--      descobriu;
--   2. as regras de quem-pode-o-quê (só o destinatário marca lida; só o
--      criador edita; os dois concluem) moram em `src/lib/tasks/permissoes.ts`,
--      com teste. Repeti-las em RLS criaria uma segunda fonte que diverge na
--      primeira mudança;
--   3. `responsavel_nome` e `criador_nome` são carimbados no servidor — do
--      cliente, seriam texto que o cliente escolhe.
--
-- ⚠️ QUEM VÊ: TODA A EQUIPE VÊ TUDO. Decisão do operador, e a policy de SELECT
-- é `is_account_member(account_id)` sem recorte de papel nem de destinatário.
-- Não é descuido: num escritório de 4 pessoas, tarefa escondida é tarefa que
-- ninguém cobre quando o responsável falta. O recorte "para mim" é da TELA.
-- ============================================================

-- ------------------------------------------------------------
-- 1) O alvo da FK composta de contato
-- ------------------------------------------------------------
-- ⚠️ Mesma razão da 910 com `conversations`: a rota de tarefas roda em
-- service-role e recebe `contact_id` do navegador. Uma FK simples só garante
-- "existe um contato com esse id" — não "é um contato DESTA conta". Sem isto,
-- um pedido forjado cria tarefa sobre cliente de outro escritório.
--
-- `contacts.account_id` é NOT NULL desde a 017, então o índice é total.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx
  ON contacts (id, account_id);

-- ------------------------------------------------------------
-- 2) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- O cliente de quem a tarefa fala. Obrigatório: tarefa solta ("comprar
  -- café") é outra feature, e admitir NULL aqui a abriria por acidente.
  contact_id uuid NOT NULL,

  -- ⚠️ SET NULL nos dois, nunca CASCADE: o histórico é do escritório, não da
  -- pessoa. Quem sai da conta não leva junto a tarefa que criou nem a que
  -- recebeu — e `remove_account_member` (018) nem apaga o profile, só o realoca
  -- para uma conta pessoal, o que já basta para a policy deixar de enxergá-lo.
  criador_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsavel_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Congelados na escrita, mesmo motivo da 918: sem o carimbo, a autoria e a
  -- responsabilidade viram "—" retroativamente quando alguém sai.
  criador_nome text,
  responsavel_nome text,

  titulo text NOT NULL CHECK (btrim(titulo) <> ''),
  descricao text,

  -- ⚠️ DATA E HORA SEPARADAS, e a hora é opcional — é o pedido literal do
  -- operador ("posso especificar apenas a data").
  --
  -- ⚠️ E é também o que evita o erro de fuso que a 935 documenta: o contêiner
  -- roda em UTC e quem digita está em Brasília. Um `timestamptz` obrigaria a
  -- inventar uma hora para a tarefa sem hora — e "vence dia 5" viraria "vence
  -- dia 4 às 21h" na tela de quem abrisse. `date` não tem fuso: 5 é 5 em
  -- qualquer lugar. A comparação "venceu?" é feita no navegador de quem lê,
  -- contra o relógio dele, que é a régua certa.
  vence_em date NOT NULL,
  vence_as time,

  status text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta', 'concluida')),

  -- CHECK de forma: as duas colunas contam a mesma história ou nenhuma. Sem
  -- ele, "concluída sem data de conclusão" e "aberta com data" são estados
  -- alcançáveis por um UPDATE que esqueceu metade.
  concluida_em timestamptz,
  CONSTRAINT cb_tasks_conclusao_coerente
    CHECK ((status = 'concluida') = (concluida_em IS NOT NULL)),

  -- Estado de leitura DO DESTINATÁRIO — alternável nos dois sentidos, porque
  -- o operador pediu "marcar como não lida" de volta. Não confundir com
  -- `notifications.read_at`: aquilo é o aviso, isto é a tarefa.
  lida_em timestamptz,

  importante boolean NOT NULL DEFAULT false,

  -- ⚠️ SET NULL, não CASCADE. A cadeia "ligar → não atendeu → retentar" é o
  -- caso de uso central, e CASCADE faria apagar a primeira tarefa levar junto
  -- o trabalho que outra pessoa ainda tem pela frente.
  tarefa_pai_id uuid REFERENCES cb_tasks(id) ON DELETE SET NULL,

  -- ⚠️ Congelado, pelo mesmo motivo que a 912 congela rótulo de etapa: com
  -- SET NULL acima, apagar a origem apagaria a informação de que houve origem.
  -- Com o título guardado, a derivada continua dizendo de onde veio.
  tarefa_pai_titulo text,

  -- `resposta` é a devolutiva que volta para quem criou; `tarefa` é todo o
  -- resto, inclusive o desdobramento (que é tarefa nova de pleno direito, só
  -- que com pai). A distinção existe porque as duas são LIDAS diferente: a
  -- resposta chega para quem delegou, e a tela a rotula como devolutiva.
  tipo text NOT NULL DEFAULT 'tarefa'
    CHECK (tipo IN ('tarefa', 'resposta')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ⚠️ FK COMPOSTA — ver a nota da parte 1.
  CONSTRAINT cb_tasks_contato_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE CASCADE
);

COMMENT ON TABLE cb_tasks IS
  'Tarefa sobre um cliente, encaminhada a um colega. Escrita só pela API (/api/cb/tasks); o navegador só lê.';

-- ------------------------------------------------------------
-- 3) Índices — um por pergunta que a tela faz
-- ------------------------------------------------------------
-- "O que é meu?" — a visão padrão da tela de Tarefas.
CREATE INDEX IF NOT EXISTS cb_tasks_responsavel_idx
  ON cb_tasks (responsavel_user_id, status, vence_em);

-- "O que eu deleguei?" — a segunda aba.
CREATE INDEX IF NOT EXISTS cb_tasks_criador_idx
  ON cb_tasks (criador_user_id, status, vence_em);

-- "O que a equipe tem?" — a aba "Todas", que é de todo mundo (ver o cabeçalho).
CREATE INDEX IF NOT EXISTS cb_tasks_conta_idx
  ON cb_tasks (account_id, vence_em);

-- "O que há sobre ESTE cliente?" — a aba da ficha e a seção da conversa.
CREATE INDEX IF NOT EXISTS cb_tasks_contato_idx
  ON cb_tasks (contact_id, vence_em);

-- A etiqueta de não-lidas no menu lateral. Parcial porque é a única consulta
-- que roda em TODA tela do sistema, e o conjunto que ela conta é minúsculo
-- perto da tabela inteira (que só cresce, como o acervo de agendadas).
CREATE INDEX IF NOT EXISTS cb_tasks_nao_lidas_idx
  ON cb_tasks (responsavel_user_id)
  WHERE lida_em IS NULL AND status = 'aberta';

-- ------------------------------------------------------------
-- 4) `updated_at` que não depende de quem escreve
-- ------------------------------------------------------------
-- Há um caminho de escrita só (a API), mas o carimbo fica no banco de propósito:
-- é a coluna que a tela usa para ordenar "mexeram nisto agora", e um UPDATE de
-- manutenção feito à mão no SQL Editor a deixaria mentindo.
CREATE OR REPLACE FUNCTION cb_tasks_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_tasks_touch_updated_at() FROM PUBLIC, anon, authenticated;
-- ⚠️ O GRANT de volta é a regra do CLAUDE.md: em Postgres o EXECUTE de função
-- nasce concedido a PUBLIC, e o REVOKE acima o tira de TODOS, service_role
-- inclusive. Em produção é no-op; num banco novo é o que impede a API de
-- escrever. (O privilégio de trigger é checado no CREATE TRIGGER, não a cada
-- disparo — mas a função é nomeada aqui e o custo de conceder é zero.)
GRANT EXECUTE ON FUNCTION cb_tasks_touch_updated_at() TO service_role;

DROP TRIGGER IF EXISTS cb_tasks_touch ON cb_tasks;
CREATE TRIGGER cb_tasks_touch
  BEFORE UPDATE ON cb_tasks
  FOR EACH ROW
  EXECUTE FUNCTION cb_tasks_touch_updated_at();

-- ------------------------------------------------------------
-- 5) RLS
-- ------------------------------------------------------------
ALTER TABLE cb_tasks ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro da conta, inclusive `viewer`. Ver o cabeçalho — é
-- decisão do operador que a equipe inteira enxergue a fila inteira.
DROP POLICY IF EXISTS cb_tasks_select ON cb_tasks;
CREATE POLICY cb_tasks_select ON cb_tasks FOR SELECT
  USING (is_account_member(account_id));

-- ⚠️ SEM POLICY DE INSERT, UPDATE OU DELETE — ver o cabeçalho.
--
-- E o REVOKE não é redundante com a ausência de policy: verificado neste banco
-- na 912, sem ele um UPDATE do navegador não encontra linha e volta "0 linhas
-- afetadas", que a tela leria como sucesso — a tarefa "concluída" reapareceria
-- aberta no próximo carregamento, sem erro nenhum no caminho.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_tasks FROM authenticated, anon;
REVOKE ALL ON cb_tasks FROM anon;

-- ⚠️ ESCRITO, não herdado. O default privilege do Supabase daria isto de graça
-- em produção e nada em banco novo — foi assim que nove migrations nossas
-- reprovaram no CI de 2026-08-26.
GRANT SELECT ON cb_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cb_tasks TO service_role;

-- ------------------------------------------------------------
-- 6) Realtime
-- ------------------------------------------------------------
-- ⚠️ Aqui vale o argumento da 918, não o da 912: a etiqueta de não-lidas mora
-- no MENU LATERAL, que está em toda tela do sistema. Quem passa o dia no inbox
-- — que é o normal — nunca recarrega a página, e sem isto a tarefa que chega às
-- 9h só aparece quando a pessoa lembra de apertar F5.
--
-- REPLICA IDENTITY FULL pelo mesmo motivo da 027: sem ela o payload de UPDATE
-- traz só a chave primária em `old`, e não dá para saber se a linha ERA não
-- lida antes — que é exatamente a conta que a etiqueta faz.
ALTER TABLE cb_tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cb_tasks;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 7) O sino passa a conhecer tarefa
-- ------------------------------------------------------------
-- Mesma mecânica da 919: o CHECK de `notifications.type` é uma lista fechada,
-- e alargá-la é o único portão entre a tarefa e o sino.
--
-- ⚠️ Os literais antigos são reescritos junto, e a conferência da parte 8 prova
-- que continuam lá: um DROP+ADD que esquecesse `conversation_assigned` faria o
-- trigger da 027 estourar na próxima atribuição de conversa.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'note_mention',
    'task_assigned',
    'task_reply'
  ));

-- Para onde o clique na notificação leva.
--
-- ⚠️ CASCADE: apagada a tarefa, o aviso sobre ela não tem destino. Deixá-lo
-- vivo daria uma linha no sino que não abre nada — o mesmo beco sem saída que a
-- 932 evitou na citação, só que aqui há FK possível, então é resolvido no banco.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES cb_tasks(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- 8) Conferir o RESULTADO, nunca a intenção
-- ------------------------------------------------------------
-- Convenção do CLAUDE.md, escrita depois de três enganos seguidos com REVOKE.
-- ⚠️ Nada aqui exige DADO: em banco vazio todas estas perguntas são sobre o
-- catálogo, e a resposta certa não depende de existir uma tarefa sequer.
DO $$
DECLARE
  def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_tasks'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '944: RLS não ficou ligada em cb_tasks.';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_tasks'
  ) <> 1 THEN
    RAISE EXCEPTION '944: esperava 1 policy (select), achei %.',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cb_tasks');
  END IF;

  -- A metade que prova que a porta FECHOU.
  IF has_table_privilege('authenticated', 'public.cb_tasks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_tasks', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_tasks', 'DELETE') THEN
    RAISE EXCEPTION '944: authenticated ainda escreve em cb_tasks — o REVOKE não pegou.';
  END IF;

  IF has_table_privilege('anon', 'public.cb_tasks', 'SELECT') THEN
    RAISE EXCEPTION '944: anon enxerga cb_tasks.';
  END IF;

  -- A metade que prova que a porta certa ficou ABERTA. Sem ela, uma revogação
  -- larga demais passaria verde aqui e a tela nasceria vazia em silêncio.
  IF NOT has_table_privilege('authenticated', 'public.cb_tasks', 'SELECT') THEN
    RAISE EXCEPTION '944: authenticated não lê cb_tasks — a tela inteira nasce vazia.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_tasks', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_tasks', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.cb_tasks', 'DELETE') THEN
    RAISE EXCEPTION '944: service_role não escreve em cb_tasks — a API não funciona.';
  END IF;

  -- O CHECK do sino conhece os quatro tipos, e não perdeu os dois antigos.
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass
     AND conname = 'notifications_type_check';

  IF def IS NULL THEN
    RAISE EXCEPTION '944: notifications_type_check sumiu.';
  END IF;
  IF def NOT LIKE '%task_assigned%' OR def NOT LIKE '%task_reply%' THEN
    RAISE EXCEPTION '944: notifications_type_check não conhece as tarefas (def=%)', def;
  END IF;
  IF def NOT LIKE '%conversation_assigned%' OR def NOT LIKE '%note_mention%' THEN
    RAISE EXCEPTION '944: notifications_type_check PERDEU tipo antigo (def=%)', def;
  END IF;
END $$;

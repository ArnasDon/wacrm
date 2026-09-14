-- ============================================================
-- 945 — Agenda de reuniões (Fase 1: o calendário interno)
--
-- Reunião com cliente — onboarding, atualização — marcada pelo operador, vista
-- num calendário de mês/semana/dia e movida entre datas com o mouse.
--
-- ⚠️ POR QUE TABELA PRÓPRIA, E NÃO UM TIPO DE `cb_tasks` (944)
-- Tarefa tem PRAZO; reunião tem DURAÇÃO. `cb_tasks` guarda `vence_em date` +
-- `vence_as time` em colunas separadas, o que responde "quando vence" e não
-- consegue responder "de quando até quando". E a diferença não é cosmética: a
-- restrição de sobreposição abaixo opera sobre o INTERVALO, e pô-la em
-- `cb_tasks` quebraria tarefas — duas tarefas para as 9h são normais e devem
-- continuar podendo coexistir. São entidades primas que não cabem numa tabela.
--
-- ⚠️ O QUE ESTA MIGRATION NÃO FAZ
-- Nada aqui fala com o Google (Fase 4), nada aqui manda WhatsApp (Fases 2 e 3)
-- e nada dispara sozinho. `cb_meetings` é escrita pela tela e lida pela tela;
-- as colunas `google_*` nascem nulas e só ganham escritor na Fase 4. Estão aqui
-- porque acrescentar coluna a uma tabela nova é barato e migrar dado depois
-- não é — mas quem ler o código não vai achar ninguém escrevendo nelas.
--
-- ⚠️ FUSO. O contêiner roda em UTC e quem digita está em Brasília. `starts_at`
-- e `ends_at` são `timestamptz` — instantes, sem ambiguidade. Já o horário de
-- ATENDIMENTO ("seg a sex, das 9h às 18h") não é instante nenhum: é uma regra
-- que só vira instante quando aplicada a um dia num fuso. Por isso
-- `cb_availability` guarda `time` + o fuso em coluna própria, e nunca
-- `timestamptz`. A 935 registra o preço de errar isso: três horas de desvio,
-- sem erro nenhum, só chegando na hora errada.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A extensão que torna a restrição de sobreposição possível
--
-- `EXCLUDE USING gist` precisa comparar DOIS tipos ao mesmo tempo: o intervalo
-- (com `&&`, que o gist já sabe) e o dono (com `=`, que ele NÃO sabe — igualdade
-- de uuid é operador btree). `btree_gist` é justamente a ponte que ensina o
-- índice gist a fazer igualdade de tipos escalares.
--
-- Sem ela o `CREATE TABLE` abaixo falha com "data type uuid has no default
-- operator class for access method gist".
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------
-- 2) Chave composta de `contacts`, para a FK da reunião
--
-- ⚠️ MESMO NOME QUE A 944 USA, e de propósito. As duas migrations nascem em
-- branches paralelas e nenhuma sabe qual será mesclada primeiro; com
-- `IF NOT EXISTS` e o nome idêntico, a primeira a rodar cria e a segunda é
-- no-op. Nome diferente criaria DOIS índices idênticos sobre a mesma tabela,
-- pagos em toda escrita de contato para sempre.
--
-- A razão de existir é a mesma da 910 e da 944: a rota roda em service-role e
-- recebe `contact_id` do navegador. FK simples só garante "existe um contato
-- com esse id" — não "é um contato DESTA conta".
--
-- `contacts.account_id` é NOT NULL desde a 017, então o índice é total.
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx
  ON contacts (id, account_id);

-- ------------------------------------------------------------
-- 3) A reunião
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cb_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- O advogado que atende. É a chave da restrição de sobreposição e do filtro
  -- da tela.
  --
  -- ⚠️ SET NULL, nunca CASCADE: alguém sair do escritório não pode apagar o
  -- histórico de reuniões que aconteceram (lição do `deals.user_id`, 908, onde
  -- o CASCADE derrubaria o funil inteiro). A reunião órfã deixa de bloquear
  -- horário — o que é correto, já que não há mais quem atenda.
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Carimbado na escrita, como em `cb_scheduled_messages` (925) e
  -- `cb_conversation_notes` (918): é o que faz "com quem era" sobreviver à
  -- saída do membro, quando `owner_user_id` já virou NULL.
  owner_nome text NOT NULL,

  -- ⚠️ NULLABLE, e não é descuido. Apagar contato faz SET NULL nesta coluna, o
  -- que é um UPDATE — e UPDATE revalida CHECK. Um CHECK de forma que exigisse
  -- o contato faria a exclusão de contato FALHAR (lição da 912). Reunião
  -- interna, sem cliente, também é caso legítimo.
  contact_id uuid,
  contato_nome text,

  -- Por onde avisar (Fases 2 e 3) e de onde a reunião nasceu. As duas nulas
  -- porque reunião marcada pela tela de agenda não vem de conversa nenhuma.
  conversation_id uuid,
  channel_id uuid,

  titulo text NOT NULL,
  descricao text,

  -- Sala física ou link de videochamada — texto livre porque as duas coisas
  -- cabem no mesmo campo e o operador sabe qual está escrevendo.
  local text,

  tipo text NOT NULL DEFAULT 'outra',

  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'agendada',

  -- ------------------------------------------------------------
  -- Fase 4 — nascem nulas e ficam assim até a integração existir.
  -- ------------------------------------------------------------
  google_event_id text,
  google_calendar_id text,
  google_sincronizado_em timestamptz,
  google_erro text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_nome text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cb_meetings_titulo_check
    CHECK (length(btrim(titulo)) > 0 AND length(titulo) <= 200),

  CONSTRAINT cb_meetings_descricao_check
    CHECK (descricao IS NULL OR length(descricao) <= 4000),

  CONSTRAINT cb_meetings_local_check
    CHECK (local IS NULL OR length(local) <= 500),

  CONSTRAINT cb_meetings_tipo_check
    CHECK (tipo IN ('onboarding', 'atualizacao', 'outra')),

  CONSTRAINT cb_meetings_status_check
    CHECK (status IN ('agendada', 'realizada', 'cancelada', 'falta')),

  -- A reunião tem de durar alguma coisa. Sem isto, `tstzrange` de um intervalo
  -- vazio nunca colide com nada e a restrição de sobreposição abaixo passa a
  -- ser contornável por acidente.
  CONSTRAINT cb_meetings_intervalo_check
    CHECK (ends_at > starts_at),

  -- ⚠️ FKs COMPOSTAS, como em `conversations` (903), `deals` (908) e
  -- `cb_tasks` (944). A rota roda em service-role e ignora RLS: FK simples só
  -- garantiria "existe uma linha com esse id", não "é desta conta".
  CONSTRAINT cb_meetings_contato_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id),

  CONSTRAINT cb_meetings_conversa_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations (id, account_id) ON DELETE SET NULL (conversation_id),

  CONSTRAINT cb_meetings_canal_fkey
    FOREIGN KEY (channel_id, account_id)
    REFERENCES cb_channels (id, account_id) ON DELETE SET NULL (channel_id)
);

-- ------------------------------------------------------------
-- 4) ⚠️ A RESTRIÇÃO QUE FAZ A AGENDA SER CORRETA
--
-- Dois operadores marcando ao mesmo tempo — ou, na Fase 2, dois clientes
-- clicando no mesmo horário — gravam DUAS reuniões sobrepostas, e ninguém vê
-- erro. O advogado descobre no dia.
--
-- Conferir "está livre?" antes de inserir NÃO resolve: entre a conferência e a
-- inserção cabe a outra requisição. É corrida clássica, e a única defesa real é
-- o banco recusar.
--
-- `tstzrange(starts_at, ends_at)` usa o padrão `[)` — início incluído, fim
-- excluído. É exatamente o que se quer: 9h–10h e 10h–11h NÃO se sobrepõem.
--
-- O `WHERE` deixa reunião cancelada fora: horário cancelado tem de voltar a
-- ficar livre, senão desmarcar não libera a vaga.
--
-- ⚠️ Reunião com `owner_user_id` NULL (advogado que saiu) não participa da
-- restrição — NULL não é igual a nada em `WITH =`. Correto: ninguém mais atende
-- aquilo, e não deve bloquear a agenda de quem ficou.
--
-- ⚠️ A restrição vale para TODO MUNDO, operador incluído. Quem escrever tela
-- nova precisa traduzir o erro `23P01` (exclusion_violation) numa frase que o
-- operador entenda, em vez de deixar vazar erro de banco.
-- ------------------------------------------------------------

ALTER TABLE cb_meetings
  DROP CONSTRAINT IF EXISTS cb_meetings_sem_sobreposicao;

ALTER TABLE cb_meetings
  ADD CONSTRAINT cb_meetings_sem_sobreposicao
  EXCLUDE USING gist (
    owner_user_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelada');

-- ------------------------------------------------------------
-- 5) O horário de atendimento de cada advogado
--
-- Uma linha por FAIXA, não por dia: "seg a sex, 9h–12h e 14h–18h" são dez
-- linhas. Modelar como duas colunas (manhã/tarde) travaria em dois turnos, e
-- quem atende em três — ou só às terças de manhã — não caberia.
--
-- ⚠️ `hora_inicio`/`hora_fim` são `time`, NUNCA `timestamptz`. "Nove da manhã"
-- não é um instante: é uma regra que só vira instante quando aplicada a um dia
-- num fuso. Guardar como instante obrigaria a escolher um dia arbitrário para
-- representá-la, e o horário de verão de qualquer país a moveria sozinha.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cb_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- CASCADE aqui, ao contrário de `cb_meetings.owner_user_id`: horário de
  -- atendimento de quem saiu não é histórico, é lixo que continuaria ofertando
  -- vagas de uma pessoa que não trabalha mais aqui.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 0 = domingo, 6 = sábado. Mesma convenção de `Date.getDay()` em JS, para
  -- não precisar de tradução no meio do caminho — onde erro de um dia mora.
  dia_da_semana smallint NOT NULL,

  hora_inicio time NOT NULL,
  hora_fim time NOT NULL,

  -- ⚠️ NUNCA implícito. O contêiner roda em UTC; se esta coluna não existisse,
  -- "9h" seria lido como 9h UTC, ou seja, 6h em Brasília.
  --
  -- Não há CHECK validando o nome do fuso: a lista vive em `pg_timezone_names`,
  -- que é uma view — e CHECK só aceita expressão IMMUTABLE. A validação mora na
  -- aplicação (`src/lib/agenda/fuso.ts`), que rejeita fuso desconhecido antes
  -- de gravar.
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',

  -- Quanto dura cada reunião oferecida nesta faixa, e quanto tempo fica livre
  -- entre uma e a seguinte.
  duracao_minutos integer NOT NULL DEFAULT 60,
  intervalo_minutos integer NOT NULL DEFAULT 0,

  -- Usados a partir da Fase 2, quando o cliente escolhe sozinho: quão em cima
  -- da hora dá para marcar, e quão longe no futuro a agenda abre.
  antecedencia_minima_horas integer NOT NULL DEFAULT 24,
  janela_maxima_dias integer NOT NULL DEFAULT 60,

  ativo boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cb_availability_dia_check
    CHECK (dia_da_semana BETWEEN 0 AND 6),

  CONSTRAINT cb_availability_faixa_check
    CHECK (hora_fim > hora_inicio),

  CONSTRAINT cb_availability_timezone_check
    CHECK (length(btrim(timezone)) > 0 AND length(timezone) <= 64),

  -- Duração zero geraria vagas infinitas na varredura da Fase 2; o teto de 24h
  -- é o que cabe num dia.
  CONSTRAINT cb_availability_duracao_check
    CHECK (duracao_minutos > 0 AND duracao_minutos <= 1440),

  CONSTRAINT cb_availability_intervalo_check
    CHECK (intervalo_minutos >= 0 AND intervalo_minutos <= 1440),

  CONSTRAINT cb_availability_antecedencia_check
    CHECK (antecedencia_minima_horas >= 0 AND antecedencia_minima_horas <= 8760),

  CONSTRAINT cb_availability_janela_check
    CHECK (janela_maxima_dias > 0 AND janela_maxima_dias <= 365)
);

-- ------------------------------------------------------------
-- 6) Índices
--
-- Os três primeiros são as três perguntas que a tela faz: "o que há neste mês",
-- "o que há na agenda deste advogado" e "o que há na ficha deste cliente".
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS cb_meetings_conta_inicio_idx
  ON cb_meetings (account_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS cb_meetings_dono_inicio_idx
  ON cb_meetings (owner_user_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS cb_meetings_contato_idx
  ON cb_meetings (contact_id, starts_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cb_meetings_conversa_idx
  ON cb_meetings (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cb_availability_conta_pessoa_idx
  ON cb_availability (account_id, user_id, dia_da_semana);

-- ------------------------------------------------------------
-- 7) RLS e privilégios
--
-- Mesmo desenho da 944: o navegador LÊ direto (a tela é toda leitura em tempo
-- real) e ESCREVE só pelas rotas, que rodam em service-role. Sem policy de
-- INSERT/UPDATE/DELETE porque não há escrita legítima vinda do cliente.
--
-- ⚠️ O REVOKE não é redundante com a ausência de policy. Verificado neste banco
-- na 912: sem ele um UPDATE do navegador não encontra linha e volta "0 linhas
-- afetadas", que a tela lê como SUCESSO — a reunião "movida" voltaria ao
-- horário antigo no próximo carregamento, sem erro nenhum no caminho.
--
-- ⚠️ Todo GRANT abaixo é ESCRITO, não herdado. O default privilege do Supabase
-- daria isto de graça em produção e NADA em banco novo — foi assim que nove
-- migrations do projeto reprovaram no CI de 2026-08-26.
-- ------------------------------------------------------------

ALTER TABLE cb_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_meetings_select ON cb_meetings;
CREATE POLICY cb_meetings_select ON cb_meetings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS cb_availability_select ON cb_availability;
CREATE POLICY cb_availability_select ON cb_availability FOR SELECT
  USING (is_account_member(account_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_meetings FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_availability FROM authenticated, anon;

-- ⚠️ Tabela `cb_*` nova nasce SEM NADA para `anon` — a 901, a 906 e a 912
-- deixaram concessão aberta e só a RLS separava um pedido anônimo do dado.
REVOKE ALL ON cb_meetings FROM anon;
REVOKE ALL ON cb_availability FROM anon;

GRANT SELECT ON cb_meetings TO authenticated;
GRANT SELECT ON cb_availability TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON cb_meetings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON cb_availability TO service_role;

-- ------------------------------------------------------------
-- 8) Realtime
--
-- Dois operadores marcando na mesma agenda é o caso comum num escritório, e a
-- restrição de sobreposição transforma a colisão em erro na cara de quem
-- salvou por último. Ver a reunião do colega aparecer evita chegar lá.
--
-- REPLICA IDENTITY FULL pelo motivo da 027: sem ela o payload de UPDATE traz só
-- a chave primária em `old`, e a tela não consegue remover a reunião da data
-- ANTIGA quando ela é movida — ficariam duas na tela até recarregar.
-- ------------------------------------------------------------

ALTER TABLE cb_meetings REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_meetings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cb_meetings;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 9) Conferência
--
-- ⚠️ Toda afirmação abaixo é sobre METADADO (existe a extensão? existe a
-- constraint? quem tem privilégio?), nunca sobre DADO. Conferência que exige
-- linha presente reprova num banco vazio por falta de dado, não por defeito —
-- é a segunda das duas causas que derrubaram nove migrations no CI.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE EXCEPTION '945: btree_gist ausente — a restrição de sobreposição não pode existir sem ela.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cb_meetings_sem_sobreposicao'
       AND contype = 'x'
  ) THEN
    RAISE EXCEPTION '945: a restrição de sobreposição não foi criada — duas reuniões no mesmo horário passariam em silêncio.';
  END IF;

  -- O `anon` não pode ter NADA nas duas tabelas.
  IF has_table_privilege('anon', 'public.cb_meetings', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_meetings', 'INSERT')
     OR has_table_privilege('anon', 'public.cb_availability', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_availability', 'INSERT') THEN
    RAISE EXCEPTION '945: anon manteve privilégio nas tabelas da agenda.';
  END IF;

  -- E os dois papéis que precisam continuam podendo.
  IF NOT has_table_privilege('authenticated', 'public.cb_meetings', 'SELECT') THEN
    RAISE EXCEPTION '945: authenticated perdeu o SELECT — a tela de agenda não carregaria.';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_meetings', 'UPDATE') THEN
    RAISE EXCEPTION '945: authenticated manteve UPDATE — mover reunião pelo navegador voltaria "0 linhas" e a tela leria como sucesso.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_meetings', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_availability', 'INSERT') THEN
    RAISE EXCEPTION '945: service_role sem INSERT — as rotas da agenda não conseguiriam gravar.';
  END IF;

  RAISE NOTICE '945: agenda de reuniões pronta (cb_meetings, cb_availability, sobreposição barrada no banco).';
END $$;

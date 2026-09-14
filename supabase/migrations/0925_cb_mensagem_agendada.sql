-- ============================================================
-- 925 — Mensagem agendada (F4, commit 1)
--
-- Escrever agora e deixar sair na hora marcada. Só texto na v1 (P4.6).
--
-- ⚠️ POR QUE TABELA PRÓPRIA, E NÃO UMA LINHA DE `messages` COM STATUS NOVO
-- Porque `messages_status_check` aceita exatamente
-- `sending|sent|delivered|read|failed` — não há `scheduled`, e alargar o CHECK
-- do upstream espalharia a agendada por todo lugar que lê `messages`: o fio do
-- chat, a prévia da conversa, o painel, a API pública e o contexto da IA. Cada
-- um desses precisaria aprender a ignorá-la. Tabela própria não cobra pedágio
-- em nenhum.
--
-- ⚠️ POR QUE `conversation_id`, E NÃO `contact_id`
-- É a única chave que cobre 1:1 **e** grupo (906), e a P4.7 deixou grupo
-- receber agendada. `deals`/`contacts` não alcançam conversa de grupo —
-- `conversations.contact_id` é NULO lá.
--
-- ⚠️ O QUE ESTA MIGRATION NÃO FAZ: NADA DISPARA SOZINHO.
-- A linha só sai porque alguém bate em `/api/cb/scheduled/cron`. Enquanto o
-- agendador não existir na VPS, esta tabela é exatamente o que
-- `broadcasts.scheduled_at` é desde a 001: uma coluna morta. Ver
-- `docs/DEPLOY-VPS.md`.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  conversation_id uuid NOT NULL,

  -- ⚠️ NOT NULL de propósito — é o "falhar fechado" da P4.3 começando na
  -- porta de entrada. O núcleo de envio resolve canal sozinho e degrada em
  -- SILÊNCIO para o padrão da conta; numa agendada isso significa a mensagem
  -- saindo pelo número errado, de madrugada, sem ninguém na tela. Conta sem
  -- conexão em `cb_channels` simplesmente não agenda, e a tela diz por quê.
  channel_id uuid NOT NULL,

  body text NOT NULL,

  scheduled_for timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'pending',

  -- Motivo da falha, em texto que o operador leia (P4.9). Fica na tela junto
  -- com o botão de tentar de novo — não há retentativa automática, que
  -- mandaria a mesma coisa três vezes às 3 da manhã.
  error text,

  -- `messages.id` do que realmente saiu. Sem FK: apagar a mensagem do fio não
  -- pode apagar (nem travar) o registro de que ela foi enviada.
  message_id uuid,

  -- ⚠️ SET NULL, não CASCADE. Um funcionário sair da conta não pode apagar
  -- mensagens que clientes estão esperando. Mesma lição do `deals.user_id`
  -- (908), onde o CASCADE derrubaria o funil inteiro.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Carimbado na escrita, como em `cb_conversation_notes` (918): é o que faz
  -- "quem agendou" (P4.11) sobreviver à saída do membro, quando `created_by`
  -- já virou NULL.
  autor_nome text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,

  CONSTRAINT cb_scheduled_messages_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),

  -- Mesmo teto da anotação (918). A coluna é `text` e não tem limite no
  -- banco; sem isto um POST fora da tela grava megabytes numa linha que a
  -- ficha da conversa renderiza inteira.
  CONSTRAINT cb_scheduled_messages_body_check
    CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),

  -- ⚠️ FKs COMPOSTAS, como em `conversations` (903), `deals` (908),
  -- anotações (918) e favoritos (924). O worker roda em service-role e passa
  -- por cima da RLS: uma FK simples só garantiria "existe uma linha com esse
  -- id", não "é desta conta".
  CONSTRAINT cb_scheduled_messages_conversa_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations(id, account_id) ON DELETE CASCADE,

  -- ⚠️ RESTRICT, e é a escolha difícil desta migration. As alternativas:
  --   · CASCADE  — apagar a conexão sumiria com as agendadas dela. O cliente
  --                nunca receberia, e ninguém ficaria sabendo. Num escritório
  --                de advocacia, perder mensagem marcada em silêncio é pior
  --                que qualquer inconveniente.
  --   · SET NULL — impossível: a coluna é NOT NULL, pelo motivo acima.
  -- Então a conexão não sai enquanto houver agendada apontando para ela. A
  -- rota que apaga conexão precisa dizer isso em português antes de tentar —
  -- erro de FK cru não explica nada a ninguém.
  CONSTRAINT cb_scheduled_messages_canal_fkey
    FOREIGN KEY (channel_id, account_id)
    REFERENCES cb_channels(id, account_id) ON DELETE RESTRICT
);

COMMENT ON TABLE cb_scheduled_messages IS
  'Mensagem escrita agora para sair na hora marcada. Só sai porque /api/cb/scheduled/cron é chamado de fora — nada dispara sozinho.';

COMMENT ON COLUMN cb_scheduled_messages.channel_id IS
  'O número por onde ESTA mensagem sai, fixado no agendamento. Não segue a conversa: se o cliente escrever por outro número no meio-tempo, a agendada continua saindo por este.';

COMMENT ON COLUMN cb_scheduled_messages.status IS
  'pending → sending → sent | failed. Linha parada em `sending` = o processo morreu no meio e a mensagem PODE ter saído; só gente decide o que fazer (apagar e reagendar), nunca retentativa automática.';

-- A PK é `id`, então procurar as agendadas de uma conversa varreria a tabela —
-- e é a consulta que a ficha faz a cada abertura. Serve também ao CASCADE de
-- apagar conversa.
CREATE INDEX IF NOT EXISTS cb_scheduled_messages_conversa_idx
  ON cb_scheduled_messages (conversation_id, account_id, scheduled_for);

-- A consulta do worker, que roda a cada ciclo e atravessa TODAS as contas.
-- Parcial porque `sent` e `failed` são o acervo que só cresce, e ele não
-- interessa a quem procura o que está vencendo.
CREATE INDEX IF NOT EXISTS cb_scheduled_messages_vencendo_idx
  ON cb_scheduled_messages (scheduled_for)
  WHERE status = 'pending';

-- ------------------------------------------------------------
-- 2) RLS
-- ------------------------------------------------------------
ALTER TABLE cb_scheduled_messages ENABLE ROW LEVEL SECURITY;

-- LER: todo membro, inclusive `viewer`. A mensagem sai em nome do escritório
-- (P4.11) — quem acompanha a conversa precisa saber o que está marcado para
-- não escrever por cima.
DROP POLICY IF EXISTS cb_scheduled_messages_select ON cb_scheduled_messages;
CREATE POLICY cb_scheduled_messages_select ON cb_scheduled_messages FOR SELECT
  USING (is_account_member(account_id));

-- APAGAR: qualquer membro a partir de `agent`, não só quem agendou (P4.11) —
-- a alternativa é a mensagem sair porque a pessoa que a marcou está de férias.
-- `viewer` fica de fora: cancelar um envio é ato operacional, e `viewer`
-- existe para ser somente-leitura.
--
-- ⚠️ Sem cláusula de status na policy, de propósito. `USING (… AND status =
-- 'pending')` faria apagar uma linha já enviada voltar "0 linhas" — que toda
-- tela lê como sucesso —, a armadilha que este banco já pisou duas vezes.
-- Apagar linha `sent` não desfaz envio nenhum: a mensagem está em `messages`.
DROP POLICY IF EXISTS cb_scheduled_messages_delete ON cb_scheduled_messages;
CREATE POLICY cb_scheduled_messages_delete ON cb_scheduled_messages FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ⚠️ SEM POLICY DE INSERT E SEM POLICY DE UPDATE — e os REVOKEs abaixo não são
-- redundantes com essa ausência.
--
-- Criar tem de passar pelo servidor por três motivos, e o primeiro é
-- impeditivo: `autor_nome` é carimbado por quem grava e não pode ser escolhido
-- por quem chama; o canal precisa ser RESOLVIDO (falha fechada) em vez de
-- aceito cru; e o texto precisa do mesmo tratamento do envio normal.
--
-- Atualizar é só do worker. Sem o REVOKE, um UPDATE do navegador não acha
-- linha e volta "0 linhas afetadas", que qualquer código lê como sucesso —
-- alguém marcaria uma agendada como `sent` na tela e ela sairia mesmo assim.
REVOKE INSERT, UPDATE, TRUNCATE ON cb_scheduled_messages FROM authenticated, anon;
REVOKE ALL ON cb_scheduled_messages FROM anon;
GRANT SELECT, DELETE ON cb_scheduled_messages TO authenticated;

-- ------------------------------------------------------------
-- 3) Conferir o RESULTADO, não a intenção
-- ------------------------------------------------------------
-- Convenção do CLAUDE.md, escrita depois de três enganos seguidos com REVOKE
-- (903/912 revogaram só dos papéis; 914 só de PUBLIC — nenhum teve efeito).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_scheduled_messages'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '925: RLS não ficou ligada em cb_scheduled_messages.';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_scheduled_messages'
  ) <> 2 THEN
    RAISE EXCEPTION '925: esperava 2 policies (select/delete), achei %.',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cb_scheduled_messages');
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_scheduled_messages', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_scheduled_messages', 'UPDATE') THEN
    RAISE EXCEPTION '925: authenticated ainda pode INSERT/UPDATE — o REVOKE não pegou.';
  END IF;

  IF has_table_privilege('anon', 'public.cb_scheduled_messages', 'SELECT') THEN
    RAISE EXCEPTION '925: anon ainda enxerga a tabela.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_scheduled_messages', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_scheduled_messages', 'DELETE') THEN
    RAISE EXCEPTION '925: authenticated perdeu privilégio que PRECISA ter — ler e cancelar saem do navegador.';
  END IF;
END $$;

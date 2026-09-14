-- ============================================================
-- 953 — Acervo de mídias da conta
--
-- Arquivos pré-selecionados pelo escritório (contratos em PDF, imagens
-- institucionais, áudios de abertura) que qualquer atendente envia ao cliente
-- em dois cliques, sem procurar no computador nem depender de quem tem o
-- arquivo. Pedido do operador em 2026-08-30.
--
-- ⚠️ POR QUE TABELA NOVA, E NÃO UM TIPO DE `quick_replies`
-- Resposta rápida (035) é TEXTO — nasce e morre numa coluna. Item de acervo
-- tem um OBJETO no Storage atrás dele, com caminho, mime, tamanho e um ciclo
-- de vida próprio (subir, conferir se ainda existe, apagar). Enfiar os dois na
-- mesma tabela obrigaria metade das colunas a serem nulas em cada linha e
-- misturaria dois ciclos de vida que não se parecem.
--
-- ⚠️ O BUCKET É O `chat-media` DE SEMPRE, numa subpasta `acervo/`.
-- Não é economia: o caminho de envio já é esse (URL pública que a Meta e a
-- Evolution buscam na hora do envio), e os tetos de tamanho e a lista de mimes
-- da 023 já são exatamente os que o WhatsApp aceita. Bucket novo seria uma
-- segunda RLS e uma segunda lista de mimes para manter em sincronia com a
-- primeira. A subpasta existe para que qualquer varredura futura de órfãos
-- consiga distinguir "arquivo de acervo" de "anexo de uma mensagem" — as
-- policies de escrita da 020/023 casam só o PRIMEIRO segmento do caminho
-- (`account-<id>`), então aninhar abaixo dele é de graça.
--
-- ⚠️⚠️ ENVIAR DO ACERVO **COPIA** O OBJETO — a mensagem nunca aponta para o
-- arquivo do acervo. Duas razões, e a primeira é um bug pronto:
--   1. o compositor APAGA o objeto do bucket quando o envio falha ou quando o
--      rascunho é descartado (`deleteAccountMedia`), e cancelar uma agendada
--      apaga também (932). Por referência, um envio falho de um estagiário
--      destruiria o contrato-padrão do escritório inteiro;
--   2. num CRM jurídico, o que FOI ENVIADO não pode mudar depois. Trocar o
--      arquivo do item (ou apagá-lo) não pode reescrever nem quebrar a
--      mensagem que o cliente recebeu mês passado.
-- O preço é armazenamento duplicado por envio, e é o preço certo: 16 MB é o
-- teto de um arquivo, e o acervo é usado dezenas de vezes por dia, não
-- milhares.
--
-- ⚠️ TODA ESCRITA PASSA PELA API (nenhuma policy de INSERT/UPDATE/DELETE):
--   1. quem monta o acervo é admin+ (decisão do operador), e papel não se
--      confere direito em RLS sem duplicar a régua que já existe em
--      `src/lib/auth/roles.ts`;
--   2. `media_url` é DERIVADA do caminho no servidor (`getPublicUrl`), nunca
--      aceita do navegador — a mesma regra da 932: aceitando-a, a conferência
--      de posse olharia um campo e o envio usaria outro, e daria para casar um
--      caminho legítimo da conta com uma URL de fora;
--   3. `criador_nome` é carimbado no servidor; vindo do cliente, seria texto
--      que o cliente escolhe.
-- LER continua direto sob RLS: o seletor do compositor e a tela de
-- Configurações são leitura pura, e a policy de SELECT é `is_account_member`.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_media_library (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- O nome que o atendente lê na lista. Não é o nome do arquivo: "Contrato de
  -- honorários (padrão)" acha; "doc_final_v3_ok.pdf" não.
  titulo text NOT NULL CHECK (btrim(titulo) <> '' AND length(titulo) <= 120),

  -- Categoria LIVRE, não tabela de pastas. NULL = sem categoria (a tela mostra
  -- "Geral"). Uma tabela de categorias custaria CRUD próprio, tela própria e
  -- uma FK para ganhar o quê? — o conjunto real é de meia dúzia de rótulos que
  -- o escritório digita uma vez.
  categoria text CHECK (
    categoria IS NULL OR (btrim(categoria) <> '' AND length(categoria) <= 60)
  ),

  -- Os quatro tipos do compositor (`ComposerMediaKind`). `audio` sai como nota
  -- de voz: o envio de áudio já usa `sendWhatsAppAudio` na Evolution, que é o
  -- endpoint de PTT — o cliente recebe como se tivesse sido gravado na hora.
  tipo text NOT NULL CHECK (tipo IN ('image', 'video', 'document', 'audio')),

  -- Caminho do objeto dentro do bucket `chat-media`, sempre sob
  -- `account-<account_id>/acervo/`. A rota confere o prefixo antes de gravar.
  media_path text NOT NULL,
  -- Derivada do caminho no servidor. Guardada porque o envio a lê milhares de
  -- vezes e `getPublicUrl` é determinística — não é uma segunda verdade.
  media_url text NOT NULL,

  mime_type text NOT NULL CHECK (btrim(mime_type) <> ''),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  -- Nome original: é o que o cliente vê ao receber um documento.
  filename text NOT NULL CHECK (btrim(filename) <> ''),

  -- ⚠️ SET NULL e nome congelado, como em 918/944: o acervo é do escritório,
  -- não de quem subiu. Quem sai da conta não leva os arquivos junto, e a
  -- autoria não vira "—" retroativamente.
  criador_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criador_nome text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ UM objeto, UMA linha. Sem isto, duas linhas podem apontar para o mesmo
-- arquivo e apagar uma delas (que apaga o objeto) quebra a outra em silêncio —
-- ela continua na lista, com uma URL que dá 404 na cara do cliente.
CREATE UNIQUE INDEX IF NOT EXISTS cb_media_library_path_unica
  ON cb_media_library (media_path);

-- A tela agrupa por categoria e o seletor filtra por ela.
CREATE INDEX IF NOT EXISTS cb_media_library_conta_categoria_idx
  ON cb_media_library (account_id, categoria, created_at DESC);

-- ------------------------------------------------------------
-- 2) updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_media_library_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Convenção do CLAUDE.md, escrita depois de três enganos seguidos: a forma da
-- concessão varia por função (PUBLIC vs papéis nomeados), então revogar dos
-- dois lados e devolver por escrito a quem precisa. Em produção o GRANT é
-- no-op; em banco novo é ele que faz a migration passar.
REVOKE EXECUTE ON FUNCTION cb_media_library_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION cb_media_library_touch_updated_at() TO service_role;

DROP TRIGGER IF EXISTS cb_media_library_touch ON cb_media_library;
CREATE TRIGGER cb_media_library_touch
  BEFORE UPDATE ON cb_media_library
  FOR EACH ROW
  EXECUTE FUNCTION cb_media_library_touch_updated_at();

-- ------------------------------------------------------------
-- 3) RLS + privilégios
-- ------------------------------------------------------------
ALTER TABLE cb_media_library ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro da conta, `viewer` incluso. O acervo é material de
-- trabalho compartilhado — esconder de alguém não protege nada e quebra o
-- seletor de quem só atende.
DROP POLICY IF EXISTS cb_media_library_select ON cb_media_library;
CREATE POLICY cb_media_library_select ON cb_media_library FOR SELECT
  USING (is_account_member(account_id));

-- ⚠️ SEM POLICY DE INSERT/UPDATE/DELETE — ver o cabeçalho.
--
-- E o REVOKE não é redundante com a ausência de policy: sem ele um UPDATE do
-- navegador não encontra linha e volta "0 linhas afetadas", que a tela leria
-- como sucesso — o item "renomeado" voltaria com o nome velho no próximo
-- carregamento, sem erro nenhum no caminho.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_media_library FROM authenticated, anon;
REVOKE ALL ON cb_media_library FROM anon;

-- ⚠️ ESCRITO, não herdado (regra do CLAUDE.md).
GRANT SELECT ON cb_media_library TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cb_media_library TO service_role;

-- ------------------------------------------------------------
-- 4) Conferência — só FORMA, segura em banco vazio
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'cb_media_library_path_unica'
  ) THEN
    RAISE EXCEPTION '953: o índice único do caminho não foi criado — duas linhas poderiam apontar para o mesmo arquivo.';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_media_library', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_media_library', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_media_library', 'DELETE') THEN
    RAISE EXCEPTION '953: authenticated ainda escreve em cb_media_library — o REVOKE não pegou.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_media_library', 'SELECT') THEN
    RAISE EXCEPTION '953: authenticated perdeu o SELECT — o seletor do compositor não carregaria.';
  END IF;

  IF has_table_privilege('anon', 'public.cb_media_library', 'SELECT') THEN
    RAISE EXCEPTION '953: anon enxerga cb_media_library.';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.cb_media_library_touch_updated_at()', 'EXECUTE') THEN
    RAISE EXCEPTION '953: service_role perdeu o EXECUTE do trigger de updated_at.';
  END IF;
END $$;

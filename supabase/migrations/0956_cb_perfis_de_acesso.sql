-- ============================================================
-- 956 — perfis de acesso (papel × área × telas)
--
-- Fase 1 de `docs/PLANO-perfis-de-acesso.md`. Só a fundação: a tabela, a
-- coluna em `profiles` e as garantias. NADA muda na tela nesta migration.
--
-- O problema que ela resolve
-- -------------------------
-- Até aqui o CRM tem UM eixo de permissão: a escada
-- `owner > admin > agent > viewer` (017), de onde saem as 7 capacidades de
-- `src/lib/auth/roles.ts`. Ela responde "o que a pessoa PODE FAZER" e não
-- responde "sobre QUAL fatia do escritório" — que é o que separa a equipe do
-- trabalhista da equipe do bancário.
--
-- O perfil é o segundo eixo: papel + telas visíveis + conexões + funis, numa
-- entidade só, para que cadastrar alguém seja um campo ("João → Advogado
-- Trabalhista") em vez de duas configurações independentes.
--
-- ⚠️⚠️ ISTO É RESTRIÇÃO DE VISUALIZAÇÃO, NÃO DE SEGURANÇA.
--
-- Decidido pelo operador em 2026-08-30, com o trade-off na mesa. NÃO há RLS
-- nova: as policies de SELECT das tabelas de domínio continuam perguntando só
-- "é membro desta conta?", então um `agent` do trabalhista SEGUE CONSEGUINDO
-- ler conversa do bancário pela aba Network ou por uma chamada direta ao
-- PostgREST. É aceito porque o app é interno, usado só por funcionários, e o
-- objetivo é organizar o que cada um vê — não conter um adversário.
--
-- Está escrito aqui para que ninguém "conserte" isso depois achando que foi
-- esquecimento, e para que ninguém afirme no futuro que o recorte por área
-- barra alguém. Ele não barra.
--
-- O que CONTINUA sendo barreira de verdade (intocado por esta migration):
-- conexões e membros exigem `requireRole('admin')`; apagar conta e transferir
-- posse exigem `owner`; `viewer` não escreve, pelas policies `_modify`.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_perfis_de_acesso (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,

  -- De onde vem a capacidade REAL. O perfil não substitui o papel: ao
  -- atribuir um perfil a alguém, a rota grava também `profiles.account_role`
  -- = este valor, para que as guardas de servidor e a RLS continuem valendo
  -- sem precisar conhecer perfis. Divergindo as duas, QUEM MANDA É
  -- `account_role`.
  --
  -- ⚠️ `owner` é barrado de propósito, na mesma forma que
  -- `account_invitations.role` (017). Perfil que promovesse alguém a dono
  -- seria uma transferência de posse por caminho lateral, sem o fluxo
  -- próprio dela. O Dono não tem linha nesta tabela: ele enxerga tudo por
  -- curto-circuito no código, antes de qualquer consulta a perfil.
  papel_base      account_role_enum NOT NULL CHECK (papel_base <> 'owner'),

  -- Ids do catálogo fechado de `src/lib/perfis/telas.ts`. Texto, e não enum,
  -- porque tela nasce e morre com a UI: virar enum obrigaria uma migration a
  -- cada rota nova, e um `ALTER TYPE ... ADD VALUE` não roda dentro de
  -- transação — exatamente o que o replay do CI faz.
  telas           TEXT[] NOT NULL DEFAULT '{}',
  secoes_config   TEXT[] NOT NULL DEFAULT '{}',

  -- ⚠️ VAZIO = TODAS / TODOS, alinhado a `channelInScope` e `findEntryFlow`.
  -- É a convenção do projeto inteiro (a ÚNICA exceção deliberada é
  -- `cb_channels.radar_enabled`, por privacidade). A tela PRECISA dizer isso
  -- em palavras, senão o operador lê "nenhuma" e desconfigura o perfil.
  --
  -- Arrays em vez de tabela de vínculo: o dado é pequeno, sempre lido
  -- inteiro, e a pergunta ao contrário ("quais perfis usam este funil?") é
  -- varredura trivial numa conta com poucas dezenas de perfis. Tabela de
  -- vínculo aqui seriam três joins para nada.
  --
  -- Sem FK, porque array não tem. A consequência é id órfão quando uma
  -- conexão ou funil é apagado; a LEITURA resolve contra a lista viva e
  -- IGNORA id que não existe mais (mesma regra que `descrever-passo.ts` já
  -- usa para tag apagada). Órfão é inofensivo e some na próxima edição.
  channel_ids     UUID[] NOT NULL DEFAULT '{}',
  pipeline_ids    UUID[] NOT NULL DEFAULT '{}',

  -- Perfis de fábrica (Administrador, Observador): não editáveis, não
  -- apagáveis. A tela mostra cadeado; a rota recusa a escrita.
  sistema         BOOLEAN NOT NULL DEFAULT false,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dois "Advogado Trabalhista" na mesma conta é sempre erro de digitação,
-- nunca intenção — e um seletor com dois itens de nome igual é impossível de
-- usar. Case-insensitive porque "Advogado trabalhista" é o mesmo perfil.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_perfis_conta_nome
  ON cb_perfis_de_acesso (account_id, lower(nome));

CREATE INDEX IF NOT EXISTS idx_cb_perfis_conta
  ON cb_perfis_de_acesso (account_id);

-- ------------------------------------------------------------
-- 2. O vínculo em `profiles`
-- ------------------------------------------------------------
-- ⚠️ NULL significa "SEM RESTRIÇÃO", nunca "sem acesso". São as duas coisas
-- que isso garante:
--
--   1. Todo mundo que já está na conta continua vendo o que vê hoje. A
--      migration não precisa preencher nada, e a Fase 1 não muda uma tela.
--   2. `ON DELETE SET NULL` faz apagar um perfil DEVOLVER acesso total às
--      pessoas dele, em vez de trancá-las para fora. Com a semântica
--      invertida ("NULL = não vê nada"), apagar um perfil por engano deixaria
--      a equipe inteira olhando telas vazias sem entender por quê.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS perfil_id UUID
  REFERENCES cb_perfis_de_acesso(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_perfil
  ON profiles (perfil_id) WHERE perfil_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. `updated_at` por trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_perfis_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

ALTER FUNCTION cb_perfis_touch_updated_at() OWNER TO postgres;

-- ⚠️ O GRANT de volta é a regra do CLAUDE.md, escrita depois de três enganos
-- seguidos: em Postgres o EXECUTE de função nasce concedido a PUBLIC, e o
-- REVOKE abaixo o tira de TODOS — service_role incluído, que perderia a
-- escrita. Em produção o GRANT é no-op; num banco VAZIO (o replay do CI) ele
-- é o que impede a migration de reprovar.
REVOKE EXECUTE ON FUNCTION cb_perfis_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION cb_perfis_touch_updated_at() TO service_role;

DROP TRIGGER IF EXISTS cb_perfis_touch ON cb_perfis_de_acesso;
CREATE TRIGGER cb_perfis_touch
  BEFORE UPDATE ON cb_perfis_de_acesso
  FOR EACH ROW EXECUTE FUNCTION cb_perfis_touch_updated_at();

-- ------------------------------------------------------------
-- 4. RLS: leitura para membros, escrita só pela rota
-- ------------------------------------------------------------
-- Mesma forma de `cb_tasks` (944). A LEITURA precisa ser aberta a qualquer
-- membro porque a legenda da aba Membros mostra o que cada perfil enxerga —
-- inclusive perfis que não são o do próprio leitor.
--
-- A ESCRITA não tem policy nenhuma: um `.from('cb_perfis_de_acesso').update()`
-- disparado do navegador leva 42501. Ela passa pela rota em service-role, que
-- é onde moram as travas que não cabem em RLS: barrar edição de perfil
-- `sistema`, impedir desmarcar `members` de um perfil admin, e manter
-- `profiles.account_role` em sincronia com `papel_base`.
ALTER TABLE cb_perfis_de_acesso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_perfis_select ON cb_perfis_de_acesso;
CREATE POLICY cb_perfis_select ON cb_perfis_de_acesso FOR SELECT
  USING (is_account_member(account_id));

-- ⚠️ O REVOKE não é redundante com a ausência de policy. Privilégio de tabela
-- e RLS são camadas diferentes: sem ele, o `authenticated` tem o GRANT que o
-- default privilege do Supabase concede e só a RLS o barra — uma barreira
-- onde as tabelas novas têm duas. (931 fechou as antigas por este motivo.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_perfis_de_acesso FROM authenticated, anon;

-- ⚠️ Tabela cb_* nova nasce SEM NADA para `anon` — regra do CLAUDE.md. A 901,
-- a 906 e a 912 deixaram concessão aberta (a `cb_channels` chegava a dar
-- INSERT/UPDATE/DELETE ao anon), e a única coisa entre um pedido anônimo e o
-- dado era a RLS.
REVOKE ALL ON cb_perfis_de_acesso FROM anon;

-- O que a migration confere logo abaixo, ela concede aqui. Em produção estes
-- GRANTs são no-op (o default privilege do Supabase já os deu); num banco
-- vazio são o que faz a conferência passar.
GRANT SELECT                         ON cb_perfis_de_acesso TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cb_perfis_de_acesso TO service_role;

-- ------------------------------------------------------------
-- 5. Conferência
-- ------------------------------------------------------------
-- ⚠️ Toda asserção aqui é de AUSÊNCIA ou de ESTRUTURA — nunca "existe uma
-- linha com tal dado". Conferência que exige dado presente reprova num banco
-- vazio por falta de dado, não por defeito, e foi assim que nove migrations
-- nossas reprovaram na primeira vez que o CI as reaplicou do zero.
DO $$
DECLARE
  v_conta UUID;
  v_id    UUID;
BEGIN
  -- Estrutura
  IF to_regclass('public.cb_perfis_de_acesso') IS NULL THEN
    RAISE EXCEPTION '956: a tabela não foi criada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'perfil_id'
  ) THEN
    RAISE EXCEPTION '956: profiles.perfil_id não foi criada';
  END IF;

  -- `perfil_id` PRECISA aceitar NULL: é o estado de todo mundo hoje, e o
  -- destino de quem tinha um perfil apagado.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'perfil_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '956: profiles.perfil_id virou NOT NULL — apagar um perfil trancaria a equipe dele para fora';
  END IF;

  -- Privilégios: as DUAS metades, como manda o CLAUDE.md. Conferir só que o
  -- anon perdeu, sem conferir que os outros mantiveram, já deixou passar
  -- migration que derrubava o caminho de servidor.
  IF has_table_privilege('anon', 'cb_perfis_de_acesso', 'SELECT')
     OR has_table_privilege('anon', 'cb_perfis_de_acesso', 'INSERT') THEN
    RAISE EXCEPTION '956: anon ainda alcança cb_perfis_de_acesso';
  END IF;
  IF NOT has_table_privilege('authenticated', 'cb_perfis_de_acesso', 'SELECT') THEN
    RAISE EXCEPTION '956: authenticated perdeu a leitura — a legenda de Membros não carrega';
  END IF;
  IF has_table_privilege('authenticated', 'cb_perfis_de_acesso', 'INSERT')
     OR has_table_privilege('authenticated', 'cb_perfis_de_acesso', 'UPDATE')
     OR has_table_privilege('authenticated', 'cb_perfis_de_acesso', 'DELETE') THEN
    RAISE EXCEPTION '956: authenticated escreve direto na tabela — a escrita tem de passar pela rota';
  END IF;
  IF NOT has_table_privilege('service_role', 'cb_perfis_de_acesso', 'INSERT') THEN
    RAISE EXCEPTION '956: service_role não escreve — a rota de perfis não funcionaria';
  END IF;
  IF NOT has_function_privilege('service_role', 'cb_perfis_touch_updated_at()', 'EXECUTE') THEN
    RAISE EXCEPTION '956: service_role perdeu o EXECUTE do trigger de updated_at';
  END IF;

  -- Comportamento: o CHECK de `owner` barra mesmo? Deriva a conta do próprio
  -- banco e PULA quando não houver nenhuma — num banco vazio não há o que
  -- inserir, e exigir a linha faria a conferência reprovar por falta de dado.
  SELECT id INTO v_conta FROM accounts LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '956: banco sem contas, pulando a prova do CHECK de papel_base.';
  ELSE
    BEGIN
      INSERT INTO cb_perfis_de_acesso (account_id, nome, papel_base)
      VALUES (v_conta, '__956_prova_owner__', 'owner')
      RETURNING id INTO v_id;

      DELETE FROM cb_perfis_de_acesso WHERE id = v_id;
      RAISE EXCEPTION '956: o CHECK deixou criar perfil com papel_base = owner';
    EXCEPTION
      WHEN check_violation THEN
        NULL;  -- é exatamente o que tem de acontecer
    END;
  END IF;
END $$;

-- ============================================================
-- 1007 — O título do card é o NOME da pessoa, e ele acompanha a ficha.
--
-- O QUE ESTAVA ERRADO (medido em produção, 19/09/2026, 962 cards)
-- `routeContactToPipeline` montava o título UMA vez, no nascimento do card:
-- "<rótulo da conexão> — <nome do contato naquele instante>". E o nome, na
-- CRIAÇÃO da ficha, cai no TELEFONE (`name || phone` do `findOrCreateContact`)
-- — o que acontece SEMPRE quando é o escritório que aborda primeiro pelo
-- celular pareado, porque o `pushName` de uma mensagem nossa é o nome do
-- próprio advogado e a ingestão o descarta de propósito.
--
-- Resultado: 549 cards com telefone no título, 290 deles de gente cuja ficha
-- JÁ tem nome hoje — o nome chegou minutos depois, com a resposta do cliente,
-- e o título ficou congelado. Mais 95 cards nomeando "Comercial - Bancário",
-- rótulo que a conexão não usa desde 02/09: o canal no título envelhece
-- igual. Do quadro do operador: o card era "Bancário - Comercial —
-- 558599704949" e a ficha dizia "Vanessa Bezerra".
--
-- O QUE ESTA MIGRATION FAZ
--  1. `deals.titulo_fixado_em` — a marca de "gente escolheu este título".
--  2. Gatilho em `contacts`: nome novo na ficha renomeia o card ABERTO mais
--     recente daquele contato.
--  3. Acervo A: o nome do CONTRATO (Asaas) passa a mandar na ficha.
--  4. Acervo B: os títulos já gerados perdem o prefixo da conexão.
--
-- ⚠️⚠️ POR QUE O GATILHO NÃO SEGUE O NOME SEMPRE — a descoberta que inverteu
-- metade do plano. Havia 33 cards cujo título não batia com a ficha, e eles
-- NÃO estavam desatualizados: era o contrário. O título guardava o nome do
-- Asaas ("Mamedes Candido de Oliveira Junior") e a ficha tinha o apelido do
-- perfil do WhatsApp ("@Macol") — 26 deles com o nome do Asaas EXATO. O Asaas
-- cria a ficha com o nome completo (D2), e a primeira mensagem do cliente
-- trocava esse nome pelo apelido dele. O card, congelado, era a última cópia
-- viva do nome do contrato. "Seguir a ficha" cegamente rebaixaria os 26.
--
-- Daí a régua, decidida pelo operador em 19/09/2026: o gatilho troca título
-- que ainda NÃO TEM NOME (é o telefone) — o problema original —, e só troca
-- um nome por outro quando o nome novo foi ESCOLHIDO de propósito
-- (`nome_fixado_em`: Calendly, Asaas, ou gente digitando). Troca automática
-- de apelido no WhatsApp não reescreve título que já identifica alguém.
--
-- ⚠️ Sem guarda de `pg_trigger_depth()`, e é de propósito: esta função
-- escreve em `deals`, e NENHUM gatilho de `deals` escreve de volta em
-- `contacts` (conferidos os 6: resultado da etapa, fila do funil ×2, trilha
-- da 912 ×2, `set_updated_at`). Não há eco possível. Os dois da trilha e os
-- da fila são `AFTER UPDATE OF pipeline_id, stage_id, status` — um UPDATE só
-- de `title` não os dispara, então renomear não gera evento de funil nem
-- linha na trilha.
--
-- ⚠️ Aditiva no banco, mas o DEPLOY VEM DEPOIS: o formulário do card e o
-- PATCH da v1 passam a gravar `titulo_fixado_em`, e sem a coluna o PostgREST
-- recusa o UPDATE inteiro — salvar um negócio pelo lápis falharia.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A marca de título escrito por gente
-- ------------------------------------------------------------
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS titulo_fixado_em timestamptz;

COMMENT ON COLUMN public.deals.titulo_fixado_em IS
  'Quando GENTE escreveu o título deste card (lápis do card, POST/PATCH da API v1). NULL = o título acompanha o nome da ficha pela régua da 1007. Preenchido, nenhum caminho automático o troca. Ver 1007.';

-- ------------------------------------------------------------
-- 2) "Isto é nome de gente?" — espelho SQL de `nomeParaFixar` (999)
-- ------------------------------------------------------------
-- Devolve o nome com o espaço colapsado (o não separável incluído), ou NULL
-- quando não serve de nome: vazio, ou só dígitos e pontuação de telefone.
-- É a mesma régua que impede a ingestão de renomear "Leonardo Cabral" para
-- "5583…", e aqui ela responde as duas perguntas do gatilho: "o nome novo
-- presta?" e "o título de hoje já identifica alguém?".
--
-- Há teste amarrando esta expressão ao TS (`titulo-do-card.casa-com-o-sql`).
CREATE OR REPLACE FUNCTION public.cb_nome_para_titulo(p_bruto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $func$
  SELECT CASE
    WHEN p_bruto IS NULL THEN NULL
    WHEN btrim(regexp_replace(p_bruto, E'[[:space:] ]+', ' ', 'g')) = '' THEN NULL
    WHEN regexp_replace(
           btrim(regexp_replace(p_bruto, E'[[:space:] ]+', ' ', 'g')),
           E'[[:space:] ().+-]', '', 'g'
         ) ~ '^[0-9]*$' THEN NULL
    ELSE btrim(regexp_replace(p_bruto, E'[[:space:] ]+', ' ', 'g'))
  END
$func$;

COMMENT ON FUNCTION public.cb_nome_para_titulo(text) IS
  'Nome de gente, com espaço colapsado — ou NULL quando o texto é vazio ou só telefone. Espelho SQL de nomeParaFixar (999). Ver 1007.';

-- ------------------------------------------------------------
-- 3) O título do card segue a ficha
-- ------------------------------------------------------------
-- ⚠️ Só o card ABERTO mais RECENTE, que é a régua do Calendly (999): um
-- contato é um telefone, e no celular da empresa o card fechado de meses
-- atrás pode ser de outra pessoa. E só UM — o CRM permite mais de um card
-- aberto por contato (o formulário de Funis cria à mão), e renomear todos
-- trocaria o título que o advogado escreveu num card de outro funil.
--
-- ⚠️ O card é escolhido ANTES da marca, não filtrando por ela: com o card
-- mais recente fixado à mão e um mais antigo solto, renomear o antigo seria
-- mexer num card sobre o qual a mudança de nome nada diz. Fixado o alvo,
-- não se renomeia nada.
CREATE OR REPLACE FUNCTION public.cb_titulo_do_card_segue_a_ficha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_nome   text := public.cb_nome_para_titulo(NEW.name);
  v_card   uuid;
  v_titulo text;
  v_fixado timestamptz;
  v_sufixo text;
BEGIN
  -- Nome que não é nome (apagado, ou o telefone) nunca vira título.
  IF v_nome IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, title, titulo_fixado_em
    INTO v_card, v_titulo, v_fixado
    FROM deals
   WHERE account_id = NEW.account_id
     AND contact_id = NEW.id
     AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_card IS NULL OR v_fixado IS NOT NULL OR v_titulo = v_nome THEN
    RETURN NEW;
  END IF;

  -- O que o título diz hoje, sem o prefixo de conexão dos cards antigos
  -- ("Bancário - Comercial — 5585…"). O separador é o travessão com espaços,
  -- que só o roteador escrevia; corta no PRIMEIRO, porque nome de gente pode
  -- trazer outro depois.
  v_sufixo := CASE
                WHEN v_titulo LIKE '% — %'
                  THEN substr(v_titulo, position(' — ' in v_titulo) + 3)
                ELSE v_titulo
              END;

  -- ⚠️⚠️ O coração da régua (ver o cabeçalho): título que JÁ identifica
  -- alguém só é trocado quando o nome novo foi escolhido de propósito.
  -- Sem isto, o apelido do perfil do WhatsApp apagaria o nome do contrato.
  IF public.cb_nome_para_titulo(v_sufixo) IS NOT NULL
     AND NEW.nome_fixado_em IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE deals
     SET title = v_nome
   WHERE id = v_card
     AND titulo_fixado_em IS NULL;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS cb_titulo_do_card_segue_a_ficha_trigger ON public.contacts;
CREATE TRIGGER cb_titulo_do_card_segue_a_ficha_trigger
  AFTER UPDATE OF name ON public.contacts
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION public.cb_titulo_do_card_segue_a_ficha();

-- ------------------------------------------------------------
-- 4) Ninguém chama estas funções direto
-- ------------------------------------------------------------
-- Revogar não impede o gatilho de disparar (o privilégio é checado no
-- CREATE TRIGGER). As duas metades, como manda o CLAUDE.md — a concessão
-- destas nasce por PUBLIC, então `FROM anon, authenticated` sozinho não
-- tiraria nada.
REVOKE EXECUTE ON FUNCTION public.cb_titulo_do_card_segue_a_ficha() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_nome_para_titulo(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Acervo A — o nome do CONTRATO passa a mandar na ficha do Asaas
-- ------------------------------------------------------------
-- Decisão do operador (19/09/2026), depois da medição: das 263 fichas que o
-- Asaas CRIOU com o nome completo, 27 já tinham sido rebaixadas pelo apelido
-- do perfil do WhatsApp, e as outras ~236 iriam pelo mesmo caminho na
-- primeira mensagem de cada cliente. A ficha criada pelo Asaas nasce, daqui
-- em diante, com o nome FIXADO (`criar-ficha.ts`) — isto aqui é o acervo.
--
-- ⚠️ SÓ `vinculo_origem = 'criada'`. As outras (ligadas por telefone, CPF ou
-- à mão) são fichas que JÁ EXISTIAM com o nome do WhatsApp: o Asaas apenas
-- as reconheceu, e carimbar o nome do contrato nelas seria trocar o nome que
-- o escritório vem usando por um que ninguém pediu.
--
-- ⚠️ E só com `nome_fixado_em` NULA: ficha cujo nome alguém já escolheu à mão
-- fica como está — a marca protege contra o automático E contra este acervo.
--
-- O UPDATE de nome dispara o gatilho do item 3 e leva o nome completo ao
-- card aberto daquelas 27, que é onde ele ainda estava certo.
DO $$
DECLARE
  v_nomes int;
  v_marcas int;
BEGIN
  IF to_regclass('public.cb_asaas_clientes') IS NULL THEN
    RAISE NOTICE '1007: cb_asaas_clientes não existe, nada a fazer no acervo A.';
    RETURN;
  END IF;

  UPDATE contacts c
     SET name = public.cb_nome_para_titulo(a.nome),
         nome_fixado_em = now(),
         updated_at = now()
    FROM cb_asaas_clientes a
   WHERE a.contact_id = c.id
     AND a.vinculo_origem = 'criada'
     AND c.nome_fixado_em IS NULL
     AND public.cb_nome_para_titulo(a.nome) IS NOT NULL
     AND c.name IS DISTINCT FROM public.cb_nome_para_titulo(a.nome);
  GET DIAGNOSTICS v_nomes = ROW_COUNT;

  UPDATE contacts c
     SET nome_fixado_em = now()
    FROM cb_asaas_clientes a
   WHERE a.contact_id = c.id
     AND a.vinculo_origem = 'criada'
     AND c.nome_fixado_em IS NULL
     AND public.cb_nome_para_titulo(a.nome) IS NOT NULL;
  GET DIAGNOSTICS v_marcas = ROW_COUNT;

  RAISE NOTICE '1007: acervo A — % nomes devolvidos, % fichas do Asaas marcadas.', v_nomes, v_marcas;
END $$;

-- ------------------------------------------------------------
-- 6) Acervo B — os títulos já gerados perdem o prefixo da conexão
-- ------------------------------------------------------------
-- Escopo aprovado pelo operador: todo card gerado pelo roteador cujo título
-- traz um NOME (do sufixo, ou da ficha quando o sufixo é o telefone). O card
-- sem nome em lugar nenhum — o cliente nunca respondeu, a ficha também só
-- tem o número — fica como está, de propósito: ali o rótulo da conexão é a
-- única informação que o título carrega. O gatilho do item 3 conserta cada
-- um deles na primeira vez que o cliente escrever.
--
-- ⚠️ O sufixo VENCE o nome da ficha, e não o contrário: é o que preserva os
-- 26 nomes de contrato do Asaas (ver o cabeçalho). Os dois coincidem em todo
-- o resto.
--
-- ⚠️ `source = 'channel'` + o travessão com espaços: as duas marcas de
-- título GERADO. Medido antes de aplicar — nenhum card de outra origem tem
-- essa forma, e os 4 que a equipe renomeou à mão não têm o travessão.
-- Idempotente: reaplicar não acha mais nada (o `IS DISTINCT FROM`).
DO $$
DECLARE
  v_cards int;
BEGIN
  WITH gerados AS (
    SELECT d.id,
           COALESCE(
             public.cb_nome_para_titulo(substr(d.title, position(' — ' in d.title) + 3)),
             public.cb_nome_para_titulo(c.name)
           ) AS novo
      FROM deals d
      JOIN contacts c ON c.id = d.contact_id
     WHERE d.source = 'channel'
       AND d.titulo_fixado_em IS NULL
       AND d.title LIKE '% — %'
  )
  UPDATE deals d
     SET title = g.novo
    FROM gerados g
   WHERE d.id = g.id
     AND g.novo IS NOT NULL
     AND d.title IS DISTINCT FROM g.novo;
  GET DIAGNOSTICS v_cards = ROW_COUNT;

  RAISE NOTICE '1007: acervo B — % títulos passaram a ser só o nome.', v_cards;
END $$;

-- ------------------------------------------------------------
-- 7) Conferências (seguras em banco vazio: estrutura e função pura)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'titulo_fixado_em'
  ) THEN
    RAISE EXCEPTION '1007: deals.titulo_fixado_em não foi criada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_titulo_do_card_segue_a_ficha_trigger'
  ) THEN
    RAISE EXCEPTION '1007: o gatilho não foi criado';
  END IF;

  IF has_function_privilege('anon', 'public.cb_nome_para_titulo(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1007: anon ainda executa cb_nome_para_titulo';
  END IF;
  IF has_function_privilege('authenticated', 'public.cb_titulo_do_card_segue_a_ficha()', 'EXECUTE') THEN
    RAISE EXCEPTION '1007: authenticated ainda executa cb_titulo_do_card_segue_a_ficha';
  END IF;

  -- A régua do nome, provada sem depender de dado nenhum.
  IF public.cb_nome_para_titulo('  Ana   Maria  ') IS DISTINCT FROM 'Ana Maria' THEN
    RAISE EXCEPTION '1007: cb_nome_para_titulo não colapsou o espaço';
  END IF;
  IF public.cb_nome_para_titulo('558599704949') IS NOT NULL THEN
    RAISE EXCEPTION '1007: cb_nome_para_titulo aceitou um telefone como nome';
  END IF;
  IF public.cb_nome_para_titulo('+55 (85) 99704-9490') IS NOT NULL THEN
    RAISE EXCEPTION '1007: cb_nome_para_titulo aceitou um telefone formatado como nome';
  END IF;
  IF public.cb_nome_para_titulo('   ') IS NOT NULL OR public.cb_nome_para_titulo(NULL) IS NOT NULL THEN
    RAISE EXCEPTION '1007: cb_nome_para_titulo aceitou vazio como nome';
  END IF;
  IF public.cb_nome_para_titulo('J.A.A.') IS DISTINCT FROM 'J.A.A.' THEN
    RAISE EXCEPTION '1007: cb_nome_para_titulo recusou um nome curto legítimo';
  END IF;
END $$;

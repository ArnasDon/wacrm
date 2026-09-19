-- ============================================================
-- 1008 — "Novo contato" não é nome de ninguém.
--
-- Conserta um buraco da 1007 achado na revisão do PR #225 (Codex). O card que
-- nasce sem nome NENHUM — sem nome na ficha, sem telefone e sem `@usuario`,
-- alcançável hoje só pelo Instagram, quando o perfil ainda não foi lido —
-- recebe o rótulo de reserva "Novo contato", porque `deals.title` é NOT NULL.
--
-- Para `cb_nome_para_titulo` esse texto PARECE nome de gente. E a régua da
-- 1007 é "título que já identifica alguém só muda quando o nome novo foi
-- escolhido de propósito": o card nasceria "Novo contato" e ficaria assim
-- PARA SEMPRE, porque a chegada do nome pelo perfil é automática
-- (`nome_fixado_em` nulo) — exatamente o congelamento que a 1007 existe para
-- desfazer.
--
-- Incidência hoje: ZERO (nenhum card com o rótulo, nenhuma ficha sem nome,
-- nenhuma conta do Instagram conectada). É latente: acende no dia em que a
-- primeira conexão do Instagram entrar.
--
-- ⚠️ O texto vive em DOIS lugares — `TITULO_SEM_NOME` em
-- `src/lib/deals/titulo-do-card.ts` e a comparação aqui. Há pino lendo os
-- dois (`supabase/migrations/titulo-do-card-1007.test.ts`); mudar o rótulo
-- exige migration nova.
--
-- Aditiva e idempotente: só troca o corpo da função e varre os cards que já
-- estejam presos no rótulo.
-- ============================================================

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
  v_nome_no_titulo text;
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
  v_nome_no_titulo := public.cb_nome_para_titulo(v_sufixo);

  -- ⚠️⚠️ O coração da régua (ver o cabeçalho da 1007): título que JÁ
  -- identifica alguém só é trocado quando o nome novo foi escolhido de
  -- propósito. Sem isto, o apelido do perfil do WhatsApp apagaria o nome do
  -- contrato.
  --
  -- ⚠️ E o rótulo de reserva NÃO identifica ninguém, por mais que tenha cara
  -- de nome — é a correção que esta migration traz. Quem digitar "Novo
  -- contato" à mão no lápis do card fica protegido pelo `titulo_fixado_em`,
  -- conferido acima.
  IF v_nome_no_titulo IS NOT NULL
     AND v_nome_no_titulo <> 'Novo contato'
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

-- O gatilho continua o mesmo (CREATE OR REPLACE troca só o corpo), mas
-- recriá-lo é de graça e deixa a migration inteira por si só.
DROP TRIGGER IF EXISTS cb_titulo_do_card_segue_a_ficha_trigger ON public.contacts;
CREATE TRIGGER cb_titulo_do_card_segue_a_ficha_trigger
  AFTER UPDATE OF name ON public.contacts
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION public.cb_titulo_do_card_segue_a_ficha();

REVOKE EXECUTE ON FUNCTION public.cb_titulo_do_card_segue_a_ficha() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Acervo: card já preso no rótulo, com a ficha nomeada
-- ------------------------------------------------------------
-- Zero linhas hoje. Existe porque o gatilho só acorda quando o nome MUDA: um
-- card preso no rótulo de uma ficha JÁ nomeada esperaria a próxima troca de
-- nome, que pode não vir nunca.
DO $$
DECLARE
  v_cards int;
BEGIN
  WITH presos AS (
    SELECT d.id, public.cb_nome_para_titulo(c.name) AS novo
      FROM deals d
      JOIN contacts c ON c.id = d.contact_id
     WHERE d.title = 'Novo contato'
       AND d.status = 'open'
       AND d.titulo_fixado_em IS NULL
  )
  UPDATE deals d
     SET title = p.novo
    FROM presos p
   WHERE d.id = p.id
     AND p.novo IS NOT NULL;
  GET DIAGNOSTICS v_cards = ROW_COUNT;
  RAISE NOTICE '1008: % cards saíram do rótulo de reserva.', v_cards;
END $$;

-- ------------------------------------------------------------
-- Conferências (seguras em banco vazio)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF pg_get_functiondef('public.cb_titulo_do_card_segue_a_ficha()'::regprocedure) NOT LIKE '%Novo contato%' THEN
    RAISE EXCEPTION '1008: o gatilho não conhece o rótulo de reserva';
  END IF;
  IF has_function_privilege('anon', 'public.cb_titulo_do_card_segue_a_ficha()', 'EXECUTE') THEN
    RAISE EXCEPTION '1008: anon ainda executa o gatilho';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_titulo_do_card_segue_a_ficha_trigger') THEN
    RAISE EXCEPTION '1008: o gatilho não foi criado';
  END IF;
END $$;

-- ============================================================
-- 1009 — o último prefixo de conexão sai dos títulos.
--
-- A 1007 tirou o "<conexão> — " de 638 cards e DEIXOU 275: aqueles em que
-- ninguém sabe o nome do cliente — a ficha também só tem o telefone. O
-- argumento era que ali o rótulo da conexão é a única informação que o
-- título carrega.
--
-- Visto no quadro, o argumento não se sustentou (decisão do operador,
-- 19/09/2026, olhando a tela depois do acervo): esses 275 são justamente os
-- leads mais RECENTES — quem ainda não respondeu —, então ocupam o topo da
-- coluna "Contato Avulso" e o operador continuava vendo uma parede de
-- "Bancário - Comercial — <número>". E a informação não se perde: o card já
-- mostra a conexão numa pílula, e a coluna inteira é daquele funil.
--
-- Sobra o telefone puro, que é o que se sabe do cliente. Quando ele
-- responder, o gatilho da 1007 troca o número pelo nome sozinho.
--
-- Sem mudança de código: o roteador já nasce sem prefixo desde a 1007. Isto
-- é só o acervo — e é idempotente (reaplicar não acha mais nada).
-- ============================================================

DO $$
DECLARE
  v_cards int;
BEGIN
  WITH com_prefixo AS (
    SELECT id, btrim(substr(title, position(' — ' in title) + 3)) AS sufixo
      FROM deals
     -- As mesmas duas marcas de título GERADO da 1007: a origem e o
     -- travessão com espaços, que só o roteador escrevia. Título digitado
     -- (`titulo_fixado_em`) nunca é tocado, mesmo que tenha um travessão.
     WHERE source = 'channel'
       AND titulo_fixado_em IS NULL
       AND title LIKE '% — %'
  )
  UPDATE deals d
     SET title = p.sufixo
    FROM com_prefixo p
   WHERE d.id = p.id
     AND p.sufixo <> ''
     AND d.title IS DISTINCT FROM p.sufixo;
  GET DIAGNOSTICS v_cards = ROW_COUNT;

  RAISE NOTICE '1009: % títulos perderam o prefixo da conexão.', v_cards;
END $$;

-- ------------------------------------------------------------
-- Conferência (segura em banco vazio: afirma AUSÊNCIA)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sobrou int;
BEGIN
  SELECT count(*) INTO v_sobrou
    FROM deals
   WHERE source = 'channel'
     AND titulo_fixado_em IS NULL
     AND title LIKE '% — %'
     AND btrim(substr(title, position(' — ' in title) + 3)) <> '';
  IF v_sobrou > 0 THEN
    RAISE EXCEPTION '1009: ainda sobraram % títulos com prefixo', v_sobrou;
  END IF;
END $$;

-- ============================================================
-- 946 — Modelo do Radar separado do modelo do agente de conversa.
--
-- O Radar lia `ai_configs.model`, a MESMA coluna do auto-reply, do
-- rascunho e do playground. Escolher o modelo pensando na análise
-- trocava, sem avisar, o modelo que responde ao cliente — e vice-versa.
-- Foi exatamente o que aconteceu: o operador cadastrou um modelo
-- "para o Radar" e configurou o assistente de conversa.
--
-- NULL = herda `model`, que é o comportamento de hoje. Nenhum backfill;
-- nada muda no dia em que esta migration é aplicada.
--
-- ⚠️ A TRANSCRIÇÃO NÃO GANHA COLUNA. O modelo dela é fixo no código
-- (`MODELO_TRANSCRICAO`, src/lib/transcricao/transcrever.ts) por decisão
-- da 943 — transcrever não precisa de raciocínio e o Lite custa ~metade.
-- O que muda é que a tela passa a MOSTRÁ-LO. Os embeddings idem
-- (EMBEDDING_MODEL, casado com `vector(1536)`).
--
-- ⚠️ MEDIDO EM 2026-08-28: o modelo dedicado `gemini-3.5-transcribe`
-- existe no catálogo e responde HTTP 200, mas devolve `parts: [{}]` e
-- ZERO tokens de saída pelo `:generateContent` — em três formas de
-- chamada, sobre cinco áudios reais. Não serve por este caminho. Quem
-- for tentar de novo precisa de outra superfície de API, não de outra
-- configuração.
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS radar_model text;

COMMENT ON COLUMN public.ai_configs.radar_model IS
  'Modelo do Radar de Atendimento nesta linha. NULL = herda ai_configs.model. A transcrição NÃO lê esta coluna (modelo fixo em src/lib/transcricao/transcrever.ts).';

-- String vazia seria um terceiro estado, ambíguo entre "herda" e "tem o
-- próprio" — e no Gemini viraria a URL `/models/:generateContent`, um 404
-- sem explicação, dentro do worker, de madrugada. Guardado por
-- `pg_constraint` para o replay do CI ser idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_configs'::regclass
       AND conname  = 'ai_configs_radar_model_nao_vazio'
  ) THEN
    ALTER TABLE public.ai_configs
      ADD CONSTRAINT ai_configs_radar_model_nao_vazio
      CHECK (radar_model IS NULL OR btrim(radar_model) <> '');
  END IF;
END $$;

-- ------------------------------------------------------------
-- Conferência
--
-- Afirma SÓ o que esta migration acabou de criar, e nada que dependa de
-- existir linha em `ai_configs` — é o que faz ela passar no replay do CI
-- contra um banco VAZIO (pipeline.yml, "Apply to a clean database").
--
-- Não há REVOKE aqui, logo não há GRANT a reconceder: a coluna herda os
-- privilégios e a RLS da tabela (029).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_tipo     text;
BEGIN
  SELECT is_nullable, data_type
    INTO v_nullable, v_tipo
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'ai_configs'
     AND column_name  = 'radar_model';

  IF v_nullable IS NULL THEN
    RAISE EXCEPTION '946: coluna radar_model não foi criada';
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION '946: radar_model precisa ser anulável (NULL = herda model)';
  END IF;
  IF v_tipo <> 'text' THEN
    RAISE EXCEPTION '946: radar_model deveria ser text, veio %', v_tipo;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_configs'::regclass
       AND conname  = 'ai_configs_radar_model_nao_vazio'
  ) THEN
    RAISE EXCEPTION '946: CHECK de radar_model não vazio não foi criado';
  END IF;

  -- Deliberadamente NÃO há teste de inserção aqui. Ele exigiria nomear
  -- as colunas obrigatórias de `ai_configs`, e qualquer divergência
  -- (coluna nova NOT NULL, FK de conta num banco vazio) faria a
  -- migration falhar por motivo alheio ao que ela criou. O catálogo já
  -- responde as duas perguntas que importam: a coluna existe e é
  -- anulável, e o CHECK está registrado na tabela certa.

  RAISE NOTICE '946: radar_model criada, anulável, com CHECK de não-vazio.';
END $$;

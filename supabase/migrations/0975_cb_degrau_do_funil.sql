-- 975_cb_degrau_do_funil.sql
--
-- Funil comercial, Fase 0 (docs/PLANO-funil-comercial.md).
--
-- 1) `pipeline_stages.degrau` — a que DEGRAU do funil de eficiência (fixo:
--    lead → mql → reuniao → proposta → contrato, mais a classe `perda`) cada
--    etapa corresponde. NULO = a etapa não conta. Várias etapas podem apontar
--    para o mesmo degrau (decisão do operador, 2026-09-03: "Entrada Avulsa" +
--    "Entrada Anúncios" = lead; "Contato Avulso" conta como lead). SEM
--    backfill: quem mapeia é o operador, na tela de Funis.
--    ⚠️ Independente de `resultado` (950): `resultado` decide o STATUS do
--    negócio ao entrar na etapa; `degrau` decide o que a etapa significa no
--    funil de eficiência. Nada deriva um do outro em tempo de execução — a
--    tela só SUGERE (ganho → contrato, perdido → perda).
--
-- 2) Índice em `cb_lead_events (to_pipeline_id, occurred_at)`: a trilha da
--    912 só tinha índice por contato e por negócio, e a pergunta do funil é
--    "quem já passou por ESTE funil?".
--
-- 3) `cb_funil_trajetorias(funil, desde, até)`: uma linha por negócio que já
--    passou pelo funil, com a TRAJETÓRIA (etapas em que entrou, quando, por
--    quem) e os dados de contato/campos que a lista mostra.
--    - SECURITY INVOKER: a RLS de deals, cb_lead_events, contacts,
--      conversations, contact_custom_values e custom_fields vale para quem
--      chama. Nada aqui abre dado que o membro não veria pelas tabelas.
--    - É SUPERCONJUNTO de propósito: devolve negócio criado no intervalo OU
--      com qualquer evento no intervalo. O recorte fino ("ENTROU no funil
--      dentro do período") depende do `degrau`, que a função não conhece —
--      o cálculo mora em src/lib/funil/ (puro, testado). SQL burro, TS esperto.
--    - ⚠️⚠️ Negócio TRANSFERIDO para outro funil continua saindo aqui (tem
--      evento com `to_pipeline_id` = este funil). DECISÃO DO OPERADOR
--      (2026-09-03): fechou → foi para o funil do Jurídico → continua
--      contando como contrato do comercial. O TS resolve a última etapa que
--      ele teve aqui; quem "simplificar" para `deals.pipeline_id` atual
--      apaga todo contrato transferido da estatística.
--    - `p_desde` nulo = Total (sem recorte). `p_ate` é EXCLUSIVO.
--    - Quem chama PAGINA (`order deal_id` + `range` + `count: exact`): o
--      PostgREST corta em ~1000 linhas sem avisar.

-- ---------------------------------------------------------------------------
-- 1) degrau
-- ---------------------------------------------------------------------------
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS degrau text;

ALTER TABLE pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_degrau_check;
ALTER TABLE pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_degrau_check
  CHECK (degrau IS NULL OR degrau IN ('lead', 'mql', 'reuniao', 'proposta', 'contrato', 'perda'));

COMMENT ON COLUMN pipeline_stages.degrau IS
  'Degrau do funil de eficiência (lead|mql|reuniao|proposta|contrato) ou perda. NULO = não conta. Independente de resultado. Ver 975.';

-- ---------------------------------------------------------------------------
-- 2) índice por funil na trilha
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cb_lead_events_funil_idx
  ON cb_lead_events (to_pipeline_id, occurred_at)
  WHERE deal_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) a RPC das trajetórias
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_funil_trajetorias(
  p_pipeline_id uuid,
  p_desde timestamptz DEFAULT NULL,
  p_ate timestamptz DEFAULT NULL
)
RETURNS TABLE (
  deal_id uuid,
  contact_id uuid,
  conversation_id uuid,
  conversa_do_contato uuid,
  title text,
  value numeric,
  status text,
  pipeline_id uuid,
  stage_id uuid,
  channel_id uuid,
  source text,
  assigned_to uuid,
  created_at timestamptz,
  updated_at timestamptz,
  contato_nome text,
  contato_telefone text,
  contato_email text,
  contato_empresa text,
  contato_avatar text,
  campos jsonb,
  trajeto jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH tocados AS (
    -- quem já ENTROU em alguma etapa deste funil (criado aqui, movido aqui
    -- ou transferido para cá)
    SELECT DISTINCT e.deal_id
    FROM cb_lead_events e
    WHERE e.to_pipeline_id = p_pipeline_id
      AND e.deal_id IS NOT NULL
      AND e.event_type IN ('deal_created', 'stage_changed', 'pipeline_changed')
  ),
  alvo AS (
    SELECT d.*
    FROM deals d
    JOIN tocados t ON t.deal_id = d.id
    WHERE p_desde IS NULL
       OR (d.created_at >= p_desde
           AND d.created_at < COALESCE(p_ate, 'infinity'::timestamptz))
       OR EXISTS (
         SELECT 1
         FROM cb_lead_events e
         WHERE e.deal_id = d.id
           AND e.occurred_at >= p_desde
           AND e.occurred_at < COALESCE(p_ate, 'infinity'::timestamptz)
       )
  )
  SELECT
    a.id,
    a.contact_id,
    a.conversation_id,
    (SELECT c2.id
       FROM conversations c2
      WHERE c2.contact_id = a.contact_id
        AND c2.account_id = a.account_id
      ORDER BY c2.created_at
      LIMIT 1),
    a.title,
    a.value,
    a.status,
    a.pipeline_id,
    a.stage_id,
    a.channel_id,
    a.source,
    a.assigned_to,
    a.created_at,
    a.updated_at,
    c.name,
    c.phone,
    c.email,
    c.company,
    c.avatar_url,
    (SELECT jsonb_object_agg(f.field_key, v.value)
       FROM contact_custom_values v
       JOIN custom_fields f ON f.id = v.custom_field_id
      WHERE v.contact_id = a.contact_id
        AND coalesce(v.value, '') <> ''),
    (SELECT jsonb_agg(
              jsonb_build_object(
                'etapa',  e.to_stage_id,
                'funil',  e.to_pipeline_id,
                'em',     e.occurred_at,
                'origem', e.origin,
                'tipo',   e.event_type)
              ORDER BY e.occurred_at, e.id)
       FROM cb_lead_events e
      WHERE e.deal_id = a.id
        AND e.event_type IN ('deal_created', 'stage_changed', 'pipeline_changed'))
  FROM alvo a
  LEFT JOIN contacts c ON c.id = a.contact_id
  ORDER BY a.id;
$$;

-- EXECUTE nasce concedido a PUBLIC; fechar exige as DUAS metades (lição da
-- 913/915), e o REVOKE de PUBLIC leva o service_role junto — devolver por
-- escrito (regra das migrations em banco vazio).
REVOKE EXECUTE ON FUNCTION public.cb_funil_trajetorias(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_funil_trajetorias(uuid, timestamptz, timestamptz)
  TO authenticated, service_role;

-- A função é SECURITY INVOKER: lê as tabelas com o privilégio de QUEM CHAMA.
-- Em produção o SELECT de `authenticated` nessas tabelas vem do default
-- privilege do Supabase; num banco VAZIO (o replay do CI) ele não existe, e a
-- conferência abaixo — que chama a função como `authenticated` — reprovava
-- com "permission denied for table contacts". A regra das migrations em
-- banco vazio: o que a migration CONFERE, ela CONCEDE. GRANT é idempotente
-- (no-op em produção) e a RLS de cada tabela continua mandando.
GRANT SELECT ON TABLE deals, contacts, conversations, contact_custom_values,
  custom_fields, cb_lead_events TO authenticated;

-- ---------------------------------------------------------------------------
-- Conferências — todas válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_stages' AND column_name = 'degrau'
  ) THEN
    RAISE EXCEPTION '975: coluna pipeline_stages.degrau ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cb_pipeline_stages_degrau_check') THEN
    RAISE EXCEPTION '975: CHECK do degrau ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'cb_lead_events_funil_idx'
  ) THEN
    RAISE EXCEPTION '975: índice cb_lead_events_funil_idx ausente';
  END IF;

  IF has_function_privilege('anon', 'public.cb_funil_trajetorias(uuid, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '975: anon ainda executa cb_funil_trajetorias';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.cb_funil_trajetorias(uuid, timestamptz, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_funil_trajetorias(uuid, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '975: authenticated/service_role sem EXECUTE em cb_funil_trajetorias';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER checa o privilégio de TUDO que roda dentro, como o
-- usuário que chamou — e o bloco acima roda como DONO. Trocar de papel é a
-- única forma de provar que `authenticated` consegue chamar (lição da 929).
-- Funil inexistente → zero linhas é o resultado certo, em qualquer banco.
DO $$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n
    FROM public.cb_funil_trajetorias(gen_random_uuid(), NULL, NULL);
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '975: funil inexistente devolveu % linha(s)', v_n;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '975: authenticated não consegue executar cb_funil_trajetorias: %', SQLERRM;
END $$;

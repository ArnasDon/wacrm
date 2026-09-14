-- ============================================================
-- 931 — Fecha o `anon` nas tabelas `cb_*` antigas (achado da Fase 6)
--
-- ⚠️ O QUE ISTO **NÃO** É: não é vazamento. Medido antes de escrever, com
-- `SET ROLE anon`, um visitante sem sessão enxerga **0 linhas** nas quatro
-- tabelas. Todas as políticas passam por `is_account_member(account_id)`, e sem
-- `auth.uid()` isso é falso; `cb_message_media_ref` nem política tem (RLS
-- ligada sem política = nega tudo).
--
-- O QUE ISTO É: uma inconsistência que só aparece olhando as fases JUNTAS. As
-- tabelas novas — `cb_conversation_notes` (918), `cb_conversation_favorites`
-- (924), `cb_scheduled_messages` (925), `cb_agendador_batimento` (927) — já
-- nascem com `REVOKE ... FROM anon`. As antigas, não:
--
--     cb_channels           (901)  anon: SELECT INSERT UPDATE DELETE
--     cb_groups             (906)  anon: SELECT INSERT UPDATE DELETE
--     cb_message_media_ref  (906)  anon: SELECT INSERT UPDATE DELETE
--     cb_lead_events        (912)  anon: SELECT
--
-- Ou seja: nessas quatro, a RLS é a **única** coisa entre um pedido anônimo e o
-- dado. Nas outras são duas. É exatamente o argumento que este projeto já
-- aceitou e escreveu na 929: deixar a concessão aberta transforma um bug futuro
-- de RLS em vazamento, em vez de em nada.
--
-- `cb_channels` é a que mais pesa: guarda a configuração de cada número de
-- WhatsApp do escritório.
--
-- ⚠️ Revogar aqui não pode quebrar nada, e o motivo é verificável: nenhuma
-- página anterior ao login lê estas tabelas. O convite (`/join/[token]`) passa
-- pela RPC `peek_invitation`, não por elas. Depois do login o pedido carrega o
-- JWT do usuário e o papel é `authenticated`, que este arquivo não toca.
-- ============================================================

REVOKE ALL ON TABLE public.cb_channels          FROM anon;
REVOKE ALL ON TABLE public.cb_groups            FROM anon;
REVOKE ALL ON TABLE public.cb_message_media_ref FROM anon;
REVOKE ALL ON TABLE public.cb_lead_events       FROM anon;

-- ------------------------------------------------------------
-- ⚠️ O acesso do `authenticated` a estas três tem de ser ESCRITO, não herdado
-- (achado pelo CI de migrations, 2026-08-26 — mesma causa da 919).
--
-- `cb_channels`, `cb_groups` e `cb_message_media_ref` nunca receberam GRANT em
-- nenhuma migration: o acesso vinha do *default privilege* do Supabase. Em
-- produção valeu; num banco novo não se repete, e a conferência abaixo — que
-- existe para provar que a revogação do `anon` não levou junto o
-- `authenticated` — reprovaria por um motivo que não é o que ela investiga.
--
-- Concedido exatamente o que a produção já tem (conferido em
-- `role_table_grants`) e o que a conferência exige. Lá é no-op.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cb_channels, public.cb_groups, public.cb_message_media_ref
  TO authenticated;

-- Idem para o `service_role`, que o laço de conferência também exige (o motor,
-- o webhook e o cron escrevem por ele).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cb_channels, public.cb_groups,
           public.cb_message_media_ref, public.cb_lead_events
  TO service_role;

-- ------------------------------------------------------------
-- Conferir o RESULTADO, nunca a intenção
--
-- ⚠️ As duas metades importam igualmente. A primeira prova que o `anon` perdeu
-- o acesso; a SEGUNDA prova que `authenticated` e `service_role` NÃO perderam
-- nada — uma revogação larga demais aqui derrubaria a tela de conexões, a
-- sincronização de grupos e a trilha de atividade de uma vez, e o sintoma seria
-- "sumiu tudo" sem erro na tela (a RLS filtra em silêncio).
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cb_channels', 'cb_groups', 'cb_message_media_ref', 'cb_lead_events'
  ] LOOP
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION '931: anon ainda tem acesso a %.', t;
    END IF;

    -- Quem usa a tela continua enxergando.
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '931: authenticated perdeu a leitura de % — a tela depende dela.', t;
    END IF;

    -- E a ingestão (webhook, sincronização de grupos, trilha) continua escrevendo.
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '931: service_role perdeu a escrita em % — a ingestão para.', t;
    END IF;
  END LOOP;

  -- Escrita pela tela, onde ela existia antes desta migration. `cb_lead_events`
  -- fica DE FORA de propósito: ela é escrita por trigger, e a 912 revogou a
  -- escrita de `authenticated` justamente para que ninguém forje trilha.
  FOREACH t IN ARRAY ARRAY['cb_channels', 'cb_groups', 'cb_message_media_ref'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'UPDATE') THEN
      RAISE EXCEPTION '931: authenticated perdeu a escrita em %.', t;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.cb_lead_events', 'INSERT') THEN
    RAISE EXCEPTION '931: authenticated ganhou escrita na trilha — a 912 a proibia.';
  END IF;
END $$;

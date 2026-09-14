-- ============================================================
-- 999 — `contacts.nome_fixado_em`: o nome que o WhatsApp não sobrescreve.
--
-- Até aqui, TRÊS caminhos de entrada trocavam o nome da ficha pelo nome do
-- perfil do WhatsApp sempre que os dois diferiam: a ingestão da Evolution
-- (`inbound-store.ts`), o webhook da Meta e o envio por telefone da API v1
-- (`resolve-conversation.ts`). É o comportamento do upstream, e ele desfazia
-- em silêncio qualquer nome escolhido de propósito.
--
-- O caso que pediu a coluna (decisão do operador, 14/09/2026): quando o
-- cliente AGENDA pelo Calendly, o nome da ficha e o título do negócio passam
-- a ser o nome que ele digitou no agendamento. O cliente muitas vezes fala
-- pelo celular da EMPRESA, e o perfil do WhatsApp diz o nome da empresa; quem
-- vai à reunião é a pessoa. Sem a marca, a primeira mensagem dele depois de
-- agendar devolvia o nome da empresa à ficha — que é justamente o momento em
-- que ele costuma escrever.
--
-- NULO = o nome segue o perfil do WhatsApp, como sempre. Preenchido = uma
-- fonte deliberada fixou o nome, e os três caminhos automáticos não o tocam.
-- Quem escreve o nome à mão (painel da conversa, ficha, formulário, PATCH da
-- API v1) continua podendo trocá-lo — a marca protege contra o AUTOMÁTICO,
-- não contra gente.
--
-- Aditiva: sem a coluna, a guarda `.is('nome_fixado_em', null)` dos três
-- caminhos faz o PostgREST recusar o UPDATE de nome, que já não confere o
-- erro — o nome deixaria de acompanhar o WhatsApp até a coluna existir, sem
-- quebrar a ingestão. Por isso a ordem é migration ANTES do deploy.
--
-- ⚠️ 999 é o ÚLTIMO número que ordena depois das 900: o replay do CI aplica
-- as migrations em ordem de NOME, e `1000_` cairia entre a `042_` e a `900_`.
-- A próxima migration exige decidir a numeração antes de nascer.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS nome_fixado_em timestamptz;

COMMENT ON COLUMN public.contacts.nome_fixado_em IS
  'Quando uma fonte deliberada fixou o nome da ficha (hoje: o agendamento do Calendly). NULL = o nome segue o perfil do WhatsApp. Preenchido, a ingestão (Evolution, Meta) e o envio por telefone da API v1 não sobrescrevem o nome. Ver 999.';

-- Conferência: a coluna existe. Afirmar presença de COLUNA é seguro em banco
-- vazio — não depende de dado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contacts'
       AND column_name = 'nome_fixado_em'
  ) THEN
    RAISE EXCEPTION '999: contacts.nome_fixado_em não foi criada';
  END IF;
END $$;

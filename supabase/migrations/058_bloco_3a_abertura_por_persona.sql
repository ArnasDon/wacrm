-- ============================================================
-- 058_bloco_3a_abertura_por_persona.sql — abertura comercial adaptada
-- ao anúncio de origem + registo do cargo confirmado pelo lead.
--
-- Contexto: a primeira mensagem de uma conversa comercial vinda de
-- anúncio (`conversations.source = 'meta_ad'`, migração 045) passa a
-- perguntar ao lead se é a pessoa certa (CEO / director comercial /
-- empresário, consoante o `ad_id` do anúncio que abriu a conversa —
-- ver src/lib/ai/commercial.ts), em vez de ir logo às perguntas de
-- qualificação. Esta migração só acrescenta onde guardar o cargo que
-- o lead confirmar; não há tabela `lead_qualification` no schema —
-- o equivalente é `contacts`, que já guarda name/email/company do
-- mesmo jeito (ver save_lead_details, commercial-schema.ts).
--
-- `contacts.lead_role` — texto livre (não um ENUM: o lead pode
-- confirmar o cargo sugerido pelo anúncio, corrigi-lo por palavras
-- próprias, ou dizer que "trata disto por outra via"). Escrito por
-- save_lead_details assim que o agente o souber.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_role text;

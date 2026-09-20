-- ============================================================
-- 046_bloco_3a_agenda_comercial.sql — Bloco 3-A: agendamento real no
-- modo comercial, contra o calendário de leads dedicado.
--
-- Context: a primeira versão do Bloco 3-A (migração 045) só entregava
-- um link de agendamento. O Ricardo pediu que o agente comercial marque
-- a reunião directamente, mas NUNCA no calendário pessoal dele — só
-- fica livre quando está livre em TODOS os calendários relevantes
-- (pessoal + leads), e o evento é sempre criado no calendário de leads.
--
-- A autenticação usa uma Google Service Account com domain-wide
-- delegation a impersonar geral@etergrowth.com (mesmo padrão já usado
-- no projecto Gestor, ver tools/google-calendar/setup-leads-calendar.ts
-- desse repo) — ver src/lib/calendar/google/service-account.ts.
-- Credenciais vêm sempre do ambiente (GOOGLE_SERVICE_ACCOUNT_JSON /
-- GMAIL_IMPERSONATE_USER), nunca de uma coluna nesta tabela.
--
-- Design notes
--   - `commercial_calendar_id` é o calendário onde o evento É CRIADO —
--     por omissão, o calendário dedicado "Eter | Leads WhatsApp" que já
--     existe (criado pelo script do projeto Gestor). Nunca o calendário
--     pessoal.
--   - `commercial_busy_calendar_ids` é a LISTA de calendários
--     consultados para decidir se uma hora está livre — por omissão
--     inclui "primary" (o calendário principal do utilizador
--     impersonado, geral@etergrowth.com) E o próprio calendário de
--     leads (para não sobrepor duas reuniões de leads entre si). Uma
--     hora só é proposta quando está livre em TODOS os calendários
--     desta lista — ver src/lib/calendar/commercial-availability.ts.
--   - As regras de agenda seguem o mesmo padrão de `calendar_configs`
--     (migração 037): duração, horário útil (agora como JSONB
--     `commercial_business_hours`, mesma forma de `business_hours` —
--     {"mon": [["09:00","18:00"]], ...} — para reutilizar directamente
--     `calculateAvailability`), fuso, antecedência mínima e intervalo
--     entre reuniões. `commercial_max_business_days_ahead` é o único
--     conceito novo: a janela de proposta é medida em DIAS ÚTEIS, não
--     em dias corridos, porque "10 dias à frente" incluindo dois fins-
--     de-semana devolveria menos disponibilidade útil do que a conta
--     espera.
--   - `commercial_booking_url` (já existente, migração 045) mantém-se
--     como alternativa: quando `commercial_calendar_id` está vazio, o
--     agente volta ao fluxo de entregar um link em vez de agendar.
--
-- Nenhuma política de RLS nova é necessária — estas colunas vivem em
-- `ai_configs`, já coberta pela migração 029.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_calendar_id text
    DEFAULT 'c_6ee9f924298b108f189b29ecccbeb28a87ac8f5ab4a384aacaa258a8a5fd1159@group.calendar.google.com';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_busy_calendar_ids text[]
    DEFAULT ARRAY[
      'primary',
      'c_6ee9f924298b108f189b29ecccbeb28a87ac8f5ab4a384aacaa258a8a5fd1159@group.calendar.google.com'
    ]::text[];

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_meeting_duration_min integer NOT NULL DEFAULT 30
    CHECK (commercial_meeting_duration_min > 0);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_timezone text NOT NULL DEFAULT 'Europe/Lisbon';

-- Same shape as calendar_configs.business_hours (migration 037):
-- { "mon": [["09:00","18:00"]], ... } — an absent weekday key means
-- closed all day. Default: Monday–Friday, 09:00–18:00, closed weekends.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_business_hours jsonb NOT NULL DEFAULT
    '{"mon": [["09:00","18:00"]], "tue": [["09:00","18:00"]], "wed": [["09:00","18:00"]], "thu": [["09:00","18:00"]], "fri": [["09:00","18:00"]]}'::jsonb;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_min_lead_time_min integer NOT NULL DEFAULT 120
    CHECK (commercial_min_lead_time_min >= 0);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_buffer_min integer NOT NULL DEFAULT 15
    CHECK (commercial_buffer_min >= 0);

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS commercial_max_business_days_ahead integer NOT NULL DEFAULT 10
    CHECK (commercial_max_business_days_ahead > 0);

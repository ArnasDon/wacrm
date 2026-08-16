# EterWA

Fork da Eter Growth de [wacrm](https://github.com/ArnasDon/wacrm) (MIT) —
CRM WhatsApp self-hostable em Next.js + Supabase. Objectivo: transformar
o `wacrm` num agente de IA de WhatsApp que qualifica leads e agenda
reuniões directamente no Google Calendar da conta.

- **Fork:** `Eter-2/eterwa` (org GitHub `Eter-2`)
- **Upstream:** `ArnasDon/wacrm` — remote `upstream`, nunca fazer push aqui
- **Branch de trabalho:** `feat/eter-agent`

## O que mudámos face ao upstream (Fase 1 — fundação)

Esta fase não adiciona lógica de negócio — só a base sobre a qual o
agente vai ser construído:

- `src/lib/calendar/date-resolver.ts` — resolutor determinístico de
  datas relativas em PT-PT ("amanhã", "próxima semana", "daqui a 5
  dias", "segunda-feira", "de manhã"/"de tarde", datas explícitas).
  Corre **antes** de qualquer chamada ao LLM ou a uma tool — o modelo
  nunca interpreta datas relativas sozinho. Timezone é sempre o da
  conta (`calendar_configs.timezone`), nunca UTC nem a tz do servidor.
  18 testes vitest em `date-resolver.test.ts`.
- `src/lib/ai/tools/schema.ts` — contrato JSON-Schema das 9 tools do
  agente (`check_availability`, `find_event`, `book_meeting`,
  `reschedule`, `cancel_booking`, `save_lead_qualification`,
  `notify_admin`, `escalate_to_human`, `send_reminder`). Só schemas —
  a implementação (tool-calling real nos providers OpenAI/Anthropic)
  é de uma fase seguinte.
- `supabase/migrations/037_eter_agent.sql` — **provisória.** Escrita
  seguindo as convenções Supabase/RLS do resto do repo (migrações
  029/030), mas a Eter Growth está a avaliar substituir Supabase por
  um Postgres interno próprio — ver `docs/eter-agent-config.md` e o
  relatório de desacoplamento do Supabase. Não assumir este schema
  como final.
- `docs/eter-agent-config.md` — variáveis de ambiente novas (Google
  OAuth para Calendar) que não puderam ir para `.env.local.example`
  por causa de uma guarda de segurança do harness sobre ficheiros
  `.env*`.

## O que ainda NÃO existe

1. Tool-calling real no LLM (hoje `src/lib/ai/generate.ts` só produz
   texto — os schemas em `tools/schema.ts` ainda não são chamados).
2. Qualquer integração real com o Google Calendar API (OAuth flow,
   criação/alteração/cancelamento de eventos).
3. Rubrica de qualificação de lead (o schema `lead_qualification` /
   `save_lead_qualification` existe, a lógica de pontuação não).
4. Decisão final sobre a camada de persistência (Supabase vs Postgres
   interno) — bloqueia finalizar a migração 037 e qualquer código que
   leia/escreva `calendar_configs`, `bookings`, `lead_qualification`.

## Arranque (herdado do upstream — Docker-first)

```bash
git clone git@github.com:Eter-2/eterwa.git
cd eterwa
cp .env.local.example .env.local   # preencher com valores reais
docker compose up
```

Ver `.env.local.example` para as variáveis obrigatórias (Supabase,
`ENCRYPTION_KEY`, `META_APP_SECRET`) e `docs/eter-agent-config.md` para
as variáveis novas do agente EterWA.

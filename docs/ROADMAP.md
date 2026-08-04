# Roadmap — wacrm

> Planejamento de funcionalidades futuras. Para o que já existe e funciona, ver `STATUS_PROJETO.md`.

## Prioridade alta

### 1. Decisão sobre WhatsApp real
Bloqueado por restrição do Meta no WABA (Solution Provider = Kommo, verificação de negócio nunca completada). Dois caminhos possíveis:
- **Contatar o suporte do Kommo** pedindo que completem a verificação — caminho recomendado, ainda não executado (a mensagem de suporte não foi redigida).
- Aceitar o bloqueio por ora e seguir operando o wacrm só com os dados já migrados, sem envio/recebimento real via WhatsApp, até resolver.

Sem isso, o CRM funciona como base de contatos/CRM mas não substitui o Kommo na função principal (atendimento via WhatsApp).

### 2. Google Calendar — sincronização real
A arquitetura já está pronta (`src/lib/calendar/`: `CalendarProvider`, `CalendarSyncService`, `mapAppointmentToCalendarEvent`) e as colunas de sync já existem em `appointments` (migration 045). `GoogleCalendarProvider` hoje é um stub que lança erro em todo método. Falta: fluxo de consentimento OAuth, tabela nova `calendar_connections` (tokens por conta), implementação real dos métodos usando `googleapis`, e ligar `CalendarSyncService` no create/update de compromisso. O botão "Conectar Google Calendar" já existe no cabeçalho da Agenda da Semana, hoje desabilitado.

### 3. Conectar Segmentos ao wizard de Transmissões
`src/lib/segments/queries.ts` (`listSegmentsWithCounts`) já devolve `tag_ids` por segmento no mesmo formato que `step2-select-audience.tsx` consome via `audience.tagIds` + `matchAll: true`. Falta um seletor "Usar um segmento salvo" no step de audiência das Transmissões que popule esses dois campos a partir de um segmento escolhido.

### 4. Segmentação imobiliária — badges de resumo por categoria
Mostrar contagem de leads por categoria/tag (ex.: um card "Bessa — 12 leads"). Avaliar se ainda faz sentido como card separado agora que o módulo de Segmentos já mostra contagem por combinação de tags, ou se vira só mais um tipo de segmento sugerido.

## Prioridade média

### 5. Agenda — Domingo, calendário mensal, lembretes e integração WhatsApp
A Agenda da Semana (migration 041, estendida na 045) já foi desenhada pensando nessas expansões: `WEEK_DAY_OFFSETS` em `src/lib/dashboard/date-utils.ts` só precisa ganhar o índice `6` (e a tradução `weekdays.sunday` já existe, só não é usada) para acrescentar Domingo sem retrabalho. Falta, além disso: view de calendário mensal, lembretes/notificações (reaproveitando a tabela `notifications` e `src/lib/push/send.ts`, mesmo padrão do módulo de Follow-up antigo), integração com WhatsApp (lembrete automático pro cliente). A integração com Google Calendar tem item próprio (#2).

### 6. Exportação CSV de contatos/negócios
Gap identificado no diagnóstico comparativo com o Kommo. Não há import/export simétrico hoje (import existe, export não).

### 7. Movimentação automática de estágio no funil (pipeline)
Outro gap do diagnóstico — hoje a movimentação entre estágios do Kanban é sempre manual; automações não conseguem mover um deal de estágio como ação.

## Prioridade baixa / ideias não detalhadas

- Ampliar a lista de categorias de segmentação além das 7 atuais, se o negócio pedir (ex.: "Fonte do lead", "Corretor responsável").
- Avaliar se vale a pena expor a segmentação também na API pública v1 (`src/app/api/v1/*`) para integrações externas (ex.: um formulário do site que já credite o lead com tags).
- Segmentos usados como audiência em Automações (mesma ideia do item 3, mas no motor de automações em vez do wizard de Transmissões).

## Fora de escopo por enquanto

- Qualquer trabalho em outros projetos do usuário (ex.: sistema de Gestão de Locações) — este roadmap cobre só o wacrm.

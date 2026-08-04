# Roadmap — wacrm

> Planejamento de funcionalidades futuras. Para o que já existe e funciona, ver `STATUS_PROJETO.md`.

## Prioridade alta

### 1. Decisão sobre WhatsApp real
Bloqueado por restrição do Meta no WABA (Solution Provider = Kommo, verificação de negócio nunca completada). Dois caminhos possíveis:
- **Contatar o suporte do Kommo** pedindo que completem a verificação — caminho recomendado, ainda não executado (a mensagem de suporte não foi redigida).
- Aceitar o bloqueio por ora e seguir operando o wacrm só com os dados já migrados, sem envio/recebimento real via WhatsApp, até resolver.

Sem isso, o CRM funciona como base de contatos/CRM mas não substitui o Kommo na função principal (atendimento via WhatsApp).

### 2. Agenda — UI de editar/excluir compromisso
`src/lib/appointments/queries.ts` já expõe `updateAppointment`/`updateAppointmentStatus`/`deleteAppointment`; a lista "Agenda do Dia" no dashboard (`agenda-today.tsx`) hoje só tem o botão "Novo Compromisso" (criar). Falta clicar num item da lista para abrir `AppointmentFormDialog` em modo edição, e um botão de excluir/marcar concluído por linha.

### 3. Conectar Segmentos ao wizard de Transmissões
`src/lib/segments/queries.ts` (`listSegmentsWithCounts`) já devolve `tag_ids` por segmento no mesmo formato que `step2-select-audience.tsx` consome via `audience.tagIds` + `matchAll: true`. Falta um seletor "Usar um segmento salvo" no step de audiência das Transmissões que popule esses dois campos a partir de um segmento escolhido.

### 4. Segmentação imobiliária — badges de resumo por categoria
Mostrar contagem de leads por categoria/tag (ex.: um card "Bessa — 12 leads"). Avaliar se ainda faz sentido como card separado agora que o módulo de Segmentos já mostra contagem por combinação de tags, ou se vira só mais um tipo de segmento sugerido.

## Prioridade média

### 5. Agenda — calendário mensal, lembretes e integrações
A tabela `appointments` (migration 041) já foi desenhada pensando nisso: `scheduled_date`/`scheduled_time` separados para agrupar por dia num calendário, schema pronto para status. Falta: view de calendário mensal, lembretes/notificações (reaproveitando a tabela `notifications` e `src/lib/push/send.ts`, mesmo padrão do módulo de Follow-up antigo), integração com WhatsApp (lembrete automático pro cliente) e com Google Calendar.

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

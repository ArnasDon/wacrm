# Status do Projeto — wacrm (CRM WhatsApp)

> Última atualização: **2026-08-04**, ao final da sessão que transformou a Agenda do Dia em Agenda da Semana imobiliária + preparação para Google Calendar.
> Este arquivo é o ponto de partida para qualquer sessão futura — leia antes de qualquer outra coisa.

## Estado atual

- **Produção:** https://crmronaldomeira.com — ativo, deploy automático via Hostinger a partir do branch `main` do fork.
- **Repositório:** [ronaldomeira-alt/wacrm](https://github.com/ronaldomeira-alt/wacrm) (fork de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), remote `upstream`).
- **Banco:** Supabase, projeto `qedptmrcvcbzhucoeznd`, plano FREE. Migrations aplicadas manualmente via SQL Editor do Supabase (sem CLI/CI) — ver `docs/ARQUITETURA.md`.
- **Conta de uso:** `ronaldomeiracorretor@gmail.com` (conta/account_id única até o momento — sem outros membros de equipe).
- **Build de produção:** validado nesta sessão (`next build` — compilou sem erros, TypeScript ok).
- **Testes automatizados:** mesma base de 651/654 (as 3 falhas continuam sendo `currency.test.ts`, pré-existente/não relacionado) — ver "Problemas conhecidos".
- Commit `ef8f27f` — código pronto localmente, será enviado (`git push`) e o deploy automático confirmado ao final desta sessão.

## O que está funcionando

- CRM completo em pt-BR (tradução 100% — `messages/pt-BR.json`, paridade garantida por teste automatizado com `en.json`).
- Caixa de entrada, funis (pipelines Kanban), automações, fluxos (flow builder), transmissões (broadcasts, com filtro AND/OR por tag), agentes de IA, templates.
- Contatos: CRUD completo, importação CSV, campos personalizados, tags agrupadas por categoria.
- **Dashboard redesenhado (novo, implementado hoje)** — de "analytics genérico" para central operacional:
  - 4 cards de KPI: Leads Hoje (novos contatos hoje vs ontem), Leads Não Respondidos (conversas cuja última mensagem é do cliente, sem resposta — card com destaque visual laranja), Tempo Médio de Primeira Resposta (janela de 7 dias), **Leads Aguardando Classificação** (contatos com conversa iniciada mas sem tag de classificação principal — card âmbar, clicável, leva para `/contacts?filter=unclassified`).
  - Removidos: gráfico "Conversas ao longo do tempo", "Valor do funil" (donut), "Tempo médio de primeira resposta" em gráfico por dia da semana, "Atividade recente", filtros 7/30/90 dias, e o card "Agenda Hoje" (duplicava conceitualmente a seção "Agenda do Dia" abaixo). Componentes deletados de vez (não só ocultados).
  - Botão "Novo negócio" na barra de ações rápidas virou **"Segmentos"**.
  - `MetricCard` agora suporta `href` (card inteiro clicável) e `tooltip` discreto no hover (requer `<TooltipProvider>` ancestral).
- **Módulo de Segmentos (novo)** — listas de contatos salvas a partir de combinação de tags (semântica **AND**, igual ao filtro de Transmissões: contato precisa ter *todas* as tags do segmento). CRUD completo (criar/editar/excluir/contar) via dialog aberto pelo botão "Segmentos". Estruturado (`src/lib/segments/queries.ts`) para reuso futuro em Transmissões/Automações.
- **Agenda da Semana (novo, era "Agenda do Dia")** — seção do Dashboard virou uma grade semanal (Segunda a Sábado, 6 colunas, cada dia com cor própria; Domingo propositalmente de fora mas já mapeado em `WEEK_DAY_OFFSETS`/traduções para entrar depois sem retrabalho). Cada compromisso mostra sempre client/horário/imóvel no card, sem precisar clicar; clique abre um modal com todos os campos (cliente, telefone, imóvel, data, hora, tipo, descrição, notas, criado em, atualizado em) e ações de Editar/Excluir (com confirmação). Tabela `appointments` ganhou `property_id` (nova tabela `properties`, minimalista) e `notes` (migration `045`). CRUD completo em `src/lib/appointments/queries.ts` e `src/lib/properties/queries.ts`; criação de imóvel pode ser feita inline no próprio formulário de compromisso.
- **Preparação para Google Calendar (novo, ainda não funcional)** — `src/lib/calendar/` define a arquitetura (`CalendarProvider`, `GoogleCalendarProvider` stub, `CalendarSyncService`, `mapAppointmentToCalendarEvent`) e `appointments` ganhou as colunas `external_calendar_id`/`sync_status`/`last_synced_at` (migration `045`). Nada disso está ligado a UI/API real — é só a arquitetura pronta para quando a integração de verdade (OAuth + `googleapis`) for implementada. Botão "Conectar Google Calendar" já existe no cabeçalho da Agenda, desabilitado.
- Filtro de contatos e de transmissões com alternância **"Qualquer uma dessas tags" (OR)** / **"Todas essas tags" (AND)**.
- PWA + notificações push (Web Push/VAPID) — testado em iPhone real, funcionando.
- Deploy contínuo: qualquer `git push origin main` dispara redeploy automático no Hostinger.

## O que está em desenvolvimento / pendente

- **Conexão real do WhatsApp Cloud API** — bloqueada. Ver "Problemas conhecidos".
- **Google Calendar — sincronização real** (OAuth + `googleapis`) — só a arquitetura (`CalendarProvider`/`CalendarSyncService`/`GoogleCalendarProvider` stub) está pronta, ver `docs/ARQUITETURA.md`. Precisa de tabela `calendar_connections` (tokens por conta) e do fluxo de consentimento OAuth antes de o botão "Conectar Google Calendar" sair do estado desabilitado.
- **Agenda — expansões futuras já mapeadas** (não implementadas): Domingo na grade semanal (arquitetura já suporta, só falta ligar), calendário mensal, lembretes/notificações, integração WhatsApp.
- **Segmentos usados em Transmissões/Automações** — hoje é só um contador+lista; ainda não há um seletor de "usar este segmento" dentro do wizard de Transmissões (usaria `listSegmentsWithCounts` + o mesmo `matchAll` já implementado lá).
- **Segmentação — etapa 6 do roadmap antigo** (badges de contagem por categoria, ex.: "12 leads em Bessa") — ainda não implementada.
- Módulo de Follow-up/Tarefas conforme descrito no roadmap antigo foi essencialmente substituído pelo módulo de Agenda desta sessão (mesma necessidade, nome/escopo diferente).

## Última alteração realizada

**Sessão de 2026-08-04 (parte 7)** — horário de término no compromisso (migration `046`):

`appointments` ganhou `scheduled_end_time` (TIME, opcional), espelhando o modelo início+fim do Google Calendar. Formulário de compromisso ganhou um segundo campo de horário ("Horário de término") ao lado do horário de início, com validação de que o fim precisa vir depois do início (e não pode existir sem um início definido). O modal de detalhe mostra o intervalo completo ("14:30 – 15:30") quando há término; **o card da grade semanal continua mostrando só o horário de início**, por pedido explícito — o objetivo era só ter os dois horários disponíveis para a preparação do Google Calendar, não adicionar uma segunda linha ao card. `mapAppointmentToCalendarEvent` (`src/lib/calendar/`) agora usa `scheduled_end_time` para preencher `CalendarEvent.endAt` quando presente, em vez de sempre `null`.

Commit `ef8f27f`. Migration `046` aplicada manualmente em produção antes do deploy do código.

**Validação:** `tsc`, `eslint` (zero erros/warnings nos arquivos tocados), `vitest run src/i18n/messages.test.ts` (paridade en/pt-BR/ko) e `next build` limpos.

---

**Sessão de 2026-08-04 (parte 6)** — Agenda do Dia → Agenda da Semana imobiliária + preparação para Google Calendar:

1. **Migration `045`** — tabela `properties` (nova, `account_id`/`user_id`/`name`, RLS nível `agent`). `appointments` ganhou `property_id` (FK opcional, `ON DELETE SET NULL`), `notes`, e os 3 campos de preparação para sync: `external_calendar_id`, `sync_status` (enum textual `not_synced`/`synced`/`error`, default `not_synced`), `last_synced_at`. Aplicada manualmente via SQL Editor do Supabase, verificada por `information_schema.columns`.
2. **Agenda da Semana** (`src/components/dashboard/agenda-week.tsx`, substitui `agenda-today.tsx` que foi deletado) — grade de 6 colunas (Segunda–Sábado), uma cor por dia (azul/verde/roxo/laranja/vermelho suave/amarelo, tons ajustados para o tema escuro), `overflow-x-auto` + `min-w-[1020px]` para funcionar tanto com as 6 colunas simultâneas no desktop quanto com scroll horizontal suave no mobile sem quebrar layout. Cada card mostra sempre nome do cliente, horário e nome do imóvel (com truncamento elegante) sem precisar clicar. `WEEK_DAY_OFFSETS` em `src/lib/dashboard/date-utils.ts` é a única lista que precisa ganhar mais um item (`6`) para acrescentar Domingo no futuro — todo o resto (cores, traduções, grid) já está preparado.
3. **Modal de detalhe/edição** (`src/components/appointments/appointment-detail-sheet.tsx`, novo) — clique no card abre todos os campos (cliente, telefone, imóvel, data, hora, tipo, descrição, notas, criado em, atualizado em), com botões Editar (reabre o formulário de compromisso pré-preenchido) e Excluir (com diálogo de confirmação antes de apagar).
4. **Formulário de compromisso** (`appointment-form-dialog.tsx`, reescrito) — novo campo Imóvel (select + criação inline de imóvel novo sem sair do formulário, mesmo padrão de "criar tag rápida" do gerenciador de tags) e novo campo Notas (separado de Descrição). Ordem dos campos: Cliente → Imóvel → Data/Hora → Tipo → Descrição → Notas.
5. **Preparação para Google Calendar** (`src/lib/calendar/`, novo, deliberadamente não funcional) — `CalendarProvider` (interface), `GoogleCalendarProvider` (stub, todo método lança erro, `isConfigured()` sempre `false`, sem OAuth/sem chamada de API), `CalendarSyncService` (orquestraria criar/atualizar + gravar `sync_status`), `mapAppointmentToCalendarEvent`. Botão "Conectar Google Calendar" já existe no cabeçalho da Agenda, desabilitado com tooltip explicando que ainda não está pronto.
6. **Traduções** (`en`/`pt-BR`/`ko`) — namespace `Dashboard.agenda` reescrito para o contexto semanal (`weekdays.monday`...`saturday`, e `sunday` já incluído mas não usado ainda), namespace novo `Appointments.detail` para o modal, novas chaves de imóvel/notas em `Appointments.form`. Bloco órfão `Dashboard.emptyState` removido (só existia para o componente `empty-state.tsx`, também deletado por falta de uso).
7. **Documentação** — `docs/ARQUITETURA.md` atualizado (contagem de migrations, árvore de `lib/`, bullets dedicados para Agenda/Imóveis/preparação Google Calendar na seção de banco de dados).

Commit `90eab2b`. Migration `045` aplicada manualmente em produção antes do deploy do código, mesmo fluxo das sessões anteriores.

**Validação:** `tsc --noEmit`, `eslint` (zero erros/warnings nos arquivos tocados, incluindo dois ajustes pontuais: um `eslint-disable` desnecessário removido em `agenda-week.tsx`, e 3 comentários `eslint-disable-next-line` adicionados em `google-calendar-provider.ts` para os parâmetros não usados dos stubs), `vitest run` (mesma base 651/654, incluindo paridade de traduções) e `next build` limpos.

---

**Sessão de 2026-08-04 (parte 5)** — localização pt-BR completa de Notificações/Automações, rename Funil→Pipeline, remoção da faixa de métricas do Pipeline:

1. **Notificações** — a tela inteira nunca passava por `next-intl` (100% hardcoded em inglês). Criada a namespace `Notifications.page`, todo o texto traduzido, timestamps relativos agora usam o locale do date-fns (`src/lib/date-fns-locale.ts`, mapeando o locale do next-intl). A `migration 044` trocou o texto do trigger SQL `notify_conversation_assigned` (título/corpo da notificação, gerados no INSERT) para português — é conteúdo salvo como dado, não uma chave de tradução, então não dava para resolver só no front.
2. **Automações** — auditoria completa de `automation-builder.tsx` (1740 linhas) encontrou ~10 pontos sem i18n: labels de config de gatilho, chrome do card de etapa ("Condition"/"Wait"/"Action", "Move up/down"), um `delete` que dependia de fallback em inglês, um label "Value" solto, e a função `previewFor()` (prévia de cada etapa) inteira sem tradução. `trigger-meta.ts` (`TRIGGER_META`/`formatRelative`) também tinha inglês hardcoded — agora reaproveita os labels já traduzidos do builder em vez de manter um segundo conjunto. `AUTOMATION_TEMPLATES` (os 4 templates de início rápido) virou português direto, incluindo o texto real das mensagens de WhatsApp e as palavras-chave do qualificador de leads (eram "pricing, quote, buy").
3. **GatedButton** — o tooltip "Read-only — your role can't X" era hardcoded em inglês, usado por 16 botões em 6 arquivos (automações, transmissões, contatos, fluxos, pipeline, composer do inbox). Template e as 16 frases traduzidos.
4. **Rename Funil→Pipeline** — só em `messages/pt-BR.json` (en/ko já usavam "Pipeline(s)"/equivalente correto): nav, tela de Pipeline, configurações de pipeline, filtro de pipeline no detalhe de transmissão, campos de pipeline no builder de automações, textos de config de negócios/moeda, descrição do manifest PWA.
5. **Faixa de métricas do Pipeline removida** — `pipeline-analytics.tsx` deletado (único importador confirmado, sem estado compartilhado com o Kanban), import/JSX removidos de `pipelines/page.tsx`, bloco `Pipelines.analytics` removido das 3 mensagens de tradução. Seletor de pipeline, botões "Adicionar pipeline"/"Adicionar negócio" e o board intactos.

Commit: `181540d`. Migration `044` aplicada manualmente em produção antes do deploy do código.

**Validação:** `tsc --noEmit`, `eslint` (zero erros; warnings restantes são todos pré-existentes/não relacionados), `next build` (55 páginas) e `vitest run` (651/654, mesmas 3 falhas de `currency.test.ts`) limpos. Testado em produção: Notificações e o builder de Automações (abri o template "Qualificador de leads", conferi chrome de etapa, texto da mensagem, botão Excluir) 100% em português; tela e dialog "Gerenciar pipeline" sem nenhum "Funil" restante; tela de Pipeline abre direto nas colunas, sem a faixa de métricas.

---

**Sessão de 2026-08-04 (parte 4)** — card "Leads Aguardando Classificação" no lugar de "Agenda Hoje":

1. `supabase/migrations/043_unclassified_leads.sql` — RPCs `count_unclassified_leads` (KPI) e `list_unclassified_contacts` (drill-through paginado, mesmo formato `TABLE(contact, total_count)` de `filter_contacts_by_all_tags`). Ambas parametrizadas por `p_classification_category` (default `'Finalidade'`) — **não** hardcodam os nomes das tags "Moradia"/"Investimento", só a categoria que as agrupa. Adicionar uma nova tag de classificação no futuro = criar a tag sob a categoria "Finalidade", sem tocar em código.
2. `CLASSIFICATION_CATEGORY` exportada de `src/lib/contacts/tag-categories.ts` — fonte única de verdade do lado da aplicação para o que conta como "classificado".
3. `src/lib/dashboard/queries.ts` — nova `loadUnclassifiedLeadsCount`.
4. `metric-card.tsx` — ganhou `href` (card inteiro vira link) e `tooltip` (hover discreto via `Tooltip`/`TooltipTrigger`, mesmo padrão de `pipeline-analytics.tsx`; requer `<TooltipProvider>` ancestral, adicionado em volta do grid de KPIs em `dashboard/page.tsx`).
5. `dashboard/page.tsx` — removido o card "Agenda Hoje" (estado, imports, ícone `Calendar`) — a seção "Agenda do Dia" abaixo continua intocada, self-fetching. Novo card: ícone `Tags`, tint `amber`, `subtitle`, `href="/contacts?filter=unclassified"`, `tooltip`.
6. `contacts/page.tsx` — passou a ler `?filter=unclassified` via `useSearchParams` (componente dividido em wrapper + `ContactsPageInner` dentro de `<Suspense>`, mesmo padrão de `inbox/page.tsx`). Nesse modo, `fetchContacts` chama `list_unclassified_contacts` em vez do filtro de tags normal; um banner âmbar dispensável mostra o modo ativo; escolher uma tag manualmente no popover sai do modo automaticamente (os dois modos não se combinam).
7. Traduções (`en`/`pt-BR`/`ko`): removidas as chaves órfãs `appointmentsToday`/`noAppointments`/`appointmentsCount`/`nextAt` (só existiam para o card removido); adicionadas `unclassifiedLeads`/`needsCategorization`/`unclassifiedLeadsTooltip` em `Dashboard.page` e `unclassifiedFilterBanner` em `Contacts.page`.

Commit: `74baf2d`. Migration aplicada manualmente em produção via SQL Editor do Supabase antes do deploy do código.

**Validação:** `tsc --noEmit`, `eslint` (zero erros/warnings nos arquivos tocados), `next build` (55 páginas, `/contacts` continua estática apesar do `useSearchParams`) e `vitest run` (651/654, mesmas 3 falhas pré-existentes) todos limpos. Testado ponta a ponta em produção: card mostra "0" (o único contato de teste já tem tag "Investimento"), tooltip aparece com o texto exato pedido, clique navega para `/contacts?filter=unclassified` com o banner e a lista corretamente vazia, o X do banner limpa o filtro e volta para `/contacts` sem query string.

## Próxima tarefa recomendada

Na ordem de prioridade sugerida:

1. Decidir o próximo passo do WhatsApp: contatar suporte do Kommo pedindo verificação do Solution Provider, **ou** aceitar o bloqueio e seguir sem WhatsApp real por enquanto.
2. Implementar sincronização real com Google Calendar (OAuth + `googleapis`) sobre a arquitetura já preparada em `src/lib/calendar/`.
3. Conectar Segmentos ao wizard de Transmissões como uma opção de audiência (reaproveitando `matchAll` já implementado lá).
4. Badges de contagem por categoria de tag (etapa 6 do roadmap antigo), se ainda fizer sentido dado o novo módulo de Segmentos.

## Pendências e problemas conhecidos

- **WhatsApp bloqueado no Meta:** o WABA está restrito porque o "Solution Provider" vinculado (o próprio Kommo, registrado como parceiro técnico com acesso total) nunca completou a verificação de negócio da Meta. Revisão solicitada em 2026-07-28, ainda pendente na última checagem (2026-07-30), sem e-mail de resposta da Meta. Decisão tomada: **não remover o Kommo como parceiro** antes de tentar contato com o suporte deles — essa mensagem ainda não foi redigida. Isso também é o motivo de o wizard de Transmissões não conseguir ser testado visualmente ponta a ponta (nenhum template `APPROVED`).
- **3 testes falhando, não relacionados a esta sessão:**
  - `src/lib/currency.test.ts` (3 testes) — depende do `Intl.NumberFormat` do Node/ICU instalado na máquina; formatação de locale diverge do esperado neste ambiente Windows local.
- **Testes pendentes de confirmação manual pelo usuário:**
  - Recadastrar "Adicionar à tela inicial" / push notifications no domínio novo de produção (`crmronaldomeira.com`) — feito e validado antes só no domínio antigo/local.
  - Login manual em produção ainda não confirmado pelo próprio usuário (eu validei que a página carrega e testei o fluxo logado nesta sessão via sessão já autenticada no navegador, mas não digitei a senha real).
- **Gaps identificados no diagnóstico comparativo com o Kommo, não solicitados ainda:** exportação CSV de contatos/negócios, movimentação automática de estágio no funil.

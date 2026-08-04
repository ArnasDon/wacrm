# Status do Projeto — wacrm (CRM WhatsApp)

> Última atualização: **2026-08-04**, ao final da sessão de redesenho do Dashboard + módulos de Segmentos e Agenda.
> Este arquivo é o ponto de partida para qualquer sessão futura — leia antes de qualquer outra coisa.

## Estado atual

- **Produção:** https://crmronaldomeira.com — ativo, deploy automático via Hostinger a partir do branch `main` do fork.
- **Repositório:** [ronaldomeira-alt/wacrm](https://github.com/ronaldomeira-alt/wacrm) (fork de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), remote `upstream`).
- **Banco:** Supabase, projeto `qedptmrcvcbzhucoeznd`, plano FREE. Migrations aplicadas manualmente via SQL Editor do Supabase (sem CLI/CI) — ver `docs/ARQUITETURA.md`.
- **Conta de uso:** `ronaldomeiracorretor@gmail.com` (conta/account_id única até o momento — sem outros membros de equipe).
- **Build de produção:** validado nesta sessão (`next build` — compilou sem erros, TypeScript ok, 55 páginas estáticas geradas).
- **Testes automatizados:** 651/654 passando. As 3 falhas são pré-existentes (`currency.test.ts`, dependente de ICU/locale da máquina) — ver "Problemas conhecidos". As 2 falhas de `mondayIndex` que existiam antes foram eliminadas nesta sessão junto com o código morto que as usava.
- Commit `cab532b` já em produção (deploy automático confirmado, testado visualmente em desktop e mobile).

## O que está funcionando

- CRM completo em pt-BR (tradução 100% — `messages/pt-BR.json`, paridade garantida por teste automatizado com `en.json`).
- Caixa de entrada, funis (pipelines Kanban), automações, fluxos (flow builder), transmissões (broadcasts, com filtro AND/OR por tag), agentes de IA, templates.
- Contatos: CRUD completo, importação CSV, campos personalizados, tags agrupadas por categoria.
- **Dashboard redesenhado (novo, implementado hoje)** — de "analytics genérico" para central operacional:
  - 4 cards de KPI: Leads Hoje (novos contatos hoje vs ontem), Leads Não Respondidos (conversas cuja última mensagem é do cliente, sem resposta — card com destaque visual laranja), Tempo Médio de Primeira Resposta (janela de 7 dias), Agenda Hoje (contagem + próximo horário).
  - Removidos: gráfico "Conversas ao longo do tempo", "Valor do funil" (donut), "Tempo médio de primeira resposta" em gráfico por dia da semana, "Atividade recente", filtros 7/30/90 dias. Componentes deletados de vez (não só ocultados).
  - Botão "Novo negócio" na barra de ações rápidas virou **"Segmentos"**.
- **Módulo de Segmentos (novo)** — listas de contatos salvas a partir de combinação de tags (semântica **AND**, igual ao filtro de Transmissões: contato precisa ter *todas* as tags do segmento). CRUD completo (criar/editar/excluir/contar) via dialog aberto pelo botão "Segmentos". Estruturado (`src/lib/segments/queries.ts`) para reuso futuro em Transmissões/Automações.
- **Módulo de Agenda/Compromissos (novo)** — tabela `appointments` (tipos: Ligação, Visita, Reunião, Proposta, Follow-up, Outro), vinculável a um contato. Seção "Agenda do Dia" no Dashboard com lista do dia + botão "Novo Compromisso". CRUD de leitura/criação/edição pronto em `src/lib/appointments/queries.ts`; a UI do dashboard hoje só expõe criar (editar/excluir ainda não têm botão na lista — API já suporta, falta UI).
- Filtro de contatos e de transmissões com alternância **"Qualquer uma dessas tags" (OR)** / **"Todas essas tags" (AND)**.
- PWA + notificações push (Web Push/VAPID) — testado em iPhone real, funcionando.
- Deploy contínuo: qualquer `git push origin main` dispara redeploy automático no Hostinger.

## O que está em desenvolvimento / pendente

- **Conexão real do WhatsApp Cloud API** — bloqueada. Ver "Problemas conhecidos".
- **Agenda — UI de editar/excluir compromisso** na lista do dashboard (o backend/lib já suporta `updateAppointment`/`deleteAppointment`, só falta o botão).
- **Agenda — expansões futuras já mapeadas na arquitetura** (não implementadas): calendário mensal, lembretes/notificações, integração WhatsApp, integração Google Calendar.
- **Segmentos usados em Transmissões/Automações** — hoje é só um contador+lista; ainda não há um seletor de "usar este segmento" dentro do wizard de Transmissões (usaria `listSegmentsWithCounts` + o mesmo `matchAll` já implementado lá).
- **Segmentação — etapa 6 do roadmap antigo** (badges de contagem por categoria, ex.: "12 leads em Bessa") — ainda não implementada.
- Módulo de Follow-up/Tarefas conforme descrito no roadmap antigo foi essencialmente substituído pelo módulo de Agenda desta sessão (mesma necessidade, nome/escopo diferente).

## Última alteração realizada

**Sessão de 2026-08-04 (parte 3)** — redesenho completo do Dashboard + Segmentos + Agenda:

1. `supabase/migrations/040_segments.sql` — tabelas `segments`/`segment_tags` + RPC `list_segments_with_counts` (AND, reaproveitando a lógica de `filter_contacts_by_all_tags`).
2. `supabase/migrations/041_appointments.sql` — tabela `appointments` (tipos, status, data/hora separadas, RLS nível "agent" como `deals`).
3. `supabase/migrations/042_dashboard_kpis.sql` — RPC `count_unanswered_conversations` (última mensagem por conversa é do cliente, sem resposta).
4. `src/lib/segments/queries.ts`, `src/lib/appointments/queries.ts` — camadas de dados novas, sem UI, pensadas para reuso.
5. `src/lib/dashboard/queries.ts`/`types.ts` — reescritos: saíram `loadConversationsSeries`/`loadPipelineDonut`/`loadResponseTime`/`loadActivity`; entraram `loadLeadsToday`/`loadUnansweredCount`/`loadFirstResponseAvg`.
6. Componentes novos: `agenda-today.tsx`, `segments-manager-dialog.tsx`, `appointment-form-dialog.tsx`. `metric-card.tsx` ganhou `tint`/`highlighted`.
7. `dashboard/page.tsx` reescrito do zero. `quick-actions.tsx` trocou "Novo negócio" por "Segmentos".
8. Deletados: `conversations-chart.tsx`, `pipeline-donut.tsx`, `response-time-chart.tsx`, `activity-feed.tsx`, e os helpers órfãos `mondayIndex`/`DOW_SHORT_MON_FIRST` de `date-utils.ts` (com os testes correspondentes).
9. Traduções novas/removidas em `en.json`/`pt-BR.json`/`ko.json` (namespaces `Dashboard`, `Segments`, `Appointments`), paridade validada por `messages.test.ts`.

Commits: `cab532b` (código) e um commit de docs em seguida. Migrations aplicadas manualmente em produção via SQL Editor do Supabase (não fazem parte do `git push` — Hostinger só faz deploy do código Next.js).

**Validação:** `tsc --noEmit` limpo, `eslint` limpo (zero erros/warnings nos arquivos novos/alterados), `next build` ok (55 páginas), `vitest run` 651/654 (mesmas 3 falhas pré-existentes de `currency.test.ts`, nada novo quebrou — e 2 falhas antigas de `mondayIndex` desapareceram por serem código morto removido). Testado ponta a ponta em produção: criação/exclusão de segmento com contagem correta (RPC `list_segments_with_counts`), criação de compromisso aparecendo na Agenda do Dia e refletindo no card "Agenda Hoje" após reload, responsividade mobile (2 colunas, sem scroll horizontal) verificada em viewport ~500px via Chrome. Registros de teste (`Investidores Teste`, `Ligar para lead teste`) foram removidos da produção depois do teste.

## Próxima tarefa recomendada

Na ordem de prioridade sugerida:

1. Decidir o próximo passo do WhatsApp: contatar suporte do Kommo pedindo verificação do Solution Provider, **ou** aceitar o bloqueio e seguir sem WhatsApp real por enquanto.
2. UI de editar/excluir compromisso na Agenda do Dia (backend já pronto).
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

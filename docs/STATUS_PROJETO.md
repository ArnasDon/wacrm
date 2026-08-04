# Status do Projeto — wacrm (CRM WhatsApp)

> Última atualização: **2026-08-04**, ao final da sessão de redesenho do Dashboard + módulos de Segmentos e Agenda + card "Leads Aguardando Classificação".
> Este arquivo é o ponto de partida para qualquer sessão futura — leia antes de qualquer outra coisa.

## Estado atual

- **Produção:** https://crmronaldomeira.com — ativo, deploy automático via Hostinger a partir do branch `main` do fork.
- **Repositório:** [ronaldomeira-alt/wacrm](https://github.com/ronaldomeira-alt/wacrm) (fork de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), remote `upstream`).
- **Banco:** Supabase, projeto `qedptmrcvcbzhucoeznd`, plano FREE. Migrations aplicadas manualmente via SQL Editor do Supabase (sem CLI/CI) — ver `docs/ARQUITETURA.md`.
- **Conta de uso:** `ronaldomeiracorretor@gmail.com` (conta/account_id única até o momento — sem outros membros de equipe).
- **Build de produção:** validado nesta sessão (`next build` — compilou sem erros, TypeScript ok, 55 páginas estáticas geradas).
- **Testes automatizados:** 651/654 passando. As 3 falhas são pré-existentes (`currency.test.ts`, dependente de ICU/locale da máquina) — ver "Problemas conhecidos".
- Commit `74baf2d` já em produção (deploy automático confirmado, testado visualmente).

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

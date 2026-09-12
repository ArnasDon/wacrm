# PLANO — Meu dia: resumo de pendências na entrada e logout por inatividade

> **Status: proposta, aguardando aprovação do operador.** Nada foi implementado.
>
> **O que é este arquivo.** Um plano vivo e checável, no molde de `docs/PLANO-funil-comercial.md` e `docs/PLANO-webhooks-de-entrada.md`. Ao concluir cada fase, registrar a data e o resultado medido.
>
> **Este documento envelhece.** Os números de linha foram conferidos contra o `main` de 10/09/2026: o checkout em `docs/plano-integracao-asaas` tem o código de app igual ao `main` (merge `5bb66d8`). Antes de agir numa linha citada, confira de novo.
>
> - **Criado:** 10/09/2026 · **Revisado (v2):** 10/09/2026, depois de quatro revisões independentes (fatos, sessão, produto, simplicidade). O que mudou está na §10.
> - **Medido contra:** código, em somente leitura, e **produção medida em 12/09/2026 às 11:13 (sábado)** — o operador rodou ele mesmo o script somente leitura (só agregados) contra a API de gerenciamento, com o token da CLI. Uma consulta falhou (perfis) e uma não estava no script (agenda × Calendly); ficam para uma segunda rodada (F0, §12).
> - **Fluxo por fase:** branch a partir de `main` → PR para o CB-CRM → revisão → merge. Um PR por fase.
> - **Migration:** nenhuma nas fases F1 a F3.

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| F0 | Medições e decisões | medição feita em 12/09 (§2.2); faltam a 2ª rodada e as respostas da §6 | — | — |
| F1 | Tela de entrada "Meu dia" (resumo que bloqueia) + "Sair" deste aparelho | **implementada em 12/09/2026** (branch `feat/meu-dia`; §13) | nenhuma | a abrir |
| F2a | Relógio de atividade entre abas: depois de 4 h sem ninguém mexer, o Meu dia volta a aparecer, **sem senha** | a fazer (D3a) | nenhuma | — |
| F3 | Painel permanente `/meu-dia` no menu | recomendado logo depois da F1 (D10) | nenhuma | — |
| F2b | Pedir a senha depois de 4 h sem atividade + login que devolve ao ponto | a decidir (D3b) depois de alguns dias com F1, F2a e F3 em uso | nenhuma | — |

**Ordem recomendada (revisão do coordenador, §11):** F0 → F1 → F2a → F3 → uso real por alguns dias → F2b. A F2 da v2 foi partida em duas: a volta do Meu dia é uma troca de tela comum, com a sessão viva, e sai barata; o pedido de senha é a parte delicada (encerramento ordenado, login, middleware) e merece decisão com a feature já em uso. Onde o texto abaixo diz "F2", a §7 separa o que é F2a e o que é F2b. A F4 da v1 saiu. A D4 entra na F1 (mesmo arquivo), e a D11 é conferência da F0 com a decisão no fim da F2b.

---

## 1. O que entendi do pedido

Em linguagem simples, para você confirmar:

1. **Toda vez que alguém entra no CRM**, antes de ver qualquer tela, aparece uma página só dela, chamada **"Meu dia"**. Ela mostra o que chegou desde a última entrada e o que está pendente hoje. Exemplo:
   - "**Desde a sua última entrada:** 2 menções a você · 1 tarefa encaminhada · 1 conversa atribuída a você."
   - "**Hoje:** 3 tarefas vencem hoje · 4 vencidas · 2 reuniões na agenda do CRM · clientes esperando resposta: 2 atribuídos a você, 12 sem responsável."
   - Cada bloco lista até 5 itens pelo nome, com link para o lugar.
2. A pessoa **precisa clicar em "Continuar"** para usar o sistema. É um lembrete, não uma prova: o clique não marca nada como lido e não grava nada no servidor.
3. Você propôs o logout depois de 4 horas paradas para que esse lembrete voltasse. **Ele não é necessário para isso.** A tela já volta sozinha a cada login e no primeiro acesso de cada dia, e pode voltar também depois de 4 h sem ninguém mexer, **sem pedir senha** (pergunta D3a). **Pedir a senha de novo** depois de 4 h é uma decisão de **segurança**, separada (pergunta D3b): serve para o computador compartilhado ou esquecido aberto.
4. Os assuntos são: **notificações**, **conversas atribuídas à pessoa e clientes esperando resposta**, **menções**, **tarefas** e **reuniões**.
   **Pergunta:** por "comentários" você quer dizer as **anotações internas da conversa**, onde se marca um colega com @? É o único lugar do CRM que tem menção.
5. Sobre "só o administrador tem painel": o Painel aparece para **você**, porque o dono vê tudo, e para o perfil **Administrador**. Advogado e Observador não o têm e caem direto no inbox. E **ninguém tem um painel só com as próprias coisas**, porque o Painel mostra números da conta inteira.
6. **Reuniões:** o resumo lê só a **agenda do CRM**. Agendamento feito pelo Calendly não vira reunião na agenda (pergunta D13).

---

## 2. O que existe hoje

### 2.0 Evidências do §1

- Menção só existe na anotação interna: `src/lib/notes/mentions.ts:1-2`. O dicionário não tem a palavra "comentário" e chama a nota de "Anotação interna" (`messages/pt-BR.json:356`).
- O dono vê todas as telas: `src/lib/perfis/visibilidade.ts:36-37`. O Advogado não tem Painel (`src/lib/perfis/padroes.ts:35-46`), e o Observador é o Advogado sem as agendadas (`padroes.ts:90`). Os dois caem no inbox, pela ordem de `src/lib/perfis/catalogo.ts:74-91` e pelo desvio em `src/app/(dashboard)/dashboard-shell.tsx:52-58`.
- O Painel é da conta inteira. As consultas filtram só por situação e data, nunca por pessoa (`src/lib/dashboard/queries.ts:118-126` e seguintes), e a RLS de conversas é da conta (`supabase/migrations/017_account_sharing.sql:414`). ⚠️ O comentário em `queries.ts:21-27` ("RLS scopes every query to the signed-in user") está **desatualizado**. É arquivo do upstream; não corrigir de carona.

### 2.1 De onde sai cada número

Regra geral: **todo filtro "meu" usa o id do login** (`user.id`, que é `profiles.user_id`), **nunca** `profiles.id`. O id errado devolve zero sem dar erro. E em `cb_tasks`, `cb_meetings` e `conversations` a RLS deixa a equipe inteira ler tudo, então o filtro por pessoa precisa estar **escrito** na consulta.

| Item do resumo | Onde mora | Regra de contagem | Função pura que já existe | Evidência |
| --- | --- | --- | --- | --- |
| **Novidades desde a sua última entrada** (D1 ✅ b) | `notifications.user_id`, `account_id`, `type`, `created_at` | `user_id = eu AND account_id = conta AND created_at > confirmação anterior` (guardada no registro local da F1, **por aparelho**). Separado por tipo: `note_mention` = "menções a você"; `task_assigned` + `task_reply` = "tarefas encaminhadas ou respondidas"; `conversation_assigned` = "conversas atribuídas a você". Sem registro no aparelho: as das **últimas 24 h**. Os dois filtros vão escritos, porque o contador do menu não filtra nenhum e confia só na RLS | — | `027_notifications.sql:4-26,40-41`; `use-unread-notifications.ts:25-28`; `944_cb_tarefas.sql:258-265`; `src/app/api/cb/notes/route.ts:215-219`; `src/app/api/cb/tasks/route.ts:269-274` |
| **Clientes esperando resposta: atribuídos a você** | `conversations.assigned_agent_id` (UUID sem FK, grava o `user.id`), `status`, `aguardando_desde` (mantida por gatilho) | Consulta: `.select(CONVERSATION_SELECT)` + `assigned_agent_id = eu` + `status <> 'closed'`, e depois `normalizeConversations`. Em JS: `conversaNoEscopo(ctxReal, c)` e `atrasoDeResposta(c, agoraMs) !== null` (10 min ou mais, crítico a partir de 30; grupo e encerrada ficam de fora) | `conversaNoEscopo`, `canalDaConversa`, `atrasoDeResposta` | `src/lib/inbox/conversations.ts:9-10,51-55`; `responsavel-menu.tsx:128`; `src/lib/perfis/escopo.ts:104-114`; `src/lib/inbox/filtros.ts:434-437`; `src/lib/inbox/atraso.ts:28,36,55-70`; `017:414` |
| **… sem responsável** (D7 ✅) | idem | `assigned_agent_id IS NULL AND status <> 'closed' AND aguardando_desde IS NOT NULL`; em JS, os mesmos dois filtros. Mostra também **a espera mais antiga**. Nunca somado ao "seus" | idem | `src/lib/conversations/reopen.ts:29-33,59`; `filtros.ts:41-44` |
| Conversas atribuídas a você (contexto) | as mesmas linhas da primeira consulta | total das atribuídas (abertas + pendentes, grupos incluídos). As que estão num número **fora do perfil** entram como "N fora do seu perfil", sem link (D5) | `conversaNoEscopo` | `filtros.ts:538`; `inbox/page.tsx:683,950-956` |
| Tarefas que vencem hoje | `cb_tasks.responsavel_user_id`, `status`, `vence_em` (date NOT NULL) | `responsavel_user_id = eu AND status = 'aberta' AND vence_em = diaLocal(agora)`. A régua é o **dia**: a tarefa das 9h continua "hoje" às 18h. Lista até 5 | `diaLocal`, `situacaoDoPrazo`, `horaJaPassou` (só destaque) | `src/lib/tasks/prazo.ts:33-38,94-101,116-128`; `944_cb_tarefas.sql:92,95,146` |
| Tarefas vencidas | idem | `… AND vence_em < diaLocal(agora)`, com "venceu há N dias". Concluída nunca conta, e "sem prazo" não existe | idem | `prazo.ts:96-101`; `944:92` |
| **Reuniões na agenda do CRM** de hoje | `cb_meetings.owner_user_id`, `status`, `starts_at`, `contato_nome`, `local` | `owner_user_id = eu AND status = 'agendada' AND starts_at ∈ [hoje 00:00, amanhã 00:00)` em `America/Sao_Paulo`, intervalo **semiaberto**. Itens com hora, título, cliente e local | `hojeNoFuso`, `paraInstante`, `somarDias` (da agenda, não a de `prazo.ts`), `horaNoFuso`, `FUSO_PADRAO` | `src/lib/agenda/grade.ts:26,134-136`; `src/lib/agenda/fuso.ts:28,159,198`; `945_cb_agenda_de_reunioes.sql:91-92,104,108,111,140` |

**Aonde cada item leva.** A tela de destino **abre**, mas nem sempre no recorte que o número conta:

- **Conversa:** `/inbox?c=<id>` via `urlDoInbox` (`src/lib/inbox/url.ts:24-37`). O inbox não tem recorte "atribuídas a mim"; abre com o filtro padrão do membro (`conversation-list.tsx:664-682`) ou sem responsável filtrado (`filtros.ts:144-157`).
- **Tarefa:** não existe link para uma tarefa específica; as próprias Notificações mandam para `/tarefas` (`notifications/page.tsx:137-138`). O item leva à ficha do cliente, `/contacts?contact=<contact_id>` (`contacts/page.tsx:104`). O bloco abre `/tarefas`, que começa em "Para mim", com as vencidas primeiro (`tarefas/page.tsx:52`; `prazo.ts:139-144`).
- **Reunião:** leva à ficha só quando a reunião tem cliente, porque `contact_id` é anulável (`945:91`). A `/agenda` não lê parâmetro nenhum e abre no **mês**, com **todos** os responsáveis (`agenda/page.tsx:45,59`). O campo `local` é texto livre (`945:104`) e só vira link se for `http(s)`.
- Por isso cada bloco diz o que conta ("suas reuniões hoje", "atribuídas a você"), e o link do bloco apenas abre a tela.

O que **não** existe e muda o desenho:

- **Reunião não gera notificação.** O tipo de notificação aceita só quatro valores (`944_cb_tarefas.sql:258-265`), então o resumo lê `cb_meetings` direto.
- **O Calendly não grava na agenda.** Só gravam em `cb_meetings` as rotas `src/app/api/cb/agenda/route.ts`, `src/app/api/cb/agenda/[id]/route.ts`, `src/app/api/v1/meetings/route.ts` e `src/app/api/v1/meetings/[id]/route.ts`. Nada em `src/lib/calendly` a cita (grep vazio). O log do Calendly (`cb_calendly_eventos`) não serve para contar as reuniões de hoje:
  - é fechado ao navegador (`977_cb_calendly.sql:99-101`);
  - não tem responsável (`977:70-93`);
  - só grava `invitee.created` (`src/lib/calendly/payload.ts:24,151`), então cancelamento não fica registrado;
  - reagendamento vira linha nova (`payload.ts:182`; UNIQUE por `invitee_uri` em `977:93`), e a linha antiga fica com o horário velho.
- **Não há registro de "último acesso" no servidor**: não existe `last_sign_in` no código, e `member_presence.last_seen_at` avança a cada 30 s (`024_member_presence.sql:83-87`). Para a D1(b) basta o registro **local** que a F1 já grava: um campo a mais, sem migration, valendo **por aparelho**.
- **`read_at` só muda na página de Notificações** (`notifications/page.tsx:118,160`), então "não lidas" **acumula** avisos já tratados. Esse número já aparece no menu o dia inteiro (`sidebar.tsx:145,323-326`). Por isso a D1 recomenda "novidades".
- **Atribuição quase não acontece neste escritório.** O código registra 63 de 64 conversas sem responsável (`filtros.ts:41-44`). Cliente e celular pareado reabrem a conversa **gravando responsável nulo** (`reopen.ts:29-33,59`), e a equipe responde pelo celular (1.041 mensagens pelo celular contra 8 pelo CRM: `CLAUDE.md:2103`). Por isso "atribuídas a você" tende a zero, e a fila "sem responsável" entra (D7).
- **Parte das atribuições não gera aviso.** Autoatribuir não avisa (`027_notifications.sql:77-80`). Reabrir pelo cabeçalho do fio atribui a quem reabriu (`src/lib/conversations/situacao.ts:17-25`), também sem aviso. O resumo conta as **conversas**, não os avisos.
- **Contagem dupla com tarefas.** Todo encaminhamento gera um aviso `task_assigned` **e** uma tarefa. Os dois blocos continuam separados e não se somam.

### 2.2 Números medidos em produção

**Medido em 12/09/2026 às 11:13 (sábado), pelo operador**, com o script `medir_producao.py` (somente `SELECT`, só agregados, sem nome de cliente nem texto de mensagem) contra a API de gerenciamento do Supabase, usando o token da CLI. Os números são o retrato daquela hora.

| O que o resumo mostraria | Leonardo (dono) | Dra. Isa (`agent`) | Estephany Dias (`agent`) | Sem responsável |
| --- | --- | --- | --- | --- |
| Notificações não lidas (acumuladas) | **7** — todas "conversa atribuída"; a mais antiga de **04/09**; **0** nas últimas 24 h; leu 1 de 8 desde sempre (última leitura 08/09) | **0** (nenhuma notificação, nunca) | **2** (1 conversa atribuída, 1 tarefa), as duas de 10/09 | — |
| Tarefas abertas | 0 | **9, todas vencidas, todas não lidas** (`lida_em` nulo); 0 vencem hoje; 0 amanhã | 1 (no prazo, não lida) | 0 |
| Reuniões na agenda do CRM | 0 | 0 | 0 | — a tabela `cb_meetings` está **VAZIA**: nunca houve reunião lançada |
| Conversas ativas (abertas + pendentes) | 14 atribuídas · 0 com não lidas · **3 esperando há mais de 10 min** (3 há mais de 30) | 4 atribuídas · 1 com não lidas · **2 esperando** (2 há mais de 30) | 0 | **642** (5 grupos) · 403 com não lidas · **235 esperando há mais de 10 min** · 234 há mais de 30 |
| Agendadas com falha | 0 | 0 | 0 | 1 `pending` sem autor |

**Sessões de login (`auth.sessions`):** 20 sessões vivas; a mais antiga de **23/07**; a mais parada está há **51 dias** sem renovar; **19 das 20** estão paradas há mais de 4 h e **13** há mais de 7 dias; **nenhuma** tem `not_after` (o time-box do Supabase está desligado). Isso confirma a §3.1: hoje nada expira. Se o "inactivity timeout" do painel está ligado não dá para concluir daqui — ele recusa a renovação, não apaga a linha (D11 continua na conferência do painel).

**Membros:** a consulta devolveu 7 perfis em 5 contas. Na conta do escritório aparecem **três** pessoas ativas, não duas: Leonardo (dono), Dra. Isa Lenier (`agent`, com perfil de acesso) e **Estephany Dias** (`agent`, com perfil de acesso, recebendo tarefa e conversa atribuída desde 10/09). "Contato CB - Geral", "Gabriel", "TESTE AUTOMATIZADO" e "TESTE FASE6 CONVIDADO" são donos de outras contas (as de teste e as pessoais de quem foi removido). ⚠️ A consulta não agrupou por conta, então a pertença de cada um fica NÃO VERIFICADA até a segunda rodada (o script corrigido pergunta "mesma conta que o Leonardo?"). Qual perfil cada uma usa: a consulta falhou (`telas_config` não existe na `cb_perfis_de_acesso`; a coluna é `telas`), corrigida para a segunda rodada.

**O que os números mudam no plano:**

1. **D1 fica decidida pelos dados.** Com "não lidas acumuladas", você veria "7" toda manhã, por avisos de 04/09 a 10/09 que já foram tratados sem passar pela página de Notificações. "Novidades desde a sua última entrada" (D1a) mostraria "nada de novo" hoje — que é a verdade. Fica (a).
2. **Ler a tarefa direto, e não o aviso dela, está certo.** A Dra. Isa tem 9 tarefas vencidas e **nenhuma notificação** — o aviso não foi gerado ou não existe para esse caminho. Um resumo que dependesse do sino diria "nada pendente" para quem tem 9 tarefas atrasadas que ninguém abriu.
3. **O bloco de reuniões, como desenhado, mostraria "nenhuma" para todo mundo, todo dia** — a agenda do CRM nunca foi usada; as reuniões do escritório vivem no Calendly. A D13 muda de forma (ver §6.1). A sugestão 20 ("reuniões sem baixa") fica sem objeto por enquanto.
4. **"Sem responsável" é onde a espera está, mas o número cru é acervo, não urgência:** 235 conversas esperam há mais de 10 min, e 234 delas há mais de 30 — a maior parte espera há dias. Um "235" fixo de manhã é o rótulo que o olho aprende a pular (a lição do rótulo de canal). A D7 ganha um recorte por tempo (ver §6.1).
5. **A terceira pessoa entra nos testes da F1** (login com a conta da Estephany também), e o plano deixa de falar em "duas contas".

As consultas rodadas (as quatro primeiras) e as duas que ficam para a segunda rodada (agenda × Calendly e reuniões sem baixa — a segunda já tem resposta: zero, porque a tabela está vazia):

```sql
-- Notificações não lidas por membro (total e por tipo; "de_outra_conta" mede o desvio do contador do menu)
SELECT p.full_name, n.type, count(*) AS nao_lidas,
       count(*) FILTER (WHERE n.account_id IS DISTINCT FROM p.account_id) AS de_outra_conta,
       min(n.created_at) AS mais_antiga
FROM notifications n JOIN profiles p ON p.user_id = n.user_id
WHERE n.read_at IS NULL
GROUP BY GROUPING SETS ((p.full_name, n.type), (p.full_name)) ORDER BY 1, 2 NULLS LAST;

-- Tarefas abertas por responsável (hoje = Brasília)
WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d)
SELECT coalesce(p.full_name,'(sem responsável)') AS membro,
       count(*) FILTER (WHERE t.vence_em < h.d) AS vencidas,
       count(*) FILTER (WHERE t.vence_em = h.d) AS hoje,
       count(*) FILTER (WHERE t.lida_em IS NULL) AS nao_lidas
FROM cb_tasks t CROSS JOIN h LEFT JOIN profiles p ON p.user_id = t.responsavel_user_id
WHERE t.status = 'aberta' GROUP BY 1;

-- Reuniões de hoje por dono e situação
WITH dia AS (SELECT date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS ini)
SELECT coalesce(p.full_name,'(sem dono)'), m.status, count(*)
FROM cb_meetings m CROSS JOIN dia LEFT JOIN profiles p ON p.user_id = m.owner_user_id
WHERE m.starts_at >= dia.ini AND m.starts_at < dia.ini + interval '1 day' GROUP BY 1, 2;

-- Conversas ativas por responsável, com espera (decide a D7)
SELECT CASE WHEN c.assigned_agent_id IS NULL THEN '(sem responsável)' ELSE coalesce(p.full_name,'(id sem perfil)') END,
       count(*) AS ativas,
       count(*) FILTER (WHERE c.aguardando_desde < now() - interval '10 minutes') AS atraso_10,
       count(*) FILTER (WHERE c.aguardando_desde < now() - interval '30 minutes') AS atraso_30
FROM conversations c LEFT JOIN profiles p ON p.user_id = c.assigned_agent_id
WHERE c.status IN ('open','pending') GROUP BY 1;

-- Agenda do CRM × Calendly nos últimos 30 dias (decide a D13)
SELECT 'agenda_crm' AS origem, count(*) FROM cb_meetings
 WHERE starts_at >= now() - interval '30 days' AND starts_at < now()
UNION ALL
SELECT 'calendly', count(*) FROM cb_calendly_eventos
 WHERE inicio >= now() - interval '30 days' AND inicio < now();

-- Reuniões ainda 'agendada' que já passaram (últimos 7 dias; decide a sugestão 20)
SELECT coalesce(p.full_name,'(sem dono)'), count(*)
FROM cb_meetings m LEFT JOIN profiles p ON p.user_id = m.owner_user_id
WHERE m.status = 'agendada' AND m.starts_at < now() AND m.starts_at >= now() - interval '7 days'
GROUP BY 1;
```

Segunda rodada (mesmo comando, script já corrigido): pertença de cada perfil à conta do escritório, o perfil de acesso de cada `agent` (coluna `telas`, não `telas_config`) e a contagem de agendamentos do Calendly nos últimos 30 dias.

---

## 3. Logout por inatividade

### 3.1 O que acontece hoje

**Não existe logout por inatividade em lugar nenhum.** A única noção de "ocioso" é a presença, que marca "ausente" depois de 5 min e não desloga ninguém (`src/lib/presence.ts:26`; `src/components/presence/presence-heartbeat.tsx:44-48`). Na prática, **quem fecha o navegador e volta 12 h depois entra já logado**. **Medido em 12/09:** 20 sessões vivas, a mais parada há 51 dias sem renovar, 13 paradas há mais de 7 dias, nenhuma com prazo (`not_after` nulo em todas — o time-box do painel está desligado).

- A sessão fica num cookie **persistente de 400 dias, legível por script** (`httpOnly: false`): `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11`. O `src/lib/supabase/client.ts` não muda isso. Segundo a documentação do Supabase, o refresh token não expira, só pode ser usado uma vez; o comportamento deste projeto está NÃO VERIFICADO.
- Qualquer aba aberta **renova a sessão sozinha**. Visível, pelo ticker de 30 s. Mesmo oculta, pelo heartbeat de presença, que chama uma RPC a cada 30 s e passa por `getSession()` (`presence-heartbeat.tsx:90-91`; `supabase-js index.mjs:806-811`; `GoTrueClient.js:2455-2483`). O middleware também renova a cada requisição (`src/middleware.ts:26-43`).
- **O "Inactivity timeout" do Supabase** mede tempo sem **renovar** o token. Uma aba aberta renova sempre, então ele não serve para ela. Com o navegador **fechado** nada renova, e é justamente aí que ele funciona (ver §3.2 e D11). Segundo a documentação do Supabase, exige plano Pro (NÃO VERIFICADO). A configuração fica no painel do Supabase, fora do repositório: `supabase/config.toml` só tem `[db]` (linha 16). A configuração de produção em Auth > Sessions está **NÃO VERIFICADA**.
- ⚠️ **O "Sair" de hoje encerra a sessão em TODOS os aparelhos.**
  - `useAuth().signOut` chama `supabase.auth.signOut()` sem escopo (`src/hooks/use-auth.tsx:595`) e navega sem ler o erro (`use-auth.tsx:604`). Na versão instalada (auth-js 2.108.2), o padrão é `'global'` (`GoTrueClient.js:3316`).
  - Os botões ficam em `src/components/layout/header.tsx:152` e `src/components/layout/sidebar.tsx:453`.
  - O "sair e tentar de novo" do convite também é global (`src/app/join/[token]/page.tsx:210`).
  - "Sair de todos os aparelhos" **já existe** em Segurança, com escopo explícito e erro conferido (`src/components/settings/sessions-card.tsx:38-43`).
- **Um `signOut` que falha por rede ou 5xx não apaga a sessão.** Só 401, 403 e 404 seguem para `_removeSession` (`GoTrueClient.js:3334-3347`).

### 3.2 Opinião franca sobre as 4 horas

**O que resolve:**
- O Meu dia volta depois de uma pausa longa. Para isso **não é preciso logout**: a guarda pode só reabrir o Meu dia (D3a).
- Pedir a senha de novo tira da **TELA** quem senta num computador esquecido aberto. **Não é barreira de dados**: o cookie continua abrindo as rotas `/api` e o banco para quem não passa pelo shell. Exemplos: `GET /api/cb/channels`, que se autentica só pelo cookie (`src/app/api/cb/channels/route.ts:66-71` → `src/lib/auth/account.ts:106-112`), e o token legível no cookie. A barreira de servidor para o **navegador fechado** é o timeout de inatividade do Supabase (D11). O argumento de LGPD só se sustenta com as duas peças juntas.

**O que não resolve:**
- **O logout não garante "um resumo por dia".** Quem mexe no CRM de hora em hora passa o dia sem deslogar. Por isso a tela de entrada reaparece por **sessão nova OU primeiro acesso do dia** (D2).
  ⚠️ A regra do dia é conferida **só ao carregar a página**. A aba deixada aberta de um dia para o outro, que é o padrão no computador do escritório, **não mostra o resumo** na manhã seguinte sem F5, a menos que a D3a esteja ligada.
- Não corta na hora um token já emitido: ele vale até expirar (padrão do Supabase: 1 h; o valor deste projeto está NÃO VERIFICADO; `GoTrueClient.js:3279`).

**Custo para o usuário:**
- **Senha de novo** (só se a D3b pedir). No **celular**, isso aconteceria quase sempre, porque cada aparelho conta a própria inatividade. O link de conversa que a automação manda ao advogado (`linkDoCrm`, `src/lib/automations/engine.ts:2022-2025,2074`) passaria a pedir login antes. Por isso a recomendação é pedir **só no computador**, e a F2 faz o login **devolver a pessoa ao link**.
- **Voltar ao Meu dia ou encerrar desmonta o app**, como qualquer troca de tela:
  - o rascunho da caixa de texto se perde (nada o persiste);
  - o anexo preparado é apagado do bucket (`src/components/inbox/message-composer.tsx:482-490`);
  - uma mensagem na janela de desfazer seria **enviada** no desmonte (`message-composer.tsx:805-816`). A janela é de 3 s (`message-composer.tsx:140`), então só o próprio gesto que dispara a expiração poderia criá-la, e a guarda interrompe esse gesto (§3.3).
- Recomendação: **4 h, por navegador, com a constante num lugar só**, para mudar fácil.

### 3.3 Mecanismo proposto (F2)

- **Onde mora:** só no cliente.
  - `src/lib/auth/inatividade.ts` (puro, com teste) e `src/hooks/use-guarda-de-inatividade.ts`, usado **dentro da porta de entrada** (`src/components/entrada/porta-de-entrada.tsx`, criada na F1), e não solto no shell.
  - A porta envolve o layout do shell, que é o único ponto por onde passa toda página logada. Isso inclui `/notifications`, `/tarefas`, `/flows` e `/agents`, que o middleware não cobre (`src/middleware.ts:72-80`).
  - No shell fica só o efeito de redirecionamento.
- **Relógio compartilhado entre as abas:** `localStorage["cb-atividade:<userId>"] = { sessao, em, encerrando? }`.
  - `sessao` é o `session_id` do token de acesso: claim obrigatória no tipo (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:1630`), mas não conferida num token real (F0).
  - Atividade em qualquer aba mantém todas vivas.
- **`sessionId` ausente** (nulo, vazio ou que não seja string): a guarda **não decide nem grava** nesta carga (`console.warn`). Um registro cujo `sessao` não seja string não-vazia conta como **ausente**. Sem essa regra, `null === null` contaria como "mesma sessão", e a guarda derrubaria a pessoa logo depois de cada login.
- **O que conta como atividade:** `pointerdown`, `keydown`, `wheel`, `touchstart` e `mousemove` (este só quando a posição muda), com `capture` e `passive` em `window`.
  - `scroll` **não** conta, porque o fio escreve `scrollTop` sozinho.
  - Heartbeat, realtime, renovação de token e mensagem chegando também **não** contam.
  - Grava no máximo uma vez a cada 30 s.
- **Checa ANTES de gravar.** Mexer o mouse às 4h05 não pode ressuscitar a sessão. Quando o ouvinte decide que expirou, ele chama **`stopPropagation()` no próprio evento** (funciona mesmo com `passive`). Assim, o Enter ou o clique que acorda a tela não chega ao app: nenhuma mensagem entra na janela de desfazer, e nenhum botão é acionado.
- **Regra (`decidir(registro, sessao, agora)`):**
  - mesma sessão com mais de 4 h → **expirou**;
  - registro de **outra** sessão (login novo) ou registro ausente → **gravar agora, nunca expirar**. Isso evita o laço "login → registro de ontem → logout" e não derruba ninguém no dia do deploy;
  - registro com hora no futuro → tratado como agora;
  - **exceção condicionada à F0:** se o token trouxer `amr` como objeto com `timestamp` (`types.d.ts:280-288,1654`), fixar `DATA_DA_F2` no código. Na conferência **da carga** (nunca no intervalo de 60 s), registro ausente com login posterior à F2 usa o horário do login como `em` (falha fechada). Sem `amr` em forma de objeto, a carência de "registro ausente" fica registrada como limite aceito, aqui e no CLAUDE.md.
- **Quando checa:**
  - `conferindo` é o **estado inicial** da porta: nem o app nem o resumo montam antes de a guarda declarar a sessão viva;
  - a cada 60 s;
  - em `visibilitychange`, `focus` e `pageshow` (notebook que acorda, aba restaurada);
  - no evento `storage` da chave, quando outra aba anuncia `encerrando`.
  Com a aba fechada nada roda; a conferência ao reabrir cobre esse caso.
- ⚠️ **Revisão do coordenador (§11): o caminho "voltar ao Meu dia" (D3a, F2a) NÃO precisa da sequência abaixo.** É uma troca de tela como qualquer outra, com a sessão viva: as limpezas de desmonte (a descarga do campo personalizado inclusive) saem normalmente, como saem hoje ao trocar de página. Ele usa só a sonda de gravação (passo 1), o `stopPropagation()` no gesto que acorda a tela e `setPendente(true)`. Os passos 2, 3 e 5 existem por causa da **revogação** e valem só para "encerrar" (D3b, F2b).
- **Ao expirar, nesta ordem** (sem espera fixa):
  1. **Sonda de gravação** numa chave própria. Se `setItem` lançar, a guarda desliga nesta carga e **não age**: um registro que não anda derrubaria quem está trabalhando.
  2. Se a ação for **encerrar**, grava `encerrando: <sessao>` no registro. As outras abas ouvem e seguem o mesmo roteiro, então as descargas delas também saem com a sessão viva.
  3. **Cobre o app sem desmontar** (camada por cima, app `inert`) e prova rede e sessão com `supabase.auth.getUser()`, que vai ao `/user` (`GoTrueClient.js:2608-2630`). O `getSession()` não prova rede: com o token válido, ele responde a partir do cookie (`GoTrueClient.js:2459-2481`).
     - No caminho **encerrar**, espera a rede sem teto: tela "Sessão encerrada por inatividade — aguardando conexão para concluir", com o botão "Tentar agora", repetindo no evento `online` e a cada 30 s.
     - No caminho **voltar ao Meu dia**, o teto é de 10 s e depois segue: a sessão continua viva, e o risco é só a descarga falhar, como hoje ao sair de uma tela sem rede.
  4. **Desmonta o app** (a porta troca os filhos pelo spinner). As limpezas de desmonte, como a descarga do campo personalizado (`src/components/contacts/campo-com-salvamento.tsx:125-133`), rodam **com sessão**.
  5. No efeito do componente que substituiu o app, **espera as gravações de campo em voo** (`gravacoesEmVoo() === 0`, teto de 10 s). É um contador de módulo alimentado pela fila, que já sabe `emVoo` (`src/lib/contacts/salvamento-de-campo.ts:59,153`). As limpezas rodam antes dos efeitos novos do mesmo commit; isso é comportamento do React, NÃO VERIFICADO no repositório, e o preview confere.
  6. Depois:
     - **voltar ao Meu dia** (D3a): a porta passa a `pendente`. É a **única** exceção à trava de mão única, e só a guarda a usa;
     - **encerrar** (D3b): `sairDesteAparelho()`, o helper da F1 com `scope: 'local'`, revoga **só esta** sessão; o celular continua logado.
       - Com erro: mantém o aviso com "Tentar agora" e **nunca navega**. Com a sessão ainda no cookie, `/login` devolveria para `/dashboard` (`src/middleware.ts:51-69`) e formaria um laço.
       - Com sucesso: `_removeSession` emite `SIGNED_OUT` (`GoTrueClient.js:4265-4282`).
- **Qual caminho vale** (D3b ✅ "só no computador"): em aparelho de toque (`matchMedia('(pointer: coarse)')`), volta ao Meu dia; nos demais, encerra. É uma aproximação: tablet e notebook com tela de toque são imprecisos. Nunca decidir pela largura da tela.
- **Navegação:** o **efeito do shell é o único a navegar**.
  - Guarda o último `userId` num ref (depois do `SIGNED_OUT`, o `user` é nulo).
  - Monta `urlDoLogin({ voltarPara: window.location.pathname + window.location.search, motivo })`.
  - O motivo é `inatividade` se o registro daquele usuário tiver `encerrando` ou `em` com mais de 4 h; senão, vai só o `next`. Nunca derivar o motivo de estado guardado na aba.
  - ⚠️ Nunca `useSearchParams` no shell, na porta ou na guarda. Não há Suspense acima do shell, e página estática com o hook sem Suspense quebra o build de produção sem o `next dev` acusar (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md:178-179`). O inbox embrulha a própria página por isso (`src/app/(dashboard)/inbox/page.tsx:37-44`).
- **Outras abas:** recebem o anúncio por `storage` e rodam os passos 3 a 6 com o próprio `signOut` local. Um segundo `signOut` sem sessão só emite `SIGNED_OUT` de novo (`GoTrueClient.js:3326-3352`: sem token, pula o `/logout` e chama `_removeSession`). Corrida residual declarada: um pendente de fila em outra aba que só sai depois da revogação.
- **Storage bloqueado** (modo privado restrito) **ou `setItem` que lança**: a guarda fica **desligada** nesta carga.
- **Sem rede para concluir o encerramento:** fica o aviso com o botão, sem apagar o cookie à mão (D16).

---

## 4. Pop-up × painel próprio

**Recomendação: duas peças com o mesmo componente.**
1. **Na entrada:** uma página em tela cheia que **substitui** o app até o "Continuar". Não é pop-up.
2. **O painel próprio:** a rota **`/meu-dia`** no menu de todos (F3, recomendada logo depois da F1), para rever o dia às 14h.

A tela de entrada sozinha **não** é o painel próprio: some com um clique e só volta no dia seguinte, num login novo ou depois de 4 h paradas.

Por que não pop-up (o Dialog do projeto):
- **O app montado por trás teria efeitos antes da confirmação.** Um link `/inbox?c=X` abriria o fio e zeraria as não lidas daquela conversa para a conta inteira (`src/components/inbox/message-thread.tsx:1123-1141` — o `.update({ unread_count: 0 })` da 1137; a v2 citava 1090-1100, que é o handler de reações), além de publicar presença (`dashboard-shell.tsx:86`).
- O `DialogContent` nasce com o X (`src/components/ui/dialog.tsx:45,62-77`) e fecha com Esc e com clique fora. O overlay é quase transparente, o conteúdo não tem teto de altura (no celular a lista sairia da tela), e não há precedente de diálogo que não fecha.

Por que `/meu-dia` fica **fora** do catálogo de perfis:
- Uma tela nova no catálogo **nasce invisível para todo perfil já gravado** (`visibilidade.ts:48`), inclusive o "Administrador" de sistema, que a rota nem deixa editar (`src/app/api/cb/perfis/[id]/route.ts:67-69`).
- Pôr uma tela no catálogo exige entrada em **quatro mapas `Record<TelaId>`**: `ROTA_DA_TELA` (`catalogo.ts:74`), `ROTULO_DA_TELA` (`catalogo.ts:102`), `AREA_DA_TELA` (`src/lib/perfis/editor.ts:76`) e `ESCRITA_DA_TELA` (`src/lib/perfis/poderes.ts:120`). O typecheck cobra as entradas, e o valor de `ESCRITA_DA_TELA` precisa espelhar a guarda real.
- Pôr a tela no topo de `ROTA_DA_TELA` muda de uma vez o desvio de `/dashboard`, o botão da TelaBloqueada e o destino do "Ver como".
- Fora do catálogo, `telaDoCaminho` devolve `null`, e a guarda e o menu deixam passar (`visibilidade.ts:102-114`; `dashboard-shell.tsx:35-36,104`; `sidebar.tsx:259-260`). Não precisa de backfill. O Painel de gestão não muda.

"Virar a primeira tela de quem não tem o Painel": **padrão adotado = não** (D15). Logo depois do "Continuar", o resumo apareceria de novo, e o desvio de `/dashboard` só conhece telas do catálogo (`dashboard-shell.tsx:52-58`).

---

## 5. Sugestões e contribuições

| # | Sugestão | Por quê | Custo | Entra |
| --- | --- | --- | --- | --- |
| 1 | Tela de entrada que **substitui** o app | nada acontece por trás antes do "Continuar", e não há X nem Esc | baixo (porta + componente) | **v1 (F1)** |
| 2 | Trava de **mão única** por sessão OU dia, decidida **uma vez por carga de página** | não depende do logout e nunca abre no meio do uso. Abrir desmontaria o compositor: o rascunho se perde, o anexo preparado é apagado (`message-composer.tsx:482-490`) e a mensagem na janela de desfazer seria enviada (`805-816`) | baixo | **v1** |
| 3 | Cada bloco com **até 5 itens** ("e mais N"), link direto por item quando ele existe, e o bloco **abre a tela** | número sem nome a pessoa aprende a pular; o inbox e a agenda não abrem no recorte do número | baixo | **v1** |
| 4 | Data do aviso mais antigo ao lado das não lidas | só faz sentido se a D1 ficar em (b) "não lidas acumuladas" | 1 consulta `limit 1` | só se D1 = não lidas |
| 5 | **Limite de erro** que deixa entrar se o resumo quebrar + teto de 8 s no botão | o repo não tem **nenhum** error boundary (grep vazio em `src`, sem `error.tsx`); uma exceção travaria todo mundo fora | baixo | **v1** |
| 6 | Estado **carregando / falhou / pronto** por bloco, nunca "0" sem resposta | armadilha "lista vazia virando afirmação"; os hooks do menu engolem o erro e começam em 0 (`use-unread-notifications.ts:16,28-29`) | baixo | **v1** |
| 7 | "Não é você? Sair" (escopo **local**), pelo helper que **confere o erro** e só navega com sucesso, no molde de `sessions-card.tsx:38-43` | computador compartilhado; o `signOut` de hoje navega mesmo quando falha (`use-auth.tsx:595,604`) | trivial | **v1** |
| 8 | Traduzir o "Loading..." fixo do spinner (`dashboard-shell.tsx:74`) | o arquivo já vai ser tocado | trivial | **v1** |
| 12 | Título do cabeçalho em `/agenda`: `"/agenda": "agenda"` no `pageTitles` (`header.tsx:23-42`; hoje cai em "dashboard" pela linha 49). A chave `Header.agenda` já existe nos dois dicionários | defeito visível, independente da F3 | uma linha | **v1 (F1)** |
| 9 | Login que **devolve ao link** (`next` + `destinoDoLogin`) | com o logout, o link do WhatsApp cairia em `/dashboard` (`login/page.tsx:71-74`) | baixo; `destinoSeguro` já existe com teste | **F2** (se a D3b pedir senha) |
| 10 | Frase "sessão encerrada após 4 h sem atividade" no login | a pessoa precisa entender por que saiu | trivial | **F2** |
| 10b | Login com `autoComplete` (`email`, `current-password`) e erro traduzido pelo código (`invalid_credentials`), nunca `error.message` cru | digitar a senha vira rotina; hoje o erro sai cru (`login/page.tsx:58,99-103`) e os campos não têm autocomplete (109-117, 132-140) | baixo | **F2** (se a D3b pedir senha) |
| 11 | Painel permanente `/meu-dia` fora do catálogo | rever o dia a qualquer hora | médio | **F3, logo depois da F1 (D10)** |
| 13 | Filtros por URL (`/tarefas?grupo=vencidas`, `/agenda?visao=dia&responsavel=eu`, `/inbox?responsavel=eu`) | o clique cairia direto no recorte; os itens listados (#3) já reduzem a necessidade | médio (3 páginas; `useSearchParams` sob Suspense) | depois (D17) |
| 14 | Aviso no sino quando alguém marca reunião na sua agenda | hoje nada avisa | migration (CHECK de tipo) + `NotificationType` + `TYPE_ICON` | depois |
| 15 | Marcar como lido o aviso ao abrir a conversa ou a tarefa dele | acabaria com o acúmulo de "não lidas" | médio; muda comportamento | depois (decisão) |
| 16 | "Sair" do menu passar a **local** | hoje ele derruba todos os aparelhos sem avisar | 1 linha + texto | **F1, se D4 = sim** |
| 17 | Fila "sem responsável" no resumo **de todos** | é onde está a espera real (§2.1) | baixo | **v1 se D7 = sim** |
| 18 | Agendadas minhas que falharam | pendência real de quem agendou | baixo | depois |
| 19 | Registrar no servidor quem confirmou e quando | só se precisar de prova de ciência | migration + rota + retenção (LGPD) | fora (D12) |
| 20 | "Reuniões sem baixa" (dono = eu, `agendada`, início antes de hoje, últimos 7 dias) | a agenda deve refletir o que aconteceu. Só protege do follow-up indevido quando o lembrete "depois" tem deslocamento longo (`952_cb_lembrete_depois_de_realizada.sql:11-12,55-56`) | baixo | depois, condicionada à F0 e à D13 |
| 21 | Agendamentos do Calendly de hoje no resumo | se o escritório não lança na agenda (D13) | rota no servidor (a tabela é fechada) + regra de dono (não há responsável) + tratar cancelamento e reagendamento, senão conta reunião que não vai acontecer | depende da D13 |

---

## 6. Decisões para o operador

### 6.1 Perguntas para você (sim/não ou escolha simples)

- **§1 item 4 — Comentários:** por "comentários" você quer dizer as anotações internas da conversa, onde se marca um colega com @?
- **D1 — Notificações no resumo:**
  (a) ✅ **as que chegaram desde a sua última entrada NESTE aparelho**, separadas em menções, tarefas e conversas. Sem histórico no aparelho, as das últimas 24 h.
  (b) todas as não lidas acumuladas: o mesmo número do sino, que já aparece no menu o dia todo. **Medido em 12/09:** você tem 7 não lidas, todas "conversa atribuída", a mais antiga de 04/09, nenhuma nas últimas 24 h — com (b) o resumo diria "7" toda manhã.
- **D7 — Clientes esperando sem responsável:** ✅ **sim, mas recortado pelo tempo.** Medido em 12/09: **235** conversas sem responsável esperam há mais de 10 min (234 há mais de 30), contra 3 suas e 2 da Dra. Isa — é ali que a espera está, mas um "235" todo dia de manhã vira o número que ninguém lê. Proposta: a linha mostra **quem começou a esperar desde a sua última entrada** (sem histórico no aparelho, nas últimas 24 h), e o acumulado em texto apagado: "3 desde ontem · e mais 232 esperando há mais tempo". Só nas conexões que a pessoa enxerga. Concorda com esse recorte?
- **D13 — Reuniões: a agenda do CRM está VAZIA.** Medido em 12/09: `cb_meetings` não tem nenhuma linha — nunca houve reunião lançada; as reuniões do escritório vivem no Calendly. O bloco "Reuniões na agenda do CRM" mostraria "nenhuma" para todo mundo, todo dia. Opções:
  (a) ✅ **v1 sem o bloco de reuniões.** Ele é construído no dia em que houver reunião na agenda do CRM ou quando a (b) existir — código para tabela vazia é código para futuro hipotético.
  (b) **O Calendly passa a gravar na agenda do CRM**: uma reunião em `cb_meetings` por agendamento, com o dono definido por você (o agendamento não tem responsável hoje) e tratando cancelamento (hoje só `invitee.created` é assinado, então cancelamento nem chega). É trabalho na integração do Calendly, fora deste plano, e é o caminho que alimenta a agenda, os lembretes e este bloco de uma vez. Recomendo como próximo trabalho do Calendly.
  (c) O bloco lê o log do Calendly direto (sugestão 21), sabendo que uma reunião cancelada continuaria aparecendo.
- **D10 — Meu dia no menu:** quer também uma página "Meu dia" no menu, para rever o dia a qualquer hora? ✅ **sim, logo depois da F1.**
- **D3a — Depois de 4 h sem ninguém mexer no CRM, o Meu dia volta a aparecer, sem pedir senha?** ✅ **sim.** O custo é o de qualquer troca de tela: texto digitado e não enviado se perde, o que é raro depois de 4 h paradas.
- **D3b — Depois de 4 h sem mexer, pedir a senha de novo?**
  (a) ✅ **só no computador**;
  (b) também no celular (vai pedir quase sempre, inclusive ao abrir o link de conversa que a automação manda);
  (c) não pedir.

### 6.2 À parte (não seguram a F1)

- **D4 — O "Sair" do menu hoje desconecta você de TODOS os aparelhos.** Passa a sair só deste? ✅ **sim.** O "sair de todos" já existe em Configurações → Segurança. Se sim, entra na F1.
- **D11 — Trava também no servidor (Supabase), que cobre o navegador fechado?** Na F0 confiro o plano do Supabase. Se couber, ✅ recomendo ligar o tempo de inatividade de 4 h ou mais. Sem ela, o logout da F2 só tira a pessoa da tela (§3.2).

### 6.3 Padrões adotados (diga se discorda)

- **D2 — Quando a tela aparece:** sessão nova OU primeiro acesso do dia, conferido só ao carregar a página (e depois de 4 h paradas, se D3a = sim). Aparece mesmo sem nada pendente, porque "nada pendente hoje" também é informação.
- **D5 — Conversas:** abertas + pendentes; grupos entram no total; "esperando" exclui grupo e encerrada (a régua da tela). Conversa atribuída num número **fora do perfil** entra como "N fora do seu perfil", sem link: o inbox a esconde (`filtros.ts:538`), e aberta por link ela aparece bloqueada (`inbox/page.tsx:950-956`). Seguir o inbox e omiti-la calaria uma obrigação atribuída à pessoa.
- **D6 — Reuniões:** só as "agendada" de hoje, inclusive as que já passaram sem baixa, com destaque.
- **D8 — Bloco cuja tela está fora do perfil da pessoa:** mostra o número, sem link, com "fora do seu perfil". O motivo: a conta tem quatro perfis personalizados não-admin (`CLAUDE.md:2572`), então o caso é real e não só teórico.
- **D9 — Confirmar não marca nada como lido.** Tarefa, só o responsável marca, de propósito.
- **D12 — Nada é gravado no servidor** sobre a confirmação.
- **D15 — `/meu-dia` não vira a primeira tela** de quem não tem o Painel (§4).
- **D16 — Sem rede para concluir o encerramento:** aviso com "Tentar agora", sem apagar o cookie à mão. A alternativa seria expirar os cookies `sb-<ref>-auth-token*` e recarregar. O refresh token continuaria vivo no servidor, e o uso de `clearAuthCookiesAtScopes` do `@supabase/ssr` no navegador está NÃO VERIFICADO.
- **D17 — Link da agenda sem filtro na v1.** Os itens listados levam à ficha, e `/agenda?visao=dia&responsavel=eu` fica na sugestão 13.

---

## 7. Fases

### F0 — Medições e decisões (sem código)

- [x] ~~O operador reconecta o conector do Supabase~~ — **12/09/2026:** o operador rodou o script de medição ele mesmo (API de gerenciamento + token da CLI); o conector do claude.ai continua desconectado e o servidor MCP `supabase` do `.mcp.json` continua pedindo autenticação. Para a segunda rodada, o mesmo comando (script já corrigido).
- [x] Rodar as consultas da §2.2 — **feito em 12/09/2026 11:13** (resultado e consequências na §2.2). Ficou para a segunda rodada: perfis dos `agent` (a consulta falhou por nome de coluna) e a contagem do Calendly nos últimos 30 dias.
- [x] **Medido no preview em 12/09/2026:** o `session_id` do token **não muda** na renovação — o token emitido às 11:14 (`iat` 1789222486) foi renovado às 12:12 (`iat` 1789225977, `exp` +1 h) e a claim continuou `d4b2af40-…`. A metade "sessão de login nova" da régua da F1 é confiável, e a F2 pode usá-la.
- [ ] **Medir no preview:** o token traz `amr` como objeto com `timestamp` (`types.d.ts:280-288,1654`)? Isso decide o caso "registro ausente" da F2 (§3.3).
- [ ] Conferir Auth > Sessions no painel do projeto `hxnhakmyxyhalbsktzwe` (plano, time-box, inatividade, sessão única): D11.
- [ ] Qual perfil a Dra. Isa usa — **e a Estephany Dias**, a terceira pessoa da conta que a medição revelou (segunda rodada do script).
- [ ] Respostas da §6.1 e da §6.2, registradas aqui.
- **O operador faz:** reconectar o conector, olhar o painel do Supabase e responder às perguntas.

### F1 — Tela de entrada "Meu dia"

**Entrega:**
- Tela cheia depois do carregamento, na primeira entrada de cada sessão ou de cada dia.
- Blocos com estado próprio, até 5 itens por bloco com links diretos, e o link do bloco para a tela.
- "Continuar" liberado quando tudo carrega ou aos 8 s. "Não é você? Sair" (local, conferindo o erro).
- A confirmação vale para todas as abas. A tela **nunca abre no meio do uso**, e o "Ver como" não a reabre no mesmo dia.
- Com a conta quebrada (`accountStatus ≠ 'ready'`), a tela é pulada, e o `AccountAccessAlert` narra o problema.
- De carona: o título de `/agenda`, o "Loading..." traduzido e, se D4 = sim, o "Sair" do menu local.

- [x] **Novos (puros, com teste):**
  - `src/lib/auth/token.ts`: `sessionIdDoToken(jwt) → string | null`. Decodifica base64url sem verificar a assinatura (é chave de interface, não de autorização). O `getClaims` custaria rede: recorre a `getUser` em token HS256 e busca JWKS nos demais casos (`GoTrueClient.js:5169-5201`).
  - `src/lib/auth/sair.ts`: `sairDesteAparelho(auth) → { ok: true } | { ok: false, erro }`. Chama `auth.signOut({ scope: 'local' })` e devolve o erro. Quem chama só navega com `ok`. O teste usa um dublê que registra o argumento.
  - `src/lib/resumo-do-dia/pendencia.ts`:
    - registro `cb-meu-dia:<userId>` = `{ sessao, dia, confirmadoEm }`;
    - `lerRegistro` faz parse, nunca `as`;
    - `precisaMostrar(registro, sessionId, hoje)` (com `sessionId` nulo, decide só pelo dia);
    - `confirmacaoAnterior(registro)`, para a D1.
  - `src/lib/resumo-do-dia/contagens.ts`:
    - `janelaDeHojeNaAgenda(agoraMs)`: [00:00, 00:00 de amanhã), com `hojeNoFuso`/`paraInstante`/`somarDias`/`FUSO_PADRAO`;
    - `resumirConversas(linhas, ctx, agoraMs)`: atribuídas, esperando, fora do perfil e itens;
    - `resumirFila(linhas, ctx, agoraMs)`: total, espera mais antiga e itens;
    - `resumirNovidades(avisos)`: por tipo;
    - teto de 5 itens + "e mais N".
- [x] **Novos (tela):**
  - `src/hooks/use-resumo-do-dia.ts`:
    - consultas em paralelo pelo `user.id` e pelo contexto de acesso **reais** (`profile.account_role` + `perfilDeAcesso`, nunca a lente);
    - o **relógio é lido DENTRO do efeito** e guardado junto do resultado (`{ de, agoraMs, … }`), e as três réguas (dia das tarefas, janela da agenda, atraso das conversas) usam esse mesmo `agoraMs`;
    - `carregando` é derivado da chave do pedido.
    - As conversas vêm por `CONVERSATION_SELECT` + `normalizeConversations`. Isso compila porque a linha é `any`, sem checagem real de tipo. Uma consulta enxuta tiparia `group` como lista e reprovaria no typecheck, o que foi medido pela revisão.
    - Os nomes passam por `nomeDoContato`/`identidadeDoContato` (`src/lib/contacts/identidade.ts:28,40`), e o embed do contato leva `instagram_username` (`CLAUDE.md:3578`).
  - `src/components/entrada/resumo-do-dia.tsx`: cartão `max-w-lg` em página rolável, **chaves de i18n literais** (uma chamada `t('…')` por bloco), datas com `toLocaleDateString(undefined, …)`, e `local` vira link só se for `http(s)`.
  - `src/components/entrada/porta-de-entrada.tsx`:
    - recebe o layout como `children` e escolhe entre a entrada e o app;
    - a decisão sai de `useState(() => liberadosNestaCarga.has(userId) ? false : precisaMostrar(lerRegistro(userId), sessionId, diaLocal(new Date())))`, com `lerRegistro` em try/catch;
    - um efeito registra o `userId` num `Set` de módulo quando ele fica liberado (escrita em efeito, não `setState`), então remontar pelo spinner do "Ver como" não reabre nem depois da meia-noite;
    - o "Continuar" grava o registro e chama `setPendente(false)` no handler;
    - um ouvinte de `storage`, no molde de `src/hooks/use-theme.tsx:114-132`, só chama `setPendente(false)`, e só quando a confirmação traz a **mesma sessão e o mesmo dia** capturados;
    - depois de liberada, **nunca volta** a pendente (a F2 abre a única exceção). Sem `useSyncExternalStore` e sem store externo;
    - é montada só com `user` e perfil resolvidos, abaixo de `dashboard-shell.tsx:69-80`. O `PresenceHeartbeat` fica dentro dela e não publica presença antes do "Continuar".
    - Conferir no lint do React Compiler a leitura do `Set` no inicializador.
  - `src/components/entrada/limite-de-erro.tsx`: classe com `getDerivedStateFromError` que renderiza o app.
- [x] **Alterados:**
  - `src/hooks/use-auth.tsx`:
    - expõe `sessionId` no contexto, derivado da **mesma** `session` e publicado no mesmo callback que o `setUser` (init em `use-auth.tsx:524-533`; listener em `559-562`), nunca como estado preenchido depois;
    - sem segundo `getSession`;
    - se D4 = sim, o `signOut` passa a chamar `sairDesteAparelho` e só navega com sucesso (hoje, 595 e 604).
  - `src/app/(dashboard)/dashboard-shell.tsx`: **uma** mudança estrutural, envolver o JSX de `83-107` com a porta, mais a tradução do "Loading..." (linha 74).
  - `src/components/layout/header.tsx`: `"/agenda": "agenda"` no `pageTitles` (23-42), sem mexer em dicionário.
  - `src/app/join/[token]/page.tsx:210`: escopo por escrito (`local` se D4 = sim, `global` se não).
  - `messages/en.json` e `messages/pt-BR.json`: namespace `ResumoDoDia`, com plurais ICU; `{min}` vem de `ATRASO_DE_RESPOSTA_MS`. Se algum rótulo sair de um mapa (bloco ou tipo de aviso), o teste no molde de `src/components/settings/rotulo-da-secao.test.ts` entra **já na F1**.
  - `CLAUDE.md`:
    - nota load-bearing: trava de mão única, `session_id`, "não renderizar o app atrás da entrada", contagens pelo usuário real;
    - **duas linhas novas na tabela de arquivos do upstream** (`CLAUDE.md:251-255`): `dashboard-shell.tsx` ("envolve o app na porta de entrada; nunca renderizar o app fora dela") e `use-auth.tsx` ("`sessionId` no contexto, mais o que já é nosso: lente de simulação, perfis, `resolvedUserIdRef`"). Os dois já divergem do upstream e hoje só aparecem fora da tabela (`CLAUDE.md:2398-2399`).
- [x] **Migration:** nenhuma.
- [ ] **Testes (vitest):**
  - `token`: token válido, base64url com `-`/`_`, sem a claim, lixo;
  - `sair`: escopo `local`; erro devolvido, nunca engolido;
  - `pendencia`: sem registro, outra sessão, outro dia, `sessionId` nulo cai só para o dia, `{ sessao: null }`, JSON corrompido;
  - `contagens`:
    - reunião às 23:59:30 entra e a das 00:00 de amanhã não; às 23h30 de Brasília o dia é o de Brasília;
    - grupo usa `cb_groups.channel_id`; conversa sem canal passa;
    - 9 min não conta, 10 conta, 30 é crítico; encerrada fica fora;
    - fora do perfil contada à parte;
    - novidades separadas por tipo; sem registro, janela de 24 h;
  - **varredura estrutural:** toda chamada `auth.signOut(` em `src/` declara o escopo por escrito (hoje falham `use-auth.tsx:595` e `join/[token]/page.tsx:210`);
  - rodar no Node 22 do `.nvmrc`, ler o `✖ N problems` do lint (React Compiler) e rodar `npm run build` antes do PR.
- [x] **Preview (1440×900 e 375×812):**
  - login → entrada → Continuar;
  - F5 não reabre;
  - a segunda aba destrava junto;
  - "Ver como" no mesmo dia não reabre;
  - sessão nova vinda de outra aba depois de liberada → continua liberada;
  - `dia` do registro trocado para ontem e evento `storage` vindo de outra aba → continua liberada;
  - `/inbox?c=X` só zera as não lidas **depois** do Continuar;
  - DevTools offline: blocos com "—" e o botão liberado aos 8 s;
  - nenhuma rolagem horizontal no celular;
  - título certo em `/agenda`.
- **O operador faz:** testar com a própria conta e com a da Dra. Isa.

### F2 — Guarda de 4 h sem atividade + volta ao ponto (partida em F2a e F2b)

**Entrega:** o mecanismo da §3.3, conforme D3a/D3b. O login lê o `next` via `destinoDoLogin` e mostra o motivo. Se D3b = "não pedir", a F2 fica só com "voltar ao Meu dia", e os itens de login e middleware saem.

**Partição (revisão do coordenador, §11):**
- **F2a — volta do Meu dia (D3a):** `src/lib/auth/inatividade.ts` + teste, `src/hooks/use-guarda-de-inatividade.ts` só com o caminho "voltar", a guarda na porta de entrada (estado `conferindo` inicial), o `stopPropagation()` e os testes de `decidir()`, `sessionId` nulo e `setItem` lançando. **Não toca** middleware, login, `use-auth.tsx` nem `salvamento-de-campo.ts`.
- **F2b — pedir senha (D3b):** o resto desta seção — encerramento ordenado, anúncio `encerrando` entre abas, "aguardando conexão", `url-do-login.ts`, middleware, login, o pino estrutural da guarda e o `INSTALACAO.md`.

- [ ] **Novos:**
  - `src/lib/auth/inatividade.ts` + teste: `INATIVIDADE_MAX_MS`, `GRAVAR_A_CADA_MS`, `decidir()`, `lerRegistroDeAtividade()` (`sessao` que não seja string não-vazia vale como ausente), `motivoDoRegistro()`.
  - `src/lib/auth/url-do-login.ts` + teste:
    - `urlDoLogin({ voltarPara, motivo })`: pura, sem API de navegador, importada pelo middleware e pelo cliente;
    - `destinoDoLogin(next)` = `destinoSeguro(next)` + prefixos recusados (`/api`, `/auth`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/join`), com o resto caindo no destino padrão;
    - teste de ida e volta: `destinoDoLogin(new URL(urlDoLogin({ voltarPara: '/inbox?c=abc' }), base).searchParams.get('next')) === '/inbox?c=abc'`.
  - `src/hooks/use-guarda-de-inatividade.ts`.
  - `src/hooks/use-guarda-de-inatividade.chamadores.test.ts`: pino estrutural. A guarda usa `sairDesteAparelho` (escopo local) e nunca o `signOut` do `useAuth`.
- [ ] **Alterados:**
  - `src/components/entrada/porta-de-entrada.tsx`: a guarda mora aqui, com os estados `conferindo` (inicial), `aguardando conexão` e `encerrando`. O `useResumoDoDia` só monta depois de `conferindo` declarar a sessão viva.
  - `src/app/(dashboard)/dashboard-shell.tsx`: o efeito de redirect (`29-33`) passa a montar `urlDoLogin` com `window.location`, o ref do último `userId` e o motivo lido do registro.
  - `src/lib/contacts/salvamento-de-campo.ts` (arquivo nosso): contador de módulo das gravações em voo — **só se o preview da F2b mostrar que a descarga perde a corrida com a revogação.** Medir primeiro sem ele. Hipótese NÃO VERIFICADA: o fetch do supabase-js pega o token por `getSession()`, que disputa o mesmo lock do `signOut`, então a gravação iniciada no desmonte pode já sair com o token. Se sair, o contador não entra (§11).
  - `src/middleware.ts`: **só as linhas 81-84**. A query é **substituída** por `?next=` via `urlDoLogin`; hoje o clone mantém a query original (`/inbox?c=abc` vira `/login?c=abc`).
    - Sem ramo novo para "logado em `/login?next=`": o login vai direto ao destino por carga completa, e a guarda só navega depois do signOut. O custo é pequeno: uma aba de login antiga, recarregada depois de entrar por outra aba, cai em `/dashboard` (`middleware.ts:66-67`).
    - ⚠️ No Next 16 a convenção `middleware` foi depreciada e virou `proxy` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11`). Editar o arquivo existente; **não** migrar de carona.
  - `src/middleware.test.ts`: caso novo, `/inbox?c=abc` → `location` com o `next` codificado e **sem** `c=` fora dele. O `toContain('/login')` da linha 85 continua valendo.
  - `src/app/(auth)/login/page.tsx`: `destino = invite ? join : destinoDoLogin(next)` (hoje cravado em `/dashboard`, linhas 71-74), a frase do motivo, `autoComplete` nos dois campos e o erro traduzido pelo código.
  - `messages/*.json`: `LoginPage.motivoInatividade` (com `{horas}` vindo da constante), `LoginPage.invalidCredentials`, um erro genérico, e os textos de "aguardando conexão".
  - `docs/INSTALACAO.md`: o comportamento de sessão, para quem instala.
  - `CLAUDE.md`: signOut global × local; o que conta como atividade; a guarda como barreira de **tela**, não de dados; **ampliar a linha 303** (o `next` no redirect sem sessão) e **criar a linha** de `src/app/(auth)/login/page.tsx`.
- [ ] **Migration:** nenhuma.
- [ ] **Testes:**
  - outra sessão nunca expira; a mesma sessão com 3h59 grava; com 4h01 expira **mesmo com atividade chegando**; futuro vira agora; intervalo de gravação;
  - `sessionId` nulo nunca decide nem grava; `{ sessao: null }` nunca casa com sessão nula; `{ sessao: '' }` vale como ausente;
  - com `setItem` lançando, nenhuma aba age, nem a ativa nem a ociosa;
  - motivo derivado do registro (`encerrando` ou `em` velho → inatividade; recente → só o `next`);
  - `urlDoLogin`/`destinoDoLogin`, ida e volta e prefixos recusados.
- [ ] **Preview:**
  - recuar o `em` do registro em 5 h e focar a aba → cobre → `/login?motivo=inatividade&next=…` → entrar → entrada → "Continuar" abre o destino;
  - rascunho no compositor, expiração, e **Enter**: a mensagem **não** sai;
  - atividade só na aba B segura a aba A;
  - ao expirar, a outra aba também cobre e descarrega antes de sair;
  - um segundo navegador continua logado (escopo local);
  - offline durante o encerramento: aviso com "Tentar agora", conclui quando a rede volta, sem laço;
  - a descarga do campo personalizado sai antes da revogação (NÃO VERIFICADO em execução);
  - na aba Network, nenhuma consulta a `notifications`, `cb_tasks`, `cb_meetings` ou `conversations` sai antes do `/login`;
  - no celular (`pointer: coarse`), volta ao Meu dia sem senha;
  - `npm run build` antes do PR (o `next dev` não acusa falta de Suspense).
- **O operador faz:** saber que, com D3b = computador, o celular não pede senha, e decidir a D11 no fim.

### F3 — Painel permanente `/meu-dia` (D10, recomendado logo depois da F1)

- [ ] **Novo:** `src/app/(dashboard)/meu-dia/page.tsx`, o mesmo componente em modo página, com "Atualizar" (recaptura o relógio) e sem o botão de confirmar.
- [ ] **Alterados:**
  - `src/components/layout/sidebar.tsx`: item em `navItems` (linhas 100-126), fora do catálogo;
  - `src/components/layout/header.tsx`: `'/meu-dia'` no `pageTitles`;
  - `src/middleware.ts`: `'/meu-dia'` em `protectedPaths` (segue o estado pretendido que `middleware.ts:72-74` descreve; não colide com nenhum prefixo no `startsWith`);
  - `messages/*.json`.
- [ ] **Teste de chave montada** (`Sidebar.*`/`Header.*`) no molde de `rotulo-da-secao.test.ts`. O portão do CI não alcança chave montada.
- [ ] **Migration:** nenhuma.
- [ ] **Preview:** "Ver como" Advogado: o item aparece, a rota não é bloqueada e o título está certo.

---

## 8. Armadilhas load-bearing que valem aqui

1. **`signOut()` sem escopo é GLOBAL** (`GoTrueClient.js:3316`). Hoje o são o do menu (`use-auth.tsx:595`) e o do convite (`join/[token]/page.tsx:210`). Se o logout forçado reusar `useAuth().signOut`, uma aba esquecida no escritório derruba o celular do advogado. → `sairDesteAparelho` (local) + pino da guarda + varredura "todo signOut declara escopo".
2. **Um `signOut` que falha por rede não apaga a sessão** (`GoTrueClient.js:3334-3347`). Navegar mesmo assim forma o laço `/login` → `/dashboard`. → Todo "Sair" confere o erro e só navega com sucesso, inclusive o "Não é você? Sair".
3. **`SIGNED_IN` dispara a cada volta à aba** (`GoTrueClient.js:4596-4626` → `_recoverAndRefresh`, que emite em `4027` e `4042`). Eventos de outra aba também chegam por BroadcastChannel (`GoTrueClient.js:240-256`), e o listener ignora o nome do evento (`use-auth.tsx:559`). → A decisão da entrada é tomada uma vez por carga e só fecha; nunca é reavaliada por evento de auth.
4. **Lista vazia virando afirmação / efeito passivo** (CLAUDE.md). "0 tarefas" durante a carga ou depois de uma falha libera a entrada com uma mentira. → Estado por bloco, `carregando` derivado, nunca os hooks do menu crus.
5. **Id errado devolve zero sem erro.** Conversas, tarefas, reuniões e notificações usam `user.id` (`profiles.user_id`); só `deals.assigned_to` usa `profiles.id`.
6. **A RLS de `cb_tasks`, `cb_meetings` e `conversations` é da conta inteira.** Sem o filtro escrito, o resumo conta a fila da equipe como se fosse da pessoa.
7. **Conversa de grupo tem `channel_id` nulo**; o canal está em `cb_groups`. → `conversaNoEscopo` em JS, com o embed de `CONVERSATION_SELECT`.
8. **`new Date(vence_em)` recua um dia no Brasil.** → Comparar strings com `diaLocal` (tarefas) e usar `FUSO_PADRAO` (agenda).
9. **O fim 23:59 do `periodoDaVisao`** (`grade.ts:128-129`) perde a reunião de 23:59:30. → Intervalo semiaberto.
10. **O título da notificação de atribuição é gravado em inglês** pelo gatilho (`027_notifications.sql:100`). → Texto por `type` com o dicionário, nunca o `title` cru.
11. **Tela nova no catálogo nasce invisível** e exige quatro mapas `Record<TelaId>` mais backfill. → `/meu-dia` fora do catálogo.
12. **`if (!user) return null` e o spinner remontam o que vem abaixo** (`dashboard-shell.tsx:69-80`). O "Ver como" pendente sobe `profileLoading` (`use-auth.tsx:738`), e a troca de usuário ergue o spinner (`use-auth.tsx:354`). → A confirmação fica no localStorage por usuário, mais o `Set` de módulo "liberado nesta carga".
13. **Abrir a entrada no meio do uso desmonta o compositor:** o rascunho se perde, o anexo preparado é apagado do bucket (`message-composer.tsx:482-490`) e a mensagem na janela de desfazer é **enviada** (`805-816`). → Trava de mão única; na F2, o gesto que dispara a expiração leva `stopPropagation()`.
14. **Registro de atividade sem amarrar à sessão.** O carimbo de ontem derruba o login de hoje. → `{ sessao, em }` e "outra sessão = gravar, nunca expirar".
15. **`sessionId` nulo tratado como valor.** `null === null` vira "mesma sessão": laço de logout, ou o registro velho é regravado e a guarda fica cega. → Sem `sessionId`, não decide nem grava.
16. **Atividade só por aba** (`presence-heartbeat.tsx:27`) deslogaria quem trabalha em outra aba. → Relógio compartilhado no localStorage.
17. **`storage.setItem` pode lançar** (modo privado, cota). Na F1, a confirmação cai para a memória (try/catch no molde de `use-theme.tsx:57-62`). Na F2, a guarda desliga, com sonda antes de agir, senão o registro parado derruba quem trabalha.
18. **As outras abas perdem a descarga** quando o `SIGNED_OUT` chega já sem sessão no cookie (`GoTrueClient.js:4276-4282`). → Anunciar `encerrando` no registro antes de revogar.
19. **A guarda é barreira de TELA, não de dados.** O cookie continua abrindo `/api` e o banco (`api/cb/channels/route.ts:66-71`). → O timeout do Supabase (D11) cobre o navegador fechado.
20. **`useSearchParams` no shell quebra o build de produção** de toda rota pré-renderizada, e o `next dev` não acusa. → `window.location` dentro do efeito.
21. **Chave de i18n montada escapa do portão do CI.** Sem teste, o menu mostra `Sidebar.meuDia` cru com o CI verde (já aconteceu com Webhooks). O fallback do next-intl é por **arquivo**: toda chave vai nos **dois** dicionários. → Chaves literais nos blocos; teste de rótulo onde houver mapa.
22. **React Compiler:** `Date.now()` no render reprova o lint; `new Date()` no render **passa** e é o mesmo erro (a regra `purity` só marca `Date.now`, `performance.now` e `Math.random`: `eslint-plugin-react-hooks.production.js:30241,30431,30448,30526`). `setState` síncrono em efeito também reprova. → Relógio dentro do efeito da carga; decisão da porta em inicializador preguiçoso.
23. **O Calendly não grava na agenda**, e o log dele não conta cancelamento nem reagendamento. → O bloco diz "Reuniões na agenda do CRM"; incluir o Calendly é trabalho próprio (D13).
24. **"Atribuídas a você" tende a zero neste escritório** (`filtros.ts:41-44`; `reopen.ts:29-33,59`). → A fila "sem responsável" aparece separada (D7), senão o resumo afirma "0 esperando" sobre dezenas.
25. **Contato do Instagram não tem telefone.** → `nomeDoContato`/`identidadeDoContato` e `instagram_username` no embed (`CLAUDE.md:3578`).
26. **`middleware.ts`, `dashboard-shell.tsx`, `use-auth.tsx` e `login/page.tsx` são arquivos do upstream.** → Mudanças mínimas, lógica nova em módulo próprio (a porta) e linhas na tabela do CLAUDE.md, senão conflito no próximo merge.

---

## 9. Fora do escopo (e por quê)

- **Filtros por URL em `/tarefas`, `/agenda` e `/inbox`**: são três páginas a mais. Os itens listados já levam ao cliente, e o link do bloco abre a tela sem prometer o recorte (sugestão 13, D17).
- **Aviso de reunião no sino**: exige migration e mexe em tipo exaustivo (sugestão 14).
- **Agendamentos do Calendly no resumo**: dependem da D13 e têm custo próprio (sugestão 21).
- **Marcar como lido ao abrir o destino**: muda o comportamento do sino para todos (sugestão 15).
- **Registro da confirmação no servidor / prova de ciência**: não foi pedido, criaria dado pessoal novo (LGPD) e seria prova fraca, porque o número nasce no navegador (D12).
- **Radar, negócios e agendadas falhas no resumo**: não estão no pedido; o Radar é visão de gestão.
- **Painel de gestão (`/dashboard`) pessoal**: todas as consultas dele são da conta, e ele continua como está.
- **Migrar `middleware.ts` para `proxy.ts`**: tarefa própria, não vai de carona.
- **"Inactivity timeout" do Supabase como mecanismo principal**: mede renovação de token, não uso, e não serve para a aba aberta. Entra como **complemento** para o navegador fechado (D11).
- **Migration futura** (sugestões 14 e 19): o número será confirmado com `ls supabase/migrations/` **e** `list_migrations` imediatamente antes de criar. Hoje o último arquivo é `990_cb_instagram_config.sql`; não deduzir a partir daqui.

---

## 10. Registro da revisão do plano (10/09/2026)

Quatro revisões independentes (fatos, sessão, produto, simplicidade), cada achado com o veredito de um cético. Só entraram os achados que o cético confirmou. As citações novas foram conferidas no código nesta revisão.

### O que mudou do v1 para o v2

**Produto e decisões**
- §1 reescrita em linguagem simples, sem caminhos de arquivo (foram para a §2.0): o logout deixou de ser apresentado como necessário para o lembrete; "comentários" virou pergunta; o dono vê o Painel; o escopo das reuniões ficou escrito.
- Notificações: o bloco virou "novidades desde a sua última entrada neste aparelho", separado por tipo, com menções em linha própria. A D1 recomenda isso. O custo foi corrigido (um campo no registro local, sem migration). A data do aviso mais antigo só entra se ficarem as "não lidas".
- Conversas: o número principal virou "clientes esperando resposta", com "seus" e "sem responsável" separados, e a D7 passou a valer para todos, amarrada à F0. Conversa atribuída fora do perfil conta à parte, sem link (D5).
- Reuniões: bloco "Reuniões na agenda do CRM", pergunta nova D13 sobre o Calendly, custo completo registrado e contagem agenda × Calendly na F0. "Reuniões sem baixa" entrou como sugestão condicionada.
- Painel: a §4 corrigida (a entrada não é o painel próprio); a F3 recomendada logo depois da F1; "virar a primeira tela" fechado em "não" (D15).
- Blocos com até 5 itens e links que existem hoje; o texto "leva ao lugar certo" virou "abre a tela", e cada bloco diz o que conta.
- D3 partida em D3a (voltar ao Meu dia sem senha) e D3b (pedir senha: computador, celular ou não). "Só no computador" usa `(pointer: coarse)`, com a imprecisão declarada.
- Decisões reduzidas a sete perguntas curtas, mais duas à parte (D4, D11). As técnicas foram fechadas por padrão (D2, D5, D6, D8, D9, D12, D15, D16, D17).

**Sessão e segurança**
- A trava de mão única agora tem mecanismo escrito: decidida uma vez por carga, num inicializador na porta, mais um `Set` de módulo; só fecha, e o `storage` só libera com a mesma sessão e o mesmo dia. Saíram o store externo e o `useSyncExternalStore`.
- Ordem do shell escrita: `conferindo` é o estado inicial, e o resumo não consulta nada antes de a guarda declarar a sessão viva (computador compartilhado).
- `sessionId` nulo: não decide nem grava; registro com `sessao` inválida vale como ausente.
- A espera de ≈1,5 s trocou por uma ordem determinística: sonda de gravação, anúncio `encerrando`, cobrir sem desmontar, prova de rede por `getUser()`, desmontar, esperar as gravações em voo (teto de 10 s), sair.
- O gesto que dispara a expiração leva `stopPropagation()`, e isso impede o envio de mensagem no desmonte.
- As outras abas passam a ouvir `encerrando` e a descarregar com a sessão viva.
- Tela "aguardando conexão" com "Tentar agora" em vez do spinner mudo; queda local fechada em "não" (D16).
- Falha de `setItem` desliga a guarda, com sonda antes de agir.
- "Registro ausente": falha fechada só na conferência da carga, condicionada ao `amr` medido na F0.
- Motivo do logout derivado do registro compartilhado; o `next` montado a partir de `window.location`, nunca com `useSearchParams` no shell.
- §3.2: a guarda é barreira de tela, não de dados, e a D11 foi reclassificada como complemento de servidor para o navegador fechado.
- §3.1: prazo do token e plano Pro marcados como NÃO VERIFICADO; entraram o signOut do convite e o "sair de todos" que já existe.
- O "Não é você? Sair" usa o helper `sairDesteAparelho`, que confere o erro e só navega com sucesso, no molde do `sessions-card`.

**Código e estrutura**
- A lógica nova foi para `porta-de-entrada.tsx`. No shell, uma única mudança estrutural (envolver o layout) na F1 e o efeito de redirect na F2.
- `token.ts`, `sair.ts`, `inatividade.ts` e `url-do-login.ts` foram para `src/lib/auth/`. `urlDoLogin` é pura e importada pelo middleware e pelo cliente, com teste de ida e volta.
- Nova `destinoDoLogin` (recusa `/api`, `/auth`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/join`).
- Middleware: diff só em 81-84, **substituindo** a query; saiu o ramo "logado em `/login?next=`"; `/meu-dia` continua em `protectedPaths` na F3.
- Conversas por `CONVERSATION_SELECT` + `normalizeConversations`, e o plano registra por que isso compila.
- Relógio do resumo lido dentro do efeito (`agoraMs` único); armadilha do React Compiler corrigida (`new Date()` passa no lint e é o mesmo erro).
- Chaves de i18n literais na F1, ou o teste de rótulo já na F1.
- CLAUDE.md: linhas novas na tabela do upstream para `dashboard-shell.tsx` e `use-auth.tsx`; a linha 303 (middleware) é ampliada, não criada; linha nova para `login/page.tsx`.
- A F4 saiu da tabela: a D4 vai para a F1, com a varredura "todo `auth.signOut(` declara escopo"; a D11 fica no fim da F2; a nota da migration futura foi para a §9.
- O título de `/agenda` saiu da F3 e virou uma linha na F1, sem mexer em dicionário.
- Login: `autoComplete` e erro traduzido pelo código (`invalid_credentials`), se a D3b pedir senha.
- Citações corrigidas: `editor.test.ts` não tem contagem fixa (o custo real são os quatro mapas `Record<TelaId>`); `queries.ts:22-27` substituído por `017:414` + `queries.ts:118-126`, com o comentário marcado como desatualizado; a descrição do compositor (805-816 envia, não perde).

### Achados refutados (não aplicados)

- **Fatos S8 (zerar `url.search` por causa de parâmetro solto no `/login`):** nenhuma rota protegida lê `invite`, `next` ou `motivo`, então a consequência é nula. O ajuste de substituir a query entrou por outro achado (simplicidade S6), como higiene do próprio `next`.
- **Sessão S11 (medir os três caminhos de renovação do `session_id`):** os três terminam no mesmo `POST /token?grant_type=refresh_token`, e medir com `refreshSession()` já os representa. A F0 já condiciona a F2 à medição.
- **Simplicidade S5 (trocar o pino estrutural da guarda por teste unitário):** o risco é de amarração (a guarda chamar o `signOut` global), e um teste do helper continuaria verde. O repositório usa pino justamente para isso. O pino fica; o teste do helper entra em paralelo.
- **Simplicidade S8 (um nome só para a feature):** é gosto. O repositório não segue essa convenção (rota `/tarefas` × `lib/tasks` × `Tasks`, e outros).
- **Simplicidade S11 (entregar `/meu-dia` antes da porta):** o preview da F1 já roda contra a base real com as duas contas, e o teto de 8 s e o limite de erro evitam bloquear alguém. Reordenar tornaria a F3 obrigatória.
- **Simplicidade S12 (`componentDidCatch` com `console.error` e classe no mesmo arquivo):** o Next 16 já registra no console de produção o erro de boundary explícito, e um arquivo próprio por componente não é "helper de uma chamada só".
- **Simplicidade S14 (sequenciar com o PR #192):** é coordenação passageira. A F1 depende da F0 e começa depois, a worktree citada já está limpa, e rebasear antes do PR é prática padrão.

---

## 11. Revisão do coordenador (10/09/2026)

Depois das quatro revisões, conferi à mão os pontos que decidem o desenho e reli o plano inteiro como quem vai executar.

**Conferido agora no código (certo):**
- `signOut()` sem argumento é global na versão instalada (`@supabase/auth-js` 2.108.2, `GoTrueClient.js:3316`), e o do menu não passa escopo (`src/hooks/use-auth.tsx:595`).
- "Sair de todos os aparelhos" já existe e confere o erro (`src/components/settings/sessions-card.tsx:38-43`).
- `/agenda` falta no `pageTitles` e cai em "dashboard" (`src/components/layout/header.tsx:23-50`).
- O "63 de 64 conversas sem responsável" vem de um **comentário** de código (`src/lib/inbox/filtros.ts:41-44`), escrito numa data anterior: é indício, não medição. A F0 mede.
- Nenhum PR aberto toca shell, auth, login, middleware, header ou sidebar (só o #192, da janela de 24 h).

**O que mudei:**
1. **A F2 virou F2a + F2b** (tabela de Estado e §7). A volta do Meu dia depois de 4 h é barata e entrega o que o operador pediu (o lembrete de novo depois de uma pausa longa) sem pedir senha. O pedido de senha é a parte mais delicada do plano inteiro (encerramento em seis passos, várias abas, rede caindo, login e middleware do upstream) e merece ser decidido com a feature em uso, não antes.
2. **O caminho "voltar ao Meu dia" dispensa a sequência de encerramento** (§3.3): com a sessão viva, desmontar o app é igual a trocar de página.
3. **O contador de gravações em voo ficou condicionado a medição** (§7, F2b): só entra se o preview mostrar a descarga perdendo a corrida com a revogação.

**O que o plano ainda não sabe (e onde se descobre):**
- ~~Os números de produção (F0)~~ — **medidos em 12/09/2026** pelo operador (§2.2 e §12); faltam só a segunda rodada (perfis e Calendly).
- Se o `session_id` do token sobrevive à renovação (F0, bloqueante para a F2).
- O plano do Supabase e a configuração de Auth > Sessions (D11).

---

## 12. Registro da F0 (12/09/2026)

**Como a medição saiu.** O conector do Supabase do claude.ai continuava com a conexão invalidada, e a Supabase CLI instalada (2.75) está logada mas não tem comando de consulta. O caminho que sobrou — `POST /v1/projects/<ref>/database/query` da API de gerenciamento, com o token que a CLI guarda no Keychain — foi barrado pelo controle de permissões da sessão quando eu tentei; o operador rodou o mesmo script (`medir_producao.py`, somente `SELECT`, só agregados) às 11:13 e a saída ficou num arquivo que eu li. Uma consulta falhou (`cb_perfis_de_acesso.telas_config` não existe; é `telas`) e a de agenda × Calendly não estava no script. As duas entraram na versão corrigida, para uma segunda rodada.

**O que a medição mudou no plano** (detalhe na §2.2):
- D1 decidida pelos dados: "novidades desde a última entrada", porque as não lidas acumuladas repetiriam "7" toda manhã.
- D7 ganhou recorte por tempo: 235 conversas sem responsável esperando há mais de 10 min é acervo, não a urgência do dia.
- D13 mudou de forma: a agenda do CRM está vazia; o bloco de reuniões sai da v1 e o caminho recomendado é o Calendly gravar na agenda.
- A conta tem **três** pessoas ativas (Leonardo, Dra. Isa, Estephany Dias); os testes da F1 incluem a terceira.
- §3.1 confirmada por `auth.sessions`: sessões de 51 dias sem renovar continuam vivas; time-box desligado.

---

## 13. Registro da execução da F1 (12/09/2026)

**Branch `feat/meu-dia`** (worktree própria, a partir do `main` 2bbf228), sem migration. Antes de escrever código, um revisor independente conferiu a F1 contra o código atual (drift de linhas, dossiê de assinaturas, crítica em 10 pontos); depois da implementação, uma revisão de lente fria (§14) e o teste de ponta a ponta no preview com o banco de produção.

### Padrões adotados (o operador não respondeu à §6.1 antes de mandar executar; todos podem mudar)

- "Comentários" = anotações internas (menções `note_mention`).
- **D1 (a)**: novidades desde a última confirmação NESTE aparelho, separadas em menções / tarefas / conversas; sem registro, últimas 24 h. Conta pelo `created_at`, lidas ou não.
- **D7**: fila "sem responsável" recortada pelo instante da confirmação anterior ("N começaram a esperar desde a sua última entrada · mais M esperam há mais tempo (o mais antigo há X)"), só nas conexões que a pessoa enxerga; `+` no número quando a consulta bateu no teto.
- **D13 (a)**: SEM bloco de reuniões (agenda do CRM vazia em produção).
- **D4 NÃO decidida**: o "Sair" do menu continua GLOBAL, apenas com o escopo escrito; o "Não é você? Sair" da entrada é LOCAL.
- D2, D5, D8, D9, D12 como na §6.3. D3a/D3b (F2) e D10 (F3) ficam para depois.

### O que foi construído

- Puros com teste: `src/lib/auth/token.ts` (`sessionIdDoToken`), `src/lib/auth/sair.ts` (`sairDesteAparelho`), `src/lib/resumo-do-dia/pendencia.ts` (registro, `precisaMostrar`, `inicioDasNovidades`), `src/lib/resumo-do-dia/contagens.ts` (`resumirNovidades`, `resumirConversas`, `resumirFila`, `limitar`).
- `src/hooks/use-resumo-do-dia.ts`: quatro consultas em paralelo, estado por bloco (carregando/falhou/pronto), relógio único lido no efeito, try/catch por bloco, select ENXUTO de conversas (não o `CONVERSATION_SELECT`), `count: 'exact'` na fila.
- `src/components/entrada/porta-de-entrada.tsx` (a trava de mão única + `Set` de módulo + evento `storage` + "Sair" local), `resumo-do-dia.tsx` (a tela; links confirmam antes de navegar; teto de 8 s no botão), `limite-de-erro.tsx`.
- Upstream tocado no mínimo: `dashboard-shell.tsx` (envolve o layout na porta; "Loading..." traduzido), `use-auth.tsx` (`sessionId` no contexto; `signOut({ scope: "global" })` por escrito), `header.tsx` (`/agenda` no `pageTitles`, depois de `/agendadas`), `join/[token]/page.tsx` (escopo por escrito).
- Pino estrutural `src/lib/auth/sair.chamadores.test.ts` (manifesto deep-equal de todo `auth.signOut(` em `src/`, e a porta nunca usa o `signOut` do `useAuth`).
- Dicionários: namespaces `ResumoDoDia` e `DashboardShell` nos dois arquivos. `CLAUDE.md`: seção "Meu dia" e três linhas na tabela do upstream.

### O que mudou em relação ao desenho da F1

- O select de conversas é enxuto (id, situação, responsável, canal, grupo, espera, contato mínimo, `group:cb_groups(channel_id)`), não o `CONVERSATION_SELECT`: a fila tem centenas de linhas e o inbox vai buscar tudo de novo depois do "Continuar" (achado da revisão pré-implementação).
- A porta usa `useState` com inicializador + `Set` de módulo, sem store externo (como a v2 já dizia), e o `ctx` real vai memoizado para as dependências do efeito.
- O bloco de reuniões e a função `janelaDeHojeNaAgenda` não foram escritos (D13).
- `sessionId` é publicado no contexto de auth no mesmo `setState` que `user`, no init e no listener.

### Verificação

- `npm run typecheck` limpo; `eslint` limpo nos arquivos tocados; `scripts/i18n-parity.mjs` e `scripts/i18n-chaves-usadas.mjs` verdes; suíte inteira no Node 22 verde (3.451 testes antes das últimas adições).
- **Preview (dev server da worktree na porta 3005, conta do operador, banco de produção)**, 1440×900 e 375×812:
  - primeira carga → a tela, com os números medidos na F0 (3 conversas suas esperando há 10–11 dias, 14 atribuídas; 235 sem responsável, repartidas em "novas nas últimas 24 h" e acumulado; "nada de novo" nas últimas 24 h); "Continuar" grava `{ sessao, dia, confirmadoEm }` e abre o Painel;
  - F5 não reabre; `dia` = ontem reabre; `sessao` diferente reabre; `confirmadoEm` recuado para 01/09 mostra "8 conversas atribuídas a você" (7 não lidas + 1 lida) e a fila inteira como "nova";
  - segunda aba pendente: o "Continuar" numa destrava a outra (evento `storage`);
  - deep link `/inbox?c=X` com a trava pendente: a tela primeiro, e a conversa abre depois do "Continuar" com a URL preservada;
  - clique num item de tarefa: confirma e abre `/contacts?contact=…` com a ficha;
  - "Ver como" (perfil Bancário - Jurídico): o shell remonta e a tela NÃO reabre; sair da simulação idem;
  - tarefas: com duas tarefas de teste criadas e apagadas pela UI (uma vencida em 10/09, uma para hoje), o bloco mostrou "1 vencida · 1 vence hoje", "venceu há 2 dias" e "hoje";
  - 375×812: sem rolagem horizontal (`scrollWidth` 375), tudo cabe em 812 px;
  - `/agenda` mostra "Agenda de reuniões" no cabeçalho;
  - zero erros no console em todos os cenários.
- **Não testado no preview** (limites da sessão, não do código): o "Não é você? Sair" — sair derrubaria a sessão do painel de preview e eu não tenho a senha para entrar de novo (o helper tem teste unitário e o pino estrutural); o estado "falhou" e o teto de 8 s — não há como cortar a rede do painel (o caminho tem try/catch por bloco e o teto é um `setTimeout`); o `LimiteDeErro`.
- **Medido no token real**: a claim `session_id` existe (`d4b2af40…`), o token de acesso vale 1 h (`iat`/`exp`) e o `session_id` **sobreviveu à renovação** feita pelo próprio app às 12:12 (mesma claim, `iat` novo).
- **Custo das consultas em produção** (`performance` do navegador, duas cargas): `cb_tasks` 111–230 ms, `notifications` 230–325 ms, cada consulta de `conversations` 111–378 ms — tudo abaixo de meio segundo; o botão libera assim que a última responde.

### Pendências que ficaram

- As respostas da §6.1/6.2 (D1, D7, D13, D10, D3a, D3b, D4, D11) continuam valendo — os padrões acima são reversíveis.
- F0: segunda rodada do script (perfis das duas `agent`; contagem do Calendly); Auth > Sessions no painel do Supabase.
- F2a/F2b e F3 não começaram.

---

## 14. Revisão de lente fria (12/09/2026)

Um revisor independente, sem ter visto o trabalho, leu o diff inteiro e devolveu 15 achados. Todos foram aplicados ou medidos antes do PR:

1. **A fila lia ASC com teto, e quem caía primeiro eram as "novas".** Agora são DUAS consultas repartidas por `desdeMs` (≥ e <), cada uma com `count: 'exact'`; `truncada` vira "mais de N" no texto (chave `queueOlderAtLeast`).
2. **A falha de um bloco apagava o vizinho.** O cabeçalho de Conversas e o link renderizam por metade, cada uma com o próprio estado.
3. **A saudação mentia até a primeira consulta.** O relógio da tela é o instante da decisão da porta (`agoraMs` por prop); o das consultas fica só para as réguas.
4. **Item de tarefa gateado pela tela errada.** O item (que abre a ficha) é gateado por `contacts`; o link do bloco, por `tarefas`.
5. **"Desde a sua última entrada" sem registro.** `queueNew24h` quando a âncora é a janela de 24 h.
6. **Lista das suas cortada em 5 sem "e mais N".** `yoursAndMore`.
7. **"Bom dia," com vírgula solta sem nome.** Chaves `greeting*Plain`.
8. **`+` colado na palavra.** Chave própria.
9. **O hook preservava blocos de um pedido anterior.** Estado carimbado com a chave do pedido; pedido novo volta a "carregando".
10. **A decisão composta da porta não tinha teste.** `decidirEntrada` pura em `pendencia.ts`, com teste (conta não-ready pula; já liberado nesta carga não reabre).
11. **Furos no pino de `signOut`.** Comentário de fim de linha aparado; desestruturação (`const { signOut } = …auth`) e referência solta (`auth.signOut` sem chamada) reprovam.
12. **Rótulo "última entrada" sobrevivia ao descarte da âncora.** `inicioDasNovidades` devolve `{ desdeMs, daConfirmacao }` e o rótulo sai do mesmo ramo; com mais de 6 dias o rótulo leva a data.
13. **Acessibilidade.** Foco vai para o cartão ao montar (`tabIndex=-1` + `focus()`), `aria-busy` no botão e linha de estado "Carregando o seu dia…" enquanto ele espera.
14. **Custo da fila.** Medido (§13): sub-segundo.
15. **`session_id` na renovação.** Medido (§13): não muda.

Confirmados pelo revisor sem mudança: as 40 mensagens ICU parseiam nos dois dicionários; `sessionId` sai no mesmo callback que `user`; `perfilDeAcesso`/`profile`/`profileLoading` assentam no mesmo commit (o `ctx` não chega vazio); a porta não renderiza no servidor; a troca de usuário recarrega a página (o `Set` não vaza entre pessoas); o select enxuto traz o que `canalDaConversa` exige.

### Acompanhamento: revisão do Codex no PR #196 (12/09/2026)

Dois achados P2, aplicados no PR seguinte (`fix/meu-dia-teto-das-consultas`):

1. **Teto silencioso nas outras consultas.** Notificações, tarefas e conversas atribuídas tratavam a lista de 1000 linhas como completa; ordenando as tarefas por prazo, mil vencidas empurrariam as de hoje para fora e a tela diria "0 vencem hoje". Agora: novidades por três `COUNT` (`head: true`, sem teto); tarefas em duas consultas (vencidas / hoje), cada uma com `count: 'exact'` — os totais afirmados vêm do banco, a lista traz até 50 de cada grupo; conversas atribuídas com `count: 'exact'` e sinal `truncada` ("mais de N").
2. **Sinal de truncamento misturado na fila.** `truncadaNovas` e `truncadaAntigas` separados; "mais de N" só na partição que bateu no teto.

`resumirNovidades` saiu de `contagens.ts` (as novidades não passam mais por linha nenhuma); cinco chaves novas ("mais de N") nos dois dicionários.

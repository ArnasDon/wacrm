@AGENTS.md

# CLAUDE.md — Convenções do projeto CB CRM

Regras "load-bearing" — coisas que já causaram (ou causariam) bug/drift e que
Claude precisa respeitar em qualquer máquina/sessão. Não é changelog nem doc de
feature: só entra aqui o que, se ignorado, quebra algo.

> **Este arquivo descreve o estado *intencional* do projeto e fica stale
> conforme o código muda. Antes de decidir com base em algo aqui, confirme
> contra a realidade (grep, leitura do arquivo, query no banco). Ao achar
> divergência, atualize o CLAUDE.md no mesmo PR. Nota mentindo é pior que
> ausência de nota.**

## O que é este projeto

Fork do CRM open source **wacrm** (`ArnasDon/wacrm`) — um CRM de WhatsApp
(Next.js 16 + Supabase + Meta Cloud API) com inbox compartilhado, contatos,
pipelines, broadcasts, automações e assistente de IA.

Estamos moldando este fork para uso interno do **CB Advogados**: um sistema de
**gestão de WhatsApp** com **integrações próprias**, adaptado às necessidades do
escritório. Partimos do código open source e construímos nossas customizações
por cima, continuando a receber melhorias e correções de bugs do original.

## Como trabalhar

- **Sempre planejar antes de agir.** Para qualquer tarefa não-trivial, expor o
  plano (passos, arquivos, riscos) antes de tocar em código. Pequenas dúvidas?
  Pergunte; não deduza.
- **Nunca deduzir nada.** Se faltar informação (rota, schema, regra de negócio,
  intenção), pergunte ou verifique no código/banco. Não inferir requisitos a
  partir de nome de variável ou contexto vago.
- **Trabalhar sempre numa branch derivada de `main`, nunca commitar direto no
  `main`.** No CB-CRM o `main` é o nosso trunk (não é mais espelho do upstream).
  Ver seção "Fork + upstream".
- **Caminho mais simples que cumpre o objetivo.** Sem overengineering: nada de
  abstração para futuro hipotético, nada de fallback para cenário impossível,
  nada de helper de uma chamada só. Três linhas parecidas > abstração prematura.
- **Preferir arquivos/módulos novos a reescrever o core.** Customização isolada
  reduz conflito futuro com o upstream (ver seção Fork + upstream).
- **Revisar 2x ao finalizar.** Antes de declarar pronto: (1) bugs/edge cases
  óbvios; (2) consistência com convenções do projeto e com o objetivo original.
  Reportar achados, mesmo que seja "nada encontrado".
- **Ações destrutivas exigem confirmação explícita.** Nunca executar sem o
  operador autorizar com clareza naquela conversa: `git push --force`,
  `reset --hard`, `branch -D`, `rm -rf`, `DROP TABLE`, `TRUNCATE`, `DELETE` sem
  `WHERE`, deletar arquivo/migration aplicada, sobrescrever credenciais, **push
  no `upstream`**. Aprovar uma vez ≠ aprovar para sempre.
- **Ao pedir confirmação destrutiva, explicar impacto em linguagem clara e
  não-técnica.** Traduzir o que acontece no mundo real: o que se perde, o que
  pode quebrar, se dá pra desfazer e como.
- **Subagentes em tarefas complexas → modelo forte.** Planejamento/revisão de
  escopo amplo → passar o modelo mais capaz. Pesquisa simples pode ficar no padrão.

## Estrutura

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres + Auth + Storage + RLS) · Meta Cloud API.

- `src/app/` — rotas do App Router. `(auth)` e `(dashboard)` são route groups;
  `api/` são as rotas de servidor (webhook do WhatsApp, cron de automações, API
  pública `/api/v1`). ⚠️ **É Next.js 16 com breaking changes** — ler o guia em
  `node_modules/next/dist/docs/` antes de escrever código (ver `AGENTS.md`).
- `src/lib/` — lógica de negócio por domínio (`whatsapp`, `webhooks`, `inbox`,
  `automations`, `flows`, `broadcast`, `contacts`, `ai`, `account`, `auth`,
  `api`, `api-keys`, `storage`, `supabase`, `dashboard`). É aqui que a maior
  parte das nossas integrações próprias deve viver, em módulos novos.
- `src/components/`, `src/hooks/`, `src/i18n/`, `src/types/` — UI, hooks, i18n e
  tipos compartilhados.
- `supabase/migrations/` — migrations SQL (ver seção própria). ⚠️ **Passou a
  existir um `supabase/config.toml`** (veio do upstream #498, junto com
  `.github/workflows/migrations.yml` e `supabase/ci/verify-schema.sql`): ele
  serve ao CI que replaya as migrations contra um Postgres limpo. **A CLI
  continua não-linkada** — o `config.toml` não muda a regra de nunca usar
  `supabase db push` (ver seção de migrations).
- `messages/` — dicionários i18n: `en.json` (referência) e `pt-BR.json` (o que
  o app usa hoje), os dois COMPLETOS e em paridade. Ver seção "i18n".
  ⚠️ O `ko.json` do upstream foi APAGADO em 2026-09-08: tinha 1.472 chaves
  contra 3.070, e `src/i18n/request.ts` carrega o arquivo se ele existir —
  então `NEXT_PUBLIC_APP_LOCALE=ko` entregava metade da tela como caminho
  de chave cru. Sem o arquivo, aquele valor cai em inglês. **Todo merge do
  upstream vai trazê-lo de volta: apagar de novo.**
- `mcp-server/` — subprojeto separado (tem `package.json` próprio) que expõe o
  CRM via MCP. Rodar `npm` dentro dele, não na raiz.
- `docs/` — a documentação ENTREGUE a quem instala o sistema: `README.md`
  (índice), `INSTALACAO.md` (do zero até o WhatsApp conectado), `ATUALIZAR.md`,
  `docker.md`, `public-api.md` e `mcp.md`. ⚠️ Até 2026-09-08 esta linha dizia
  que a doc de self-host vivia no site do projeto ORIGINAL — verdade enquanto
  éramos só um fork de uso interno, e mentira a partir do momento em que o
  código passou a ser instalado por outra pessoa. O `SETUP-PRODUCAO.md` foi
  apagado no mesmo dia (mandava instalar numa hospedagem abandonada e afirmava
  que o português não existia); quem o procurar acha o `INSTALACAO.md`.
  ⚠️ Os demais arquivos de `docs/` (`PLANO-*`, `INFRA-VPS`, `DEPLOY-VPS`,
  `EVOLUTION-LID-FIX`) são INTERNOS: descrevem a nossa operação e não vão para
  quem instala. Ver `docs/PLANO-produto-vendavel.md`, Fase 4.4.
  `EVOLUTION-LID-FIX.md` está **obsoleto** desde 09/09/2026 (a produção roda a
  Evolution 2.4 / Baileys 7); o estado atual da VPS e como recriá-la estão em
  `docs/INFRA-VPS.md`, e a stack da Evolution em `ops/vps/evolution-stack.yml`.
- `.env.local` — segredos (Supabase URL/keys, `META_APP_SECRET`,
  `ENCRYPTION_KEY`). Gitignored; **nunca commitar**. Modelo em
  `.env.local.example`.

## Fork + upstream (remotes e branches)

| Remote     | Aponta para                | Papel                                          |
| ---------- | -------------------------- | ---------------------------------------------- |
| `origin`   | `leonardocabralb/CB-CRM`   | Nosso repositório — para onde fazemos **push** e **PRs** |
| `upstream` | `ArnasDon/wacrm`           | Original — de onde só **puxamos** (read-only). **Nunca push. Nunca PR.** |

| Branch  | Função                                                                             |
| ------- | ---------------------------------------------------------------------------------- |
| `main`  | **Nosso trunk.** Contém todas as customizações do CB Advogados. É de onde saem as branches e para onde elas voltam. (Fica no `origin`/CB-CRM.) |

> **Regras de ouro (inegociáveis):**
>
> 1. **PRs só para o CB-CRM.** É **estritamente proibido** abrir Pull Request
>    para qualquer branch do repositório `ArnasDon/wacrm` (upstream). Todo e
>    qualquer PR tem como alvo **apenas** branches do `leonardocabralb/CB-CRM`.
> 2. **Branches novas saem só de `main`.** A criação de branch de
>    desenvolvimento ocorre **única e exclusivamente a partir de `main`**, dentro
>    do CB-CRM — nunca de outra branch, nunca do upstream.

Este é um **fork definitivo**: `main` deixou de ser espelho do upstream e passou
a ser o nosso trunk. Ainda incorporamos correções e melhorias do original, mas
por **merge pontual** (abaixo), não por espelhamento.

**Puxar atualizações do original** (o upstream muda `messages/en.json` e às vezes
o core, então trate como merge com conflito, não fast-forward):

```bash
git fetch upstream                        # busca novidades (não altera nada)
git checkout main && git pull origin main
git checkout -b chore/merge-upstream-AAAA-MM-DD   # branch de integração, a partir de main
git merge upstream/main                   # conflitos esperados (resolver)

node scripts/i18n-parity.mjs              # ⚠️ OBRIGATÓRIO — ver abaixo
npm run typecheck && npm run test

git checkout main
git merge chore/merge-upstream-AAAA-MM-DD  # traz o merge já resolvido e testado
git push origin main
```

⚠️ **Rodar `scripts/i18n-parity.mjs` depois de todo merge do upstream.** Se o
upstream adicionou chave nova em `messages/en.json`, ela **precisa** entrar no
`pt-BR.json` no mesmo merge: o fallback do next-intl é por arquivo, não por
chave, então chave faltando vira `MISSING_MESSAGE` e aparece crua na tela do
usuário. O script sai com código 1 nesse caso. Ele reporta erro de parse ICU
apenas como *aviso* — de propósito, porque isso quase nunca é bug de verdade
(ver seção i18n).

Conflitos só ocorrem quando o original e nós editamos **a mesma linha do mesmo
arquivo** — por isso preferir módulos novos a reescrever o core.

**Onde já divergimos do upstream** (checar a cada merge com
`git diff --stat upstream/main main`): `messages/en.json` é o campo de
batalha — o upstream mexe nele a cada feature e nós temos tradução por cima.
Também são nossos: `messages/pt-BR.json`, `CLAUDE.md`, `.gitignore`,
`scripts/`, as migrations `037_evolution_transport.sql`, `900_cb_*` e
`901`/`902`/`903_cb_*`, a **integração Evolution API** (`src/lib/whatsapp/transport/`,
`src/app/api/whatsapp/evolution/`, `src/components/settings/evolution-connect.tsx`,
`src/lib/whatsapp/inbound-store.ts`), o **multi-canal** (`src/lib/cb-channels/`,
`src/app/api/cb/`, `src/components/settings/cb-channels-panel.tsx`), a **infra de
deploy** (`Dockerfile`, `docker-stack.yml`, `.github/workflows/pipeline.yml`,
`docs/DEPLOY-VPS.md`) e os componentes que internacionalizamos (o upstream tem
string literal onde nós temos `t('chave')` — ao resolver, manter a nossa forma e
levar o texto novo dele para os **dois** dicionários).

**Decisões fixadas no merge de 2026-08-26** (releia antes do próximo merge, são
as que voltam a conflitar):

- **`resolveTemplateRow` (`src/lib/whatsapp/template-body.ts`) ganhou um 5º
  parâmetro nosso, `channelId`.** O catálogo da Meta é POR WABA. A versão do
  upstream busca só por `(account_id, name)`; sem o recorte, numa conta com dois
  números o atendente vê o preview de um modelo e o cliente recebe outro. Os
  **5** call sites passam o canal — conferir todos a cada merge.
- **Guarda de papel: adotamos o `requireRole` deles nas 5 rotas que ambos
  cobriam** (`send`, `react`, `broadcast`, `templates/submit`, `templates/sync`),
  com os mesmos níveis. O nosso `barrarPorPapel` **continua** nas 2 rotas que só
  nós cobrimos: `whatsapp/config` e `whatsapp/templates/[id]`. Se um merge
  futuro trouxer a versão deles crua nessas duas, um `viewer` volta a
  reconfigurar a conexão.
- **`src/components/inbox/message-bubble.tsx` e `message-thread.tsx` ficam
  NOSSOS, inteiros.** O visualizador de mídia do upstream (#467) foi descartado:
  o nosso `media-viewer.tsx` tem giro e zoom, que a versão deles não tem. Os
  arquivos `media-lightbox.tsx`, `message-media.tsx` e `lib/media/*` vieram no
  merge mas **não estão ligados** — se um merge futuro os religar, o inbox passa
  a ter dois visualizadores.
- ⚠️ **Uma major de Node só, e ela mora no `.nvmrc` (hoje `22`, o LTS).**
  Chegaram a existir TRÊS ao mesmo tempo — dev 24, CI 20, produção 22 — e isso
  já custou um vermelho real: o PR #66 passou na máquina do dev e reprovou no
  CI em `formatCurrencyShort`, porque cada V8 resolvia `notation: 'compact'`
  de um jeito (`R$ 900` vs `R$ 900,0`). Teste que toque **Intl, fuso ou
  colação** é loteria quando as majors divergem. Quem mexer nisso:
  - O CI **não escreve o número**: `node-version-file: .nvmrc`. Um merge do
    upstream traz o `node-version: <n>` cravado de volta — **trocar de novo
    pelo `node-version-file`**, senão o CI volta a poder divergir sozinho.
  - **Sobra um número duplicado, e é inevitável**: o `ARG NODE_VERSION` do
    `Dockerfile`. `FROM` não lê arquivo do contexto de build, então produção
    não tem como derivar do `.nvmrc`. Mudou um, muda o outro.
  - `engines` (raiz **e** `mcp-server/`) é `>=22.12.0` — piso **derivado**, não
    escolhido: `vite` e `rolldown` exigem `^20.19.0 || >=22.12.0`, e o ramo do
    20 caiu. Não baixar sem conferir os `engines` das dependências.
  - `packageManager: npm@10.9.9` é a linha de npm que o Node 22 embarca. Subir
    a major do Node sem subir esse pin volta a descasar CI e Dependabot.
  - Máquina nova: `nvm use` na raiz. Quem usa **asdf** precisa de
    `legacy_version_file = yes` no `~/.asdfrc` para ele respeitar o `.nvmrc`.

- ⚠️ **Um workflow só: `.github/workflows/pipeline.yml`.** O `ci.yml` e o
  `migrations.yml` eram DO UPSTREAM e foram removidos; as três etapas
  (verificar → migrations → deploy) viraram jobs de um arquivo nosso, com o
  `deploy` dependendo de `verificar`. Antes os três rodavam **em paralelo** no
  push do `main`, e o cabeçalho do deploy dizia "after CI passes" sem que
  existisse `needs:` — um CI vermelho não impedia a publicação. **Todo merge do
  upstream vai trazer `ci.yml` e `migrations.yml` de volta: apagar de novo**, ou
  as etapas passam a rodar duas vezes por push.
  ✅ **O replay de migrations SEGURA o deploy desde 2026-09-08**:
  `needs: [verificar, migrations]`. Durante meses foi só `[verificar]`, e
  migration vermelha no `main` publicava assim mesmo (medido em
  2026-08-31) — a etapa era SINAL porque as migrations históricas ainda
  carregavam a dívida do banco vazio. A dívida foi paga (as duas regras
  estão na seção de migrations), a etapa vinha verde, e manter o portão
  aberto só preservava o buraco: quem descobriria a migration quebrada
  seria a PRÓXIMA instalação, que constrói o banco do zero e não tem
  produção antiga para disfarçar. Há pino em
  `.github/workflows/pipeline.test.ts` — tirar `migrations` do `needs`
  reprova o CI.

- **`src/i18n/messages.test.ts` checa `pt-BR`, não `ko`.** O upstream o escreveu
  para `ko`, que não servimos; deixar assim daria um teste permanentemente
  vermelho sobre um idioma que ninguém usa. Ao mesclar, ele volta com `['ko']`
  — e junto volta o `messages/ko.json`, que foi apagado (ver a nota em
  "Estrutura"). Apagar os dois de novo.

**Decisão fixada no merge de 2026-09-05** (upstream #532, o upload de CSV do
assistente de broadcast — 1 PR, o único desde o merge anterior):

- **`upsertCsvContacts` (`src/hooks/use-broadcast-sending.ts`) fica com os
  DOIS lados.** Do upstream: o CSV passa a casar com o contato pelo número
  NORMALIZADO (`.in('phone_normalized', keys)`, a coluna gerada da 022, mesma
  chave do `normalizeKey`) em vez do texto cru — "+55 (11) 9…" no arquivo agora
  acha o "5511 9…" da base em vez de tentar inserir de novo e morrer em 23505.
  Nosso: o contato criado grava `user_id: ownerUserId` com falha fechada
  (`if (!ownerUserId) throw`), nunca `user.id` — `contacts.user_id` CASCADEia
  de `auth.users`, e o offboarding do operador levaria os contatos do CSV com
  conversas e mensagens. A versão do upstream grava `user.id` ali, e o próximo
  merge vai trazê-la de volta. Pino:
  `src/hooks/use-broadcast-sending.dono-do-csv.test.ts`.

⚠️ **Vários arquivos do upstream ganharam mudanças NOSSAS para o multi-canal —
cuidado no merge.** Ao mesclar upstream, manter os nossos trechos e não deixar o
upstream sobrescrevê-los:

| Arquivo do upstream | O que é nosso |
| --- | --- |
| `src/lib/whatsapp/send-message.ts` | resolve o canal, carimba `channel_id`, devolve `channelId` no resultado, busca o template **filtrando por canal**, e os dois parâmetros da agendada (925): `channelId` (exige aquele canal, **falha fechada**) e `pauseFlows` |
| `src/components/inbox/message-composer.tsx` | o **acervo** no menu do clipe (953) e o botão de **gravar voz** fora dele, à direita da caixa — um merge que traga o menu do upstream cru devolve a gravação para dentro do menu e some com o acervo. Mais a anotação interna (918) e o **agendamento** (925): o relógio abre um seletor, e com hora escolhida o `handleSend` DESVIA antes da janela de desfazer. Mais a 932: `sendDraft` desvia igual (anexo agendado), o seletor virou `<SeletorDeHorario>` de módulo — reusado dentro do `MediaDraftPreview`, que SUBSTITUI o compositor — e `entreguesRef` impede a limpeza de desmonte de apagar arquivo que já é de uma agendada. Mais o item **Executar automação** no menu + (955), atrás da prop opcional `onExecutarAutomacao` — o dialog mora no FIO, não aqui |
| `src/lib/whatsapp/send-message.ts` (2ª linha nossa) | a 932 separou `evolution_rejected` (4xx: a Evolution recusou, nada saiu) de `evolution_error` (tempo esgotado/5xx: pode ter saído). Só o segundo vira `entrega_incerta` |
| `src/lib/whatsapp/send-message.ts` (3ª linha nossa) | `media_filename` no INSERT (969) — o `filename` já chegava na função e ia só para o WhatsApp; sem ele a bolha do que NÓS enviamos cai no rótulo genérico |
| `src/app/api/whatsapp/webhook/route.ts` (2ª linha nossa) | `mediaFilename` no tipo de retorno da extração, no `empty`, no case `document` e no upsert (969). ⚠️ O `contentText` continua `caption \|\| filename` — não "simplificar" removendo o filename de lá: a lista de conversas e a busca já leem essa coluna há meses |
| `src/components/inbox/message-bubble.tsx` (além de ser nosso inteiro) | o case `document` usa `mediaFilename(message)` e mostra a legenda embaixo só quando ela DIFERE do nome; `nomeDeArquivo` delega para a cascata em vez de derivar o basename cru |
| `src/components/inbox/message-bubble.tsx` (canal, 2026-09-02) | a prop `canal` (nome + cor) no lugar do antigo `channelLabel`: o rótulo embaixo da mensagem ganhou a bolinha da cor, 10px (era 9) e teto de 9rem (era 7). ⚠️ Uma versão desta nota dizia que em 7rem os nomes truncavam "no ponto em que ainda são iguais" — MEDIDO em 02/09: os seis nomes da conta cabem em 7rem até a 10px (o mais longo, "Trabalhista - Comercial", dá 110px); o 9rem é folga, não conserto. A cor vive na BOLINHA, não no texto: a bolha da equipe é `bg-primary`, violeta nesta conta. Uma trilha de 3px na borda foi feita e DESCARTADA pelo operador na hora ("não gostei dessa borda colorida") |
| `src/components/inbox/message-thread.tsx` | além do fio intercalado, renderiza a faixa `ScheduledBar` logo acima do compositor e guarda o contador que a liga ao compositor |
| `src/components/inbox/message-thread.tsx` (rolagem, 2026-09-01) | ⚠️ `coladoNoFimRef` + `onScroll` guardam o auto-scroll, e o spinner só entra quando a CONVERSA muda (`conversaCarregadaRef`). Sem os dois, voltar de uma aba nova — o `visibilitychange` incrementa o `resyncToken` — perdia a posição de quem lia o histórico E o empurrava para o fim, três vezes por retorno (mensagens, eventos e notas chegam em buscas próprias). O `saltoAtivoRef` NÃO cobre isso: é armado só pelo salto da busca, e `liberarSalto` está no `onWheel`, então rolar à mão o DESLIGA. A guarda é re-armada em `publicarMensagemOtimista` e ao acrescentar nota — senão o autor manda e não vê |
| `src/app/api/whatsapp/webhook/route.ts` | carimba `channel_id` na entrada — **no próprio upsert** desde 10/09/2026 (o UPDATE separado `stampMessageChannel` engolia falha e deixava mensagem de cliente sem número, e a janela de 24h por número a leria como vinda de outro número; o mesmo no `persistInboundMessage` da Evolution). Os dois gravam por `gravarComCanal` (`stamp.ts`), que repete SEM canal quando a conexão foi apagada no meio (23503 da FK `messages_channel_id_fkey`) — senão a mensagem do cliente se perderia, porque o provedor já recebeu 200; há pino estrutural em `stamp.chamadores.test.ts`; varre `cb_channels` na verificação (GET); escopa o ACK por canal; passa `channelId` a flows/automações/IA |
| `src/lib/whatsapp/inbound-store.ts` | idem, no lado Evolution |
| `src/lib/automations/engine.ts` | `channelInScope`, condição `channel`, canal de saída por passo, e o `create_deal` que virou chamada a `createDeal` com a checagem "um card por contato" ANTES do insert — o índice da 911 é parcial (`source = 'channel'`) e não barra o insert da automação, então sem a checagem nasce card duplicado. Mais o `rotuloDoDisparo` opcional de `runAutomationById` (955): a execução manual da conversa grava `'manual'` no log — sem ele, o registro diria que outra automação chamou |
| `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts` (×2) e `src/lib/whatsapp/send-message.ts` | a chamada a `routeContactToPipeline`. ⚠️ São **QUATRO** call sites: os dois de ingestão (não há função compartilhada de abrir conversa — enxertar só num faz a feature valer só num transporte, e produção roda Evolution), o `persistDeviceMessage` do celular pareado e o núcleo de envio. Ver "Quem abre negócio" abaixo |
| `src/lib/whatsapp/inbound-store.ts` (`persistDeviceMessage`) | o `followConversationChannel` que aponta a conversa para o número por onde a EQUIPE falou. Sem ele a conversa nasce com `channel_id` nulo e o CRM responde pelo canal PADRÃO — o advogado aborda pelo Jurídico e o sistema responderia pelo Comercial |
| `src/lib/flows/engine.ts` | `findEntryFlow` por canal, `flow_runs.channel_id`, try/catch nos nós interativos, e o parâmetro opcional `substituicao` de `startFlowForContact` (955): o start manual carimba a run substituída como gente (`stopped_by_agent`/`replaced_by_agent`), não como regra |
| `src/lib/ai/{auto-reply,config,knowledge,usage}.ts` | agente por canal, interruptor, RAG por canal |
| `src/lib/whatsapp/broadcast-core.ts` + rotas de template | `resolveMetaChannel` no lugar do espelho |
| `src/lib/api/v1/conversations.ts`, `src/lib/api-keys/scopes.ts` | `channel_id` nos serializers, escopo `channels:read` |
| `src/components/automations/automation-builder.tsx`, `src/components/flows/{flow-builder,flow-editor-state}.tsx` | escopo de canal editável (multi-select / select), canais no contexto do editor, validação de canal no cliente |
| páginas de `automations`, `flows`, `broadcasts`, `dashboard` | etiqueta e filtro de canal, coluna de canal nos históricos, filtro do painel |
| `src/components/broadcasts/step{1,4}-*.tsx`, `src/hooks/use-broadcast-sending.ts` | canal escolhido no passo 1, `channel_id` no corpo da API e na linha de `broadcasts`. No hook, mais: `marcarDestinatario` (update conferido pelo retorno, #15) e o `ownerUserId` do `upsertCsvContacts` (ver a decisão do merge de 2026-09-05 acima) |
| `src/components/settings/template-manager.tsx` | seletor de WABA para criar/sincronizar, etiqueta de canal por modelo |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx` | canal no primeiro contato e a seção/aba **Histórico** (912). (A linha "canal da conversa" que o painel do inbox exibia foi REMOVIDA em 2026-08-29 a pedido do operador — o seletor do cabeçalho do fio já responde isso.) No detail view a `TabsList` ganhou `flex-wrap` com a altura **prefixada** (`group-data-horizontal/tabs:h-auto` + `[&>button]:h-auto`, NUNCA `h-auto` cru — ver a armadilha do tailwind-merge abaixo; um merge que "simplifique" para `h-auto` quebra a tela de novo) — com 5 abas ela já estourava a largura do painel e escondia "Negócios" |
| `src/components/inbox/message-thread.tsx` | `groupMessagesByDate` virou `groupTimelineByDate`, sobre mensagens **e** eventos do lead intercalados (`intercalar`), e o laço de render passou a ramificar em `item.evento` |
| `src/components/inbox/conversation-list.tsx` | ⚠️ **praticamente reescrito** (924): todo o recorte saiu para `src/lib/inbox/filtros.ts`, a barra de filtros virou `<InboxFilters>`, e cada linha ganhou a estrela de favoritar. Num merge do upstream, esperar conflito grande e **manter a nossa versão**, levando só o que for novo dele. Mais o `onTermoDeBusca`, que espelha o termo assentado para a página. Mais o menu de **filtros salvos** (967/968): o hook, os catálogos que dão nome aos ids, o `limparOrfaos` do aplicar e a semente do filtro padrão |
| `src/components/inbox/message-thread.tsx` (canal, 2026-09-02) | o `SeparadorDeCanal` entre trechos, a faixa de divergência colada no compositor, a bolinha de cor no gatilho e nos itens do seletor de canal, e o `Fragment` que embrulha separador + `LinhaDoFio` (ex-`LinhaDaMensagem`; a `key` mudou de lugar) |
| `src/components/inbox/message-thread.tsx` | o **salto da busca**: `<LinhaDoFio>` (ex-`LinhaDaMensagem`) envolvendo as duas formas de bolha (a comum e o aviso de sistema do grupo) E a anotação intercalada, a faixa "2 de 5" com ↑/↓, os efeitos de centralizar/suprimir e o `saltoAtivoRef`. Mais (09/09/2026) a **busca dentro da conversa** (lupa do cabeçalho, `buscaLocal`/`termoEfetivo`) e o **salto PONTUAL** (`useSaltoPontual`, UMA mecânica para o clique na citação do PR #179 e para o "Ver na conversa" do painel — `destaqueDaCitacao`/`destaqueDoPainel`) — ver a seção própria |
| `src/components/inbox/conversation-list.tsx` (09/09/2026) | o interruptor **"Buscar também dentro das mensagens"** (`buscarNasMensagens`, desligado por padrão) e o placeholder que muda com ele; `useBuscaEmMensagens` ganhou o 2º parâmetro `ativa` |
| `src/components/inbox/conversation-list.tsx` (canal, 2026-09-02) | a prop `corDoCanalDaLinha` do `ConversationItem` e a bolinha antes do nome — bolinha, e não trilha, porque a borda esquerda já é da seleção |
| `src/components/inbox/conversation-list.tsx` (janela, 12/09/2026) | a AMPULHETA da janela de 24h da Meta (991): a prop `canalDeSaidaDaLinha` do `ConversationItem`, `canaisPorId`/`canalPadrao` no pai, o `tTimer` da linha e `COR_DA_AMPULHETA` — ver a seção "Selo da janela de 24h na lista" |
| `src/app/(dashboard)/inbox/page.tsx` | espelha o termo da busca da lista para o fio — são irmãos, e a página é o único caminho entre eles. Mais o escritor da presença por conversa (963): `useMarcarConversaAberta(activeConversation?.id)` — a página é a dona da seleção |
| `src/components/inbox/message-thread.tsx` (955/963) | monta o `<ExecutarAutomacaoDialog>` (é o fio que tem o contato; o canal passado é `conversation.channel_id ?? null` — o PR #74 trocou o `activeChannel` resolvido pelo cru DE PROPÓSITO, para a checagem de escopo da rota falhar aberta igual ao motor em conversa sem canal; grupo fica de fora) e os avatares `<AvataresNaConversa>` no cabeçalho, alimentados por `useQuemVeAConversa` |
| `src/components/inbox/message-thread.tsx` (#84) | a **janela de 24h**: a regra saiu para `src/lib/inbox/janela-24h.ts` (puro, com teste) e os TRÊS caminhos de envio (texto, mídia, interativa) passam por `janelaFechadaAgora()` antes do `fetch` — o portão lê o RELÓGIO no disparo, nunca `sessionInfo.expired` (um `useMemo`: recomputa no tique de 1 min da badge, nunca no instante exato do disparo). Um merge que traga o `sessionInfo` inline do upstream devolve os três buracos de uma vez. Desde 10/09/2026 a janela é **POR NÚMERO**: os dois relógios passam `canalDaJanela` (= `activeChannel`, id + transporte, o mesmo do `expected_channel_id`) — parâmetro OBRIGATÓRIO em `janelaFechada`/`minutosRestantes`, com pino estrutural cobrando o MESMO canal nos dois —, grupo fica fora (`!ehGrupo` em `janelaDe24h`), e a etiqueta fala minutos na última hora (`restanteParaExibir`; antes o ramo de minutos era código morto e a última hora aparecia inteira como "1h restantes") |
| `src/lib/dashboard/queries.ts`, `src/components/dashboard/metric-card.tsx` | filtro por canal (parcial) e marca "conta inteira" |
| `src/app/api/automations/[id]/duplicate/route.ts` | copia `channel_ids` (sem isso a cópia vira irrestrita) |
| `src/app/api/cb/channels/[id]/route.ts` (DELETE) | barra a exclusão quando há agendada na FILA e limpa o acervo — a FK da 925 é RESTRICT |
| `src/components/pipelines/pipeline-board.tsx`, `src/app/(dashboard)/pipelines/page.tsx` | o painel por etapa (Fase 5): o raio com contador no cabeçalho da coluna e a carga das automações de funil. Mais o funil-com-conversas (PR #71): botão de conversas por coluna, `navegarParaInbox`/restauração de rolagem no board (quadroRef vem da página), `useChannels` içado, select `DEAL_SELECT_DO_QUADRO` com plano B, popover de campos |
| `src/components/pipelines/deal-card.tsx` | ⚠️ **reestruturado inteiro no PR #71 — manter a NOSSA versão** (como `conversation-list.tsx`): wrapper + botão do corpo (abre a CONVERSA) + lápis IRMÃO (edita; button aninhado é inválido), campos por `CamposDoCard`, etiquetas/última mensagem/não lidas, `memo` + canais por prop, barra de cor com `pointer-events-none` |
| `src/components/pipelines/deal-form.tsx` | além do que a linha antiga já dizia: o link "ver conversa" prefere a conversa do CONTATO (fallback no vínculo da 910), usa `urlDoInbox` e as props `origemFunil`/`aoIrParaConversa` da jornada do funil |
| `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/conversation-list.tsx`, `inbox-filters.tsx` | os params `?etapa=` (semeia o filtro de etapa UMA vez) e `?de=funil` (faixa "Voltar ao funil") — os `router.replace` usam `urlDoInbox`, que preserva `de` e derruba `etapa` DE PROPÓSITO; na lista, `etapaInicial` + `etapasResolvidas` e o recorte de etapa gateado por `etapasUsaveis`; nos filtros, o fallback da pastilha virou `labelStage` (era "Qualquer etapa" sobre filtro ativo) |
| `src/app/(dashboard)/automations/new/page.tsx` | o `?stage=` que faz a automação nascer com o gatilho de funil já apontando para a etapa clicada |
| `src/lib/automations/trigger-meta.ts` | `formatRelative` passou a usar `Intl.RelativeTimeFormat` e a receber o texto de "nunca" — devolvia `5m ago`/`never` em inglês nas três telas |
| `src/components/contacts/contact-detail-view.tsx` (987) e `src/components/inbox/painel/painel-do-contato.tsx` | a seção `<ReunioesTranscritasDoContato>` dentro da aba Reuniões, abaixo de `<ReunioesDoContato>` — na ficha E na 7ª aba só-ícone (`reunioes`) do painel da conversa, montada em 09/09/2026 a pedido do operador para a transcrição estar à mão durante o atendimento. Um merge que traga a aba crua do upstream apaga o histórico de transcrições da ficha |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx`, `src/app/(dashboard)/notifications/page.tsx`, `src/components/layout/{sidebar,header}.tsx`, `src/app/(dashboard)/contacts/page.tsx`, `src/lib/rate-limit.ts` | as tarefas (944): 7ª aba na ficha (com `[&>button]:flex-none` na TabsList), seção na barra da conversa, ícones/navegação dos tipos `task_*` no sino (o `TYPE_ICON` é exaustivo — merge que trouxer tipo novo sem ícone quebra o typecheck), item "Tarefas" com etiqueta realtime no menu, deep link `?contact=`, bucket `tarefa` |
| `src/lib/ai/types.ts`, `generate.ts`, `defaults.ts`, `config.ts`, `usage.ts`, `providers/` | o TERCEIRO provedor (`gemini`, 941) e o modo `'radar'` no log de uso — o upstream conhece só openai/anthropic. `structured.ts` e `providers/gemini.ts` são arquivos NOSSOS |
| `src/components/settings/ai-config.tsx`, `src/app/api/ai/config/route.ts` | a opção Gemini no seletor e na validação do provider |
| `src/components/settings/cb-channels-panel.tsx`, `src/app/api/cb/channels/[id]/route.ts`, `src/lib/cb-channels/repo.ts` | o toggle `radar_enabled` por canal (dialog, PATCH allowlist e SAFE_COLUMNS) |
| `src/components/layout/sidebar.tsx`, `header.tsx`, `src/middleware.ts` | a aba `/radar` (item de navegação, título do cabeçalho e rota protegida) |
| `src/lib/api-keys/scopes.ts`, `docs/public-api.md`, `src/components/settings/api-keys-settings.tsx` | os doze escopos das features do fork (tarefas/agendadas/negócios/reuniões/anotações/campos personalizados) e a rolagem da lista no diálogo — o upstream tem só os 8 originais |
| `src/lib/deals/create-deal.ts` | devolve `deal` (a linha inserida), não só `ok/created` — a rota v1 serializa a resposta a partir dele |
| `src/components/settings/settings-sections.ts`, `settings-chip.tsx`, `src/app/(dashboard)/settings/page.tsx` | a seção `integracoes` no rail e a variante `err` (vermelha) do chip |
| `src/lib/ai/types.ts`, `config.ts`, `structured.ts`, `defaults.ts`, `src/lib/cb-radar/worker.ts`, `src/app/api/ai/config/route.ts` | o modelo do Radar separado do modelo de chat (946): `radarModel` no tipo e em `CONFIG_COLUMNS`, o parâmetro `model` do `generateStructured`, `AI_PROVIDER_MODELS`, e a validação do modelo do Radar no save |
| `src/components/settings/ai-config.tsx` | `<datalist>` de sugestão no campo Modelo e a frase de escopo com link para Integrações |
| `src/app/(dashboard)/dashboard-shell.tsx` (Meu dia, 12/09/2026) | envolve o layout INTEIRO (menu, cabeçalho, página, heartbeat) na `<PortaDeEntrada key={user.id}>`, abaixo do `if (!user) return null` — nunca renderizar pedaço do app fora dela; e o "Loading..." traduzido (`DashboardShell.loading`) |
| `src/hooks/use-auth.tsx` (Meu dia) | `sessionId` no contexto (o `session_id` do token, publicado no MESMO passo que `user`, no init e no listener) e o `signOut({ scope: "global" })` por escrito — além do que já era nosso (lente de simulação, perfis, `resolvedUserIdRef`) |
| `src/components/layout/header.tsx` (Meu dia) | `"/agenda": "agenda"` no `pageTitles`, DEPOIS de `/agendadas` (o mapa casa por `startsWith` na ordem de inserção) |

⚠️ **Qual NÚMERO nesta conversa: o critério é a CONVERSA, nunca a conta.**
`src/lib/inbox/canais-do-fio.ts` e `src/lib/cb-channels/cores.ts` (puros, com
teste), o `SeparadorDeCanal` e a faixa de divergência em `message-thread.tsx`,
o rótulo com bolinha embaixo da mensagem e a bolinha da linha da lista.
Nasceu de uma medição: em
produção, **4 das 228** conversas correm por mais de um número (2 delas
grupos), e o rótulo de canal acendia em TODAS. O que morde código novo:

- ⚠️⚠️ **GRUPO FICA DE FORA, e não é conservadorismo — lá o carimbo NÃO é
  escolha do cliente.** Com os dois números dentro do mesmo grupo, o WhatsApp
  entrega a mensagem às duas instâncias Evolution, o
  `UNIQUE (conversation_id, message_id)` descarta a segunda, e o `channel_id`
  gravado é o do webhook que CHEGOU PRIMEIRO. Medido no grupo `f68d7fe3`: 14
  mensagens "Comercial" e 15 "Jurídico" alternando por corrida de rede.
  Pintar isso afirmaria uma escolha que ninguém fez. Em grupo quem responde
  "por qual número" é `cb_groups.channel_id`, e só no cabeçalho.
- ⚠️ **O gatilho é `fioMulticanal`, não `channels.length >= 2`.** O critério
  antigo era a CONTA: o rótulo cinza de 9px aparecia em 98% das conversas,
  onde não informa nada, e por isso o olho aprendia a ignorá-lo justamente
  nos 4 casos que decidem a resposta. Presente demais é o mesmo que ausente.
  (Uma versão desta nota culpava o truncamento em 7rem; medido em 02/09, os
  nomes cabiam — o defeito era a onipresença, não a largura.)
- ⚠️⚠️ **A cor sai da ordem de `created_at`, calculada DENTRO de
  `coresPorCanal` — nunca do índice do array recebido.** `listChannels`
  ordena `is_default DESC, created_at ASC`: sem o sort próprio, marcar outra
  conexão como padrão a joga para a frente e **repinta todas as conversas do
  escritório de uma vez**. Não estoura em lugar nenhum e passa em revisão.
  Conexão nova entra no fim e não mexe em ninguém; apagar uma recolore as
  posteriores (aceito — apagar canal já anula o `channel_id` das mensagens).
- ⚠️ **As classes da paleta são LITERAIS** (`'bg-violet-500'`), nunca
  interpoladas: o Tailwind varre o fonte atrás de strings e não executa
  código, então `bg-${cor}-500` simplesmente não é gerada e a bolinha
  nasce transparente, sem erro nenhum. Há teste com regex cobrando a forma.
- ⚠️ **Mensagem SEM carimbo não abre nem fecha trecho de canal.** São 117
  conversas com histórico anterior ao multi-canal (mais o acervo do canal
  apagado, cujo `channel_id` foi anulado): tratá-las como trecho próprio
  desenharia um separador que não tem nome para escrever, e atribuí-las ao
  canal vizinho seria inventar.
- ⚠️⚠️ **A janela de 24h da Meta também é POR NÚMERO** (`janela-24h.ts`,
  10/09/2026). A Meta só conta a mensagem que o cliente mandou ao número
  oficial por onde se vai responder; contando o fio inteiro, quem escreveu há
  2h só pelo número por QR Code deixava a etiqueta em "22h restantes" e o
  compositor livre, e a Meta recusava o texto (131047). A regra recebe o
  canal de SAÍDA (id + transporte) e conta a mensagem do cliente carimbada
  com ele. ⚠️⚠️ Sem carimbo, ao contrário do separador acima, a regra decide
  pela PROCEDÊNCIA: conta se veio pela API da Meta (`message_id` com
  `wamid.`) e a saída é Meta — é o carimbo que faltou (canal resolvido nulo,
  ou histórico de antes do multi-canal) —, e NÃO conta se veio da Evolution.
  Não contar nada trancava o compositor sobre cliente que acabou de escrever,
  e compositor trancado não tem saída na tela (Codex, PR #192); contar tudo
  reabria o 131047. Canal de saída NULO — a conta sem conexão nenhuma, o
  legado de número único — conta o fio inteiro, como antes. "Fio vazio =
  aberta" (PR #79) continua valendo para o FIO inteiro, nunca para o recorte
  do canal. **Grupo não tem janela** (`ehGrupo` em `janelaDe24h`): é só
  Evolution, e o `activeChannel` dele cai no canal padrão.
- ⚠️ **A cor vive na BOLINHA em toda parte; texto colorido só no separador.**
  A bolha da equipe é `bg-primary` (violeta nesta conta): nome na cor do
  canal ficaria ilegível justamente no canal violeta, e o mesmo rótulo
  teria contraste diferente conforme o lado do fio. A bolinha se sustenta
  sobre qualquer fundo. Na LISTA a razão é outra e se soma: a borda esquerda
  da linha já é da SELEÇÃO (`border-l-2 border-primary` no botão), e uma
  trilha ali disputaria a faixa. Na lista o canal sai de `canalDaConversa()`,
  nunca de `conversation.channel_id`: em grupo aquela coluna é sempre nula.
- ⚠️ **A faixa de divergência cala com `canalDeSaida` nulo, e esse é o gate
  de carregamento.** `activeChannel` só resolve depois do `useChannels`, e um
  aviso montado sobre lista vazia nomearia a divergência errada — mesma
  família da badge "Expirada" que piscava no cabeçalho (2026-08-31).
- ⚠️⚠️ **A faixa só aparece com a conversa FIXADA (`channel_pinned`).**
  Solta, a conversa SEGUE o cliente: o `inbound-store` carimba a mensagem e
  só depois atualiza a conversa, em duas escritas, e o realtime entrega
  nessa ordem — a mensagem no número B está na tela enquanto `activeChannel`
  ainda é A. Divergência sem pino é trânsito (corrige-se em milissegundos)
  ou `follow` que falhou (raro; a próxima mensagem conserta). A faixa ali
  PISCARIA a cada troca legítima, e o botão, clicado nesse instante, fixaria
  B e desligaria o seguimento em silêncio (achado do Codex no PR #105). Com
  pino a divergência é permanente e escolhida — toda resposta cai noutra
  conversa no celular do cliente — e é para ela que a faixa existe. Não
  exige `fioMulticanal`: fixada em A com o cliente só em B, o fio tem UM
  canal. O botão re-fixa no número do cliente; "Automático" no menu solta.
- ⚠️ **A mensagem otimista nasce carimbada com o canal da tela, e a rota
  `/api/whatsapp/send` devolve `channel_id`** (o núcleo já o devolvia; a
  rota descartava). Sem os dois, em conversa mista a resposta enviada por B
  nascia sem carimbo e ficava desenhada no trecho de A até o realtime trocar
  a bolha — e realtime atrasado a deixava lá (Codex, PR #105). Quem criar
  um 5º caminho de envio repete os dois: o carimbo na otimista e o
  `marcarEnviada` com o `channel_id` da resposta.
- **Informativo, não bloqueante** (decisão do operador, 2026-09-02): com 2
  casos em 90 conversas, confirmar a cada envio custaria um clique em toda
  conversa mista para prevenir um erro que a faixa já torna visível.
- **A cor é DERIVADA, não configurável.** Se um dia o operador quiser mandar
  nela, o lugar é uma coluna `cor` em `cb_channels` com queda para
  `PALETA_DE_CANAIS` — e aí entra no `CB_CHANNEL_SAFE_COLUMNS`, senão salva e
  some no reload.
- **O gatilho do seletor do cabeçalho trocou o ícone de transporte pela
  bolinha da cor** (o transporte segue no menu): numa conta 100% Evolution
  aquele ícone é o mesmo em todas as linhas e não informa nada, enquanto a
  cor é o que amarra o cabeçalho aos rótulos das bolhas.

⚠️ **A visão "Automações" do funil (grade estilo Kommo) é desenho de dado, não
tela nova.** `src/lib/automations/grade-do-funil.ts` e
`descrever-passo.ts` (puros, com teste), `por-etapa.ts` (a classificação),
`src/components/pipelines/automations-board.tsx`. Quem for mexer em recorte de
automação por etapa mexe nos módulos, não dentro do componente.

⚠️ **A LARGURA DO CARTÃO É O `trigger_config.stage_ids`.** "Expandir" grava
mais etapas; sem etapa nenhuma o cartão atravessa o quadro. Não há coluna de
banco para isso e não deve haver. O que morde código novo:

- ⚠️ **Automação com `trigger_config.stage_ids` VAZIO dispara em TODA etapa**
  (`engine.ts`, `triggerMatches`). Uma tela que listasse só quem NOMEIA a
  coluna diria "nada acontece nesta etapa" enquanto o motor dispara a cada
  card que entra. É o cartão de largura total, em roxo.
- ⚠️ **Etapas NÃO vizinhas viram VÁRIOS cartões.** Um retângulo da coluna 1
  até a 3 afirmaria que a regra vale na 2 — e ela não vale. Cada trecho
  contínuo é um cartão, e os dois carregam o aviso "também vale em outras
  etapas", senão parecem automações diferentes.
- ⚠️ **`descrever-passo.ts` devolve CHAVE + valores, nunca texto pronto**, e há
  teste lendo `messages/*.json` que COBRA uma chave por tipo de passo. Sem
  ele, adicionar um passo ao motor sem tocar no dicionário põe
  `Pipelines.automacoes.resumo.send_x`, cru, dentro do cartão — o fallback do
  next-intl é por arquivo, não por chave.
- **Id órfão vira "(apagado)", nunca o UUID**: impresso, o operador o lê como
  se fosse o nome da tag.
- **A consulta de automações NÃO filtra por funil**, de propósito: a regra
  irrestrita vale para toda etapa de todo funil, e filtrar a esconderia.
- ⚠️ **São DUAS listas de etapa com significados opostos**, e trocá-las é o
  erro fácil: `trigger_config.stage_ids` é "para qual etapa o card tem de
  ENTRAR"; `automations.stage_ids` é "em qual etapa o contato precisa ESTAR"
  (o escopo). O gatilho alcançar a etapa e o escopo barrá-la é estado
  alcançável pela tela — trocar o tipo de gatilho para "mudou de etapa"
  esconde o seletor de escopo mas **não limpa o valor**. Daí o grupo "Nunca
  dispara aqui": ligada, configurada e incapaz de rodar.
- ⚠️ **Criar pela grade preenche só o GATILHO, nunca o escopo.** Preencher os
  dois funciona hoje e vira armadilha amanhã — é exatamente como se fabrica
  uma automação morta.
- **A etiqueta do raio conta só o que dispara E está LIGADO.** Contar a pausada
  põe um número numa coluna onde nada acontece, e o operador vai caçar defeito
  no motor.
- **Há teste comparando `classificarNaEtapa` com o `triggerMatches` de
  verdade**, importado do `engine.ts`. Se a regra do motor mudar, ele quebra.
- ⚠️ **Dois TIPOS de cartão desde 07/09/2026 (`CartaoDaGrade.tipo`):**
  `gatilho` (largura = `trigger_config.stage_ids`, "dispara ao entrar") e
  `chegada` (automação de OUTRO gatilho que LEVA o card para a etapa — a
  coluna é o `stage_id` do `move_deal_stage`/`create_deal`, sempre 1
  coluna, sem "expandir": mudar a etapa é editar o passo). Automação de
  gatilho de etapa NÃO ganha cartão de chegada — já tem o do gatilho, e
  uma esteira de 5 regras viraria 10 cartões. `contarAtivasNaEtapa` (o
  raio do Kanban) continua contando só o que DISPARA na etapa.
  Gatilho SEM call site (`GATILHOS_SEM_DISPARO`) não ganha cartão de
  chegada nem de gatilho — regra que não roda não é desenhada (Codex, PR #131).

⚠️ **Mensagem agendada (925/926): NADA dispara sozinho.** A tabela guarda a
linha; quem a transforma em mensagem é um agendador EXTERNO batendo em
`/api/cb/scheduled/cron`. Sem ele, `cb_scheduled_messages` só enche — o mesmo
destino de `broadcasts.scheduled_at`, viva e sem leitor desde a 001. O que
morde código novo:

- **Agendar não passa pela janela de desfazer.** Ela tem três saídas que
  disparam na hora (trocar de conversa, desmontar, Enter de novo); um "modo"
  pendurado no botão Enviar mandaria em 3s a mensagem marcada para amanhã. O
  desvio é a primeira coisa do `handleSend`, antes de qualquer `setPendente`.
- **`failed` NÃO quer dizer "não saiu".** `db_error` e tempo esgotado da
  Evolution estouram DEPOIS de o WhatsApp aceitar — daí `entrega_incerta`
  (926). Nada reenvia a partir dela nem de `sending`: retentar manda duas
  vezes ao cliente. Quem criar outro caminho de reenvio precisa da mesma
  guarda (`podeDispararAgora`).
- **O canal é FIXADO no agendamento e falha fechado.** O núcleo degrada em
  silêncio para o padrão da conta, e numa agendada isso é a mensagem saindo
  pelo número errado, de madrugada, sem ninguém na tela.
- ⚠️ **Grupo lê `cb_groups.channel_id`**, nunca `conversations.channel_id`,
  que é sempre NULO ali — a mesma armadilha do recorte por canal.
- **Guarda de atraso de 1h no worker.** Agendador dias fora do ar + conserto
  despejaria a fila inteira de uma vez, às 2 da manhã. Passado o prazo a linha
  vira `failed` com o motivo escrito e espera decisão de gente.

⚠️ **Agendada com ANEXO e CITAÇÃO (932): tudo aqui existe porque passam HORAS
entre escrever e enviar.** `src/lib/scheduled/midia.ts` (puro, com teste),
`dispatch.ts`, a rota `api/cb/scheduled` e
`src/components/scheduled/anexo-e-citacao.tsx`. O que morde código novo:

- ⚠️ **Áudio NÃO leva legenda, e o dano é silencioso.** A nota de voz sai por
  `message/sendWhatsAppAudio`, que não tem campo de legenda: um texto ali
  seria gravado em `messages.content_text`, apareceria no fio para a equipe e
  **não viajaria**. A regra está em três lugares de propósito (CHECK da 932,
  rota, tela).
- ⚠️ **O arquivo é conferido ANTES de reivindicar a linha.** Reivindicar põe em
  `sending`, o estado do qual nada pode ser reenviado — a linha ficaria presa
  até o recolhimento de 10 min e sairia como "entrega incerta", que seria
  mentira. E **Storage fora do ar não conta como "sumiu"**: falso negativo
  cancelaria uma mensagem perfeita.
- ⚠️⚠️ **`storage.exists()` devolve `data: false` E `error` PREENCHIDO quando o
  objeto não existe** — os dois juntos, porque o 400/404 do HEAD vira
  `StorageError` e volta com a resposta. Ler o `error` primeiro faz a função
  responder "existe" para todo arquivo sumido, que é o único caso para o qual
  ela serve. Já foi cometido, e só a medição em produção pegou: o teste
  passava porque o stub imitava a forma SUPOSTA. **Quem usar `exists()` em
  código novo confere `data === false` antes do `error`.** ⚠️ E a SEGUNDA
  metade (revisão 48h): a forma resolvida `{data:false, error}` só existe
  para 400/404 — **qualquer outra falha (5xx, rede) é LANÇADA** (`throw
  error` no storage-js). Sem try/catch, o ramo "Storage fora do ar" fica
  inalcançável e o blip vira 500: código novo precisa das DUAS defesas,
  como `anexoAindaExiste` (dispatch) e a rota do acervo fazem.
- ⚠️ **A URL do anexo é DERIVADA do caminho (`getPublicUrl`), nunca aceita do
  cliente.** Aceitando-a, a conferência de posse olha um campo (`media_path`) e
  o envio usa outro (`media_url`), sem nada amarrando os dois — dá para casar
  um caminho legítimo da conta com uma URL de fora e o CRM entrega aquilo ao
  cliente.
- ⚠️ **Cancelar apaga o objeto do bucket — MENOS quando há `message_id`.** O
  teste é a coluna, não o status, e as duas vêm do RETORNO do `delete`: a lista
  da tela é uma foto de segundos atrás, e entre a carga e o clique o worker
  pode ter enviado. Com `message_id` preenchido o arquivo já é da mensagem que
  está no fio do cliente.
- ⚠️ **`reply_to_message_id` não tem FK**, e as três formas foram descartadas
  com motivo na migration (`RESTRICT` faria apagar mensagem falhar, `CASCADE`
  apagaria a agendada, `SET NULL` apagaria a informação de que houve citação).
  Preço: **sem FK o PostgREST não embute** — quem precisar da citada busca por
  id (`useCitadas`), e precisa do sinalizador de "já carregou", senão a tela
  avisa "citação apagada" sobre citação viva.
- ⚠️ **Apagar mensagem aqui é apagar MOLE**, então o núcleo citaria alegremente
  o que o cliente vê como "Esta mensagem foi apagada". Quem enviar citação em
  código novo precisa checar `deleted_at` — `send-message.ts` não checa.
- **O teto da legenda é 1024 MENOS a assinatura**, e a validação do
  agendamento não é garantia: a assinatura pode ser ligada depois, ou quem
  agendou sai da conta e passa a assinar o nome do escritório. Por isso o
  núcleo revalida e o disparador **traduz** — `SendMessageError.message` é
  escrito em inglês e cai cru na coluna que as duas telas mostram.

⚠️ **Execuções na conversa (955) e presença por conversa (963).** Aba
"Automações" no painel da conversa (robô ativo + esperas, com Parar e linha
do tempo), item "Executar automação" no menu + do compositor, e avatares de
quem mais está com a conversa aberta. `src/lib/execucoes/` e
`src/lib/presenca-na-conversa.ts` (puros, com teste), rotas em
`/api/cb/execucoes`, hooks `use-execucoes-do-contato` e
`use-conversa-aberta`. O que morde código novo:

- ⚠️ **As duas fontes da aba têm naturezas DIFERENTES, de propósito.**
  `flow_runs` é lido direto sob RLS e tem realtime (010); as esperas vêm da
  rota GET porque `automation_pending_executions` é service-role only desde
  a 006 — **não abrir policy de SELECT** para ganhar o que a rota já dá. Sem
  realtime nas esperas, a aba recarrega por ação e pelo evento global
  `cb:execucoes-mudaram` (o dialog Executar vive em outra árvore).
- ⚠️ **Parar espelha o motor, nunca inventa caminho novo**: esperas viram
  `cancelled` com as MESMAS cercas do passo `stop_automation`
  (automação+conta+**contato**+`status='pending'` — sem o contato, pararia a
  conta inteira); robô encerra por `abortActiveRunsForContact` com
  `stopped_by_agent` (955) — TERCEIRO status, pessoa que DECIDIU, distinto de
  `paused_by_agent` (pessoa respondeu) e `stopped_by_automation` (regra).
- ⚠️ **A rota `executar` checa os DOIS escopos (canal E etapa); o motor NÃO.**
  `runAutomationById` pula recortes de propósito (chamador explícito), mas
  "explícito" aqui é um clique — automação restrita ao número A executada na
  conversa do número B sairia pelo número errado. As duas checagens têm
  direções DIFERENTES, e isso é deliberado: a de CANAL falha ABERTA como o
  motor (conversa sem canal deixa passar); a de ETAPA (`stageInScope`,
  acrescentada no PR #74) mistura as duas com motivo — ERRO de consulta
  deixa passar (ignorância), mas contato SEM NEGÓCIO leva 422
  `stage_out_of_scope` (não é ignorância: sem card, ele não está em etapa
  nenhuma — `engine.ts`). Uma versão desta nota dizia "falha ABERTA" para a
  rota inteira e não mencionava a etapa (M16 do plano de 31/08). Grupo é recusado
  (automação não roda em grupo, 906) e o log ganha `trigger_event='manual'`.
- **Linha do tempo da expansão**: futuros são os passos do MESMO escopo da
  espera (`parent_step_id`+`branch`, de `next_step_position` em diante);
  condição aparece como "depende da condição" e os passos DENTRO dos ramos
  ficam FORA — afirmar um ramo seria o cartão da grade mentindo de novo.
  Rótulos por `descreverPasso` (`Pipelines.automacoes.resumo.*`, uma chave
  por tipo, cobrada por teste).
- **`cb_conversa_aberta` é clone deliberado da `member_presence` (024)**,
  tabela NOSSA: escrita SÓ pela RPC `cb_marcar_conversa_aberta` (conta do
  profile, conversa validada contra a conta — fora vira NULL em silêncio),
  leitura por membro, realtime SEM lista de colunas. "Saiu" é staleness com
  o MESMO limiar do roster (`OFFLINE_AFTER_MS`, 75s) — limiar próprio faria
  bolinha e avatar discordarem sobre a mesma pessoa. O escritor serializa as
  RPCs numa fila (troca rápida de conversa não pode deixar a resposta
  atrasada vencer a intenção nova).
- **Conta de UM membro**: a presença fica dormente em produção até o convite
  real — testada em 2026-08-30 com usuária fixture (criada e removida).

⚠️ **Desfecho da execução de automação (985): o fio NARRA o que a automação
fez.** `automation_logs.desfecho` ('concluida'|'barrada'|'falhou') +
`finalizado_em`, `src/lib/automations/estado-da-execucao.ts` e
`src/lib/execucoes/desfecho.ts` (puros, testados), `use-execucoes-do-fio.ts`,
`aviso-de-execucao.tsx`, a seção "Já rodou" da aba e a rota
`/api/cb/execucoes/resumo` com a marca na lista e no card. O que morde código
novo:

- ⚠️⚠️ **`status` NÃO responde "como terminou?", e é por isso que a coluna
  nova existe.** Ele nasce `'failed'` no INSERT, ANTES do primeiro passo
  (semente pessimista da #409), então "failed" também significa "acabou de
  começar"; e quando uma condição desvia para ramo VAZIO o log termina
  `'success'` — a execução que uma trava por etiqueta barrou era registrada
  como "concluída com sucesso". Vocabulário novo em COLUNA PRÓPRIA porque
  `status` é lido por quatro consumidores que o TypeScript não cobre; um 4º
  valor ali pintaria "barrada" de vermelho e imprimiria chave crua.
- ⚠️⚠️ **`fecharLog` é o ÚNICO escritor das duas colunas, e a guarda é "não
  sobrou espera VIVA deste log" — MENOS a que está sendo processada agora.**
  Sem a exceção, o resume enxerga a própria espera que o cron reivindicou
  (`running`), conclui que a automação continua e NUNCA fecha: toda automação
  com "Aguardar" fica invisível no fio, para sempre. Medido no preview em
  09/09; nenhum teste unitário pegava, porque o mock não simula o ciclo de
  vida da linha da fila. A guarda também conserta o furo da espera nascida
  DENTRO de um ramo, que o resume retoma com `parentStepId` preenchido — e
  naquele escopo o fim de `executeStepsFrom` não grava status nenhum.
- ⚠️⚠️ **São DUAS ESCRITAS, e juntá-las apaga a falha do fio.** O desfecho sai
  com a cerca anti-regressão (`desfecho.is.null,desfecho.neq.falhou`, para uma
  espera irmã que termina bem não sobrescrever o `falhou` de um ramo que
  estourou); a HORA DE FIM sai em update PRÓPRIO, sem cerca. Numa escrita só, a
  cerca recusa a LINHA INTEIRA quando o log já diz 'falhou' — e como a régua do
  fio exige as duas colunas, a falha ficava sem hora de fim e INVISÍVEL, que é
  o oposto do que a 985 existe para fazer (Codex, PR #155, 2ª rodada).
- ⚠️⚠️ **Os contadores do motor só conhecem UMA chamada; execução com
  "Aguardar" atravessa várias.** `fezTrabalho`/`barrouPorCondicao` nascem
  zerados na retomada, então `[enviar][aguardar][condição de ramo vazio]` — a
  forma do follow-up de no-show — fechava como `barrada`, "parou numa
  condição", sobre execução que já tinha falado com o cliente. Por isso
  `appendResults` DEVOLVE o histórico mesclado (ele já lia a linha) e o
  fechamento do escopo raiz soma `sinaisDoHistorico(...)` aos contadores. As
  duas fontes cobrem pedaços diferentes do tempo e se somam com OU: o registro
  pode voltar vazio (o `appendResults` engole erro de leitura e regrava só o
  trecho novo) e a memória é o único lugar que conhece o trecho em curso.
  Medido de ponta a ponta em 09/09.
  ⚠️⚠️ **São TRÊS fechadores, e os outros dois leem o registro por consulta
  própria (`sinaisGravados`)**: o escopo raiz SEM passos (a retomada cai aqui
  sempre que o "Aguardar" é o último passo — o motor enfileira `position + 1`
  sem perguntar se sobrou algo) e a retomada de RAMO, que fechava por
  `desfechoDoRetorno` e nunca podia dizer `barrada`. A primeira versão da
  correção só alcançou o fechamento normal da raiz, e dois céticos da revisão
  MEDIRAM a divergência: a mesma automação fecha `barrada` com a espera na raiz
  e `concluida` com ela dentro de um ramo. ⚠️ E isto não é borda neste
  escritório: ramo vazio NÃO para o escopo de fora, então uma trava só gateia
  de verdade com o corpo DENTRO do ramo — é o desenho das oito automações
  pedidas (a tag do contrato fechado, o "ainda está em No Show?" antes de cada
  uma das dez).
- ⚠️ **`barrada` é ESTREITA**: só quando a execução não fez trabalho nenhum.
  `[enviar][condição de ramo vazio]` é `concluida`, porque a mensagem SAIU.
  E o critério é "fez trabalho?", NUNCA a ordem de `steps_executed`, que não
  é cronológica quando há ramo cheio (o ramo faz flush antes do escopo de
  fora) — quem ler `at(-1)` acerta no caso simples e erra onde há ramo.
- ⚠️ **A régua do que aparece no fio é PURA** (`itensDoFio`), no molde de
  `apareceNaConversa`: descarta o que não tem desfecho, colapsa por
  (automação, dia local, desfecho) com contador, e tem teto de 12. Sem o
  colapso a feature DOBRA o fio — automação de gatilho "mensagem recebida"
  conclui uma vez POR MENSAGEM. É a lição do Radar (941).
- ⚠️ **O motivo CRU do motor NÃO vai para o fio** — inglês, com id dentro. Ele
  fica na aba, numa expansão aberta de propósito.
- ⚠️ **Quem mexe na fila avisa a tela pelo evento `cb:execucoes-mudaram`**, que
  mora em `src/lib/execucoes/aviso.ts` (fora dos hooks, porque
  `avisar-drenagem.ts` é módulo de biblioteca e não pode arrastar React). A
  drenagem do funil o emite quando a rota responde — a rota AGUARDA o dreno,
  então ali as automações do movimento já rodaram. Sem isso, arrastar um card
  acendia a automação no servidor e o raio do quadro só aparecia no
  recarregamento seguinte (Codex, PR #155).
- ⚠️ **A marca "tem robô rodando" lê a FILA, não o log**: só ela sabe que
  AINDA VAI rodar, e é o que faz o botão Parar apagar a marca. Vai por ROTA
  porque `automation_pending_executions` é service-role only (RLS ligada, ZERO
  policies): do navegador devolve 0 linhas com `error: null` — marca
  permanentemente apagada com cara de resposta certa. Erro vira 500, nunca
  `{}`, e o hook devolve `null` (não sei) em vez de vazio.
- ⚠️ **O card do funil recebe um NÚMERO por prop**, nunca um hook: o board
  redesenha ~120 cards por tecla, e o `memo` só segura com props estáveis.
- ⚠️ **Cor de texto em par claro/escuro**, sempre (`text-red-700
  dark:text-red-300`): medido no tema claro, `text-red-300` sozinho dava
  luminosidade 76 sobre fundo 99 — ilegível justamente no aviso de falha.
- ⚠️ **A 985 fechou o `anon` em `automation_logs`**, que a 931 não alcançou
  (tabela do upstream): ele tinha INSERT/UPDATE/DELETE/TRUNCATE, com a RLS
  como única barreira.
- **Nada retroativo**: as execuções anteriores ficam sem desfecho e não
  aparecem: não há registro de quando terminaram, e carimbar `created_at`
  mentiria em toda automação com espera.

⚠️ **Acervo de mídias (953): enviar do acervo COPIA o arquivo.** Tabela
`cb_media_library`, `src/lib/acervo/` (puro, com teste), rotas em
`/api/cb/acervo`, painel em Configurações → Acervo e o seletor
`acervo-picker.tsx` no clipe do compositor. O que morde código novo:

- ⚠️⚠️ **A rota `copiar` existe para não destruir o arquivo do escritório.**
  O compositor APAGA o objeto do bucket quando o envio falha ou o rascunho é
  descartado (`deleteAccountMedia`), e cancelar uma agendada apaga também
  (932). Enviando por referência, um envio falho de um estagiário levaria
  junto o contrato-padrão de todo mundo — e ninguém ligaria uma coisa à
  outra. Medido na tela: descartar o rascunho apaga a CÓPIA (400) e o
  original do acervo segue de pé (200). O segundo motivo é jurídico: o que
  FOI ENVIADO não pode mudar quando alguém troca o item.
- ⚠️⚠️ **A guarda de papel do acervo mora em DUAS camadas (954).** A rota
  exige admin para apagar, mas as policies de Storage da 023 conferiam só o
  primeiro segmento do caminho: qualquer membro — `viewer` incluso — podia
  chamar `storage.remove()` do navegador e apagar o arquivo do escritório, ou
  dar UPDATE e TROCAR o conteúdo mantendo o nome, sem nada mudar na tela. O
  `media_path` não é segredo: a policy de SELECT da 953 o mostra a todo mundo.
  A 954 reescreveu INSERT/UPDATE/DELETE do `chat-media` com "não está em
  `acervo/` OU é admin". ⚠️ Usa `IS DISTINCT FROM`, e não `<>`: em anexo comum
  a segunda pasta é NULA, e com `<>` a expressão viraria NULL, a policy
  reprovaria e ninguém mais apagaria rascunho descartado. Quem criar outra
  subpasta com regra própria repete o par (rota + policy).
- ⚠️ **É o bucket `chat-media` de sempre, na subpasta `acervo/`.** As policies
  da 020/023 casam só o PRIMEIRO segmento do caminho, então aninhar é de
  graça — e a subpasta é o que permite distinguir "arquivo do escritório" de
  "anexo de mensagem" numa varredura futura de órfãos. Quem criar bucket novo
  herda uma segunda RLS e uma segunda lista de mimes para manter em sincronia.
- ⚠️ **`MIMES_POR_TIPO` (`lib/acervo/tipos.ts`) é ESPELHO da
  `allowed_mime_types` da 023.** Alargar só no código faz o upload falhar no
  Storage com "erro de upload"; alargar só na migration faz a tela recusar
  arquivo que o WhatsApp aceita. Os dois, sempre.
- ⚠️ **Toda escrita passa pela API** (sem policy de INSERT/UPDATE/DELETE, com
  REVOKE): o papel é conferido lá (admin+ monta o acervo), `media_url` é
  DERIVADA do caminho no servidor (aceitá-la do cliente casaria caminho
  legítimo com URL de fora — lição da 932) e o caminho é exigido sob
  `account-<conta>/acervo/`. LER é direto sob RLS.
- ⚠️ **`storage.exists()` de novo**: a rota lê SÓ o `r.data` do resultado
  resolvido (objeto ausente resolve com `data: false` E `error` preenchido —
  ler o `error` como falha responderia "existe" para todo arquivo sumido) e
  envolve a chamada em try/catch, porque falha que não é 400/404 é LANÇADA
  pelo storage-js — Storage fora do ar não é "sumiu". O #74 reescreveu a
  conferência nessa forma; uma versão desta nota descrevia a forma antiga
  ("`data === false` antes do `error`") e ensinava a repeti-la.
- **`categoria` é texto livre**, não tabela de pastas, e NULL = "Geral" (que a
  tela põe no fim). O conjunto real é meia dúzia de rótulos.
- **Trocar o ARQUIVO de um item não existe**: o item mudaria de conteúdo sem
  mudar de nome e ninguém na equipe saberia. Trocar é apagar e cadastrar.
- **Áudio do acervo sai como NOTA DE VOZ** — é o mesmo caminho do gravador
  (`sendWhatsAppAudio`, PTT na Evolution). O seletor diz isso na linha do
  item, senão o operador manda "um arquivo" e o cliente recebe voz.

⚠️ **Campo personalizado SALVA SOZINHO — não existe mais "Salvar campos".**
`src/lib/contacts/salvamento-de-campo.ts` (puro, com teste) e
`src/components/contacts/campo-com-salvamento.tsx`, usado pelas DUAS telas
(painel da conversa e ficha de `/contatos`). O que morde código novo:

- ⚠️⚠️ **O campo só pode ser MONTADO quando os valores já forem do contato
  atual.** O rascunho nasce do `valorSalvo` de montagem e NÃO persegue a prop
  depois — e a limpeza da troca de contato roda num EFEITO, então existe um
  render com o contato NOVO e os valores do ANTERIOR. Medido no navegador:
  sem o portão, o valor do cliente A ficava na ficha do B **nas 35 amostras
  de 3,5s** (não é um piscar — é permanente, porque nada reescreve o
  rascunho), e a primeira edição gravaria aquilo no B. Por isso `customValues`
  guarda o DONO junto (`{ de, mapa }`) nas duas telas e a comparação é contra
  o PROP DO RENDER ATUAL. Achado do Codex no PR #83.
- ⚠️⚠️ **A `key` de quem monta o campo PRECISA incluir o `contact.id`.** Sem
  ela o React reusa a instância ao trocar de cliente, o rascunho de A sobrevive
  sob o cabeçalho de B, e a descarga de desmonte grava no cliente errado — a
  mesma janela que o painel já documentava, agora alcançável sem clicar em
  botão nenhum.
- ⚠️⚠️ **UM campo por gravação, nunca o mapa inteiro.** O botão antigo mandava
  todos de uma vez porque era um gesto só; a cada blur isso seria um envio do
  mapa — e `""` no upsert compartilhado significa DELETE da linha, então
  bastaria um campo ainda não carregado para o blur de OUTRO apagar dado real.
  O gate de `dadosProntos` continua pelo mesmo motivo.
- ⚠️ **Desmontar não dispara `blur`**, então há descarga na limpeza de
  desmonte: sem ela, digitar e trocar de bloco (o menu horizontal da 966),
  fechar o painel ou trocar de aba apagaria o texto — em silêncio, e sem o
  botão para servir de segunda chance. Ela não grava duas vezes porque o
  `enfileirar` da fila compara contra `desejado` (o que já se pediu gravar) e
  descarta o que não mudou — a idempotência mora DENTRO de
  `criarFilaDeGravacao`, não em ref nenhuma do componente. (Uma versão
  anterior desta nota creditava um `salvoRef` que nunca existiu no código.)
- ⚠️⚠️ **Toda gravação passa pela FILA (`criarFilaDeGravacao`), nunca por
  `aoGravar` direto.** Duas requisições concorrentes na mesma linha chegam ao
  banco fora de ordem — mudar uma lista duas vezes rápido, ou
  sair-voltar-editar-sair antes de a primeira voltar — e a ANTIGA chegando por
  último apaga a edição mais nova, em silêncio. A fila serializa, guarda só o
  pendente MAIS NOVO e faz o último valor vencer (mesma classe do `emVoo` das
  favoritas, aqui por campo). ⚠️ Dentro dela, "mudou?" é medido contra o que
  se QUER gravar, não contra o que o banco confirmou: com `salvo` ainda
  antigo durante o voo, desfazer para o valor original seria descartado como
  não-evento e a tela terminaria discordando do banco (pego pelo teste da
  própria fila). Achado do Codex no PR #83. ⚠️ E o ramo de FALHA tem duas
  sutilezas com teste próprio (achados #09/#10 do plano de 31/08): a régua
  `desejado` só reverte para `salvo` quando NÃO há pendente (com pendente,
  reverter engolia o desfazer seguinte), e REJEIÇÃO de `aoGravar` é tratada
  como falha comum — sem o catch, o laço morria com `rodando = true` e o
  campo parava de gravar para sempre, com o spinner aceso.
- ⚠️ **`select` grava na ESCOLHA, o resto no blur** (`gravaAoSair`). O popover
  fecha e não há blur útil para esperar. O campo de DATA fica no blur apesar de
  disparar `change`: ele dispara a cada pedaço digitado, com datas
  intermediárias absurdas — e a 935 lê essa coluna para disparar lembrete.
- ⚠️ **A comparação "mudou?" é APARADA dos dois lados** (`valorMudou`), porque
  o helper grava `v.trim()`. Sem isso, entrar e sair de um campo que a
  automação preencheu com `" 300 "` gravaria `"300"` — uma edição na ficha que
  ninguém fez.
- **Sucesso é discreto (um "Salvo" que some em 2s por campo), erro é ALTO** e
  nomeia o CAMPO e o CLIENTE: com o botão o erro chegava com o operador olhando
  a tela; agora ele já pode estar em outra conversa.
- **Etapa e valor do negócio JÁ salvavam sozinhos** desde a Fase 4/5 do painel
  (`SeletorFunilEtapa` no clique, `ValorInput` no blur) — só os campos
  personalizados dependiam do botão. Quem for "consertar" etapa/valor está
  mexendo em coisa que já funciona.

⚠️ **Blocos de campos personalizados (966): o operador define a ordem, e ela
vale para TODO cliente.** `cb_grupos_de_campos` (nome + posição),
`custom_fields.grupo_id`/`posicao`, o módulo puro `src/lib/contacts/
grupos-de-campos.ts` (testado) e o catálogo com arrastar em
`custom-fields-manager.tsx`. O que morde código novo:

- ⚠️⚠️ **NA FICHA DO CLIENTE SÓ UM BLOCO APARECE POR VEZ**, escolhido num menu
  horizontal de pastilhas. Não é enfeite: é o PONTO da feature. A primeira
  versão empilhava os blocos um sob o outro, o que organizava e não REDUZIA
  nada — os 15 campos continuavam todos na tela, que é exatamente a poluição
  que os blocos existem para resolver. O operador devolveu com o exemplo do
  outro CRM ("a separação e a visualização são feitas por um menu selecionável
  de forma horizontal"). Quem empilhar de novo desfaz a feature inteira.
  ⚠️ O menu SOME com menos de dois blocos (mesma regra do seletor de canal:
  com um bloco só ele não decide nada). E o bloco à vista é resolvido NO
  RENDER (`blocos.find(...) ?? blocos[0]`), nunca guardado por efeito — bloco
  apagado, ou esvaziado, deixaria a seção em branco com uma pastilha acesa.
- ⚠️ **`grupo_id` NULO É o bloco "Geral", e ele vem SEMPRE primeiro.** Não
  existe linha para ele: por isso não é renomeável nem arrastável, e o rótulo
  sai do dicionário (`Contacts.customFields.groupGeneral`), não do banco. Uma
  tela que mostre "Geral" vindo do banco está lendo uma linha que não existe.
  ⚠️ **Ele some quando todo campo está num grupo de verdade SÓ nas telas de
  LEITURA** (`incluirVazios: false` — ficha e painel, onde cabeçalho sem campo
  embaixo não informa nada). **No CATÁLOGO ele fica, mesmo vazio**, e isso é
  load-bearing: o seletor de bloco de cada linha oferece "Geral" SEMPRE, e sem
  o bloco renderizado `moverCampo` não acha o destino, devolve `null` e a tela
  não faz NADA — sem toast, sem erro, sem escrita. Arrastar também precisa do
  bloco na tela, então não havia segunda porta: campo posto num grupo ficava
  preso em grupo para sempre. "Simplificar" para `if (geral.length > 0)`
  parece obviamente certo e mata a volta. (Achado do Codex no PR #78.)
- ⚠️ **`categoria` (949) NÃO é o bloco, e não morreu.** Continua sendo a marca
  SEMÂNTICA "campo técnico": é o que o semeador dos 10 campos escreve e o que
  a API v1 expõe como `category` (dropar a coluna quebra o n8n do gestor).
  `grupo_id` é só ONDE o campo aparece. O seletor de categoria saiu do
  formulário de criação — quem cria campo escolhe BLOCO.
- ⚠️⚠️ **`posicao` É POSIÇÃO DENTRO DO BLOCO, e por isso só quem REAGRUPA pode
  ordenar por ela.** Ela reinicia em cada bloco, então ordenar a conta inteira
  por `posicao` INTERCALA os blocos — todo "1" antes de todo "2" — e devolve
  uma ordem que não é nem alfabética nem a que o operador arrumou. Não estoura
  em lugar nenhum e passa em revisão. São DUAS famílias de consulta, e trocá-las
  é o erro fácil:
  - **Reagrupam** (catálogo, painel da conversa, ficha de contato):
    `.order('posicao', { nullsFirst: false }).order('field_name')`, porque
    `agruparCampos` reparte antes de exibir. `ordenarCampos` é o espelho EXATO
    dessa cláusula — mudar um lado sem o outro faz o arrastar pousar o campo
    num lugar e o próximo carregamento mostrá-lo em outro.
  - **Listas PLANAS** (broadcast ×2, automação, API v1): `.order('field_name')`
    e mais nada. A da v1 é CONTRATO com o integrador (o n8n do gestor lê o
    array). Quem criar consulta plana nova repete esta metade.
  `posicao` NULA cai no FIM de propósito: campo criado por caminho que não a
  carimba (o semeador cria dez de uma vez) nasce no fim do bloco em vez de
  embaralhar a ordem montada. (As duas famílias saíram da revisão do Codex no
  PR #78, que pegou a ordenação global aplicada às quatro listas planas.)
- ⚠️ **Reordenar passa por RPC (`cb_ordenar_campos_personalizados`), nunca por
  `upsert`.** O upsert do PostgREST teria de carregar as quatro colunas NOT
  NULL de `custom_fields` junto (o NOT NULL é conferido ANTES de o Postgres
  decidir pelo ramo do ON CONFLICT — mandar só o id NÃO passa), e aí um
  arrastar pode reescrever o NOME do campo com um valor velho do estado da
  tela. É a mesma armadilha do `/api/ai/config`. As duas RPCs são
  `SECURITY INVOKER`: quem decide é a policy de admin que já existe.
- ⚠️⚠️ **ARRASTAR NÃO PODE SER A ÚNICA PORTA.** A primeira versão só deixava
  mudar um campo de bloco arrastando, e punha o "novo bloco" no RODAPÉ do
  cartão, depois de uma lista de 538px. O operador testou e não achou nenhuma
  das duas coisas ("não achei as possibilidades de criar os grupos" / "nem de
  colocar campos já criados em outros grupos") — metade da funcionalidade
  existia e era invisível. Hoje: o formulário de bloco fica ACIMA da lista, e
  cada linha tem um `<select>` de bloco ao lado da chave. O arrastar continua,
  como atalho de quem já sabe. Vale para qualquer gesto novo nesta tela.
- ⚠️ **`handleDragEnd` normaliza QUALQUER id do bloco para o mesmo destino**
  (`blocoDoAlvo`). Três nós ocupam praticamente a mesma caixa — o bloco
  arrastável, a ÁREA de soltura dentro dele e as linhas de campo — e entre os
  dois primeiros, que têm o MESMO centro, o desempate do `closestCenter` é a
  ordem de registro no `DndContext`, não a geometria. Medido: reordenando
  blocos, o `over` vem SEMPRE como `bloco:<id>`, nunca `grupo:<id>` — a versão
  que exigia o prefixo `grupo:` deixava reordenar bloco 100% quebrado, sem
  erro nenhum no caminho.
- ⚠️ **Alça de arrastar precisa de área de toque, não do tamanho do ícone.**
  A do bloco nasceu `size-3.5` num cabeçalho `py-1`: 14px que o ponteiro erra
  por um pixel, e aí o bloco não é agarrado — sem cursor mudando, sem aviso,
  sem nada a depurar. Hoje é `size-4` com `p-1` (24×24), igual à da linha.
- ⚠️ **O arrastar manda o BLOCO INTEIRO (0..N-1), não só quem se moveu.** As
  posições do banco não são densas — campo novo nasce nulo e o semeador cria
  dez de uma vez —, então reordenar por diferença deixaria buraco que
  reaparece como ordem errada no arrastar seguinte.
- ⚠️ **A aba "Traqueamento" do painel da conversa (o megafone da 949) DEIXOU DE
  EXISTIR**, e com ela as chaves `Inbox.sidebar.tabTracking`/
  `noTrackingFields`/`seedTrackingFields`/`seedDone`/`seedError` e a
  `Contacts.detailView.trackingHeading`. O semeador dos 10 campos padrão
  mudou de casa: agora vive no CATÁLOGO (Configurações → Campos e etiquetas) e
  cria os campos no bloco selecionado no formulário de cima — o botão diz qual,
  porque um lote de dez campos no bloco errado é trabalhoso de desfazer.
- ⚠️ **`ON DELETE SET NULL (grupo_id)`, com a coluna NOMEADA.** `account_id` é
  NOT NULL e faz parte da FK composta; um SET NULL sem lista tentaria zerar as
  duas colunas, e apagar um bloco passaria a estourar violação em vez de
  devolver os campos ao Geral. Medido: apagar o bloco preserva os campos.
- ⚠️ **O botão "Salvar campos" NÃO EXISTE MAIS** — o PR #83 trocou por
  salvamento automático POR CAMPO (blur/escolha + descarga de desmonte; ver a
  seção "Campo personalizado SALVA SOZINHO"). O que resta desta nota é o
  motivo dela: o valor digitado num bloco fora de vista CONTINUA no
  `customValues` e sobrevive à troca de pastilha (medido na tela) — quem um
  dia recriar um save em LOTE precisa resolver antes o que fazer com o que
  ficou escondido, porque perder digitação é pior que gravar digitação.
- **Sem `capitalize` nos rótulos** (nas duas fichas): ele maiusculava cada
  palavra e o operador via "Data De Fechamento Do Contrato" no lugar do nome
  que cadastrou — e estragava os técnicos (`utm_source`), que por isso
  precisavam de uma aba própria.
- **A altura da lista do catálogo é PROP** (`alturaDaLista`). Configurações
  passa `max-h-[min(36rem,60vh)]`; o diálogo da página de Contatos fica nos
  288px porque o `DialogContent` deste projeto **não tem teto de altura** —
  lista alta ali cresce para fora da viewport sem barra que a alcance.

⚠️ **Efeito passivo = o primeiro render mostra o estado VELHO.** Já mordeu
duas vezes em 2026-08-30, nas duas features do dia: a faixa da nota fixada
mostrava a anotação do cliente anterior sob o cabeçalho do novo (o
`useConversationNotes` esvazia num efeito — achado do Codex no PR #64), e o
seletor do acervo dizia "o acervo está vazio" antes de a primeira consulta
sair (`carregando` nasce falso). As duas correções são do mesmo tipo:
comparar contra o PROP do render atual (`conversation_id === conversationId`)
ou esperar um sinalizador de "já carregou uma vez" — nunca confiar em que o
efeito de limpeza já rodou.

⚠️ **A terceira (2026-08-31) é a variante PERIGOSA: lista vazia virando
AFIRMAÇÃO.** `message-thread.tsx` derivava `evolutionActive` de
`useChannels()` sem olhar o `loading` — e enquanto os canais não chegam,
"não é Evolution" era lido como "é Meta, logo a janela de 24h vale". Numa
conta 100% Evolution isso pintava a badge vermelha **"Expirada"** no
cabeçalho por alguns segundos ao abrir CADA conversa e, o dano real,
DESABILITAVA o compositor com "Sessão expirada — use um modelo" no exato
instante em que o operador abre a conversa para responder: as primeiras
teclas iam para o vazio. Reportado da tela pelo operador. A cura é o
sinalizador do próprio hook (`janelaDe24h = !canaisCarregando &&
!canaisFalharam && !evolutionActive` — TRÊS termos: a consulta que FALHOU
também não autoriza afirmar "é Meta", e uma versão desta nota citava só
dois; desde 10/09/2026 há um QUARTO, `&& !ehGrupo`: grupo é só Evolution e
não tem janela) — `useChannels` expõe `loading` desde sempre, e
`step1-choose-template.tsx` e `template-manager.tsx` já o usavam.
⚠️ **Conta SEM canal nenhum continua na regra da Meta**, de propósito: ali a
lista resolveu vazia, e vazio-COM-resposta é conhecimento, não lacuna. A
distinção entre os dois vazios é a feature inteira.
⚠️ Os outros ~18 consumidores de `useChannels` usam a lista só para
rótulo/filtro, onde vazio-durante-a-carga é cosmético e se corrige sozinho
(é o contrato escrito no cabeçalho do hook). O que torna este caso diferente
— e o teste para código novo — é a lista vazia ser convertida numa
afirmação POSITIVA que desabilita um controle.

⚠️ **A QUARTA (2026-09-01) é a mesma armadilha num painel novo**, e vale como
teste para qualquer aba que receba dado por prop: a aba **Arquivos** afirma
"Nenhum arquivo nesta conversa" quando `messages` vem vazio — e ele vem vazio
DURANTE A CARGA, porque a página zera o array ao trocar de conversa. Numa
conversa com 93 documentos a frase aparecia por ~1s. O fio não sofre disso
porque tem `loading` próprio; **o painel é IRMÃO do fio, não filho, e não
enxerga esse estado**. A cura é a página carimbar de quem é o array
(`messagesDaConversa`) e passar `carregando` — prop OBRIGATÓRIA no
`AbaArquivos`, para o compilador cobrar de quem montar a aba em tela nova.

⚠️ **Anexo grande (986): o teto de ENVIO estava decidindo o que o escritório
podia RECEBER.** `MEDIA_MAX_BYTES_ENTRADA` (`src/lib/storage/upload-media.ts`),
`src/lib/whatsapp/transport/anexo-declarado.ts` (puro, com teste) e o portão
por tamanho no webhook da Evolution. O que morde código novo:

- ⚠️⚠️ **São DOIS tetos com perguntas diferentes, e usar um pelo outro apaga
  documento de cliente.** `MEDIA_MAX_BYTES_BY_KIND` espelha os limites da
  Meta e vale para o ENVIO (barra no navegador antes de virar órfão no
  bucket); `MEDIA_MAX_BYTES_ENTRADA` = 50 MiB é o `file_size_limit` do
  bucket e vale para o que CHEGA. Eram o mesmo valor até 09/09/2026, e o
  preço foi MEDIDO: sete documentos de cliente (extrato, contrato,
  regulamento — 16,4 a 46,1 MiB) viraram "Documento indisponível" desde
  01/09. Seis foram recuperados; o sétimo a Evolution já não decifrava.
- ⚠️ **50 MiB, e não 100 MB (o teto do WhatsApp), por dois motivos
  escritos na migration**: o teto GLOBAL de upload de um projeto Supabase
  começa em 50 MiB no plano gratuito — pedir mais valeria aqui e explodiria
  na próxima instalação —, e o download da Evolution vem em BASE64, então
  cada anexo ocupa ~1,33× o tamanho em string no processo Node da VPS.
- ⚠️ **O número vive em DOIS lugares e há teste amarrando os dois**
  (`anexo-declarado.test.ts` lê o SQL da 986). Subir só o código troca a
  recusa nossa por uma recusa do Storage, já com o arquivo baixado; subir
  só o bucket não muda nada, porque quem recusa primeiro é o código.
- ⚠️ **O tamanho é lido do PAYLOAD antes de baixar** (`mediaBytesOf`, que
  saiu do módulo de GRUPO para o neutro justamente por isto). Sem esse
  portão o CRM baixava 46 MiB da Evolution para descartar em seguida.
  ⚠️ `fileLength` vem como STRING — comparar sem `Number()` dá resultado
  errado sem erro nenhum. Tamanho AUSENTE conta como pequeno (tenta baixar);
  o teto real fica no backstop de `fetchAndStoreEvolutionMedia`.
- ⚠️ **`media_state='too_large'` agora é gravado no 1:1 também**, e é o que
  faz a bolha dizer o NOME do arquivo e o motivo em vez de "indisponível".
  Até aqui esse valor não tinha ESCRITOR nenhum, embora a rota de download
  de grupo já o lesse. `'failed'` continua só em grupo, de propósito: é o
  estado que acende o botão "tentar de novo", e a rota sob demanda só
  existe lá. O `podeBaixarAnexo` já excluía `too_large`.
- ⚠️⚠️ **Marcar `too_large` passa por `marcarAnexoGrandeDemais`
  (`src/lib/whatsapp/anexo-grande.ts`), nunca por UPDATE solto** — há teste
  default-deny cobrando que ninguém escreva aquele valor fora do helper
  (`anexo-grande.chamadores.test.ts`). São DOIS passos que precisam andar
  juntos: gravar o estado e apagar o ponteiro `cb_message_media_ref` (906),
  que guarda as CHAVES DE DECIFRAGEM da mídia e nunca mais será usado
  (`too_large` desliga o download sob demanda para sempre).
  ⚠️⚠️ **E o ponteiro só sai DEPOIS de a marcação dar certo.** O Supabase
  devolve `error` em vez de lançar: apagando sem conferir, o UPDATE que
  falha deixa a mensagem `pending` — botão "toque para baixar" na tela — sem
  o ponteiro que o alimenta, e o clique seguinte responde 410 "o WhatsApp
  não tem mais este arquivo", que é MENTIRA. Soltas nos call sites, essas
  duas linhas divergiram em DOIS PRs seguidos (Codex, #157 e #158): primeiro
  o webhook não limpava, depois a rota limpava sem conferir. Por isso o
  helper.
- ⚠️ **O nome do arquivo é gravado MESMO quando o anexo é recusado**
  (`nomeDeArquivoDeclarado`): é a única informação que sobra do documento
  que não coube, e sem ela a bolha cai no rótulo genérico.
- **Legenda `\uFFFC` não é legenda**: documento mandado do iPhone chega com
  o OBJECT REPLACEMENT CHARACTER no `caption`, e gravá-lo em `content_text`
  põe uma caixinha na bolha, na prévia da lista e no transcrito do Radar.
  `extractText` descarta legenda sem nada visível.

⚠️ **Nome do anexo (969): o nome SEMPRE chegou, e era descartado na porta.**
`messages.media_filename`, `src/lib/media/filename.ts` (a cascata) e
`src/lib/media/anexos.ts` (o acervo da conversa, puro e testado). O que morde
código novo:

- ⚠️ **`extractText` (`evolution-inbound.ts`) lê só o `caption` do
  `documentMessage`, nunca o `fileName`** — por isso 166 dos 188 documentos
  em produção não tinham nome nenhum e a bolha caía em "Documento". O caminho
  da **Meta** não tem o defeito (`caption || filename`), e produção roda
  **Evolution**: é a divergência de transporte que a doc do `filename.ts`
  afirmava não existir.
- ⚠️ **`fetchAndStoreEvolutionMedia` devolve `EvolutionMediaSalva`, não uma
  string.** `fileName` e `mimetype` chegavam nela e morriam no `return`: o
  nome ia só para o caminho do objeto e `media_type` ficava NULL em 100% das
  linhas do Evolution. São DOIS call sites (webhook e a rota de download de
  mídia de grupo) — os dois gravam as duas colunas.
- ⚠️ **Coluna própria, nunca `content_text`.** Legenda e nome são coisas
  diferentes e um documento pode ter as duas; empilhá-las é o que faz o
  caminho da Meta PERDER o nome quando há legenda. E `content_text` alimenta
  a busca (929) e o transcrito do Radar (941).
- ⚠️ **Nome ausente NÃO sobrescreve com NULL** (`...(filename ? {…} : {})`):
  foto e áudio chegam sem nome, e o UPDATE apagaria o que outro caminho
  gravou.
- ⚠️ **SEM backfill, e o histórico ainda funciona.** `buildMediaPath` põe o
  nome no caminho do objeto (degradado: espaço e acento viram `_`, corte em
  40 chars), e `basenameFromUrl` o recupera — é a 2ª fonte de
  `mediaFilename`. Gravar a versão degradada congelaria a perda no banco e
  apagaria a distinção entre nome verdadeiro e reconstruído.
- ⚠️ **Exibir é `mediaFilename(message)`, nunca `media_filename` cru** — a
  coluna é NULA em toda linha anterior à 969. E a legenda só é mostrada
  quando DIFERE do nome resolvido: nas linhas antigas da Meta o filename está
  DENTRO do `content_text`, e sem a guarda o texto sai duas vezes.
- ⚠️ **Áudio não mostra nome de arquivo.** Nota de voz não tem nome — o
  WhatsApp entrega o id hexadecimal do objeto (`3A0B…oga`), e a lista virava
  trinta linhas de gibberish. Mostra a transcrição (943) quando `pronta`, e
  um rótulo genérico quando não.
- **`gallery.ts` NÃO foi alargado para documento**, de propósito: ele
  alimenta as setas ‹ › do visualizador, que só sabe desenhar imagem e vídeo.

⚠️ **Agenda de reuniões (945, Fase 1): o calendário é a parte fácil.**
`src/lib/agenda/` — `fuso.ts`, `vagas.ts`, `grade.ts` e `validar.ts`, todos
puros e com teste (85 casos); a tela é `/agenda`, e a escrita passa por
`/api/cb/agenda`. O que morde código novo:

- ⚠️ **A SOBREPOSIÇÃO É BARRADA PELO BANCO**, por uma restrição `EXCLUDE
  USING gist` sobre `tstzrange(starts_at, ends_at)` por advogado (exige
  `btree_gist`). Conferir "está livre?" antes de inserir NÃO resolve: entre a
  conferência e a inserção cabe a outra requisição, e é exatamente o que
  acontece com dois operadores marcando ao mesmo tempo. Quem criar outro
  caminho de escrita precisa traduzir o código **`23P01`** numa frase — cru,
  ele chega ao operador como "conflicting key value violates exclusion
  constraint".
- ⚠️ **O `EXCLUDE` ignora `status = 'cancelada'`**, senão desmarcar não
  liberaria o horário. `realizada` e `falta` continuam ocupando: aquele
  horário foi consumido de fato.
- ⚠️ **`cb_availability` guarda `time` + `timezone`, NUNCA `timestamptz`.**
  "Nove da manhã" não é instante: é regra que só vira instante aplicada a um
  dia num fuso. E o fuso **não é validado pelo banco** — `pg_timezone_names` é
  view e CHECK exige IMMUTABLE —, então a validação mora em
  `fusoValido()`. Ela recusa deslocamento fixo (`-03:00`), que o `Intl`
  aceitaria: constante não sabe horário de verão.
- ⚠️ **Mover reunião de dia RECONSTRÓI pela hora de parede**, nunca soma dias
  em milissegundos. Somar preserva o instante, não a hora local — atravessar
  uma virada de horário de verão mudaria a reunião das 14h para 13h sozinha.
  Invisível no Brasil (sem DST desde 2019), real no dia em que houver advogado
  em outro país.
- ⚠️ **`/agenda` no `protectedPaths` cobre `/agendadas` DE GRAÇA** (o teste é
  `startsWith`) — e é por isso que a página pública de auto-agendamento da
  Fase 2 tem de se chamar **`/marcar/<token>`**, nunca `/agendar/<token>`:
  aquela linha mandaria o cliente, que não tem login, para a tela de login.
- **`contact_id` é NULLABLE** e não pode entrar em CHECK de forma: apagar
  contato faz SET NULL, que é UPDATE, e UPDATE revalida CHECK — exigir o
  contato faria a exclusão de contato falhar (lição da 912).
- **A tela LÊ direto sob RLS; a escrita passa pela rota**, como em `cb_tasks`.
  A rota carimba `autor_nome`/`owner_nome` e confere o responsável contra a
  conta — `auth.users` é global, então a FK sozinha não impede marcar reunião
  na agenda de alguém de outro escritório.
- **Fora da v1, por decisão:** recorrência. Reunião que repete é marcada de
  novo.

⚠️ **Tarefas por cliente (944): o navegador NÃO escreve em `cb_tasks`.**
`src/lib/tasks/` (puro, testado), rotas em `/api/cb/tasks`, telas em
`src/components/tasks/`. O que morde código novo:

- ⚠️ **Toda escrita passa pela API.** Não há policy de INSERT/UPDATE/DELETE e
  o privilégio foi revogado — um `.from('cb_tasks').update()` do cliente leva
  **42501**, e é assim que tem de ser: criar tarefa grava em `notifications`
  (sem policy de INSERT desde a 027) e os nomes são carimbados no servidor.
- ⚠️ **Quem-pode-o-quê mora em `permissoes.ts`, num lugar só** — a rota decide
  com `podeNaTarefa` e a tela desabilita botão com a MESMA função. Não
  reescrever a regra em RLS nem no componente: divergem na primeira mudança.
  Só o destinatário marca lida (nem admin); editar/apagar é do criador; a
  porta do admin existe para a tarefa ÓRFÃ (criador e responsável são
  `ON DELETE SET NULL` — sem ela, ninguém alcança a tarefa de quem saiu).
- ⚠️ **`vence_em date` + `vence_as time`, separadas e sem fuso.** Nunca
  `new Date(vence_em)` — meia-noite UTC retrocede um dia no Brasil (armadilha
  do CLAUDE.md para coluna DATE). Use `dataParaExibir`/`diaLocal`/
  `situacaoDoPrazo` de `prazo.ts`; "venceu?" é respondido no NAVEGADOR.
- ⚠️ **A resposta volta para quem pediu, e é o SERVIDOR que decide**: com
  `tipo: 'resposta'`, a rota fixa o destinatário no `criador_user_id` do pai e
  IGNORA `responsavel_user_id` e `contact_id` do corpo (o contato é herdado do
  pai em qualquer derivada). Criador que saiu → 409 `PARENT_CREATOR_GONE`.
- **`tarefa_pai_id` é SET NULL com `tarefa_pai_titulo` congelado** — apagar a
  origem não apaga a derivada nem a informação de onde ela veio. Verificado em
  produção.
- **A etiqueta do menu depende de `REPLICA IDENTITY FULL`**: o contador deriva
  o delta comparando a linha ANTES e DEPOIS de cada UPDATE (marcar não lida,
  concluir, reabrir, redirecionar mudam a conta em sentidos diferentes).
- **Aviso de tarefa nasce SEM `conversation_id`** e roteia por
  `notifications.task_id` — em `notifications/page.tsx` o teste de `task_id`
  vem ANTES do de `conversation_id`, senão o clique cairia no inbox.
- **A conversa da linha é DERIVADA do contato na tela** (UNIQUE da 036), nunca
  coluna: cliente sem conversa cai na ficha via `/contacts?contact=<id>`
  (deep link resolvido no estado inicial da página de Contatos).
- **Redirecionar zera `lida_em`** — a tarefa chega "não lida" para quem acabou
  de recebê-la, senão some da contagem do menu da pessoa nova.

⚠️ **Funil-com-conversas (PR #71): o card do Kanban ABRE A CONVERSA, não o
negócio.** `src/lib/pipelines/cartao.ts`, `campos-do-card.ts`, `retorno.ts` e
`src/lib/inbox/url.ts` (puros, testados); editar o negócio é o lápis do card.
O que morde código novo:

- ⚠️ **A conversa do CONTATO manda; `deals.conversation_id` é só fallback**
  (`conversaDoCard`, e o link do `deal-form` segue a MESMA regra). Invertido,
  trocar o contato do negócio deixava o card com a cara do contato novo e o
  clique abrindo a conversa do antigo — o update nunca reescreve o vínculo
  ("`conversation_id` só no NASCIMENTO"). O fallback cobre contato apagado e
  o plano B do select.
- ⚠️ **O recorte por etapa sem dados é neutralizado DENTRO de
  `aplicarFiltros`**, por `ContextoDosFiltros.recorteDeEtapaConfiavel` —
  campo OBRIGATÓRIO, como `achadasNoTexto`: o compilador cobra de qualquer
  consumidor novo. Com o mapa contato→etapa vazio, `casaComAEtapa` reprova
  toda conversa e o deep link `?etapa=` abriria "nenhuma conversa" com cara
  de resposta certa (pino em `filtros.test.ts`). A lista pagina a consulta de
  `deals` (o teto de ~1000 do PostgREST derrubava o filtro PARA SEMPRE ao
  passar de 1000 negócios); o painel recebe `etapas` SEMPRE (dá nome à
  pastilha) e `etapasConfiaveis` gateia só OFERECER o campo.
- ⚠️ **O filtro SEMEADO por `?etapa=` morre com a jornada**: a página do
  inbox NÃO remonta quando só a query muda (sidebar limpa a URL, a faixa
  some) — sem o efeito de ciclo de vida na lista, o recorte ficava aplicado
  sem nada na tela explicando. Etapa semeada que não existe mais também é
  descartada. Só o seed: etapa escolhida à mão no painel não é tocada.
- **`DEAL_SELECT_DO_QUADRO` é separado do `CONVERSATION_SELECT`** de
  propósito — o do inbox é contrato da API pública v1. Embed recusado pelo
  PostgREST cai no `DEAL_SELECT_BASICO` (lembrado em flag de módulo — recusa
  é persistente) e a falha do PRÓPRIO plano B vira toast + lista vazia, nunca
  quadro "vazio" com cara de funil sem negócio. `contact.tags` fica AUSENTE
  no plano B (fabricar `[]` afirmaria "sem etiquetas" sobre dado não
  carregado).
- **O retorno de rolagem EXPIRA (10 min), não é apagado no consumo**
  (`retorno.ts`): apagar antes dos rAF perdia a restauração se o quadro
  desmontasse na janela, ir-e-voltar duas vezes teleportava para `list[0]`, e
  funil sem etapas nunca consumia o registro. A restauração mora no BOARD
  (o `loading` da página cobre só a carga dos funis) com `aplicadoRef`
  marcado DENTRO do rAF (StrictMode) e cleanup cancelando os rAF; o
  `scrollTo` usa `behavior: "instant"` porque o `.pipeline-scroll` tem
  `scroll-behavior: smooth`. O `quadroRef` é criado na PÁGINA: o link "ver
  conversa" do formulário grava o mesmo retorno (props `origemFunil`/
  `aoIrParaConversa` do `DealForm` — o painel do inbox não as passa).
- **`urlDoInbox` preserva `de` (só o valor "funil") e derruba `etapa` nos
  replaces, por decisão**: `etapa` é porta de entrada que semeia o filtro uma
  vez; preservá-la faria o filtro limpo no painel voltar no reload.
- **Sem realtime no quadro, por desenho**: não lidas/última mensagem são foto
  da carga, e voltar do inbox remonta a página e refaz o fetch. Os canais são
  buscados UMA vez no board (`useChannels` dentro do card custava um GET por
  card) e o `DealCard` é `memo` com handlers `useCallback` — quem criar prop
  nova instável quebra isso e volta a re-renderizar 120 cards por tecla.

⚠️ **Caixa de entrada em DUAS ABAS (2026-09-02): encerrada SAI da caixa, e
qualquer mensagem de gente a devolve.** `SituacaoDaCaixa` em
`src/lib/inbox/filtros.ts` (puro, testado), a barra em `inbox-filters.tsx`,
`src/lib/conversations/{reopen,situacao}.ts` (testados, com teste
estrutural `reopen.chamadores.test.ts`) e o alerta de atraso em
`src/lib/inbox/atraso.ts` + migration 972. O que morde código novo:

- ⚠️ **`status` do filtro é `"ativas" | "closed"`, e `"ativas"` (aberta E
  pendente) é a AUSÊNCIA de filtro.** Não existe mais "todas as situações":
  encerrar é tirar da caixa. A visão salva NÃO carrega a aba: `lerFiltroSalvo`
  ignora qualquer `status` gravado (`todos`/`open`/`pending` de antes das duas
  abas, e o `closed` de até 03/09) — de propósito, nunca `as`. Ver a nota das
  visões, mais abaixo.
- ⚠️ **A busca ATRAVESSA a aba padrão, e SÓ ela** (`casaComASituacao`).
  Sem isso, digitar o nome de um cliente com conversa encerrada devolvia
  "nenhuma conversa" — a leitura do operador seria que o cliente não está
  no CRM. Na aba Encerradas a busca é E lógico como qualquer filtro, senão
  a pastilha "Encerradas" mentiria sobre o que está na tela.
- ⚠️⚠️ **QUATRO caminhos reabrem, e há teste estrutural cobrando cada um:**
  webhook da Meta, `persistInboundMessage` E `persistDeviceMessage`
  (Evolution) e `sendMessageToConversation`. O helper existia desde o
  upstream (#409) e só a Meta o chamava — produção roda Evolution, então a
  regra não valia para NENHUMA mensagem real. Broadcast, fluxo, automação e
  IA NÃO reabrem, de propósito (um disparo para 500 encerradas devolveria
  as 500 à caixa); é o mesmo desenho do roteador de funil.
- ⚠️ **Quem reabre fica responsável; encerrar solta o responsável.** O envio
  pelo núcleo reabre com `assignTo: senderUserId` (nulo na API por chave);
  o cabeçalho do fio usa `patchDeSituacao`; o passo `close_conversation`
  da automação zera `assigned_agent_id`. Cliente, celular pareado e API por
  chave reabrem ESCREVENDO `assigned_agent_id = NULL` — não "deixando como
  está": conversa encerrada antes da regra ainda carrega o dono velho, e
  reabrir em nome dele a tiraria da fila de "sem responsável" (Codex, PR
  #106). Sem acervo nas encerradas antigas, de propósito (o dono que ficou
  lá diz quem atendeu por último). Aberta ↔ pendente não mexe em nada.
- ⚠️ **O alerta de atraso lê `conversations.aguardando_desde`, mantida por
  GATILHO (972), nunca calculada na tela.** Mensagem do cliente preenche
  se vazia (conta da PRIMEIRA sem resposta), resposta de GENTE
  (`sender_id` OU `from_device` — a régua do Radar) limpa, encerrar limpa,
  grupo nunca. Broadcast e robô NÃO limpam: um disparo apagaria o alerta de
  todo cliente esquecido. Os 10 minutos são régua de tela
  (`ATRASO_DE_RESPOSTA_MS`), e a lista re-renderiza a cada minuto — a linha
  não muda no banco quando o prazo vence. Aos 30 min (`ATRASO_CRITICO_MS`,
  campo `critico`) o selo passa de âmbar a VERMELHO — decisão do operador
  em 03/09; até então era só âmbar. ⚠️ A mensagem do cliente
  preenche a coluna MESMO com a conversa encerrada: a reabertura acontece
  DEPOIS do insert; a tela é quem esconde o alerta enquanto está encerrada.
  Mensagem APAGADA (`deleted_at` carimbado) recalcula a partir do que
  sobrou — senão o cliente que manda e apaga deixava o relógio preso numa
  mensagem inexistente. O contador "Exibindo N de M" conta a ABA, com o
  termo da busca no universo (a busca atravessa para as encerradas).
- **A barra é UMA linha sem `flex-wrap`, e a coluna tem 320px no `lg` e
  360px no `xl`** (03/09; o chip de filtros salvos SAIU dela no mesmo dia —
  virou a fileira de visões logo abaixo — sobraram três chips:
  layout "C" escolhido pelo operador entre três mocks): abas sublinhadas à
  esquerda e quatro chips quadrados só com ícone à direita (favoritas, não
  lidas, salvos, filtros), todos por `chipDaBarra()` de `inbox-filters.tsx`
  — o menu de salvos IMPORTA de lá, senão o gatilho dele volta a ter forma
  própria, que foi a queixa original ("os itens estão diferentes"). Medido:
  ~290px nos 296px úteis do `lg`. ⚠️ Os 40px a mais são SÓ no `xl`: a
  1024px o menu (240) e o painel do contato (360) já deixam 104px para o
  fio, e alargar ali o levaria a 64px (Codex, PR #108). O nome do filtro
  salvo aplicado vive no `title`,
  não mais no botão; as pastilhas ganharam linha própria, que só existe
  com algo recortando. ⚠️ **A aba Encerradas NÃO é filtro — nem do painel,
  nem da visão salva** (decisão do operador, 03/09, em duas rodadas): a aba
  é ONDE o operador está; o recorte é o que ele filtra. `contarFiltrosAtivos`
  não conta a situação (distintivo, "Limpar tudo" e a semente do padrão),
  `lerFiltroSalvo` ignora o `status` gravado, `escreverFiltroSalvo` não o
  grava, `mesmoFiltro` não o compara e `aplicarVisao` mantém a aba nos dois
  caminhos (chip e "Todas"). Existiu por algumas horas uma segunda contagem
  (`contarRecortesDoPainel`, "situação fora da conta só para o painel") com
  os filtros salvos ainda carregando a aba: aplicar um chip em Encerradas
  jogava o operador de volta para Abertas, e trocar de aba com um chip aceso
  o apagava e oferecia "salvar alterações". Quem precisar de uma visão "só
  encerradas" está pedindo outra feature (a aba DENTRO da visão), não a
  contagem antiga de volta.

⚠️ **Cabeçalho do fio, linha da lista e painel (2026-09-03, "sistema de
referência" Chatguru).** Quatro mudanças pequenas com um motivo cada:

- **O menu de ATRIBUIÇÃO saiu do cabeçalho do fio para o painel lateral**
  (`painel/responsavel-menu.tsx`, abaixo do nome — visível em qualquer aba),
  a pedido do operador, para a linha de cima ficar só com conexão e situação.
  ⚠️ É montado nos DOIS painéis (contato e grupo): atribuir grupo é decisão
  explícita do operador, e tirar do fio sem levar ao `group-sidebar` apagava
  isso em silêncio. O fio CONTINUA chamando `onAssignChange` pelo caminho de
  situação (encerrar solta o responsável) — não remover a prop.
- **Situação como PASTILHA preenchida** no cabeçalho (`STATUS_OPTIONS` ganhou
  `pill`/`dot`) e, na lista, **pastilha escrita SÓ para pendente e
  encerrada** (`STATUS_PILL`) — aberta não leva marca: "Aberta" escrita em
  98% das linhas seria o rótulo que o olho aprende a ignorar. ⚠️ O anel
  colorido no avatar existiu por algumas horas e foi RETIRADO pelo operador
  no mesmo dia ("está atrapalhando"): a foto do contato e o anel disputavam
  o mesmo círculo. Não voltar com ele. Paleta única: violeta/âmbar/cinza.
- **Copiar link da conversa** (`copiar-link-da-conversa.tsx`): é o deep link
  que já existe, `/inbox?c=<id>` via `urlDoInbox` — círculo no cabeçalho dos
  painéis e ícone pequeno ao lado do nome no fio (irmão do botão do nome:
  button aninhado é inválido).
- **Bloco "Origem do contato" fixo no topo da aba Histórico**
  (`painel/origem-do-contato.tsx`, regra em `lib/contacts/origem.ts`, pura
  e testada): cadastro (`contacts.created_at`), conexão da PRIMEIRA mensagem
  e quem a mandou (cliente / equipe pelo CRM / equipe pelo celular pareado /
  robô). ⚠️ Canal sem carimbo (117 conversas anteriores ao multi-canal, ou
  conexão apagada) vira TRAVESSÃO, nunca o canal padrão. A primeira mensagem
  é comparada contra a prop do render atual (`de === conversationId`) — a
  armadilha do efeito passivo, de novo.

⚠️ **Selo da janela de 24h na lista (991, 12/09/2026): a ampulheta lê o
BANCO, e o banco espelha o fio.** `conversations.janela_meta_desde` +
`janela_meta_canal_id` (gatilho na 991), `src/lib/inbox/selo-da-janela.ts`
(puro, testado) e a ampulheta em `conversation-list.tsx`. Decisões do
operador (10/09/2026): só a ampulheta, expandindo no hover; cor padrão de
24h a 12h, âmbar de 12h a 3h, vermelha abaixo de 3h; fora das Encerradas; só
WhatsApp oficial (não Instagram); sem filtro "janela aberta". O que morde
código novo:

- ⚠️⚠️ **O gatilho é ESPELHO de `contaParaOCanal` (`janela-24h.ts`), e há
  teste lendo o SQL.** Mensagem do CLIENTE carimbada com conexão `meta`
  avança as duas colunas; SEM carimbo, só se o id for `wamid.` — aí
  `janela_meta_canal_id` fica NULO ("número oficial, qual não se sabe") e
  conta para qualquer número oficial de saída, como no fio. Mensagem pelo QR
  Code ou pelo Instagram não toca nas colunas. Mudou a regra num lado, muda
  no outro: `selo-da-janela.test.ts` compara o `restante` da lista com o
  `minutosRestantes` do fio sobre a mesma mensagem — com UM número oficial
  de saída. ⚠️ **Duas divergências ESCRITAS, as duas para o lado sem selo:**
  conta SEM canal nenhum (o fio conta o fio inteiro; a lista cala, porque não
  sabe por qual número responde) e DOIS números oficiais na mesma conta (o
  banco guarda UM par por conversa — a mensagem oficial mais recente, de
  qualquer número — e o fio conta por número: cliente que escreveu aos dois
  com a conversa FIXADA no mais antigo tem o fio "aberta" e a lista sem
  ampulheta). A segunda foi aceita em 12/09/2026 porque a conta tem um
  oficial; o conserto, se um segundo for conectado, é guardar a janela POR
  número (mapa canal→instante). Há teste pinando a divergência, para ninguém
  a "consertar" de um lado só.
- ⚠️ **Só AVANÇA, e mensagem apagada continua contando.** A janela da Meta
  abre com o que o cliente MANDOU; "apagar para todos" não a fecha do lado
  da Meta, e o fio também não olha `deleted_at`. Replay do webhook com
  mensagem antiga não recua o relógio.
- ⚠️ **O número de saída da linha é resolvido como no fio** (`activeChannel`:
  canal da conversa, senão o padrão da conta) e vai `null` enquanto os
  canais carregam ou a consulta falhou — a lista vazia não pode virar a
  afirmação "é Meta" (a armadilha do "Expirada" de 31/08). Sem selo também
  na conta sem canal nenhum: o selo depende de saber por qual número se
  responde.
- ⚠️ **Encerrada é escondida pela TELA, não pelo banco.** A coluna fica (a
  reabertura acontece DEPOIS do insert, como na 972) e a reaberta volta a
  mostrar. Grupo nunca, nos dois lados.
- **Cores em classes LITERAIS** (`COR_DA_AMPULHETA`), nunca montadas — a
  regra da `PALETA_DE_CANAIS`. O texto do hover é o MESMO da etiqueta do
  cabeçalho do fio (`Inbox.sessionTimer.xhRemaining`/`xmRemaining`).
- **No toque não há hover**: vale só a cor. O tempo também está no `title`.

⚠️ **Foto de perfil do contato (973): a URL do WhatsApp EXPIRA, a cópia é
nossa.** `lib/contacts/foto-de-perfil.ts` (puro, testado),
`lib/whatsapp/foto-do-contato.ts` (I/O), `EvolutionClient.fetchProfilePictureUrl`,
gancho no webhook da Evolution e a rota `POST /api/cb/channels/[id]/fotos`
(botão "Buscar fotos dos contatos" em Conexões). O que morde código novo:

- ⚠️ **`contacts.avatar_checked_at` é o que impede a chamada infinita.** A
  Evolution devolve `profilePictureUrl: null` tanto para "não tem foto"
  quanto para "esconde de quem não é contato" (ela captura o erro do Baileys
  e responde 200) — sem o carimbo, todo contato sem foto seria consultado a
  cada mensagem, para sempre. Revalidação: 30 dias (`REVALIDAR_FOTO_MS`).
- ⚠️ **`null` NÃO apaga a foto que já temos**, pelo mesmo motivo: quem só
  mexeu na privacidade perderia a foto. Só o carimbo avança.
- ⚠️ **A imagem é BAIXADA para `chat-media`, em
  `account-<conta>/avatares/<contato>.jpg`** — caminho ESTÁVEL com `upsert`
  (a revalidação sobrescreve, sem cópia órfã por mês) e `?v=<epoch>` na URL
  gravada, senão o navegador serve a foto velha pelo `cacheControl`. Nenhuma
  policy nova: as da 020/023 casam só o primeiro segmento (qualquer membro
  pode apagar o objeto pelo Storage — aceito: a próxima conferência refaz).
- **Dois caminhos, um destino**: o webhook confere UM contato por vez
  (depois de a mensagem e o anexo já estarem gravados, e só 1:1); o botão
  usa `chat/findChats`, que traz a foto de TODOS os chats numa chamada, e
  casa com `contacts` pelos ÚLTIMOS 8 DÍGITOS (a régua de
  `findExistingContact`). A rota responde 202 e trabalha em `after()`.
- ⚠️ **Deploy DEPOIS da migration**: o UPDATE grava `avatar_checked_at`; sem
  a coluna o PostgREST recusa, `guardarFoto` devolve `'falhou'` (log, sem
  quebrar a ingestão) e nenhuma foto entra.

⚠️ **Abaixo da barra: a FILEIRA DE VISÕES e um painel COMPACTO, recolhido
por padrão** (03/09). As pastilhas do recorte, o "Limpar tudo" solto e a
faixa "Filtro padrão: X" SAÍRAM a pedido do operador ("com um filtro salvo
aplicado, tudo isso vira um aglomerado que repete o que o chip aceso já
diz"). O painel abre no botão de ajustes (distintivo = recortes além da
aba): FIXOS conexões (multi), etiquetas e funil/etapa; "Mais filtros"
guarda tipo, responsável e empresa — e abre sozinho quando um deles está
recortando, senão o painel esconderia de onde vem o recorte. Rodapé numa
linha: "N de M" (só com recorte) e "Limpar" (limpa a busca também, mantém
a aba). A fileira QUEBRA linha (não rola): com 360px o segundo filtro já
não cabia, e rolagem escondida cortava o chip na borda sem sinal. Quem
acrescentar campo ao painel decide: dia a dia (fixo) ou "Mais filtros".

⚠️ **Filtros do inbox: o recorte é PURO e mora fora da tela (924).**
`src/lib/inbox/filtros.ts` (testado), `src/components/inbox/inbox-filters.tsx`
e `src/hooks/use-favoritas.ts`. Quem for mexer em filtro de conversa mexe lá,
não dentro da lista. O que morde código novo:

- ⚠️ **Filtrar conversa por campo do contato NA CONSULTA dá resultado errado
  sem dar erro.** Com o embed LEFT atual, `.eq('contact.algo', …)` filtra só o
  recurso embutido e as conversas que não casam **continuam vindo** com
  `contact: null`; trocando para `contacts!inner` vira INNER JOIN e **apaga
  toda conversa de grupo**. Nenhum dos dois estoura e os dois passam em
  revisão. Filtre em JS enquanto a lista for carregada inteira.
- ⚠️ **Conversa de grupo tem `conversations.channel_id` NULO — sempre.**
  `src/lib/cb-groups/persist.ts` não grava a coluna; quem sabe o número é
  `cb_groups.channel_id`. Recorte por canal precisa de `canalDaConversa()`,
  senão apaga todos os grupos daquele número em silêncio. **Vale para
  qualquer código novo que agrupe ou conte conversa por canal**, não só para
  o filtro do inbox (o painel, por exemplo, ainda não foi conferido).
- ⚠️ **O recorte de funil/etapa tem DOIS níveis, e `funilId` é escrito SÓ
  pelo seletor de funil.** Escolher uma etapa nunca o carimba. Carimbando,
  numa conta de um funil só ele ficaria preenchido por tabela e "Qualquer
  etapa" — que hoje significa "não filtro por etapa" — passaria a significar
  "quem tem negócio neste funil", sumindo em silêncio com quem ainda não
  virou negócio (é o mesmo pessoal que "Sem negócio" existe para achar). Por
  isso a etapa VENCE o funil em `casaComAEtapa`, e não se somam.
- ⚠️ **`funilPorEtapa` (etapa→funil) é campo OBRIGATÓRIO do ctx**, pela mesma
  razão de `achadasNoTexto`: esquecê-lo não dá erro — o recorte por funil só
  não acha ninguém, e a tela diz "nenhuma conversa" sobre um funil cheio.
- **O campo vira dois níveis só com 2+ funis NOMEADOS.** Com um funil, ou com
  a consulta de `pipelines` falhando sozinha (os nomes vêm dela, o gate de
  `etapasStatus` não a olha), ele cai na lista chapada de antes — subdividir
  sem poder dizer em quê é pior que não subdividir.
- **Uma pastilha POR NÍVEL.** A pastilha única mostrava
  "Bancário - Comercial · Contato Avulso" (198px) numa caixa de 128px: o
  operador lia o funil e NÃO enxergava a etapa. Tirar a do funil tira a
  etapa junto — o seletor não sabe exibir etapa sem funil.
- **Escopo vazio = TUDO**, igual ao resto do projeto: `FILTROS_VAZIOS` não
  recorta nada, e "sem responsável"/"sem negócio" são opções explícitas, não
  a ausência de filtro.
- ⚠️ **O chip "Em atraso" (09/09) reusa `atrasoDeResposta`, e o relógio entra
  pelo ctx (`agoraMs`, campo OBRIGATÓRIO).** A régua é a MESMA que acende o
  selo da linha — uma cópia faria o chip acender sobre linha sem selo, e a
  leitura do operador seria "o selo sumiu", não "são duas contas". E o
  `agoraMs` é exigido pelo mesmo motivo de `achadasNoTexto`: é a única
  pergunta do recorte que o DADO sozinho não responde (a linha não muda no
  banco quando os 10 minutos vencem), então esquecê-lo devolveria "nenhuma
  conversa" sobre uma caixa cheia de gente esperando — sem erro nenhum. Quem
  consumir `aplicarFiltros` em tela nova precisa de um tique de um minuto lá
  também, senão o recorte congela. ⚠️ Não depende de "Não lidas", de
  propósito (pedido do operador): quem espera há 10 minutos costuma ter a
  conversa JÁ ABERTA por alguém — abrir zera `unread_count` sem responder
  nada. ⚠️ Fica FORA de `limparOrfaos`: não é referência a linha do banco, e
  "ninguém em atraso agora" é resposta verdadeira. ⚠️ O rótulo inglês é
  "Overdue", não "Awaiting reply": o segundo descreveria toda espera aberta,
  e o filtro só pega o que passou do limiar (Codex, PR #156).
- **Filtro cujo dado não carregou some da tela.** Um seletor sem os dados por
  trás não fica inerte: ele responde ERRADO com cara de certo (o de etapa
  chegaria a dizer que 55 negócios não existem). Cada busca do painel tem
  sinalizador próprio.

⚠️ **Filtros SALVOS do inbox (967/968/974): o filtro é DE CADA MEMBRO, e o
padrão também.** `src/lib/inbox/filtros-salvos.ts` (puro, com teste),
`src/lib/inbox/visoes.ts` (puro: o que a fileira acende/oferece),
`src/hooks/use-filtros-salvos.ts`, a FILEIRA DE VISÕES em
`src/components/inbox/visoes-salvas.tsx` (chips sob as abas — layout "B",
escolhido pelo operador em 03/09; o menu atrás do ícone de marcador foi
apagado), os diálogos em `filtros-salvos-dialogos.tsx` e a semente em
`conversation-list.tsx`. Aplicar é `setFiltros(...)`: nada muda em
`aplicarFiltros`. ⚠️ A 974 reescreveu a regra de posse: `user_id NOT NULL
DEFAULT auth.uid()`, policies "só as minhas" para QUALQUER membro (o gate
de admin sumiu do código também), nome único por `(conta, membro)`,
`ON DELETE CASCADE` de propósito (preferência pessoal, não dado do
escritório — a exceção à regra dos contatos). Decisão do operador: "cada
membro cria e edita os seus; não são distribuíveis". O que morde código
novo:

- ⚠️ **A fileira tem uma BASE** (`visaoBaseId`, na lista): o chip clicado por
  último, ou o padrão semeado. É o que permite "Salvar alterações em X"
  quando o operador parte de um filtro e mexe; sem ela só existiria "salvar
  como novo". "Todas" e o "Limpar" a zeram; mexer NÃO zera (é para isso que
  existe). O chip aceso é IGUALDADE com o recorte atual (depois de
  `limparOrfaos`), nunca a base — um chip aceso sobre recorte diferente
  mentiria.
- ⚠️ **Conexões são VÁRIAS** (`canalIds: string[]`, vazio = todas, OU entre
  as marcadas; era `canalId` até 03/09). `lerFiltroSalvo` lê o JSON antigo
  (`canalId: "x"` → `["x"]`), `limparOrfaos` tira SÓ os ids mortos e
  `mesmoFiltro` compara conjunto. Filtro cujas conexões estão TODAS fora do
  escopo do perfil some da fileira (aplicado, viraria "todas as conexões").
- ⚠️ **A semente do padrão lê o recorte pela REF, não pelo updater**: um
  `setState` (a base) dentro de outro updater é efeito colateral onde o
  React exige pureza.

- ⚠️⚠️ **Filtro salvo apontando para id APAGADO devolve ZERO conversas sem dar
  erro** — etapa removida, conexão desconectada, etiqueta ou funil apagados. É
  a mesma família de `recorteDeEtapaConfiavel`: filtro sem o dado por trás não
  some, RESPONDE ERRADO. Por isso aplicar passa SEMPRE por `limparOrfaos`.
  ⚠️ E **catálogo VAZIO não limpa nada**: lista vazia pode ser "ainda não
  carregou" ou "a busca falhou" (o `useChannels` engole erro por desenho), e
  descartar ali jogaria fora um recorte perfeitamente bom por causa de rede.
  `empresa` fica FORA da limpeza de propósito — é texto casado contra
  `contact.company`, não referência a linha: "nenhuma conversa desta empresa
  agora" é uma resposta VERDADEIRA.
- ⚠️ **`lerFiltroSalvo` é PARSE, nunca `as FiltrosDoInbox`.** A linha é JSONB e
  pode ter sido gravada por uma versão que não conhecia um campo de hoje; um
  cast entregaria `undefined` ao recorte e a lista responderia de um jeito que
  ninguém escolheu. Parte de `FILTROS_VAZIOS`, só aceita chave conhecida com o
  tipo certo, e booleano só é ligado pelo booleano `true` (`"false"` e `1` são
  truthy em JS).
- ⚠️ **As pastilhas do painel continuam sendo montadas em `inbox-filters.tsx`**,
  e o menu descreve pelo `descreverFiltro` do módulo. O elo que impede as duas
  descrições de divergirem é um TESTE: `AMOSTRAS` é um
  `Record<keyof FiltrosDoInbox, …>`, então o **compilador** cobra uma entrada
  para todo campo novo do recorte e o teste cobra que ele apareça, saiba se
  desfazer e sobreviva à ida e volta pelo banco. Campo novo em `FiltrosDoInbox`
  = mexer nos dois lugares, e o teste avisa.
- ⚠️ **A semente do padrão roda UMA VEZ** (`semeouPadraoRef`) e só sobre
  recorte INTACTO. Reaplicar faria o filtro que o operador acabou de limpar
  voltar sozinho; semear por cima de uma escolha feita nos centésimos em que a
  consulta voltava desfaria o que a pessoa acabou de fazer.
- ⚠️ **`?etapa=` do funil VENCE o padrão**, e a lista SEGURA o spinner enquanto
  o padrão pode entrar (`esperandoPadrao`). Sem a espera, o inbox pinta as 176
  conversas e pula para 8 um segundo depois; sem a precedência, a faixa "Voltar
  ao funil" mentiria sobre o que está na tela.
- ⚠️ **Toda escrita confere ROWCOUNT.** A policy da 967 exige `admin`, e RLS que
  barra escrita volta **0 linhas com `error: null`** — medido: `agent` renomeia,
  vê o nome mudar e encontra o velho no reload. INSERT barrado volta sem erro
  E sem linha (o `RETURNING` não enxerga o que a RLS recusou).
- **Escolher o PADRÃO é de qualquer membro** (a policy é por `auth.uid()`, não
  por papel): o filtro é do escritório, a preferência é de quem usa.
- **Filtro cujo canal está fora do escopo do perfil SOME do menu** — aplicá-lo
  devolveria vazio sem nada explicando. ⚠️ E o "aplicado" do gatilho é
  procurado SÓ entre os visíveis, e só entre os que ainda RECORTAM algo
  depois de `limparOrfaos`: o filtro do canal fora do escopo perde o canal na
  limpeza, vira vazio, e vazio casa com o inbox sem recorte — o gatilho
  mostrava o nome de um filtro escondido que ninguém aplicou. A faixa
  "Filtro padrão: X" segue a mesma régua (`contarFiltrosAtivos(limpo) > 0`):
  padrão com todos os ids mortos não está "na tela" — e o "mostrar tudo"
  gravava o mesmo vazio, então a faixa não saía nunca (Codex, PR #92).
- **Nome é único por conta, aparado e em minúsculas**, e o `23505` vira
  PERGUNTA na tela ("já existe 'SDR' — substituir?"), não erro cru.
- **A faixa "Filtro padrão: X · mostrar tudo"** existe porque o distintivo de
  contagem explica um recorte que o operador ACABOU de fazer; este ele não fez.

⚠️ **A caixa de busca do inbox tem DUAS metades, e elas se somam com um OU
(929/930).** Nome, telefone, grupo e última mensagem são resolvidos em JS
(`casaComABusca`); o corpo do histórico é respondido pelo banco
(`cb_buscar_conversas_por_texto`), consumido por `use-busca-em-mensagens.ts`.
O que morde código novo:

- ⚠️ **O OU vale só entre as duas metades da busca, dentro do `.filter()`.**
  Tirá-lo de lá faria a busca ATROPELAR o painel — buscar "contrato" com
  "Favoritas" ligado passaria a devolver conversa não favorita.
- ⚠️ **A busca do banco devolve o conjunto COMPLETO, nunca uma página.** É o
  que permite os filtros continuarem no cliente sem resultado inconsistente. Se
  um dia a lista paginar, isto tem de ser revisto **junto** com o realtime.
- ⚠️ **Consulta direta a `messages` para buscar texto é armadilha:** uma linha
  por MENSAGEM estoura o teto de 1000 linhas do PostgREST **sem avisar**, e a
  busca fica incompleta com cara de completa. A RPC colapsa com `DISTINCT ON`
  antes de sair do banco.
- **Uma função para as duas pontas** (`cb_texto_para_busca`, minúsculas + sem
  acento). Índice e consulta com expressões diferentes desligam o índice em
  silêncio — resultado certo, só lento.
- **`%` e `_` digitados são escapados** no SQL. Sem isso, `%` "acha" a conta
  inteira.
- **Piso de 3 caracteres, e ele mora no BANCO.** Abaixo disso a caixa ainda
  acha por nome/telefone, então a tela **precisa dizer** que só a parte do corpo
  ficou de fora.
- **Só o texto vigente:** `deleted_at IS NULL`, e `text_before_edit` fora.
- **A prévia da linha MENTE durante a busca** (mostra a última mensagem). Por
  isso a RPC devolve o trecho que casou, e a linha o exibe no lugar da prévia.

⚠️ **O salto da busca dentro do fio roda em JS, e isso tem prazo de validade.**
`src/lib/inbox/achados-no-fio.ts` (puro, 15 testes) enumera as mensagens que
casam DENTRO da conversa aberta; a rolagem, o destaque e o ↑/↓ estão em
`message-thread.tsx`. O que morde código novo:

- ⚠️ **Só funciona porque o fio carrega a conversa INTEIRA** (`.eq(...)
  .order(...)`, sem `limit`; a maior tem 158 mensagens). Pôr paginação ali
  faz o contador "2 de 5" mentir em silêncio — nada aqui percebe que faltou
  mensagem. **O teto de 1000 linhas do PostgREST chega sozinho**, por
  crescimento de dados, sem ninguém mudar código.
- ⚠️ **`semAcento()` usa `\p{Mn}`, nunca `\p{Diacritic}`.** A segunda faixa
  inclui o acento que existe SOZINHO (`^`, `` ` ``, `´`, `¨`, `~`): buscar
  `^^^` virava agulha vazia, e `includes("")` é verdadeiro para tudo —
  acendia todas as bolhas da conversa e o contador dizia "113 de 113".
- ⚠️ **As duas normalizações são próximas, NÃO idênticas, e nos dois
  sentidos.** Medido: o `unaccent` do Postgres dobra `…`, `–` e `×`; o JS
  não. Há teste fixando a divergência — replicar a tabela do `unaccent` faria
  o código AFIRMAR uma equivalência que não teria.
- ⚠️ **O piso de 3 caracteres é medido no termo NORMALIZADO**, como no banco,
  e o termo vai `.trim()`ado para a RPC (o `btrim` do Postgres apara só o
  U+0020).
- ⚠️ **A supressão do auto-scroll é solta por AÇÃO do operador** — enviar,
  anotar **e rolar à mão** (`wheel`/`touchmove`, nunca `scroll`: o próprio
  salto escreve `scrollTop` e dispararia um). Suprimir para sempre fazia a
  mensagem recém-enviada nascer abaixo da dobra sem nada rolar até ela; não
  soltar na rolagem fazia a chegada de mensagem nova arrastar de volta quem
  estava lendo o contexto em volta do achado.
- ⚠️ **`messages` nas dependências do efeito que centraliza é load-bearing:**
  no resync o fio vira spinner, o `scrollHeight` desaba e o navegador grampeia
  o `scrollTop` em zero — sem isso ninguém re-centraliza, porque o `alvoId`
  não mudou.
- **A âncora é `messages.id`**, nunca `message_id` (o wamid).

⚠️ **A tela global de agendadas (`/agendadas`) é irmã da faixa do fio, não
substituta.** `src/hooks/use-agendadas-da-conta.ts`,
`src/lib/scheduled/tela-global.ts` (puro, com teste) e
`src/hooks/use-acoes-da-agendada.ts`. O que morde código novo:

- ⚠️ **As ações ("Executar agora" e "Cancelar") moram no hook, não na tela.**
  Elas mandam mensagem a cliente e apagam registro; duas cópias divergindo nas
  guardas (`podeDispararAgora`) fazem o cliente receber duas vezes.
- ⚠️ **São TRÊS consultas.** Fila e acervo têm ordens opostas; numa consulta
  só com teto, o `ORDER BY` errado engoliria um dos dois inteiro. E **só as
  enviadas paginam** — falha de seis meses atrás ainda espera decisão, e é ela
  que a paginação empurraria para fora da tela.
- ⚠️ **O acervo ordena por `sent_at`**, não por `scheduled_for`: depois de um
  "Executar agora" as duas se separam de vez.
- ⚠️ **O canal exibido é o `channel_id` DA AGENDADA**, fixado no agendamento —
  aqui `canalDaConversa()` seria ERRADO, ao contrário do resto do projeto.
- **Contagem de aba vem do `count: 'exact'`** (viaja no cabeçalho, de graça),
  nunca de contar a lista carregada: com o acervo paginado, "Enviadas" diria
  50 numa conta com 300.
- **Números somem enquanto a carga falha.** Quatro zeros ao lado das abas
  afirmariam "não há nada" logo acima da caixa que admite não saber de nada.

⚠️ **Radar de Atendimento (941): worker + tabela + aba `/radar`.** A IA lê as
conversas dos últimos 7 dias e grava `cb_conversation_insights` (UMA linha
viva por conversa); o painel só lê. `src/lib/cb-radar/` (puro, testado),
`worker.ts` server-side, rotas em `api/cb/radar/`. O que morde código novo:

- ⚠️⚠️ **O PAINEL SÓ MOSTRA QUEM TEM GATILHO (`temGatilho`, 2026-08-30).**
  Até aqui a tela exibia TODA análise concluída, e o Radar virou boletim
  de todas as conversas: medido em produção, 7 dos 8 cartões abertos eram
  nota 9–10 sem nada a tratar ("resumos de conversas", nas palavras do
  operador). São quatro gatilhos, e só eles: insatisfação, pedido sem
  resposta, urgência média/alta, ou espera ≥ `LIMIAR_ALARME_MS`. Fora
  ficaram, DE PROPÓSITO: nota baixa sozinha (é julgamento, não pendência),
  `mencaoProcesso` sozinha (num escritório bancário quase toda conversa
  cita processo — como alarme seria ruído universal) e `pontosDeAtencao`
  (o campo que a IA usa para resumir o CASO: "detalhamento de dívidas
  bancárias"). A análise da conversa saudável **continua sendo gravada** —
  a nota média da semana sai dela; ela só não vira trabalho para ninguém.
- ⚠️ **Duas réguas de espera, e trocá-las é o erro fácil.**
  `LIMIAR_ALARME_MS` = 24h **CORRIDAS** decide se abre cartão;
  `LIMIAR_PENDENCIA_SEG` = 30min **ÚTEIS** decide só se a etiqueta
  aparece. Em horas úteis (11h/dia) "24h" seriam dois dias e meio de
  calendário e "48h" quase uma semana — o alarme chegaria tarde para quem
  escreveu na sexta. A exibição segue em horas úteis porque é a régua
  justa com a equipe.
  ⚠️ **O vão entre elas produzia CARTÃO MUDO** e foi fechado em 2026-08-31:
  quem escreveu sexta 19h30 e é olhado no sábado tem 24h corridas (entra na
  lista) e ~0 hora útil (etiqueta suprimida) — o cartão aparecia em "1 sinal
  aberto" sem UMA etiqueta dizendo por quê. A saída NÃO foi misturar as
  réguas: quando a de horas úteis não alcança o piso, a etiqueta cai para o
  INSTANTE (`semRespostaDesde`, "Sem resposta desde sex, 22/08 19:30"), que
  é verdade sem depender de régua nenhuma. Mexer numa das duas constantes
  sem olhar esse ramo devolve o cartão mudo.
- ⚠️ **A pendência é conferida AO VIVO na tela, não lida do banco**
  (`respostasDepoisDaPendencia`, em `use-radar.ts`). `aguardando_desde` é
  o retrato da última análise: entre a resposta do atendente e a próxima
  passada do worker somam-se o ciclo do agendador e o throttle, e até lá o
  cartão ficava na tela com o contador "aguardando há 26h" CRESCENDO sobre
  cliente já atendido. A conferência **falha para o lado do alarme**: erro
  de rede mantém o cartão, e lista TRUNCADA continua valendo (a consulta é
  DESC — o teto só pode omitir resposta ANTIGA, e faltar resposta mantém o
  cartão; descartar tudo no teto desligava a conferência inteira de vez,
  porque pendência congelada puxa o piso da consulta para semanas atrás).
  Mensagem APAGADA não conta como resposta (`deleted_at IS NULL`).
- ⚠️⚠️ **"Resposta de gente" NÃO é `sender_id IS NOT NULL`** — é
  `sender_id` preenchido **OU `from_device = true`**. O celular pareado
  (`persistDeviceMessage`) grava `sender_type='agent'` com `from_device`
  true e `sender_id` NULO: não há usuário do CRM por trás, mas há um
  advogado digitando. Medido em produção (2026-08-30): **948** mensagens
  da equipe são `from_device` contra **8** digitadas dentro do CRM — a
  versão só-`sender_id` reconhecia 8 de 978 e o alarme de 24h sobrevivia
  ao atendimento em quase todo caso real (achado da revisão do PR #72).
  Continuam NÃO fechando a pendência: broadcast, automação e fluxo (saem
  sem `sender_id` e sem `from_device`) — e a **AGENDADA**, que é o caso
  TRAIÇOEIRO: ela SAI COM `sender_id` (o `dispatch.ts` passa o
  `created_by` de quem a criou, dias antes, e o send-message persiste).
  Pela coluna sozinha ela conta como resposta; a proveniência que a
  denuncia é `cb_scheduled_messages.message_id`, e o worker E a
  conferência ao vivo a excluem por ele (achado do Codex no PR #74 — uma
  versão anterior desta nota afirmava que a agendada saía sem `sender_id`,
  e estava ERRADA). ⚠️ O
  `houveHumanoNaJanela` do worker usa a régua ANTIGA (só `sender_id`) —
  lá ela decide outra coisa (se preserva a análise congelada quando a
  janela não tem cliente), e uma saída `from_device` sozinha realmente não
  deveria refazer a análise. Não unificar as duas sem entender qual
  pergunta cada uma responde.
- ⚠️ **Análise `failed` aparece no painel INDEPENDENTE de gatilho.** A
  linha que esgotou as 3 tentativas fica com os defaults do schema
  (`urgencia='nenhuma'`, sem insatisfação, sem pedido): pelo filtro comum
  ela sumiria e o vazio afirmaria "nenhum sinal aberto" sobre conversa que
  o Radar NÃO CONSEGUIU LER, com a etiqueta de falha e o botão
  "Reanalisar" inalcançáveis. A consulta de RESGATE dela (M3) filtra
  `estado = 'aberto'` como a irmã da pendência: a tela só mostra abertas, e
  100 falhas tratadas/descartadas consumiam o resgate inteiro escondendo uma
  falha aberta mais antiga (Codex, PR #96).
- ⚠️ **O painel recarrega sozinho a cada 2 min com a aba visível.** O
  tique de 1 min só re-renderiza (reconta a espera); quem descobre que
  alguém respondeu é a consulta de `respondidas`. Sem a recarga, o cartão
  de cliente já atendido por um colega ficava na tela até o operador
  trocar de aba e voltar.
- ⚠️ **Insatisfação exige evidência recente — 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`, 22h úteis via `segundosUteisEntre`;
  era "48h corridas" até 31/08). A janela analisada tem 7 dias: sem a régua,
  irritação de terça já resolvida seguia acendendo cartão no domingo. Em
  CORRIDAS, porém, a reclamação analisada na sexta expirava no DOMINGO —
  antes de qualquer pessoa abrir o painel — e sem a aba "Todos" o sumiço era
  definitivo (#22). Não é "48h úteis" de propósito: isso inflaria a régua
  para ~6 dias corridos (o racional que manteve `LIMIAR_ALARME_MS` em
  corridas, apontado acima). As DUAS réguas (escrita e leitura) usam a MESMA
  unidade e SE SOMAM — o teto real é ~4 dias úteis, por desenho.
  ⚠️ **A âncora é o INSTANTE DA ANÁLISE (`agoraMs`), não a última linha do
  transcrito** — mudou em 2026-08-31. Ancorada na conversa, a régua não
  funcionava justamente no caso que a motivou: cliente reclama, a equipe
  responde e a conversa MORRE ali; o corte envelhecia junto com a última
  linha e nunca a alcançava, então o sinal ficava aceso para sempre sobre
  caso encerrado. A função segue PURA — quem chama passa o instante (o
  worker, `Date.now()`; os testes, um valor fixo), e há pino cobrindo os
  dois lados. Chamar `interpretarAnalise` sem o 3º argumento volta à âncora
  velha, de propósito, para não quebrar chamador antigo em silêncio.
- ⚠️ **Não existe mais aba "Todos"** (decisão do operador): listar toda
  conversa analisada era o próprio ruído que o filtro passou a cortar.
  Consequência que o desenho tem de sustentar: sem ela, um descarte errado
  esconde o alarme daquele cliente **para sempre** — `descartado` nunca
  reabre sozinho. São DUAS saídas, e nenhuma sobra: o "Desfazer" do toast
  (~4s) e o cartão que **FICA na lista enquanto a tela estiver aberta**,
  apagado e com o botão "Reabrir" (`mexidasAqui`, em `radar/page.tsx`). Só
  o toast não bastava — e foi o que houve até 2026-08-31, com o "Reabrir"
  como código morto, porque a lista só aceita `estado === 'aberto'`. Sair
  da tela limpa o conjunto: é o fim do expediente de triagem, e a aba
  "Todos" continua não existindo.
- ⚠️ **O falso NEGATIVO da IA não tem botão, e isso é decisão fechada
  (2026-08-31), não pendência.** Análise sem gatilho não entra na lista,
  então o "Reanalisar" dela é inalcançável — e a leitura ingênua ("falta um
  caminho de correção") leva direto a ressuscitar a aba "Todos", que é
  justamente o ruído que o operador mandou cortar. O que sustenta o NÃO: o
  `generateStructured` roda a temperatura padrão sobre o MESMO transcrito,
  então reanalisar um falso negativo tende a devolver o mesmo veredito —
  o botão custaria uma geração paga para repetir a resposta. E os casos em
  que reanalisar REALMENTE muda a resposta já têm caminho próprio:
  `status='failed'` entra na lista independente de gatilho (com o botão),
  `sem_ia` acende o aviso de conta que aponta para Integrações, e mensagem
  nova reanalisa sozinha pelo worker. Sobra só a troca de modelo/prompt,
  que é conta inteira e pediria um "reanalisar tudo" — não um botão por
  conversa. Quem for reabrir isto começa por aí, nunca pela aba.
- **NADA dispara sozinho** — mesma classe da 925: quem move é o agendador
  batendo em `/api/cb/radar/cron` (incluído no laço LENTO do
  `docker-stack.yml`). ⚠️ O CI não relê o `command` do `agendador`: a
  inclusão só vale depois de `docker stack deploy` manual na VPS.
- ⚠️ **`cb_channels.radar_enabled` nasce FALSE e é `=== true` na rota** — a
  exceção DELIBERADA à convenção "escopo vazio = todos": o Radar manda
  conversa de cliente para provedor de IA externo, e há canal de uso
  PESSOAL conectado na conta. Não "corrigir" para a convenção.
- **`authenticated` só tem SELECT na tabela.** Tratar/descartar passa por
  `PATCH /api/cb/radar/[conversationId]/estado` (service-role). UPDATE do
  navegador volta "0 linhas" com cara de sucesso — é o REVOKE da 941 agindo.
- **Sinal sem evidência é DESCARTADO pelo parser** (`interpretarAnalise`,
  rubrica.ts). É o princípio do produto — evidência = índice de linha do
  transcrito, mapeado para `messages.id`. Quem mexer na rubrica mantém a
  regra, senão o painel vira gerador de alarme falso.
- **Feedback por atendente exige AUTORIA, não só evidência**: a observação
  em `observacoes_por_atendente` só passa se citar linha ESCRITA pelo
  atendente nomeado (o transcrito rotula "Equipe (Nome)" via
  `messages.sender_id` → `profiles`; `LinhaDoTranscrito.autor` é o que o
  parser confere). Sem isso, cliente que digita "a Ana demorou" viraria
  auditoria da Ana. Nome não resolvido → rótulo genérico "Equipe" e a IA é
  instruída a não avaliar. Na tela, a seção só aparece para
  `useCan('manage-members')` — é avaliação de pessoa, não de conversa.
  ⚠️ **O gate é SÓ de renderização**: o dado viaja em `detalhes.analise`
  e a policy da 941 dá SELECT a qualquer membro — um `agent` lê a própria
  avaliação pela aba Network. Barreira real (pendente, na PRÓXIMA migration
  livre — a 943 virou a transcrição de áudio):
  coluna separada sem GRANT ao `authenticated` + rota server-side com
  `requireRole` + trocar o `select('*')` do hook por colunas nomeadas
  (senão a coluna sem grant derruba a consulta inteira). Decisão do
  operador se isso bloqueia o merge.
- **`generateStructured` (`src/lib/ai/structured.ts`) é separado de
  `generateReply` DE PROPÓSITO.** Não fundir: o caminho do
  auto-reply/draft não pode herdar regressão do caminho de análise.
- **Gemini**: chave SEMPRE no header `x-goog-api-key`, nunca `?key=` na
  URL (vaza em log de proxy). Embeddings/RAG continuam exigindo chave
  OpenAI (modelo fixo, `vector(1536)`). Em produção, chave do TIER PAGO —
  a faixa gratuita do Google pode usar os dados enviados.
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00** (o Brasil não tem
  horário de verão desde 2019) — `horario-comercial.ts` é o único arquivo
  a mudar se isso um dia voltar. Intervalo negativo (relógio do WhatsApp
  na entrada vs `now()` do banco na saída) vira zero lá dentro.
- ⚠️ **Ciclo de vida do sinal tem TRÊS regras assimétricas, todas com motivo:**
  `tratado` reabre SÓ com mensagem DO CLIENTE posterior ao `estado_em` (a
  resposta do próprio operador não reabre, e um clique dado durante a análise
  não é atropelado — o reset é um UPDATE condicional separado);
  `descartado` NUNCA reabre sozinho (descartar = "a IA errou"; reanálise
  repetiria o falso positivo a cada mensagem — reabre só pelo botão);
  `aberto` fica. Quem mexer no reset mexe no UPDATE condicional do worker,
  não no UPDATE principal.
  ⚠️ **UMA exceção escrita (#23, 31/08), e ela é ESTREITA:** descarte dado
  sobre linha `failed` que NUNCA teve análise concluída (`analisado_em`
  nulo no claim — `descarteFoiSobreFalha`) reabre quando a primeira análise
  BOA gravar. Ali o operador descartou o aviso "análise falhou", não um
  veredito — e a linha `failed` com tentativas < 3 reanalisa SOZINHA no
  ciclo seguinte, então sem a exceção o sinal real nascia invisível para
  sempre. Linha que já teve análise concluída fica na regra geral mesmo com
  falha por cima: o que o descarte rejeitou era conteúdo real. Não remover
  como "inconsistência" — o próximo leitor vai querer.
- ⚠️ **Toda escrita pós-claim do worker tem CERCA DE POSSE**
  (`.eq('status','running').eq('running_desde', <carimbo do próprio claim>)`).
  Sem ela, um worker recolhido como travado continuava com direito de escrita
  e atropelava a análise seguinte. ⚠️ O RECOLHEDOR tem a cerca dele próprio:
  o UPDATE exige o MESMO `running_desde` velho que o SELECT viu (`is null`
  quando nulo — `.eq()` nunca casa NULL). Entre os dois cabe uma reanálise
  manual TOMANDO o claim abandonado (#28 permite), e sem a cerca o recolhedor
  marcava `failed` o claim fresco e a escrita do worker vivo era descartada
  (Codex, PR #89). E **"mensagem nova" exige `janela_fim` NÃO
  NULO** — tratá-lo nulo como "tem novidade" furava o teto de tentativas e
  virava retentativa paga infinita (4 ângulos da revisão acharam).
- **A janela de mensagens lê DESC + reverse** — com mais linhas que o teto,
  quem cai é o COMEÇO da janela. Com ASC, o corte descartava as mensagens de
  HOJE e `aguardando_desde` mentia "ninguém aguardando".
- ⚠️ **Janela sem NENHUMA mensagem do cliente NÃO chama a IA** (só métricas;
  `detalhes.sem_cliente_na_janela`). Existe porque o ENVIO também atualiza
  `conversations.last_message_at`: sem o pulo, um broadcast tornava cada
  destinatário candidato e disparava dezenas de análises pagas de conversas
  onde só nós falamos. Janela COM fala do cliente reanalisa mesmo quando a
  novidade é só nossa — a resposta da equipe resolve pendência/pedido, e
  congelar a análise deixava alarme velho na tela. Não "otimizar" isso.
- ⚠️ **Nesse caminho, saída AUTOMÁTICA não fecha pendência.** Se a janela só
  tem máquina (nenhum cliente, nenhum `agent` com `sender_id` — broadcast,
  agendada, automação e fluxo mandam sem gente) e a linha JÁ tem análise
  completa, o worker faz um UPDATE preservador: avança só `janela_fim` e
  mantém a análise congelada INTEIRA (`aguardando_desde` incluído). Sem
  isso, um broadcast apagava o alarme do cliente esquecido — o caso que a
  exceção do painel existe para proteger. Resposta HUMANA na janela cai no
  UPDATE completo e fecha a pendência normalmente.
- **O transcrito colapsa repetição EXATA do robô** (`botRepetidas`, rubrica):
  fluxo reapresentando o mesmo menu entra uma vez só — **sobrevive a
  ocorrência mais RECENTE**, a mesma regra dos tetos (mantendo a primeira,
  o corte de cauda de conversa acima do teto a derrubava e o menu sumia
  inteiro). O prompt declara a omissão. HUMANO (cliente OU equipe) nunca é
  colapsado — insistência é exatamente o sinal que o Radar caça. Colapso
  não marca `janela_cortada`.
- **A legenda da tela (`como-funciona.tsx`) IMPORTA as constantes reais**
  (`JANELA_DIAS`/`THROTTLE_MS` de `ordenacao.ts`, `TETO_MENSAGENS` da
  rubrica, `CICLO_MINUTOS`) — por isso `THROTTLE_MS` mora em `ordenacao.ts`
  (client-safe), não no worker. Número digitado à mão no dicionário mente na
  primeira mudança de constante.
- **`loadAiConfig` do Radar usa `requireActive: false`** — o Radar precisa da
  CREDENCIAL; `is_active` é o interruptor do assistente DE CONVERSA. Amarrar
  os dois silenciava a análise quando o operador desligava o auto-reply.
- **O painel aplica a MESMA régua do worker na leitura**: esconde insight de
  conversa fora da janela de 7 dias e de canal com `radar_enabled` desligado
  (desligar o canal tem de sumir com as análises antigas dele — o caso
  nomeado é o canal pessoal ligado por engano). ⚠️ **UMA exceção: pendência
  aberta não expira.** Conversa parada além da janela com `aguardando_desde`
  e `estado='aberto'` FICA no painel (selo "parada há mais de N dias") —
  sumir com o cliente esquecido no 8º dia apagava o alarme quando ele fica
  mais grave. A análise congelada é fiel (nada mudou na conversa; a primeira
  resposta a reativa e o worker refaz), mas os CARTÕES ignoram
  urgência/insatisfação/nota dessas linhas via `foraDaJanela` — só a
  pendência conta.
- **O upsert em `cb_conversation_insights` FUNCIONA** porque o UNIQUE de
  `conversation_id` é TOTAL — não é o caso dos índices parciais da 903.
- `ai_usage_log.mode` ganhou `'radar'` e os CHECKs de `provider` ganharam
  `'gemini'` (941) — modo/provedor novo exige migration no CHECK, senão o
  `logAiUsage` engole o erro e o custo some do painel de uso.

⚠️ **Transcrição de áudio (943): função ÚNICA, Gemini-only, chave BYO.**
`src/lib/transcricao/transcrever.ts` (testado), rota
`POST /api/cb/transcricao/[messageId]`, colunas `transcricao_*` em
`messages`. Três chamadores da MESMA função idempotente: botão da bolha,
worker do Radar e (futuro) auto-reply. O que morde código novo:

- **A transcrição NUNCA vai para `content_text`** — o que o cliente
  escreveu e o que a máquina ouviu são coisas diferentes, e sobrescrever é
  irreversível (o original é NULL). Num CRM jurídico isso é inegociável.
- ⚠️ **O cadeado `UPDATE…RETURNING` não é opcional**: no deploy
  (`start-first`) há DOIS processos Node vivos e o rate limit é um Map em
  memória por processo — só o banco impede pagar o mesmo áudio duas vezes.
  Teto de tentativas DENTRO do WHERE; travada de 10 min recolhida pelo
  próprio cadeado. Escrita final e falha com cerca (`transcricao_desde`).
- ⚠️ **Sem chave Gemini (ou provedor ≠ gemini) devolve `recusada` SEM
  GRAVAR** — gravar o estado terminal mataria o botão para sempre por um
  problema de configuração passageiro. Mensagem apagada, não-áudio, conta
  errada e **áudio recém-chegado ainda sem `media_url`** (o webhook grava
  a mensagem primeiro e o arquivo segundos depois — janela de 2 min)
  também devolvem sem gravar. `recusada` GRAVADA é só para o irreversível
  da PRÓPRIA mensagem: URL relativa (proxy Meta exige sessão) em mensagem
  antiga, áudio grande demais, `MAX_TOKENS` (determinístico a temperatura
  0 — retentar pagaria o mesmo corte de novo) e tentativas esgotadas.
  A chave é resolvida PELO CANAL da conversa (como a análise) — sem isso,
  canal apontado para outro provedor mandava o áudio ao Google.
- **O modelo é FIXADO em `MODELO_TRANSCRICAO`** (`gemini-3.7-flash` desde
  2026-08-28; era `gemini-3.5-flash-lite`), separado do modelo de
  chat/análise da conta. Trocar de modelo/provedor é mexer SÓ neste módulo
  (plano B documentado: ElevenLabs, único com `audio/opus` por escrito —
  a doc do Gemini lista "OGG Vorbis" e a nota do WhatsApp é Opus).
  ⚠️ **Um modelo para os DOIS chamadores, de propósito.** Modelo por
  chamador (bom no botão, barato no Radar) foi avaliado e descartado em
  2026-08-28: não existe "transcrever de novo" — a idempotência devolve o
  texto gravado ANTES do cadeado e a bolha esconde o botão quando já há
  texto —, então quem chega primeiro fixa o modelo daquele áudio para
  sempre, nenhuma coluna registra qual escreveu o quê, e o teto de 3
  tentativas é compartilhado (falha do barato num áudio difícil carimba
  `recusada` terminal e mata o bom). Economia teto: R$ 4/mês.
  ⚠️ **Não desligar o raciocínio** (`thinkingConfig.thinkingBudget: 0`):
  corta a conta pela metade e piora o erro de 12,1% para 13,9% (medido).
  ⚠️ **Trocar o modelo NÃO refaz o que já foi transcrito** — não existe
  caminho de re-transcrição, e nenhuma coluna guarda o modelo (só dá para
  inferir por `transcricao_em`). Quem trocar de modelo decide, na mesma
  passada, se limpa `transcricao*` do acervo antigo para ele ser refeito.
  🔭 O `gemini-3.5-transcribe` mede melhor e custa menos, mas **não atende
  no `generateContent`** (200 com `parts: [{}]` vazio, cobrando a entrada)
  — vive na API de Interações. Em 2026-08-28 o modo `smart` apagava fala e
  diarização/timestamps devolviam zero anotações. Detalhes e a forma da
  chamada estão no comentário da constante, em `transcrever.ts`.
- **O worker do Radar transcreve SÓ áudio do CLIENTE e SÓ nunca-tentado**
  (`transcricao_status` nulo), até 5 por análise e dentro do `deadlineMs`
  do ciclo (reserva download + 2× o timeout de IA). ⚠️ `falhou` fica para
  o botão HUMANO — o retry automático a cada ciclo queimava o teto de 3
  em ~45 min e uma cota estourada carimbava `recusada` terminal em tudo.
  Falha/recusa NÃO derruba a análise — o áudio segue como lacuna
  declarada. O texto entra com `PREFIXO_AUDIO` (contrato com a rubrica:
  linha de áudio tem teto de 2.000 chars, não 500, e truncamento por
  linha é declarado ao modelo via `truncadas`).
- **A transcrição NÃO entra no índice GIN da busca (929)** — trade-off
  aceito no plano; busca por conteúdo de áudio é migration futura.
- O mime enviado é `messages.media_type` (042) → `Content-Type` do
  Storage → `audio/ogg`, nesta ordem.

⚠️ **Integrações é o lar das CHAVES e dos modelos por MÓDULO; Agentes de IA
ficou com o COMPORTAMENTO do agente de conversa.** `src/lib/integracoes/montar.ts`
(puro, com teste), a rota `GET /api/cb/integracoes/status` e
`src/components/settings/integracoes-panel.tsx`. A divisão nasceu de um engano
real: um único campo "Modelo" servia ao assistente, à resposta automática, ao
Playground **e ao Radar**, e o operador cadastrou um modelo "para o Radar"
configurando outra coisa. O que morde código novo:

- ⚠️ **Só o Radar tem coluna própria (`ai_configs.radar_model`, 946; NULL =
  herda `model`).** Transcrição e RAG já tinham modelo próprio — constantes
  no código (`MODELO_TRANSCRICAO`, `EMBEDDING_MODEL`). Nelas o problema era
  VISIBILIDADE, não separação, e continuam não-configuráveis.
- ⚠️ **O modelo do Radar aparece em TRÊS lugares do worker** — a chamada a
  `generateStructured`, o `logAiUsage` e a coluna `model` do insight.
  Resolver `config.radarModel ?? config.model` UMA vez e usar nos três;
  deixar um para trás faz a aba Uso e o cartão atribuírem o custo ao modelo
  errado, no exato lugar onde o operador iria conferir a separação.
- ⚠️ **`generateStructured` recebe o modelo por PARÂMETRO explícito**, nunca
  por `{...config, model}`: o spread não deixa rastro no tipo, e um merge do
  upstream que reescreva `structured.ts` devolveria o Radar ao modelo do
  chat sem quebrar o typecheck.
- ⚠️ **O formulário de Integrações ECOA os campos que não edita.** `POST
  /api/ai/config` reescreve a linha (`system_prompt` ausente vira NULL,
  `is_active` ausente vira false): salvar a chave a partir de Integrações
  sem devolver esses campos apagaria as instruções da empresa e desligaria o
  assistente — a partir de uma tela que fala de outro assunto.
- ⚠️ **`radar_model` ausente do corpo = "não mexe"** (mesma convenção de
  `handoff_agent_id`), senão um save vindo de Agentes zeraria o modelo do
  Radar configurado na outra tela.
- ⚠️ **O modelo do Radar é validado no SAVE, contra o provedor** — inclusive
  quando muda só o PROVEDOR (senão um `radar_model` do Gemini sobrevive à
  troca para OpenAI e o Radar falha de madrugada). O ping da aba testa só o
  modelo do CHAT, de propósito: pingar o do Radar custaria uma segunda
  chamada paga a cada carga de tela.
- ⚠️ **DECISÃO DE PRODUTO (operador, 2026-08-28): configuração POR MÓDULO,
  uma para a conta inteira.** O modelo e a chave de cada módulo valem para
  TODAS as conexões — nunca chave por conexão. Por isso `montar.ts` lê só o
  agente PADRÃO e a lista de canais aparece SÓ no Radar, onde significa o
  interruptor `radar_enabled` (privacidade, 941), não escopo de chave. A
  transcrição não lista canal nenhum. ⚠️ O backend (`loadAiConfig`) ainda
  resolve canal→padrão e o schema da 903 ainda permite linha por canal —
  mas NÃO existe escritor de agente por canal no app. Se um dia esse
  escritor nascer, `montar.ts` tem de voltar a espelhar a resolução do
  backend, senão a tela mente.
- ⚠️ **`?ping=0` existe porque cada ping é uma GERAÇÃO PAGA por agente.** A
  tela carrega em dois tempos (config na hora, pings depois) e o botão
  repete só os pings. O `useEffect` tem guarda própria (`disparouRef`)
  porque o StrictMode do `next dev` dobraria as chamadas pagas.
- **Nenhuma chave sai da rota de STATUS, nem mascarada** — ali a falha volta
  como CÓDIGO, nunca como `AiError.message` (a mensagem da OpenAI ecoa a
  chave enviada: "Incorrect API key provided: sk-…abcd"). ⚠️ O SAVE do
  modelo do Radar (`/api/ai/config`) é DIFERENTE de propósito: devolve a
  mensagem do provedor, porque é ela que diz "modelo não encontrado" —
  EXCETO quando `code === 'invalid_key'`, o único caso que ecoa chave, que
  vira texto genérico. Quem mexer ali preserva essa exceção.
- **`MODELO_TRANSCRICAO` e `EMBEDDING_MODEL` entram em `montarCartoes` por
  PARÂMETRO**, importados na rota — nunca redigitados no módulo puro nem no
  dicionário, senão a tela mente na primeira troca.
- **Radar exige `radar_enabled === true`** (exceção deliberada à convenção
  "vazio = todos", acima); transcrição é Gemini-only; RAG é OpenAI-only e
  aparece no cartão da OpenAI mesmo quando o chat da conta é outro provedor.
- **Módulo sem uso ativo NÃO some da lista** — aparece marcado com o motivo.
  Esconder era o que a primeira versão fazia, e é justamente o caso em que o
  operador mais precisa da tela: ele acabou de cadastrar a chave e precisa
  descobrir que o Radar está desligado na conexão.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list**: o
  campo continua aceitando qualquer id e o servidor gravando qualquer string
  não vazia. Ids de modelo mudam mais rápido que a lista.
- ⚠️ **MEDIDO em 2026-08-28: `gemini-3.5-transcribe` NÃO serve.** O modelo
  dedicado existe no catálogo e responde HTTP 200, mas devolve `parts: [{}]`
  e ZERO tokens de saída pelo `:generateContent` — testado em três formas de
  chamada sobre cinco áudios reais, enquanto o `gemini-3.5-flash-lite`
  transcreveu todos. Quem tentar de novo precisa de outra superfície de API,
  não de outra configuração.
- **Google Agenda é cartão "não conectado" de propósito**: a integração não
  existe no código (as colunas `google_*` da 945 nascem nulas). Quando ela
  for construída, é este cartão que vira o ponto de conexão.

⚠️ **API pública: as features do fork têm escopo E rota, sempre em par.**
Escopo sem endpoint não faz nada, e endpoint sem escopo é buraco. Os dez
escopos novos (`tasks|scheduled|deals|meetings|notes:read|write`) moram em
`src/lib/api-keys/scopes.ts` (sem migration — a coluna é `text[]`) e as
rotas em `src/app/api/v1/`. O que morde código novo:

- ⚠️ **Toda rota v1 roda em SERVICE-ROLE e ignora RLS** — cada consulta
  precisa do `.eq('account_id', ctx.accountId)` explícito, inclusive os
  lookups secundários (`profiles`, `contacts`, `conversations`, `pipelines`).
- ⚠️ **Erro de banco NÃO é "não encontrado".** Um `maybeSingle()` que
  descarta o `error` transforma timeout do PostgREST em `404 Contact not
  found` — e o integrador recria o contato, duplicando. Trate o erro antes
  do vazio.
- ⚠️ **Instante vindo da API exige OFFSET escrito** (`Z` ou `±HH:MM`) em
  `scheduled_for` e na janela `from`/`to` das reuniões. O navegador sempre
  manda; um integrador não, e sem offset o Postgres lê como UTC — a
  armadilha de 3h da 935, que não estoura em lugar nenhum.
- ⚠️ **`POST /api/v1/deals` exige `stage_id` e recusa segundo card do mesmo
  contato** (409 `contact_already_has_deal`). Etapa por `MIN(position)`
  despeja o lead na faixa de estacionamento, e o índice único da 911 só
  cobre `source='channel'` — a regra semântica é de código.
- **Escrita de negócio pela API chama `drenarEventosDeFunil()`** (fire-and-
  forget), como a tela faz: sem isso a automação de etapa espera o próximo
  batimento do agendador — o laço RÁPIDO do `docker-stack.yml`, `sleep 60`
  (uma versão desta nota dizia "15 min", que é o laço LENTO; o próprio #74
  mediu e corrigiu `lembretes.ts` e `DEPLOY-VPS.md`, e esta linha ficou).
- **Nome carimbado vem de `resolveApiAuthor`** (`src/lib/api/v1/authorship.ts`):
  usuário de auditoria da v1, com queda para o DONO da conta quando aquele
  já saiu — e `membro: false` quando nem o dono resolve. Quem exigir um
  membro de verdade (dono de reunião) confere esse sinalizador.
- **Grupo continua fora da v1** (`.is('group_id', null)` nas conversas), e a
  agendada resolve canal por `cb_groups` quando a conversa é de grupo.

⚠️ **UI de canal: peças próprias, prefira reusá-las.** `src/hooks/use-channels.ts`
(uma busca por montagem, falha silenciosa), `src/lib/cb-channels/display.ts`
(funções puras, com teste) e `src/components/channels/` (`ChannelBadge`,
`ChannelCell`, `ChannelScopeBadge`, `ChannelSelect`, `ChannelMultiSelect`,
`ChannelFilter`). Convenções que valem em toda tela nova:

- **Escopo vazio = TODOS os canais**, nunca "nenhum" — igual ao motor
  (`channelInScope`, `findEntryFlow`). Uma tela que disser "nenhum canal" onde o
  motor lê "todos" faz o operador desativar a regra errada.
- **Seletor some com menos de 2 canais.** Numa conta de um número ele não decide
  nada e só ocupa espaço.
- **Registro sem `channel_id` mostra travessão**, nunca o canal padrão: em
  registro anterior à 903 o disparo pode ter vindo de outro número.
- **Filtro não esconde o irrestrito.** Uma automação sem escopo dispara em todos
  os números e continua visível sob qualquer filtro.
- ⚠️ **O nome da instância Evolution é DERIVADO DO RÓTULO e fixado na criação**
  (`buildChannelInstanceName`): "CBAdv" → `cbadv-3f2a91`. O **sufixo aleatório
  não é enfeite** — `provisionEvolutionInstance` é create-or-**adopt** por
  nome, então rótulo batendo com instância já existente no servidor
  compartilhado faria o CRM assumi-la e reapontar o webhook dela, em silêncio
  e com 200. Renomear o canal depois **não** renomeia a instância:
  `instance_name` é a chave de roteamento da entrada e a Evolution não
  renomeia (seria apagar e recriar, perdendo pareamento e `api_key`).

⚠️ **`src/components/ui/select.tsx` divergiu do upstream — não deixar sobrescrever.**
O `<Select.Value />` do base-ui mostra o **valor cru** quando o `Root` não recebe
`items`: a tela de Agentes exibia literalmente `openai` e `__queue__` para o
usuário, e o editor de fluxos, `keyword`. Nosso `Select` agora **deriva `items`
percorrendo os próprios `<SelectItem>` da árvore**, então todo call site (~20)
mostra o rótulo certo sem mudar nada. Ao mesclar upstream, manter o wrapper.

- O wrapper repassa os genéricos `<Value, Multiple>`. Tipá-lo com o
  `Root.Props` não-genérico apaga a inferência e joga o `onValueChange` de
  todo call site para `any` implícito (20 erros de typecheck de uma vez).
- A lista é memoizada por **assinatura**, não por `children` — `children` tem
  identidade nova a cada render, e o `store.update` do base-ui compara com
  `Object.is`, então sem isso os assinantes eram notificados à toa.
- Rótulo que é JSX (não texto) entra na assinatura por posição. Quem precisar
  de rótulo dinâmico complexo no gatilho passa a função em `<SelectValue>` —
  é o que `channel-select.tsx` faz, para o gatilho mostrar só o nome do canal
  em vez da linha inteira com bolinha e telefone.

⚠️ **Etapa com RESULTADO (950): quem carimba ganho/perdido é o BANCO.**
`pipeline_stages.resultado` ('ganho'|'perdido'|null) + gatilho BEFORE em
`deals`: ENTRAR numa etapa marcada grava o status — para os CINCO escritores
de etapa (painel da conversa, arrasto, formulário, RPC das automações, API).
O que morde código novo:

- ⚠️ **SAIR de etapa marcada para etapa neutra NÃO reabre** — decisão do
  operador (fluxo: fechou → transfere para o funil do jurídico → CONTINUA
  ganho). Não "corrigir" para o modelo Kommo. Reabrir é só por botão ou por
  entrar em etapa com outro resultado.
- **Etapa marcada VENCE status explícito no mesmo update**; o Reabrir muda só
  o status (sem tocar etapa) e o gatilho passa reto — de propósito.
- **`src/lib/pipelines/resultado.ts` é ESPELHO do gatilho** (para o selo
  aparecer sem refetch). Quem mudar a regra muda nos DOIS, e o teste fixa o
  comportamento MEDIDO em produção.
- Ganho/perdido **não some com nada**: card fica na coluna (selo), conversa
  intocada; sai das métricas de aberto e entra em "Ganhos no mês".

⚠️ **Três armadilhas de LAYOUT que já quebraram tela e voltam a quebrar.** As
três passam em revisão de código, em typecheck e em teste — só aparecem na tela,
e as três já morderam de verdade.

- ⚠️⚠️ **O tailwind-merge só desempata classes com o MESMO prefixo de
  variante.** `cn("group-data-horizontal/tabs:h-8", "h-auto")` devolve as
  **duas** (medido com o twMerge do projeto), e a variante vence quando o
  seletor casa. Foi assim que a ficha do contato quebrou: o `TabsList` de
  `src/components/ui/tabs.tsx` traz `group-data-horizontal/tabs:h-8`, o
  `contact-detail-view.tsx` passava `h-auto` para poder usar `flex-wrap`, o
  `h-8` sobreviveu — e as 8 abas, quebradas em 3 linhas dentro de uma caixa de
  32px, foram renderizadas **por cima** dos campos do painel. A correção é
  repetir o prefixo (`group-data-horizontal/tabs:h-auto`), não remover o
  `h-auto`. **Vale para qualquer override de classe que o primitivo declare sob
  variante** — `group-*`, `data-*`, `dark:`, `sm:`. Na dúvida, meça:
  `node -e "console.log(require('tailwind-merge').twMerge('<a> <b>'))"`.
  ⚠️ **A MESMA tela tinha a MESMA armadilha na largura**, e essa era a causa de
  as abas precisarem de 3 linhas: o `sheet.tsx` traz
  `data-[side=right]:sm:max-w-sm`, o call site pedia `sm:max-w-lg w-full` cru, e
  o painel abria com **384px em vez de 512px** — aqui o override ainda perde por
  ESPECIFICIDADE, porque a classe do primitivo carrega o seletor de atributo.
  Com o prefixo (`data-[side=right]:sm:max-w-lg`), 512px e 2 linhas de aba. Ou
  seja: quando uma tela parece "apertada demais", desconfie da largura ANTES de
  reflowar o conteúdo — pode ser este bug, não falta de espaço.
  ⚠️ **Prefixe só o `max-w`, NUNCA o `w-full` junto.** Prefixado, o `w-full`
  passa a vencer o `data-[side=right]:w-3/4` do primitivo e abaixo de `sm` o
  painel vira TELA CHEIA — sem fundo sobrando para fechar tocando fora, que no
  celular é a única saída à mão. Com `w-3/4` o desktop dá os mesmos 512px (3/4
  de 1440 estoura o teto de qualquer jeito) e o celular mantém a saída.
  São QUATRO os `SheetContent` do repo — `contact-detail-view.tsx`,
  `pipelines/deal-form.tsx` e os DOIS de `flows/flow-canvas.tsx` (o painel do
  nó; uma versão anterior desta nota dizia "dois" e o flow-canvas ficou de
  fora, abrindo com 384px em vez dos 448px pedidos até a revisão 48h).
  Todos com o `max-w` prefixado; arrumar só parte deles deixa painéis irmãos
  com larguras diferentes. Quem criar um `SheetContent` novo confere os
  quatro e repete o padrão.
- ⚠️ **`<ScrollArea>` dentro de `flex-col` precisa de `min-h-0`, sempre.** Filho
  de flex nasce com `min-height: auto`, e o Root do base-ui só põe
  `position: relative` — o `overflow` fica `visible`, então o clamp não é
  anulado e o painel **cresce** para caber o conteúdo em vez de encolher para o
  espaço restante. O conteúdo vaza, é cortado por um `overflow-hidden` de
  ancestral, e **não aparece barra nenhuma** (o base-ui esconde a barra nativa
  por CSS e a própria é `position: absolute`) — o operador vê a informação
  sumir, não uma barra que não rola. Já mordeu três vezes: `conversation-list`
  (issue #229), `contact-sidebar` e `group-sidebar` (as notas do lead ficavam
  fora de alcance).
- ⚠️ **`scrollHeight` não inclui a borda, mas `style.height` sob `border-box`
  inclui.** Autosize de `<textarea>` que faça `el.style.height = scrollHeight`
  rouba a borda do espaço do texto e acende a barra de rolagem com UMA linha
  digitada. Some a borda de volta: `el.offsetHeight - el.clientHeight` (medido
  com `height: auto`). É o que `message-composer.tsx` faz — é o único autosize
  do repo; os outros `<textarea>` têm `rows` fixo.
- ⚠️ **`max-width` NÃO se herda, e `align-items: flex-start` dimensiona o
  filho por `fit-content`.** A bolha do fio (`message-bubble.tsx`) mora dentro
  de um `flex flex-col items-start`, cujo pai já carrega o teto de 75% do
  `<MessageActions>`. O teto funcionava — medido, o pai resolvia em 355px —, e
  a bolha saía com **1040px** assim mesmo, porque `flex-start` a dimensiona
  pelo conteúdo e nada a limitava: uma URL sem espaços
  (`https://pje.tjce.jus.br/…`) vazava para fora e acendia **barra horizontal
  na conversa inteira** (contêiner 505px, `scrollWidth` 1056px). A cura é
  `max-w-full` NA BOLHA. ⚠️ E o `break-words` do `<FormattedText>` não
  salvava: ele só parte a palavra quando ela NÃO CABE — sem teto, cabia
  sempre. Reportado da tela pelo operador em 2026-09-01. **Vale para qualquer
  filho de flex alinhado com `items-start`/`items-end` que possa receber texto
  de fora**; `truncate` também depende disso (nome de anexo longo estouraria
  igual).
- ⚠️ **A COLUNA DA LISTA do inbox precisa de `min-w-0` no wrapper da página
  (`inbox/page.tsx`), e o defeito só existe no CELULAR.** Item de flex nasce
  com `min-width: auto`, e a largura mínima da coluna era o texto SEM QUEBRA
  mais longo lá dentro — a prévia da última mensagem é `truncate`, que é
  `nowrap`. Medido a 375px em 09/09/2026: a coluna saía com **3.042px**, e a
  caixa de busca, as abas e a fileira de visões ficavam cortadas na borda
  direita (reportado da tela pelo operador). No desktop a lista tem largura
  fixa (`lg:w-80`) e nada aparece — foi assim que passou meses despercebido.
  O fio já tinha o seu `min-w-0` (Issue #165); a lista não.
- ⚠️ **O compositor QUEBRA linha no celular** (`flex-wrap sm:flex-nowrap`, a
  `<textarea>` com `order-first basis-full` e `sm:basis-0` devolvendo o
  `flex-1`): são sete botões de 36px numa tela de 375px, e a caixa de texto
  sobrava com 85px — "Digite uma" quebrando no meio (operador, 09/09/2026).
  Abaixo de `sm` a caixa ocupa a linha inteira e os botões descem, com
  gravar/agendar/enviar à direita (`max-sm:ml-auto` no microfone E no enviar
  — o segundo só age em somente-leitura, quando o microfone não é
  renderizado); a dica do ✨ some ali (`hidden sm:block`), senão vira três
  linhas de 10px embaixo de um compositor que já ocupa duas.
- ⚠️ **Filho direto do `DialogContent` precisa de `min-w-0` quando carrega
  texto com `truncate`.** O `DialogContent` é `grid`, e item de grid nasce
  com `min-width: auto`; `truncate` é `nowrap`, então o intrínseco do filho
  vira a largura do TEXTO INTEIRO numa linha — medido no dialog de executar
  automação: card com 448px e conteúdo com 1124px, a busca atravessando a
  tela. O `min-w-0` no wrapper direto devolve o clamp e o `truncate` volta a
  funcionar. (Primo do caso `<ScrollArea>`/flex acima — mesma família:
  `min-width: auto` anulando o limite do pai.)

⚠️ **QUEM ABRE NEGÓCIO: os dois sentidos da conversa, decididos por GENTE.**
Até 2026-08-31 só a mensagem RECEBIDA chamava `routeContactToPipeline` (que
até então se chamava `routeInboundToPipeline`). Medido em produção naquele
dia: **1.041** mensagens da equipe saíram pelo celular pareado contra **8**
digitadas dentro do CRM — o caminho por onde o escritório realmente trabalha
nunca abria negócio, e cliente que nunca respondeu ficava fora do funil para
sempre. O que morde código novo:

- ⚠️ **O gancho do ENVIO mora no NÚCLEO (`sendMessageToConversation`), e é a
  escolha do LUGAR que define a regra.** Por ali passam os quatro envios de
  gente: compositor, ficha do contato, agendada e API v1. Broadcast
  (`src/lib/whatsapp/broadcast-core.ts` e `broadcast-resume.ts`) e
  automação/fluxo/IA **não passam** — e é assim que ficam de fora sem uma
  linha de guarda. ⚠️ **Há DOIS `meta-send.ts`**: o sender REAL do robô é
  `src/lib/flows/meta-send.ts` (fluxo, resposta de IA e mídia de automação
  saem por ele); `src/lib/automations/meta-send.ts` é só um wrapper que
  delega para ele. Uma versão desta nota citava "meta-send.ts" sem caminho e
  o teste estrutural passou a vigiar o wrapper — o sender real ficou
  descoberto (achado #14 do plano de 31/08). Um disparo para 500 contatos
  abriria 500 cards de uma vez; "o robô respondeu" não é o escritório
  decidindo abordar ninguém.
  ⚠️ O teste estrutural (`pipeline-routing.chamadores.test.ts`) agora tem
  uma varredura DEFAULT-DENY: quem citar `routeContactToPipeline` ou
  `sendMessageToConversation` fora da allowlist explícita reprova por
  padrão — sender novo entra na allowlist por decisão visível no diff, não
  por esquecimento. "Reusar o núcleo de envio no broadcast" parece limpeza
  de código e traz o roteador junto, escondido.
- ⚠️ **Via `supabaseAdmin()` no núcleo**, como o carimbo de canal ao lado: a
  rota `/api/whatsapp/send` entrega o client do OPERADOR (sob RLS), e o
  roteador lê `accounts` e escreve em `deals` — sob RLS um `agent` deixaria
  de abrir card em silêncio.
- **Abrir conversa NÃO cria negócio** (decisão do operador): o card nasce no
  primeiro ENVIO. Número digitado errado viraria card no funil para alguém
  caçar e apagar à mão. Ver `POST /api/cb/conversas/abrir`.
- **Não houve migration de recuperação**, de propósito: o gatilho é por
  ESTADO ("este contato já tem card?"), então as conversas que ficaram sem
  card se resolvem sozinhas na próxima mensagem trocada, em qualquer sentido.

⚠️ **Iniciar conversa pelo CRM (`POST /api/cb/conversas/abrir`).** Botão no
cabeçalho da lista do inbox → `nova-conversa-dialog.tsx`. ABRE, não envia:
cria/reencontra contato e conversa, **FIXA** o canal escolhido
(`pinConversationChannel`, não `follow` — quem clicou escolheu) e devolve o
id; a página recarrega a lista e navega por `?c=`. O que morde código novo:

- ⚠️⚠️ **`contacts.user_id`, `conversations.user_id` e `custom_fields.user_id`
  são `ON DELETE CASCADE` para `auth.users`, e `conversations.contact_id`
  cascateia de novo.** Todo caminho que CRIA contato, conversa ou campo grava
  o **dono da conta** (`accounts.owner_user_id`, NOT NULL — no client vem de
  `useAuth().ownerUserId`), nunca o membro que clicou — senão, no dia em que o
  LOGIN dessa pessoa for apagado, o contato é apagado junto e leva a conversa
  e TODAS as mensagens daquele cliente, que são do escritório. ⚠️ O gatilho
  NÃO é "remover da equipe" pela UI (`remove_account_member` e a 961 só
  realocam o perfil, sem tocar `auth.users`): é apagar o usuário FORA do app —
  dashboard do Supabase ou admin API, o passo normal de offboarding. Isso já
  nasceu errado três vezes (rota de abrir no #79; `/api/whatsapp/send`,
  formulário/CSV e o CSV do broadcast até o plano de 31/08): a tela tem o
  `user` em mão, `user_id: user.id` parece óbvio, passa no typecheck e
  funciona. Sem o dono resolvido a criação FALHA — nunca cair para `user.id`.
  Há varredura estrutural de `src/**` com allowlist exata
  (`src/lib/contacts/dono-duravel.test.ts`) porque isto volta.
  ⚠️ **E a POSSE também precisa ser durável (971).** `accounts.owner_user_id`
  é `ON DELETE RESTRICT`: o dono vigente nunca é apagável do `auth.users` —
  o primeiro dia em que um ex-dono pode ser apagado é o dia seguinte à
  transferência, e tudo que a conta carimbou com ele no mandato iria junto.
  Por isso `transfer_account_ownership` REPARENTA `contacts`,
  `conversations` e `custom_fields` para o novo dono na mesma transação
  (Codex, PR #90). SÓ essas três, de propósito: `tags`, `message_templates`,
  `pipelines`, `automations`, `flows`, `broadcasts` e cia. têm o MESMO
  CASCADE, mas guardam quem CRIOU e telas do upstream ainda filtram por
  essa coluna — mover mudaria o que cada pessoa vê; é decisão de produto
  pendente (M24 do plano de 31/08), não carona.
- ⚠️ **Selecionar a conversa recém-aberta NÃO pode depender do `?c=`.** O
  refetch (`resyncToken`) e o `router.replace` saem juntos, e se a consulta
  voltar antes de a navegação propagar os searchParams, `deepLinkConvId`
  ainda tem o valor ANTIGO — a conversa nova não é selecionada e nada se
  recupera depois, porque o efeito da lista só reage a `resyncToken`. Fica a
  URL apontando para a conversa certa com o centro VAZIO. Por isso existe
  `conversaRecemAbertaRef` na página do inbox, consumida antes do caminho de
  deep link. (Também do Codex no #79 — o fluxo passou no teste manual porque
  a navegação costuma ganhar a corrida.)
- ⚠️ **O teto de 15 dígitos é load-bearing.** `findExistingContact` casa
  pelos ÚLTIMOS 8 DÍGITOS com tolerância a tronco, então um JID de grupo
  (~18 dígitos) colado no campo poderia FUNDIR com o celular de um cliente
  real. `isValidE164` barra nos dois lados (tela e rota).
- **Reusa `findExistingContact`**, não uma busca própria: sem isso, digitar
  o número com o nono dígito quando o cliente já existe sem ele criaria uma
  segunda ficha, cada uma com metade do histórico.
- **A conversa nasce sem `last_message_at`** e, com `nullsFirst: false`, vai
  para o FIM da lista até a primeira mensagem. Ela abre selecionada e a
  busca a encontra ("Nenhuma mensagem ainda"), mas quem mexer na ordenação
  precisa saber que existe conversa legítima com a coluna nula.
- **A rota confere POSSE do canal, não escopo de perfil** — nenhuma rota
  deste projeto valida `canalNoEscopo` hoje. Ver o comentário no arquivo.

⚠️ **Negócio (`deals`) só nasce por `src/lib/deals/create-deal.ts` no servidor.**
A 908 deu à conexão um funil padrão, e o roteador de entrada
(`src/lib/cb-channels/pipeline-routing.ts`) seria o terceiro escritor de deal
— por isso a regra foi consolidada num módulo só. Quem for criar negócio em
código novo chama `createDeal`, não `.from('deals').insert(...)`. O formulário
da tela de Funis é a exceção (roda no client, sob RLS).

Coisas da 908 que mordem código novo:

- **A etapa de entrada é explícita (`default_stage_id`), nunca `MIN(position)`.**
  O funil real desta conta tem `position` 0 = "Contato Avulso" e 1 =
  "Desqualificado"; a entrada é "Lead", na 2. Resolver por posição despeja o
  cliente numa faixa de estacionamento — e com negócio parado lá,
  `deals_stage_pipeline_fkey` (NO ACTION) trava reestruturar aquela etapa.
- **As FKs de `deals` para funil/etapa/canal são COMPOSTAS** (`(pipeline_id,
  account_id)`, `(stage_id, pipeline_id)`, `(channel_id, account_id)`), na
  mesma forma que a 903 deu a `conversations`. A ingestão roda em service-role
  e ignora RLS: FK simples só garante "existe uma linha com esse id".
- **`deals.user_id` virou anulável com `ON DELETE SET NULL`.** Os cards
  automáticos pertencem todos ao dono da conta; o CASCADE anterior apagaria o
  funil inteiro se essa pessoa saísse do `auth.users`.
- **`deals.contact_id` é NULLABLE** (a 001 diz NOT NULL, mas a 004 dropou), e
  `routeContactToPipeline` depende disso: sem a guarda `if (!contactId)`, uma
  conversa de grupo criaria card órfão que renderiza em branco no Kanban.
- O roteador dispara por **estado**, não por evento. `first_inbound_message`
  não serve: é contado por conversa e há uma conversa por contato por conta
  (036), então cliente que muda de número nunca dispararia.
- **`deals.channel_id` é do NASCIMENTO do card**, não de onde ele está agora.
  Recorte por canal responde "por qual número o cliente chegou". Negócio
  criado à mão fica com a coluna nula e some de qualquer filtro por canal —
  por isso a etiqueta do painel é "Originados neste número", não "Conta
  inteira".
- **`deals.conversation_id` passou a ser escrito (910).** A FK virou
  `(conversation_id, account_id)` com `ON DELETE SET NULL (conversation_id)`
  — antes era NO ACTION, e preencher a coluna fazia **apagar contato** e
  **remover membro da equipe** estourarem violação (os dois cascateiam em
  `conversations`). Quem for gravar essa coluna em código novo não precisa
  validar posse: a FK composta já barra conversa de outra conta.
- **Apagar funil ou etapa mexe em conexão.** `cb_channels.default_pipeline_id`
  e `default_stage_id` zeram via SET NULL, e o roteamento para em silêncio. A
  tela de Funis avisa; quem criar outro caminho de exclusão precisa avisar
  também. As funções `channelsUsingPipeline`/`channelsUsingStage` de
  `display.ts` respondem quem depende do quê.

⚠️ **Grupo de WhatsApp (906/916) NÃO é contato, e a distinção é load-bearing.**
`cb_groups` + `conversations.group_id`, com CHECK XOR contra `contact_id` (que
perdeu o NOT NULL). Só existe no transporte Evolution — a Cloud API da Meta não
entrega mensagem de grupo. O que morde código novo:

- **Nunca gravar grupo em `contacts`.** `findExistingContact` casa por LIKE nos
  ÚLTIMOS 8 DÍGITOS com `phonesMatch` tolerante a tronco; um JID de grupo tem
  ~18 dígitos e pode FUNDIR silenciosamente com o celular de um cliente real.
- **`conversations.contact_id` é NULLABLE.** Código novo que leia
  `conversation.contact.algo` precisa do caminho de grupo — hoje não há nenhum
  acesso não-opcional no repo, e vale manter assim.
- **Grupo não dispara automação, flow nem IA.** A garantia é ESTRUTURAL:
  `src/lib/cb-groups/persist.ts` não importa os motores, e há teste lendo o
  próprio fonte. Se um dia grupos entrarem nas automações, o import entra ali,
  visível na revisão — não atrás de uma flag.
- **A regra do `@lid` do 1:1 NÃO vale em grupo.** Lá o LID sem telefone é
  descartado para não criar contato falso; aqui o remetente é desnormalizado em
  `messages.group_sender_*`, sem FK e sem criar contato. Em produção 100% dos
  participantes chegam em `@lid`, então aplicar a regra do 1:1 esvaziaria o
  recurso.
- **`group/fetchAllGroups` da Evolution ESTOURA** (>90s com 58 grupos). Use
  `chat/findChats` filtrando `@g.us` — rápido e já traz nome e foto.
  `findGroupInfos` custa ~650ms/grupo e serve só para participantes, announce,
  admin e o nosso LID.
- **`GROUPS_UPDATE` não existe** na Evolution 2.3.2 e o enum recusa o pedido
  INTEIRO — incluí-lo derruba junto os eventos válidos da mesma lista.
  Assináveis: `GROUPS_UPSERT` e `GROUP_PARTICIPANTS_UPDATE`. ⚠️ A produção
  roda a **2.4** desde 09/09/2026, cujo enum tem `GROUP_UPDATE` — mas a lista
  do CRM ainda NÃO o inclui (ajuste 5 do `docs/PLANO-baileys-7.md`, pendente:
  exige conferir o enum da 2.4 e "Ressincronizar" as 4 conexões).
- **Ligar `cb_channels.groups_enabled` não basta**: instância já conectada só
  recebe os eventos novos depois de reaplicar o webhook ("Ressincronizar").
- **Menção chega em `@lid`, nunca em telefone** — daí `cb_channels.own_lid`
  (916), aprendido na 1ª mensagem nossa dentro de um grupo. Sem ele
  `messages.mentions_us` seria false para sempre.
- **`nullsFirst: false` na ordenação do inbox é load-bearing**: grupo
  sincronizado sem mensagem tem `last_message_at` NULL, e em DESC o Postgres
  põe NULL primeiro — 58 grupos vazios empurrariam as conversas ativas para
  baixo no instante em que o operador liga o recurso.
- **`CB_CHANNEL_SAFE_COLUMNS` precisa listar toda coluna de configuração** —
  fora dela o valor salva e some no reload (já mordeu com `default_agent_id`).
- **Insert em BLOCO preenche coluna ausente com NULL**, então `from_device` e
  `mentions_us` (NOT NULL) estouram se as linhas do lote não forem uniformes.
  O caminho de produção grava uma linha por vez e não é afetado.

✅ **RESOLVIDO (2026-08-27) — `maxDuration` NÃO é aplicado em produção.**
Conferido na VPS: `docker service inspect crm_crm` mostra Command/Args nulos e
o Dockerfile termina em `CMD ["node", "server.js"]` (standalone do Next) — o
`maxDuration` das rotas é decorativo aqui. **O teto real de cada rota de cron
é o `-m` do curl do agendador** (50s no laço rápido, 120s no lento; ver
`docker-stack.yml`). Quem escrever worker novo orça o ciclo contra o curl,
não contra o `maxDuration` — o worker do Radar faz isso (`TETO_ABSOLUTO_MS`).

⚠️ **A trilha de auditoria (912) é escrita por TRIGGER, não por código.**
`cb_lead_events` registra criação/exclusão de negócio, mudança de etapa, de
funil, de status e tag aplicada/removida. Foi para o banco porque há **6
escritores de `deals` e 9 de `contact_tags`**, metade no navegador direto
contra a tabela sob RLS — e porque já existiam dois helpers centrais de tag
(`tag-write.ts`, `tag-events.ts`) com **três** call sites de produção passando
por fora deles. O que morde código novo:

- **Não chame nenhum "logger" — não existe.** Insert/update/delete normal em
  `deals` ou `contact_tags` já gera o evento. Código que tentar gravar em
  `cb_lead_events` pelo cliente leva **42501**: `authenticated` só tem SELECT,
  e o REVOKE é essencial — sem ele um DELETE volta "0 linhas" (a RLS filtra) e
  parece ter dado certo.
- **Transferência entre funis tem de ser UM `UPDATE` só** (`pipeline_id` e
  `stage_id` juntos, como `deal-form.tsx` faz). Em dois updates a trilha grava
  duas linhas e conta a história errada: que o lead saiu e voltou.
- **A política de falha é assimétrica.** Erro ao gravar o evento **estoura**
  quando `auth.uid()` existe (ação de gente, erro aparece na tela) e é
  **engolido com WARNING** quando não existe (ingestão/automação) — porque
  `routeContactToPipeline` captura tudo e o lead simplesmente não viraria card,
  em silêncio.
- **`AFTER UPDATE OF pipeline_id, stage_id, status`** dispara quando a coluna é
  *mencionada*, mesmo sem mudar — e o formulário manda as três em todo save. O
  `IS NOT DISTINCT FROM` no topo do trigger é o que evita linha falsa a cada
  edição de anotação; não remova.
- **Rótulos são gravados junto com os IDs, de propósito.** Etapa que o lead já
  deixou pode ser apagada, e renomear reescreveria o passado em silêncio.
  `from/to_stage_position` existe para responder "foi avanço?" — comparar
  posição **entre funis diferentes** é comparar réguas distintas, e
  `direcaoDoMovimento` devolve `null` nesse caso.
- **`deal_deleted` não aparece no chat**, só na ficha: apagar um funil
  cascateia todos os negócios dele e despejaria uma linha solta em centenas de
  conversas sem relação. Linha `reconstructed` também fica fora do chat.
- **CHECK de forma não pode exigir `contact_id`**: apagar contato faz SET NULL
  nessa coluna, que é um UPDATE, e UPDATE revalida CHECK — exigir o contato
  faria a exclusão de contato falhar.

⚠️ **Fechar `EXECUTE` de função exige revogar de PUBLIC *e* dos papéis — e
conferir depois.** A forma da concessão **varia por função**, conforme o
`ALTER DEFAULT PRIVILEGES` que valia quando ela nasceu, e olhar só uma das duas
engana. Os dois formatos que existem hoje neste banco:

```
funções cb_* (901/903/912)
  {=X/postgres, postgres=X/postgres, service_role=X/postgres}
   ^^ `=X` sem papel antes do `=` é PUBLIC — `FROM anon, authenticated` não tira nada

merge_duplicate_* (upstream 022/036)
  {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}
   ^^ concessão explícita por papel, sem PUBLIC — `FROM PUBLIC` não tira nada
```

Este erro já foi cometido **três** vezes: a 903 e a 912 revogaram só dos papéis
(sem efeito, cinco funções seguiram abertas até a **913**); a 914 revogou só de
PUBLIC (sem efeito, corrigido pela **915**). Escreva sempre as duas metades:

```sql
REVOKE EXECUTE ON FUNCTION minha_funcao(args) FROM PUBLIC, anon, authenticated;
SELECT has_function_privilege('anon', 'minha_funcao(uuid)', 'EXECUTE');  -- tem de dar false
```

- **Confira o resultado, nunca a intenção.** Só o teste pegou os dois enganos.
  `get_advisors(type: 'security')` também pega (lints 0028/0029), inclusive em
  função que retorna `trigger`.
- Revogar **não impede o trigger de disparar**: o privilégio é checado no
  `CREATE TRIGGER`, não a cada disparo. Verificado com escritas reais.
- `service_role` tem concessão explícita e não é atingido — o caminho
  server-side continua funcionando.
- ⚠️ **`SECURITY INVOKER` checa o privilégio de TUDO que roda dentro**, como o
  usuário que chamou. Fechar uma função auxiliar derruba a função principal
  para todo mundo logado — e o bloco de conferência da migration, que roda como
  DONO, **passa verde**. Quem escrever função `SECURITY INVOKER` nova precisa
  testar trocando de papel:
  ```sql
  DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.minha_funcao('x');
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'authenticated não consegue executar: %', SQLERRM;
  END $$;
  ```
  Pego antes de aplicar na 929; sem esse bloco teria ido para produção verde.

⚠️ **Tabela `cb_*` nova nasce SEM nada para `anon` — e as antigas foram
fechadas na 931.** `REVOKE ALL ON TABLE ... FROM anon`, sempre. Não é teoria: a
901, a 906 e a 912 deixaram concessão aberta (a `cb_channels` chegava a dar
INSERT/UPDATE/DELETE ao `anon`), e a única coisa entre um pedido anônimo e o
dado era a RLS. Nunca houve vazamento — medido com `SET ROLE anon`, dava 0
linhas em todas —, mas era **uma** barreira onde as tabelas novas têm duas.
Confira as duas metades, como no caso das funções: que o `anon` perdeu, **e**
que `authenticated`/`service_role` não perderam.

⚠️ **A 903 removeu dois índices únicos.** `message_templates(user_id, name,
language)` e `ai_configs(account_id)` viraram pares de índices **parciais**
(global + por canal). Consequências que já morderam durante a implementação e
mordem de novo em qualquer código novo:

- **`.upsert(..., { onConflict })` não funciona mais nessas tabelas** — índice
  parcial não serve como alvo de `ON CONFLICT`. Use lookup + insert/update.
- **`.maybeSingle()` filtrando só por `account_id` estoura** assim que existir
  uma segunda linha (agente por canal, template homônimo em outro WABA).
  Toda consulta precisa escopar o canal, ou `.is('channel_id', null)` quando o
  alvo é explicitamente o padrão da conta.

⚠️ **Simulação de perfil ("Ver como", 2026-09-03): troca de LENTE no
navegador, e só nele.** `src/lib/perfis/simulacao.ts` (puro, com teste), o
override no `AuthProvider` (`use-auth.tsx`), a faixa
`src/components/auth/faixa-de-simulacao.tsx` montada no `dashboard-shell`
acima do cabeçalho, e o olho em cada linha de Configurações → Perfis. O que
morde código novo:

- ⚠️⚠️ **O SERVIDOR NÃO PARTICIPA.** `requireRole` e a RLS continuam vendo
  o administrador real; a simulação responde "o que este perfil VÊ e quais
  botões perde", que é o que os perfis prometem (a 956 diz por escrito que
  são restrição de visualização). Não é teste de segurança, e a faixa diz
  isso. Levar ao servidor (cookie que REBAIXA o papel em `requireRole`) é
  possível, mas foi deixado de fora da primeira versão de propósito.
- ⚠️ **NUNCA ESCALA.** `resolverAcesso` só honra a lente quando o papel REAL
  administra (`podeSimular` = admin/dono) e o alvo é desta conta; o CHECK da
  956 já impede alvo `owner`. Chave plantada à mão no sessionStorage por um
  agent é ignorada. O dono que simula PERDE o curto-circuito de dono — é o
  ponto.
- ⚠️ **TUDO no provider deriva do acesso EFETIVO** (`accountRole`, `acesso`,
  `isX`, `canX`): nenhum consumidor sabe que a lente existe — é o que faz
  menu, seções, tela bloqueada, recorte de conexões/funis e botões seguirem
  juntos. `profile` continua sendo o real; `simulacao.papelReal` diz quem
  está simulando. Quem ler `profile.account_role` direto num gate de UI
  fura a lente (hoje ninguém lê).
- ⚠️ **A simulação PENDENTE entra em `profileLoading`**: o shell troca a
  tela por spinner e remonta a página — para começar a ver como outro
  perfil é o que se quer (a app "recarrega" já na lente) e mata o flash da
  visão do admin. A linha do perfil é buscada de novo a cada montagem
  (lente fiel ao perfil de hoje); perfil apagado, erro ou 8s sem resposta
  DERRUBAM a simulação e limpam a chave, senão toda montagem futura
  esperaria por nada.
- **Por ABA** (`sessionStorage`) e **amarrada a quem a ligou**: a chave
  guarda `{ perfil, usuario }` e só vale para o mesmo `user.id`. Sobrevive
  ao reload, morre com a aba, e TODO caminho de saída a limpa — o `signOut`
  daqui e o ramo SIGNED_OUT do listener (saída por outra aba, sessão
  invalidada). Sem a amarração, outra pessoa da mesma conta entrando nesta
  aba herdaria a lente do anterior (Codex, PR #118).
- **A SAÍDA mora na faixa**, não na tela de Perfis: o perfil simulado pode
  esconder Configurações → Perfis (seção só de admin). Começar leva para a
  PRIMEIRA tela que o perfil enxerga — ficar em Perfis não mostraria nada.
- **Presença, heartbeat e toda escrita continuam como o admin real** — a
  lente não muda quem a pessoa é para o servidor nem para os colegas.

⚠️ **O editor de perfis DESCREVE o papel, e a descrição pode mentir.**
`src/lib/perfis/poderes.ts` (puro, com teste) e
`src/components/settings/poderes-do-papel.tsx`. Nasceu de uma pergunta do
operador em 2026-09-02 ("atendente com a aba de Conexões marcada consegue
excluir uma conexão?") e da medição que ela provocou: os perfis **Gestor
Geral** e **Trabalhista - Gestor** são `papel_base = 'agent'` com Conexões,
Membros, Modelos, Campos, Acervo e Assinatura marcados, mais as telas de
Automações e Disparos — tudo somente-leitura. A configuração fazia o que foi
pedida a fazer; faltava a tela dizer o que aquilo significava. O que morde
código novo:

- ⚠️⚠️ **`ESCRITA_DA_TELA` e `ESCRITA_DA_SECAO` são ESPELHO das guardas, não
  guarda nenhuma.** Nada no app decide permissão por eles — quem decide
  continua sendo `requireRole` na rota, `useCan`/`RequireRole` no botão e a
  policy no banco. Mudar um guard sem mudar o mapa não quebra nada e não
  aparece em teste: só faz o editor AFIRMAR um poder que a pessoa não tem,
  que é pior que não dizer nada. Os dois são `Record<TelaId|SecaoId, …>`, então
  tela/seção nova não compila sem entrada — mas o VALOR é responsabilidade de
  quem mexe na guarda.
- ⚠️ **`PODERES` delega para os predicados de `roles.ts`, nunca compara papel
  na mão** — há teste comparando os dois lados. Uma segunda cópia da política
  aqui divergiria na primeira mudança.
- ⚠️ **Id órfão é IGNORADO, e não é defensividade genérica**: o perfil
  "Administrador" desta conta guarda `"deals"` em `secoes_config` (seção que
  nunca existiu — a nota está em `catalogo.ts`), o editor NÃO filtra ao montar
  o rascunho e `duplicar()` o copia verbatim. Sem o filtro,
  `ESCRITA_DA_SECAO["deals"]` é `undefined`, `hasMinRole` compara
  `3 >= undefined` = false, e o aviso dizia "só para leitura: deals" **num
  perfil Administrador**. Não estoura: `roleRank` não tem `default`.
- ⚠️ **Somente-leitura e OCULTA são coisas separadas, tratadas de jeitos
  diferentes (desde 03/09).** Somente-leitura é o GRUPO "Só leitura para
  este papel" do editor (a seção aparece sem botões). Oculta é seção de
  `SECOES_SO_DE_ADMIN` num perfil não-admin: não aparece de jeito nenhum, a
  caixa seria inerte, e quem a marcasse sairia da tela achando ter delegado
  a gestão de permissões. Por isso ela não é OFERECIDA fora do admin e é
  DESCARTADA do rascunho (`semSecoesOcultas`) ao abrir o editor e ao descer
  o papel — sem caixa não haveria como desmarcá-la, e `salvar` a devolveria
  ao banco para sempre (Codex, PR #117). O aviso âmbar que existia para isso
  saiu junto: não sobrou o que avisar.
- **A lista fica SEMPRE VISÍVEL, não atrás de um "?"**: quem configurou os
  "Gestor" não tinha por que suspeitar que havia algo a perguntar.
- **`ROTULO_DA_TELA` mudou de casa para `catalogo.ts`** — já havia duas cópias
  (`perfis-panel.tsx`, `perfil-resumo.tsx`) e a terceira ia nascer aqui. Cópia
  de mapa exaustivo é o caso em que o typecheck deixa passar a divergência:
  cada cópia continua completa, só que uma aponta para a chave velha.
- ⚠️ **`adminOnly` no docstring de `settings-sections.ts` é MENTIRA** — o campo
  não existe; quem recorta a seção é `podeVerSecao`.
- ⚠️ **`ESCRITA_DA_TELA.inbox` E `.contacts` são `viewer`, e não `agent`** —
  de propósito. A régua do mapa é "há ALGUMA operação disponível para este
  papel nesta tela?", e anotação interna CONTA: `canWriteNotes` é
  deliberadamente mais permissivo, a caixa de anotação aparece para o
  Visualizador no inbox E na aba Notas da ficha do contato (compositor sem
  gate de `podeEditar`; a rota aceita `viewer`). O aviso diz "aparece só
  para leitura, sem os botões", e ali isso seria MENTIRA. `contacts` nasceu
  `agent` (policies da 017) e o Codex pegou no PR #107. "Simplificar" para
  `agent` (o piso de ENVIAR/EDITAR) reintroduz a mentira. Funis, Radar e
  Agendadas ficam em `agent` porque NÃO montam o compositor de nota — quem
  levar o `InternalNoteBox` para uma tela nova rebaixa a entrada dela aqui.

⚠️ **Funil e Contatos: o que é de ADMIN (2026-09-08).** O operador simulou
o perfil "Bancário - Jurídico" (papel `agent`) e viu poderes que não queria
conceder. Três decisões, e o que morde código novo:

- ⚠️⚠️ **"Gerenciar funil" some para quem não é admin.** As policies de
  `pipelines`/`pipeline_stages` exigem admin desde sempre — era a TELA que
  oferecia o painel a qualquer um que enxergasse a página. E o sintoma é o
  pior tipo: **RLS que barra escrita devolve 0 linhas SEM erro**, então o
  atendente renomeava a etapa, via a mudança na tela e a encontrava intacta
  no reload. Esconder, e não desabilitar, segue a regra que a grade de
  automações já usava.
- ⚠️ **Lista, Desempenho e Saúde são de admin** (`canViewReports`), e a
  barra de abas SOME quando sobra uma só. Elas mostram a conta inteira —
  conversão, valor fechado, ticket médio, investimento em anúncios, CAC —,
  que é informação de gestão. O Kanban continua de `agent`. ⚠️ É recorte de
  TELA, não barreira: `deals` e `cb_lead_events` são legíveis por qualquer
  membro (017/912) e as abas leem direto do banco no navegador. Fechar de
  verdade exigiria rota server-side, e a mesma tabela alimenta o Kanban do
  atendente — não dá para resolver com policy.
- ⚠️ **A aba vigente é resolvida no RENDER** (`vistaVigente`, em
  `src/lib/pipelines/vistas.ts`, puro e testado), nunca guardada por efeito:
  a lente de simulação troca o papel com a tela montada, e uma aba proibida
  que sobrevivesse até o efeito rodar mostraria o Desempenho da conta a quem
  acabou de perder o acesso.
- ⚠️⚠️ **Apagar contato subiu para admin nos DOIS lados** — `canDeleteContacts`
  na tela e a policy `contacts_delete` na 981. Só o DELETE: `contacts_insert`
  e `contacts_update` continuam em `agent`, porque cadastrar e corrigir ficha
  é trabalho de atendimento (a 981 CONFERE isso, para um "endurecimento"
  futuro não levar as três juntas). Eram DOIS caminhos de exclusão na tela e
  o do menu da linha não tinha gate nenhum. Apagar leva a conversa e todas as
  mensagens junto (CASCADE), e isso é do escritório.
- **Tarefas já estavam certas**: `podeNaTarefa` dá `apagar` ao criador (e ao
  admin, para a tarefa órfã cujo criador saiu). Conferido, nada mudou.
- ⚠️⚠️ **Os DOIS caminhos de exclusão conferem o ROWCOUNT** (`lerExclusao`,
  em `src/lib/contacts/exclusao.ts`, puro e testado), não só o erro. É a
  armadilha que este arquivo já documentava para os filtros salvos e as
  anotações, e que a página de contatos repetia: **RLS que barra DELETE
  devolve 0 linhas com `error: null`**, então a tela dizia "contato
  excluído" sobre um contato intacto — o caso real de quem estava com a
  página aberta quando a 981 entrou (achado do Codex no PR #137). O toast em
  massa também contava os PEDIDOS, não os que saíram: anunciava "12
  excluídos" sobre zero.
  ⚠️⚠️ **Zero linhas tem DOIS significados**, e o rowcount sozinho não os
  separa: a policy recusou, ou a linha JÁ NÃO EXISTIA (outro cliente a
  apagou depois que a lista carregou). Dizer "seu perfil não tem permissão"
  a quem perdeu a corrida afirma o que não houve (Codex, PR #138).
  ⚠️⚠️ **E o motivo é MEDIDO, nunca inferido do papel em cache.** A primeira
  correção perguntava à TELA se o usuário podia apagar — e um admin
  REBAIXADO com a página aberta mantém `accountRole` antigo em memória (o
  provider não refaz o perfil em evento de auth do mesmo usuário), então a
  tela "sabia" que podia enquanto o banco já recusava, e anunciava que
  alguém havia apagado o contato que a recarga trazia de volta (Codex, PR
  #139). Hoje: depois de um DELETE incompleto, uma consulta pergunta quais
  dos pedidos AINDA EXISTEM — os que existem foram recusados, os que não
  existem sumiram. Conferência que falha vira `falhou`, nunca palpite.
  ⚠️ **A seleção perde os RESOLVIDOS, que são dois grupos**: os apagados e
  os que já não existiam. Manter o segundo deixava uma linha invisível
  marcada na barra, e cada nova tentativa repetia "sumiu" para sempre.
  ⚠️⚠️ E a seleção: a recarga da lista **zera a seleção por conta própria**
  (as linhas visíveis mudam), então devolver `false` em `podeLimparSelecao`
  não bastava — `fetchContacts` ganhou `{ preservarSelecao }`, e a exclusão
  parcial PODA a seleção com `selecaoRestante` em vez de zerá-la. Sem esse
  par, a invariante da função não valia na prática (Codex, PR #138).
- ⚠️ **Os dois caminhos SOMEM juntos para quem não é admin** — o item do
  menu da linha e o botão de seleção múltipla. Um `GatedButton` desabilitado
  num deles anunciaria a exclusão a quem não pode usá-la, e desfaria a
  simetria (Codex, PR #137).
- ⚠️ **A 981 é a exceção à ordem "migration antes do merge"**: ela RESTRINGE,
  e o app antigo ainda oferece o botão de excluir. Aplicada DEPOIS do
  deploy, senão a janela entre as duas deixaria a tela dizer "contato
  excluído" sobre um contato intacto. A regra habitual vale para migration
  que ACRESCENTA (o app novo precisa da coluna); esta é o inverso.
- **Os dois poderes novos aparecem no editor de perfis** (`PODERES`), porque
  eram justamente as diferenças entre `agent` e `admin` que a tela não
  deixava evidentes. ⚠️ Vale para os QUATRO perfis não-admin da conta — os
  dois "Gestor" incluídos, que são `agent`.

⚠️ **O editor de perfis NASCE PREENCHIDO e agrupa por ÁREA (2026-09-03).**
`src/lib/perfis/editor.ts` (puro, com teste) e
`src/components/settings/areas-do-perfil.tsx`. Pedido do operador ("a aba de
edição de perfil está muito complexa"); medido antes: ~31 controles, 25 caixas
idênticas em duas grades, e o perfil novo nascia SEM tela nenhuma — que aqui
é literal (tipos.ts), então só servia depois de 14 caixas marcadas à mão. O
que morde código novo:

- ⚠️ **"Novo perfil" abre primeiro a escolha do MODELO** (os três de
  `PERFIS_DE_FABRICA`, via `modelosDePartida`, mais "Começar em branco"). O
  rascunho nasce com papel, telas e seções do modelo; o trabalho é
  desmarcar. Quem religar o botão direto ao formulário devolve o perfil que
  só serve depois de 14 caixas.
- **Os cartões do modelo têm nome e descrição no DICIONÁRIO**
  (`modelos.<papel>.nome`/`.descricao`), nunca o `nome` de
  `PERFIS_DE_FABRICA`: aquele é o que o semeador GRAVA (dado, em português)
  e sairia cru no locale inglês, ao lado de um texto que chama os mesmos
  perfis de "Administrator, Lawyer and Observer" (Codex, PR #117).
- ⚠️ **A partição "só leitura para este papel" SAI de `areasQueNaoOperam`**
  (poderes.ts, a régua única de "o que este papel não opera"), não de uma
  segunda leitura de `ESCRITA_DA_*` — e há teste pinando isso. O grupo
  EXISTE de propósito: os "Gestor" desta conta são `agent` com 8 áreas só de
  leitura marcadas; esconder o item apagaria uma configuração legítima, e
  misturá-lo com os operáveis era a queixa. Fica recolhido, tracejado, com o
  olho.
- ⚠️ **`AREA_DA_TELA` é `Record<TelaId, …>`**: tela nova não compila sem
  área. Seção (fora as pessoais) cai sempre em Configurações. Grupo vazio
  some (para `viewer`, "Disparos e automações" não aparece).
- **A caixa do grupo mexe SÓ no que é livre** (`alternarGrupo`): item travado
  (`settings`; `overview`/`members`/`perfis` no admin) não entra no array ao
  ligar — listá-lo "daria a impressão de que dá para tirá-lo" (padroes.ts).
  A contagem do cabeçalho conta todos (travado = marcado); o tri-estado, só
  os livres.
- **Abre expandido só o grupo PARCIAL** (`gruposAbertosDeInicio`), semeado
  na montagem — o diálogo desmonta ao fechar, então cada abertura recomeça
  pela regra. "5 de 5" e "0 de 12" já dizem tudo no cabeçalho.
- **Chaves montadas (`areas.<id>`, `modelos.<papel>.*`) escapam do portão
  estático de i18n**: `editor.test.ts` as cobra nos dois dicionários, como
  `poderes.test.ts` faz com `poderes.<id>`.

⚠️ **Busca do inbox atrás de um interruptor, busca DENTRO do fio e "Ver na
conversa" (09/09/2026).** `variantesDoNonoDigito` em
`src/lib/contacts/telefone.ts`, `src/lib/inbox/salto-no-fio.ts` (puro, com
teste), o interruptor em `conversation-list.tsx`, a barra local e o salto
pedido em `message-thread.tsx`, os botões em `painel/aba-arquivos.tsx` e
`cartao-de-nota.tsx`, o pedido carimbado em `inbox/page.tsx`. Nasceu de
quatro queixas do operador na mesma tarde. O que morde código novo:

- ⚠️⚠️ **A busca no CORPO das mensagens é DESLIGADA por padrão** (2º
  parâmetro `ativa` de `useBuscaEmMensagens`). Desligada, a RPC 929 não roda
  e `termoAplicado` é `""` — o fio não destaca nada e a linha não mostra
  trecho. Sempre ligada, buscar um NOME trazia junto toda conversa em que
  ele foi citado, enterrando a conversa procurada (queixa do operador). As
  três dicas da lista ("digite 3 letras", "buscando", "falhou") ficam ATRÁS
  do interruptor, e o placeholder diz o que a caixa olha agora. Estado de
  sessão, sem persistência: "por padrão" quer dizer a cada abertura.
- ⚠️ **Só o lado do CONTATO ganha a variante do nono dígito, nunca o
  termo** — o termo é o que a pessoa digitou, e alterá-lo inventaria uma
  busca que ela não fez. E só celular com DDI 55 (13 ou 12 dígitos, local
  começando em 6–9): é como `contacts.phone` guarda. A regra vale nos DOIS
  irmãos (`casaComABusca` do inbox e `casaComContato` do seletor de
  contato) — "(83) 98874-5316" tem de achar a ficha gravada como
  `558388745316`, que é como o WhatsApp entrega número antigo.
- ⚠️ **A barra de busca local SUBSTITUI a faixa da busca da lista enquanto
  está aberta.** `termoEfetivo` é a ÚNICA origem de `acharNoFio`, `alvoId` e
  das setas: as duas contam achados do MESMO fio, e duas contagens lado a
  lado diriam coisas diferentes sobre a mesma tela. Enter anda para o achado
  mais ANTIGO (o fio abre no mais recente, então "próximo" é para cima),
  Shift+Enter volta, Esc fecha. A barra é carimbada com a conversa
  (`buscaLocal.conversationId`, mesma assinatura da `escolhaNaBusca`), nunca
  zerada por efeito ao trocar — o efeito passivo deixaria um quadro com a
  barra da conversa anterior sobre a nova.
- ⚠️⚠️ **O salto PONTUAL é EVENTO, não estado da busca, e tem UMA mecânica
  para DUAS origens: `useSaltoPontual` (fim de `message-thread.tsx`).** O
  clique na citação (PR #179, estado `saltoDaCitacao` via `irParaCitada`) e
  o "Ver na conversa" do painel (prop `saltoPedido`, `PedidoDeSalto` com
  `conversationId` + `n`) instanciam o MESMO hook, cada um com o seu pedido;
  o hook devolve o que está destacado (`destaqueDaCitacao`,
  `destaqueDoPainel`). Nasceu do merge dos dois PRs, que traziam duas cópias
  de "centraliza e destaca por 2,5 s" — quem criar uma terceira origem
  instancia o hook, não copia o efeito. Quatro cercas, cada uma com motivo:
  (1) atende UMA vez por `n` (`atendidoRef`) — o efeito depende de
  `messages`/`notas` para atender o pedido feito durante uma carga, e sem a
  memória toda mensagem nova re-centralizaria o alvo velho; (2) o pedido do
  painel só entra se for DESTA conversa (`pedidoDoPainel`) — sem o carimbo,
  trocar de conversa antes de o fio carregar deixava um pedido pendente que
  disparava ao voltar; (3) chama `liberarSalto()` antes de rolar, senão o
  efeito que centraliza o achado da busca disputa a tela (a versão da
  citação no #179 não chamava — e o achado da busca puxava de volta na
  mensagem seguinte); (4) o timer que apaga o destaque vive num REF, fora da
  limpeza do efeito — a limpeza roda a cada mensagem nova e, cancelando o
  timer, deixaria o destaque aceso para sempre quando algo chegasse nos
  2,5 s. O destaque é DERIVADO (`pedido.n !== apagado`), e o único
  `setState` é o do timer — o React Compiler recusa `setState` síncrono em
  efeito.
- ⚠️ **`LinhaDoFio` (ex-`LinhaDaMensagem`) embrulha mensagem E anotação**,
  com `data-message-id` OU `data-nota-id`; `seletorDoAlvo` conhece os dois
  nomes e `salto-no-fio.test.ts` lê o fonte do fio cobrando os atributos —
  renomear um lado sem o outro faz o botão não fazer NADA, sem erro.
- **`AbaArquivos` e `CartaoDeNota` recebem `onVerNaConversa` OPCIONAL**: sem
  ele (a ficha de `/contatos`, que não tem fio ao lado) o botão não existe.
  O link continua abrindo o arquivo e a miniatura o visualizador; o botão é
  IRMÃO deles (button dentro de `<a>`/`<button>` é inválido — a regra do
  lápis do card do funil). No celular a página fecha o overlay do painel ao
  atender o clique, senão o salto acontece atrás da ficha.

⚠️ **Anexo por ARRASTAR e por COLAR (08/09/2026).** `src/lib/inbox/arquivo-solto.ts`
(puro, com teste) e os handlers em `message-composer.tsx`. Pedido do operador,
que arrastava PDF para a conversa e nada acontecia. O que morde código novo:

- ⚠️⚠️ **A lista de MIMEs é UMA** (`MIMES_ACEITOS`), e o `accept=` dos três
  seletores deriva dela (`ACEITE_DO_SELETOR`). Duas listas divergiriam, e o
  sintoma seria um arquivo aceito por uma porta e recusado pela outra —
  falhando só no envio, longe da causa.
- ⚠️⚠️ **Colagem COM TEXTO junto não vira upload** (`colagemEhAnexo`). Word e
  Google Docs mandam texto e imagem no MESMO evento; interceptar ali
  transformaria um Ctrl+V de texto num anexo e perderia o texto. Só colagem
  sem texto algum é tratada como arquivo.
- ⚠️ **`dragenter`/`dragleave` contam PROFUNDIDADE**, não ligam um booleano:
  `dragleave` dispara ao passar de um filho para outro dentro da mesma zona,
  e o destaque piscaria. E os handlers só interceptam quando
  `dataTransfer.types` inclui `Files` — texto arrastado tem de continuar
  caindo na caixa como texto.
- ⚠️ **O alvo de soltura é `pointer-events-none`**: sem isso ele engole o
  próprio `drop` que anuncia.
- ⚠️ **Print colado ganha nome com carimbo** (`nomeParaColagem`): o Chrome
  chama TODA colagem de `image.png`, então dois prints na mesma conversa
  teriam o mesmo nome — e o nome viaja para o WhatsApp e para
  `messages.media_filename` (969).
- ⚠️⚠️ **O MIME é NORMALIZADO antes de subir** (`arquivoParaEnviar`), não só
  antes de comparar. `uploadAccountMedia` manda `file.type` como
  `contentType`, e o bucket `chat-media` tem lista EXATA de MIMEs (023):
  `image/png; charset=binary` — a forma que aparece em colagem de alguns
  aplicativos — passava por `tipoDoArquivo` e era recusado no upload,
  falhando justamente no caso que o código dizia suportar (Codex, PR #141).
  Quem criar outro caminho de upload repete a normalização.
- ⚠️⚠️ **VÁRIOS anexos por vez desde 08/09/2026** (`drafts: MediaDraft[]`,
  teto `MAX_ANEXOS` = 10). Cada item vira UMA mensagem — não existe "mensagem
  com 3 anexos" no WhatsApp —, e o envio é SEQUENCIAL com `await`
  (`onSendMedia` passou a aceitar promessa): disparar todas de uma vez as
  entregaria fora de ordem no celular do cliente. ⚠️ O que JÁ SAIU é
  removido da fila item a item, mesmo se o próximo falhar — reenviar do
  começo mandaria o primeiro anexo duas vezes. O mesmo vale para o
  agendamento: uma linha de `cb_scheduled_messages` por anexo, e só o que
  falhou fica na tela.
- ⚠️⚠️ **`onSendMedia` DEVOLVE se entregou, e o pai NÃO apaga o objeto na
  falha** — o compositor mantém o item na fila e volta a ser dono dele
  (achado do Codex no PR #144). Antes o pai recolhia o objeto em todo
  caminho de erro, então guardar o rascunho deixaria um anexo apontando para
  arquivo inexistente. O envio PARA no primeiro que não entregou: a causa
  costuma ser a mesma para todos (janela de 24h, rede fora) e seguir daria
  um toast por anexo.
- ⚠️⚠️ **O envio da fila tem TRINCO SÍNCRONO** (`enviandoFilaRef`), não só
  o `busy`: entre o clique e o próximo render cabe um segundo clique, e ele
  iteraria sobre a MESMA fila capturada, mandando todos os anexos de novo ao
  cliente. Estado não serializa; ref serializa.
  ⚠️⚠️ **O ref guarda a POSSE (um número por envio), nunca um booleano**, e
  o `finally` só solta quem AINDA é dono (`enviandoFilaRef.current ===
  posse`). São dois pontos de queda — o `finally` e o efeito de troca —, e
  com booleano o `finally` do envio de A derrubava o trinco de um envio JÁ
  EM CURSO em B: o clique seguinte reenviava os anexos de B ao cliente, que
  é o próprio dano que o trinco existe para impedir. É a mesma cerca de
  posse do worker do Radar (`running_desde`) e do claim do Calendly
  (`processando_desde`).
  ⚠️⚠️ **E o trinco é SOLTO na troca de conversa, além do `finally`.** Ele
  só cai quando o envio em voo assenta, e o `fetch` de `/api/whatsapp/send`
  não tem prazo: sair da conversa com a fila correndo levava o trinco junto,
  e no cliente seguinte o botão Enviar do anexo nascia desabilitado
  (`busy={busy || enviandoFila}`) com um `sendDraft` novo recusado logo na
  entrada — sem toast, sem nada a clicar, e para sempre se a requisição
  travasse (Codex, PR #146).
  ⚠️⚠️ **A POSSE É TAMBÉM A GERAÇÃO QUE CANCELA O LAÇO**, e é o que torna
  seguro soltar o trinco na troca: depois de cada `await`, os dois ramos
  conferem `enviandoFilaRef.current !== posse` e desistem. Sem cancelar, o
  laço de A seguia escrevendo na tela de B — o `setDrafts(restantes)` do
  ramo agendado devolvia a B os anexos que sobraram de A, e o
  `onClearReply()` do fim apagava a citação que B acabou de escolher.
  ⚠️⚠️ **Comparar o `conversationId` NÃO basta, e essa foi a primeira
  versão** (Codex, PR #148): em **A → B → A** a conversa volta a ser a mesma,
  o laço abandonado de A volta a casar e RETOMA — mandando anexos cujos
  objetos o efeito de troca já apagou do bucket, e limpando a citação e a
  seleção da sessão NOVA de A. A posse é única por invocação e o efeito de
  troca a zera, então toda navegação invalida o laço velho para sempre,
  qualquer que seja o caminho. Quem escrever outro laço com `await` sobre
  estado da tela usa a posse, nunca o id da conversa.
- ⚠️⚠️ **O fim da fila só limpa a citação se ela ainda for A QUE SAIU, e quem
  COMPARA é o dono do estado.** O compositor captura `citada` na entrada e
  chama `onClearReply?.(citada)`; o fio decide dentro do `setReplyTo((atual)
  => ...)`. O operador pode clicar Responder noutra mensagem enquanto os
  anexos sobem, e um `onClearReply()` incondicional apagava a escolha que ele
  acabou de fazer (Codex, PR #148). ⚠️ A primeira correção comparava contra um
  ref alimentado por `useEffect` — e a corrida voltava pela porta dos fundos:
  efeito é PASSIVO, então a promessa do upload pode assentar depois de o React
  comprometer o `replyTo` novo e ANTES de o efeito atualizar o ref, e na janela
  apaga-se exatamente a citação nova (Codex, PR #149). É a armadilha de efeito
  passivo desta lista, na sua quinta aparição. O updater não tem janela porque
  não guarda cópia. ⚠️ O teste é `typeof idQueSaiu !== "string"`, e não
  `!== undefined`: passar `onClearReply` direto para um `onClick` (é o que o X
  da citação fazia) mandaria o MouseEvent como id e o botão morreria em
  silêncio. Pela mesma razão os dois envios levam a `citada` capturada, não
  `replyTo?.id` lido a cada volta.
- ⚠️⚠️ **`handleSendMedia` NÃO limpa a citação — quem limpa é o fim da
  fila** (`onClearReply`, depois de a fila INTEIRA sair). Ele tem três
  saídas `false` que RETÊM o anexo, e `MediaDraft` não guarda o id da
  citada: ela é lida de `replyTo` a cada envio. Limpando ali, a segunda
  tentativa saía SEM a citação enquanto a bolha falhada no fio continuava
  mostrando a resposta que o retry não carrega — o anexo trocava de
  contexto em silêncio (Codex, PR #146). Quem fizer o rascunho guardar a
  citada muda esta regra de forma, e há pino cobrando as duas pontas em
  `src/lib/inbox/fila-de-anexos.chamadores.test.ts`.
- ⚠️ **O seletor de arquivo passa pelo MESMO funil do arrastar**
  (`receberArquivos`): é ele que aplica `MAX_ANEXOS` e avisa o que ficou de
  fora. Ligar o seletor direto ao upload ignorava o teto — escolher uma
  pasta inteira subia e mandava tudo.
- ⚠️ **Os TRÊS caminhos de upload acrescentam à fila** (seletor, arrastar/
  colar, acervo, gravação de voz) e cada um mantém a guarda de troca de
  conversa. A limpeza de desmonte e a da anotação percorrem a fila INTEIRA —
  uma delas esquecida vaza objeto no bucket.
- ⚠️ **O item exibido é resolvido no RENDER** (`find(...) ?? drafts[0]`),
  nunca por efeito: descartar o selecionado deixaria a prévia em branco por
  um quadro. A tira de miniaturas só aparece com mais de um, pela mesma
  regra do seletor de canal.
- **Cada descarte tem seu aviso** (`recusados`, `excedentes`): engolir
  arquivo em silêncio faz o operador achar que mandou o que não mandou.

⚠️ **Anotação interna: são QUATRO telas, e o que as une mora em dois arquivos.**
`src/hooks/use-apagar-nota.ts` e `src/components/inbox/cartao-de-nota.tsx`.
Até 2026-09-02 a aba Notas do painel e a do grupo mostravam a anotação SEM
autor e SEM como apagar — a mesma nota tinha dono e lixeira no fio e era anônima
e sem saída na aba, a dois centímetros. O que morde código novo:

- ⚠️⚠️ **Apagar SEMPRE pelo `useApagarNota`, nunca por um `.delete()` solto.**
  A policy da 918 é "autor OU admin", e **RLS que barra DELETE devolve 0 linhas
  SEM erro** — a cópia que não conferir o `count` faz a anotação sumir da tela,
  ficar no banco e voltar na próxima abertura da conversa, sem nada explicando.
  É a mesma classe do rowcount dos filtros salvos (967).
- ⚠️ **`podeApagar` é `author_user_id === user.id || useCan('manage-members')`**,
  igual nas três telas. Divergir mostra a lixeira para quem a RLS vai recusar —
  e aí o ramo do `count` dispara em uso normal, virando ruído.
- ⚠️ **Nota de GRUPO não fixa** (o índice parcial da 951 exige `contact_id`):
  sem `onFixar`, o alfinete nem aparece. O `CartaoDeNota` não decide isso —
  quem monta a aba decide.
- **`sticky` NÃO mora no cartão**: grudar no topo é layout de quem monta a aba
  (o painel prende a fixada; a barra do grupo nem tem nota fixada).
- **`contact-detail-view` ficou com o `deleteNote` próprio**, de propósito: ele
  já confere o `count` E distingue "proibido" de "falhou" com toasts
  diferentes, o que o hook não faz. Levou só o nome do autor.
- **A frase do autor é `Inbox.note.wrote` nas quatro telas** — chave única,
  senão a tradução diverge entre a bolha e o cartão.

⚠️ **Funil comercial (975 — Fase 0 de `docs/PLANO-funil-comercial.md`): o
funil de eficiência é FIXO e cada funil mapeia as SUAS etapas.**
`pipeline_stages.degrau` ∈ {lead, mql, reuniao, proposta, contrato, perda,
NULL}; `src/lib/funil/` — puros e testados: `degraus`, `trajetoria`, `periodo`,
`coorte`, `saude`, `lista`, `apresentacao`; e `carregar`, que é o ÚNICO com
I/O (o laço paginado da RPC) —; a RPC `cb_funil_trajetorias`; o seletor por
etapa em `pipeline-settings.tsx`. As Fases 1–4 (lista, Desempenho, Saúde,
Meta Ads) leem daqui. O que morde código novo:

- ⚠️⚠️ **NEGÓCIO TRANSFERIDO PARA OUTRO FUNIL CONTINUA CONTANDO NO FUNIL DE
  ORIGEM, com a última etapa que teve lá.** Decisão do operador (03/09/2026),
  que pediu que ficasse ESCRITA: o fluxo é "fechou → transfere para o funil
  do Jurídico → continua ganho". A RPC devolve o negócio porque ele tem
  evento com `to_pipeline_id` = o funil; `fatosDoNegocio` resolve a última
  etapa dele ali (`noFunil = false`, `transferidoPara`). Quem "simplificar"
  para `deals.pipeline_id`/`stage_id` atuais apaga todo contrato transferido
  da estatística comercial, sem erro nenhum.
- ⚠️ **`degrau` é INDEPENDENTE de `resultado` (950).** `resultado` carimba o
  status do negócio; `degrau` diz o que a etapa significa no funil de
  eficiência. A tela SUGERE (ganho → contrato, perdido → perda) só quando a
  etapa ainda não tem degrau; o cálculo nunca deriva um do outro ("No Show"
  pode ser perda no funil sem ser perdido no status, se o escritório
  reagenda). SEM backfill: quem mapeia é o operador, na tela de Funis.
  Decisão dele: "Contato Avulso" e as etapas de entrada CONTAM como `lead`
  — para negócio de canal, a entrada no funil e a criação do card coincidem.
- ⚠️ **A RPC é SUPERCONJUNTO** (criado no intervalo OU com evento no
  intervalo): a coorte de verdade é `coorteDoPeriodo` (entrada = primeira
  etapa COM classe, perda inclusive). Somar linhas cruas conta negócio de
  janeiro movido em abril como coorte de abril.
- ⚠️ **Alcance é MONOTÔNICO** (`degrauMaximo`): pular de Lead para Proposta
  alcança MQL e Reunião — nenhuma taxa passa de 100%. Perda não alcança
  nada; entrar direto em perda É entrada.
- ⚠️ **Paginar a RPC** com `order('deal_id')` + `range` + `count: 'exact'`
  (`carregar.ts`); `null` = "não confie", nunca lista parcial.
- **Período em fuso LOCAL, `[desde, ate)`; anterior = mesma duração
  imediatamente antes**, em dias inteiros para intervalo aberto (D4) — e o
  deslocamento é por DIAS DE CALENDÁRIO, nunca por milissegundos: num fuso
  com horário de verão, subtrair "30 dias e 23 horas" de 1º de março cai em
  29/01 à 1h e some com a hora de fronteira (Codex, PR #119).
- ⚠️ **A situação PARTICIONA a coorte em cinco baldes** — fechado, perdido,
  sem avanço, em andamento e **fora do funil** (entrou por etapa mapeada e
  hoje está numa etapa SEM degrau). O quinto existe porque sem ele os totais
  não fechavam com as entradas (Codex, PR #119). ⚠️ E a soma se faz por
  `situacao`, NUNCA somando `resumo.fechados`: aquele campo é "alcançou
  contrato" e inclui quem voltou para Proposta, então ele e `emAndamento`
  contam o mesmo negócio duas vezes (é por isso que `coorte.test.ts`
  recalcula o fechado a partir de `situacao`). Na tela, "sem avanço" e "em
  andamento" aparecem sempre; o cartão "fora do funil" só entra quando há
  alguém nele — vazio, ele seria uma categoria que não explica nada.
- ⚠️ **Apagar etapa MAPEADA com histórico é barrado na tela de Funis.** O
  mapeamento é lido hoje sobre a história inteira (remapear reescreve o
  passado de propósito); etapa apagada some da classificação, a entrada no
  funil desliza para a próxima etapa mapeada e negócio que só passou por ela
  sai da coorte. "Zero negócios na etapa" NÃO protege disso — é o caso comum
  da etapa antiga. Saída explícita: pôr "Não conta", salvar, remover.
- **Os rótulos dos degraus são chave MONTADA** (`Pipelines.funil.degraus.<c>`,
  com `as Parameters<typeof t>[0]`); `degraus.test.ts` cobra os dois
  dicionários.
- **Os funis "TESTE" não são desta conta**: o seletor do operador lista só
  os 4 reais. Teste de tela com escrita = funil de teste criado na hora e
  apagado, ou mexer no real e REVERTER (medido na Fase 0: gravar e voltar
  `degrau` deixa NULL em tudo).
- **A LISTA (Fase 1, `src/components/funil/lista-de-leads.tsx` +
  `src/lib/funil/lista.ts`) mostra só quem está NESTE funil hoje e filtra o
  período pela CRIAÇÃO do negócio** (D3) — o transferido é do painel. A
  etapa na linha escreve pelo padrão do quadro (`update` + rowcount +
  `statusAoEntrarNaEtapa` + `avisarDrenagemDeFunil`), com estado otimista
  via `aplicarMudancaDeEtapa`; editar busca o negócio por id
  (`handleEditDealPorId`), porque a lista não carrega `deals`. Colunas por
  dispositivo em `localStorage` (`wacrm:pipelines:lista:colunas`,
  `normalizarColunas` é a migração). ⚠️ `useTrajetorias`: `carregando` é
  DERIVADO da chave do pedido — nunca `setState` síncrono no efeito (regra
  do React Compiler que já derrubou PR); resposta atrasada é descartada
  pela chave.
- **O DESEMPENHO (Fase 2, `src/components/funil/desempenho.tsx`) carrega a
  RPC UMA vez para `[desde do período anterior, hoje)`** e recorta as duas
  coortes em TS (`resumoDoPeriodo` × 2 + `comparar`). Funil sem etapa em
  `lead` → estado "configure" (abre Gerenciar funil); período sem coorte →
  zeros com a nota, NUNCA o "configure". Os cinco baldes da situação
  aparecem, "fora do funil" inclusive. Gráfico de barras = Tremor
  vendorizado; o de área é recharts DIRETO (`grafico-de-entradas.tsx`, cores
  por classe Tailwind com `stroke=""`/`fill=""`, o truque do Tremor) — não
  vendorizar mais um Tremor para isso. Números em pt-BR fixo
  (`apresentacao.ts`), como `currency.ts`.
- **A SAÚDE (Fase 3, `saude.tsx` + `mapa-de-calor.tsx` +
  `grafico-de-conversao.tsx`) são doze coortes MENSAIS pelo mês de entrada**,
  numa carga só. A cor do mapa é RELATIVA À LINHA (D6) e a escala é
  calculada SEM as coortes pequenas (`< COORTE_PEQUENA`, 5): 100% sobre um
  lead dominaria o ano inteiro. Coorte pequena mostra o número apagado com
  o motivo no `title`; mês sem coorte é "—", nunca 0%.
- ⚠️ **"Em andamento" no mapa é a coorte com lead SEM DESFECHO, não o mês
  corrente** (Codex, PR #122). Agosto com 6 abertos ainda muda em setembro,
  e setembro com tudo resolvido já é final — marcar o calendário tirava o
  aviso justamente de quem precisava dele. A marca é a CONTAGEM visível
  ("6 em aberto") sob o rótulo do mês, e sai de `CoorteMensal.emAberto`.
- ⚠️⚠️ **`etapasCarregadas` é prop OBRIGATÓRIA de `Desempenho` e `Saude`, e
  o motivo é o efeito passivo de sempre**: a página carrega as etapas DEPOIS
  da seleção, então `stages` é `[]` durante a carga — o MESMO `[]` de um
  funil sem etapa nenhuma. A guarda antiga (`stages.length > 0 &&
  !configurado`) escolhia o lado errado: funil sem etapa renderizava ZEROS
  com cara de funil configurado (Codex, PR #121). Quem sabe de quem são as
  etapas é a página (`etapasDe`), e a prop existe para o compilador cobrar
  de quem montar a vista numa tela nova.
- ⚠️ **Taxa NULA nunca vira 0 no gráfico** (`grafico-de-taxas.tsx`): no
  preset "Total" todo valor do período anterior é nulo, e transição sem
  denominador também é. Com `?? 0` o tooltip afirmava "0,0%" — conversão
  MEDIDA em zero, que não houve. O nulo viaja como nulo (recharts omite a
  barra) e o formatador escreve "—".
- ⚠️⚠️ **`resumo.fechados` NÃO é dinheiro.** São DUAS contas, e trocá-las é
  o erro fácil: `fechados` é "ALCANÇOU contrato" (regra 3, monotônica) e é o
  número do DEGRAU do funil de eficiência e das taxas; `fechadosAgora` é
  `situacao === 'fechado'` e é de onde saem valor fechado, ticket médio e o
  CAC. Um distrato — chegou a contrato e foi para etapa de perda — está nos
  dois primeiros e em nenhum dos segundos: contado como receita, ele
  reaparecia como dinheiro ganho E como perda, e dividia o investimento por
  um número inflado. Medido numa coorte de teste: 4 "contratos" e R$ 68.000
  onde havia 1 e R$ 24.000 (revisão do PR #123). A partição dos cinco baldes
  é por `situacao`, então quem a somar usa `fechadosAgora`.
- ⚠️ **O gráfico de entradas por dia soma o mesmo que o card "Leads".** A
  grade densa vem do intervalo (limitada pelo fim e por um teto de dias); a
  coorte, não. Relógio de navegador minutos atrás da meia-noite do banco, ou
  um período personalizado de décadas, deixava lead fora do gráfico com o
  card contando — os dias da coorte que a grade não cobre entram na lista.
- ⚠️ **CSV: aspas NÃO protegem contra fórmula.** O Excel tira a citação e
  AVALIA o que começa com `=`, `+`, `-`, `@`, tabulação ou CR. Nome de
  contato vem do push name do WhatsApp e campo personalizado vem do n8n:
  `=HYPERLINK(…&A1,…)` viraria link clicável levando a célula vizinha, no
  computador de quem abrir a planilha. `neutralizarFormula` (`lib/csv.ts`)
  põe apóstrofo na frente — menos em número, que precisa continuar número.
  Quem escrever outro exportador repete a passagem.
- ⚠️ **`created_at` da RPC é NULÁVEL, e `lerLinha` aceita.** `deals.created_at`
  é `DEFAULT now()` mas NULLABLE (001; a 912 já usa `coalesce`). Exigi-lo
  fazia UMA linha assim derrubar `carregarTrajetorias` inteiro — ele
  descarta a carga no primeiro inválido — e as três vistas ficavam em
  "falhou · tentar de novo" para sempre, por causa de um carimbo que só
  serve de queda para `naEtapaDesde` e de coluna na lista. A régua "não
  confie" vale para desvio de FORMA, não para timestamp opcional.
- ⚠️⚠️ **A LISTA leva `key={funil.id}` na página, e não é enfeite.** Sem ela
  o React reusa a instância ao trocar de funil: o FILTRO de etapa do funil
  anterior sobrevive, nenhuma etapa daqui casa com ele, e o operador vê
  "0 de 37" sobre um funil cheio com o seletor de etapa EM BRANCO — porque o
  id filtrado não existe nesta lista (Codex, PR #123). As três vistas também
  recebem `etapasCarregadas` pelo mesmo motivo de fundo: a página não limpa
  `stages` ao trocar de funil, então elas são as do ANTERIOR até a consulta
  voltar.
- ⚠️ **Exportar CSV espera os CATÁLOGOS, não só as linhas.** Canais e perfis
  chegam em buscas próprias, depois das trajetórias: exportar no meio disso
  grava Conexão e Responsável VAZIOS num arquivo que sai da tela e vira
  planilha. O botão fica desabilitado até os dois chegarem.
- ⚠️⚠️ **As cores das linhas da Saúde são TRÊS classes literais por degrau**
  (`traco`/`ponto`/`bloco`), nunca uma só derivada com
  `replace("stroke-", "fill-")`. O Tailwind varre o FONTE atrás de strings e
  não executa código: a classe montada em tempo de execução não é gerada, e
  o ponto da linha caía no preto padrão do SVG, sem erro nenhum. Medido no
  CSS compilado — `.fill-sky-500` tinha ZERO ocorrências (Codex, PR #123).
  Mesma armadilha da `PALETA_DE_CANAIS`.
- **META ADS (Fase 4, 976): o CRM só LÊ, e o token é o único segredo.**
  `src/lib/meta-ads/`: `janela-de-sync.ts`, `atribuicao.ts` e `cartao.ts`
  são puros e testados; `cliente.ts` faz I/O (os testes cobrem os ajudantes
  puros dele) e `sincronizar.ts` é server-side, com dublê no teste. Rotas em
  `/api/cb/meta-ads/`, cartão em Configurações → Integrações, e no
  Desempenho os cards de investimento/CAC. O que morde código novo:
  - ⚠️⚠️ **`cb_meta_ads_config` NÃO tem SELECT para `authenticated`** — nem
    a linha, nem o token cifrado, passam pelo PostgREST. A tela lê pela rota
    `GET /api/cb/meta-ads` (admin, service role), e **o token não sai de
    rota nenhuma, nem mascarado**. Campanhas e gastos, sim, têm SELECT: é
    deles que o Desempenho monta o investimento sob RLS.
  - ⚠️⚠️ **A mensagem da Meta ECOA O TOKEN, e ela ia para o LOG.** Medido em
    04/09 no primeiro teste da conexão: token malformado volta como
    "Malformed access token EAAB…", e os dois chamadores registram essa
    frase. Devolver só o CÓDIGO ao navegador **não bastava** — log de
    servidor é lido por quem não deveria ter o token, e a mensagem crua
    CONTINUA viva em `MetaAdsError.message`, de propósito, porque é ela que
    diz o que houve. Quem protege são duas funções de `cliente.ts`, e código
    novo precisa das duas:
    · **`semSegredo(texto, token)`** — por onde passa TUDO que vira
      `MetaAdsError.message`: troca o token pelo marcador `«token»` e limpa
      `access_token=` de URL. Há teste com a frase real medida.
    · **`doGraph(url)`** — recusa qualquer URL fora de
      `https://graph.facebook.com` antes do pedido. Ela existe porque o
      token viaja no CABEÇALHO e `paging.next` é uma URL vinda da RESPOSTA:
      segui-la para outro host entregaria o token àquele host.
    Os códigos são **seis** — `token_invalido`, `sem_permissao`,
    `conta_nao_encontrada`, `limite`, `rede` (tempo esgotado/falha de
    fetch) e `meta_error`. É a mesma armadilha da chave da OpenAI em
    `/api/cb/integracoes/status`.
  - ⚠️ **O token vai no cabeçalho `Authorization: Bearer`, nunca em
    `?access_token=`** na URL (vaza em log de proxy) — mesma regra da chave
    do Gemini. A cerca de origem que isso exige está no item acima
    (`doGraph`).
  - ⚠️ **A janela de sincronização é de 3 DIAS, não "hoje"**: a Meta
    reprocessa o gasto por até 48h. Puxar só o dia corrente congela um
    número que ainda muda, e o upsert é por `(conta, campanha, dia)`
    justamente para reescrever. Primeira sincronização: 90 dias.
  - ⚠️⚠️ **E o upsert sozinho NÃO limpa o dia que zerou.** Quando a Meta
    reprocessa um dia para zero, ela OMITE a linha em vez de devolver 0 —
    o valor antigo continuaria gravado e, ao sair da janela de 3 dias,
    viraria permanente, inflando investimento, custo por lead e CAC para
    sempre (Codex, PR #123). Por isso a janela é RECONCILIADA: o que estava
    lá e não voltou no retrato é apagado, agrupado POR DIA (3 consultas na
    janela normal; zero na primeira, que acha a tabela vazia). Há teste.
  - ⚠️ **Bater no teto de páginas ESTOURA, nunca devolve meia lista.** Uma
    sync que voltasse truncada gravaria `last_sync_at` sobre um import
    incompleto — e a janela seguinte tem 3 dias, então aqueles dias nunca
    mais seriam buscados. Falhando, a conta fica em `status = 'erro'`,
    visível na tela, e a próxima tentativa ainda é a primeira (90 dias).
  - ⚠️⚠️ **Consulta de gasto que falhou ou não coube NÃO vira número.**
    `useGastosDeAnuncios` devolve `falhou`, e o Desempenho diz que não
    conseguiu ler. Publicar a soma parcial como total faz custo por lead e
    CAC mentirem PARA BAIXO — e o `dia` ordena ASCENDENTE, então o que o
    teto cortaria seria justamente o gasto mais NOVO. As campanhas também
    paginam: campanha que não veio some do mapa e o gasto DELA é descartado
    por `gastoDoPeriodo`, sem nem entrar no aviso "sem funil".
  - ⚠️ **O chip do cartão não afirma "Não conectada" enquanto carrega.** Ele
    fica no cabeçalho, sempre visível: dizer isso durante a carga (ou quando
    a carga falha) acusa de desconexão uma integração de pé, e o operador
    recadastra conta e token para consertar o que não quebrou. "Conferindo…"
    enquanto não se sabe, vermelho quando a leitura falhou.
  - ⚠️ **Campanha SEM funil não some do total** — vira aviso com link para
    Integrações. Silenciada, o custo por lead sai menor do que é, que é o
    erro que ninguém percebe.
  - ⚠️ **O cron ordena as contas por `last_sync_attempt_at` (988; nunca
    tentada primeiro), e `sincronizarMetaAds` carimba essa coluna ANTES de
    qualquer trabalho, dê certo ou errado.** É o rodízio: a conta que ficou
    de fora do orçamento de 90 s num ciclo é a mais antiga do próximo.
    Ordenar só por `account_id` deixava a MESMA cauda de fora em todo ciclo
    (Codex, PR #163, achado no cron do tl;dv, que foi copiado deste) — e
    carimbar só no sucesso deixaria a conta que falha na frente para sempre.
  - ⚠️ **O cron entrou no laço LENTO do `docker-stack.yml`
    (`cb/scheduled flows cb/radar cb/meta-ads`), e o CI NÃO relê o `command`
    do agendador**: só vale depois de um `docker stack deploy` à mão na VPS,
    com o `crm.env` carregado. Sem isso as tabelas ficam vazias e os cards
    seguem dizendo "conecte o Meta Ads" — sem erro nenhum.
  - ⚠️ **No Desempenho, "conectado" é DERIVADO de haver campanha**
    (`use-gastos-de-anuncios.ts`), porque o membro não enxerga a config. Nos
    segundos entre conectar e a primeira sincronização — ou numa conta de
    anúncios sem campanha nenhuma — a linha ainda diz "conecte o Meta Ads".
    Quem quiser fechar essa fresta precisa de um sinal LIDO pelo membro, não
    de um SELECT em `cb_meta_ads_config`.
  - **Desconectar apaga só a config**: campanhas e gastos ficam, senão o
    histórico do Desempenho sumiria junto com o token.

⚠️ **Calendly → automação (977): o Calendly avisa por webhook, o motor faz o
resto.** `src/lib/calendly/` (`payload`, `assinatura`, `variaveis`, `cartao`,
`cliente` puros e testados; `conexao` e `processar` são I/O),
`src/lib/contacts/telefone.ts` (puro), rotas em `/api/cb/calendly/`, cartão
`calendly-card.tsx` em Integrações, gatilho `calendly_booking` e passo
`send_to_number` no motor (`engine.ts`, `validate.ts`, `descrever-passo.ts`,
`trigger-meta.ts`, builder + `calendly-trigger-config.tsx`). Plano vivo em
`docs/PLANO-integracao-calendly.md`. O que morde código novo:

- ⚠️⚠️ **A ficha do cliente NASCE do agendamento (08/09/2026)** — revisão da
  D2, decidida pelo operador. Telefone que não é de nenhum contato deixa de
  ser `sem_contato`: `processarAgendamento` chama `resolverDestinatario` (o
  mesmo do `send_to_number`, com o dono DURÁVEL da conta) e segue. O que
  morde código novo:
  - ⚠️ **A consulta de automações vem ANTES da criação.** Ninguém escutando
    = `sem_automacao` sem criar nada; sem essa ordem, um agendamento numa
    conta que não configurou a integração materializa um lead que ninguém
    pediu.
  - ⚠️ **Falha ao criar vira `sem_contato`, não `falhou`**: nada da
    automação rodou, repetir é seguro, e `sem_contato` é o que o botão
    "Processar de novo" aceita.
  - ⚠️ **A conversa nasce com `channel_id` NULO** e o disparo vai com ela.
    `channelInScope` deixa passar canal nulo (a passagem livre do resíduo de
    ingestão), então automação restrita a uma conexão AINDA dispara para
    lead novo. Quem apertar essa regra desliga o Calendly para lead novo.
  - ⚠️⚠️ **Lead novo não tem card, e `move_deal_stage` LANÇA nesse caso**
    ("nenhum negócio aberto para este contato"), encerrando a execução. A
    automação do Calendly precisa de um passo **`create_deal`** antes dele —
    `create_deal` desiste em silêncio quando já há card ("um card por
    contato"), então serve aos dois casos. Sem ele, todo lead novo termina
    `falhou` DEPOIS de já ter mandado o aviso.
  - **A corrida que motivou tudo, medida**: os dois primeiros agendamentos
    reais foram processados 4,2 s e 4,5 s ANTES de a ficha existir — ela
    nascia da mensagem que o OUTRO CRM manda pelo celular pareado
    (`persistDeviceMessage`). A integração dependia, sem dizer, de um
    sistema que vai ser desligado.
- ⚠️⚠️ **O Calendly NÃO tem campo de telefone**, e o telefone é o que acha o
  cliente. Três fontes, nesta ordem (`telefoneDoAgendamento`):
  `text_reminder_number` (SMS, com DDI) → a pergunta do formulário cujo
  rótulo o operador escreveu no cartão → heurística (rótulo que fala de
  telefone/WhatsApp, senão a primeira resposta com cara de telefone).
  ⚠️ **CPF tem 11 dígitos, como um celular sem DDI**, e formulário de
  escritório pergunta CPF: a heurística EXCLUI rótulo de documento
  (`cpf|cnpj|rg|cep|valor|processo…`) e resposta com pontuação de CPF/CNPJ.
  A pergunta configurada pelo operador VENCE a exclusão. A ORIGEM fica
  gravada no evento (`telefone_origem`) — é o que a tela mostra quando não
  há contato.
- ⚠️ **Sem `+`, 10 dígitos (fixo) ou 11 dígitos COM 9 na 3ª posição
  (celular) ganham o 55** (`digitosDoTelefone`): é o que o brasileiro
  digita. Com `+`, os dígitos entram como vieram. ⚠️ O "9 na 3ª posição"
  não é enfeite: "14045551234" (EUA, só dígitos) também tem 11 dígitos, e
  ganhar o 55 mandava o aviso — com os dados do agendamento — para outro
  destinatário (Codex, PR #128). Na América do Norte o 2º dígito do código
  de área nunca é 9 (N9X reservado), então o teste separa os dois; número
  de outro país com 11 dígitos e 9 ali (Bulgária fixo) ainda colide —
  a dica do editor manda escrever número de fora com `+`. Vale para o
  passo `send_to_number` também — o mesmo helper, senão "(83) 98874-5316"
  no editor saía para um número que não existe.
- ⚠️ **A assinatura é conferida sobre o corpo CRU** (`request.text()`),
  `Calendly-Webhook-Signature: t=…,v1=…` = HMAC-SHA256 de `t.corpo` com a
  chave que NÓS informamos ao assinar (cifrada em `signing_key`).
  Tolerância de 5 min contra replay. O token da URL só diz DE QUAL CONTA é
  a assinatura; quem protege a entrega é o HMAC.
- ⚠️ **Idempotência é o UNIQUE `(account_id, evento, invitee_uri)`**, com
  `ignoreDuplicates` no upsert — o Calendly REENVIA por 24h enquanto não
  recebe 2xx, e a segunda cópia não pode disparar a automação de novo.
  A rota responde 200 ANTES de processar (`after()`): o Calendly espera
  15 s, e a automação manda WhatsApp.
- ⚠️ **Evento que não é `invitee.created` responde 200 e não grava.** 4xx
  faria o Calendly retentar por 24h e DESATIVAR a assinatura inteira,
  inclusive para os agendamentos.
- **Reagendamento chega como `invitee.created` NOVO** (a URI do invitee
  muda): campos atualizados e aviso de novo, com
  `agendamento_situacao = "Reagendamento"`.
- ⚠️ **"Processar de novo" (botão no log, `POST /api/cb/calendly/eventos/[id]/reprocessar`)**
  roda o agendamento gravado outra vez — para depois de o operador arrumar o
  que faltava. Só aceita `RESULTADOS_REPROCESSAVEIS` (`recebido`,
  `sem_contato`, `sem_automacao`): repetir um `disparado` mandaria a mesma
  mensagem à equipe de novo, e em `falhou` não se sabe se o passo de envio
  já tinha rodado (aí o caminho é o histórico da automação e o "Executar
  automação" da conversa).
- ⚠️⚠️ **Processar um agendamento passa pelo CADEADO
  `cb_calendly_eventos.processando_desde` (980), nunca por "ler o estado e
  então processar".** É o mesmo `UPDATE…RETURNING` da transcrição de áudio
  (943), e vale pela mesma razão: no deploy `start-first` há dois processos
  Node vivos, e só o banco serializa. Sem ele, dois cliques (duas abas, dois
  administradores) ou um clique durante o `after()` do webhook davam dois
  avisos ao advogado e mexiam no card duas vezes. ⚠️ A guarda por IDADE da
  linha que existiu entre os PRs #134 e #135 **não serializava nada** — duas
  requisições achavam a mesma linha velha e passavam as duas — e não podia
  funcionar: em produção não há corte de duração de rota, então a idade não
  diz se o processamento anterior terminou (achado do Codex, duas rodadas).
  O webhook carimba o cadeado JUNTO com a linha, antes do `after()`.
  ⚠️ **Toda saída tem de SOLTAR o cadeado**: `gravarResultado` o zera na
  mesma escrita do resultado, e o caminho de exceção da rota grava `falhou`
  (não reprocessável) em vez de soltar limpo — a automação pode ter enviado
  antes de morrer. Claim mais velho que `RECOLHER_CLAIM_MS` (10 min) é
  tomado, senão processo morto trava o agendamento para sempre.
- ⚠️⚠️ **Recolher por idade só é seguro por causa de DUAS peças, e as duas
  são obrigatórias em código novo** (achado do Codex no PR #135):
  - **CERCA DE POSSE em toda escrita pós-claim** — `gravarResultado` e
    `liberarClaim` recebem o `processando_desde` do PRÓPRIO claim e filtram
    por ele. Sem ela, um dono recolhido terminava tarde, sobrescrevia o
    resultado de quem assumiu e SOLTAVA o cadeado vivo do outro, deixando um
    terceiro entrar. É a mesma cerca do worker do Radar (`running_desde`).
    `gravarResultado` devolve `{ gravou }` — `false` ali é normal, é a cerca
    agindo.
  - **TETO de processamento MENOR que o recolhimento**
    (`TETO_DE_PROCESSAMENTO_MS`, 4 min × 10 min), com teste cobrando a
    margem. Sem ele, "10 min sem notícias" não prova que o dono morreu — em
    produção não há corte de duração de rota —, e o recolhimento podia
    tomar a linha de um processamento VIVO, disparando a automação em
    paralelo. Quem passa do teto grava `falhou` e sai. ⚠️ Desistir não
    cancela o trabalho em voo (promessa não se aborta); quem impede o
    estrago é a cerca. ⚠️ Ele usa as VARIÁVEIS gravadas (979,
  `cb_calendly_eventos.variaveis`), nunca só o remonte: a tabela não guarda
  local/cancelar/remarcar/situação em coluna, e o remonte entregaria à
  automação menos variáveis que a primeira entrega, em silêncio.
- ⚠️ **`agendamento_data` sai de `formatToParts`, nunca de `toLocaleString`**
  (a forma muda entre majors do Node — o PR #66); `agendamento_inicio` é o
  ISO UTC cru, que é o que o campo `datetime` guarda (`campo-data.ts`).
  Fuso fixo `America/Sao_Paulo` em `FUSO_DO_ESCRITORIO`.
- ⚠️ **O nome vindo do Calendly é sobrescrito pela próxima mensagem do
  cliente**: `inbound-store.ts`, o webhook da Meta e a API v1 gravam o
  `pushName` do WhatsApp sempre que difere do salvo — para TODO nome,
  inclusive o editado à mão. Fixar o nome exige uma marca na ficha (fora
  deste PR, D5).
- ⚠️⚠️ **`send_to_number` NÃO herda o canal do disparo** (ao contrário de
  `send_message`): o canal do disparo é o número por onde o CLIENTE
  escreveu, e não diz nada sobre por qual número o escritório avisa a si
  mesmo. `channel_id` ausente = a conversa do número avisado, senão o padrão;
  preenchido = aquele número, **falhando FECHADO** se não resolver
  (`resolveEngineChannelPreferring` cai no padrão em silêncio — para o aviso
  do advogado isso seria a mensagem saindo pelo número errado).
- ⚠️ **`send_to_number` sai por `engineSendText` (robô)**: não roteia para
  funil, não reabre conversa, e a ficha/conversa do número avisado nascem
  por `resolverDestinatario` (`destinatario.ts`) com o DONO DA CONTA em
  `user_id` (está na allowlist de `dono-duravel.test.ts`). Não usa
  `resolveConversationByPhone` porque aquele módulo importa
  `api/v1/contacts.ts` → `tag-events.ts` → o motor (ciclo), e porque
  RENOMEIA contato existente — `contact_name` aqui só vale na criação.
- ⚠️ **Passo que falha ENCERRA a execução** (`executeStepsFrom`, `break`) —
  inclusive dentro de um ramo de condição, desde a 2ª rodada do Codex
  (antes o ramo falhava e o escopo de fora seguia).
  Na automação criada, o aviso vem ANTES de `move_deal_stage`, que falha
  quando o contato não tem card aberto — o aviso do agendamento não pode
  depender do card.
- ⚠️ **`webhook_state` é conferido AO VIVO a cada carga do cartão**
  (`conferirAssinatura`, `GET /webhook_subscriptions/{uuid}`): o Calendly
  DESATIVA a assinatura depois de 24h de entregas com falha e não avisa —
  a coluna gravada na criação diria "ativo" para sempre (Codex, PR #128).
  404 lá = `disabled` aqui (só reassinar resolve); 401 = token inválido;
  rede/limite = fica o que está. E toda entrega que chega grava
  `webhook_state = 'active'` — entrega chegando é prova de vida.
- ⚠️ **`dispararAutomacoes` DEVOLVE o que fez** (`ResultadoDoDisparo`:
  candidatas, fora do escopo, executadas, com falha, EM ESPERA, erro) —
  `runAutomationsForTrigger` continua `void` para os chamadores do upstream.
  O evento do Calendly grava `disparado` SÓ quando alguma automação rodou
  ATÉ O FIM sem falha; escopo de conexão/etapa barrando tudo é
  `sem_automacao` com o motivo escrito, passo que falhou é `falhou`, e
  execução parada num "Aguardar" é `em_espera` (978) — falha vence espera
  (Codex, PR #128, duas rodadas: antes tudo virava "disparado", inclusive a
  que nem tinha terminado). ⚠️ `em_espera` é TERMINAL para a linha do
  evento: o agendador retoma a execução e escreve só em `automation_logs`;
  o `detalhe` diz isso ao operador. Para isso `executeStepsFrom` devolve o
  status do ESCOPO — e ramo aninhado devolve o dele em vez de `null`:
  **passo que falha DENTRO de um ramo agora derruba a execução** (o escopo
  de fora marca `failed` e PARA, como pararia fora do ramo); antes a
  execução seguia e o log terminava "success" com `error_message`
  preenchido. ⚠️ "Aguardar" DENTRO de ramo sobe como `partial` no RETORNO,
  mas NÃO segura o escopo de fora: os passos seguintes rodam e o LOG
  termina pelo status deles (semântica do upstream; o ramo continua pelo
  agendador). Pinos em `engine.test.ts` ("ramo e espera") — o mock de
  `automation_steps` recorta por escopo só por causa deles.
- **A assinatura do webhook tenta `organization` e cai para `user`** (403):
  o token de quem não administra a organização só enxerga os próprios
  eventos. Token bom + webhook recusado grava `status='erro'` com o motivo
  (quase sempre plano sem webhooks — Standard+) e a tela oferece
  "Reassinar". A URL é recusada quando não é alcançável de fora
  (`ehUrlAlcancavel`) — dev local assinando `localhost` no Calendly da
  produção mataria a entrega em silêncio.
- **O gatilho compara `event_type_uri`** (config vazia = qualquer evento;
  disparo sem URI com config preenchida falha fechado). O nome do evento
  vai junto (`event_type_nome`) para a automação ficar legível quando a API
  não responde. O select vem de `GET /api/cb/calendly/event-types`.
- ⚠️ **`interpolate` (engine.ts) ganhou `{{contact.*}}` e `{{conversation.link}}`**
  (`contact.name|phone|email|company|link`, `contact.campo.<field_key>`,
  `contact.origem` = campanha - conjunto - anúncio da 949, só as partes
  preenchidas — três `contact.campo.*` no texto imprimiam " -  - " no
  contato sem anúncio, medido no primeiro aviso real).
  É ASSÍNCRONO agora (os 6 call sites usam `await`); o contato é carregado
  UMA vez por execução (`WeakMap` por `args`) e SÓ quando o texto cita
  `contact.`/`conversation.` — sem a guarda todo `send_message` pagaria
  três consultas. A chave do campo é a `field_key` do catálogo (948), não
  o nome exibido. Links usam `NEXT_PUBLIC_SITE_URL`; sem ela, caminho
  relativo.
- **Na grade por etapa do funil ela aparece como cartão de CHEGADA** sob
  "Reunião Agendada" (07/09): `cartoesDeChegada` em `grade-do-funil.ts`
  posiciona automação de OUTRO gatilho pela etapa de destino do
  `move_deal_stage`/`create_deal`. O operador foi procurá-la no funil e não
  achou — a grade só conhecia gatilho de etapa. ⚠️ Gatilho que NUNCA
  dispara (`GATILHOS_SEM_DISPARO` em `trigger-meta.ts`: `time_based`,
  `conversation_assigned`, sem call site) fica FORA dos cartões de chegada
  (Codex, PR #131) — o cartão afirmaria movimento de regra que não roda; há
  teste amarrando essa lista ao `TRIGGER_OPTIONS` do builder.

⚠️ **tl;dv → transcrições na ficha (987): a reunião vem pela API, e o
cliente vem pelo E-MAIL.** `src/lib/tldv/` (`cliente`, `leitura`, `texto`,
`vinculo`, `janela`, `cartao` puros e testados; `sincronizar` e `conexao`
são I/O), `src/lib/reunioes-transcritas/validar.ts`, rotas em
`/api/cb/tldv/*` e `/api/cb/reunioes-transcritas/*`, cartão em Integrações
e a seção **Transcrições** dentro da aba Reuniões — da ficha de Contatos E
do painel da conversa no inbox (`src/components/transcricoes/`). Plano vivo em
`docs/PLANO-integracao-tldv.md`. O que morde código novo:

- ⚠️⚠️ **O webhook do tl;dv NÃO é assinado, e por isso o corpo é AVISO,
  nunca dado.** A rota `/api/cb/tldv/webhook/[token]` lê SÓ o id da reunião
  e busca a reunião na API com a NOSSA chave (`importarReuniaoDoTldv`).
  Quem passar a gravar algo do corpo transforma o token da URL na única
  barreira entre a internet e a ficha do cliente.
- ⚠️ **O upsert da sincronização leva SÓ metadados** (nome, data, duração,
  participantes). `status`, `contact_id`, `vinculo_origem`, `texto` NÃO
  entram — reunião já conhecida mantém o que tem. Pôr `status: 'pendente'`
  no upsert "para garantir" apaga a transcrição gravada a cada ciclo.
- ⚠️ **Vínculo automático só quando `vinculo_origem IS NULL`**, e o UPDATE é
  cercado por `contact_id IS NULL`. `desvinculada` é o que impede a regra de
  religar o que uma pessoa desligou; sem a cerca, a regra atropelaria um
  vínculo manual feito entre a leitura e a escrita.
- ⚠️⚠️ **O vínculo automático tem DUAS fontes, e a segunda é a que funciona
  nesta conta**: o e-mail da FICHA e, quando ela não acha ninguém, o e-mail
  do AGENDAMENTO do Calendly (`cb_calendly_eventos`, 977) que já resolveu o
  contato pelo telefone. MEDIDO em 09/09/2026, na primeira conexão real: o
  convidado chega do tl;dv com o nome VAZIO e só o e-mail; dos 583 contatos
  só 1 tem e-mail na ficha; 13 dos 15 agendamentos do Calendly guardam
  e-mail e contato. Quem "simplificar" tirando a ponte devolve o vínculo
  automático a quase zero, sem erro nenhum.
- ⚠️ **`happenedAt` NÃO vem em ISO** — vem no formato de `Date.toString()`
  ("Wed Sep 09 2026 19:19:07 GMT+0000 (Coordinated Universal Time)"), ao
  contrário do que a doc mostra. `lerReuniao` normaliza via `Date.parse`;
  há pino com a forma real. E `template` não vem na listagem.
- ⚠️ **A janela é 7 dias SEMPRE, não "desde a última sincronização"**: o
  tl;dv processa a gravação depois da reunião e `happenedAt` é a hora da
  reunião. A idempotência é o UNIQUE `(account_id, tldv_meeting_id)`.
- ⚠️ **403 vira `falhou` na hora; 204 SEM CORPO (medido em produção, 09/09)
  ou 404 na transcrição é "ainda não pronta"** (conta tentativa; 12 →
  `sem_transcricao`). A doc sugeria 404; a API responde 204, e a primeira
  versão lia o corpo vazio como `tldv_error` — reunião recém-gravada
  aparecia como ERRO no cartão por estar só esperando. A doc diz que a exportação
  depende do PLANO de quem ORGANIZOU a reunião — insistir num 403 não muda.
  Chave inválida, limite e rede param o CICLO (são da conta).
- ⚠️ **O prazo do ciclo é medido por `Date.now()`, nunca por `agora`**:
  `agora` é carimbo (injetável); o prazo é "quanto esta chamada ainda pode
  gastar". Misturar os dois adiou toda transcrição no primeiro teste.
- ⚠️ **A lista da ficha NÃO seleciona `texto`/`segmentos`/`notas`**
  (`COLUNAS_DA_LISTA`); só o visualizador busca a linha inteira. ~80 KB por
  hora de reunião vezes dezenas de reuniões é o que a ficha carregaria.
- ⚠️ **A importada do tl;dv não se apaga; dela se tira o cliente.** A
  varredura de 7 dias a traria de volta sem cliente. `DELETE` só na
  `manual`, pelo autor ou admin.
- ⚠️ **A chave vai no cabeçalho `x-api-key`, nunca na URL**, e toda mensagem
  de erro passa por `semSegredo()` (a mesma disciplina do Meta Ads/Calendly).
- ⚠️ **O cron ordena as contas por `last_sync_attempt_at` (nunca tentada
  primeiro), e a varredura carimba essa coluna ANTES de qualquer trabalho,
  dê certo ou errado.** É o rodízio: a conta que ficou de fora do orçamento
  de 90 s num ciclo é a mais antiga do próximo. Ordenar por `account_id`
  (a forma do cron do Meta Ads) deixava a MESMA cauda de fora em todo ciclo
  (Codex, PR #163) — e carimbar só no sucesso deixaria a conta que falha na
  frente para sempre.
- **`cb/tldv` está no laço LENTO do `docker-stack.yml`** — e o CI não relê o
  `command` do agendador: vale depois de `docker stack deploy` manual.
- ⚠️ **Os dois hooks da aba Reuniões (`use-reunioes.ts`,
  `use-reunioes-transcritas.ts`) carimbam o DONO da lista (`{ de, reunioes }`)
  e DERIVAM `carregando` de `de !== contactId`.** O painel da conversa não
  remonta ao trocar de cliente: sem o carimbo, com a aba aberta, as reuniões
  do cliente anterior ficavam clicáveis sob o nome do novo até a resposta
  chegar (revisão do PR #187 — a aba entrou no painel em 09/09/2026). É a
  armadilha do efeito passivo, na sexta aparição; a guarda é a mesma dos
  campos personalizados (`{ de, mapa }`).

⚠️ **Webhooks de ENTRADA (982) e tags ADITIVAS na v1: o Typebot chama o CRM.**
`src/lib/webhooks-de-entrada/` (`achatar.ts` e o `resultadoDoDisparo`/
`escutamEsteWebhook` de `processar.ts` são puros e testados; `claim.ts` e
`repo.ts` fazem I/O), a porta em `/api/cb/entrada/[token]`, o admin em
`/api/cb/webhooks*`, o gatilho `webhook_received` e a seção Configurações →
Webhooks. Plano em `docs/PLANO-webhooks-de-entrada.md`; doc do operador em
`docs/webhooks.md`. O que morde código novo:

- ⚠️⚠️ **A porta é `/api/cb/entrada/[token]`, NÃO `/api/cb/webhooks/[token]`.**
  As duas não podem coexistir: o Next recusa dois nomes de segmento dinâmico
  na mesma posição, e `/api/cb/webhooks/[id]` é o admin. Quem "arrumar" a URL
  para ficar simétrica quebra o build.
- ⚠️⚠️ **O token na URL é ENDEREÇO; o segredo do cabeçalho é a CREDENCIAL.**
  O Calendly assina cada entrega com HMAC, e por isso lá o token basta —
  Typebot e n8n não assinam. Sem o segredo, a URL seria a única barreira, e
  URL vaza em log de proxy, histórico e captura de tela. O CHECK
  `cb_webhooks_credencial_ck` garante que só existe linha COM segredo ou
  linha declaradamente aberta (`sem_segredo`), nunca aberta por esquecimento.
- ⚠️⚠️ **O achatamento (`achatar.ts`) não é gosto — é o contrato do
  `interpolate` do motor.** A chave é casada por `[\w.]` e o motor lê UM
  nível (`partes[1]`), então acento, hífen e aninhamento fazem o `{{vars.x}}`
  ficar literal ou vazio **no texto que sai para o cliente**, sem erro
  nenhum. Daí `observação`→`observacao`, `pedido.total`→`pedido_total`, lista
  →`_0`/`_1`.
- ⚠️⚠️ **O sublinhado inicial é PODADO, e essa é a defesa das chaves
  reservadas.** `_cadeia` (guarda anti-ciclo da 936) e `_tag_chain_depth`
  vivem dentro de `vars`; payload de fora que as sobrescrevesse furaria as
  duas. Medido na tela: `{"_cadeia": "invasao"}` chega como `{{vars.cadeia}}`.
  Há teste cobrando que NENHUMA chave produzida comece com `_`.
- ⚠️⚠️ **A consulta de automações vem ANTES de criar a ficha.** Ninguém
  escutando = `sem_automacao` sem materializar nada. Medido em produção: o
  disparo numa conta sem automação criou ZERO contatos. Inverter a ordem
  enche a tela de Contatos de lead vindo de teste.
- ⚠️ **`id_externo` é `NOT NULL` COM DEFAULT aleatório, e o DEFAULT é
  load-bearing:** ele mantém o `UNIQUE (webhook_id, id_externo)` TOTAL, e só
  índice total serve de alvo do `ON CONFLICT` do PostgREST (lição da 903).
  Sem `campo_id` configurado cada entrega é evento novo; com ele, a reentrega
  é descartada antes de disparar automação.
- ⚠️ **O cadeado é GÊMEO do `src/lib/calendly/claim.ts`** — mesma mecânica,
  outra tabela, e de propósito NÃO foi fatorado: um helper genérico receberia
  tabela, coluna e lista por parâmetro, escondendo justamente as cercas que
  precisam ser lidas. Quem mudar a mecânica de um confere o outro.
- ⚠️ **A conversa criada aqui nasce com `channel_id` NULO**, e o disparo vai
  com ele. `channelInScope` deixa passar canal nulo (falha ABERTA), então
  automação restrita a uma conexão AINDA dispara para lead novo. Apertar a
  regra desliga o webhook justamente para quem acabou de chegar.
- ⚠️ **Lead novo não tem card**, e `move_deal_stage` LANÇA nesse caso,
  encerrando a execução. Automação de webhook que mexe no funil precisa de
  `create_deal` ANTES (ele desiste em silêncio quando já há card) — a mesma
  lição da automação do Calendly.
- **`variaveis` guarda o ACHATADO, não o corpo cru** (decisão igual à da
  977): a pergunta do operador é "por que `{{vars.nome}}` saiu vazio", e ela
  se responde com a lista de variáveis e valores. O cru seria uma segunda
  cópia de dado de cliente para responder a mesma pergunta.
- ⚠️⚠️ **A seção está em `SECOES_SO_DE_ADMIN`, e marcá-la `admin` em
  `ESCRITA_DA_SECAO` NÃO bastaria.** `podeVerSecao` tem um fail-open
  explícito (`if (!ctx.perfil) return true`): membro sem perfil de acesso
  enxerga toda seção que não esteja naquela lista, e um admin ainda podia
  marcar a caixa num perfil `agent`. Como todas as rotas `/api/cb/webhooks*`
  são `requireRole("admin")`, a seção não VAZA nada — ela simplesmente não
  funciona, e o operador fica com uma tela de Configurações permanentemente
  quebrada. `api` está no mesmo caso e ficou como está, de propósito (é
  comportamento antigo; mudá-la de carona esconderia a decisão).
  ⚠️ O teste `editor.test.ts` cravava `s !== "perfis"` em vez de derivar de
  `SECOES_SO_DE_ADMIN` — a segunda seção só-de-admin o reprovava como se o
  código estivesse errado. Agora deriva. (Achado do Codex no PR #150.)
- **Apagar o webhook leva o LOG junto** (FK CASCADE) — a tela põe o número na
  pergunta, porque "apagar" e "apagar 340 registros" são decisões diferentes.
- **A aba "Enviados" da mesma seção é a primeira TELA dos `webhook_endpoints`
  da 028**, que existiam desde o upstream e só eram configuráveis por `curl`
  com chave de API (zero endpoints registrados em produção). As rotas de
  sessão são `/api/cb/webhooks-de-saida*`, separadas das da v1 de propósito:
  reusar aquelas faria a tela carregar uma chave de API para falar com o
  próprio CRM. A tela DECLARA as duas limitações (uma tentativa de 5s sem
  retry; 15 falhas seguidas desligam) — sem isso o operador conta com
  garantia que não existe.

⚠️ **Tag ADITIVA na API v1: `POST /api/v1/contacts/{id}/tags`.**
`src/lib/api/v1/tags-do-contato.ts` (parse puro, testado). O `PATCH` com
`tags: []` continua SUBSTITUTIVO — é contrato publicado. O que morde código
novo:

- ⚠️⚠️ **UMA régua de "mesma etiqueta", em QUATRO lugares.** `chaveDeTag`
  (`src/lib/contacts/chave-de-tag.ts`) — aparado, sem acento, minúsculas —
  vale nas três portas que criam etiqueta (API aditiva, `PATCH`
  substitutivo, import de CSV) **e no banco**, pela coluna gerada
  `tags.name_key` da 983. Até a 983 eram duas réguas: a API casava sem
  acento e `resolveImportTagIds` casava com, então `"bancario"` num catálogo
  com `"Bancário"` criava uma SEGUNDA etiqueta, sem erro nem aviso. Decisão
  do operador em 09/09/2026: uma régua só.
  ⚠️ O TS usa `\p{Mn}`, nunca `\p{Diacritic}` — a mesma armadilha de
  `semAcento()`.
  ⚠️⚠️ **Os DOIS lados normalizam para NFD ANTES de apagar o sinal, e isso
  é a 984.** "Bancário" tem duas formas Unicode canonicamente equivalentes:
  a precomposta (`á` = U+00E1) e a DECOMPOSTA (`a` + U+0301), que sai de
  exportação feita no macOS e de vários geradores de CSV. A 983 normalizava
  o SQL com um `translate` de acentos PRECOMPOSTOS: medido, ela devolvia
  `bancario` para um e `bancário` para o outro, e o índice único deixava as
  duas entrarem. O furo era pior que uma duplicata no catálogo — com as duas
  inserções concorrentes, cada requisição podia reler antes do commit da
  outra, aplicar ids DIFERENTES ao contato e disparar `tag_added` duas vezes
  (achado do Codex no PR #151).
  ⚠️ O intervalo `[\u0300-\u036f]` é escrito por ESCAPE no arquivo, nunca
  com o caractere combinante literal — literal é invisível para quem lê e
  some numa cópia descuidada (aconteceu ao escrever a própria 984). Há teste
  cobrando a forma (`supabase/migrations/chave-de-tag-casa-com-o-ts.test.ts`).
  ⚠️ O TS ainda colapsa um pouco mais que o SQL — `\p{Mn}` alcança sinal
  combinante fora daquele bloco. A folga cai para o lado seguro: o código
  acha "é a mesma" e não tenta criar. O contrário — SQL colapsando mais —
  faria o código pedir etiqueta nova, levar 23505 e ela sumir em silêncio.
- ⚠️⚠️ **A criação é `upsert` com `ON CONFLICT DO NOTHING` + RELEITURA,
  nunca ler-então-inserir**, e mora só em `resolveImportTagIds` para as três
  portas herdarem. `tags` não tinha UNIQUE em `name`: duas requisições
  concorrentes com o mesmo nome NOVO passavam as duas pela leitura, inseriam
  as duas, e cada uma aplicava a SUA ao contato — o gatilho `tag_added`
  disparava DUAS vezes, o que numa automação sem etiqueta específica é a
  mensagem saindo em dobro para o cliente. O árbitro é a coluna GERADA
  `name_key`, e não um índice sobre expressão, porque o `on_conflict` do
  PostgREST aceita NOME DE COLUNA (mesma razão do `phone_normalized` da 022).
  ⚠️ O id sai da RELEITURA, nunca do retorno do insert: com
  `ignoreDuplicates`, quem perde a corrida recebe ZERO linhas.
- ⚠️⚠️ **`setContactTags` aplica SÓ os nomes PEDIDOS — nunca
  `tagIdByKey.values()`.** `resolveImportTagIds` devolve o CATÁLOGO INTEIRO
  chaveado por nome (o import de CSV consulta esse mapa linha a linha), e
  tomar os `values()` como "as desejadas" fazia o `PATCH
  /api/v1/contacts/{id}` com QUALQUER `tags` não-vazio aplicar TODAS as
  etiquetas da conta ao contato — enquanto a doc pública promete "replace the
  contact's tags". Defeito ANTIGO, achado só em 09/09/2026 na verificação
  e2e da 983: `contact_tags` estava zerada e não havia chave de API ativa,
  então o caminho nunca tinha rodado com etiqueta de verdade. Pino em
  `set-contact-tags.test.ts`.
- ⚠️⚠️ **TODA comparação de nome de etiqueta neste arquivo passa por
  `chaveDeTag` — validação incluída.** As duas divergiram numa revisão (a
  validação em `toLowerCase()`, a resolução em `chaveDeTag`), e o resultado
  era: `{add:["Bancário"], remove:["bancario"]}` PASSAVA pela recusa de
  "mesmo nome nos dois lados", o `remove` tirava a etiqueta e o `add`
  reinseria a MESMA — disparando o gatilho `tag_added`, que pode mandar
  mensagem ao cliente por uma etiqueta que ele já tinha antes e continua
  tendo depois. A resposta ainda relatava a mesma etiqueta em `removidas` e
  em `adicionadas`. Há teste pinando as duas pontas (achado do revisor).
- ⚠️ **Toda leitura de catálogo é ORDENADA por `created_at, id`**: na
  colisão de chave — possível em base anterior à 983, que RENOMEIA a
  duplicata em vez de apagar — vence a MAIS ANTIGA, a que o escritório vem
  usando. Sem o ORDER BY o PostgREST devolve em ordem não determinística e
  duas chamadas iguais escolheriam etiquetas diferentes. A mesma régua está
  no desempate da migration.
- ⚠️ **Trabalha por NOME, não por UUID**, porque não havia como o integrador
  descobrir um id de tag. `GET /api/v1/tags` entrou junto, para descoberta.
- ⚠️ **`ContactTagWriteError` NÃO é `ApiError`**: sem o ramo explícito no
  catch, um "Tag not found" (404) sai como 500 genérico.
- ⚠️ **`removeContactTag` passou a devolver `boolean`** (o `count` do delete).
  Sem ele, "removi" e "não estava lá" são indistinguíveis, e a resposta ao
  integrador não diria o que mudou. Os 2 chamadores antigos ignoram o retorno.
- **Escopo reusa `contacts:write`/`contacts:read`**: a chave precisa de
  `contacts:write` de qualquer jeito para criar o contato, então um `tags:*`
  separado não reduziria privilégio nenhum.
- ⚠️⚠️ **O upsert de criação vai ORDENADO, e isso evita DEADLOCK.** Com o
  índice único, o `ON CONFLICT DO NOTHING` passou a ESPERAR a transação
  concorrente que já inseriu a chave conflitante. Duas requisições mandando
  as MESMAS etiquetas novas em ordens diferentes fecham um ciclo de espera e
  o Postgres aborta uma com **40P01**. Antes da 983 não havia índice, logo
  não havia espera nem ciclo — é regressão daquele PR. Reproduzido num
  Postgres real pela revisão, e o controle com a mesma ordem NÃO deadlocka:
  ordenar `toCreate` elimina a classe inteira.
- ⚠️⚠️ **`setContactTags` ESTOURA quando um nome pedido não resolve.** Aquele
  verbo SUBSTITUI: o que não entra em `desired` entra em `toRemove`.
  Descartar um irresolvido em silêncio não é "aplicar menos" — é APAGAR do
  contato justamente a etiqueta que o chamador pediu para manter.
- ⚠️ **`skippedNames` PRECISA chegar à resposta do aditivo.** Sem isso, um
  nome que pediu criação e não resolveu não entrava em nenhum dos quatro
  baldes: 200 na cara do integrador, e nada dizendo que a etiqueta não foi
  aplicada.
- ⚠️⚠️ **`getContactById` ESTOURA em erro de banco** (desde a revisão de
  09/09). Enquanto erro e ausência eram o mesmo `null`, os quatro chamadores
  transformavam timeout do PostgREST em **404 "Contact not found"** — e no
  `PATCH` isso vinha DEPOIS da escrita bem-sucedida, então o integrador lia
  404 e recriava a ficha. Era a maior exceção à regra da casa.
- ⚠️ **A leitura do catálogo é PAGINADA** (`lerCatalogoDeTags`, compartilhada
  pelas três portas). O PostgREST corta em 1000 linhas sem avisar, e esse
  mapa é quem responde "esta etiqueta já existe?" — truncado, ele diz "não
  existe" sobre etiqueta que existe.
- ⚠️ **A tela do import de CSV usa a MESMA régua** na prévia, no mapa de
  cores e na contagem de "etiquetas únicas". Enquanto a prévia casava por
  `trim().toLowerCase()` e o import por `chaveDeTag`, a tela prometia "será
  criada" sobre etiqueta que o import ia reusar.
- **A auditoria sai de graça**: o trigger da 912 grava `tag_added`/
  `tag_removed` a cada INSERT/DELETE em `contact_tags`, e vindo de
  service-role registra com `origin = 'sistema'`. Não escrever log à mão.

⚠️ **Instagram Direct (em construção — plano vivo em
`docs/PLANO-instagram-direct.md`): o transporte é PREDICADO, nunca literal.**
`src/lib/cb-channels/transporte.ts` (`ehMeta`/`ehEvolution`/`ehInstagram`/
`ehWhatsApp`, e `transporteDe`, que LANÇA em valor desconhecido) e o teste
estrutural `transporte.chamadores.test.ts` (no `main` desde 10/09/2026, PR
#166). O que morde código novo:

- ⚠️⚠️ **`kind === 'evolution'` / `provider !== 'meta'` REPROVA o CI em todo
  `src/`** (fora de `transporte.ts`) — qualquer identificador terminado em
  kind/provider, sem distinção de caixa (`channelKind` inclusive). Motivo,
  medido antes do terceiro transporte: ~45 ternários com o `else`
  significando "Meta"; acrescentar `'instagram'` ao tipo dava 7 erros de
  compilação e NENHUM ramo de envio aparecia — um canal Instagram iria para
  a Cloud API com o token do Instagram e um IGSID no lugar do telefone.
  `switch (x.kind)` sobre o tipo `Transporte` é permitido SÓ com a
  asserção de exaustividade (`default: { const nunca: never = x; throw … }`,
  como em `IconeDoTransporte` e `transport/index.ts`) — o `tsconfig` não
  tem `noImplicitReturns`, então sem ela um 4º transporte compila e o
  `switch` devolve `undefined` em silêncio. `.eq('kind', …)` de consulta
  também é permitido.
- ⚠️ **Cada `else` que era "Meta" virou `ehMeta(...)` explícito**, e os ramos
  de Instagram já existem falhando FECHADO: núcleo de envio
  (`not_supported`), senders do robô (`exigirWhatsApp` — D1: robô não
  responde no Direct na v1), reação (400), apagar/editar (frase própria),
  canal padrão (recusa: o padrão é o número de WhatsApp que responde conversa
  sem canal e alimenta `whatsapp_config`), nova conversa (não oferece),
  compositor (sem modelo nem interativa, inclusive pelo atalho de resposta
  rápida). ⚠️ Sobraram ramos de DUAS pernas com predicado (`ehEvolution ?
  … : <Meta>` em envio, robô, reação, canal padrão, criação de canal): todos
  ficam ATRÁS de uma guarda de Instagram anterior no mesmo caminho, e é a
  guarda que os sustenta — o teste estrutural só pega o literal. Ramo novo
  de duas pernas sem guarda anterior é bug; o censo é `grep -n 'if (eh' src`.
- ⚠️ **`Contact.phone` é `string | null`** (PR #168): a ficha só do Instagram
  não tem telefone. Toda tela que mostra "o telefone" passa por
  `identidadeDoContato`/`nomeDoContato` (`src/lib/contacts/identidade.ts`):
  telefone, senão `@usuario`, senão o fallback que a TELA escolhe — parâmetro
  OBRIGATÓRIO de propósito, porque um padrão escondido sairia em inglês numa
  tela e em português noutra. Nunca o IGSID na tela. O `tsc` pegou só 11
  sítios; `{contact.phone}` em JSX, `name || phone` e tipos locais com
  `phone: string` ele NÃO vê — caçar por grep. Fotos de perfil e público de
  disparo já ignoram ficha sem telefone; o formulário de contato só dispensa
  o telefone na EDIÇÃO de ficha com `instagram_id`. ⚠️ Consulta que EMBUTE
  o contato (`contact:contacts(id, name, phone)`) precisa levar
  `instagram_username` junto, senão o `@` não chega e a ficha sem nome vira
  "contato desconhecido" — tarefas, logs de automação, runs de fluxo, radar,
  agendadas e o feed do painel já levam (Codex, PR #170).
- ⚠️ **IGSID nunca vai para `contacts.phone`**: `findExistingContact` casa
  pelos ÚLTIMOS 8 DÍGITOS — a armadilha do JID de grupo (906), agora com 16
  dígitos. A identidade do Instagram é `contacts.instagram_id` (989).
- ⚠️ **Quem assina o webhook do Instagram é o Instagram App Secret da aba do
  produto** (MEDIDO no Teste B da Fase 0, 09/09/2026) — não a "Chave secreta
  do aplicativo" que a doc da Meta sugere, e não `META_APP_SECRET`. É POR
  CANAL e cifrado (`cb_channels.ig_app_secret`, 989).
  `src/lib/instagram/assinatura.ts` (PR #169) recebe o segredo por
  parâmetro; segredo vazio nunca casa.
- ⚠️ **Toda DM chega com um `message_edit` de `num_edit: 0`** — não é edição,
  e consumida como tal cada DM viraria duas linhas; `interpretarWebhook`
  (`src/lib/instagram/webhook.ts`) ignora. A nota de voz vem como
  `attachments[type=audio]` numa URL assinada que EXPIRA (baixar na hora),
  com `content-type: video/mp4` — a classe sai do `type` do webhook
  (`midiaDoAnexo`), nunca do CDN, senão a voz vira vídeo no fio.
- ⚠️ **Token do Instagram só no cabeçalho `Authorization: Bearer`, nunca em
  `?access_token=`; a mensagem de erro da Meta ECOA o token e passa por
  `semSegredo`; o host é preso a `graph.instagram.com`**
  (`src/lib/instagram/graph.ts`, PR #167 — mesma família do cliente do Meta
  Ads). O token do painel dura 60 dias; a validade fica em
  `ig_token_expires_at` e o cron da Fase 6 renova.
- ⚠️ **A porta é `/api/cb/instagram/webhook` (PR da Fase 3b)**: só a
  assinatura que NÃO casa vale 401 — `object` errado, conta desconhecida e
  forma estranha são 200 com log, porque 4xx repetido faz a Meta desativar
  a assinatura (977). Uma entrega pode trazer várias `entry`; o segredo é
  do APP da Meta: cada `entry` só é persistida se a SUA conexão assina
  (`quaisAssinam`) — conta de outro app no mesmo corpo fica de fora, senão
  quem tem o segredo do próprio app forjaria o `entry.id` de outra conta
  deste CRM (Codex, PR #173). Edição e exclusão alcançam a mensagem pela
  CONVERSA do cliente na conta roteada, nunca por `mid` solto (só é único
  por conversa). Não-lidas pela RPC atômica `bump_conversation_on_inbound`.
  O perfil (nome, @, foto) é lido ANTES do roteamento para o funil — o card
  nasce com o nome — e só na criação, sem `@`, ou a cada 30 dias
  (`avatar_checked_at`, carimbado mesmo sem foto). A
  persistência (`src/lib/instagram/persistir.ts`) roda em `after()`, grava
  `user_id` = `accounts.owner_user_id` (dono durável, allowlist de
  `dono-duravel.test.ts`), NÃO importa os motores (teste estrutural
  `persistir.chamadores.test.ts`, D1) e entra nas allowlists de
  `pipeline-routing.chamadores` e `reopen.chamadores`. O eco (`is_echo`)
  com `mid` já gravado é o nosso próprio envio e o UNIQUE descarta; sem
  linha, é o app do Instagram e entra como `from_device`.
- ⚠️ **Conectar é pelo LOGIN DO INSTAGRAM (OAuth, Business Login) desde a
  Fase 2b (09/09/2026), com o token colado como alternativa.** O app da
  Meta (Instagram App ID + Instagram App Secret) fica POR CONTA em
  `cb_instagram_config` (990, fechada ao navegador; a rota
  `/api/cb/instagram/app` devolve só o App ID), e o canal criado pelo login
  continua gravando o segredo em `cb_channels.ig_app_secret` — a rota do
  webhook não mudou. O que morde (`src/lib/instagram/oauth.ts`):
  · O `state` é ASSINADO (HMAC de chave DERIVADA por HKDF da
    `ENCRYPTION_KEY`, `chaveDoEstado`) com conta, membro, nonce e validade
    de 15 min, e o nonce repete no cookie HttpOnly `cb_ig_oauth`; o callback
    exige os dois E a sessão de admin da MESMA conta — sem isso um link
    forjado amarraria o Instagram de um estranho à conta (login CSRF).
  · A URI de retorno tem de cair na origem onde a sessão e o cookie vivem,
    e `origemDoPedido` decide com `NEXT_PUBLIC_SITE_URL` como árbitro:
    pedido do host do site → a URL canônica; host local/privado (o preview
    em `localhost`) → o pedido; host PÚBLICO estranho no cabeçalho → o site
    (ignorado). Sem sessão a rota redireciona ANTES de qualquer checagem,
    então confiar no `Host` cru viraria `Location: https://evil…` a partir
    de um `curl` (revisão do #189). O painel da Meta só aceita URI
    registrada — a tela mostra a que registrar.
  · Trocar o App Secret em `cb_instagram_config` NÃO repropaga para os
    canais já conectados (cada `cb_channels.ig_app_secret` guarda o que
    valia na conexão): a assinatura dos webhooks deles para de casar até
    reconectar cada um pelo login. A tela avisa; e segredo em branco no
    token colado supõe token gerado pelo app cadastrado — token de OUTRO
    app passa no `/me` e nasce canal mudo.
  · `POST /me/subscribed_apps` é chamado ANTES de gravar o canal (o botão
    "Gerar token" do painel faz isso por baixo; o login não): canal que não
    recebe não pode nascer calado. A permissão de mensagens é conferida na
    resposta da troca (`permissions`) — dá para desmarcá-la no consentimento.
  · O token CURTO e o `client_secret` viajam na query da troca pelo longo
    (forma documentada do endpoint; o token vive 1 h e nunca é gravado;
    nenhum log imprime a URL) — a ÚNICA exceção à regra do `Bearer`;
    `semSegredo` apaga `access_token=` E `client_secret=`. O vencimento
    gravado é o `expires_in` MEDIDO.
  · Conectar pelo login uma conta que JÁ estava conectada (por token colado
    ou pelo login) SOBRESCREVE a linha — é o índice único global de
    `ig_user_id`: token, segredo e validade novos; rótulo e Human Agent
    FICAM (`canal.ts` só os grava quando o chamador manda, e o callback
    manda `null`). Não nasce segunda conexão, e o diálogo do webhook só abre
    na PRIMEIRA conexão de Instagram da conta (`?primeira=1`).
  · Preview e produção geram URIs de retorno DIFERENTES (é derivada do
    pedido), e as DUAS precisam estar registradas no painel da Meta — senão
    o teste local morre na página de erro do Instagram, antes do callback.
  · Standard Access: só conta ADICIONADA ao app no painel da Meta consegue
    autorizar; conta de fora exigiria App Review (Tech Provider).
  · `force_reauth=true` na URL de autorização: com mais de uma conta do
    escritório, o Instagram tem de PERGUNTAR qual — sem isso autorizaria a
    que já está logada no navegador.
- **Decisões do operador (10/09/2026), no plano**: robô fora (D1); janela de
  24h + `ig_human_agent` opcional, só depois da feature aprovada na Meta
  (D2); login do Instagram com Standard Access, e o token colado como
  alternativa (D3, revista em 09/09); ficha própria + unificação MANUAL com
  a ficha de WhatsApp (D4, Fase 5); o que a API não cobre — apagar-para-
  todos, responder citando, documento que não seja PDF, editar — fica
  INACESSÍVEL na conversa Instagram; nota de voz cabe via WAV (D5).

⚠️ **Meu dia (12/09/2026): a tela de entrada SUBSTITUI o app até o
"Continuar".** `src/lib/resumo-do-dia/{pendencia,contagens}.ts` e
`src/lib/auth/{token,sair}.ts` (puros, com teste), `src/hooks/use-resumo-do-dia.ts`,
`src/components/entrada/{porta-de-entrada,resumo-do-dia,limite-de-erro}.tsx`,
o `sessionId` no `useAuth` e o pino `src/lib/auth/sair.chamadores.test.ts`.
Plano vivo em `docs/PLANO-meu-dia.md`. Sem migration. O que morde código novo:

- ⚠️⚠️ **NÃO é um Dialog por cima do app, e nada do app pode renderizar fora
  da porta.** O layout inteiro do shell (menu, cabeçalho, página, o
  `PresenceHeartbeat`) fica DENTRO de `<PortaDeEntrada>`: montado por trás,
  um deep link `/inbox?c=X` abriria o fio e zeraria as não lidas da conversa
  para a conta inteira, e a presença seria publicada antes da confirmação.
  Consequência escrita: enquanto o Meu dia está aberto a pessoa aparece
  OFFLINE para os colegas (só o heartbeat publica presença) — são segundos.
- ⚠️⚠️ **Trava de MÃO ÚNICA, decidida uma vez por carga de página.** A regra
  (`precisaMostrar`: sessão de login nova OU primeiro acesso do dia) roda no
  inicializador do `useState` da porta e só FECHA. Nunca reavaliar por evento
  de auth (`SIGNED_IN` dispara a cada volta à aba), por remontagem (o spinner
  do "Ver como" e a troca de usuário remontam o que está abaixo do shell —
  daí o `Set` de módulo `liberadosNestaCarga`) nem pela virada do dia com a
  aba aberta. Abrir no meio do uso desmontaria o compositor: rascunho
  perdido, anexo preparado apagado do bucket, mensagem na janela de desfazer
  ENVIADA. Quem precisar reabrir (F2 do plano: 4 h sem atividade) escreve a
  única exceção, de propósito.
- ⚠️ **A chave "mesmo login" é o `session_id` do token de acesso**
  (`sessionIdDoToken`, decodificado sem verificar assinatura — chave de
  interface, não de autorização), publicado no contexto de auth no MESMO
  passo que `user`. `sessionId` nulo decide SÓ pelo dia: `null === null`
  como "mesma sessão" faria um registro sem sessão valer para todo login
  futuro. Medido em 12/09/2026: o `session_id` NÃO muda quando o app renova
  o token (`iat` 11:14 → 12:12, mesma claim), então "sessão nova" = login
  novo de verdade.
- ⚠️ **O registro é PARSE, nunca `as`** (`lerRegistro`): JSON estranho vira
  "sem registro" = a tela aparece (mostrar um resumo a mais é barato;
  esconder pendência não é). Chave `cb-meu-dia:<userId>`, uma por pessoa no
  mesmo navegador. Storage que lança (modo privado) cai para a memória.
- ⚠️ **Todo filtro "meu" é pelo `user.id` (= `profiles.user_id`), nunca
  `profiles.id`**, e vai ESCRITO na consulta: `cb_tasks`, `conversations` e
  `notifications` guardam `auth.users.id`, e em duas delas a RLS deixa a
  conta inteira ler tudo. O id errado devolve ZERO sem erro — "nada
  pendente" para quem tem 9 tarefas vencidas.
- ⚠️⚠️ **Nenhum número que a tela afirma como exato sai de uma lista com
  teto** (Codex, PR #196: com mil tarefas vencidas, a de hoje ficava fora do
  teto de 1000 do PostgREST e a tela dizia "0 vencem hoje"). As novidades
  são três COUNTs (`head: true`, sem linha, sem teto); as tarefas vêm em
  DUAS consultas (vencidas / hoje), cada uma com `count: 'exact'` — a tela
  afirma os totais do banco e lista só o começo; as listas que passam por
  recorte em JS (conversas atribuídas, as duas partições da fila) carregam o
  seu PRÓPRIO sinal `truncada`, e a tela escreve "mais de N" na partição que
  bateu no teto — nunca um número menor com cara de certo.
- ⚠️ **Estado por BLOCO (carregando / falhou / pronto), nunca "0" sem
  resposta** — é a armadilha "lista vazia virando afirmação": um bloco que
  dissesse "0 vencidas" durante a carga liberaria o Continuar com uma
  mentira. O botão espera as consultas até um teto de 8 s (`TETO_DE_ESPERA_MS`)
  e depois libera de qualquer jeito (sem rede, a pessoa entra). Qualquer
  estouro numa consulta — do banco ou da conta em JS — vira `falhou` daquele
  bloco; o `LimiteDeErro` cobre só erro de RENDER e renderiza o APP, nunca a
  entrada de novo (o repo não tem outro error boundary).
- ⚠️ **Cada bloco usa a régua da TELA para onde o clique leva**, senão o número
  do resumo e o da tela discordam: tarefas por `agruparPorPrazo` (o DIA,
  nunca a hora), conversas por `atrasoDeResposta` (10 min; grupo e encerrada
  fora) e por `conversaNoEscopo` em JS com o contexto REAL
  (`{ papel: profile.account_role, perfil: perfilDeAcesso }`, nunca `acesso`,
  que carrega a lente do "Ver como"). O select de conversas é ENXUTO
  (`SELECT_DE_CONVERSA`), não o `CONVERSATION_SELECT` do inbox — a fila sem
  responsável tem centenas de linhas — e leva `group:cb_groups(channel_id)`
  porque o recorte por canal em JS precisa do canal do GRUPO.
- ⚠️ **"Sem responsável" é ACERVO, e por isso é repartido pelo instante da
  confirmação anterior** (medido em 12/09/2026: 235 esperando há mais de
  10 min, 234 há mais de 30). Um "235" fixo toda manhã é o número que o olho
  aprende a pular. `novas` = começaram a esperar depois da última confirmação;
  `antigas` = o resto, em texto apagado. São DUAS consultas (≥ e < o instante),
  porque numa só, ordenada por espera e com teto, quem cai primeiro é o FIM
  da lista — as esperas mais recentes, que são as "novas" (a lição do Radar);
  `truncada` (o `count: 'exact'` passou do teto) vira "mais de N", nunca um
  número menor com cara de certo.
- ⚠️ **"Novidades desde a sua última entrada" conta pelo `created_at` >
  confirmação anterior (estrito), lidas ou não** — nunca as "não lidas" do
  sino, que acumulam avisos tratados por outro caminho (`read_at` só muda na
  página de Notificações; medido: 7 não lidas de 04/09 a 10/09, zero nas
  últimas 24 h). Sem registro no aparelho, a janela é 24 h.
- ⚠️⚠️ **Todo `auth.signOut(` em `src/` declara o escopo por escrito** — o
  padrão da biblioteca é `'global'` (auth-js 2.108.2: revoga TODOS os
  aparelhos) e é invisível. O "Sair" do menu continua global (D4 do plano,
  em aberto), o do convite também; o "Não é você? Sair" da entrada é LOCAL
  via `sairDesteAparelho`, que devolve o erro e só navega com sucesso (um
  signOut que falha por rede NÃO apaga a sessão; navegar assim forma o laço
  `/login` → `/dashboard`). O pino é deep-equal: chamada nova entra no
  manifesto por decisão visível no diff.
- ⚠️ **Todo link da tela CONFIRMA antes de navegar** (`onClick={onContinuar}`):
  a porta fica acima da página roteada, então navegar sem confirmar trocaria
  a URL e deixaria o resumo na frente da conversa pedida.
- ⚠️ **Bloco cuja tela está fora do perfil (D8): número SEM link, com aviso.**
  Esconder calaria uma obrigação atribuída à pessoa.
- **Sem bloco de reuniões, de propósito** (D13): `cb_meetings` está VAZIA em
  produção — as reuniões vivem no Calendly. Código para tabela vazia é código
  para futuro hipotético; entra quando a agenda for usada ou quando o
  Calendly gravar nela.

⚠️ **Dois testes novos fecham buracos de i18n que o portão do CI não
alcança.** `src/lib/automations/rotulo-do-gatilho.test.ts` e
`src/components/settings/rotulo-da-secao.test.ts`. Os dois rótulos são
pedidos por chave MONTADA (`triggers.<tipo>.label` e `sections.<id>`), e
`scripts/i18n-chaves-usadas.mjs` declara no próprio cabeçalho que não alcança
chave dinâmica — só as CONTA. Não é hipótese: ao acrescentar a seção Webhooks
o CI ficou inteiro verde e o menu mostrou `Settings.sections.webhooks` cru;
só a verificação na tela pegou. Gatilho ou seção nova sem entrada nos DOIS
dicionários agora reprova.

⚠️ **A MARCA vem de `src/lib/marca.ts`, nunca de literal nem do dicionário.**
`NOME_DO_APP` (de `NEXT_PUBLIC_APP_NAME`, com queda no genérico `'CRM'`) e
`LOGO_DO_APP` (de `NEXT_PUBLIC_APP_LOGO_URL`, opcional). Nasceu do
levantamento de venda (`docs/PLANO-produto-vendavel.md`): o nome do produto
estava em TRÊS fontes que podiam discordar, e mais sete frases citavam a
marca do projeto original. O que morde código novo:

- ⚠️ **Nome de produto não é tradução.** `Sidebar.title` foi REMOVIDA dos
  dois dicionários; a barra lateral e o `metadata` do `layout.tsx` leem
  `NOME_DO_APP` direto. Recriar a chave faz renomear o sistema exigir editar
  dois dicionários — e faz o nome divergir entre os idiomas.
- ⚠️ **O padrão no código é genérico DE PROPÓSITO.** Quem dá nome à nossa
  produção é o build-arg `NEXT_PUBLIC_APP_NAME` no `pipeline.yml`. Escrever
  "CB Advogados" em `marca.ts` faria a instalação de outra pessoa nascer se
  apresentando como a nossa — e o `scripts/produto-gate.test.ts` reprova.
- ⚠️ **É build-arg, não env de runtime** (todo `NEXT_PUBLIC_*` é inlinado no
  bundle): mudar o `crm.env` da VPS não muda o nome. Mesma armadilha do
  `NEXT_PUBLIC_APP_LOCALE`, registrada em "Deploy".
- ⚠️ **Frase de UI não cita o nome do produto** — nem o nosso, nem o do
  upstream. Onde o nome é necessário, ele entra como `{appName}` (é o caso
  de `SignupPage.description` e `Settings.invite.whatsappMessage`); onde não
  é, a frase diz "este CRM". Merge do upstream reintroduz "wacrm" em toda
  chave nova.

⚠️ **`scripts/produto-gate.test.ts` reprova a nossa infraestrutura em código
que viaja.** Proíbe `cbadvogados`, `CBAdvNet`, o IP da VPS, o ref do
Supabase, as duas contas do GitHub e o domínio de marketing do upstream em
`src/`, `messages/`, `supabase/` e na raiz. **Escopo estreito de propósito**:
`docs/`, `ops/`, `CLAUDE.md`, `docker-stack.yml` e os workflows ainda
descrevem a nossa infra e ficam de fora até as Fases 1 e 4.4 do plano.
Exceção nova entra em `EXCECOES` com o motivo escrito, nunca alargando o
padrão.

⚠️ **Recuperação de senha: `/auth/callback` e `/reset-password` existem
desde 2026-09-08, e são um par.** A tela de "esqueci a senha" aponta para as
duas desde o upstream e nenhuma existia — o e-mail chegava e o link caía em
404. Apagar uma apaga a recuperação de senha inteira. O que morde código
novo:

- ⚠️ **O `next` do callback passa por `destinoSeguro`** (`src/lib/auth/
  destino-seguro.ts`, puro, com teste), nunca cru: com o navegador já
  autenticado, um `next` para outro host é open redirect no exato momento
  em que a pessoa está disposta a digitar uma senha. A régua é a ORIGEM
  RESOLVIDA — `//evil.com`, `/\evil.com`, `https://evil.com` e
  `javascript:` passam por `startsWith('/')` e morrem na comparação de
  origem.
- ⚠️ **As duas rotas ficam FORA do `protectedPaths` do middleware.** Quem
  chega no callback ainda não tem sessão; protegê-lo mandaria a pessoa para
  o login levando o `code` embora, e o código do e-mail é de uso único.
- ⚠️ **A instalação precisa de `<origem>/auth/callback` na lista de
  redirects do Supabase** (Authentication → URL Configuration), ao lado do
  `/join/*` que já existia. Está escrito no `docs/INSTALACAO.md`.

⚠️ **`scripts/env-documentado.test.ts` cobra o `.env.local.example`.** Toda
`process.env.X` lida em `src/` tem de aparecer lá como `X=`, comentada ou
não. Existe porque três variáveis da Evolution (`EVOLUTION_BASE_URL`,
`EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`) eram lidas pelo
transporte que a produção usa e não estavam documentadas: quem copiasse o
exemplo e preenchesse tudo terminava sem WhatsApp e sem uma linha dizendo o
que faltava. `mcp-server/` fica fora (tem `.env.example` e doc próprios).

⚠️ **Baileys 7 / Evolution 2.4 — o plano vivo é `docs/PLANO-baileys-7.md`.** O
"Aguardando mensagem" nas mensagens que o CRM envia é a Baileys 6.7.19 (dentro
da Evolution 2.3.2) sem noção de LID: duas sessões de criptografia por aparelho,
medidas no Redis. O conserto é a Baileys ≥ 7.0.0-rc13 via Evolution
`develop`/`homolog` (2.4.0, com cadastro obrigatório). O que morde código novo,
já valendo ANTES do upgrade (os ajustes são retrocompatíveis):

- ⚠️ **O LID muda de CAMPO conforme a versão da Evolution**: 2.3.2 põe o
  telefone em `remoteJid` e o LID em `previousRemoteJid`; a `develop` TROCA
  (`remoteJid` telefone, `remoteJidAlt` LID); a 2.3.7 põe telefone nos dois e
  PERDE o LID. `lidJidFromKey` (`evolution-inbound.ts`) lê os três lugares —
  ler só um deles faz `remote_jid_lid` nascer NULL depois do upgrade e devolve
  o bug de 28/07 (apagar/editar mensagem do celular em conversa LID não faz
  nada). Há teste para as três formas.
- ⚠️ **O nosso LID em grupo vem de `senderLid`, nunca de `senderJid`**
  (`lidDoRemetente`): `remetenteDoGrupo` prefere o telefone, e a Baileys 7
  manda `participantAlt` com o número — `aprenderNossoLid` só aceita `@lid` e
  deixaria de aprender para sempre.
- ⚠️ **Participante de grupo na Baileys 7 é `Contact`** (`id`, `phoneNumber`
  quando `id` é LID, `lid` quando `id` é telefone; `.jid` não existe mais).
  `parseGroupInfo` lê as duas formas.
- ⚠️ **`GROUP_UPDATE` só entra em `WEBHOOK_EVENTS` DEPOIS do upgrade**: a 2.3.2
  recusa a lista inteira com evento desconhecido (conferido em 28/07/2026).
- Operação (estado em 09/09/2026 21:11): a imagem é a NOSSA,
  `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao@sha256:dc0f4e8b…`
  (commit `e273b904` do `develop` + patch da citação do cliente + `prisma.config.ts`
  dentro — `docker/evolution-cb/`), SEMPRE por digest; `TELEMETRY_ENABLED=false`;
  a licença está ativa (tabela `RuntimeConfig` do banco `evolution`); a stack
  completa está em `ops/vps/evolution-stack.yml` (= `/root/evolution-stack.yml`,
  segredos em `/root/evolution.env`), e `docker stack deploy` da Evolution só
  vale para RECRIAR o serviço com esse arquivo, nunca para atualizar (o `.yml`
  não acompanha o `service update`); backup do Redis é SÓ do db 8 (o Redis é
  compartilhado com outros serviços); o log da Evolution morre no reinício do
  contêiner; o cron `docker image prune -af` apaga as imagens de rollback na
  madrugada seguinte (são públicas, voltam com `pull`).

- ⚠️ **Recibo fora de ordem (medido 09/09/2026, primeira mensagem depois do
  upgrade)**: a 2.4 emite `SERVER_ACK` DEPOIS do `DELIVERY_ACK` da mesma
  mensagem. A rota do webhook aplica a ESCADA (`src/lib/whatsapp/transport/
  escada-de-status.ts`, puro, testado): `UPDATE messages SET status` só com
  `.in('status', aceitamAvancoPara(novo))`, e o fan-out `message.status_updated`
  só quando alguma linha avançou. Quem escrever outro caminho de status repete
  a guarda — sem ela a bolha volta a um ✓ com a mensagem entregue.

- ⚠️ **Recibo ANTES da mensagem (medido 10/09/2026) — e isso NÃO é da
  Baileys 7.** A Evolution despacha a mensagem e o recibo de entrega dela no
  mesmo segundo; a mensagem do celular só é gravada depois da espera de 2 s
  do `jaGravada` (o prazo para o eco de um envio do próprio CRM aparecer), e
  o recibo é um UPDATE só. No log do PostgREST, o PATCH do recibo saiu 1,9 s
  ANTES do POST da mensagem, achou zero linhas e o recibo morreu — a bolha
  ficava num ✓ até o cliente LER. Medido: 38% das mensagens do celular presas
  em `sent` antes do upgrade, 34% depois; o envio pelo CRM tem a mesma janela
  (a linha nasce depois que a Evolution responde). A rota passa o recibo por
  `aplicarReciboQuandoAMensagemExistir` (`recibo-antes-da-mensagem.ts`): sem
  linha, tenta de novo em pausas até ~30 s; linha que existe e não avança é
  recibo velho, e ela desiste. Recibo de mensagem RECEBIDA (`fromMe` false)
  não espera. Quem escrever outro consumidor de recibo repete a espera — o
  UPDATE solto perde a corrida em silêncio.

- ⚠️ **Edição de mensagem chega CIFRADA na 2.4 (medido 09/09/2026)**:
  `secretEncryptedMessage` com `secretEncType` 2 (MESSAGE_EDIT) e
  `targetMessageKey` — a Baileys rc13 não decifra (PRs upstream #2690/#2743
  abertos). `normalizeUpsert` DESCARTA o item (sem ele virava bolha vazia) e
  a rota carimba `edited_at` na mensagem alvo MANTENDO o texto antigo — a
  bolha diz "editada" sem o "era: …". O texto novo não existe do nosso lado;
  quem for "consertar" a bolha vazia de outro jeito, ou preencher o texto,
  lê `isSecretEncrypted`/`edicaoCifrada` antes.
- ⚠️ **Todo `protocolMessage` vira `messages.edited` na 2.4**, inclusive a
  REVOGAÇÃO (`type: 0`, sem `editedMessage`): a rota ignora `messages.edited`
  sem texto de propósito, e o apagar-para-todos continua chegando pelo
  `messages.delete` de sempre. Não "consertar" o edited vazio como se fosse
  edição.

## Branches — criação e nomenclatura

- **Toda branch nova sai única e exclusivamente de `main`** e faz merge **de
  volta para `main`** (via PR no CB-CRM). Nunca criar branch a partir de outra
  branch de feature nem do upstream.
- Nomenclatura: `<tipo>/<descricao-kebab-case>`, com `tipo` ∈
  `feat` · `fix` · `chore` · `docs` · `refactor`. (Mesma convenção do upstream.)
  Ex.: `feat/integracao-processos-tj`, `fix/webhook-duplicado`.
- `git checkout main && git pull origin main` **antes** de criar a branch, para
  sair do `main` atualizado.

## Workflow de migrations (Supabase)

- **Nomenclatura:** `NNN_descricao_snake_case.sql`, sequencial de 3 dígitos
  (o upstream está em `036`). ⚠️ **NÃO é timestamp.**
- ⚠️ **Evitar colisão de número com o upstream:** como o original também numera
  em sequência, se criarmos `037_...` e o upstream criar `037_...`, colidem no
  merge. **Nossas migrations próprias usam a faixa reservada `900+`** e prefixo
  `cb_` na descrição: `900_cb_<descricao>.sql`, `901_cb_...`. Assim ficam
  isoladas da numeração do upstream.
- ⚠️ **Exceção existente:** a integração Evolution criou
  `037_evolution_transport.sql` na sequência do upstream, não no `900+`. Já está
  aplicada e no `main` — **não renumerar**. É exceção conhecida; daqui em diante
  seguir o `900+`. Se o upstream um dia criar um `037_*`, resolver o conflito de
  número renomeando o **do upstream** no merge, nunca o nosso já aplicado.
  ✅ **Isso aconteceu no merge de 2026-08-26.** O upstream criou
  `037_webhook_broadcast_reliability.sql`, colidindo com a nossa. As **três**
  dele foram renumeradas — `037→040`, `038→041`, `039→042` — e não só a que
  colidia: a `041` dropa a função que a `040` cria, então a ordem relativa
  tinha de ser preservada. ⚠️ O Git **não** reporta essa colisão como
  conflito (são nomes de arquivo diferentes) — conferir à mão a cada merge.
  ⚠️ **Aplicadas até aqui** (última conferência: 2026-08-28, via Management
  API). A lista é acumulada e foi consolidada nesta data — antes tinha camadas
  repetidas com datas fora de ordem:

  - **900–932** — as nossas até a agendada com mídia (`932`).
  - **933–937** — gatilho e ações de funil, lembrete por data, orquestração,
    batimento das automações.
  - **040/041/042** — as três do upstream renumeradas no merge de 2026-08-26.
  - **940–943** — broadcast com canal, radar de atendimento, índices do radar,
    transcrição de áudio.
  - **944_cb_tarefas** — painel de tarefas (PR #39).
  - **945_cb_agenda_de_reunioes** — agenda, Fase 1 (PR #40). Aplicada em
    2026-08-28 e registrada no histórico como `20260828183655`.
  - **946–947** — modelo do Radar e lembrete da reunião. ⚠️ A **947 está
    aplicada mas SEM registro no histórico** (função
    `cb_alvos_de_lembrete_reuniao` + índice conferidos no schema em
    2026-08-29) — é a segunda da lista da 037: o histórico não é fonte de
    verdade completa.
  - **948–951** — plano do painel do contato (948 chave/tipos de campo, 949
    categoria de traqueamento, 950 etapa com resultado) e **951_cb_nota_fixada**
    (fixar anotação por cliente, 2026-08-29).
  - **952_cb_lembrete_depois_de_realizada** — recria
    `cb_alvos_de_lembrete_reuniao` com `p_incluir_realizadas` (follow-up
    "depois" tem de aceitar reunião realizada) e alarga o índice parcial.
    Aplicada em 2026-08-30. ⚠️ DROP + CREATE, não REPLACE: parâmetro novo
    muda a assinatura e o REPLACE deixaria um overload ambíguo para o RPC.
  - **953_cb_acervo_de_midias** — acervo de mídias da conta (`cb_media_library`),
    aplicada em 2026-08-30.
  - **954_cb_acervo_so_admin_no_storage** — a guarda de papel do acervo também
    nas policies de Storage do `chat-media`. Aplicada em 2026-08-30.
  - **955_cb_robo_parado_pela_equipe** — `stopped_by_agent` no CHECK de
    `flow_runs.status` (parada DECIDIDA por gente, via aba da conversa).
    Aplicada em 2026-08-30.
  - **956_cb_perfis_de_acesso a 962_cb_papel_segue_o_perfil** — perfis de
    acesso, Fases 1–6 (PR #69). Aplicadas em 2026-08-30.
  - **963_cb_conversa_aberta** — presença por conversa (tabela + RPC +
    realtime). Aplicada em 2026-08-30. ⚠️ NASCEU como `956` e COLIDIU com a
    `956_cb_perfis_de_acesso` (duas branches em paralelo); o replay do CI
    estoura com número duplicado, então o ARQUIVO foi renumerado no merge —
    o da presença, porque as 957–962 dependem da de perfis. O histórico do
    Supabase não muda (registra por timestamp), mesmo caso da 906.
  - **964_cb_disparo_e_regras_so_admin** — as 12 policies de ESCRITA de
    `automations`, `automation_steps`, `flows`, `flow_nodes`, `broadcasts` e
    `broadcast_recipients` passam de `'agent'` para `'admin'`, alcançando a
    decisão que a Fase 2 dos perfis só tinha aplicado nas ROTAS. Aplicada em
    2026-08-31. SELECT continua aberto a qualquer membro da conta.
  - **965_cb_transferencia_limpa_perfil** — `transfer_account_ownership`
    (018) passa a limpar `perfil_id` ao promover o novo dono: o caminho da
    transferência ficara fora da 962 e deixava a divergência papel×perfil
    presa num owner, irremovível pela UI. Aplicada em 2026-08-31.
  - **966_cb_grupos_de_campos** — blocos de campos personalizados
    (`cb_grupos_de_campos` + `custom_fields.grupo_id`/`posicao` + as duas RPCs
    de ordenação). Aplicada em 2026-08-31. ⚠️ NASCEU como `965` e COLIDIU com
    a `965_cb_transferencia_limpa_perfil` — o TERCEIRO caso de duas branches
    em paralelo (depois da 906 e da 963), e o mais instrutivo: as duas foram
    APLICADAS no mesmo banco com 15 minutos de diferença, então o histórico do
    Supabase tem duas entradas `965` e nenhum comando reclamou. O `git merge`
    também passou limpo — são nomes de arquivo diferentes, então não há
    conflito para o Git relatar. Quem pega é o replay do CI, depois. O ARQUIVO
    foi renumerado (o desta, porque a outra já estava no `main`); o histórico
    não se mexe, como na 906 e na 963.
  - **967_cb_filtros_salvos** — recorte nomeado da caixa de entrada
    (`cb_inbox_saved_filters`): DA CONTA, admin+ escreve e qualquer membro lê.
    Aplicada em 2026-08-31.
  - **968_cb_filtro_padrao** — qual filtro salvo abre a caixa de entrada DE
    CADA MEMBRO (`cb_inbox_filtro_padrao`, uma linha por pessoa por conta) +
    o único `(id, account_id)` em `cb_inbox_saved_filters` que a FK composta
    exige. Aplicada em 2026-08-31.
  - **969_cb_nome_do_anexo** — `messages.media_filename`: o nome do arquivo
    como o remetente o enviou. Aplicada em 2026-09-01. SEM backfill, de
    propósito (ver a seção "Nome do anexo").
  - **970_cb_indice_da_agendada_por_mensagem** — índice PARCIAL em
    `cb_scheduled_messages(message_id) WHERE message_id IS NOT NULL`, para
    a pergunta "esta mensagem nasceu de agendada?" do Radar (worker e
    painel). Aplicada em 2026-09-01.
  - **971_cb_transferencia_leva_o_acervo** — `transfer_account_ownership`
    reparenta `contacts`/`conversations`/`custom_fields` para o novo dono +
    backfill idempotente (medido: 0 linhas fora do dono em produção).
    Aplicada em 2026-09-01.
  - **972_cb_aguardando_resposta** — `conversations.aguardando_desde` +
    três gatilhos (mensagem nova mexe no relógio; mensagem apagada
    recalcula; encerrar limpa) + acervo idempotente. Aplicada em 2026-09-02
    via conector, com autorização do operador, ANTES do merge do PR #106 —
    o app em produção só passa a ler a coluna quando o PR entrar. Medido na
    aplicação: 64 conversas esperando, 62 já além dos 10 min, 18 há mais de
    um dia. Sem a coluna o alerta simplesmente não aparece (vem `undefined`
    e a régua responde "ninguém esperando") — nada quebra.

  - **973_cb_foto_do_contato** — `contacts.avatar_checked_at` (última
    conferência da foto de perfil na Evolution). Aplicada em 2026-09-03 via
    conector, ANTES do merge do PR #110 (o app grava a coluna) — conferida
    por leitura no PostgREST antes de mesclar.

  - **974_cb_filtros_salvos_por_membro** — `cb_inbox_saved_filters.user_id`
    (dono; `DEFAULT auth.uid()` para a janela entre migration e deploy),
    policies "só as minhas", nome único por membro. Aplicada em 2026-09-03
    via conector, ANTES do merge; conferido: os 2 filtros ficaram com o
    criador.

  - **975_cb_degrau_do_funil** — `pipeline_stages.degrau`, índice
    `cb_lead_events_funil_idx` e a RPC `cb_funil_trajetorias` (Fase 0 do
    funil comercial). Aplicada em 2026-09-04 via conector, ANTES do merge;
    conferido: 123 linhas no Bancário - Comercial, `anon` sem EXECUTE,
    `authenticated` com. Sem backfill de `degrau`, de propósito. ⚠️ O
    replay do CI reprovou a primeira versão: a conferência chama a RPC
    (SECURITY INVOKER) como `authenticated`, e em banco VAZIO ele não tinha
    SELECT em `contacts` — a migration passou a conceder SELECT nas seis
    tabelas que a função lê (no-op em produção). Função INVOKER conferida
    trocando de papel = GRANT nas tabelas que ela lê, sempre.

  - **976_cb_meta_ads** — as três tabelas do Meta Ads
    (`cb_meta_ads_config` sem SELECT para `authenticated`, `..._campanhas`
    com a FK composta `(pipeline_id, account_id)` e `..._gastos` por dia).
    Aplicada em 2026-09-04 via conector, ANTES do merge; conferido por
    consulta: RLS ligada nas três, `anon` sem SELECT, `authenticated` sem
    escrita, `service_role` com INSERT.
  - **977_cb_calendly** — `cb_calendly_config` (token e chave de assinatura
    cifrados, token de rota do webhook) e `cb_calendly_eventos` (cada
    agendamento recebido e o que aconteceu com ele; UNIQUE por invitee =
    idempotência). As duas FECHADAS para `authenticated` — a tela lê pela
    rota. Aplicada em 2026-09-07 via conector, ANTES do merge, com
    autorização do operador; conferido por consulta (RLS, grants, histórico).
    Plano em `docs/PLANO-integracao-calendly.md`.
  - **978_cb_calendly_em_espera** — o CHECK de `cb_calendly_eventos.resultado`
    ganha `'em_espera'` (automação parada num "Aguardar"; Codex, 2ª rodada).
    Aplicada em 2026-09-07 via conector, ANTES do merge do PR #132;
    conferido no catálogo (o CHECK recriado com o mesmo nome que a 977 lhe
    deu, `cb_calendly_eventos_resultado_check`, e a entrada no histórico).
    Deploy antes dela não quebraria o app: `gravarResultado` falharia no
    CHECK só para automação parada em "Aguardar" (log de erro, a linha do
    evento ficaria `recebido`) — e a automação de produção não tem espera.
  - **979–981** — variáveis do Calendly, o cadeado do Calendly e o
    endurecimento de apagar contato. (Aplicadas antes desta linha existir; a
    lista acima ficou parada na 978 por um tempo.)
  - **982_cb_webhooks_de_entrada** — `cb_webhooks` (nome, token em claro,
    segredo cifrado, mapeamento de campos) e `cb_webhook_eventos` (o log, com
    o payload ACHATADO e o cadeado). As duas FECHADAS para `authenticated` —
    a tela lê pela rota. Aplicada em 2026-09-08 via conector, ANTES do merge,
    com autorização do operador; conferido por consulta (RLS ligada nas duas,
    `anon` e membro sem SELECT, `service_role` escrevendo, zero policies).

  - **983_cb_etiqueta_sem_duplicata** — `tags.name_key` (coluna GERADA:
    aparada, sem acento, minúsculas) + índice único `(account_id, name_key)`,
    fechando a corrida que criava etiqueta duplicada. ⚠️ Duplicata que já
    existe é RENOMEADA com sufixo, NUNCA apagada: `tags.id` é referenciado
    por JSON que nenhuma FK protege — `automations.trigger_config.tag_id`,
    `automation_steps.step_config`, config de nó de fluxo e o recorte salvo
    da caixa de entrada (967) —, e apagar deixaria essas regras apontando
    para um id morto, parando de casar EM SILÊNCIO. Aplicada em 2026-09-09
    via conector, ANTES do merge; medido antes: zero duplicatas nesta
    instalação, então o desempate foi no-op aqui.
  - **984_cb_chave_de_tag_normalizada** — recria `tags.name_key` com
    `normalize(..., NFD)` + apagar `[\u0300-\u036f]`, no lugar do
    `translate` de acentos precompostos da 983. Sem isso a forma DECOMPOSTA
    de um nome acentuado gerava outra chave e o índice único deixava a
    duplicata entrar. Aplicada em 2026-09-09 via conector, ANTES do merge;
    conferido: precomposta e decomposta geram a mesma chave, a 2ª inserção é
    barrada pelo índice, e zero colisões novas nesta instalação.

  - **986_cb_anexo_grande** — `chat-media.file_size_limit` de 16 MiB para 50
    MiB, o teto que fazia o CRM descartar documento grande de cliente.
    Aplicada em 2026-09-09 via conector, ANTES do merge; conferido por
    consulta (52428800) e pela recuperação dos 6 anexos ainda vivos na
    Evolution.
  - **987_cb_tldv** — `cb_tldv_config` (chave cifrada, FECHADA para o
    navegador) e `cb_reunioes_transcritas` (reunião + transcrição, do tl;dv
    ou colada à mão; SELECT por membro, escrita só pela rota). Aplicada em
    2026-09-09 via conector, ANTES do merge, com autorização do operador;
    conferido por consulta (as duas tabelas, `anon` sem nada,
    `authenticated` só com SELECT nas reuniões).
  - **988_cb_rodizio_do_cron_do_meta_ads** — `cb_meta_ads_config.
    last_sync_attempt_at`, o carimbo de TENTATIVA por onde o cron ordena as
    contas (rodízio). Aplicada em 2026-09-09 via conector, ANTES do merge,
    com autorização do operador; conferido por consulta (a coluna existe e
    a tabela continua fechada para o navegador). ⚠️ Deploy ANTES dela
    quebraria o ciclo inteiro: o UPDATE do carimbo volta com `error` (o
    Supabase não lança) e a varredura segue, mas o `.order()` do cron
    reprova a consulta com "column does not exist" e a rota devolve 500 sem
    sincronizar conta nenhuma.
  - **989_cb_instagram** — o terceiro transporte: `kind = 'instagram'` (o
    CHECK é recriado pela FORMA, não pelo nome), colunas `ig_*` em
    `cb_channels`, índice único GLOBAL por `ig_user_id`,
    `contacts.instagram_id`/`instagram_username` e **`contacts.phone`
    ANULÁVEL** com CHECK "telefone OU instagram". Aplicada em 2026-09-09 via conector, ANTES do merge do PR
    #167, com autorização do operador (o "faça o merge" veio depois de a
    dependência ser explicada, e o conector foi autorizado para isso);
    conferida por consulta: o CHECK renderizado como `kind = ANY
    (ARRAY[…])`, as 6 colunas, `phone` anulável, os 2 índices, histórico
    `20260909223424`. É **989**, não 987: a 987 (tl;dv) e a 988 (rodízio)
    nasceram em branches paralelas — quarto caso de colisão evitada.
  - **990_cb_instagram_config** — o app da Meta por conta (Instagram App
    ID + Instagram App Secret CIFRADO), a credencial que o login do
    Instagram (OAuth) exige antes de existir canal. FECHADA para o navegador
    (a tela lê pela rota, que devolve só o App ID). Aplicada em 2026-09-09
    via conector (histórico `20260910003817`), ANTES do merge do PR #189 e
    DEPOIS de o replay do CI passar; aditiva — nada em produção a lê até o
    deploy. Conferida por consulta: RLS ligada, `anon` e `authenticated`
    sem SELECT, `service_role` com INSERT.

  - **991_cb_janela_da_meta_na_conversa** — `conversations.janela_meta_desde`
    + `janela_meta_canal_id` (a última mensagem do CLIENTE pela API oficial,
    e por qual número), gatilho em `messages` e acervo — o fato que a
    ampulheta da lista lê. Aditiva: sem ela o app degrada (a ampulheta não
    aparece), nada quebra. Aplicada em 12/09/2026 ANTES do merge do PR #194,
    SEM o conector: pela Management API (`POST /v1/projects/<ref>/database/
    migrations`, o mesmo endpoint do `apply_migration` do conector, que
    registra no histórico), com o access token digitado pelo operador num
    `read` silencioso no terminal dele — a CLI 2.75 não tem comando de SQL e
    guarda o token codificado no Keychain. Conferida pelo preview contra a
    produção (a ampulheta apareceu), não por consulta.

  ⚠️ **Não existe 938/939**, nem local nem no histórico — não "preencher" a
  lacuna: a numeração é cronológica, não densa.
  ⚠️ A `906` foi aplicada FORA DE ORDEM (antes da 907), e o histórico do
  Supabase a registra com o nome antigo `904_cb_grupos` — ela nasceu numerada
  como 904, colidiu com `904_cb_mensagem_do_aparelho` e o ARQUIVO foi
  renumerado para 906; a entrada no histórico não foi mexida de propósito, por
  ser metadado compartilhado com outra sessão ativa no mesmo banco.
  ⚠️ **Nunca deduzir o próximo número desta lista** — ela envelhece a cada
  branch em paralelo. Rodar `ls supabase/migrations/` **e** `list_migrations`
  imediatamente antes de criar o arquivo; os dois, porque já divergiram.
  ⚠️ A `037` é a **única** aplicada *sem* registro no histórico do Supabase: as
  colunas dela existem no banco (`whatsapp_config.provider`, `base_url`,
  `instance_name`, `api_key`, `instance_state`, …), mas `list_migrations` não a
  lista. Ou seja, **o histórico não é fonte de verdade completa** — para checar
  se algo foi aplicado, consultar o schema, não só o histórico.
- Criar o arquivo de migration **antes** de aplicar.
- ⚠️ **O projeto Supabase é `hxnhakmyxyhalbsktzwe`** (nome "CB CRM Whatsapp"),
  e é o `project_id` de toda chamada do conector. O ref sai do
  `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`
  (`https://<ref>.supabase.co`) — tirar de qualquer outro lugar já custou uma
  sessão inteira de "permission denied" que **não era** falta de permissão, era
  ref errado.
- Aplicar em **ordem numérica** no projeto Supabase. Caminho preferido: o
  **conector MCP do Supabase** (`apply_migration` / `execute_sql`), que dispensa
  senha de banco. Alternativa: colar os SQL no **SQL Editor** em ordem. ⚠️ **Não**
  usar `supabase db push`: o histórico do projeto hoje tem as 001–036 do upstream
  mais `900`/`901`/`902` (conferido em 2026-07-24 via `list_migrations`), mas
  registradas com **version em timestamp** (`20260721164546` = `001_initial_schema`),
  que não corresponde ao prefixo `NNN_` dos nossos arquivos — o push não casaria
  local↔remoto e tentaria re-aplicar tudo. **Nunca** editar schema à mão pelo
  editor de tabelas da UI (causa drift).
- **Nunca renomear nem renumerar** migration já aplicada.
- Antes de criar nova, **validar drift** entre local e o projeto Supabase.

### ⚠️ Migration tem de aplicar num banco VAZIO, não só no nosso

Desde o merge do upstream de 2026-08-26 existe um CI (`pipeline.yml`, etapa
`Apply to a clean database`) que sobe um Postgres limpo e reaplica **todas** as
migrations em ordem, do zero. Antes dele, nenhum `.sql` deste repositório tinha
sido executado por CI nenhuma vez — as migrations foram escritas contra um banco
que já existia, e **nove delas reprovaram** na primeira execução real.

Foram só DUAS causas. Escrever migration nova sem cair nelas é a regra abaixo.

**1. Privilégio herdado do Supabase não existe em banco novo.**

Tabela criada por `postgres` no `public` recebe tudo para
`anon`/`authenticated`/`service_role` por um *default privilege* que o Supabase
configura (`pg_default_acl`). Isso é do AMBIENTE, não do nosso SQL. Num banco
criado do zero ele não se repete. Duas consequências, ambas já morderam:

- Uma conferência do tipo `IF NOT has_table_privilege('authenticated', …)`
  reprova, porque o privilégio nunca foi concedido por escrito.
- `REVOKE … FROM PUBLIC` numa FUNÇÃO tira o `EXECUTE` de quem dependia de
  PUBLIC — **inclusive do `service_role`**, já que em Postgres o EXECUTE de
  função nasce concedido a PUBLIC. Em produção não aparece; em banco novo, sim.

  ✅ **Regra:** todo privilégio que a migration CONFERE, ela tem de CONCEDER.
  Depois de qualquer `REVOKE`, escreva o `GRANT` de volta para quem precisa —
  em produção é no-op, e `GRANT` é idempotente. Não confie no ambiente nem para
  abrir nem para fechar.

  Exemplo (939 em diante, siga este formato):
  ```sql
  REVOKE EXECUTE ON FUNCTION cb_minha_rpc(uuid) FROM PUBLIC, anon, authenticated;
  -- O motor/cron chama com service_role, que perdeu o EXECUTE junto com PUBLIC.
  GRANT  EXECUTE ON FUNCTION cb_minha_rpc(uuid) TO service_role;
  ```

  ⚠️ Vale também para RLS: política avaliada com o privilégio de QUEM CHAMOU.
  A de `messages` consulta `conversations`, então `authenticated` precisa de
  `SELECT` nas duas. A cadeia para em `is_account_member`, que é
  `SECURITY DEFINER`.

**2. Conferência não pode exigir dado que só existe aqui.**

Várias conferências provavam mecânica usando dado de produção — uma busca pelo
literal `'docker'`, `count(*) >= 2` numa tabela, "a busca tem de achar a
mensagem de onde o termo saiu". Em banco vazio não há o que achar, e elas
reprovavam por falta de dado, não por defeito.

  ✅ **Regra:** conferência que precisa de dado deve DERIVAR o dado do banco e
  **pular quando não houver**, com `RAISE NOTICE`. Afirmar ausência
  (`IF EXISTS … THEN RAISE`) é sempre seguro — é verdade trivial num banco
  vazio. Afirmar presença é que quebra.

  ```sql
  SELECT substr(content_text, 1, 6) INTO v_termo FROM messages LIMIT 1;
  IF v_termo IS NULL THEN
    RAISE NOTICE 'NNN: banco vazio, nada a provar.';
  ELSE
    -- a prova de verdade
  END IF;
  ```

  Para "o DROP não levou nada junto", guarde a contagem ANTES numa **variável**
  do bloco e compare — nunca um número absoluto, e nunca `CREATE TEMP TABLE`
  (sem guarda ele estoura na segunda passada e quebra a idempotência).

**Como conferir antes de abrir o PR:** `supabase db start` na raiz do projeto
reaplica tudo do zero, igual ao CI. Exige Docker rodando e ~2 GB livres.

**O replay TRAVA o deploy desde 2026-09-08** — `needs: [verificar, migrations]`
no `pipeline.yml`, com pino em `pipeline.test.ts`. Foi sinal, não portão,
enquanto as migrations antigas ainda carregavam a dívida das duas causas acima;
paga a dívida, manter o portão aberto só preservava o buraco. Quem descobriria
uma migration que não replaya seria a PRÓXIMA instalação — a que constrói o
banco do zero e não tem produção antiga para disfarçar o defeito.

## i18n (armadilhas que já morderam)

O locale é **global e fixo**, vindo de `NEXT_PUBLIC_APP_LOCALE` no `.env.local`
(hoje `pt-BR`). `src/i18n/request.ts` importa `messages/<locale>.json`.

- ⚠️ **O fallback é por ARQUIVO, não por chave.** Se `pt-BR.json` existe mas
  falta uma chave, o app **não** cai para o inglês — ele dispara
  `MISSING_MESSAGE` e mostra a chave crua na tela. Portanto: **ao adicionar
  qualquer chave em `en.json`, adicione no `pt-BR.json` na mesma passada.**
- ✅ **Desde 31/08/2026 os dois scripts de i18n são PORTÃO no CI** (job
  `verificar`, antes de `test`/`build`). Antes deles, a chave usada-e-ausente
  não tinha guarda nenhuma (o `src/i18n/messages.test.ts` já gateava a
  PARIDADE no mesmo job — e mais rígido que o parity: reprova chave órfã —
  mas é cego para chave que falta nos DOIS dicionários): o console de
  produção despejava `Inbox.sidebar.tabTracking`, `noTrackingFields` e
  `seedTrackingFields` às dezenas. São dois porque respondem perguntas
  diferentes:
  - `i18n-parity.mjs` — a chave existe num dicionário e falta no outro?
    ⚠️ Chave SÓ no `pt-BR.json` é "inofensiva" para ele, mas o
    `messages.test.ts` REPROVA — a mensagem do script avisa isso desde a F6.
  - `i18n-chaves-usadas.mjs` — o código pede chave que não existe em
    dicionário NENHUM? ⚠️ **Este é o que faltava.** Durante aquele defeito a
    paridade estava VERDE (2673/2673): as três chaves faltavam nos dois
    arquivos, então os dicionários "concordavam" — em não ter.
  ⚠️ O segundo é análise estática de TEXTO e declara o próprio alcance a
  cada execução (literais conferidas, dinâmicas ignoradas, arquivos em modo
  folha) — e **tem testes próprios** (`scripts/i18n-chaves-usadas.test.ts`,
  fixtures via `I18N_CHECK_ROOT`; o vitest inclui `scripts/**`). Decisões
  que parecem detalhe e não são (recalibradas na F6 do plano 31/08, que
  mediu quatro modos de o portão mentir):
  - **Cobra contra TODOS os namespaces do arquivo, não contra o binding** —
    o tradutor viaja como prop (`<SeletorDeHorario t={tAgendadas}>`) e o
    parâmetro SOMBREIA o do módulo. Amarrado ao binding, acusava 7 chaves
    boas de faltantes no compositor. ⚠️ E "todos" inclui REDECLARADOS: dois
    `const t` com namespaces próprios acumulam (nome → Set), senão o último
    apagava o primeiro e chave válida reprovava (#19).
  - **`.raw` e `.markup` contam junto com `.rich`** — os três disparam
    MISSING_MESSAGE igual, e `t.raw` sozinho aparece 15 vezes no repo.
  - **Modo folha** para arquivo que RECEBE o tradutor e não declara binding
    (`flows/shared.tsx`, `message-media.tsx`): sem namespace, a chave é
    cobrada como SUFIXO de alguma chave do dicionário (último segmento
    reprovava `t('table.name')` válida, #20). Garantia mais fraca — e por
    isso o total sai impresso —, mas pular o arquivo inteiro era buraco:
    chave apagada dos dois dicionários mantinha o CI verde. ⚠️ Só o
    identificador `t` EXATO entra no modo folha: a forma antiga casava
    `twMerge(`/`toast(` e um literal neles reprovava o CI (#18).
  - **Verde exige COBERTURA, não só zero faltantes** (#24): piso de
    literais conferidas (`PISO_CONFERIDAS`; se reprovar, o defeito é o
    ALCANCE do script) e arquivo que importa o tradutor sem produzir
    binding nem uso reconhecível reprova nomeado — um alias
    (`useTranslations as useT`) tirava o arquivo da cobertura em silêncio.
    ⚠️ A guarda vale para TODO arquivo e conta CHAMADAS da fábrica, não a
    ausência de binding: para cada `useTranslations`/`getTranslations`
    importado em valor (alias incluso), toda chamada tem de ser `const t =
    …(…)` ou a invocação direta `…('NS')('chave')`; alias, envelope local
    (`function useTraducao(ns) { return useTranslations(ns) }`) ou chamada
    passada adiante reprovam com o nome e a contagem. Duas versões deixaram
    passar caso — a que só rodava sem `t(` folha (Codex, PR #91) e a que só
    rodava sem binding NENHUM, onde um `const t = useTranslations(...)`
    legítimo escondia o alias ao lado (Codex, PR #104). `import type {
    useTranslations }` (só para `ReturnType<typeof …>`, message-media.tsx)
    fica de fora — não há fábrica a cobrir — e é por isso que aquele import
    É `import type`: voltar a importar em valor reprova o portão. A guarda
    olha o fonte SEM comentários: um comentário que descreva a forma
    proibida logo acima do import real casava o regex (medido).
- ⚠️ **`t('chave')` sem `values` NÃO parseia ICU** — devolve a string crua.
  Erro `INVALID_TAG`/`MALFORMED_ARGUMENT` no console **não significa** tela
  quebrada: pode ser só ruído de log, com a renderização correta. Já
  removemos um `<strong>` que funcionava por confiar no log (commit `4e8f2c6`,
  revertido em `22b6d4f`). **Antes de "consertar" uma mensagem, compare o que
  `t()` devolve antes e depois.**
- Só **`t.rich(...)`** falha de forma visível (mostra o caminho da chave). Tags
  de rich text no dicionário **não podem ter atributos** (`<code>` sim,
  `<code className="...">` não) — o atributo vem do handler no componente.
- Rótulos que o operador vê **em inglês no painel da Meta** (`Phone Number ID`,
  `Access Token`, `Verify Token`, `Webhook Callback URL`) **não se traduzem** —
  traduzir torna as instruções de configuração inúteis.
- Chaves ICU literais (`{{1}}`, `{{name}}`, JSON de exemplo) precisam de aspas
  simples (`'{{1}}'`) para silenciar o log — mas isso é cosmético, a saída é a
  mesma.
- Datas/moeda: usar `toLocaleDateString(undefined, ...)`, **nunca** locale fixo
  (`'en-US'`), senão a data sai em inglês com o app em português.
- ⚠️ **O date-fns fala INGLÊS por padrão, e a regra acima não o alcança.** Toda
  chamada dele que escreve PALAVRAS passa `locale: LOCALE_DAS_DATAS`
  (`src/lib/idioma-das-datas.ts`, que lê o mesmo `NEXT_PUBLIC_APP_LOCALE` do
  `request.ts`): as distâncias (`formatDistance*`, `formatRelative`) e o
  `format` com mês ou dia da semana por extenso, AM/PM ou data localizada
  (`MMM`, `EEE`, `a`, `P`, `p`). Sem ele, até 10/09/2026, a lista da caixa de
  entrada mostrava "3 minutes" e o separador de dia da conversa, "September 8,
  2026". Há pino (`idioma-das-datas.chamadores.test.ts`) com duas exceções
  escritas — o eixo do gráfico de uso da IA e o `media-lightbox.tsx`, não
  ligado —, e ele cobra que cada exceção continue necessária: quem consertar
  uma a tira da lista. ⚠️ Só pôr o locale num padrão FIXO não basta:
  `"MMMM d, yyyy"` com `ptBR` dá "setembro 8, 2026", na ordem do inglês — use
  o padrão localizado (`PPP`).
- ⚠️ Coluna Postgres `DATE` (ex.: `expected_close_date`) chega como
  `"2026-05-18"`, e `new Date()` interpreta isso como **meia-noite UTC** — no
  Brasil retrocede um dia. Concatenar `T00:00:00` antes de parsear.
- **Achar texto da UI no código:** `node scripts/i18n-find.mjs "<texto>"` — faz
  os dois saltos (texto → chave → componente), já que buscar o texto em
  português só encontra o dicionário.
- Há ~11 componentes com texto **fixo em inglês**, sem i18n (o upstream os
  adicionou assim). Eles não passam pelo dicionário.

## Deploy

- ⚠️⚠️ **`git push origin main` DISPARA DEPLOY DE PRODUÇÃO.** O workflow
  `.github/workflows/pipeline.yml` roda a cada push no `main`: verifica
  (lint/typecheck/test/build), replaya as migrations num banco limpo e, com
  as **DUAS** etapas verdes (`needs: [verificar, migrations]` desde
  2026-09-08), builda a imagem, publica no GHCR
  (`ghcr.io/leonardocabralb/cb-crm`) e faz rollout no serviço do **Docker Swarm
  da VPS** (`82.25.76.63` / `vps.cbadvogados.com`), atrás do **Traefik** (TLS
  Let's Encrypt). O rollout é `docker service update --image <repo>:<sha>` —
  guardar isso, é a raiz da armadilha do `CRM_IMAGE` mais abaixo. **Nunca dar
  push no `main` sem o operador saber que aquilo vai para produção.**
  ⚠️ Mesclar vários PRs seguidos NÃO gera um deploy por PR. O
  `cancel-in-progress` é `false` no `main` (run EM ANDAMENTO não é
  interrompido), mas o GitHub guarda só **um** run pendente por grupo de
  concorrência: o do meio é cancelado ainda na FILA. Observado em 2026-08-29
  ao mesclar #43, #45 e #46 em sequência — o run do #45 morreu na fila. O
  resultado fica correto (o último run constrói a partir do `main` já com
  todos), mas os merges do meio não têm run próprio, e o histórico de
  Actions passa a mentir sobre o que foi publicado quando.
- Domínio: `crm.cbadvogados.com`. ✅ O cutover de DNS **já foi feito** (conferido
  em 2026-07-25): `crm.cbadvogados.com` → `vps.cbadvogados.com` → `82.25.76.63`,
  respondendo 200 com TLS do Traefik. Ou seja, o domínio público serve a VPS —
  **o push no `main` atinge usuário real**, não mais um serviço isolado.
- ⚠️ **`NEXT_PUBLIC_APP_LOCALE` é build-arg, não env de runtime.** Como todo
  `NEXT_PUBLIC_*` é inlinado no bundle **em tempo de build**, editar o `crm.env`
  da VPS **não** muda o idioma — é preciso alterar `pipeline.yml`/`docker-stack.yml`
  e **rebuildar a imagem**. Isso já mordeu: até 2026-07-25 os dois arquivos
  fixavam `en` e a produção inteira servia inglês, enquanto o dev local (que lê
  `.env.local`, com `pt-BR`) parecia certo. Ao investigar "produção está
  diferente do meu local", checar build-arg antes de env de runtime.
- Segredos de runtime vivem em `crm.env` **na VPS** (fora do git), espelhando o
  `.env.local`. A Evolution API roda como serviço `evolution_evolution` no mesmo
  Swarm (imagem própria 2.4 por digest — ver o bloco da Baileys 7 acima e
  `docs/INFRA-VPS.md`; os segredos DELA ficam em `/root/evolution.env`).
- ⚠️⚠️ **`docker stack deploy` SEM carregar o `crm.env` ZERA TODOS os segredos
  de produção — e o site continua respondendo 200.** O `docker-stack.yml` usa
  `${VAR}`, que o Docker substitui pelo **ambiente do shell**: variável ausente
  vira **string vazia**, sem erro nem aviso. O front sobrevive porque todo
  `NEXT_PUBLIC_*` foi inlinado no build, então a tela de login pinta normal
  enquanto o servidor inteiro está sem credencial — webhook não grava mensagem,
  envio não sai, IA não roda, e **as quatro rotas de cron passam a devolver 503**
  (`if (!expected) return 503`), o que derruba agendadas, automações, fluxos e
  Radar de uma vez. Aconteceu em 2026-08-27 e passou despercebido por horas
  porque as verificações usuais (site 200, digest da imagem intocado) **não
  cobrem env vars**. A forma correta, sempre as três linhas juntas:
  ```bash
  set -a; . /root/crm.env; set +a          # sem isto, tudo vira ""
  export CRM_IMAGE="$(docker service inspect crm_crm \
    --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)"  # senão volta para :latest
  docker stack deploy -c /root/docker-stack.yml crm
  ```
  ⚠️ **A imagem sai de `.Spec.TaskTemplate.ContainerSpec.Image`, NUNCA do
  rótulo `com.docker.stack.image`.** Esse rótulo só é reescrito por
  `docker stack deploy`; o CI publica com `docker service update --image`
  (`pipeline.yml`), que não o toca — então ele guarda a imagem do último
  deploy MANUAL e envelhece a cada merge. Medido em 2026-08-29, minutos
  depois de um deploy pelo CI: o rótulo dizia `30bf0b6` (PR #37, dois dias e
  **dez merges** atrás) enquanto o serviço rodava `823061a`. Pinar pelo
  rótulo aqui **rola a produção para trás em silêncio** — e esta é
  justamente a receita que se roda quando algo já está quebrado. O
  `docs/DEPLOY-VPS.md` já usava o campo certo; era esta seção que estava
  fora de passo.
  **Conferir DEPOIS, dentro do container** (o spec do serviço engana — mostra o
  nome da variável mesmo com valor vazio):
  ```bash
  cid=$(docker ps --filter name=crm_crm --format '{{.ID}}' | head -1)
  docker exec $cid printenv SUPABASE_SERVICE_ROLE_KEY | wc -c   # 0 = quebrado
  curl -s -o /dev/null -w '%{http_code}\n' https://crm.cbadvogados.com/api/cb/scheduled/cron
  # 401 = segredo no lugar · 503 = env vazia, produção cega
  ```
- Arquivos: `Dockerfile`, `docker-stack.yml`, `.github/workflows/pipeline.yml`,
  `docs/DEPLOY-VPS.md`. (Trazidos pela integração da Evolution — ver abaixo.)
- Restrição fixa: o webhook do WhatsApp **exige HTTPS** — o endpoint precisa de
  URL pública com SSL (o Traefik resolve isso na VPS).

## Integrações externas

**Sempre que mexer em integração externa, atualizar a doc visível ao usuário na
mesma passada** (help/config no app, `docs/`, ou README do módulo). Doc obsoleta
= bug latente.

- **Meta Cloud API (WhatsApp Business):** webhook em `src/app/api` valida
  assinatura HMAC-SHA256 com `META_APP_SECRET` (sem ele, rejeita todo request).
  Tokens do WhatsApp são gravados criptografados (AES-256-GCM) com
  `ENCRYPTION_KEY` — **rotacionar essa chave invalida todos os tokens salvos**.
- **Supabase:** Postgres + Auth + Storage + RLS. `SUPABASE_SERVICE_ROLE_KEY`
  ignora RLS e só pode ser usada em código server-side (webhook, automações,
  auth da API pública). Nunca no client.
  ⚠️ **`cb_channels` está na publicação realtime com LISTA FIXA de colunas**
  (a 909 fez `ADD TABLE cb_channels (…)`; medido em `pg_publication_rel.prattrs`
  em 2026-08-30): coluna adicionada depois disso NÃO viaja no realtime. Hoje
  nada assina essa tabela (`use-channels` é fetch único) — quem for assinar
  `cb_channels` no futuro precisa reescrever a entrada na publicação. As
  demais tabelas publicadas (ex.: `cb_conversation_notes`) estão sem lista
  (todas as colunas).
- **Assistente de IA:** bring-your-own-key (OpenAI/Anthropic/Gemini, desde a
  941) — cada conta cola sua chave em Settings → AI Assistant, guardada
  criptografada com `ENCRYPTION_KEY`. Não há env var global de provider.
  Embeddings (RAG) continuam exigindo chave OpenAI (modelo fixo, vector 1536).

## Antes de aplicar mudanças

- [ ] Está no Node do `.nvmrc` (`nvm use` na raiz)? Rodar teste numa major
      diferente da do CI é como o PR #66 passou aqui e reprovou lá.
- [ ] Estamos numa branch derivada de `main`? Não commitar direto no `main`.
- [ ] Branch criada a partir de `main` atualizado (`git pull origin main`)?
- [ ] Se mexer em schema: migration na faixa `900+`/`cb_` e check de drift.
- [ ] A migration aplica num banco **VAZIO**? Todo `REVOKE` tem `GRANT` de volta
      para quem precisa, e nenhuma conferência exige dado que só existe aqui?
      (Ver "Migration tem de aplicar num banco VAZIO".) Conferir com
      `supabase db start`, que é o que o CI faz.
- [ ] Não commitar `.env.local` (confirmar com `git status`).
- [ ] Rodar `npm run typecheck` e `npm run lint` antes de finalizar.

## Não faça

- ❌ **Abrir PR para qualquer branch de `ArnasDon/wacrm` (upstream).** PR só para
  branch do CB-CRM. (Regra de ouro 1.)
- ❌ **Criar branch de desenvolvimento a partir de algo que não seja `main`.**
  (Regra de ouro 2.)
- ❌ Cravar a major do Node no `pipeline.yml` (`node-version:`) em vez de
  deixá-la sair do `.nvmrc` — é assim que CI e máquina voltam a divergir.
- ❌ Commitar direto no `main` sem passar por branch de feature.
- ❌ `git push` no `upstream` (é read-only).
- ❌ Numerar migration nossa na sequência do upstream (`037`, `038`…) em vez da
  faixa reservada `900+`.
- ❌ Renomear/renumerar migration já aplicada.
- ❌ Conferir privilégio numa migration sem tê-lo CONCEDIDO ali. O que vem do
  *default privilege* do Supabase não existe em banco novo — nove migrations
  nossas reprovaram por isso na primeira vez que o CI as reaplicou do zero.
- ❌ Conferência de migration que exige DADO presente (busca por literal,
  `count(*) >= N`). Em banco vazio ela reprova por falta de dado, não por
  defeito. Derive o dado e pule com `RAISE NOTICE` quando não houver.
- ❌ Aplicar mudança de schema pela UI de tabelas em vez do comando canônico.
- ❌ Usar `SUPABASE_SERVICE_ROLE_KEY` em código client-side.
- ❌ Rotacionar `ENCRYPTION_KEY` sem avisar (invalida tokens do WhatsApp).
- ❌ Usar `--no-verify` em commits sem permissão explícita.
- ❌ Reescrever arquivo do core quando dá para isolar em módulo novo.

## Comandos úteis

```bash
nvm use              # entra no Node do .nvmrc (22) — ANTES de tudo
npm run dev          # servidor de desenvolvimento (localhost:3000)
npm run build        # build de produção
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run format       # prettier --write
```

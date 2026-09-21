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
`scripts/`, as migrations `0037_evolution_transport.sql`, `900_cb_*` e
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
| `src/app/api/whatsapp/webhook/route.ts` (3ª linha nossa) | o `.is('nome_fixado_em', null)` no UPDATE que troca o nome do contato pelo do perfil (999). O bloco é do upstream e volta cru num merge — sem a guarda, o nome fixado pelo agendamento do Calendly vira o do WhatsApp na mensagem seguinte. Pino: `src/lib/contacts/nome-fixado.chamadores.test.ts` |
| `src/components/inbox/message-bubble.tsx` (além de ser nosso inteiro) | o case `document` usa `mediaFilename(message)` e mostra a legenda embaixo só quando ela DIFERE do nome; `nomeDeArquivo` delega para a cascata em vez de derivar o basename cru |
| `src/components/inbox/message-bubble.tsx` (canal, 2026-09-02) | a prop `canal` (nome + cor) no lugar do antigo `channelLabel`: o rótulo embaixo da mensagem ganhou a bolinha da cor, 10px (era 9) e teto de 9rem (era 7). ⚠️ Uma versão desta nota dizia que em 7rem os nomes truncavam "no ponto em que ainda são iguais" — MEDIDO em 02/09: os seis nomes da conta cabem em 7rem até a 10px (o mais longo, "Trabalhista - Comercial", dá 110px); o 9rem é folga, não conserto. A cor vive na BOLINHA, não no texto: a bolha da equipe é `bg-primary`, violeta nesta conta. Uma trilha de 3px na borda foi feita e DESCARTADA pelo operador na hora ("não gostei dessa borda colorida") |
| `src/components/inbox/message-thread.tsx` | além do fio intercalado, renderiza a faixa `ScheduledBar` logo acima do compositor e guarda o contador que a liga ao compositor |
| `src/components/inbox/message-thread.tsx` (rolagem, 2026-09-01) | ⚠️ `coladoNoFimRef` + `onScroll` guardam o auto-scroll, e o spinner só entra quando a CONVERSA muda (`conversaCarregadaRef`). Sem os dois, voltar de uma aba nova — o `visibilitychange` incrementa o `resyncToken` — perdia a posição de quem lia o histórico E o empurrava para o fim, três vezes por retorno (mensagens, eventos e notas chegam em buscas próprias). O `saltoAtivoRef` NÃO cobre isso: é armado só pelo salto da busca, e `liberarSalto` está no `onWheel`, então rolar à mão o DESLIGA. A guarda é re-armada em `publicarMensagemOtimista` e ao acrescentar nota — senão o autor manda e não vê |
| `src/app/api/whatsapp/webhook/route.ts` | carimba `channel_id` na entrada — **no próprio upsert** desde 10/09/2026 (o UPDATE separado `stampMessageChannel` engolia falha e deixava mensagem de cliente sem número, e a janela de 24h por número a leria como vinda de outro número; o mesmo no `persistInboundMessage` da Evolution). Os dois gravam por `gravarComCanal` (`stamp.ts`), que repete SEM canal quando a conexão foi apagada no meio (23503 da FK `messages_channel_id_fkey`) — senão a mensagem do cliente se perderia, porque o provedor já recebeu 200; há pino estrutural em `stamp.chamadores.test.ts`; varre `cb_channels` na verificação (GET); escopa o ACK por canal; passa `channelId` a flows/automações/IA |
| `src/lib/whatsapp/inbound-store.ts` | idem, no lado Evolution |
| `src/lib/automations/engine.ts` | o `tituloFixadoEm` do `create_deal` (1007: título literal do autor nasce fixado, `{{…}}` fica solto). Mais `channelInScope`, condição `channel`, canal de saída por passo, e o `create_deal` que virou chamada a `createDeal` com a checagem "um card por contato" ANTES do insert — o índice da 911 é parcial (`source = 'channel'`) e não barra o insert da automação, então sem a checagem nasce card duplicado. Mais o `rotuloDoDisparo` opcional de `runAutomationById` (955): a execução manual da conversa grava `'manual'` no log — sem ele, o registro diria que outra automação chamou. Mais o ramo de NOME do `update_contact_field` (999): grava FIXADO e não sobrescreve com valor que não é nome. Mais o gancho `antesDeExecutar` de `dispararAutomacoes` (chamado uma vez, antes da primeira automação que passou nos recortes) |
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
| `src/app/(dashboard)/inbox/page.tsx` | espelha o termo da busca da lista para o fio — são irmãos, e a página é o único caminho entre eles. Mais o escritor da presença por conversa (963): `useMarcarConversaAberta(activeConversation?.id)` — a página é a dona da seleção. Mais (14/09/2026) a navegação por HISTÓRICO no celular: abrir conversa pela lista ou pelo "nova conversa" é `push` (`navegacaoAoAbrir`), o botão voltar desfaz o passo (`router.back()`), e um ouvinte de `popstate` fecha ou reabre — um merge que traga o `replace` cru do upstream faz o gesto de voltar do iPhone SAIR da caixa de entrada de novo. Ver a seção "Voltar da conversa pelo HISTÓRICO" |
| `src/components/inbox/message-thread.tsx` (955/963) | monta o `<ExecutarAutomacaoDialog>` (é o fio que tem o contato; o canal passado é `conversation.channel_id ?? null` — o PR #74 trocou o `activeChannel` resolvido pelo cru DE PROPÓSITO, para a checagem de escopo da rota falhar aberta igual ao motor em conversa sem canal; grupo fica de fora) e os avatares `<AvataresNaConversa>` no cabeçalho, alimentados por `useQuemVeAConversa` |
| `src/components/inbox/message-thread.tsx` (#84) | a **janela de 24h**: a regra saiu para `src/lib/inbox/janela-24h.ts` (puro, com teste) e os TRÊS caminhos de envio (texto, mídia, interativa) passam por `janelaFechadaAgora()` antes do `fetch` — o portão lê o RELÓGIO no disparo, nunca `sessionInfo.expired` (um `useMemo`: recomputa no tique de 1 min da badge, nunca no instante exato do disparo). Um merge que traga o `sessionInfo` inline do upstream devolve os três buracos de uma vez. Desde 10/09/2026 a janela é **POR NÚMERO**: os dois relógios passam `canalDaJanela` (= `activeChannel`, id + transporte, o mesmo do `expected_channel_id`) — parâmetro OBRIGATÓRIO em `janelaFechada`/`minutosRestantes`, com pino estrutural cobrando o MESMO canal nos dois —, grupo fica fora (`!ehGrupo` em `janelaDe24h`), e a etiqueta fala minutos na última hora (`restanteParaExibir`; antes o ramo de minutos era código morto e a última hora aparecia inteira como "1h restantes") |
| `src/lib/dashboard/queries.ts`, `src/components/dashboard/metric-card.tsx` | filtro por canal (parcial) e marca "conta inteira" |
| `src/app/api/automations/[id]/duplicate/route.ts` | copia `channel_ids` (sem isso a cópia vira irrestrita) |
| `src/app/api/cb/channels/[id]/route.ts` (DELETE) | barra a exclusão quando há agendada na FILA e limpa o acervo — a FK da 925 é RESTRICT |
| `src/components/pipelines/pipeline-board.tsx`, `src/app/(dashboard)/pipelines/page.tsx` | o painel por etapa (Fase 5): o raio com contador no cabeçalho da coluna e a carga das automações de funil. Mais o funil-com-conversas (PR #71): botão de conversas por coluna, `navegarParaInbox`/restauração de rolagem no board (quadroRef vem da página), `useChannels` içado, select `DEAL_SELECT_DO_QUADRO` com plano B, popover de campos |
| `src/components/pipelines/deal-card.tsx` | ⚠️ **reestruturado inteiro no PR #71 — manter a NOSSA versão** (como `conversation-list.tsx`): wrapper + botão do corpo (abre a CONVERSA) + lápis IRMÃO (edita; button aninhado é inválido), campos por `CamposDoCard`, etiquetas/última mensagem/não lidas, `memo` + canais por prop, barra de cor com `pointer-events-none` |
| `src/components/pipelines/deal-form.tsx` | o título digitado FIXA o card (1007, `escritaDoTituloManual` nos dois ramos; o `payload` comum NÃO carrega `title`). Mais o que a linha antiga já dizia: o link "ver conversa" prefere a conversa do CONTATO (fallback no vínculo da 910), usa `urlDoInbox` e as props `origemFunil`/`aoIrParaConversa` da jornada do funil |
| `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/conversation-list.tsx`, `inbox-filters.tsx` | os params `?etapa=` (semeia o filtro de etapa UMA vez) e `?de=funil` (faixa "Voltar ao funil") — os `router.replace` usam `urlDoInbox`, que preserva `de` e derruba `etapa` DE PROPÓSITO; na lista, `etapaInicial` + `etapasResolvidas` e o recorte de etapa gateado por `etapasUsaveis`; nos filtros, o fallback da pastilha virou `labelStage` (era "Qualquer etapa" sobre filtro ativo) |
| `src/app/(dashboard)/automations/new/page.tsx` | o `?stage=` que faz a automação nascer com o gatilho de funil já apontando para a etapa clicada |
| `src/lib/automations/engine.ts` (espera, 18/09/2026) | o "Aguardar" estaciona com `contextoDaEspera(...)` e CONFERE o erro do INSERT (fila que recusa vira falha visível); `resumePendingExecution` limpa a marca com `semMarcaDeResposta`. Um merge que traga o bloco do `wait` cru devolve o insert não conferido e a marca para de ser gravada — a caixa do construtor vira enfeite, sem erro nenhum. Ver a seção "Aguardar — parar se o cliente responder" |
| `src/app/api/whatsapp/webhook/route.ts` (4ª linha nossa) e `src/lib/whatsapp/inbound-store.ts` | a chamada a `cancelarEsperasPorResposta`, ANTES de `dispatchInboundToFlows` — nos DOIS transportes (há pino estrutural com a ordem) |
| `src/components/automations/automation-builder.tsx` (18/09/2026) | a caixa "Parar a automação se o cliente responder" no passo Aguardar e o sufixo no resumo do cartão fechado |
| `src/app/(dashboard)/automations/[id]/logs/page.tsx` | `skipped` com traço NEUTRO em vez do ✗ vermelho (`StepRow`) |
| `src/app/(dashboard)/inbox/page.tsx` (18/09/2026) | no INSERT de mensagem do CLIENTE na conversa aberta, `setTimeout(avisarExecucoesMudaram, 3000)` — a aba Automações descobre o cancelamento por resposta sem recarregar a página |
| `src/lib/automations/engine.ts` (etapa, 18/09/2026) | `resumePendingExecution` confere `cardSaiuDaEtapa` depois do freio de `is_active` E da marca de interrupção (`execucaoJaInterrompida`, 1005): fora da etapa (ou estadia encerrada) → `cancelled` + varredura das irmãs + anotação; leitura falhou → falha VISÍVEL. Um merge que traga o resume cru devolve a sequência de No Show cobrando quem reagendou, sem erro nenhum |
| `src/lib/automations/drain-events.ts`, `src/app/(dashboard)/automations/new/page.tsx`, `src/lib/automations/validate.ts` | a chamada a `cancelarEsperasAoSairDaEtapa` no laço do dreno (arquivo NOSSO, mas o ponto de chamada tem pino); o `parar_ao_sair: true` semeado no `?stage=`; e a validação booleana das duas opções novas |
| `src/components/automations/automation-builder.tsx`, `src/app/(dashboard)/automations/[id]/edit/page.tsx` e `src/app/(dashboard)/pipelines/page.tsx` (voltar ao funil, 18/09/2026) | o voltar do construtor passa por `voltaDoConstrutor(origem)` e o `router.replace` depois de CRIAR por `urlDoConstrutor({ id, origem })` (`src/lib/pipelines/url.ts`): aberto pela grade de automações do funil (`?de=funil&funil=<id>`), o voltar devolve à aba Automações DAQUELE funil, e não à tela de Automações do menu. Um merge que traga o `router.push("/automations")` cru do upstream devolve o bug sem conflito nenhum — há pino em `url.test.ts`. Na página do funil, `?vista=` e `?funil=` são porta de ENTRADA, lidas uma vez na montagem (trocar de aba ou de funil depois não reescreve a URL) |
| `src/lib/automations/trigger-meta.ts` | `formatRelative` passou a usar `Intl.RelativeTimeFormat` e a receber o texto de "nunca" — devolvia `5m ago`/`never` em inglês nas três telas |
| `src/components/contacts/contact-detail-view.tsx` (987) e `src/components/inbox/painel/painel-do-contato.tsx` | a seção `<ReunioesTranscritasDoContato>` dentro da aba Reuniões, abaixo de `<ReunioesDoContato>` — na ficha E na 7ª aba só-ícone (`reunioes`) do painel da conversa, montada em 09/09/2026 a pedido do operador para a transcrição estar à mão durante o atendimento. Um merge que traga a aba crua do upstream apaga o histórico de transcrições da ficha |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx`, `src/app/(dashboard)/notifications/page.tsx`, `src/components/layout/{sidebar,header}.tsx`, `src/app/(dashboard)/contacts/page.tsx`, `src/lib/rate-limit.ts` | as tarefas (944): 7ª aba na ficha (com `[&>button]:flex-none` na TabsList), seção na barra da conversa, ícones/navegação dos tipos `task_*` no sino (o `TYPE_ICON` é exaustivo — merge que trouxer tipo novo sem ícone quebra o typecheck), item "Tarefas" com etiqueta realtime no menu, deep link `?contact=`, bucket `tarefa` |
| `src/app/(dashboard)/pipelines/page.tsx` e `src/app/(dashboard)/contacts/page.tsx` (voltar ao app, 14/09/2026) | a chamada a `useAoVoltarParaOApp` com recarregar SILENCIOSO: no Funil, `refreshStages`/`refreshDeals` (nunca a carga inicial, que liga o `loading` e desmonta o quadro); em Contatos, a opção `silencioso` do `fetchContacts`, que não liga o `loading`. Ver a seção "Telas que se atualizam ao VOLTAR para o app" |
| `src/lib/ai/types.ts`, `generate.ts`, `defaults.ts`, `config.ts`, `usage.ts`, `providers/` | o TERCEIRO provedor (`gemini`, 941) e o modo `'radar'` no log de uso — o upstream conhece só openai/anthropic. `structured.ts` e `providers/gemini.ts` são arquivos NOSSOS |
| `src/components/settings/ai-config.tsx`, `src/app/api/ai/config/route.ts` | a opção Gemini no seletor e na validação do provider |
| `src/components/settings/cb-channels-panel.tsx`, `src/app/api/cb/channels/[id]/route.ts`, `src/lib/cb-channels/repo.ts` | o toggle `radar_enabled` por canal (dialog, PATCH allowlist e SAFE_COLUMNS) |
| `src/components/layout/sidebar.tsx`, `header.tsx`, `src/middleware.ts` | a aba `/radar` (item de navegação, título do cabeçalho e rota protegida) |
| `src/lib/api-keys/scopes.ts`, `docs/public-api.md`, `src/components/settings/api-keys-settings.tsx` | os doze escopos das features do fork (tarefas/agendadas/negócios/reuniões/anotações/campos personalizados) e a rolagem da lista no diálogo — o upstream tem só os 8 originais |
| `src/lib/deals/create-deal.ts` | devolve `deal` (a linha inserida), não só `ok/created` — a rota v1 serializa a resposta a partir dele —, e aceita `tituloFixadoEm` (1007): a v1 fixa o título, o roteador e o passo `create_deal` derivam |
| `src/components/settings/settings-sections.ts`, `settings-chip.tsx`, `src/app/(dashboard)/settings/page.tsx` | a seção `integracoes` no rail e a variante `err` (vermelha) do chip |
| `src/lib/ai/types.ts`, `config.ts`, `structured.ts`, `defaults.ts`, `src/lib/cb-radar/worker.ts`, `src/app/api/ai/config/route.ts` | o modelo do Radar separado do modelo de chat (946): `radarModel` no tipo e em `CONFIG_COLUMNS`, o parâmetro `model` do `generateStructured`, `AI_PROVIDER_MODELS`, e a validação do modelo do Radar no save |
| `src/components/settings/ai-config.tsx` | `<datalist>` de sugestão no campo Modelo e a frase de escopo com link para Integrações |
| `src/app/(dashboard)/dashboard-shell.tsx` (Meu dia, 12/09/2026) | envolve o layout INTEIRO (menu, cabeçalho, página, heartbeat) na `<PortaDeEntrada key={user.id}>`, abaixo do `if (!user) return null` — nunca renderizar pedaço do app fora dela; e o "Loading..." traduzido (`DashboardShell.loading`) |
| `dashboard-shell.tsx`, `inbox/page.tsx`, `message-composer.tsx`, `message-thread.tsx` e `src/app/globals.css` (teclado do celular, 14/09/2026) | a altura por `var(--altura-visivel,100dvh)` na casca e na caixa de entrada (um merge que devolva `h-screen`/`100vh` devolve o cabeçalho sumindo com o teclado) e o `useTelaAcimaDoTeclado()` na casca; no compositor, o Enter por `enterEnvia` e a dica por `useMediaQuery(MIDIA_DE_TOQUE)`; no fio, o `data-acima-do-teclado` na raiz, o `onTouchStart`/`onTouchMove` do contêiner (recolhe o teclado) e o `ResizeObserver` que mantém o fim; no CSS, a regra dos 16 px FORA de camada. Ver a seção "O teclado do celular" |
| `src/hooks/use-auth.tsx` (Meu dia) | `sessionId` no contexto (o `session_id` do token, publicado no MESMO passo que `user`, no init e no listener) e o `signOut` do menu via `sairDesteAparelho` (escopo `local`, D4, 12/09/2026; erro vira toast e não navega) — além do que já era nosso (lente de simulação, perfis, `resolvedUserIdRef`) |
| `src/components/layout/header.tsx` (Meu dia) | `"/agenda": "agenda"` no `pageTitles`, DEPOIS de `/agendadas` (o mapa casa por `startsWith` na ordem de inserção); e `"/meu-dia": "meuDia"` |
| `src/components/layout/sidebar.tsx` (Meu dia, F3) | o item `/meu-dia` em `navItems`, fora do catálogo de perfis |
| `src/middleware.ts` (Meu dia, F3) | `/meu-dia` em `protectedPaths` |
| `src/app/layout.tsx` (app no celular, 14/09/2026) | `appleWebApp` com `NOME_CURTO_DO_APP` (o nome que o iPhone sugere embaixo do ícone) e a REMOÇÃO do `icons` do upstream: declarado, ele faz o Next ignorar os ícones de arquivo, e o `<head>` sai sem `apple-touch-icon` — um merge que o traga de volta tira o ícone do app instalado sem conflito nenhum (há pino). O manifesto e o ícone são arquivos NOSSOS (`manifest.ts`, `apple-icon.tsx`); ver a seção "App instalado no celular" |

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

⚠️⚠️ **Passo que falha pode VOLTAR PARA A FILA (13/09/2026), e a régua é o
ERRO — nunca o passo.** `src/lib/automations/retentativa.ts` (puro, com
teste) e o `catch` de `executeStepsFrom`. Nasceu de um caso medido: a
automação do Calendly morreu no aviso ao advogado ("Connection Closed") e,
como qualquer erro dava `break`, o `move_deal_stage` seguinte não rodou — o
card do cliente ficou na etapa antiga por causa de uma mensagem que não
tinha relação com ele. O que morde código novo:

- ⚠️⚠️ **Só repete falha do PROVEDOR num passo de ENVIO, e só com RECUSA
  COMPROVADA (4xx).** A primeira versão classificava por TIPO DE PASSO
  ("mexe só em dado do CRM, logo repete") e um teste do motor derrubou a
  ideia: `add_tag` sem `tag_id` estoura por CONFIGURAÇÃO, e repetir três
  vezes um erro determinístico só adia o aviso em cinco minutos — o oposto
  do que a retentativa existe para fazer. Erro lançado pelo próprio motor
  (config, banco, contato sem telefone) NUNCA volta à fila.
- ⚠️⚠️ **4xx × 5xx não é burocracia.** Entre "a Evolution recusou" (nada
  saiu) e "tempo esgotado" (o WhatsApp pode ter aceitado) não há diferença
  no texto do erro, e repetir o segundo manda a mesma mensagem DUAS VEZES
  ao cliente. É a distinção da 932 (`evolution_rejected` ×
  `evolution_error`), e o `entrega_incerta` existe porque ela não se
  adivinha. `EvolutionApiError.status` é o que responde isso, e o erro
  chega INTEIRO ao motor porque `flows/meta-send.ts` o propaga cru.
- ⚠️⚠️ **Só o transporte EVOLUTION retenta hoje.** Quem carrega o status
  HTTP é `EvolutionApiError`; o cliente da Cloud API (`meta-api.ts`) lança
  `Error` genérico, e sem status não dá para separar "a Meta recusou" de
  "não sei se saiu" — a régua falha FECHADA e não repete. Quem quiser o
  retry na Meta começa por dar um erro com status àquele cliente.
- ⚠️ **`PASSOS_DE_ENVIO` é allowlist**: passo novo nasce FORA, sem
  retentativa, até alguém decidir por escrito. Lista de exclusão faria o
  passo novo herdar o retry por esquecimento — que é como se manda mensagem
  repetida a cliente. `send_webhook` fica de fora de propósito (o n8n do
  escritório pode já ter recebido e criado o registro).
- ⚠️ **Volta para a MESMA fila do "Aguardar"** (`automation_pending_executions`)
  na posição do PRÓPRIO passo — o resume filtra por `gte('position', …)`. O
  "Aguardar" enfileira `position + 1` porque já terminou; aqui o passo não
  chegou a acontecer. Sem migration: o contador de tentativas mora no
  `context` (jsonb), como `_cadeia` e `_tag_chain_depth`.
- ⚠️ **Fila que recusa a linha NÃO vira "vai tentar de novo"**: ninguém
  retomaria, e a execução ficaria `partial` para sempre — invisível no fio
  e fora do bloco de correções do Meu dia. Falhando o enfileiramento, o
  comportamento é o de antes (falha na hora).
- ⚠️⚠️ **O contador de tentativas é AMARRADO À POSIÇÃO do passo**
  (`{ pos, n }` no contexto), nunca um número solto. O contexto atravessa a
  execução inteira: guardando só o número, um passo que falhou duas vezes e
  se recuperou deixaria o contador em 2, e o PRÓXIMO passo a falhar — num
  ponto sem relação nenhuma — nasceria no teto, sem retentativa alguma.
  Contador de outro passo vale zero, que é a verdade. (Achado da revisão
  própria; a cota do Codex tinha acabado neste PR.)
- ⚠️ **O TETO é testado ANTES do tipo do passo** (3 tentativas; 30 s e
  depois 5 min): invertendo, um provedor que recusa sempre — uma conexão
  apagada — reenfileiraria para sempre, queimando ciclo do agendador e
  nunca mostrando a falha a ninguém. A espera real é esta MAIS o tique do
  cron (~1 min no laço rápido).
- ⚠️ **O estado da execução vira `partial`**, o mesmo do "Aguardar": é o que
  impede `fecharLog` de carimbar desfecho enquanto a retentativa não rodou.

⚠️⚠️ **"Aguardar — parar se o cliente responder" (18/09/2026): a marca mora
no `context` DA FILA, e só lá.** `src/lib/automations/parar-se-responder.ts`
(puro + o cancelamento, com teste), a caixa no passo "Aguardar" do construtor,
e DOIS pontos de chamada na ingestão. É o "Pausar: até a mensagem recebida /
cronômetro" do Kommo, no tamanho menor: a saída da resposta leva a "parar".
Pedido do operador com uma sequência de 10 mensagens de recuperação — o
cliente respondia na 3ª e recebia as outras sete. O que morde código novo:

- ⚠️⚠️ **A invariante: a marca (`_parar_se_responder` = id do passo
  "Aguardar") existe APENAS no contexto GRAVADO de uma espera estacionada,
  nunca num contexto VIVO de execução.** O contexto é copiado de ponta a ponta
  (a espera seguinte, a retentativa e o `run_automation` herdam
  `args.context`), então são DUAS defesas: `contextoDaEspera` escreve a decisão
  a CADA estacionamento (marca ou limpa), e `resumePendingExecution` passa o
  contexto por `semMarcaDeResposta`. Sem a segunda, a marca vaza para a
  RETENTATIVA — que reenfileira `args.context` cru, sem passar por
  `contextoDaEspera` — e uma resposta nos 30 s da retentativa pararia a
  sequência num ponto que ninguém marcou (medido por mutação: só o pino da
  retentativa reprova). Por isso a chave NÃO entra no tipo `AutomationContext`.
- ⚠️⚠️ **`cancelarEsperasPorResposta` roda ANTES do despacho de robôs e
  automações, nos DOIS caminhos de ingestão** (`persistInboundMessage` da
  Evolution e o webhook da Meta), sem olhar `flowConsumed`. Depois do despacho,
  a mensagem cancelaria a espera da automação que ELA MESMA acabou de iniciar;
  e o cliente respondeu mesmo quando um robô consumiu a resposta (era a fresta
  do contorno com duas automações: "Nova mensagem recebida" é suprimido nesse
  caso). Há pino estrutural com a ORDEM e DEFAULT-DENY de chamadores
  (`parar-se-responder.chamadores.test.ts`): celular pareado
  (`persistDeviceMessage`), grupo, Instagram e robô ficam de fora — "a
  mensagem de QUEM para a sequência?" é decisão de produto, não conveniência.
- ⚠️⚠️ **A parada é da EXECUÇÃO (`log_id`), não da linha (Codex, PR #223).**
  Espera marcada DENTRO DE UM RAMO não é a única ponta viva: ramo em espera
  não segura o escopo de fora, que segue e estaciona a SUA espera — sem marca
  — mais adiante. Cancelando só a linha marcada, a irmã acordava e a sequência
  continuava, com a caixa prometendo "parar a automação" — e espera dentro de
  ramo é a forma NORMAL das automações deste escritório, então recusar a opção
  ali não era saída. São duas peças: (1) depois das marcadas, um 2º UPDATE
  cancela toda espera `pending` dos MESMOS `log_id` (conta + contato); (2) a
  MARCA DURÁVEL no registro — `automation_logs.interrompida_em`/`_por`
  (**1005**), gravada por `marcarExecucoesInterrompidas` em TODOS os cinco
  cancelamentos (resposta, saída da etapa, botão Parar, passo "Parar
  automação", desativação) — que a RETOMADA lê (`execucaoJaInterrompida`,
  ANTES da conferência de etapa: o card pode ter VOLTADO e a execução antiga
  acabou mesmo assim) e que o ESTACIONAMENTO respeita DENTRO da função
  `cb_estacionar_espera`. ⚠️⚠️ A marca mora no REGISTRO, e não nas linhas da
  fila (a 1ª versão, 5ª rodada do Codex): entre o disparo e a primeira espera
  a execução está RODANDO e não tem linha nenhuma na fila — um cancelamento
  nesse instante não tinha onde se gravar, e a espera que vinha depois
  acordava com o card de volta à etapa ao lado da execução nova. O registro
  existe desde o primeiro passo. ⚠️⚠️ E o motor NUNCA insere na fila
  direto: os dois estacionamentos (o "Aguardar" e a retentativa) passam por
  `cb_estacionar_espera`, que trava a linha do registro (`FOR UPDATE`),
  confere a marca e insere numa transação só — quem marca e quem estaciona se
  serializam pelo lock; `null` de volta = interrompida, o passo vira
  `skipped` e o escopo devolve `partial` (sem linha, sem zumbi na aba). Um
  INSERT direto reabriria o vão entre "perguntar" e "inserir" (4ª rodada);
  há pino estrutural. Falha ABERTA na leitura da marca (é a 2ª defesa de uma
  corrida de segundos). Espera de OUTRA execução do mesmo contato, sem marca,
  não é tocada — medido. ⚠️ A ORDEM em todo cancelamento é: cancelar a foto
  da fila → MARCAR os registros → cancelar DE NOVO por `log_id` (Codex, 6ª
  rodada): entre a foto e a marca um ramo ainda rodando pode ter estacionado
  uma irmã, que a marca impede de retomar mas deixaria `pending` na aba por
  horas. Depois da marca a função não insere mais, então a segunda varredura
  pega tudo o que sobrou. Vale para os que cancelam por lote (resposta, botão
  Parar, passo "Parar automação"; a saída de etapa parte dos REGISTROS vivos e
  faz marca → varredura, sem foto antes). ⚠️ Toda pergunta por `log_id` na fila (a guarda de
  `fecharLog`, as irmãs) depende do índice da **1004** — a fila não é podada.
- ⚠️⚠️ **Há uma SEGUNDA LINHA DE DEFESA, na retomada** (revisão por duas
  lentes, 19/09/2026): o cancelamento na ingestão é UM UPDATE, e um soluço do
  banco no instante da resposta deixava a espera acordar 27 h depois e mandar
  a mensagem seguinte a quem já tinha respondido, com um `console.error` como
  único rastro. Ao acordar uma espera MARCADA, `clienteRespondeuDesde` pergunta
  se há mensagem do cliente (não apagada) na conversa do contato com
  `messages.gravada_em` (1003, o `now()` da gravação) POSTERIOR ao
  `created_at` da espera — dois carimbos do mesmo relógio; `messages.created_at`
  NÃO serve, é o relógio do aparelho. Respondeu → marca `resposta`, cancela,
  varre as irmãs, anota. Leitura que falha → falha VISÍVEL
  (`MOTIVO_RESPOSTA_DESCONHECIDA`), o mesmo trato da etapa. Só na espera
  marcada, depois da marca e antes da etapa (pino). O cron passa `created_at`.
  A consulta tem índice PARCIAL próprio (1006), cujo predicado espelha os
  filtros — mudar um sem o outro deixa o índice de pé e inútil.
  ⚠️⚠️ Conferência que FALHA (a da resposta ou a da etapa — na retomada e
  na guarda por passo) para a EXECUÇÃO inteira, não só a linha: fechamento
  POR SEGURANÇA → marca → varredura das irmãs (10ª/11ª rodadas).
  `fecharLogPorSeguranca` grava `falhou` E a hora de fim de uma vez, SEM a
  guarda de espera viva de `fecharLog`: com uma irmã ainda viva, `fecharLog`
  adiava a hora de fim, e a marca em seguida calava todo `fecharLog`
  posterior — o registro ficava sem hora de fim para sempre e a falha
  "visível" nunca chegava ao fio. A ordem é pinada nos três caminhos.
  ⚠️ E a resposta que chega com a espera marcada já `running` (o cron acabou
  de reivindicá-la, DEPOIS de a retomada ter conferido) MARCA a execução sem
  cancelar a linha — que é do cron —, e a retomada em curso para no passo
  seguinte (9ª rodada; era o mesmo furo do botão Parar).
- ⚠️ **O botão Parar e o passo "Parar automação" marcam também a execução
  cuja espera está `running`** (reivindicada pelo cron naquele instante): a
  foto do UPDATE só vê `pending`, e sem a marca a retomada em curso seguia até
  a espera seguinte. A linha `running` não é cancelada (é do cron); a marca
  faz a retomada parar no próximo passo. ⚠️ MENOS a PRÓPRIA execução no passo
  apontado para a própria automação ("Parar automação: a si mesma", para
  cancelar as suas pendentes e recomeçar): numa retomada a linha `running`
  que ele enxerga é a sua, e marcá-la pularia o passo seguinte — o construtor
  promete que a execução em curso não se autocancela (auditoria pré-Codex,
  19/09; pino no `engine.test`).
- ⚠️ **`marcarExecucoesInterrompidas` PUBLICA a hora de fim da falha ADIADA**
  (`desfecho='falhou'` sem `finalizado_em` — o ramo que estourou enquanto uma
  espera irmã vivia, que `fecharLog` fecharia quando ela acordasse): nenhum
  cancelamento fecha o registro e `fecharLog` cala para execução marcada, então
  sem isto a falha ficava invisível para sempre no fio e no Meu dia. Só essas;
  cancelamento sem falha continua sem desfecho (936).
- **Conhecido, não tratado** (auditoria pré-Codex): a segunda linha conta
  mensagem de cliente de QUALQUER transporte (Instagram incluso), e a primeira
  só roda nos dois caminhos do WhatsApp — só diverge depois da unificação
  manual de fichas (D4 do Instagram). E linha `running` órfã (processo morto
  no meio da retomada) não tem recolhedor — pré-existente; o cron só lê
  `pending`, e o peso do estado `running` cresceu com este PR.
- ⚠️ **`fecharLog` não carimba execução interrompida**: a resposta (ou a saída
  da etapa) que chega durante o ÚLTIMO passo do escopo — depois da leitura da
  marca — deixava o escopo terminar e o fio dizer "concluiu" sobre execução com
  `interrompida_por` gravado. O `falhou` de um ramo anterior fica; só não se
  carimba desfecho nem hora de fim.
- ⚠️ **Vale só DURANTE a espera marcada.** Resposta que chega numa espera sem a
  caixa (a pausa de 30 s entre duas mensagens, por exemplo) não para nada — é
  a semântica do Kommo, e a tela diz "marque em cada Aguardar da sequência".
- ⚠️ **As MESMAS cercas dos outros dois cancelamentos** (`stop_automation` e o
  botão Parar): conta + CONTATO + `status = 'pending'`. Espera que o agendador
  já reivindicou (`running`) não é alcançada — corrida de segundos, inerente.
- ⚠️ **`cancelled`, e o desfecho do log NÃO é tocado** (precedente da 936),
  mas a interrupção é ANOTADA — uma vez por execução — em `steps_executed` por `interrupcao.ts` (`wait` / `skipped` /
  "interrompida: o cliente respondeu…"): aqui ninguém clicou em nada, e sem a
  anotação a sequência sumiria sem dizer por quê. `sinaisDoHistorico` ignora
  `wait`, então a anotação não muda desfecho nenhum. ⚠️ A execução
  interrompida NÃO aparece no fio nem no "Já rodou" (não há desfecho para
  ela — `concluida` mentiria, `barrada` também); narrá-la pede um 4º desfecho
  (`interrompida`), com migration no CHECK da 985 e os consumidores — vale
  para os TRÊS cancelamentos, e ficou de fora de propósito.
- ⚠️⚠️ **A anotação grava COM CERCA: `steps_executed->>N IS NULL`, com N =
  passos lidos (Codex, PR #223).** Todo escritor daquela coluna lê, acrescenta
  e regrava — o `appendResults` do motor inclusive —, e a anotação pode correr
  com ele (o escopo de fora da mesma execução ainda rodando, ou uma irmã sendo
  retomada). Como todos só ACRESCENTAM, "a posição N continua vazia" = "ninguém
  escreveu desde que li"; zero linhas → relê e tenta de novo (3×), e depois
  DESISTE da anotação. A garantia é de mão única, e é a que importa: **a
  anotação nunca apaga passo do motor** (são eles que decidem o desfecho). O
  inverso ainda pode acontecer — o motor leu antes e regrava por cima, e some
  a linha explicativa; fechar esse lado pede append atômico no banco para
  TODOS os escritores (RPC + `appendResults`), que é outra obra. Forma medida
  contra o PostgREST real. E é IDEMPOTENTE por motivo: a execução que já tem
  aquela linha `skipped` não ganha outra — duas esperas irmãs que ACORDAM em
  horas diferentes com o card fora da etapa (ou o dreno seguido da retomada)
  contariam uma interrupção como duas; a leitura já está em mãos, custa zero.
- ⚠️ **A aba Automações recarrega ~3 s depois de chegar mensagem do CLIENTE na
  conversa ABERTA** (`inbox/page.tsx`, `avisarExecucoesMudaram`): o servidor
  pode ter acabado de cancelar uma espera, e a aba ao lado seguiria dizendo
  "próximo passo em 27 h" — numa feature cuja graça é confiar que parou
  sozinha. Com atraso porque o INSERT da mensagem chega ANTES do cancelamento
  (que roda alguns passos depois na ingestão), e só na conversa aberta porque
  o mesmo evento recarrega a marca da LISTA inteira — a cada mensagem de
  qualquer cliente viraria uma consulta por mensagem.
- ⚠️ **Só o booleano `true` liga**, em TODOS os lugares (motor, grade,
  construtor, validação): `"true"` e `1` chegam de JSONB e são truthy — a
  caixa apareceria marcada numa tela e o motor a ignoraria.
- ⚠️ **O filtro é por caminho JSON no PostgREST**
  (`.not('context->>_parar_se_responder', 'is', null)`, com o RETURNING
  `passo:context->>…`). O teste unitário usa banco falso que imita a forma
  SUPOSTA — a lição do `storage.exists()` —, então a forma foi MEDIDA contra o
  PostgREST real em 18/09 (espera marcada cancela, a de controle fica, conta
  errada não alcança). Quem mexer no filtro mede de novo.
- ⚠️ **O INSERT da espera agora é CONFERIDO** (o Supabase devolve `error`, não
  lança): fila que recusa a linha vira passo `failed` + desfecho `falhou`, em
  vez de "waiting…" para sempre sem ninguém para retomar. Era buraco do
  upstream; a retentativa já conferia o dela.
- **A chave do resumo muda** (`wait_<unidade>_ou_resposta`, em
  `descrever-passo.ts`): a grade do funil e a linha do tempo da aba Automações
  dizem "Aguardar 30 h ou até o cliente responder" sem código próprio. As
  quatro variantes estão em `VARIANTES` do teste, que cobra os dois dicionários.
- **A tela de registros da automação pinta `skipped` NEUTRO** (traço cinza):
  até aqui tudo que não era `success` ganhava o ✗ vermelho, e "parou porque o
  cliente respondeu" — a regra funcionando — era lido como erro. Vale também
  para a condição de ramo vazio da 985.

⚠️⚠️ **Automação PRESA À ETAPA (18/09/2026): "interromper se o card sair
desta etapa" tem DUAS pontas, e nenhuma dispensa a outra.**
`src/lib/automations/so-na-etapa.ts` (puro + as duas pontas, com teste),
`interrupcao.ts` (a anotação, compartilhada com o "parar se responder"), a
caixa no gatilho de etapa do construtor e `trigger_config.parar_ao_sair` — sem
migration. Nasceu da recuperação de No Show: dez mensagens com o link de
agendamento, o cliente agenda na 3ª, a automação do Calendly move o card para
"Reunião Agendada", e as outras sete saíam assim mesmo. Medido antes: o
"Aguardar" acordava e seguia, estivesse o card onde estivesse — a única defesa
era a condição "ainda está na etapa?" escrita à mão depois de CADA espera, com
o resto aninhado dentro do ramo (dez níveis para dez mensagens). O que morde
código novo:

- ⚠️⚠️ **Ponta 1, a GARANTIA — `resumePendingExecution` chama
  `cardSaiuDaEtapa` antes de qualquer passo** (depois do freio de
  `is_active`). Lê a etapa do BANCO na hora em que a espera acorda — nunca
  `context.to_stage_id`, que depois de 30 h é história —, então vale para os
  cinco escritores de etapa, para o que não gera evento e para o card APAGADO
  (sem card = fora da etapa: fato, não ignorância). O card é o `deal_id` do
  contexto; sem ele (execução manual), o aberto mais recente do contato — a
  mesma resolução de `negocioAlvo`.
- ⚠️⚠️ **Ponta 2, a HONESTIDADE DA TELA — o dreno do funil chama
  `cancelarEsperasAoSairDaEtapa` para todo evento `deal_stage_changed`**,
  depois da reivindicação e ANTES das guardas de ciclo/atraso e do despacho
  (evento velho não DISPARA, mas o card saiu do mesmo jeito). Só com a ponta 1
  a aba Automações e a marca "tem robô rodando" diriam "próxima mensagem em
  27 h" sobre quem já reagendou, e o operador iria clicar em Parar — o
  trabalho manual que isto existe para acabar. Ganho real: o card que SAI e
  VOLTA antes de a espera acordar recomeça a sequência do zero, em vez de
  ficar com DUAS correndo. Há pino estrutural das duas pontas e da ordem
  (`so-na-etapa.chamadores.test.ts`) — o laço do dreno não tem teste de
  comportamento, e "esqueci de chamar" só se pega lendo o fonte.
- ⚠️⚠️ **A ponta 2 trabalha por EXECUÇÃO (registro), não por espera** (5ª
  rodada do Codex): lê os registros VIVOS de automações de etapa do contato
  (`finalizado_em` e `interrompida_em` nulos), MARCA os das automações presas
  cujas etapas não incluem o destino (`marcarExecucoesInterrompidas`,
  motivo `etapa`), cancela toda espera `pending` desses `log_id` e anota uma
  vez por registro. Só a execução que JÁ EXISTIA quando o card saiu
  (`.lte('created_at', evento.criado_em)` sobre o REGISTRO): os eventos de
  funil não são processados em ordem garantida — o aviso imediato e o cron
  drenam ao mesmo tempo —, e no card que SAI e VOLTA rápido a reentrada pode
  ser processada ANTES da saída; sem o corte, a saída atrasada mataria a
  execução NOVA da reentrada. A execução que está RODANDO sem espera nenhuma
  também é marcada — é o furo que a versão por espera deixava. ⚠️ O registro
  não guarda o card: contato com DOIS negócios abertos em etapas presas teria
  a execução do outro marcada — aceito e escrito ("um card por contato").
- ⚠️⚠️ **A execução nascida de evento é de UMA ESTADIA do card na etapa** (7ª
  rodada do Codex): o dreno carimba `evento_em` (o `criado_em` do evento de
  entrada) no contexto, e `cardSaiuDaEtapa` pergunta à fila de eventos se há
  `deal_stage_changed` deste card POSTERIOR a esse instante — qualquer
  movimento encerra a estadia, mesmo com o card de volta, mesmo para outra
  etapa da mesma automação (a entrada nova dispara execução nova; a antiga
  sairia em dobro). Conferido ao NASCER (`dispararAutomacoes`, antes de
  `executeAutomation`: execução natimorta sai como "fora do escopo", sem
  registro) e ao ACORDAR. É o que fecha o evento de ENTRADA processado depois
  da SAÍDA — dois drenos concorrentes, ou o cron atrasado até 1 h —, que a
  marca de saída não alcança porque a execução ainda não existia. Execução
  SEM evento (manual, ou acionada por outra automação) ganha a PRÓPRIA
  estadia (`estadiaSemEvento`, 9ª–12ª rodadas): o CARD-ALVO (o que o contexto
  JÁ traz — a filha herda o da mãe —, senão o aberto mais recente do contato
  numa etapa da automação, senão o aberto mais recente; sem ele, mover
  QUALQUER card do contato matava a manual) e a âncora, o ÚLTIMO movimento
  de etapa conhecido DESSE MESMO card (card escolhido aqui e âncora de outro
  faziam a entrada do próprio card parecer "posterior") — pelo relógio do BANCO
  (`criado_em` de um evento), nunca `now()` do app: a mãe que move o card e
  aciona a filha tem o evento gravado milissegundos antes, e com o relógio
  do app atrasado o próprio movimento pareceria "posterior". Sem card aberto
  a pergunta é por CONTATO; sem movimento conhecido, `null` = só a posição.
  A poda de 30 dias da fila de eventos é o limite prático da pergunta. As
  consultas por card e por contato têm índice próprio (1006): rodam antes de
  cada passo de toda automação presa.
- ⚠️⚠️ **A marca é lida antes de CADA passo do escopo** (7ª rodada): com a
  espera marcada num ramo, o escopo de fora segue executando, e a interrupção
  só era vista no próximo estacionamento — os passos comuns até lá, inclusive
  mensagens, saíam depois da interrupção prometida. Uma leitura por chave
  primária por passo; o "Aguardar" tem a sua dentro de `cb_estacionar_espera`.
- ⚠️⚠️ **E a ESTADIA também é conferida antes de cada passo** (8ª rodada): a
  conferência do dispatch e a criação do registro são DUAS operações, e o
  card que sai entre elas deixa o dreno sem registro para marcar e o registro
  sem marca. A saída está gravada na fila de eventos, então `executeStepsFrom`
  pergunta de novo (`cardSaiuDaEtapa`, só nas presas à etapa — `nao_se_aplica`
  não consulta nada) com o registro já existente: o que ainda escapa é UM
  passo cujo envio já estava em voo quando a saída foi gravada, nunca a
  sequência. `saiu` = marca + foto da fila + `skipped`; `erro` = falha visível.
  ⚠️ Vale também ANTES do "Aguardar" (9ª rodada): a automação presa cujo 1º
  passo é uma espera estacionava sem conferir a etapa — a execução manual
  sobre card fora da etapa aparecia "aguardando" e acordava se ele entrasse.
- ⚠️ **A conferência que FALHA ao nascer vira registro `failed`/`falhou` com o
  motivo (`registrarFalhaAoNascer`, `MOTIVO_ETAPA_DESCONHECIDA`), nunca pulo em
  silêncio** (8ª rodada): o dreno já reivindicou o evento e conta o disparo
  como entregue, então pular descartaria a automação para sempre sem ninguém
  ver. É o mesmo desfecho da retomada; o "Executar automação" resolve à mão.
- ⚠️⚠️ **Erro de leitura é `'erro'`, nunca `'na_etapa'` nem `'saiu'`**, e a
  retomada falha de forma VISÍVEL (espera `failed`, log `failed` + desfecho
  `falhou`, motivo escrito): seguir cobraria quem pode ter reagendado,
  cancelar mataria calada a sequência de quem ficou. É o trato que o motor já
  dá a erro de banco na retomada.
- ⚠️ **Três condições para PRENDER (`etapasQuePrendem`)**: gatilho
  `deal_stage_changed`, `parar_ao_sair === true` ESTRITO, e pelo menos uma
  etapa em `stage_ids` — com a lista vazia o gatilho vale para QUALQUER etapa
  e "sair" não tem de onde (a caixa nem aparece, e o motor ignora a chave).
  ⚠️ Entrar em OUTRA etapa da mesma lista (cartão "expandido" na grade)
  ENCERRA a estadia, nas DUAS pontas (8ª rodada; até aí a ponta 2 lia como
  "continuar dentro" e discordava da retomada): a entrada na etapa nova
  dispara execução NOVA, e a antiga sairia em dobro. Qualquer movimento do
  card acaba com a estadia.
- ⚠️ **A ÚNICA porta de nascimento da automação de etapa é o `?stage=` da
  grade do funil** (`TRIGGER_OPTIONS` não oferece `deal_stage_changed`; o
  gatilho só volta à lista para automação JÁ gravada com ele), e é só lá que
  a semente mora: o seletor de etapas do construtor NÃO semeia ao editar —
  semear ali ligaria a interrupção numa regra antiga por um simples re-pique
  de etapa, contra a decisão de que as existentes não mudam (a 7ª rodada
  semeava; a 8ª desfez).
- ⚠️ **A filha acionada por "Acionar automação" NÃO herda a estadia da mãe**
  (`run_automation` manda `evento_em: null`; 8ª rodada): a mãe pode ter
  movido o card no meio antes de acionar, e a filha presa à etapa nova leria
  esse movimento como "saiu" com o card DENTRO dela. Zerado, `runAutomationById`
  ancora a estadia PRÓPRIA da filha no último movimento do card — o da mãe,
  que não é "posterior" a si mesmo (9ª/10ª rodadas).
- ⚠️ **Ganho/perdido NÃO encerra a estadia**: o card não sai da etapa (950 —
  o selo fica na coluna), e `cardSaiuDaEtapa` só olha `deal_stage_changed`.
  Se o operador quiser "perdido = parar", é decisão nova (passo "Parar
  automação" na automação de status, ou mover o card). ⚠️ Uma assimetria
  escrita: a execução manual SEM card no contexto cai na posição do negócio
  ABERTO mais recente (`negocioAlvo`), então para um card ganho/perdido ela
  responde "saiu" — a execução por evento, que carrega o card, responde pela
  etapa. Aceito: executar à mão sobre card fechado é raro.
- ⚠️ **A pergunta "houve movimento posterior?" só enxerga 30 dias** — a poda
  de `cb_automation_events` (`podarEventosAntigos`). Espera mais longa que
  isso fica cega para uma saída-e-volta já podada; a marca da ponta 2 e a
  posição do card cobrem. `validate.ts` não limita o `amount` do "Aguardar".
- ⚠️ **A saída da etapa (ponta 2) distingue o CARD pela espera**
  (`context.deal_id` das linhas `pending` E `running` — a reivindicada pelo
  cron naquele instante é a única prova de que a execução é do card A; 12ª
  rodada): execução estacionada por OUTRO card do mesmo contato fica de
  fora. A que está RODANDO agora, sem espera nenhuma, não tem como ser
  distinguida (o registro não guarda o card) — aceito: "um card por contato"
  é a regra desta casa, e a janela é de segundos. E
  registro anterior à 985 (sem `finalizado_em`, nada retroativo) conta como
  vivo: a primeira saída de etapa de um contato assim marca e anota um
  registro morto há semanas, uma vez — cosmético, aceito.
- ⚠️ **Decisão do operador (18/09/2026): caixa POR AUTOMAÇÃO, que nasce
  MARCADA nas novas** (`automations/new/page.tsx` semeia `parar_ao_sair:
  true` no `?stage=`; há pino). Não é regra geral invisível porque existe
  sequência que DEVE sobreviver à etapa — as boas-vindas de "Contrato
  Fechado", cujo card vai para o funil do Jurídico. Ausente = `false`:
  automação gravada antes disto não muda (medido: nenhuma automação de etapa
  tinha "Aguardar" em produção, então nada mudou retroativamente).
- ⚠️ **Vale para QUALQUER execução da automação presa, inclusive a disparada
  pelo "Executar automação"** — de propósito: o card que JÁ estava em No Show
  quando a automação foi criada é executado à mão, e a sequência tem de parar
  igual quando ele agendar. O preço: executar à mão para quem NÃO está na
  etapa não manda nada — a estadia é conferida antes de cada passo (8ª
  rodada), e o 1º já encontra o card fora.
- ⚠️ **A própria automação que move o card se interrompe no passo SEGUINTE**
  (`move_deal_stage` no meio): a estadia é conferida antes de cada passo (8ª
  rodada; até aí só na espera seguinte, e os passos até lá saíam). A ajuda da
  caixa manda deixar o "Mover card" por último.
- ⚠️⚠️ **VÁRIAS automações no mesmo lead: cada uma cai SÓ pelo que ELA
  pediu** (pergunta do operador, medida em 18/09 com quatro estacionadas ao
  mesmo tempo: presa à etapa, mesma etapa SEM a caixa, espera marcada "parar se
  responder", espera comum). Cliente responde → só a marcada; card sai da
  etapa → só a presa (a da MESMA etapa sem a caixa segue); "Parar" da aba → só
  a automação clicada. É o que o recorte garante: a resposta age por MARCA +
  `log_id` (a execução), a etapa por `etapasQuePrendem` de CADA automação, e o
  botão por `automation_id`. ⚠️ Consequência: automação acionada por OUTRA
  ("Acionar automação") é execução própria, com registro próprio — parar a mãe
  não para a filha; quem encadeia marca as esperas em cada uma.
- ⚠️ **As mesmas cercas e o mesmo registro dos outros cancelamentos**: conta +
  CONTATO + `pending`; `cancelled`, desfecho intocado, anotação `skipped` em
  `steps_executed` ("interrompida: o card saiu da etapa…"). O cancelamento do
  dreno é leitura + UPDATE por ids com `.eq('status','pending')`: a foto é de
  instantes atrás e quem decide é o banco.
- ⚠️ **A consulta do dreno usa `automations!inner(...)` com filtro no
  embutido**, e o recorte é REFEITO em JS (`esperasQueOMovimentoEncerra`,
  puro): é a armadilha do embed LEFT desta casa — filtro no embutido sem
  `!inner` devolve a linha com o embutido nulo. Forma MEDIDA contra o
  PostgREST real, e as duas pontas medidas de ponta a ponta em 18/09 (funil de
  teste criado e apagado): card sai → espera cancelada na hora; dreno pulado →
  a espera acorda, cancela, e o passo seguinte NÃO roda.

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
  ⚠️⚠️ **E a segunda metade do par está INERTE hoje — o par funciona por
  acidente, pela PRIMEIRA.** Medido em 16/09/2026: o variant é
  `@custom-variant dark (&:is(.dark *))` (globals.css, linha 39), o modo
  escuro é marcado por `html[data-mode="dark"]` (use-theme.tsx), e não
  existe **UM** elemento com a classe `.dark` na página — `text-amber-700
  dark:text-amber-300` resolve para `amber-700` no escuro. São **111** usos
  de `dark:text-*` no repo na mesma situação. Consequência prática: escolha
  a PRIMEIRA cor sabendo que ela vale nos dois modos (`amber-700` mede 4,90
  de contraste no claro e 4,17 no escuro; `amber-500` dá 9,84 no escuro e
  **2,08** no claro, ilegível). Continue escrevendo o par — ele fica certo
  no dia em que alguém consertar o variant —, mas **não conte com ele**.
  Consertar é uma linha (`&:is(.dark *, html[data-mode="dark"] *)`) e muda
  a cor de 111 lugares de uma vez: é decisão própria, com revisão de tela,
  nunca carona de outro PR.
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

⚠️ **O campo "E-mail" ESPELHA `contacts.email` (1000), e o espelho mora no
BANCO.** `custom_fields.espelho` (hoje só `'contacts.email'`), dois gatilhos
— um em `contacts`, outro em `contact_custom_values` —, o módulo puro
`src/lib/contacts/email-espelhado.ts` e o cadeado no catálogo. Pedido do
operador (14/09/2026): o e-mail só existia na ficha de /contatos e ninguém o
via nem editava na conversa. O que morde código novo:

- ⚠️⚠️ **Não espelhe em código.** `contacts.email` tem muitos escritores
  (ficha, formulário, CSV, PATCH da API v1, `update_contact_field`, a criação
  de ficha do Calendly e do Asaas) e o valor do campo também. É a lição da
  trilha da 912. Com o gatilho, TODO leitor do valor do campo
  (`{{contact.campo.<chave>}}`, disparos, API v1, a lista do funil) enxerga o
  e-mail sem saber que ele é especial.
- ⚠️⚠️ **`pg_trigger_depth() > 1` separa gente de eco e de cascata.** Escrita
  direta chega com profundidade 1 e espelha; a que veio do outro gatilho, ou
  de CASCATA (apagar o contato cascateia o valor), chega com 2 e para. O eco
  também termina sozinho pelo `IS DISTINCT FROM`: UPDATE que não muda nada não
  casa linha. MEDIDO num Postgres 16 descartável, com 22 cenários, inclusive
  as duas cascatas.
- ⚠️ **O campo espelhado não se apaga nem troca de tipo, chave ou espelho** —
  gatilho `BEFORE UPDATE OR DELETE`, e não só policy: a policy não alcança a
  service role, e RLS que barra devolve 0 linhas sem erro. Renomear e mudar
  de bloco/posição continuam livres. O DELETE direto (profundidade 1) é
  recusado; a CASCATA de apagar a conta (profundidade 2) passa. No catálogo,
  a lixeira vira cadeado.
- ⚠️⚠️ **A ficha de /contatos mostra o e-mail DUAS vezes**, em abas diferentes
  e com o estado sobrevivendo à troca: na aba de dados (botão "Salvar") e no
  campo espelhado (salva sozinho). Por isso o "Salvar" só manda o e-mail se
  ele MUDOU naquela caixa (`emailMudou`) — senão regravaria o valor velho por
  cima da edição do campo, e o gatilho levaria o velho de volta ao campo, em
  silêncio. E cada lado atualiza o estado do outro ao gravar. O painel da
  conversa não tem o problema: lá só existe o campo.
- ⚠️ **Os dois lados guardam o MESMO texto (1001)**: gatilhos BEFORE aparam a
  linha de origem — o e-mail da ficha e o valor do campo espelhado — antes de
  os AFTER da 1000 espelharem. Sem isso, `{{contact.campo.email}}` devolvia
  " ana@x.com\n" e `{{contact.email}}` o aparado. Campo COMUM não é aparado.
- **Um espelho por conta** (índice único parcial), semeado no FIM do bloco
  Geral; conta NOVA nasce com ele por gatilho em `accounts`, que nunca derruba
  a criação da conta (falha vira WARNING). A chave é `email` quando livre.
- ⚠️⚠️ **O CONVITE não conta o campo espelhado como dado.** `redeem_invitation`
  recusa quem tem dados na própria conta, e `custom_fields` está na lista;
  como a conta provisória do cadastro (e a que `remove_account_member` cria)
  nasce com o campo, TODO convite passaria a ser recusado com 409. A 1000
  recria a função (reprodução fiel da 960) com `AND espelho IS NULL` naquela
  linha. Achado da revisão do PR #210 ANTES de aplicar; medido num Postgres
  descartável — o mutante sem a linha reproduz a recusa. Pino:
  `supabase/migrations/convite-ignora-campo-espelhado.test.ts`. Quem recriar
  `redeem_invitation` (ou mesclar a do upstream) mantém a exclusão.
- ⚠️⚠️ **São DOIS escritores de tela com foto velha, e os dois só mandam o
  e-mail quando ele MUDOU** (`emailMudou`): a ficha E o formulário "Editar" de
  /contatos, que é preenchido pela linha da lista (sem recarga) — consertar a
  ficha não consertou o formulário (revisão do PR #210). Pino:
  `src/lib/contacts/email-espelhado.chamadores.test.ts`.
- **Gravar o campo espelhado avisa o estado do e-mail na mesma tela**: no painel
  da conversa, `onContactUpdated({ id, email })` (senão a linha do envelope
  mostrava o e-mail velho logo acima do campo novo); na ficha, com CERCA do
  contato à vista (`contatoAbertoRef`) — a descarga de desmonte grava o
  cliente A depois de a ficha já ter aberto o B.

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
  ⚠️ Hoje são SEIS (o Instagram e a mensagem tardia da 1010 entraram depois),
  e o que importa é quem NÃO está na lista: **`src/lib/cb-groups/persist.ts`**.
  Aquele arquivo não menciona `conversations.status` em lugar nenhum, então
  **conversa de GRUPO encerrada NÃO reabre com mensagem no grupo** — ela só
  volta se a EQUIPE mandar mensagem por aqui (aí o núcleo de envio reabre).
  Encerrar um grupo de trabalho é escondê-lo da caixa por tempo
  indeterminado, e as mensagens continuam chegando sem ninguém ver. Medido em
  21/09/2026, quando o encerramento em lote da **1018** precisou decidir o que
  fazer com os 7 grupos abertos da conta (2 a 12 dias de última mensagem, 261
  não lidas somadas): eles ficam de fora por padrão, e incluí-los exige
  `p_incluir_grupos => true`, por escrito. Quem for encerrar grupo pela TELA
  paga o mesmo preço, sem aviso nenhum.
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

⚠️ **Selo da janela de 24h na lista (991/993, 12/09/2026): a ampulheta lê o
BANCO, e o banco espelha o fio.** `conversations.janela_meta` (993: mapa
número → instante, mais a chave `sem_carimbo`; gatilho em `messages` e a
dobra na exclusão de conexão), `src/lib/inbox/selo-da-janela.ts` (puro,
testado) e a ampulheta em `conversation-list.tsx`. Decisões do
operador (10/09/2026): só a ampulheta, expandindo no hover; cor padrão de
24h a 12h, âmbar de 12h a 3h, vermelha abaixo de 3h; fora das Encerradas; só
WhatsApp oficial (não Instagram); sem filtro "janela aberta". O que morde
código novo:

- ⚠️⚠️ **O gatilho é ESPELHO de `contaParaOCanal` (`janela-24h.ts`), e há
  teste lendo o SQL.** Mensagem do CLIENTE carimbada com conexão `meta`
  avança a chave DO NÚMERO; SEM carimbo, só se o id for `wamid.` — aí entra
  na chave `sem_carimbo` ("número oficial, qual não se sabe"), que conta
  para qualquer número oficial de saída, como no fio. Mensagem pelo QR Code
  ou pelo Instagram não toca no mapa. Para o número de saída, a lista fica
  com a mais recente entre a chave dele e a `sem_carimbo` — a "última
  mensagem do cliente que conta para este número" do fio. Mudou a regra num
  lado, muda no outro: `selo-da-janela.test.ts` compara o `restante` da
  lista com o `minutosRestantes` do fio sobre as mesmas mensagens, inclusive
  com DOIS oficiais. ⚠️ A 991 guardava UM par por conversa (a mensagem
  oficial mais recente, de qualquer número) e DIVERGIA do fio com dois
  oficiais + conversa fixada no mais antigo (achado da revisão e do Codex no
  PR #194) — a 993 trocou o par pelo mapa no mesmo dia. ⚠️ **UMA divergência
  ESCRITA, para o lado sem selo:** a conta SEM canal nenhum (o fio conta o
  fio inteiro; a lista cala, porque não sabe por qual número responde).
- ⚠️ **Conexão oficial APAGADA: a chave dela é DOBRADA em `sem_carimbo`**
  (gatilho AFTER DELETE em `cb_channels`, ficando a mais recente das duas).
  É o espelho do `ON DELETE SET NULL` da 902 nas mensagens: o fio passa a
  contá-las como sem carimbo, e sem a dobra a lista esconderia a janela que
  o fio mostra. Conexão por QR Code ou Instagram apagada não mexe no mapa.
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

⚠️ **Saúde das conexões tem TRÊS eixos, e o terceiro é "está entregando EM
DIA?" (1002).** `src/lib/cb-channels/atraso-de-entrega.ts` (puro, com teste),
as colunas `entrega_carimbo_em`/`entrega_recebida_em` em `cb_channels`, o
ramo `lagging` de `toneFor` e a linha âmbar no popover do cabeçalho. Os dois
eixos antigos (o estado que o provedor reporta × o frescor dessa informação)
respondem a MESMA pergunta — "está DE PÉ?" —, e foi por esse vão que passou o
episódio de 16/09/2026: a conexão Bancário - Comercial ficou `open`, com o
webhook apontado para cá e o frescor novo (verde nos dois, com verdade)
enquanto o WhatsApp entregava à Evolution com **29 minutos** de atraso. Quem
percebeu foi o operador, estranhando o relógio da mensagem na tela. O que
morde código novo:

- ⚠️⚠️ **A fronteira SÓ AVANÇA, e não é conservadorismo: conexão represada
  drena o backlog FORA DE ORDEM.** Medido no mesmo dia, a Evolution gravou em
  sequência os carimbos 11:36, 11:30, 11:23, 11:30, 11:29, 11:04, 11:04,
  11:03. Guardando "a última mensagem que chegou", a de 11:04 apagaria o
  alarme que a de 11:36 acabou de acender, e a tela piscaria entre "em dia" e
  "atrasada" a cada 30 s no meio do episódio. A cerca é do BANCO
  (`entrega_carimbo_em.lt.<novo>` no UPDATE), nunca ler-então-escrever: o
  webhook responde 200 e trabalha em `after()`, então duas mensagens do mesmo
  canal podem ser processadas em paralelo.
- ⚠️ **`atrasoSeg` NULO é "não sei", nunca zero.** Conexão sem medição não
  acusa nada — é a régua de `falhou` no `use-channel-health`, e vale aqui
  pelo mesmo motivo: zero afirmaria "entrega instantânea" sobre quem ninguém
  mediu. NADA é retroativo: `messages.created_at` guarda o carimbo do
  WhatsApp (a ingestão o sobrescreve) e o instante da gravação não existe no
  acervo — um backfill teria de inventar um dos dois lados.
- ⚠️⚠️ **TODA condição de gravação vive no WHERE, nunca só em memória, e a
  condição não pode depender do VALOR LIDO.** O espaçamento da escrita
  atrasada é um predicado SQL; a transição que APAGA o alarme dispensa o
  espaçamento e leva `entrega_carimbo_em < corteDoAlarme(agora)` — "a
  fronteira guardada ainda é um alarme aceso", que é coluna contra
  CONSTANTE. Três formas foram tentadas e as duas primeiras estão erradas,
  em direções opostas (Codex, 4ª e 5ª rodadas do PR #220):
  1. **Sem cerca**, com o argumento de que o ramo era "auto-limitante" —
     só vale SEQUENCIALMENTE; concorrentes leem todos a mesma fronteira
     atrasada e todos escrevem.
  2. **Compare-and-swap do valor lido** — atômico, mas PERDE a amostra
     saudável que corre com uma atrasada mais nova: a atrasada grava
     primeiro e a saudável não casa mais o valor original. Se era ela que
     encerrava o backlog, o alarme fica aceso até a medição expirar.
  3. **O corte do alarme** — a saudável que perde a corrida ainda casa (a
     fronteira nova continua atrasada) e a segunda saudável não casa (a
     fronteira já ficou recente). Provado em Postgres real nos dois
     cenários.
  ⚠️ "A fronteira guardada está atrasada" seria `recebida - carimbo >
  limiar`, comparação entre DUAS COLUNAS que o filtro do PostgREST não faz.
  O corte existe porque o bypass só interessa com o alarme ACESO, e alarme
  aceso já exige medição FRESCA (`recebida` ≈ agora) — então
  `agora - carimbo > limiar` diz a mesma coisa contra uma constante. O
  SELECT anterior decide se VALE tentar; quem serializa é sempre o banco.
- ⚠️⚠️ **A medição TEM VALIDADE (1 h), e sem ela o alarme nunca apaga.** A
  régua olhava só o atraso histórico: uma amostra atrasada seguida de
  silêncio mantinha `warn/lagging` para sempre, e o cabeçalho e o Meu dia
  afirmariam "esta conexão está entregando tarde" horas depois da última
  mensagem. `alarmeDeAtraso` (atraso **E** frescor) é o que a tela e o
  `toneFor` usam; `entregaAtrasada` sozinha fala da AMOSTRA, não do
  presente, e confundir as duas é o defeito (Codex, 3ª rodada do PR #220).
  Uma hora é a folga medida: a conexão do episódio recebia ~1,26 msg/min, e
  a mais parada do escritório passa até uma hora sem mensagem em silêncio
  NORMAL. ⚠️ O que este eixo NÃO detecta, de propósito: a conexão que trava
  de vez e PARA de receber — ali a medição envelhece e o alarme apaga, e
  dizer "está atrasada" a partir de uma amostra de ontem seria inventar.
  "Não chega mensagem há tempo demais" é outro alarme, e precisaria do
  padrão de tráfego esperado de cada conexão para não gritar de madrugada.
- ⚠️⚠️ **A TELA lê `detail === 'lagging'`, nunca reavalia a régua.**
  Recalcular no render precisa de `Date.now()`, que é chamada impura e o
  React Compiler REPROVA (erro de lint, não aviso) — e uma segunda cópia da
  régua pode discordar do glifo ao lado, que é pior que as duas caladas.
- ⚠️⚠️ **`lagging` NÃO impede ENVIAR, e isso vale para toda guarda de
  saída.** `vivaParaEnviar` (`asaas/varrer-regua.ts`) aceita `ok` e os
  amarelos de `ENVIA_MESMO_EM_AMARELO` = {`webhook`, `lagging`} — os dois
  descrevem a ENTRADA. Sem isso, a régua de cobrança pulava a conexão e não
  cobrava ninguém por ela: o episódio de 16/09 teria adiado em silêncio as
  cobranças do dia (Codex, PR #220). `pairing`/`stale`/`lastError`
  continuam fora. Quem criar um amarelo novo decide, por escrito, de que
  lado ele fica.
- ⚠️ **O espaçamento de 1 min entre gravações não é economia de banco, é o
  REALTIME.** Todo UPDATE em `cb_channels` dispara o `postgres_changes` que
  `use-channel-health` assina, e o hook responde refazendo a sonda. Sem
  espaçar, a rajada de um backlog drenando — dezenas de mensagens num minuto,
  exatamente quando o alarme importa — faria a tela sondar dezenas de vezes
  por minuto.
- ⚠️ **Carimbo no FUTURO além de 2 min é recusado.** Ele vem do aparelho de
  quem enviou; aceitar relógio torto trava a fronteira à frente do nosso
  relógio e mascara atraso real até o tempo alcançá-la.
- ⚠️⚠️ **GRUPO fica de fora, e é escolha escrita.** A ingestão de grupo tem
  caminho próprio (`cb-groups/persist.ts`) e lá o `channel_id` gravado é o do
  webhook que CHEGOU PRIMEIRO — com os dois números do escritório no mesmo
  grupo, o WhatsApp entrega às duas instâncias e o UNIQUE descarta a segunda.
  Creditar por ali daria sempre ao número mais RÁPIDO a medição e deixaria de
  medir o LENTO, que é o que precisa ser detectado.
- ⚠️ **São QUATRO call sites de `registrarEntrega`**, um por caminho de
  ingestão: `persistInboundMessage` e `persistDeviceMessage` (Evolution), o
  webhook da Meta e `instagram/persistir.ts`. O celular pareado CONTA — a
  mensagem passou pelo WhatsApp e voltou pelo webhook, e é por onde o
  escritório mais fala (948 pelo aparelho contra 8 digitadas no CRM). Quem
  criar um 5º caminho de ingestão repete a chamada, senão aquela conexão
  simplesmente deixa de ser medida, sem erro nenhum.
- ⚠️ **`registrarEntrega` NUNCA lança** — é o que torna seguro o `await` no
  caminho da ingestão. `catch` para o que o supabase-js lança (rede) e leitura
  do `error` para o que ele devolve (erro de banco não lança).
- **O limiar é 5 min, folgado de propósito**: nos 10 dias anteriores ao
  episódio o atraso normal ficou em 0,0–0,1 min (segundos) e os episódios
  foram de 9 a 50 min. Não há nada na faixa do meio, então o limiar não
  precisa ser fino — precisa não dar falso positivo.
- ⚠️ **No Meu dia é fonte SEPARADA de "conexão fora do ar"**
  (`conexoesAtrasadas`), nunca somada: o conserto é outro (uma precisa
  reparear, a outra que a sessão reinicie) e a frase "N conexões fora do ar"
  seria FALSA sobre uma conexão de pé que está entregando, só que tarde. E o
  teste ali é `detail === 'lagging'`, não `tone === 'warn'` — `warn` também
  cobre `stale`/`pairing`/`lastError`, que são transitórios e encheriam o
  bloco de alarme que se resolve sozinho.
- ⚠️ **`tone_*` e `detail_*` são chaves MONTADAS** e escapam do portão de
  i18n do CI. `rotulo-da-saude.test.ts` é o pino, e ele COLHE a lista de
  motivos do próprio `toneFor` em vez de digitá-la — lista à mão divergiria
  na primeira mudança da régua, que é o defeito que ele existe para impedir.

⚠️ **O atraso de entrega NÃO é bug do CRM — é UMA LINHA da Evolution 2.4, e
o restart não o conserta (só esvazia a fila).** Uma versão desta nota dizia
"o atraso está entre o WhatsApp e o Baileys" — era a metade errada. Provado
por três vias em 17/09/2026 (o fonte recuperado do `dist/main.js.map`, o
cronômetro no endpoint `chat/fetchProfilePictureUrl`, a assinatura no log):
o `BaileysMessageProcessor` passa todo `messages.upsert` por um `concatMap`
(UM lote por vez; os recibos NÃO passam por ali), e dentro do handler há
`await this.profilePicture(received.key.remoteJid)` — consulta de rede ao
WhatsApp feita com o **LID**, que o servidor não responde (7 de 8 estouram),
enquanto 30 linhas antes a própria Evolution já trocou o LID pelo telefone em
`messageRaw.key.remoteJid`. A Baileys 7 espera `defaultQueryTimeoutMs` =
**60 s**, e a Evolution não o configura. Resultado: **1 mensagem por minuto
por conexão**, nos dois sentidos (o eco do celular pareado paga igual —
intervalos de 120/181/241/362 s no log são múltiplos de 60). Só vira atraso
quando o tráfego passa de 1/min — daí "intermitente e rotativo" desde 10/09,
dia seguinte ao upgrade (a Baileys 7 tornou o LID o endereçamento padrão:
681 mensagens em LID × 0 por telefone na Trabalhista-Jurídico em 48 h). O
campo que a consulta preenche (`profilePicUrl` do `contacts.update`) o CRM
NUNCA lê — a foto vem da 973. **Conserto:**
`docker/evolution-cb/foto-de-perfil-por-telefone-com-teto.patch` (consulta
pelo telefone + teto de 5 s só naquele chamador); o `develop` do upstream em
17/09 ainda tem o defeito. **Verificação:** `docs/PLANO-baileys-7.md`, 5.10 —
o instrumento é `messages.gravada_em` (1003), `gravada_em − created_at` por
mensagem. `POST /instance/restart/<instância>` segue como PALIATIVO (drena
16 min em 1 min, medido em 16/09). ⚠️ **Voltar de versão da imagem está
DESCARTADO por decisão do operador**: a atual foi escolhida para resolver o
"Aguardando mensagem" (mensagens que não chegavam ao cliente).

⚠️ **Mensagem 1:1 em `@lid` SEM telefone (1010, 19/09/2026): não é mais
jogada fora — o telefone sai do ACERVO, ou ela fica RETIDA até ele aparecer.**
`src/lib/whatsapp/sem-telefone/` (`modo.ts` puro; `resolver-lid`, `retidas`,
`historica`, `tardia`, `entregar`, `receber`, `religar`), `ehLidSemTelefone` e
a opção `telefoneResolvido` de `normalizeUpsert`, a tabela
`cb_mensagens_sem_telefone`, a função `cb_assentar_mensagem_historica` e a
fonte `mensagensRetidas` do Meu dia. Plano vivo (causa, medição, riscos,
matriz de testes e os achados da revisão) em `docs/PLANO-lid-sem-telefone.md`.
O que morde código novo:

- ⚠️⚠️ **A causa NÃO é o WhatsApp omitindo o número — é a Baileys.** Provado
  no fonte da 7.0.0-rc13 que roda em produção: quando a mensagem FALHA AO
  DECIFRAR (típico da PRIMEIRA mensagem de contato novo), `sendRetryRequest`
  chama `requestPlaceholderResend(msgKey)` SEM o `msgData`, e a cópia que o
  celular pareado reenvia sai com a chave crua do aparelho: só o LID, sem
  `remoteJidAlt`, sem `addressingMode`, sem `pushName`. O outro chamador
  (mensagem "unavailable") passa o `msgData` e preserva o telefone. O `master`
  do upstream tinha a mesma lacuna em 19/09/2026 — atualizar a biblioteca não
  resolve. Medido em 10 dias: 5 em 3.875 mensagens de cliente; **4 eram
  DUPLICATA** de mensagem que também chegou normal (o `DESCARTADA` do log era
  alarme falso) e 1 era a fala inicial de um lead novo, perdida.
- ⚠️⚠️ **O LID JAMAIS vira `contacts.phone`.** `findExistingContact` casa
  pelos ÚLTIMOS 8 DÍGITOS — é a armadilha do JID de grupo (906) e o motivo do
  descarte original (4 contatos fantasmas em 26/07, um fundido com cliente
  real). O telefone só entra vindo de mensagem REAL já gravada
  (`messages.remote_jid_lid → remote_jid`: 960 LIDs, ZERO com mais de um
  telefone) e `normalizeUpsert` recusa como "telefone resolvido" tudo que não
  termine em `@s.whatsapp.net`. `resolverTelefoneDoLid` confere a CONTA duas
  vezes — no `!inner` da consulta e de novo em JS: o banco falso dos testes não
  lê o texto do `select`, então tirar o `!inner` deixaria tudo verde e o
  PostgREST real devolveria mensagem de outra conta.
- ⚠️⚠️ **TRÊS modos de gravar a recuperada (`modo.ts`, puro).** `nova` = é a
  ÚLTIMA da conversa E tem até 4 min → o caminho normal
  (`persistInboundMessage`/`persistDeviceMessage`), sem mudar uma linha dele,
  motores inclusive. `tardia` = é a última, mas chegou tarde demais para os
  motores → entra como história E a conversa a reflete (`tardia.ts`: reabre se
  estava encerrada, prévia canônica, `last_message_at`). `historica` = alguém
  já escreveu depois dela → só entra no fio. `nova` EXISTE porque a cópia do
  celular e a cópia normal disputam o `UNIQUE (conversation_id, message_id)`:
  se a recuperada nunca disparasse motor e chegasse primeiro, a normal seria
  descartada como duplicata e os motores não rodariam para aquela mensagem.
  `tardia`/`historica` NÃO disparam nada porque o robô leria a mensagem antiga
  DEPOIS das mais novas, a IA responderia a algo de horas atrás e a
  boas-vindas sairia depois de gente já ter respondido. `tardia` EXISTE
  (revisão por duas lentes) porque a cópia do celular depende de o aparelho
  estar acordado: tratada como história pura, a fala de um cliente cuja
  conversa estava ENCERRADA entrava sem reabrir — e o argumento "reabrir
  desfaria um encerramento decidido com informação mais nova" não vale quando
  não existe nada mais novo do que ela. Não saber qual é a última = `historica`.
  ⚠️⚠️ **"A última" é carimbo ESTRITAMENTE maior (`>`), e EMPATE é história**
  (Codex, PR #226, 3ª rodada). O carimbo do WhatsApp vem em segundos, então a
  rajada do cliente empata — e quem chama já tirou a duplicata do caminho, logo
  o carimbo igual é de OUTRA mensagem, que já passou pelos motores. Com `>=`, a
  fala RETIDA da rajada era religada como `nova` depois de a irmã ter iniciado o
  robô, e o menu consumia a fala atrasada como resposta. Nunca `tardia` no
  empate: a irmã do mesmo segundo já reabriu e subiu a conversa.
  ⚠️ O teto é **4 min, não os 5 do alarme da 1002**: `registrarEntrega` mede o
  atraso DEPOIS da espera de 2 s do `jaGravada` e das consultas — há teste
  cobrando a folga.
- ⚠️⚠️ **A garantia de que `historica.ts` e `tardia.ts` não disparam motor é
  ESTRUTURAL** (`historica.chamadores.test.ts`, no desenho de
  `cb-groups/persist.ts`): nenhum dos dois importa motores, funil,
  `followConversationChannel`, `registrarEntrega` (mediria "3 horas de atraso"
  numa conexão sadia) nem `cancelarEsperasPorResposta` (há default-deny; a
  segunda linha de defesa da retomada lê `gravada_em`, que aqui é AGORA, e
  cobre). Só `tardia.ts` cita `reopenClosedConversation`, e só `entregar.ts` a
  chama, no modo `tardia`. ⚠️ E há DEFAULT-DENY de quem chama o caminho normal
  (`src/lib/whatsapp/inbound-store.chamadores.test.ts`): `persistInboundMessage`
  e `persistDeviceMessage` são o pacote inteiro (robô, automações, IA, funil,
  reabertura), e quem os chama dispara tudo por indireção — sem que as outras
  allowlists percebam, porque o chamador não cita motor nenhum.
- ⚠️⚠️ **Mensagem com carimbo ANTIGO engana o gatilho da 972**, que decide por
  ordem de INSERÇÃO: a fala de 13:03 gravada às 13:05, depois da resposta de
  13:04, acendia "em atraso" sobre cliente já respondido — e o eco antigo do
  escritório APAGAVA um atraso verdadeiro. Os dois foram REPRODUZIDOS num
  Postgres 16 com o gatilho real. Por isso toda histórica chama
  `cb_assentar_mensagem_historica`, que desfaz só o que ESTA mensagem estragou,
  soma a não lida só para fala de CLIENTE sem resposta de GENTE depois, e toca
  `updated_at` (é o que faz o realtime corrigir a lista de quem está com a
  caixa aberta). ⚠️⚠️ **A função NÃO é o recálculo canônico** ("a fala de
  cliente mais antiga depois da última resposta de gente" — o que o gatilho de
  mensagem apagada da 972 roda, e o que a 1ª versão copiava). A revisão MEDIU o
  defeito dele: a fórmula não sabe que ENCERRAR limpa a espera, então a
  conversa que terminou com um "ok, obrigado" e foi encerrada — o caso comum —
  ressuscitava aquele "obrigado" como espera de 9 dias na primeira histórica
  depois da reabertura. A função olha só o carimbo DESTA mensagem e a espera
  que havia ANTES do insert (`p_espera_antes`, lida em `historica.ts` — depois
  que o gatilho limpa, o banco não sabe mais o que era). Há pino lendo o SQL
  (sem `max(h.created_at)`, sem `-infinity`) e 20 cenários medidos. ⚠️ O MESMO
  defeito continua no gatilho de mensagem apagada da 972 (fora do escopo desta
  correção). Quem criar outro caminho que grave mensagem com `created_at` no
  passado repete a chamada. ⚠️ **A definição VIGENTE da função é a da 1011**, não
  a da 1010 (que já estava aplicada quando o Codex achou a corrida): no ramo do
  eco POSTERIOR à espera, só conta a fala de cliente que NINGUÉM respondeu depois
  dela — sem isso, a resposta real que chegasse entre a leitura de
  `p_espera_antes` e a função era desfeita, e o cliente atendido aparecia "em
  atraso" (reproduzido num Postgres 16 com a função da 1010). Os pinos do corpo
  leem a 1011. Duas corridas de UMA ida ao banco ficaram de fora, escritas no
  cabeçalho da 1011 (fala de cliente chegando entre a leitura da espera e o
  insert de um eco; ou entre o insert de uma fala já respondida e a função):
  fechá-las pede o insert DENTRO da função, com a linha da conversa travada.
- ⚠️⚠️ **A religação roda DEPOIS de TODOS os itens do lote gravados — nunca
  dentro do laço dos itens da rota** (`paraReligar`, um por LID; Codex, PR
  #226). Religar são ~6 idas ao banco por retida: no meio do laço, o lote que
  destravasse muitas atrasaria — e, num corte do `after()`, PERDERIA — os itens
  seguintes do mesmo lote, a perda que as duas fases da rota existem para
  impedir (mensagem atual primeiro, história depois). Por isso `receberSemTelefone`
  também só DEVOLVE o pedido (`religar`) quando a segunda olhada acha o par; quem
  religa é a rota. Vem antes da fase de anexos (os anexos das religadas entram
  na mesma fila), e `MAXIMO_DE_RETIDAS_POR_VEZ` (10) é o que limita o atraso do
  anexo de uma mensagem atual. Há pino lendo a rota e teste de lote. Os motores
  veem exatamente o que veriam sem a retida, e a retida entra como história.
  ⚠️⚠️ **Essa primeira passada é UMA PÁGINA, e o resto NÃO espera outra
  mensagem daquele LID** (Codex, 3ª rodada): `religarRetidas` diz se `haMais`, a
  rota guarda o LID em `comResto`, e `religarOResto` drena as páginas seguintes
  na SEGUNDA leva da fase de anexos — depois dos anexos do lote, pelo MESMO
  corpo (a fase de anexos virou `for (const leva of ['lote','resto'])`; não há
  cópia dela, e há pino). Esperar "a próxima mensagem" deixava presa a cauda —
  as falas mais RECENTES do lead —, e para quem não escreve de novo isso é
  nunca. É trabalho LIMITADO (`MAXIMO_DE_PASSADAS_DO_RESTO`, 5 → 60 retidas de um
  LID por lote) e para quando uma passada não resolve ninguém: `retidasDoLid` lê
  sempre a partir da mais antiga ainda retida, então sem progresso a passada
  seguinte leria as mesmas linhas. ⚠️ O resto é para quem nunca foi TENTADO:
  falhar não rende passada, e a retida que FALHA segue retida até a próxima
  mensagem daquele LID, como sempre — com UM efeito colateral da leitura "a
  partir da mais antiga": havendo cauda, a que falhou volta na página seguinte
  e é tentada de novo (no máximo uma vez por passada; idempotente pelo
  `jaGravada` e pelo `UNIQUE`). O caso comum (uma página ou menos) não consulta
  nada a mais. ⚠️ **Uma consequência escrita**:
  quando quem destrava é o ECO do escritório (o caso de 18/09), a fala retida
  entra como mensagem de cliente ANTES de o cliente escrever de novo — e a
  mensagem seguinte dele deixa de ser "a primeira" para `first_inbound_message`
  (`persistInboundMessage` conta as linhas `customer` da conversa). É o lado
  escolhido: boas-vindas de robô depois de gente já ter respondido. Quando quem
  destrava é o próprio cliente, a mensagem DELE é gravada antes e o gatilho vale
  como hoje. (Medido em 19/09: nenhuma automação nem fluxo ativo usa esse
  gatilho nesta conta.)
- ⚠️ **Depois de reter, o LID é resolvido DE NOVO** (`receber.ts`): o eco que
  traz o par pode ter sido gravado enquanto a retenção acontecia. Ou o eco
  enxerga a retida, ou a retida enxerga o eco — sem a segunda olhada a fala
  ficaria retida até a mensagem seguinte.
- ⚠️ **A invariante de tudo: se qualquer peça nova falhar, o comportamento é o
  de ANTES** — a mensagem não entra e o log diz `DESCARTADA` (o texto de
  sempre, que é o que o medidor do `PLANO-baileys-7.md` procura). Nenhuma
  função do módulo lança; exceção na chegada cai na RETENÇÃO, nunca no
  descarte (o estouro pode ter vindo DEPOIS do insert, e a religação
  deduplica). Banco sem a 1010 é tolerado — MEDIDO contra a produção em 19/09,
  antes de aplicar: a mensagem normal entra igual, a Fase 1 funciona (a
  histórica entra e o erro da função ausente vai para o log), a retenção vira o
  descarte de hoje, e o aviso da tabela ausente sai UMA vez por processo.
- ⚠️ **`nova` que perde a corrida do `UNIQUE` é `duplicada`, não `falhou`**
  (`entregar.ts` confere se a mensagem está na conversa): o caminho normal
  devolve `null` nos dois casos, e responder `falhou` mandava RETER uma
  mensagem já entregue — o Meu dia avisava "mensagem retida" por até 7 dias
  sobre conversa completa.
- ⚠️ **O anexo da retida é baixado pela conexão DA RETIDA** (`channelId` no
  item de `semAnexo`, lido com `'channelId' in pendente`, nunca `??`): o LID é
  da conta do WhatsApp da pessoa, então a fala do número A pode ser destravada
  por mensagem no número B, e a mídia só existe na instância do A. Conexão
  APAGADA (`null`) = o download é PULADO: `resolveEvolutionMedia` com canal nulo
  cairia no canal PADRÃO da conta, que nunca viu a mensagem. Item normal não
  carrega a chave — é o que o mantém no canal do webhook, e há pino lendo a rota.
- ⚠️ **O payload cru é conteúdo de cliente e existe só enquanto é preciso**:
  `CHECK ((situacao = 'retida') = (payload IS NOT NULL))`; ao entregar ou
  marcar duplicada ele é apagado. Tabela FECHADA ao navegador (zero policy,
  REVOKE das duas metades); o Meu dia lê por rota, e de lá saem só a CONEXÃO e
  a HORA — nunca conteúdo, telefone ou LID (a rota é de qualquer membro). O log
  de falha do insert leva só código e mensagem: o `details` do PostgREST traz a
  linha recusada, com o texto do cliente. ⚠️ Retida que NUNCA religa guarda o
  payload sem prazo, e sem vínculo com ficha (apagar o contato não a alcança) —
  decisão pendente do operador; o registro conta o que foi recuperado ou
  retido, não a duplicata que sai calada na chegada.
- ⚠️ **No Meu dia, `retidas: null` é "não consegui conferir", nunca zero**
  (`lerRetidas`, puro): falha SÓ dessa consulta não vira 500 — derrubaria junto
  Calendly e webhooks, que responderam. A janela é `DIAS_DE_RETIDA_NA_TELA`
  (7), a mesma constante na rota e no texto; a retida antiga continua
  religável, só deixa de ocupar a tela.
- ⚠️ **O fio ABERTO continua acrescentando a mensagem do realtime no FIM — de
  propósito.** Uma versão desta correção inseria pelo carimbo
  (`inserirNaOrdem`) e foi REVERTIDA na revisão: mudava o comportamento de
  TODA mensagem atrasada (lote drenado fora de ordem, cruzamento de 1–2 s com
  um envio do CRM), e na conversa aberta a não lida é forçada a zero e o
  auto-scroll só mantém o fim — a mensagem inserida acima da dobra passaria
  despercebida. No fim, a recuperada aparece como a última bolha, com a hora
  dela, e vai para o lugar do carimbo ao recarregar.
- **Limites aceitos, escritos no plano**: retida que o cliente APAGOU ou EDITOU
  antes de religar entra como foi enviada; citação feita a uma retida fica sem
  vínculo; a histórica não emite o webhook de saída `message.received`; o eco
  de um envio feito PELO CRM não destrava retida (sai no `jaGravada` antes do
  bloco de religação, e `send-message.ts` não grava `remote_jid_lid`) — ela
  espera a próxima mensagem do cliente ou um eco do celular; cópia histórica
  OU TARDIA que chega ANTES da cópia normal da mesma mensagem ganha o `UNIQUE`,
  e a normal é pulada sem rodar motor (para a tardia basta chegar primeiro e ter
  mais de 4 min — o celular do cliente offline atrasando a retentativa);
  ⚠️ "alguém escreveu depois" conta MÁQUINA: a consulta da última mensagem
  (`entregar.ts`) não olha quem escreveu, então fala de cliente seguida só de
  robô, disparo ou automação entra como `historica` — e, com a conversa
  ENCERRADA, sem reabrir (revisão final, plano 6.9; inalcançável em 20/09/2026,
  quando nenhuma máquina escrevia em conversa de cliente nesta conta; passa a
  valer com sequências e régua ligadas — o refino, `tardia` × `historica` pela
  última mensagem do cliente ou de GENTE, é decisão pendente do operador); o
  payload da retida é apagado ANTES de o anexo dela ser baixado — download que
  falha na religação tem o destino do anexo normal que falha (recuperação à mão
  pela Evolution), embora ali existisse cópia durável das chaves (idem, 6.9);
  a decisão do modo NÃO é atômica — mensagem
  mais nova gravada por OUTRO webhook nos ~100 ms entre olhar "qual é a última"
  e o insert faz a `nova` passar pelos motores depois dela (a mesma desordem
  que duas mensagens normais quase simultâneas já têm hoje: a ingestão não
  serializa por conversa, e fechar isso é travar a conversa dentro de
  `persistInboundMessage`, o caminho quente); o PAR fica durável no insert de
  dentro de `persistInboundMessage`, mas a rota só anota "religar este LID"
  quando a função VOLTA (depois dos motores) — processo que morre nesse vão
  deixa a retida retida até a próxima mensagem daquele LID, visível no Meu dia
  (Codex, 4ª rodada; aceito: aqui `maxDuration = 60` é decorativo e a morte só
  vem de deploy ou queda, numa janela de segundos, e a Evolution não reentrega
  porque o 200 sai ANTES do `after()`. ⚠️ Numa hospedagem que CORTE o `after()`
  isso deixa de ser raro — o conserto de verdade é anotar o par antes dos
  motores, dentro do caminho quente); áudio histórico pode ser recusado pela
  transcrição se alguém a pedir nos segundos antes de o anexo chegar (a janela
  de 2 min de `transcrever.ts` conta do `created_at`); lead retido que nunca
  mais escreve e a quem ninguém responde pelo celular fica retido. Só a Fase 3
  (patch na imagem da Evolution: `lidMapping.getPNForLID` antes da troca da
  linha 1668 — consulta local, sem rede) resolveria na hora; decisão do
  operador: fora do escopo.
- **`gravada_em` (1003) da recuperada é AGORA** — é verdade, o CRM gravou tarde
  —, então ela aparece como atraso grande em `gravada_em − created_at`. Numa
  medição do atraso de entrega, exclua o que está em
  `cb_mensagens_sem_telefone.message_id`.

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
  ⚠️ **A formatação (N, I, S, </>) sobe para a linha dos botões no celular
  QUANDO CABE** (pedido do operador, 15/09/2026): com `formatacaoNaLinha`, os
  marcadores aparecem ali a partir de 390 px (`min-[390px]:max-sm:`) e a
  linha própria some. A condição existe porque a conta é de pixel: a 390 px
  sobram 366 px, e a linha com os quatro marcadores ocupa 358. O botão de
  modelos do número oficial (`mostraModelos`) toma esse espaço, e as telas
  abaixo de 390 px não o têm: nesses casos a formatação volta à linha
  própria. Quem acrescentar botão a essa linha refaz a conta, senão gravar,
  agendar e enviar descem para uma terceira linha.
  ⚠️ **A etiqueta da hora agendada tem linha própria no celular**
  (`etiquetaEmLinhaPropria` do `SeletorDeHorario`, ligada só no compositor
  principal): ao lado do relógio ela não cabia a 390 px — medido em
  15/09/2026, o botão de agendar descia para uma linha a mais, com ou sem a
  formatação. Com `order-first` ela empata com a caixa de texto, e a ordem do
  código (a caixa vem antes) a põe logo abaixo dela; `basis-full` a leva a
  uma linha inteira. Escolha do operador: a peça de segurança do agendamento
  fica mais visível, e só enquanto há hora escolhida.
- ⚠️ **Filho direto do `DialogContent` precisa de `min-w-0` quando carrega
  texto com `truncate`.** O `DialogContent` é `grid`, e item de grid nasce
  com `min-width: auto`; `truncate` é `nowrap`, então o intrínseco do filho
  vira a largura do TEXTO INTEIRO numa linha — medido no dialog de executar
  automação: card com 448px e conteúdo com 1124px, a busca atravessando a
  tela. O `min-w-0` no wrapper direto devolve o clamp e o `truncate` volta a
  funcionar. (Primo do caso `<ScrollArea>`/flex acima — mesma família:
  `min-width: auto` anulando o limite do pai.)

⚠️ **O teclado do celular (14/09/2026): a conversa fica ACIMA dele, e o
ajuste só liga dentro do fio.** `src/lib/celular/teclado.ts` (puro, com
teste), `src/hooks/use-tela-acima-do-teclado.ts` (montado na casca), a regra
dos 16 px no fim do `globals.css` e o `data-acima-do-teclado` na raiz do
`message-thread.tsx`. Nasceu do relato do operador com o CRM instalado no
iPhone: ao tocar na caixa de mensagem o cabeçalho da conversa subia para fora
da tela e só voltava rolando, não havia como recolher o teclado, e, recolhido,
a tela ficava "desconfigurada". O que morde código novo:

- ⚠️⚠️ **A altura da casca e da caixa de entrada sai de `--altura-visivel`,
  com queda em `100dvh` — nunca `h-screen`/`100vh`.** `100vh` não encolhe com
  o teclado: o iPhone empurra a página inteira para cima até a caixa
  aparecer, e o cabeçalho (o nome do cliente e o número por onde a resposta
  sai) vai junto. O hook escreve a variável com a área visível, e a casca
  DESCE junto com o empurrão (`relative top-[var(--deslocamento-visivel)]`,
  com `visualViewport.pageTop`); `window.scrollTo(0, 0)` só roda ao SAIR do
  ajuste. Tela nova de altura cheia usa a mesma variável. ⚠️ `pageTop`, NUNCA
  só o `offsetTop`: este é contado da janela e fica em zero quando o iPhone
  revela a caixa ROLANDO a janela, e a casca ficaria acima da área visível
  pela rolagem inteira (Codex, PR #219). Pelo mesmo motivo o hook relê na
  rolagem da janela, que não dispara o `scroll` do `visualViewport`.
- ⚠️⚠️ **A regra NÃO compara a área visível com `window.innerHeight`.** A
  primeira versão (PR #214) só agia com 120 px de diferença, e o print do
  operador no iPhone no dia seguinte (15/09/2026) mostrou a tela exatamente
  como antes do ajuste. A causa mais provável — não medida, porque o
  navegador do computador não tem teclado virtual — é a janela encolher junto
  com o teclado no app instalado. Hoje, num aparelho de toque e com o foco no
  fio, a casca mede SEMPRE a área visível: sem teclado ela é a tela inteira.
  ⚠️ `top` e nunca `transform` na casca: transform faria todo `fixed` de
  dentro dela se posicionar pela casca. Há pinos em `teclado.test.ts`.
- ⚠️⚠️ **O ajuste só age com o foco DENTRO de `[data-acima-do-teclado]`**
  (hoje, só o fio). Fora dele — formulário de outra tela, diálogo, o painel
  do contato no celular — o empurrão do iPhone é o que revela o campo acima
  do teclado, e desfazê-lo esconderia o campo em que a pessoa digita. Marcar
  outra área é decisão a testar no aparelho.
- ⚠️ **O hook lê no `requestAnimationFrame`**: no `focusout` o foco ainda não
  chegou ao próximo campo, e ler ali diria "saiu da conversa" numa simples
  troca de campo. Pinça de zoom (`visualViewport.scale` diferente de 1) não
  ajusta nem desfaz, senão brigaria com o dedo.
- ⚠️ **Encolher o fio pela base esconde as últimas mensagens**, porque o
  `scrollTop` fica onde estava: um `ResizeObserver` no contêiner mantém no fim
  quem estava colado no fim. A dependência é a CONVERSA, porque o contêiner
  só existe com conversa aberta.
- ⚠️⚠️ **Letra de 16 px em todo campo de aparelho de toque**, numa regra FORA
  de camada no `globals.css`: abaixo disso o iPhone amplia a tela ao tocar no
  campo e não desfaz. Sem camada ela vence as utilidades do Tailwind (`text-sm`
  mora em `@layer utilities`); movida para `@layer base`, perderia para o
  `text-sm`, e o zoom voltaria sem erro nenhum. A consulta é a de
  `MIDIA_DE_TOQUE`, e há teste.
- **No toque, o retorno pula linha e só o botão envia** (`enterEnvia`,
  decisão do operador): o teclado do celular não tem Shift+Enter. A dica da
  caixa troca para `typeMessagePlaceholderTouch`, que não fala de Shift+Enter.
- **Arrastar a conversa para BAIXO recolhe o teclado** (`arrastoRecolheTeclado`,
  o gesto do WhatsApp, pedido do operador); para cima não, porque é o gesto de
  quem continua escrevendo. Mora no `onTouchMove` do contêiner, junto do
  `liberarSalto`.
- ⚠️ **O navegador do computador não testa nada disso**: a emulação de celular
  não abre teclado virtual. A verificação é no aparelho, depois do deploy.

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

⚠️ **Voltar da conversa pelo HISTÓRICO, no celular (14/09/2026).**
`src/lib/inbox/voltar-no-celular.ts` (puro, com teste) e a página do inbox.
Pedido do operador, com o CRM instalado no iPhone: voltar da conversa para a
lista arrastando da borda esquerda, como no WhatsApp. O que morde código
novo:

- ⚠️⚠️ **O gesto do iPhone e o botão voltar do Android andam no HISTÓRICO, e
  a caixa de entrada abria a conversa com `replace`** — sem passo nenhum, o
  gesto SAÍA da caixa de entrada em vez de fechar a conversa. Agora, no
  celular (`!ehDesktop`), abrir a conversa a partir da lista é `router.push`
  (`navegacaoAoAbrir`), no clique da lista E na conversa criada pelo botão
  "nova conversa". No computador continua `replace`: lá lista e conversa
  convivem, e um passo por clique faria o voltar do navegador percorrer o
  dia inteiro de conversas.
- ⚠️ **Não é arrasto feito à mão em JavaScript**: ele disputaria a borda da
  tela com o gesto do próprio sistema. É dar ao sistema o passo que o gesto
  desfaz.
- ⚠️⚠️ **Quem fecha a conversa no gesto é um ouvinte de `popstate`**
  (`aoAndarNoHistorico`): URL sem `?c=` com conversa na tela, fecha; URL com
  outra conversa, reabre pelo caminho do deep link (ref limpa +
  `resyncToken`). Num ouvinte, e não num efeito sobre `deepLinkConvId`,
  porque `setState` síncrono no corpo de efeito é erro do React Compiler — e
  `replace` não dispara `popstate`, então trocar de conversa não passa por
  ali.
- ⚠️ **O botão voltar da tela DESFAZ o passo (`router.back()`)** quando a
  abertura o criou (`abriuComPassoRef`). Com `replace`, sobrariam duas
  entradas da lista, e o gesto seguinte "não faria nada" antes de sair da
  caixa de entrada. Recarregar a página zera a ref, e aí o botão volta ao
  `replace` de sempre.
- **`limparConversaAberta` é o que o botão e o `popstate` têm em comum**, e
  não mexe na URL. Rodar duas vezes (o `router.back()` também dispara o
  ouvinte) é inofensivo.
- ⚠️ **O navegador do computador testa a mecânica** (histórico, `popstate`,
  push × replace); o arrasto em si, só no aparelho.

⚠️ **O TÍTULO DO CARD é o NOME da pessoa, e ele acompanha a ficha (1007).**
`src/lib/deals/titulo-do-card.ts` (puro, com teste), a coluna
`deals.titulo_fixado_em` e o gatilho `cb_titulo_do_card_segue_a_ficha` em
`contacts`. Pedido do operador (19/09/2026), olhando o Kanban: o card dizia
"Bancário - Comercial — 558599704949" e a ficha, "Vanessa Bezerra". O que
morde código novo:

- ⚠️ **O título nasce com o NOME e nada mais** (`routeContactToPipeline`). O
  prefixo "<conexão> — " saiu, e a justificativa dele (identificação de
  reserva para depois do `ON DELETE SET NULL` do contato) não se pagava:
  medido, **549 dos 962** cards traziam o TELEFONE no lugar do nome — o que
  acontece SEMPRE que o escritório aborda primeiro pelo celular pareado,
  porque a ficha nasce com `name || phone` e o `pushName` de uma mensagem
  nossa (o nome do próprio advogado) é descartado de propósito — e **95**
  nomeavam "Comercial - Bancário", rótulo que a conexão não usa desde 02/09.
  O card já mostra a conexão numa pílula. Sem nome na ficha, `contactName`
  JÁ é o telefone, então nenhum dos 5 chamadores precisou mudar.
- ⚠️⚠️ **Quem mantém o título em dia é um GATILHO no banco, nunca código.**
  `contacts.name` tem escritores demais — Evolution, Meta, API v1, CSV,
  ficha, formulário, passo de automação, Calendly, Asaas — e espelhar em TS
  é garantir que um deles fique de fora. É a lição da 1000.
- ⚠️⚠️ **Mas ele NÃO segue a ficha sempre, e a exceção é o coração da
  feature.** Título que ainda NÃO tem nome (é o telefone) é trocado por
  qualquer nome de verdade; título que JÁ identifica alguém só muda quando o
  nome novo foi ESCOLHIDO (`nome_fixado_em`: Calendly, Asaas, gente
  digitando). Nasceu de uma medição feita antes de escrever o código: **26**
  cards guardavam o nome do CONTRATO ("Mamedes Candido de Oliveira Junior",
  "José Almino de Araújo") enquanto a ficha já tinha o apelido do perfil
  ("@Macol", "J.A.A.") — o Asaas cria a ficha com o nome completo e a
  primeira mensagem do cliente o substituía, e o card congelado era a última
  cópia viva do nome bom. Seguir a ficha cegamente rebaixaria os 26, que é o
  oposto do que a feature existe para fazer.
- ⚠️ **A ficha criada pelo Asaas nasce com o nome FIXADO** (decisão do
  operador, 19/09/2026): `criar-ficha.ts` grava a marca da 999, e o acervo da
  1007 marcou as 263 fichas `vinculo_origem = 'criada'` e devolveu os 27
  nomes já rebaixados. ⚠️ SÓ as `criada`: as ligadas por telefone/CPF já
  existiam com o nome do WhatsApp, e carimbar o nome do contrato nelas
  trocaria um nome que ninguém pediu para trocar. E só com `nome_fixado_em`
  nula — nome escolhido à mão fica.
- ⚠️ **`deals.titulo_fixado_em` é gravada por quem DIGITA o título** (lápis
  do card, POST e PATCH da v1), com a régua de `escritaDoNomeManual`: **só
  quando o título MUDOU**. O formulário reenvia todo campo em cada
  salvamento, então regravar sempre congelaria o card que ninguém batizou —
  e, com a tela aberta durante um rename do gatilho, devolveria o título
  ANTIGO já fixado. Teste estrutural default-deny:
  `titulo-do-card.chamadores.test.ts` (todo escritor de `deals.title` declara
  se FIXA, DERIVA ou RESPEITA).
- ⚠️ **O Calendly continua vencendo o título escrito à mão** (decisão do
  operador, 19/09/2026, reafirmando a de 14/09): `renomearCardAberto` NÃO
  olha a marca. Quem "consertar" isso está revertendo a decisão.
- **Só o card ABERTO mais recente** — a régua do Calendly (um contato é um
  telefone; o card fechado de meses atrás pode ser de outra pessoa). O alvo é
  escolhido ANTES de olhar a marca: com o recente fixado e um antigo solto,
  nada é renomeado — renomear o antigo seria mexer num card sobre o qual a
  mudança de nome nada diz.
- **Renomear não deixa rastro**: a trilha da 912 não guarda título, e um
  UPDATE só de `title` não dispara nem a trilha nem a fila do funil (as duas
  são `AFTER UPDATE OF pipeline_id, stage_id, status`). O `set_updated_at`
  dispara — o acervo da 1007 empurrou 654 cards para o topo de "negócios
  recentes" do Painel por um dia.
- ⚠️ **NENHUM título gerado carrega mais o prefixo da conexão (1009).** A 1007
  deixou de fora os 275 cards sem nome em lugar nenhum, com o argumento de que
  ali o rótulo da conexão era a única informação do título. Visto no quadro, o
  argumento caiu: são justamente os leads mais RECENTES — quem ainda não
  respondeu —, então ocupavam o topo de "Contato Avulso" e o operador
  continuava vendo uma parede de "Bancário - Comercial — <número>". Hoje sobra
  o telefone puro, e o gatilho troca por nome quando o cliente escrever. A
  conexão continua na pílula do card. (Decisão do operador em 19/09/2026,
  depois de ver a tela — ele havia recusado isto duas vezes antes de ver.)
- ⚠️⚠️ **"Novo contato" (`TITULO_SEM_NOME`) NÃO é nome, e o gatilho tem de
  saber disso (1008).** É o rótulo de reserva do card que nasce sem nome
  NENHUM — a coluna é NOT NULL —, e para `cb_nome_para_titulo` ele parece
  nome de gente: sem o caso especial, o card nasceria "Novo contato" e
  ficaria assim PARA SEMPRE, porque a régua acima leria "este título já
  identifica alguém" e o nome que chegasse depois é automático. Incidência
  ZERO hoje (nenhuma conta do Instagram conectada, nenhuma ficha sem nome), e
  é justamente o tipo de armadilha que acende sozinha no dia da primeira
  conexão. O texto vive em DOIS lugares — a constante em TS e a comparação no
  gatilho —, com pino cobrando os dois; trocá-lo exige migration nova. Quem
  digitar "Novo contato" à mão fica protegido pelo `titulo_fixado_em`.
  (Achado do Codex no PR #225.)
- ⚠️ **No passo `create_deal`, título LITERAL do autor nasce FIXADO; título
  com `{{…}}` fica solto.** "Caso trabalhista" é texto escolhido para todo
  card que aquela automação criar, e o gatilho o trocaria pelo nome da pessoa
  na primeira renomeação deliberada da ficha. `{{vars.agendamento_nome}}` — o
  único em produção — é derivado de quem está do outro lado e TEM de
  continuar acompanhando a ficha. Título vazio também fica solto: ali o
  gatilho é a única chance de o card ganhar um nome. (Achado do Codex no PR
  #225.)
- ⚠️ **No INSTAGRAM o chamador cai no `@usuario`** (`persistir.ts`, via
  `identidadeDoContato`): a ficha de lá não tem telefone para servir de
  reserva, e sem a queda quem escreve antes de o perfil ser lido abriria um
  card chamado "Novo contato". No WhatsApp a queda não é necessária — a ficha
  nasce com `name || phone`.

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
- **A regra do `@lid` do 1:1 NÃO vale em grupo.** Lá o LID sem telefone não
  vira contato (desde a 1010 a mensagem fica RETIDA até o número aparecer —
  antes era descartada); aqui o remetente é desnormalizado em
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

⚠️⚠️ **APAGAR CONTATO não apaga o que aponta para ele — 14 tabelas ficam com
o ponteiro pendurado, e `deals` é uma delas.** Medido no catálogo em
19/09/2026 (`pg_constraint`, as 25 FKs que referenciam `contacts`). São dois
grupos, e os dois mordem:

- **CASCADE (vai junto, some sem aviso):** `conversations` — e, por ela, TODAS
  as mensagens —, `contact_tags`, `contact_custom_values`, `cb_tasks`,
  `cb_conversation_notes` e `cb_automation_reminders`.
- **SET NULL (fica órfão):** `deals`, `cb_lead_events`, `cb_calendly_eventos`,
  `cb_meetings`, `cb_reunioes_transcritas`, `cb_asaas_clientes`,
  `cb_asaas_regua_envios`, `cb_automation_events`, `cb_webhook_eventos`,
  `automation_logs`, `automation_pending_executions`, `broadcast_recipients`,
  `flow_runs` e `notifications`.

O sintoma visível é o negócio: card com `contact_id` nulo **renderiza em
branco no Kanban** e não abre conversa nenhuma. Os invisíveis são piores —
`cb_lead_events` é a trilha que o funil comercial lê, e `cb_calendly_eventos`
é o log que diz de quem era o agendamento.

⚠️⚠️ **E `merge_duplicate_contacts` (022/0922) NÃO cobre as tabelas `cb_*`.**
Ela reaponta nove — `conversations`, `cb_conversation_notes`, `deals`,
`broadcast_recipients`, `automation_logs`, `automation_pending_executions`,
`contact_tags`, `contact_custom_values` e `flow_runs` (esta só quando o status
não é `active`) — e então apaga o perdedor. Tudo o que nasceu depois dela fica
de fora: a trilha, o Calendly, as reuniões, as transcrições, o Asaas, a fila de
automação, os webhooks e os avisos viram órfãos, e **as tarefas e os lembretes
do perdedor são APAGADOS** pelo CASCADE. Ela é `SECURITY DEFINER` sem
argumento — roda sobre TODAS as contas de uma vez, agrupando por
`(account_id, phone_normalized)` EXATO, então não enxerga as duas grafias do
nono dígito (é o que `variantesDoNonoDigito` resolve). Hoje só o
`service_role` executa (o `REVOKE` da 913/915 fechou `anon` e `authenticated`).

**A receita de fusão, então, é:** reapontar TODAS as referências do perdedor
para o sobrevivente (as 14 do SET NULL mais as 6 do CASCADE, cada uma com a
sua regra de conflito — `contact_tags` e `contact_custom_values` têm único por
`(contato, X)` e precisam do `NOT EXISTS`) → mover os campos que faltarem na
ficha sobrevivente → apagar o negócio duplicado EXPLICITAMENTE, se não for
para reaproveitá-lo → só então apagar o contato. Quem acrescentar tabela com
`contact_id` acrescenta a linha na função de fusão no MESMO PR; não há teste
estrutural cobrando isso ainda.

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
  RPC UMA vez para `[desde do período anterior, hoje)`** e recorta os dois
  resumos no modo escolhido (`resumoNoModo` × 2 + `comparar` — por período no
  padrão; ver "DOIS MODOS DE CONTAGEM", abaixo). Funil sem etapa em
  `lead` → estado "configure" (abre Gerenciar funil); período sem coorte →
  zeros com a nota, NUNCA o "configure". Os cinco baldes da situação
  aparecem, "fora do funil" inclusive. Gráfico de barras = Tremor
  vendorizado; o de área é recharts DIRETO (`grafico-de-entradas.tsx`, cores
  por classe Tailwind com `stroke=""`/`fill=""`, o truque do Tremor) — não
  vendorizar mais um Tremor para isso. Números em pt-BR fixo
  (`apresentacao.ts`), como `currency.ts`.
- **A SAÚDE (Fase 3, `saude.tsx` + `mapa-de-calor.tsx` +
  `grafico-de-conversao.tsx`) são doze MESES numa carga só** — por período no
  padrão (o que aconteceu em cada mês) e coortes mensais pelo mês de entrada
  no modo sob demanda. A cor do mapa é RELATIVA À LINHA (D6) e a escala é
  calculada SEM as células pequenas (`< COORTE_PEQUENA`, 5): 100% sobre um
  lead dominaria o ano inteiro. Célula pequena mostra o número apagado com
  o motivo no `title`; mês sem dado é "—", nunca 0%. ⚠️ A régua da célula é
  por MODO (`linhasDoMapa(…, modo)`): na coorte, as entradas do mês; por
  período, o DENOMINADOR da taxa (as reuniões do mês, para reunião →
  proposta) — pelas entradas, um mês com 0 entradas e 5 contratos de leads
  antigos ficava apagado e um mês com 6 entradas e 1/1 entrava na escala com
  100% (revisão do PR #224).
- ⚠️ **"Em andamento" no mapa é a coorte com lead SEM DESFECHO, não o mês
  corrente** (Codex, PR #122). Agosto com 6 abertos ainda muda em setembro,
  e setembro com tudo resolvido já é final — marcar o calendário tirava o
  aviso justamente de quem precisava dele. A marca é a CONTAGEM visível
  ("6 em aberto") sob o rótulo do mês, e sai de `CoorteMensal.emAberto` —
  SÓ no modo por entrada: por período ela é 0 e não aparece (mês passado é
  final).
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
- ⚠️⚠️ **DOIS MODOS DE CONTAGEM desde 18/09/2026, e o padrão é POR PERÍODO**
  (`src/lib/funil/por-periodo.ts`, puro e testado; `use-modo-de-contagem.ts`;
  `seletor-de-modo.tsx`). Pedido do operador: "se eu tive 10 reuniões
  marcadas no mês passado e 5 contratos fechados esse mês, quando eu olhar
  para as métricas desse mês eu preciso ver os 5 contratos". A coorte
  ("por mês de entrada") continua, sob demanda. O que morde código novo:
  - **Por período conta a PRIMEIRA vez que o negócio alcançou o degrau**
    (`FatosDoNegocio.alcancouEm`, regra 7 da trajetória): bater duas vezes
    em "Reunião Agendada" conta uma vez, e o degrau pulado ganha a data de
    quem o alcançou. Perda é datada pelo COMEÇO da estadia atual em perda
    (`perdidoDesde`, regra 8 da trajetória: o primeiro passo de perda depois
    do último passo com degrau) — NUNCA por `naEtapaDesde`, que é a última
    entrada na etapa atual e movia a perda de agosto para setembro quando o
    escritório reclassificava No Show → Perdido (revisão do PR #224); quem
    voltou da perda não é perda em mês nenhum, e quem se perdeu de novo conta
    na segunda vez. Dinheiro = contrato alcançado no período que continua
    fechado. Sem avanço/em andamento/fora do funil são a foto dos que
    ENTRARAM no período — iguais nos dois modos. Tabela campo a campo na
    seção 3.5 do plano; pinos em `por-periodo.test.ts`. A preferência mora em
    `localStorage` (`wacrm:pipelines:funil:modo`, parse por `lerModo`).
  - ⚠️⚠️ **A taxa por período é razão de FLUXO e PODE PASSAR DE 100%**
    (5 contratos de reuniões de agosto ÷ 2 reuniões de setembro). Decisão do
    operador: mostrar como é, com a nota na tela — nunca `Math.min(1, …)`.
    Por isso os dois gráficos de taxa ganharam teto redondo e marcas
    rotuladas (`eixoDasTaxas`): o recharts não corta o dado (sem
    `allowDataOverflow` ele ALARGA o domínio), mas deixava o ponto acima de
    100% numa faixa sem marca nem grade, e o Tremor inventava as marcas.
  - ⚠️⚠️ **"Custo dos perdidos" multiplica os ENTRANTES do período já
    perdidos (`perdidosDosEntrantes`), nunca `perdidos`.** Por período
    `perdidos` é fluxo — perda de lead de QUALQUER mês — e, vezes o custo por
    lead deste período, o card passava do próprio investimento (R$ 250 de
    perdidos sobre R$ 100 investidos; revisão do PR #224). Na coorte os dois
    números são o mesmo.
  - ⚠️ **"Primeira vez" exige a trajetória INTEIRA**, que a RPC já devolve
    para todo negócio com evento no intervalo. Truncar o trajeto ao período
    faria a reentrada contar de novo.
  - `coortesMensais` exige o `modo` (obrigatório de propósito); `emAberto` só
    existe na coorte — por período o mês passado é final.
  - `funilDeContagens` e `emAbertoDe` (`coorte.ts`) são a montagem ÚNICA das
    taxas e dos baldes, usada pelos dois modos: cópia divergiria e a tela
    leria taxas calculadas de jeitos diferentes conforme o seletor.
  - A origem do evento NÃO é filtrada: evento `retroativo` (a carga da Kommo)
    conta na data que carregar. É o contrato escrito no plano ("Contrato com a
    migração da Kommo").
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
- ⚠️⚠️ **O nome do AGENDAMENTO vira o nome da ficha e o título do negócio
  aberto, e fica FIXADO (999, decisão do operador em 14/09/2026 — era a D5,
  antes aceita como "sobrescrito pela próxima mensagem").** O motivo é
  IDENTIDADE, não completude: o cliente muitas vezes fala pelo celular da
  EMPRESA, o perfil do WhatsApp diz o nome da empresa, e quem vai à reunião
  é a pessoa. Nunca segura o aviso ao advogado: falha vira aviso no
  `detalhe` do evento. O que morde:
  - ⚠️⚠️ **A FICHA antes da primeira automação, o CARD depois** (`processar.ts`).
    A ficha precisa estar renomeada quando a automação fala
    (`{{contact.name}}`) — e só muda se alguma automação VAI RODAR: é o gancho
    `antesDeExecutar` de `dispararAutomacoes`, chamado depois dos recortes de
    canal, gatilho e etapa. Fixando antes do disparo, automação que escuta o
    evento mas exclui o contato por escopo deixava ficha e card renomeados e
    travados com o evento dizendo "sem_automacao" (Codex, PR #208). Quem
    precisar de "só se algo rodar" usa o gancho, nunca uma cópia dos recortes. O card NÃO: contato sem card — o caso comum da ficha
    que nasce do agendamento — só ganha card DENTRO da automação
    (`create_deal`), com o título que o passo configurou, que é livre.
    Renomeando antes, o UPDATE não achava card nenhum e o card novo nascia com
    outro nome, com o evento dizendo "disparado" (Codex, PR #208). Card criado
    depois de um "Aguardar" continua fora do alcance (o agendador retoma fora
    do processamento).
  - ⚠️⚠️ **Sem `contacts.nome_fixado_em`, o nome durava até a próxima
    mensagem do cliente** — que costuma vir logo depois de agendar. TRÊS
    caminhos AUTOMÁTICOS gravavam o nome do perfil do WhatsApp sempre que
    diferia do salvo (o comportamento do upstream): `inbound-store.ts`
    (Evolution), o webhook da Meta e `resolve-conversation.ts` (envio por
    telefone da API v1). Os três levam `.is('nome_fixado_em', null)` DENTRO
    do UPDATE (a busca do contato não traz a coluna), e há teste estrutural
    com o conjunto EXATO de escritores de `contacts.name`
    (`src/lib/contacts/nome-fixado.chamadores.test.ts`, que reprova com a
    guarda do webhook da Meta removida E com a marca tirada da ficha —
    medido). ⚠️ O teste enxerga toda escrita em `contacts` com chave
    `name`, chave COMPUTADA, espalhamento ou objeto montado, e cada uma é
    `respeita`/`grava`/`sem-marca` com o motivo escrito. A 1ª versão só via
    objeto LITERAL e deixou passar o `update_contact_field` do motor
    (`[cfg.field]`), que é o passo 0 da automação ativa do Calendly
    (revisão do PR #208).
  - ⚠️ **A marca protege contra o AUTOMÁTICO, não contra gente — e gente
    também FIXA** (decisão do operador, 14/09/2026). Painel da conversa, ficha
    e formulário gravam a marca junto com o nome por `marcaDoNomeManual`, e o
    teste estrutural cobra que TODO escritor de nome ou respeite a marca ou a
    grave. ⚠️⚠️ **A marca só muda quando o NOME mudou**: a ficha e o
    formulário regravam o nome em todo salvamento, e sem essa régua corrigir
    só o e-mail fixaria de tabela o nome que veio do WhatsApp. Nome APAGADO
    solta a marca (a próxima mensagem volta a preencher). O formulário e o
    "Nova conversa" (`/api/cb/conversas/abrir`) também fixam na CRIAÇÃO.
    ⚠️⚠️ **E nome igual ao carregado NÃO é regravado**
    (`escritaDoNomeManual`): a tela abre sobre uma FOTO da ficha, e se o
    agendamento trocou o nome enquanto ela estava aberta, salvar só a empresa
    devolvia o nome antigo — FIXADO, porque a marca não mudava (revisão do PR
    #208). Fora da regra, SEM decisão do operador: o PATCH e a criação da API
    v1, a importação de CSV (tela e disparo), a ficha criada pelo Asaas e por
    `destinatario.ts` — escritas `sem-marca`, declaradas no teste.
  - ⚠️⚠️ **O passo `update_contact_field` de NOME grava FIXADO, e valor que
    não é nome não sobrescreve** (`engine.ts`). A automação é escrita
    deliberada de quem a configurou. Sem isto, o passo 0 da automação do
    Calendly (`nome = {{vars.agendamento_nome}}`) gravava o telefone digitado
    no campo de nome por cima de um nome já fixado, e a marca antiga o
    CONGELAVA; e um "Atualizar nome" vindo do Typebot durava até o pushName
    seguinte. Vazio também não apaga mais o nome.
  - ⚠️ **Só UM negócio ABERTO é renomeado — o mais recente**: um contato é
    um telefone, e no celular da empresa o card fechado de meses atrás pode
    ser de OUTRA pessoa. E o CRM permite mais de um aberto (o formulário de
    Funis não confere): a régua é a de `negocioAlvo` (`engine.ts`), senão o
    título que o advogado escreveu num card de outro funil sumia sem registro
    (revisão do PR #208). Mexer só no `title` não dispara a trilha da 912 nem a fila do
    funil (os dois olham `pipeline_id`/`stage_id`/`status`).
  - **Número não é nome** (`nomeParaFixar`, `src/lib/contacts/nome-fixado.ts`,
    a mesma régua da ingestão da Evolution): fixar "5583…" tiraria da ficha o
    nome de verdade para sempre. O detalhe do evento diz por que não mudou.
  - **Consequência aceita**: duas pessoas que agendam pelo MESMO telefone
    trocam o nome da ficha a cada agendamento.
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

⚠️ **Asaas → vínculo dos clientes e espelho das cobranças (992/994): o
Asaas é a fonte, o CRM só lê.** `src/lib/asaas/` — `cliente` (HTTP),
`leitura`, `inadimplencia`, `vinculo`, `nome-aproximado`, `listas`,
`aplicar`, `criar-ficha`, `sincronizar`, `espelho`, `conexao`, `cartao`;
rotas em `/api/cb/asaas/*`, cartão em Integrações (`asaas-card.tsx` +
`asaas-listas.tsx`). Plano vivo em `docs/PLANO-integracao-asaas.md` (as
decisões D1–D20 e os números da conta real). O que morde código novo:

- ⚠️⚠️ **TODAS as tabelas do Asaas são FECHADAS ao navegador** (RLS ligada,
  zero policies, `REVOKE` de `anon` e `authenticated`), e é assim que tem de
  ser: a chave cifrada, o CPF/CNPJ (só sai MASCARADO, pela rota do admin) e a
  dívida de quem nem tem ficha moram lá. Toda tela lê por rota em service
  role, que devolve também o que o membro não enxergaria sozinho — se está
  conectado e se a leitura é FRESCA (`leituraFresca`, duas voltas do laço
  lento). Sem isso "em dia" seria afirmação sobre dado parado.
- ⚠️⚠️ **`vista_vencida_em` NUNCA é reescrito enquanto a cobrança continua
  devida.** É a PRIMEIRA vez que o espelho viu a cobrança vencida, carimbada
  num UPDATE cercado por `IS NULL` — fora do upsert, de propósito. É o que a
  régua de cobrança (Fase 3) usa como dia-alvo quando o Asaas marca vencida
  tarde, e o que faz "ligar a régua não é retroativo" valer. "Está vencida"
  é o `status` do Asaas, nunca `vencimento < hoje` (C7: o instante da virada
  não é documentado). ⚠️ UMA exceção (Codex, PR #206): a cobrança que VOLTA
  a "a vencer" (renegociada — PENDING de novo, outro vencimento) perde o
  carimbo, para a próxima vencida ganhar o dela e a régua rearmar — a paga
  MANTÉM (histórico).
- ⚠️ **O upsert de clientes leva SÓ metadados** — nunca `contact_id`,
  `vinculo_origem`, `contatos_recusados` nem `candidatos` (a lição do tl;dv:
  o que já é conhecido mantém o que tem). O upsert das cobranças, idem: o
  PostgREST só escreve as colunas presentes, e o dublê de teste imita isso.
- ⚠️ **A elegibilidade da regra automática é `contact_id IS NULL AND
  (vinculo_origem IS NULL OR IN ('telefone','cpf','email','criada'))`,
  nunca `<> 'desvinculado'`**: com a coluna nula (todo cliente novo) a
  comparação dá NULL e exclui o cliente sem erro nenhum. O UPDATE do vínculo
  é cercado pelas MESMAS condições — gente que ligou no meio do ciclo vence.
  `manual` órfão (contato apagado) e `desvinculado` são de gente: a regra
  não toca.
- ⚠️ **Só telefone (com a irmã do nono dígito), CPF já ligado e e-mail
  LIGAM.** Sufixo de 8 e nome aproximado só SUGEREM (`candidatos`, D5) —
  medidos na conta real: zero casos cada um como vínculo, e ligar errado
  mostra a dívida de um na conversa de outro. As cercas: contato já ligado a
  outro cliente de documento DIFERENTE, nome de gente sem nenhum token em
  comum (a esposa que paga a conta do marido), telefone igual ao de uma
  conexão da própria conta, e `contatos_recusados` (desligado por gente
  nunca volta — nem pela CRIAÇÃO da ficha: o número é o mesmo e o índice
  único de `contacts` impede outra).
- ⚠️⚠️ **O CRM CRIA a ficha do cliente com telefone e sem contato (D2,
  decisão do operador em 12/09/2026)** — só o contato, SEM conversa, com
  `user_id = accounts.owner_user_id` (`criar-ficha.ts` está no manifesto de
  `dono-duravel.test.ts`), o nome do Asaas, e a etiqueta `asaas` por INSERT
  DIRETO em `contact_tags` — nunca por `tag-events.ts`, que dispararia o
  gatilho `tag_added` das automações 264 vezes de uma vez. Medido em
  12/09/2026: 79,5% dos clientes do Asaas não tinham ficha. ⚠️ A ficha
  criada é contato como outro qualquer (entra em "todos os contatos" do
  disparo); a etiqueta é o que deixa excluí-la. `findExistingContact` é o
  PORTÃO anti-duplicata, não o vínculo: ficha cujo número só bate pelo
  sufixo vai para "Para confirmar".
- ⚠️ **O ciclo PROVA A IDENTIDADE da chave antes de gravar** (relê os três
  `cus_…` vistos mais RECENTEMENTE e, se todos derem 404, cruza uma página
  de `/customers` com o espelho; nada cruzando = `conta_trocada`) e
  `conectarAsaas` faz o mesmo com espelho existente. Sem isso, a chave de
  outro CNPJ zeraria o aviso de todo mundo no ciclo seguinte. Sondas FIXAS
  (o primeiro id da tabela) travariam a integração para sempre se aqueles
  clientes fossem apagados no Asaas. O 404 de UMA cobrança na reconciliação
  só vira `deleted` com o cliente dela respondendo 200.
- ⚠️⚠️ **O ciclo tem CADEADO (`cb_asaas_config.sincronizando_desde`, 995),
  no molde do claim do Calendly**: cron, "Sincronizar" do cartão e a
  primeira sincronização depois de conectar podiam correr JUNTOS (e no
  deploy `start-first` há dois processos Node vivos) — dois ciclos com
  `visto_em` diferentes se atropelam na varredura de clientes. Reivindicar é
  `UPDATE … RETURNING` cercado (`filtroDoCadeadoLivre`); cerca de posse
  (`.eq('sincronizando_desde', vistoEm)`) nas escritas de fim de ciclo;
  `em_curso` não é erro (o cron conta como adiada, o cartão mostra
  "sincronizando desde"). ⚠️ O recolhimento (10 min) olha o BATIMENTO
  (`last_sync_attempt_at`, que o ciclo avança a cada passo — ENTRE as
  páginas de cada `listarTudo` (`aCadaPagina`), depois de cada listagem, a
  cada 20 releituras/fichas), não o começo do ciclo: uma conta com dezenas
  de páginas pode passar de 10 min viva, e recolher um ciclo vivo é
  justamente o que o cadeado impede. ⚠️ **Batimento que não casa a linha
  ABORTA o ciclo** (`cadeado_perdido`): a posse mudou de mãos (recolhimento
  depois de um sumiço do banco, ou um "desconectar"), e seguir gravaria no
  espelho de outro dono sem cerca — a exceção atravessa `listarTudo` pelo
  `aCadaPagina`. No SUCESSO a tentativa volta ao início do ciclo
  (`last_sync_attempt_at = vistoEm`), senão o cartão inventa uma "última
  tentativa" a partir do último batimento — e o fechamento confere o
  ROWCOUNT do update cercado: zero linhas é `cadeado_perdido`, nunca `ok`. ⚠️ **`desconectarAsaas` TOMA o
  cadeado antes de apagar** (409 `em_curso` se um ciclo está no meio),
  renovando o batimento na MESMA escrita: o ciclo já tem o cliente HTTP na
  mão e continuaria gravando no espelho apagado — e misturaria as contas se
  outra fosse conectada em seguida.
- ⚠️ **`vencidas_listadas_em` só é carimbado quando TODA cobrança listada
  pôde ser guardada**: cliente novo que o PRAZO não deixou ler (`adiados`)
  segura o carimbo — senão `leituraFresca` afirmaria "em dia" sobre uma
  vencida que nem entrou no espelho. Cliente que o Asaas não devolve (404,
  `semLinha`) NÃO segura: as cobranças dele não têm como ser guardadas, e a
  listagem está completa no que dá para guardar.
- ⚠️⚠️ **A varredura de "cliente que sumiu da listagem" tem PISO**
  (`listagemSuspeita`): listagem VAZIA com espelho vivo é SEMPRE suspeita;
  parcial é suspeita quando somem mais de 20% das vivas **E** mais de 5 —
  as duas condições de propósito (o absoluto impede conta pequena de travar
  por churn normal; a fração impede conta grande de aceitar listagem pela
  metade). Suspeita = nada é marcado `deleted` e `last_full_sync_at` NÃO é
  carimbado, para o ciclo seguinte relistar. Sem o piso, uma listagem vazia
  (soluço do Asaas) marcaria os 439 como apagados, o cartão diria "0
  clientes" e a prova de identidade do ciclo seguinte (que só sonda clientes
  vivos) ficaria desarmada.
- ⚠️⚠️ **Ficha APAGADA pelo administrador não é recriada em origem
  NENHUMA**: `criar` só quando `vinculo_origem IS NULL`. A FK é `ON DELETE
  SET NULL (contact_id)` e a origem sobrevive — com a guarda só em
  `criada`, o cliente de origem `telefone` cujo contato foi apagado
  (inclusive por pedido de exclusão LGPD) ganhava ficha nova 15 minutos
  depois, para sempre. A regra ainda RELIGA pelo telefone à ficha
  sobrevivente de uma fusão.
- ⚠️ **A etiqueta refeita é só a PENDENTE** (`etiqueta_pendente`, gravada
  quando o upsert de `contact_tags` devolveu `{ error }` — o Supabase NÃO
  lança). Derivar "faltou etiquetar" da ausência em `contact_tags` devolvia
  a cada ciclo a etiqueta que uma pessoa tirou de propósito — e ela existe
  justamente para o operador excluir essas fichas de um disparo.
- ⚠️ **A ficha que perde a corrida para gente FICA.** Entre a reconferência
  de elegibilidade e o vínculo cercado cabe um "Ligar"/"Ignorar" do
  administrador; a primeira versão apagava a ficha recém-criada, e
  `conversations.contact_id` é CASCADE — uma mensagem do cliente naquela
  janela iria junto. Fica um contato a mais (com a etiqueta), nunca um a
  menos; o log diz o que houve.
- ⚠️ **Sandbox NUNCA neste banco**: o `.env.local` aponta para o MESMO
  projeto Supabase da produção e a config é uma linha por conta — conectar
  o sandbox no preview trocaria a conexão da produção. `ehChaveDeSandbox`
  recusa `$aact_hmlg_`; o sandbox só se testa com `fetchFn` falso.
- ⚠️ **A chave vai no cabeçalho `access_token` (não é Bearer), nunca na
  URL; `User-Agent` é obrigatório e passa por `agente()` (ASCII); GET com
  corpo é 403; 404 também significa "id de outra conta"; a cota é da CONTA
  do Asaas, sem cabeçalho `RateLimit-*` (medido) — o 429 encerra o ciclo
  sem retentar.** Toda mensagem de erro passa por `semSegredo()`.
  ⚠️⚠️ **O bloqueio por cota também chega como 403** (medido em produção em
  14/09/2026: "Seu acesso foi temporariamente bloqueado por exceder o
  limite de requisições…"), o MESMO status da falta de permissão.
  `codigoDoErro` recebe a DESCRIÇÃO e lê o 403 de bloqueio como `limite`
  (casada sem acento; nenhum `code` de cota é documentado); o resto segue
  `sem_permissao`. Lido como permissão, o cartão mandava mexer na chave, o
  passo dos Parcelamentos se calava fingindo falta da permissão e o webhook
  ia a estado terminal. Se o Asaas trocar a frase, o 403 de cota volta a
  cair em `sem_permissao` — sem regressão, só a leitura antiga.
  ⚠️ **Toda mensagem de `AsaasError` começa pelo PEDIDO** (`GET /payments →
  403: …`, montado em `pedir()`), SEM a query — filtro de busca pode levar
  dado do cliente. Em 14/09 o log do bloqueio não dizia qual pedido o levou,
  e é o caminho que separa a prova de identidade em `/customers` da listagem
  de `/payments` quando se investiga quem estourou o limite.
- ⚠️ **`cb/asaas` está no laço LENTO do `docker-stack.yml`, e o CI não relê
  o `command` do agendador**: só vale depois de `docker stack deploy` manual
  na VPS, com o `crm.env` carregado (as três linhas). Até lá, o botão
  "Sincronizar" do cartão é o único ciclo. O rodízio é por
  `last_sync_attempt_at`, carimbado ANTES de qualquer trabalho. (Deploy
  feito em 13/09/2026: o agendador roda desde 12:56 BRT com `cb/asaas` no
  laço lento — conferido na VPS em 14/09.)
- **Toda leitura do banco PAGINA** (`contacts` já passa de 700; a importação
  do Atlas, avisada pelo operador, passa disso). As listas do cartão são
  montadas em memória por `listas.ts` (puro) e paginadas na rota — a
  situação de cada cliente (`ligado`/`confirmar`/`sem_ficha`/`ignorado`) é
  DERIVADA da linha, nunca coluna própria.
- ⚠️⚠️ **O AVISO NA CONVERSA (Fase 1b, PR #203) lê por DUAS rotas para
  qualquer membro** — `GET /api/cb/asaas/resumo` (a caixa inteira: contato →
  parcelas devidas) e `GET /api/cb/asaas/contato/[id]` (a aba) —, sem CPF,
  em service role, e erro é 500, NUNCA `{}`: um objeto vazio seria lido como
  "ninguém deve". No navegador, **`null` de leitura é "não sei", nunca "em
  dia"**: o ícone da linha cala, a faixa cala e o filtro "Inadimplentes" é
  NEUTRALIZADO (`ContextoDosFiltros.inadimplentes: Set<string> | null`,
  campo OBRIGATÓRIO — a régua de `recorteDeEtapaConfiavel`). Conectado SEM
  ciclo inteiro também é `null` (`cicloCompleto` em `espelho.ts`:
  `vinculo_completo_em >= vencidas_listadas_em` — a listagem é carimbada no
  passo 4 e o vínculo roda no 7, então entre os dois o mapa é PARCIAL e a
  janela se repete a cada ciclo; a 996 é esse marcador, carimbado no passo
  8. ⚠️ Ele NÃO espera a criação de ficha adiada pelo teto/prazo: cliente
  sem ficha não tem conversa a esconder, e a versão que esperava
  neutralizava o filtro da conta inteira durante uma importação — medido
  no dublê pela revisão independente do PR #203): um conjunto vazio ali
  faria uma visão salva esconder a caixa inteira. A régua da neutralização
  é UMA (`motivoDaNeutralizacao`), para o recorte e para a dica do painel. ⚠️ Leitura ANTIGA (espelho parado) NÃO neutraliza: é a MESMA
  régua do ícone, e medido em 13/09 com 11 h sem ciclo a neutralização
  deixava 15 ícones na lista e um interruptor que "não fazia nada" — a tela
  diz "dados do Asaas de …" (faixa, aba e painel de filtros) em vez de
  calar; e a FRESCURA é derivada no navegador pelo relógio
  (`leituraAindaFresca`), nunca só pelo booleano da resposta, que envelhece
  na tela (a recarga que falha retém a anterior, marcada como não fresca).
  A aba só diz "nenhuma parcela vencida" com leitura fresca E sem parcela
  em conferência; sem isso diz que não sabe. `null` ≠ `false` também no
  painel de filtros: "Asaas desconectado" só com `false`.
- ⚠️ **UMA régua para ícone, faixa e filtro** (`dividasPorContato`/
  `dividaDoContato`, `src/lib/asaas/aviso-na-conversa.ts`, pura e testada;
  a aba reparte por `separarParcelas`, com o relógio da tela). Cópia
  divergiria e o operador leria "o ícone sumiu". O parse das rotas é campo a
  campo, nunca `as` — corpo estranho vira `null`, não vazio.
- ⚠️ **`useInadimplencia` é montado UMA vez na página do inbox** e repassado
  por prop à lista e ao fio (irmãos — a página é o único caminho); recarrega
  no `resyncToken`, no evento `cb:asaas-mudou` e a cada 5 min com a aba
  visível. **`useCobrancasDoContato` carimba o dono da resposta (`{ de }`)
  e DERIVA `carregando`** — a armadilha do efeito passivo, sétima aparição;
  `AbaCobrancas` exige `carregando`/`falhou` como `aba-arquivos`. ⚠️
  `conectado` é da CONTA e sobrevive à troca de contato: a aba Cobranças
  some SÓ com `false`, nunca com `null` — esconder por ignorância afirmaria
  "não há Asaas", e esconder no `carregando` faria a aba piscar a cada
  cliente.
- ⚠️ **O interruptor "Inadimplentes" mora no PAINEL de ajustes, não na
  barra** (ela já ocupa ~290 dos 296 px do `lg`; um 5º chip a estouraria),
  só é OFERECIDO com o Asaas conectado (ou já ligado por uma visão salva,
  para dar como desligar), fica FORA de `limparOrfaos` e é campo de
  `FiltrosDoInbox` como os outros (`AMOSTRAS` cobra). Grupo nunca casa
  (não tem contato). Cor em par claro/escuro, como o cartão de falha.
- ⚠️⚠️ **O AVISO NA HORA (webhook, Fase 2, 997) é autenticado pelo
  CABEÇALHO, nunca pela URL.** `POST /api/cb/asaas/webhook/[token]`: o
  token da URL só diz de QUAL conta é a entrega (índice único na config); a
  credencial é `asaas-access-token`, o valor que o CRM gerou e informou ao
  Asaas ao criar o webhook, guardado CIFRADO (`webhook_auth_token`) e
  comparado em tempo constante (`tokenConfere`) — não há HMAC no Asaas, é
  igualdade. 404 e 401 são as únicas RECUSAS; com URL e token certos, o que
  não é 200 são os três 500 (config, token ilegível, INSERT do evento), de
  propósito — o Asaas retenta por ~13 h e um soluço do banco não pode perder
  o evento. **Limite do balde — POR CONTA, contado só depois do cabeçalho
  conferir — responde 200 `adiado`** (só 200 conta como entrega; um 429
  contaria como falha e ajudaria a interromper a fila — 15 falhas seguidas
  param tudo; chaveado pelo token da URL, quem tivesse a URL calaria as
  entregas legítimas), e a reentrega responde 200 `duplicado` pelo UNIQUE
  `(conta, id do evento)` de `cb_asaas_eventos`. O corpo é AVISO (D8): só `payment.id` ou
  `accessToken.name` são lidos, e a cobrança é RELIDA na API em `after()`
  (`processarEvento`, sob um semáforo de 4 — uma fila religada despeja dias
  de eventos de uma vez, e a conta tem 50 GET simultâneos divididos com o
  outro sistema do escritório). Cobrança paga que o espelho NÃO conhece é
  `ignorada` (`deveEntrarNoEspelho`): o espelho não é cópia do Asaas.
- ⚠️⚠️ **A criação SEM gesto de gente vive SÓ no cron (`cuidarDoWebhook`,
  em `cron/route.ts`); conectar (a primeira sincronização) e o botão do
  cartão também criam, e os três gestos do cartão (Ativar, Religar,
  Desativar) só valem a partir do PRÓPRIO host público (`podeCriarDaqui`).** O `.env.local` do preview carrega a URL da
  PRODUÇÃO: criar dali registraria no Asaas um endereço que só atende
  depois do deploy, e 15 entregas falhadas interrompem a fila com três
  e-mails. Estado NULO = nunca tentado (o cron cria no ciclo seguinte);
  `desligado`/`ausente`/`sem_permissao`/`erro` esperam gente (o cron não
  insiste no que uma pessoa ou o Asaas recusou); rede e cota não mexem no
  estado. ⚠️ O host do PEDIDO sai de `x-forwarded-host`/`host`
  (`hostDoPedido`), nunca de `request.url`: o `standalone` da produção sobe
  com `HOSTNAME=0.0.0.0` e o Next monta `request.url` a partir disso — com a
  URL, o botão nasceria travado em produção também (revisão do PR #204). O
  token da URL é gravado ANTES do POST, cercado por `IS NULL`, para a URL ser
  determinística (retentativa e concorrente reencontram o webhook pela URL
  em vez de criar um segundo). `obter()` do cliente devolve `null` SÓ no 404
  — 2xx sem corpo LANÇA — e o 404 de uma cobrança só vira `deleted` com o
  CLIENTE dela respondendo 200 (a cerca da reconciliação). ⚠️ A releitura da
  RÉGUA (`reconfirmar`, varrer-regua.ts) marcava apagada SEM essa cerca até
  14/09/2026: hoje as duas usam a mesma, e os dois 404 juntos param a
  varredura como `conta_trocada`, sem travar nada. O balde da rota é
  POR CONTA e só depois do cabeçalho conferir. Reaproveita antes de criar (id nosso → PUT; mesma URL → PUT; só
  então POST) — trocar a chave não pode dobrar as entregas. Fila
  interrompida é religada UMA vez pelo cron (`webhook_religado_em`); a
  segunda vira `interrompido` ("precisa de atenção"), e só um gesto de gente
  (Religar ou Ativar) zera o marcador. ⚠️ **Rede e `limite` NUNCA viram
  estado que espera gente — nem na criação, nem no RELIGAR**
  (`conferirWebhook`): a falha é gravada com o estado ANTERIOR, o
  `webhook_religado_em` não é carimbado e o ciclo seguinte tenta de novo.
  Antes, toda falha do religar virava `interrompido`, e o cartão afirmava "o
  CRM já religou uma vez" sobre um pedido que nem chegou ao Asaas (Codex, 4ª
  rodada do PR #206). Somado ao 403 de cota lido como `limite`, é o que
  impede um soluço de cota de travar o aviso na hora. O estado `erro` (o Asaas recusou a
  criação) é retentado pelo cron uma vez por dia (`RETENTAR_ERRO_MS`): a
  primeira criação real acontece depois do merge, e uma lista de eventos
  recusada não pode travar a integração até alguém clicar. Desconectar APAGA o webhook no Asaas antes de
  apagar a config (senão o Asaas insiste por horas numa rota 404);
  `webhookNaoApagado` manda apagar no painel. Evento de chave só conta
  quando `accessToken.name` é o `chave_nome` da config (os eventos de chave
  são da conta inteira) → `status = 'erro'` com `chave_desabilitada`/
  `chave_expirada`/`chave_apagada`.
- ⚠️⚠️ **A RÉGUA DE COBRANÇA (Fase 3, 998) SÓ DISPARA PELA VARREDURA.**
  `src/lib/asaas/regua.ts` (puro) e `varrer-regua.ts` (I/O, no cron do
  Asaas depois do sync e do webhook). Os gatilhos `asaas_cobranca_vencida`
  (marco em `dias_de_atraso`) e `asaas_cobranca_vence_hoje` casam SÓ com o
  `automation_id` do contexto (`triggerMatches`) — o disparo por tipo
  rodaria a de 5 dias junto com a de 1; `runAutomationById` (o botão
  "Executar automação" e o passo `run_automation`), o diálogo e
  `POST /api/automations/engine` recusam. A varredura reconfirma cada
  parcela no Asaas ANTES da trava, cria a conversa da ficha sem conversa
  (dono durável, canal do passo, sem pino), passa `{ automation_id,
  conversation_id, channel_id, vars }` e mede o desfecho no `automation_logs`
  DEPOIS do disparo — por isso grupos do mesmo contato saem em SEQUÊNCIA.
  ⚠️ A releitura é de TUDO que vai para a mensagem (as que cruzam o marco,
  as demais devidas e a que vence hoje), não só das que cruzam — senão uma
  parcela paga entre a sincronização e o disparo sai como "em aberto" no
  texto (Codex, 2ª rodada do PR #206) — e a linha FRESCA passa de novo
  pelas cercas da seleção (devida, entrou na régua, pagável, cruzando ESTE
  marco hoje). A janela (até 18:00) é reconferida com o relógio VIVO antes
  de cada trava (`deps.relogio`; `janelaFechou`), e o log de um disparo
  nunca responde por outra trava do ciclo (`logsConsumidos`) — dois
  clientes do Asaas no mesmo contato saem em sequência (Codex, 3ª rodada).
  ⚠️⚠️ **A automação que MANDA é escolhida de novo DEPOIS da releitura**,
  sobre o `cruzaram` RELIDO e pelo mesmo comparador da seleção
  (`porMaiorMarco`, exportado de `regua.ts` — uma cópia só), com a conexão
  conferida de novo com ELA; daí em diante travas, janela, canal, contexto e
  `medir()` usam essa, nunca `grupo.automacao`. Com a do grupo montado sobre
  o espelho, a parcela do maior marco paga entre a sincronização e o
  disparo deixava a escolhida sem parcela: tudo virava `absorvida`, nada
  saía e a trava do marco menor ficava gasta (23505 no ciclo seguinte, e
  amanhã o dia-alvo já passou). A escolhida com a conexão caída é pulada SEM
  travar — nunca cai para uma automação menor, que mandaria o texto errado.
  `dias_de_atraso` sai das parcelas da automação que manda, a mais antiga à
  frente (na ordem do banco, o marco de 30 dias dizia "3 dias"). (Codex, 4ª
  rodada do PR #206.)
  ⚠️ **O lembrete relido passa pela MESMA cerca da seleção
  (`cabeNoLembrete`: vencimento nos dias do lembrete, não só o status)** — a
  PENDING de hoje que o Asaas PRORROGOU mandava "vence hoje" com a data
  futura e travava o lembrete do dia novo. E o "vence hoje" da COBRANÇA é
  `venceNoDia` (vencimento hoje OU nos dias que o lembrete cobre hoje): na
  segunda o lembrete cobre sábado e domingo, e a PENDING do sábado de quem
  tem marco na segunda sumia do dia. Os dias vêm do `somente_dias_uteis` DA
  AUTOMAÇÃO do lembrete, nunca `true` fixo (em dias corridos, a do sábado já
  foi lembrada no sábado, e somá-la repetia a trava `vence_hoje` — 23505 no
  grupo; pino "dias CORRIDOS"). (Codex, 4ª rodada do PR #206.)
  ⚠️⚠️ **Mas quem responde "esse lembrete já saiu?" é a TRAVA, nunca a
  configuração de hoje** (`semLembreteTravado`): lembrado o sábado em dias
  corridos e ligado "só dias úteis" antes de segunda, a segunda volta a
  cobrir o sábado — a parcela entrava de novo no INSERT do grupo, o 23505
  recusava a cobrança do marco (ou o lembrete da parcela de segunda) e o
  `continue` lia "outro processo pegou" o dia inteiro. As parcelas com trava
  `vence_hoje` para aquele vencimento saem da mensagem e da trava nos DOIS
  caminhos; no do lembrete a conferência vem ANTES da releitura, para não
  gastar GET no Asaas a cada ciclo com quem já foi lembrado (Codex, PR #212).
  A mensagem sai pelo caminho do ROBÔ (`dispararAutomacoes` →
  `engineSendText`): não reabre encerrada, não zera `aguardando_desde`, não
  mexe em não lidas (D16; pino default-deny em `regua.chamadores.test.ts`).
- ⚠️⚠️ **A trava é do MARCO, e é UM INSERT com várias linhas.**
  `cb_asaas_regua_envios` com `UNIQUE (cobranca_id, tipo, marco, vencimento)`:
  23505 em qualquer parcela recusa o GRUPO inteiro (dois processos Node
  vivos no deploy `start-first`) — por isso `agruparPorCliente` entra cada
  parcela UMA vez (pelo MAIOR marco que cruzou hoje; duas automações do
  mesmo marco ou a mesma parcela em dois marcos punham a mesma chave duas
  vezes no INSERT, o 23505 era lido como "outro processo pegou" e ninguém
  enviava — Codex e revisão adversarial, PR #206), e grupo sem `reservado`
  não dispara; a trava vale para a automação que enviou
  E para a que foi absorvida no mesmo dia (`absorvida`), e o lembrete usa
  `tipo = 'vence_hoje'`/`marco = 0`. `reservado` há mais de 10 min é órfã
  (sem log → apagada; com log → `incerto`, nunca reenviada). ⚠️ A órfã sem
  log sai JUNTO com as `absorvida` do MESMO INSERT (mesma conta, cliente e
  automação e o MESMO `criado_em` — o `now()` é um por transação), e só
  DEPOIS de a própria órfã sair: sozinhas, elas davam 23505 ao grupo do
  ciclo seguinte e nada saía o dia inteiro; se o dono fechou a trava no meio,
  a cerca `resultado = 'reservado'` não apaga nada e a `vence_hoje` absorvida
  FICA (é ela que impede o lembrete em dobro). Falha ao apagar as irmãs vira
  só `console.warn` (revisão da 4ª rodada do PR #206). ⚠️ **`enviado` é
  QUALQUER passo que entrega ao contato com sucesso**
  (`PASSOS_QUE_FALAM_COM_O_CONTATO` em `regua.ts`: mensagem, mídia, botões,
  lista, modelo), em `resultadoDoLog` e portanto na reconciliação do
  `na_fila` — um ramo de condição pode rodar só a mídia, e a trava fechava
  `barrada`/`falhou` sobre cliente cobrado, fora do intervalo mínimo.
  `send_to_number` (avisa OUTRO número) e `send_webhook` ficam fora, e por
  isso não é o `PASSOS_DE_ENVIO` da retentativa (Codex, 4ª rodada do PR
  #206). ⚠️ **`na_fila`
  existe por causa da RETENTATIVA do motor (PR #205)**: um envio que a
  Evolution RECUSA (4xx) volta para a fila e roda de novo em 30 s / 5 min,
  FORA da varredura — a trava guarda `automation_log_id` e a varredura
  seguinte reconcilia pelo log (`enviado`/`falhou`/`barrada`; 1 h sem
  desfecho → `incerto`). `enviado`, `na_fila` e `incerto` CONTAM como
  cobrado para o intervalo mínimo (`regua_intervalo_dias`, D11) e o "uma
  por cliente por dia" — mandar de menos é o lado seguro. Os nove valores
  do CHECK são `RESULTADOS_DA_TRAVA` (`regua.ts`), rotulados por chave
  montada na aba e cobrados nos dois dicionários.
- ⚠️ **Ligar a régua NÃO é retroativo (D13): só parcela vista vencida
  DEPOIS de `regua_ativada_em` entra** (`entrouNaRegua`), e o dia-alvo é
  `vencimento + marco` ou o dia em que o espelho a viu vencida (C7), até 3
  dias de tolerância — o atrasado antigo espera o próximo atraso. Fim de
  semana e feriado nacional fixo empurram para o dia útil seguinte; a
  janela vai de `hora_envio` às 18:00. **Lembrete e marco no mesmo dia =
  UMA mensagem** (D17 revista): a cobrança leva `{{vars.vence_hoje_detalhe}}`
  e o lembrete é travado como absorvido. **A negativada entra** (D6
  revista). Interruptor e intervalo: `PUT /api/cb/asaas/regua/interruptor`
  (ROWCOUNT; SÓ a transição desligado → ligado carimba `regua_ativada_em`,
  por UPDATE cercado em `regua_ativa = false` — um PUT repetido empurrava a
  fronteira da D13 para a frente; Codex, 3ª rodada), NÃO o PUT da config.
- ⚠️ **A conexão do `send_message` da régua FALHA FECHADA** (D19):
  `validate.ts` exige `channel_id` em todo `send_message`/`send_media`, a
  MESMA em todos (a varredura só confere a do primeiro — `primeiroEnvio`,
  que entra nos ramos de condição), e recusa qualquer "Aguardar" nos dois
  gatilhos; a varredura pula a automação cuja conexão não resolve na conta
  e a candidata cuja conexão está desconectada (sem travar; a SONDA que
  falha conta igual e é dita no log — `sondaFalhou`). ⚠️ "Viva" é a
  sonda em `ok`, ou `warn` SÓ por causa do webhook (`vivaParaEnviar`):
  `pairing`/`stale`/`lastError` não provam envio, e travar o marco por
  elas deixava a trava em `falhou` sem o ciclo seguinte poder tentar. E a
  cerca é de conexão por QR CODE (`kind = 'evolution'`, `connected`):
  Instagram e Meta no passo dariam `falhou` determinístico consumindo a
  trava. A ficha ligada SEM telefone (só Instagram, 989) é pulada sem
  travar (`semTelefone`). ⚠️ **"Tem telefone" é o predicado do REMETENTE do
  robô** — `isValidE164(sanitizePhoneForMeta(telefone))`, o de
  `engineSendText`, conferido antes do desvio de transporte (vale para a
  Evolution) —, nunca régua própria: com ">= 8 dígitos", o número com zero
  na frente ou os 18 dígitos de um JID de grupo passavam na varredura, eram
  recusados no envio e a trava fechava `falhou` sem nova chance depois de o
  telefone ser corrigido. Pino estrutural em `regua.chamadores.test.ts`,
  lendo os dois fontes SEM comentários (Codex, 4ª rodada do PR #206).
  ⚠️ **Nos dois gatilhos, `validate.ts` recusa em qualquer escopo
  `run_automation`/`run_flow` e `send_template`/`send_buttons`/
  `send_list`.** A entrega pela FILHA fica no log dela (a trava vira
  `barrada`), a filha pode ter "Aguardar" e retomar sem reconfirmar o
  pagamento, e a cerca de conexão do motor olha o gatilho DA FILHA; e os
  passos só-Meta, fixados num número oficial, saíam por conexão que a
  varredura não sondou e que o motor não cerca (a trava que falha fechado
  mora só no `send_message`) — sem conexão, falhavam sempre e gastavam a
  trava. ⚠️ Vale só na ATIVAÇÃO e na edição: automação da régua gravada
  antes da regra não é pulada pela varredura — conferir antes de ligar a
  régua (revisão da 4ª rodada do PR #206). O seletor de conexão do passo aparece SEMPRE nos
  gatilhos da régua, mesmo com uma conexão só (`reguaDoAsaas` no contexto
  do construtor) — senão a automação criada à mão nunca ligava; a
  ativação exige pelo menos um `send_message` (é dele que vem a conexão —
  só `send_media` ativava e era pulada em todo ciclo; o `enviado` da trava,
  desde a 4ª rodada, vem de qualquer passo que entrega ao contato); e o motor, nesses gatilhos, lança em vez de cair no padrão
  (`resolveEngineChannelPreferring` cai em silêncio no canal da conversa —
  numa cobrança isso é o link de pagamento saindo por outro número).
  "Assinar como" (`automations.assinatura_personalizada`, D18) é prefixo
  de todo `send_message` da automação, por `nomePersonalizadoParaAssinar`,
  sob o interruptor `assinatura_ativa` da conta.
- ⚠️ **A lista de exceção (D21) é por CLIENTE DO ASAAS, não por contato**
  (`cb_asaas_clientes.regua_desligada`, com quem e quando): a régua agrupa
  por cliente, e o mesmo contato pode ter a pessoa e a empresa. O sino está
  na aba Cobranças e nas listas do cartão; a planilha do operador foi
  marcada por script fora do repositório. ⚠️ **Deploy DEPOIS da 998**: as
  rotas `/api/cb/asaas` (o cartão), `/api/cb/asaas/resumo` e
  `/api/cb/asaas/contato/[id]` selecionam `regua_*`/`regua_desligada` por
  nome (`lerConfigDoEspelho`/`lerClientes`) — sem as colunas o `resumo`
  responde 500 e, pela régua da Fase 1b (`null` = "não sei"), o ícone, a
  faixa e o filtro "Inadimplentes" apagam para a CONTA INTEIRA, não só o
  cartão do admin; e o cron registra a régua como interrompida a cada
  ciclo. (Aplicada em 13/09/2026 ANTES do merge.)

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

- ⚠️⚠️ **NÃO é um Dialog do projeto, e a PÁGINA não pode renderizar por
  trás.** Desde 12/09/2026 o fundo é o app de verdade — menu e cabeçalho —,
  DESFOCADO e `inert` (pedido do operador); o cartão vem num overlay com
  `backdrop-blur`. O que NÃO monta atrás é a PÁGINA e o
  `PresenceHeartbeat`, e é por isso que o filho da porta é uma FUNÇÃO
  (`children(entradaPendente)`): montada, a página devolveria os efeitos que
  a porta existe para segurar — um deep link `/inbox?c=X` abriria o fio e
  zeraria as não lidas da conversa para a conta inteira. Consequência
  escrita: enquanto o Meu dia está aberto a pessoa aparece OFFLINE para os
  colegas (só o heartbeat publica presença) — são segundos. E o fundo leva
  `aria-hidden` junto com o `inert`, senão o Tab alcança o menu atrás do
  cartão.
- ⚠️⚠️ **Trava de MÃO ÚNICA, decidida uma vez por carga de página.** A regra
  (`precisaMostrar`: sessão de login nova OU primeiro acesso do dia) roda no
  inicializador do `useState` da porta e só FECHA. Nunca reavaliar por evento
  de auth (`SIGNED_IN` dispara a cada volta à aba), por remontagem (o spinner
  do "Ver como" e a troca de usuário remontam o que está abaixo do shell —
  daí o `Set` de módulo `liberadosNestaCarga`) nem pela virada do dia com a
  aba aberta. Abrir no meio do uso desmontaria o compositor: rascunho
  perdido, anexo preparado apagado do bucket, mensagem na janela de desfazer
  ENVIADA. **A ÚNICA exceção é `reabrir`, chamada só pela guarda de
  inatividade** (F2a, 12/09/2026): 4 h sem gesto em NENHUMA aba deste
  navegador — relógio compartilhado em `cb-atividade:<userId>`, régua pura
  em `src/lib/auth/inatividade.ts`, encanamento em
  `src/hooks/use-guarda-de-inatividade.ts`. O gesto que descobre a expiração
  leva `stopPropagation()` E `preventDefault()` (ouvinte em `window`, fase
  de captura, antes do container do React; `keydown` e `pointerdown`
  registrados SEM `passive` para o `preventDefault` valer): o Enter ou o
  clique que acorda a tela NÃO chega ao app nem ativa o botão/link focado
  (Codex, PR #198). `scroll` não conta como atividade (o fio escreve `scrollTop`
  sozinho); registro de OUTRA sessão ou ausente nunca expira (senão o
  carimbo de ontem derrubaria o login de hoje); confere ANTES de gravar
  (mexer o mouse às 4h05 não ressuscita); storage que não grava ou
  `sessionId` nulo DESLIGAM a guarda (sem relógio compartilhado, a aba
  ociosa derrubaria quem trabalha na outra). O caso "aba reaberta depois
  de 4 h" é decidido no INICIALIZADOR da porta (`inatividadeExpirou`), sem
  montar o app por um quadro. Sem senha, por decisão do operador (a F2b,
  que encerraria a sessão, ficou de fora).
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
- ⚠️ **As novidades também são RECORTADAS pelo perfil** (pedido do operador,
  12/09/2026: "um advogado do trabalhista não precisa ter a tela poluída com
  notificações da conexão bancária"). `note_mention` e `conversation_assigned`
  carregam `conversation_id` (919 e o gatilho da 027), então a conversa
  responde por qual conexão o aviso veio; `task_assigned`/`task_reply` têm a
  coluna NULA de propósito — e tarefa não tem conexão nenhuma
  (`cb_tasks` guarda só o contato) —, então aviso de tarefa NUNCA é
  recortado. Aviso cuja conversa não está no mapa CONTA como dentro (a mesma
  escolha de `conversaNoEscopo`: não esconder por ignorância). O que ficou
  fora aparece como "N fora do seu perfil", pela régua da D8. ⚠️ O SINO não
  recorta nada — os números divergem de propósito, e é por isso que o fora
  do perfil é mostrado em vez de sumir.
- ⚠️ **"Novidades desde a sua última entrada" conta pelo `created_at` >
  confirmação anterior (estrito), lidas ou não** — nunca as "não lidas" do
  sino, que acumulam avisos tratados por outro caminho (`read_at` só muda na
  página de Notificações; medido: 7 não lidas de 04/09 a 10/09, zero nas
  últimas 24 h). Sem registro no aparelho, a janela é 24 h.
- ⚠️⚠️ **Todo `auth.signOut(` em `src/` declara o escopo por escrito** — o
  padrão da biblioteca é `'global'` (auth-js 2.108.2: revoga TODOS os
  aparelhos) e é invisível. Desde 12/09/2026 (D4) o "Sair" do menu sai SÓ
  deste aparelho via `sairDesteAparelho` (devolve o erro e só navega com
  sucesso: um signOut que falha por rede NÃO apaga a sessão, e navegar assim
  forma o laço `/login` → `/dashboard`); o do convite segue global por
  escrito, e "Sair de todos os aparelhos" mora em Segurança. O pino é
  deep-equal e também reprova `signOut` desestruturado ou referenciado
  solto: chamada nova entra no manifesto por decisão visível no diff.
- ⚠️ **Todo link da tela CONFIRMA antes de navegar** (`onClick={onContinuar}`):
  a porta fica acima da página roteada, então navegar sem confirmar trocaria
  a URL e deixaria o resumo na frente da conversa pedida.
- ⚠️ **Bloco cuja tela está fora do perfil (D8): número SEM link, com aviso.**
  Esconder calaria uma obrigação atribuída à pessoa.
- **Sem bloco de reuniões, de propósito** (D13): `cb_meetings` está VAZIA em
  produção — as reuniões vivem no Calendly. Código para tabela vazia é código
  para futuro hipotético; entra quando a agenda for usada ou quando o
  Calendly gravar nela.
- **`/meu-dia` está FORA do catálogo de perfis** (`telaDoCaminho` devolve
  null; o filtro do menu e a guarda do shell deixam passar) — uma tela nova
  no catálogo nasceria invisível para todo perfil já gravado. Não vira tela
  de chegada (D15). Está em `protectedPaths` e no `pageTitles`; o pino
  `src/components/layout/rotulo-do-menu.test.ts` cobra `Sidebar.<labelKey>`
  e `Header.<título>` nos dois dicionários (chave montada, fora do alcance
  do portão do CI).

⚠️ **A ABA `/meu-dia` é uma ÁREA DE TRABALHO, não o cartão da entrada em
outro tamanho (F5, 12/09/2026).** `src/lib/meu-dia/{correcoes,negocios}.ts`
(puros, com teste), `src/hooks/use-area-de-trabalho.ts`,
`src/components/meu-dia/{blocos-pessoais,blocos-de-operacao}.tsx`, a rota
`/api/cb/meu-dia/pendencias` e o namespace `MeuDia`. Até aqui a aba montava
o MESMO componente em `modo="pagina"`, e o operador devolveu: "parece só uma
miniatura idêntica da que aparece no modal". Hoje são sete blocos num grid;
o cartão da entrada ficou com os números e UM botão que leva à aba. O que
morde código novo:

- ⚠️ **O bloco "o que precisa ser corrigido" é SÓ DO ADMINISTRADOR**
  (`useCan('view-reports')`, pedido do operador em 13/09/2026) — a mesma
  régua das abas analíticas do funil, e pela mesma razão: agendada que não
  saiu, conexão fora do ar, automação que falhou e entrada parada são saúde
  da OPERAÇÃO, e para o atendente seriam alarme sobre o qual ele não pode
  agir. `useCan` deriva do acesso EFETIVO, então o "Ver como" o esconde
  junto. Os outros seis blocos continuam de qualquer membro.
- ⚠️⚠️ **"Tudo em ordem" é uma AFIRMAÇÃO, e exige TODAS as fontes
  respondidas.** `resumirCorrecoes` tem um estado PRÓPRIO para zero-com-falha
  (`incompleto`), distinto de `limpo`: o bloco existe para avisar que algo
  quebrou, e um selo verde sobre consulta que falhou faz a pessoa fechar a
  aba tranquila enquanto a mensagem do cliente não saiu. Fonte AUSENTE do
  mapa conta como "carregando", nunca como zero — senão a aba nasce verde e
  vai escurecendo, e o primeiro quadro é o que a pessoa olha.
- ⚠️⚠️ **`deals.assigned_to` guarda `profiles.id`, NÃO `auth.users.id`** — a
  exceção à regra do Meu dia (`cb_tasks`, `conversations` e `notifications`
  guardam o id do LOGIN). `user.id` ali devolve ZERO linhas sem erro nenhum:
  quem tem trinta cards abertos vê o bloco vazio e conclui que não tem
  negócio. Por isso `PedidoDaArea` carrega `profileId` separado de `userId`,
  e o bloco ESPERA em vez de afirmar zero enquanto o perfil não resolve.
- ⚠️⚠️ **`automation_logs.status` NÃO responde "falhou?"** — ele nasce
  `'failed'` no INSERT, antes do primeiro passo (985). O bloco filtra por
  `desfecho = 'falhou'` com `finalizado_em` no dia; por `status` ele pintaria
  de vermelho toda automação que apenas COMEÇOU, inclusive as paradas num
  "Aguardar".
- ⚠️⚠️ **Agendada `failed` e `entrega_incerta` são contadas SEPARADAS e
  DISJUNTAS.** A incerta vem sempre junto de `failed` (926), então somar as
  duas cruas conta a mesma linha duas vezes — e a separação não é estética:
  são ações opostas. Reenviar o que falhou é seguro; reenviar o incerto manda
  a mesma mensagem duas vezes ao cliente.
- ⚠️⚠️ **"Mensagens enviadas hoje" é número DO ESCRITÓRIO, e isso não é
  preguiça.** A régua de resposta humana é `sender_id` OU `from_device`, e o
  celular pareado grava `from_device` com `sender_id` NULO — 948 contra 8,
  medido. Não há autor a quem creditar a maior parte do trabalho real;
  creditar por pessoa mostraria um dia quase vazio a quem trabalhou o dia
  inteiro. Pela mesma família: **não existe `cb_tasks.concluida_por`** (o
  rótulo é "tarefas SUAS concluídas", nunca "que você concluiu") e **não
  existe carimbo de quem encerrou conversa nem quando** (`closed_at`/
  `closed_by` não existem, `updated_at` é tocado por qualquer UPDATE e
  encerrar ZERA `assigned_agent_id`) — por isso não há bloco de conversas
  encerradas, e qualquer número desses seria inventado.
- ⚠️ **Ganho do dia sai de `cb_lead_events` (`to_status='won'`), do
  ESCRITÓRIO**: ganho carimbado por automação ou pelo gatilho da etapa (950)
  tem `actor_user_id` NULO, então "ganhos por mim" subcontaria em silêncio
  justamente quando a operação funciona. E o ganho é nomeado pelo CONTATO:
  `cb_lead_events.deal_id` não tem FK (912), então o PostgREST não embute
  `deals`.
- ⚠️ **`cb_calendly_eventos` e `cb_webhook_eventos` são fechadas ao
  navegador** — do cliente devolvem 0 linhas com `error: null`, bloco
  zerado com cara de resposta certa. Vêm pela rota
  `/api/cb/meu-dia/pendencias`, que é de QUALQUER membro porque devolve
  CONTAGENS (as rotas de log dessas tabelas são de admin porque devolvem o
  registro inteiro: telefone, respostas do formulário, payload do Typebot).
  Erro lá vira 500, nunca `{}` com zeros.
- ⚠️ **`messages` não tem `account_id`** — a conta entra pelo embed
  `conversations!inner`, senão a contagem é de todas as contas de que a
  pessoa é membro.
- ⚠️ **O recorte por conexão vai NA CONSULTA em `cb_scheduled_messages`**
  (a linha carrega o próprio `channel_id`, fixado no agendamento) e em JS
  nas conversas. Em `deals` o recorte é por FUNIL (`funilNoEscopo`), em JS.
  Conexão fora do ar também é recortada pelo perfil: o aviso que não é seu
  é o que ensina a ignorar o bloco.
- ⚠️ **Chave de i18n LITERAL por fonte de correção**, nunca
  uma chave montada com o nome da fonte: chave montada escapa do portão do CI, que só as
  CONTA. É a lição de `Settings.sections.webhooks` aparecendo cru na tela.
- ⚠️⚠️ **`useChannelHealth` ganhou `falhou` POR CAUSA deste bloco** (Codex,
  PR #202). Ele engolia a falha de propósito — lista vazia esconde o
  indicador do cabeçalho, e é o contrato escrito dele —, mas aqui o mesmo
  zero vira a afirmação "tudo em ordem" sobre uma sonda que não respondeu.
  Vale para qualquer consumidor novo: o zero de uma sonda silenciosa não
  autoriza afirmar nada. O `unavailable: true` (200 com lista vazia, janela
  pré-migration) entra em `falhou` pela mesma razão. E `useAgendadorSaude`
  NÃO precisou disso: batimento ilegível já cai em `nuncaRodou`, que ACENDE.
- ⚠️ **Cada destino de conserto é gateado pela tela PARA ONDE ELE LEVA**, e
  Configurações não serve de gate para nada: é tela SEMPRE VISÍVEL, então
  `podeVerTela(ctx, 'settings')` é verdadeiro para todo perfil — um link
  para `/automations` atrás dela levava direto à `TelaBloqueada`. E o
  parâmetro de Configurações é **`?tab=`**, nunca `?section=`: a página lê
  `searchParams.get('tab')` e ignora o resto, então o clique de conserto
  abria a Visão geral sem erro nenhum.
- ⚠️⚠️ **Os agendamentos do Calendly NÃO entram no bloco da agenda**, e a
  primeira versão os trazia. A 977 grava só `invitee.created`: cancelamento
  é ignorado e reagendamento INSERE linha nova sem invalidar a antiga (a URI
  do convidado muda). Uma consulta por `inicio >= agora` devolve reunião
  cancelada e as duas pontas de um reagendamento como se ambas fossem
  acontecer. Entra quando a integração tratar `invitee.canceled` — até lá o
  bloco é só `cb_meetings` e diz por quê.

⚠️ **Telas que se atualizam ao VOLTAR para o app (14/09/2026).**
`src/lib/celular/ao-voltar.ts` (puro, com teste) e
`src/hooks/use-ao-voltar-para-o-app.ts`, chamado em Tarefas, Meu dia, Funil e
Contatos. O CRM instalado no celular não tem botão de recarregar nem "puxar
para atualizar": a caixa de entrada já se atualizava no `visibilitychange`,
as outras quatro não — quem voltava do WhatsApp uma hora depois via a lista
de uma hora atrás, sem aviso nenhum. O que morde código novo:

- ⚠️⚠️ **O recarregar passado ao hook precisa ser SILENCIOSO**, mantendo a
  tela até a resposta chegar. Tarefas ganhou `recarregarEmSilencio` (mantém a
  lista e as páginas abertas, e uma falha não troca a lista pelo aviso de
  erro); Contatos, `fetchContacts({ silencioso: true, preservarSelecao: true })`;
  o Funil, uma recarga própria sobre `buscarEtapas`/`buscarNegocios`. ⚠️ No
  Funil, NUNCA a carga inicial: ela liga o `loading`, que desmonta o quadro e
  perde a rolagem e o retorno do inbox.
- ⚠️⚠️ **A recarga silenciosa de Contatos PODA a seleção** às linhas que
  continuam na página (`podarSelecao`). A página pode ter mudado enquanto a
  pessoa estava fora, e a ação em massa age sobre `selected` inteiro: id que
  saiu da tela e continuou marcado seria apagado sem ninguém o ver marcado
  (Codex, PR #216).
- ⚠️ **A volta em Contatos recarrega também o catálogo de etiquetas**
  (`fetchTags`): sem ele, etiqueta criada por outro membro sumia da linha, a
  renomeada ficava com o nome velho e a apagada seguia filtrando a lista.
  ⚠️⚠️ E o `fetchTags` troca o mapa SÓ quando o conteúdo mudou (`igual ? prev
  : map`): `fetchContacts` depende de `tagsMap`, e um mapa novo com o mesmo
  conteúdo refaria a lista inteira com spinner e seleção zerada a cada volta
  (Codex, PR #216, 2ª rodada). ⚠️⚠️ Quando o catálogo MUDOU de fato, o efeito
  da lista percebe que só ele mudou — a página, a busca e o filtro são os
  mesmos (`chaveDaListaRef`) — e refaz em silêncio e com a seleção; senão
  quem preparava uma ação em massa perdia a seleção inteira (3ª rodada).
- ⚠️⚠️ **No Funil, a volta recarrega o QUADRO, o CATÁLOGO DE FUNIS e as
  AUTOMAÇÕES, e só grava com o mesmo funil aberto** (`funilAbertoRef`) **e
  nenhuma mudança no meio do caminho** (`versaoDoQuadroRef`, que o arrasto,
  `refreshDeals`, `refreshStages`, `refreshPipelines`, `refreshAutomations` E a
  troca de funil avançam). Tudo o que ela lê tem variante com `null` na FALHA —
  `buscarEtapas`, `buscarNegocios`, `buscarFunis`, `buscarAutomacoes` e o
  `falhou` de `loadPassosENomes` —, porque voltar ao app antes de a rede do
  celular voltar esvaziava o quadro, apagava a lista de funis e a seleção, ou
  trocava os nomes dos cartões por "(apagado)". Funil apagado lá fora sai da
  seleção, e a troca carrega o primeiro que sobrou. ⚠️ As gravações acontecem
  JUNTAS, depois de uma única conferência: gravando a troca de funil antes, a
  própria troca avançaria a versão e descartaria as automações. Motivos, das
  quatro rodadas do Codex no PR #216: trocar de funil com a recarga no ar
  deixava o quadro de B com os dados de A (e A → B → A passava pela cerca do
  funil); a recarga que saiu antes de um arrasto devolvia o card à etapa
  antiga; e o catálogo e as automações ficavam velhos até reabrir a tela.
  Quem criar outro caminho que mexa nesses estados avança a versão também. Os
  `load*` continuam devolvendo vazio para quem já os chamava.
- ⚠️ **As visões Lista, Desempenho e Saúde têm dados PRÓPRIOS**
  (`useTrajetorias`), que a recarga do quadro não alcança: cada uma chama o
  hook com o `recarregar` do `useTrajetorias`, que PISCA o carregando — de
  propósito. Desempenho e Saúde são relatórios que afirmam números (a
  escolha do Meu dia), e na Lista a tabela sem linhas durante a carga é o
  que impede mudar a etapa de um negócio com a recarga no ar, a corrida que
  o quadro precisou cercar com a versão (Codex, PR #216, 3ª rodada).
  ⚠️⚠️ **E o que não é trajetória vai JUNTO** (Codex, merge do PR #216). O
  Desempenho recarrega também o gasto dos anúncios (`useGastosDeAnuncios`
  ganhou `recarregar`, com a versão DENTRO da chave): só as trajetórias
  misturava leads novos com o gasto de antes da sincronização, e o custo por
  lead e o CAC saíam errados. A Lista recarrega também o catálogo de campos,
  blocos e perfis (`versaoDoCatalogo`) e as conexões — esses EM SILÊNCIO,
  por serem rótulos: recarga do catálogo que falha mantém o que está na tela
  (vazio tiraria as colunas de campo da tabela), e as conexões usam o
  `recarregarEmSilencio` do `useChannels`, que descarta a falha. O
  `recarregar` comum trocaria a lista boa pelo vazio e apagaria os nomes da
  coluna Conexão até a volta seguinte.
- **O Meu dia é a exceção deliberada**: chama o mesmo `atualizarTudo` do
  botão, e os blocos piscam "carregando". A tela AFIRMA ("tudo em ordem",
  "0 vencidas"), e afirmar sobre número velho é pior que piscar.
- **Só recarrega depois de 30 s fora** (`AUSENCIA_QUE_RECARREGA_MS`): olhada
  rápida em outro app não queima consulta (o funil busca todos os negócios do
  quadro). Relógio andando para trás não recarrega.
- **A função mais recente é lida por ref**: passar uma arrow nova a cada
  render não re-assina o evento. Tela nova que ganhe o hook entra no pino de
  `ao-voltar.test.ts`.

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

⚠️ **App instalado no celular (14/09/2026): o manifesto existe por causa do
ESCOPO.** `src/app/manifest.ts`, `src/app/apple-icon.tsx`,
`NOME_CURTO_DO_APP` e `TAMANHOS_DO_ICONE` em `src/lib/marca.ts`, e o pino
`src/app/manifest.test.ts`. Plano vivo em `docs/PLANO-app-no-celular.md`. O
que morde código novo:

- ⚠️⚠️ **`scope: "/"` não é detalhe.** Sem manifesto, o iPhone decide sozinho
  quais endereços são do app, a partir da página em que a pessoa instalou
  (regra não documentada) — e abrir uma conversa, que só troca `/inbox` por
  `/inbox?c=…`, já cobria a tela com a moldura de navegador (X em cima;
  voltar, recarregar e "abrir no Safari" embaixo; print do operador,
  14/09). Estreitar o escopo devolve a moldura, e há pino.
- ⚠️ **O iPhone lê manifesto e ícone NA INSTALAÇÃO.** Mudança de nome, ícone,
  escopo ou tela de abertura não chega a quem já instalou: é apagar o ícone
  e adicionar de novo, com login de novo (o app instalado guarda o login
  separado do Safari). Avisar o operador a cada mudança aqui.
- ⚠️ **O ícone é fundo até a borda, sem canto arredondado e sem
  transparência** (`apple-icon.tsx`): o iPhone arredonda sozinho e pinta
  transparência de preto. Não reaproveitar o desenho do `icon.tsx` (a aba do
  navegador), que tem canto arredondado.
- ⚠️ **`TAMANHOS_DO_ICONE` alimenta os DOIS lados** — os arquivos que o
  `apple-icon` gera e os `src` do manifesto. Tamanho que só um lado conhece
  vira ícone quebrado, sem erro. O endereço é `/apple-icon/<lado>`, a forma
  que o `generateImageMetadata` dá.
- ⚠️⚠️ **`metadata.icons` no layout DESLIGA os ícones de arquivo.** O Next só
  injeta o `icon.tsx` e o `apple-icon.tsx` no `<head>` quando o metadata não
  declara `icons` (`resolve-metadata.js`, `if (!resolvedMetadata.icons)`).
  O upstream declarava `icons: { icon: [{ url: "/icon" }] }`, e com ele o
  manifesto e as imagens saíam perfeitos e o `<head>` saía SEM
  `apple-touch-icon` — medido em 14/09/2026; o iPhone improvisaria o ícone.
  Foi removido, e há pino. A documentação do Next diz que o ícone de arquivo
  "tem prioridade" — para `icons` é o contrário.
- **O nome embaixo do ícone é `NEXT_PUBLIC_APP_SHORT_NAME`**, build-arg como o
  nome longo ("CB CRM" no `pipeline.yml`, decisão do operador). Sem ele vale
  o `NOME_DO_APP`, que o iPhone corta.
- **Abre em `/inbox`** (decisão do operador: no celular o uso é atender). O
  `id: "/"` fixo impede que trocar a tela de abertura faça o Android tratar o
  app como outro. Quem abre deslogado passa pelo login e cai no Painel — o
  login não guarda a página de origem.
- **O logo do escritório ficou para depois** (decisão do operador): o ícone é
  o símbolo genérico. Quando vier, entra por configuração (a regra da marca,
  acima), nunca como arquivo do escritório no código — e cada pessoa
  reinstala o ícone.
- **Link recebido no WhatsApp abre no Safari, não no app instalado**: o
  iPhone não deixa link abrir app da Tela de Início. Não tem conserto do
  nosso lado.

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
- Operação (estado em 17/09/2026 12:39 BRT): a imagem é a NOSSA,
  `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto@sha256:a7d56788…`
  (commit `e273b904` do `develop` + patch da citação do cliente + patch da
  foto de perfil + `prisma.config.ts` dentro — `docker/evolution-cb/`), SEMPRE
  por digest; `TELEMETRY_ENABLED=false`;
  a licença está ativa (tabela `RuntimeConfig` do banco `evolution`); a stack
  completa está em `ops/vps/evolution-stack.yml` (= `/root/evolution-stack.yml`,
  segredos em `/root/evolution.env`), e `docker stack deploy` da Evolution só
  vale para RECRIAR o serviço com esse arquivo, nunca para atualizar (o `.yml`
  não acompanha o `service update`); backup do Redis é SÓ do db 8 (o Redis é
  compartilhado com outros serviços); o log da Evolution morre no reinício do
  contêiner; o cron `docker image prune -af` apaga as imagens de rollback na
  madrugada seguinte (são públicas, voltam com `pull`).
  ⚠️ **Desde 17/09/2026 12:39 BRT a imagem carrega DOIS patches** (o da
  citação e o da foto de perfil que travava a fila de entrada — ver "O atraso
  de entrega NÃO é bug do CRM", acima). Trocada por `docker service update
  --image …@sha256:a7d56788…` (stop-first: 17 s de troca, as 4 conexões
  voltaram `open` em < 1 min, `prisma migrate deploy` sem pendência). Rollback
  = o digest anterior, `…citacao@sha256:dc0f4e8b…` (mesmo commit, mesmas
  migrations). O `.yml` da stack acompanha o digest. ⚠️⚠️ **Trocar o
  contêiner com a fila de entrada represada PERDE a fila para o CRM** (a
  Baileys acka ao servidor ANTES do handler; medido em 17/09: os ~27 min
  represados da Bancário-Comercial ficaram só no celular). Reinício de
  contêiner ou troca de imagem SÓ com `entrega_recebida_em − entrega_carimbo_em`
  da 1002 em ~0 s em todas as conexões.

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

- **Nomenclatura:** `NNNN_descricao_snake_case.sql`, sequencial de **4
  dígitos** (o upstream numera com 3). ⚠️ **NÃO é timestamp.**
  ⚠️⚠️ **Os 4 dígitos existem desde 14/09/2026, e são load-bearing.** O replay
  do CI aplica os arquivos em ordem de NOME (lexicográfica): com 3 dígitos a
  `999_` era o último nome possível — `1000_` ordenaria entre a `042_` e a
  `900_`, rodaria antes das tabelas de que depende, e o replay vermelho TRAVA o
  deploy. As 137 migrations foram renomeadas (`0001_` … `0998_`).
  ⚠️⚠️ **A NOSSA produção não sentiu; uma instalação feita por `db push`,
  sim.** Aqui o histórico registra por timestamp (as migrations foram
  aplicadas pelo conector e pela API). Mas o `docs/INSTALACAO.md` manda quem
  instala usar `supabase db push`, que registra o PREFIXO do arquivo (`001`,
  `998`): depois da renomeação, o próximo `push` dessas instalações acha no
  histórico versões que não existem mais nos arquivos e recusa tudo (Codex,
  PR #209). O reparo é UM UPDATE que troca só o número registrado,
  `scripts/reparar-historico-de-migrations.sql` — filtra versão de
  EXATAMENTE 3 dígitos, então histórico por timestamp não é tocado —, e o
  passo está no `docs/ATUALIZAR.md` e no `CHANGELOG.md`. Quem mudar o
  formato do nome de novo repete os três. Há teste cobrando o formato,
  a unicidade do número e ordem-por-nome == ordem-numérica
  (`supabase/migrations/nomes-das-migrations.test.ts`). **Todo merge do
  upstream traz migration nova com 3 dígitos: renomeie para 4 no merge** — o
  teste reprova até isso acontecer. Nas listas abaixo as migrations aparecem
  pelo número ("a 912"), que continua identificando o arquivo `0912_`.
- ⚠️ **Evitar colisão de número com o upstream:** como o original também numera
  em sequência, se criarmos `0037_...` e o upstream criar `037_...`, colidem no
  merge. **Nossas migrations próprias usam a faixa reservada `0900+`** (e, a
  partir de `1000`, a continuação dela) e prefixo `cb_` na descrição:
  `1000_cb_<descricao>.sql`, `1001_cb_...`. Assim ficam isoladas da numeração
  do upstream, que não passa de dezenas.
- ⚠️ **Exceção existente:** a integração Evolution criou
  `0037_evolution_transport.sql` na sequência do upstream, não no `900+`. Já está
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
    guarda o token codificado no Keychain. Conferida por consulta REST feita
    pelo navegador logado do preview (1 conversa carimbada; nenhuma dentro
    das 24h). ⚠️ SUBSTITUÍDA pela 993 no mesmo dia: as duas colunas foram
    REMOVIDAS. Não "corrigir" o app para lê-las de volta.
  - **993_cb_janela_da_meta_por_numero** — `conversations.janela_meta jsonb`
    (mapa número → instante + `sem_carimbo`), a função do gatilho da 991
    reescrita para gravar na chave do número, o gatilho de dobra na exclusão
    de conexão oficial, acervo refeito de `messages` e a remoção das colunas
    da 991. Corrige a divergência lista×fio com dois números oficiais
    (revisão + Codex no PR #194). Aditiva para o app anterior (lê `select *`,
    degrada sem ampulheta) — aplicada ANTES do merge, como as outras. ⚠️
    NASCEU como `992` e COLIDIU com a `992_cb_asaas_config`, que OUTRA
    sessão aplicou em produção no mesmo dia (histórico `20260912144829`)
    antes de o arquivo dela chegar a qualquer branch remota — o QUINTO caso
    de duas branches em paralelo (906, 963, 966, 989). Pego pela conferência
    de deriva por consulta ao histórico, feita ANTES de aplicar; renumerado o
    arquivo que ainda não estava aplicado (este). `ls` sozinho não pegaria:
    a 992 do Asaas não existia em branch nenhuma — só no banco.

  - **992_cb_asaas_config** — a CONEXÃO do Asaas: a chave da API cifrada,
    o nome dela e a validade opcional, FECHADA ao navegador. Aplicada em
    12/09/2026 pela Management API (histórico `20260912144829`), ANTES do
    merge. Nasceu 991 e colidiu com a `991_cb_janela_da_meta_na_conversa` —
    a quinta colisão de branches em paralelo.
  - **994_cb_asaas_espelho** — `cb_asaas_clientes` (o vínculo com a ficha,
    `candidatos`, `contatos_recusados`, origem com o valor `criada` da D2)
    e `cb_asaas_cobrancas` (toda cobrança já vista vencida, mais a que vence
    hoje). As duas FECHADAS ao navegador (o CPF só sai mascarado, pela rota
    do administrador). Aplicada em 12/09/2026 à noite pela Management API
    (histórico `20260912225955`), ANTES do merge, dentro do "faça tudo" do
    operador; conferida por consulta (RLS, `anon`/`authenticated` sem SELECT,
    `service_role` com INSERT). Aditiva: nada em produção a lê até o deploy.
  - **995_cb_asaas_ciclo_e_etiqueta** — `cb_asaas_config.sincronizando_desde`
    (o CADEADO do ciclo) e `cb_asaas_clientes.etiqueta_pendente` (a etiqueta
    `asaas` que não ficou gravada na criação), as duas pedidas pela revisão
    do PR #201. Aplicada em 12/09/2026 à noite pela Management API
    (histórico `20260912234246`), ANTES do merge; aditiva.
  - **996_cb_asaas_vinculo_completo** — `cb_asaas_config.vinculo_completo_em`,
    o marcador de que o VÍNCULO da listagem vigente já rodou (5ª a 7ª
    rodadas do Codex no PR #203) — a tela precisa saber quando "ninguém
    deve" é resposta. Hoje coincide com `last_sync_at` (a versão que só
    carimbava sem ficha adiada foi revista pela revisão independente: cliente
    sem ficha não tem conversa a esconder). Aditiva, com acervo do
    `last_sync_at`. Aplicada em 13/09/2026 pela Management API (histórico
    `20260913122337`), ANTES do merge.

  - **997_cb_asaas_webhook** — as colunas do webhook em `cb_asaas_config`
    (token da URL em claro com índice único parcial; token de autenticação
    CIFRADO; id no Asaas, e-mail, estado, erro, religado, conferido, último
    evento) e `cb_asaas_eventos` (FECHADA; UNIQUE por conta e id do evento;
    o `dateCreated` do evento CRU, em texto — a medição de C7). Aditiva:
    nada em produção a lê até o deploy. Aplicada em 13/09/2026 pela
    Management API, ANTES do merge.
  - **998_cb_asaas_regua** — a régua de cobrança (Fase 3, PR #206):
    `cb_asaas_config.regua_ativa`/`regua_ativada_em`/`regua_intervalo_dias`,
    `cb_asaas_clientes.regua_desligada` (+ por quem/quando — a lista de
    exceção), `automations.assinatura_personalizada`, o índice único
    `cb_asaas_cobrancas (id, account_id)` que a FK composta exige, e
    `cb_asaas_regua_envios` (a trava E o histórico; FECHADA ao navegador;
    UNIQUE por marco; nove resultados, `na_fila` incluso; `automation_log_id`).
    Aditiva (colunas com default; a tabela nasce vazia). ⚠️ O deploy tem de
    vir DEPOIS dela: três rotas selecionam as colunas por nome (ver a seção
    da régua). Aplicada em 13/09/2026 pela Management API (histórico
    `20260913211455`), ANTES do merge; a lista de exceção do operador (38
    clientes do Asaas) marcada em seguida por script fora do repositório.
  - **999_cb_nome_fixado** — `contacts.nome_fixado_em`, a marca que impede os
    caminhos automáticos de trocar o nome da ficha pelo do perfil do WhatsApp
    (o nome do agendamento do Calendly, e o nome escrito à mão). Aditiva.
    Aplicada em 14/09/2026 pela Management API (histórico `20260914140125`),
    ANTES do merge do PR #208 e DEPOIS de o replay do CI passar. ⚠️ O deploy
    tem de vir DEPOIS dela: sem a coluna, a guarda dos três caminhos faz o
    PostgREST recusar o UPDATE de nome (o nome para de acompanhar o WhatsApp,
    sem quebrar nada) e o Calendly não consegue fixar o nome (vira aviso no
    detalhe do evento).
  - **1000_cb_campo_email_espelhado** — `custom_fields.espelho`, o campo
    "E-mail" semeado em cada conta, o acervo dos e-mails já gravados, os dois
    gatilhos de espelho, a proteção contra apagar e a semeadura de conta nova.
    ⚠️ Depende da renomeação para 4 dígitos (PR #209): com 3, `1000_`
    ordenaria antes das 900. ⚠️ Deploy DEPOIS dela: o catálogo lê `espelho`
    para trocar a lixeira pelo cadeado. Sem a coluna, a tela só não mostra o
    cadeado — nada quebra. Aplicada em 14/09/2026 pela Management API (histórico
    `20260914155014`), ANTES do merge, depois de a revisão adversarial achar
    e a própria migration corrigir a `redeem_invitation` (todo convite seria
    recusado).
  - **1001_cb_email_espelhado_normalizado** — dois gatilhos BEFORE que aparam
    a LINHA DE ORIGEM (o e-mail da ficha e o valor do campo espelhado) antes do
    espelho, com `cb_email_normalizado` (`[[:space:]]` das pontas; vazio na
    ficha vira NULL). A 1000 aparava só o lado espelhado, e automação/API com
    espaço deixavam os dois lados com textos diferentes (Codex, PR #210).
    Migration nova porque a 1000 já estava aplicada.

  ⚠️⚠️ **A 999 foi o ÚLTIMO número de 3 dígitos.** O replay do CI aplica as
  migrations em ordem de NOME (`fs.ReadDir`, lexicográfica), e `1000_`
  ordenaria ENTRE a `042_` e a `900_`. Decisão do operador em 14/09/2026:
  todos os arquivos passaram a ter 4 dígitos (PR #209) — a 999 nasceu
  `999_` e virou `0999_` no merge. As entradas desta lista seguem com o
  nome da época em que foram aplicadas.
  - **1002_cb_atraso_de_entrega** — `cb_channels.entrega_carimbo_em` e
    `entrega_recebida_em`: a fronteira de entrega por conexão, que a sonda de
    saúde lê para o terceiro eixo (ver a seção própria). Aditiva — o app
    anterior não as lê e degrada sem alarme. Aplicada em 16/09/2026 pela
    Management API (histórico `20260916164400`), ANTES do merge do PR #220,
    com autorização do operador; conferida por consulta (as 2 colunas,
    `anon` sem SELECT) e testada antes num Postgres 16 limpo (banco vazio,
    idempotente, os 4 cenários da cerca do UPDATE).
  - **1003_cb_gravada_em_na_mensagem** — `messages.gravada_em timestamptz`
    com `DEFAULT now()` (ADD sem default, SET DEFAULT depois: as linhas
    antigas ficam NULL, "não medido"). É o instante em que o CRM gravou a
    linha, que NÃO existia: `created_at` recebe o carimbo do WhatsApp na
    ingestão. Instrumento da verificação do atraso de entrega (PLANO-baileys-7,
    5.10): `gravada_em − created_at`, por mensagem, todas as conexões, com
    história — a 1002 guarda só a fronteira atual e o log da Evolution roda a
    30 MB. Nenhuma linha de código a escreve. Aditiva. Aplicada em
    17/09/2026 12:39:17 BRT pela Management API (histórico `20260917153917`),
    20 s ANTES do rollout da imagem `-foto` — o "antes" e o "depois" são
    medidos com o mesmo instrumento (a fronteira é `2026-09-17 15:39:37+00`).
  - **1004_cb_indice_da_fila_por_execucao** — índice cheio em
    `automation_pending_executions (log_id)`: a guarda de `fecharLog` e as
    varreduras das irmãs (todo cancelamento) perguntam por execução, e a fila
    não é podada (`done`/`cancelled` ficam para sempre). ⚠️ O cabeçalho do
    SQL diz que `execucaoJaInterrompida` também lê a fila — era verdade no
    dia da aplicação; desde a 1005 ela lê `automation_logs.interrompida_em`
    por chave primária, e o SQL aplicado não foi reescrito (comentário).
    Aditiva: sem ela tudo responde certo, só devagar; pode entrar antes ou
    depois do deploy. Medido antes: a tabela estava VAZIA em produção (nenhuma
    automação ativa tinha "Aguardar"). Aplicada em 18/09/2026 pela Management
    API (histórico `20260918162117`), ANTES do merge do PR #223, com
    autorização do operador; conferida por consulta ao catálogo (o índice
    existe ao lado de `idx_automation_pending_due` e `_account`).
  - **1005_cb_execucao_interrompida** — `automation_logs.interrompida_em` +
    `interrompida_por` (CHECK com os cinco motivos), o índice parcial das
    execuções vivas por contato, e a função `cb_estacionar_espera` — a
    ÚNICA porta da fila pelo motor (trava o registro, confere a marca,
    insere). ⚠️ Aplicar ANTES do deploy: sem a função todo "Aguardar" falha
    de forma visível ("function does not exist") — nada sai errado ao
    cliente, mas nenhuma sequência estaciona. `SECURITY INVOKER`, EXECUTE só
    do `service_role` (as duas metades do REVOKE, conferidas). Aplicada em
    19/09/2026 pela Management API (histórico `20260919185044`), ANTES do
    merge do PR #223, com autorização do operador e depois de o replay do CI
    passar; conferida por consulta ao catálogo (colunas, função, privilégios,
    índice, CHECK) e por e2e contra o banco real: a função estaciona a
    execução limpa, devolve `null` para a marcada, e o CHECK recusa motivo
    fora do vocabulário.
  - **1006_cb_indices_da_estadia_e_da_resposta** — três índices para as duas
    consultas novas do PR #223: `messages (conversation_id, gravada_em desc)`
    PARCIAL em `sender_type = 'customer' and deleted_at is null` (a segunda
    linha de defesa — o predicado ESPELHA os filtros de `clienteRespondeuDesde`,
    senão o planejador ignora o índice; pino em `indices-1006.test.ts`) e
    `cb_automation_events (account_id, deal_id|contact_id, tipo, criado_em
    desc)` (a estadia, que roda antes de cada passo de toda automação presa).
    Aditiva, idempotente, pode entrar antes ou depois do deploy; o CREATE
    INDEX em `messages` segura as escritas por alguns segundos (Codex, 13ª
    rodada). Aplicada em 19/09/2026 pela Management API (histórico
    `20260919205923`), DEPOIS do replay verde do CI e com autorização do
    operador; conferida por consulta ao catálogo (os três índices, com o
    predicado parcial de `messages` renderizado como
    `sender_type = 'customer' AND deleted_at IS NULL`).

  - **1007_cb_titulo_do_card_pelo_nome**, **1008_cb_titulo_de_reserva_nao_e_nome**
    e **1009_cb_tira_o_prefixo_que_sobrou** — o título do card (PRs #225 e
    #228, outra sessão). Aplicadas em 19/09/2026 (histórico `20260919222628`,
    `20260919224838` e `20260919232435`); o que fazem está na seção "O TÍTULO
    DO CARD é o NOME da pessoa".
  - **1010_cb_mensagens_sem_telefone** — `cb_mensagens_sem_telefone` (a
    mensagem 1:1 que chegou em `@lid` sem telefone: retida, entregue ou
    duplicada; FECHADA ao navegador; payload só enquanto `retida`) e a função
    `cb_assentar_mensagem_historica` (desfaz o que o gatilho da 972 decidiu
    pela ordem de inserção depois de um insert com carimbo antigo; `SECURITY
    INVOKER`, EXECUTE só do `service_role`, com a conferência trocando de
    papel). Aditiva: nada em produção a lê até o deploy, e o app TOLERA a
    ausência dela (medido em 19/09 contra a produção, antes de aplicar) — mas
    a regra continua sendo aplicar ANTES do merge. ⚠️ NASCEU como `1007`,
    virou `1009` e só então `1010`: colidiu DUAS vezes no mesmo dia com as
    migrations do título do card (1007/1008 do PR #225 e 1009 do PR #228), que
    outra sessão foi mesclando e aplicando em produção enquanto este PR estava
    aberto — o SEXTO e o SÉTIMO casos de branches em paralelo (906, 963, 966,
    989, 992). A primeira foi pega pela revisão em duas lentes e pelo
    `list_migrations`; a segunda, pelo CI do PR (o replay estoura com
    `schema_migrations_pkey`, e `nomes-das-migrations.test.ts` reprova) — as
    duas ANTES de aplicar, e é para isso que a ordem "CI verde → aplicar"
    existe. Renumerado sempre o arquivo que ainda não estava aplicado (este).
    Aplicada em 19/09/2026 pela Management API (histórico `20260919234759`),
    ANTES do merge do PR #226, com autorização do operador e DEPOIS de o replay
    do CI passar; conferida por consulta ao catálogo (RLS ligada, zero policy,
    `anon`/`authenticated` sem nada, `service_role` com tudo, a função com os
    cinco parâmetros e EXECUTE só do `service_role`) e por e2e contra o banco
    real, no preview: tardia, nova, histórica, retida, Meu dia, religação e
    reentrega (plano, 6.3). Testada antes num Postgres 16 descartável — banco
    limpo só com as concessões dela, idempotente, 20 cenários com o gatilho
    real da 972.

  - **1011_cb_historica_eco_e_resposta_concorrente** — só troca o CORPO de
    `cb_assentar_mensagem_historica` (mesma assinatura e privilégios): no ramo
    do eco posterior à espera, a fala de cliente que fica "esperando" tem de
    ser uma que ninguém respondeu depois (achado do Codex no PR #226).
    Migration nova porque a 1010 já estava aplicada. Confere que sobrou UMA
    função com esse nome e prova o EXECUTE trocando de papel. Aditiva — nada em
    produção chama a função até o deploy. Aplicada em 19/09/2026 pela
    Management API (histórico `20260920000843`), ANTES do merge do PR #226 e
    DEPOIS de o replay do CI passar; conferida no catálogo (UMA função, a mesma
    assinatura, o corpo com a guarda, `SECURITY INVOKER`, EXECUTE só do
    `service_role`) e por e2e no preview contra o banco real — o eco do
    escritório sem telefone (plano, 6.4). Testada antes num Postgres 16
    descartável: o defeito reproduz com a função da 1010 e some com a 1011,
    idempotente, os 20 cenários anteriores verdes.
  - **1012_cb_kommo_lead_id** — `deals.kommo_lead_id bigint` com índice único
    PARCIAL `(account_id, kommo_lead_id) WHERE kommo_lead_id IS NOT NULL`: a
    chave que torna a carga da Kommo REEXECUTÁVEL. A decisão 16 do operador
    pôs o id do CONTATO num campo personalizado, e isso não alcança o NEGÓCIO
    (campo personalizado só existe em contato, e uma pessoa pode ter mais de um
    card). O plano mandava guardar o id do lead em
    `cb_lead_events.details->>'kommo_lead_id'`, e o teste de esforço mediu o
    preço: "já migrei este lead?" vira 12.389 varreduras completas sobre uma
    tabela que vai a ~62.000 linhas, e sem restrição única quem pular a
    pergunta duplica 28.316 eventos em silêncio. Único por CONTA (duas contas
    podem importar de Kommos diferentes) e PARCIAL (quase todo negócio nasce
    aqui com a coluna nula). Aditiva — nada em produção lê a coluna até a carga
    existir. Aplicada em 20/09/2026 pela Management API (histórico
    `20260921003408`), ANTES do merge do PR #232 e DEPOIS de o replay do CI
    passar; conferida no catálogo (tipo `bigint`, e o índice renderizado com
    UNIQUE, `account_id` e o WHERE — os três predicados que o bloco de
    conferência da própria migration cobra).

  - **1014_cb_kommo_carga_em_lote** — a carga da Kommo: o schema
    `migracao_kommo` com o **livro-razão** e as funções
    `cb_kommo_carregar_lote` / `cb_kommo_desfazer`.
    ⚠️⚠️ **A função DESLIGA os gatilhos de `deals` e `contact_tags` DENTRO da
    transação do lote** — não repara a trilha depois. Duas medições
    escolheram: (1) `ALTER TABLE ... DISABLE TRIGGER` é **DDL transacional**,
    então o rollback religa sozinho e não existe "desligado e esquecido"; (2)
    é a ÚNICA forma de a carga gravar `updated_at` com a data da Kommo, porque
    `set_updated_at` é BEFORE UPDATE sem lista de colunas e sobrescreve com
    `now()` (medido: pedindo 2024-03-15 a coluna vira a data de hoje). A trava
    é `ShareRowExclusive`, não ACCESS EXCLUSIVE — leitor não espera. As FKs
    ficam de pé (são gatilhos internos), ao contrário de
    `session_replication_role = 'replica'`, que as derruba junto.
    ⚠️ Com os gatilhos calados a função DEVE escrever à mão o `status` (o que
    a 950 faz), o `updated_at` e a trilha retroativa.
    ⚠️ O livro-razão mora em `migracao_kommo`, **não em `public`**: lá herdaria
    a concessão padrão do Supabase e nasceria legível do navegador com id e
    nome de todo contato. Ele guarda `detalhe jsonb` para a chave que não cabe
    num uuid (`contact_tags` é (contato, etiqueta) — sem isso o desfazer
    tiraria as etiquetas que o escritório aplicou à mão).
    ⚠️ `cb_lead_events.deal_id` não tem FK, então o desfazer apaga a trilha
    EXPLICITAMENTE antes do card; no card movido, só o que a carga escreveu,
    recortado pela procedência em `details`.
    Aplicada em 21/09/2026 (histórico `20260921023141`), DEPOIS de o replay do
    CI passar no commit exato e de dois ensaios contra a produção em
    transação encerrada com ROLLBACK: carga + reexecução (idempotente) e
    carga + desfazer (o banco volta ao estado anterior, card movido inclusive).
  - **1015–1023 — a carga da Kommo e o encerramento em lote**, todas aplicadas
    em 21/09/2026, cada uma DEPOIS de um ensaio contra a produção em
    transação encerrada por `raise exception` (histórico `20260921024652` em
    diante):
    · **1015** — os três achados do PRIMEIRO piloto: `deals.value` é NOT NULL
      (NULL explícito anula o default), `deals.currency` nasce `'USD'` numa
      base BRL, e o livro-razão não cobria `contacts`.
    · **1016** — `cb_kommo_carregar_pessoas` e `cb_kommo_carregar_conversas`,
      e o desfazer passou a cobrir o que as duas criam.
    · **1017** — o lote MOVE o card que já existe (honra `deal_id`, grava
      `created_at`/`title` da Kommo) e a trilha nasce com rótulo e posição; o
      passo de pessoas cala os gatilhos de `deals` e registra no livro o
      título que o gatilho da 1007 troca; a linha RETIDA fica no livro
      (`v_presas`), para o desfazer ser repetível.
    · **1018** — `cb_encerrar_conversas_abertas` e
      `cb_desfazer_encerramento_em_lote`, com a foto de antes em
      `migracao_kommo.conversas_antes_do_encerramento`. Grupos ficam de fora
      por padrão (ver a nota sobre `cb-groups/persist.ts`).
    · **1019** — `stage_changed` sem `to_pipeline_id` é recusado na entrada e
      na conferência de saída.
    · **1020** — três corridas (Codex, PR #232): o encerramento pula conversa
      com mensagem do cliente gravada nos últimos 2 min (`FOR UPDATE … SKIP
      LOCKED`), o desfazer do encerramento só devolve o que ninguém mexeu
      depois, e o passo de pessoas acha a ficha pelas DUAS grafias do nono
      dígito.
    · **1021** — a foto do encerramento é de CADA operação (`on conflict do
      update`), senão um segundo encerramento desfazia contra a foto velha.
    · **1022** — o desfazer da carga só devolve o que continua INTOCADO desde
      ela: card criado ou movido que alguém mexeu depois, ficha com nome ou
      e-mail trocado depois e valor de campo editado depois FICAM, retidos no
      livro e contados em `editadas_depois`. ⚠️ "Intocado" em `deals` e
      `contacts` é `updated_at <= criado_em` da linha do livro; em
      `contact_custom_values`, que não tem `updated_at`, é o VALOR — que o
      livro passou a guardar (`detalhe.valor`), preenchido nas linhas antigas
      com o valor do dia da migration. ⚠️ O desfazer cala SÓ o
      `set_updated_at` de `contacts` (nominal — o espelho de e-mail continua
      ligado) e devolve `updated_at` explicitamente: sem isso, devolver o
      e-mail empurrava `updated_at` para agora e a linha do nome da MESMA
      ficha era lida como "editada depois".
    · **1023** — as decisões da carga são tomadas SOB TRAVA (Codex, PR
      #232): nome e e-mail da ficha só são preenchidos com `FOR UPDATE` e a
      regra repetida no UPDATE (um escritor concorrente que preenchesse o
      e-mail era sobrescrito pelo da Kommo); o card movido é lido travado
      (a foto do livro é o que o UPDATE sobrescreve); `status_changed` sem
      funil é recusado na ENTRADA do lote; e a ficha CRIADA pela carga e
      editada depois fica retida no desfazer, travada antes da pergunta "tem
      conversa?" — sem a trava, a conversa sendo criada naquele instante era
      apagada em cascata com as mensagens.

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
- [ ] Se mexer em schema: migration com 4 dígitos na faixa `0900+`/`1000+`,
      prefixo `cb_`, e check de drift.
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
  faixa reservada `0900+`/`1000+`.
- ❌ Criar migration com 3 dígitos (`999_x.sql`, `043_x.sql`). Com o resto do
  diretório em 4, ela ordena fora do lugar no replay — e o teste
  `nomes-das-migrations.test.ts` reprova.
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

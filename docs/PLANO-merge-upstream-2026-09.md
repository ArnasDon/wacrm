# Plano — trazer as novidades do upstream (setembro/2026) sem retrocesso

Documento INTERNO e vivo. **Cada fase só começa depois de a anterior estar
validada na prática**, e o resultado de cada uma é escrito aqui — na seção da
fase e no diário do fim.

| | |
| --- | --- |
| **Estado** | Fase 0 concluída; **Fase 1 (segurança e dependências) implementada, revisada e testada no preview — aguardando PR, CI e Codex** (21/09/2026). Nada do upstream está em produção ainda. |
| **Alvo PINADO** | `upstream/main` = **`80c3f9a`** (13/09/2026). Base comum com o nosso `main`: `98b5bd2` (upstream #532, 31/08). Tudo neste plano se refere a esse commit — se o upstream andar, é outro ciclo. |
| **Pedido do operador (21/09/2026)** | Trazer todas as atualizações como COMPLEMENTO ou CORREÇÃO, nunca retrocesso. BSUID por último (é o mais complexo e o de maior risco). Toda correção é **medida contra o nosso código**, **revisada em duas lentes** e **testada no preview, na prática**. Merge e migration estão autorizados quando o teste exigir. Só depois da validação passa-se à fase seguinte. |
| **PR #229** | Aberto por `devgabrielslv` com head em `ArnasDon/wacrm:main`. **Não tem como ser mesclado**: resolver conflito ali seria commitar no upstream. Fica aberto até a decisão P1 (seção 8). |
| **Migrations deste plano** | Faixa **`1030+`** (decisão da Fase 0 — a sessão da Kommo aplicou a 1023 hoje e segue criando números; já houve 7 colisões de branches em paralelo). Migration do upstream aplicada SEM mudança entra na faixa `00xx` preservando a ordem deles: `040→0043`, `041→(não usada)`, `042→0045`. |

## 1. O problema, em uma frase

O upstream publicou **19 PRs** (40 commits, 101 arquivos) desde o nosso último
merge, e eles mexem exatamente onde o fork mais divergiu — envio, webhook,
fluxos, i18n. Um `git merge` direto dá **38 arquivos em conflito** e, pior,
**armadilhas que o Git não marca** (seção 2.3).

## 2. Medições (21/09/2026, contra `origin/main` = `7a1dbb4`)

### 2.1 O tamanho

| | |
| --- | --- |
| Arquivos que o upstream mexeu | 101 |
| …em que o fork TEM customização | 59 |
| …em conflito textual | **38** |
| …mesclados EM SILÊNCIO nos dois lados (revisão semântica obrigatória) | **21** |
| …só deles (arquivo novo, ou idêntico ao da base no nosso lado) | 42 (21 novos + 21 modificados) |
| Linhas novas do upstream em `src/` (fora testes) | 3.190 |
| Chaves novas no `en.json` deles | 269 — **50** já existem no nosso com o mesmo caminho; das **219** que não temos, **213** vêm traduzidas no `pt.json` deles |

### 2.2 Os conflitos, por natureza

- **Triviais (~8)** — regra já escrita no `CLAUDE.md`: `messages/ko.json` e
  `.github/workflows/migrations.yml` (apagar de novo), `src/i18n/messages.test.ts`
  (fica `pt-BR`), `README.md`, `.env.local.example`, `message-composer.tsx`
  (1 linha), `templates/[id]/route.ts`, `contact-sidebar.tsx` (o nosso é um
  wrapper; o que eles mudaram vai para `painel/painel-do-contato.tsx`).
- **Mecânicos e trabalhosos (~14)** — os DOIS lados traduziram as mesmas telas
  com nomes de chave diferentes (`acceptError` × `acceptFailed`): signup,
  forgot-password, join (15 blocos), notifications, ai-playground, ai-usage,
  cabeçalho e runs de fluxos, interactive-builder/preview, invite-dialog,
  `automations/page`, `trigger-meta`, e o `en.json` (9 blocos, 787 × 161 linhas).
- **Exigem reescrita (~12)** — BSUID (#533) e o "digitando…" (#527) mexem nos
  senders que reescrevemos para multi-canal/Evolution/Instagram:
  `flows/meta-send.ts` (12 blocos), `message-thread.tsx` (12), `webhook/route.ts`
  (6), `flows/engine.ts` (5), `send-message.ts` (4), `automations/meta-send.ts`,
  `react/route.ts`, `auto-reply.ts`, `types/index.ts`, `message-bubble.tsx`,
  `dashboard-shell.tsx` e dois arquivos de teste.

### 2.3 Armadilhas que o Git NÃO marca

1. **Numeração**: as migrations `040/041/042` deles colidem com as nossas
   `0040/0041/0042` (que são as 037–039 deles, renumeradas em 26/08) e têm 3
   dígitos — `nomes-das-migrations.test.ts` reprova.
2. **A `041` deles recria a função de disparo com 8 parâmetros** — a assinatura
   que a nossa 940 APAGOU de propósito (overload sem canal). E o
   `verify-schema.sql` deles faz `::regprocedure` na de 8 parâmetros: no nosso
   replay ela não existe, o cast ESTOURA e o deploy trava.
3. **`loadAccountMetaCredentials(db, accountId)`** (do #527) carrega UMA
   credencial por conta. Aceito em qualquer sender, o robô responde pelo número
   errado, sem erro nenhum.
4. **#534 e #505 caem em estrutura LEGADA**: o stub de modelo procura a conta em
   `whatsapp_config.waba_id` (as duas linhas da produção são Evolution, sem
   WABA — nunca dispararia), e a tela `whatsapp-config.tsx` não é importada em
   lugar nenhum (o canal Meta nasce por `src/lib/cb-channels/meta-admin.ts`).
   Inofensivos, e INERTES sem port.
5. **Notificação do navegador** ignora o recorte de conexões do perfil de acesso
   e dispararia em toda mensagem dos 58 grupos — contraria a decisão do Meu dia.
6. **`pt.json`/`es.json`/`ko.json`** chegam com 1.730 chaves contra as nossas
   3.923; o teste de paridade deles reprovaria.
7. **Marca**: "wacrm" volta em 5 trechos de `src/` e 1 chave do `en.json`.

### 2.4 O que JÁ nos protege

Varredura das 3.190 linhas novas atrás do que os nossos testes estruturais
reprovam: **zero** literal de transporte (`kind ===`), **zero** `user_id:
user.id`, **zero** `signOut` sem escopo; **um** `date-fns` sem locale (o eixo do
gráfico de uso da IA, exceção já escrita). Os dois portões de i18n, o
`messages.test.ts`, o `produto-gate` e o replay das migrations seguram o deploy.

## 3. A estratégia: PORTAR primeiro, MESCLAR por último

Cada correção do upstream entra **sozinha**, em branch própria saída de `main`
(cherry-pick quando aplica limpo, port à mão quando o fork divergiu), passa
pelo protocolo da seção 4 e vai para produção num deploy pequeno. O
`git merge 80c3f9a` — que registra a ancestralidade e impede estes 38 conflitos
de voltarem — é o **fechamento** (Fase 12): nessa altura todo o conteúdo já
está no nosso tree e validado, todo conflito se resolve com "fica o nosso", e a
prova é objetiva: **o diff entre o `main` e o resultado do merge tem de ser
(quase) vazio**, e cada linha que sobrar é revisada.

Por que não mesclar primeiro (o que eu havia sugerido antes do pedido de
21/09): mesclar traz 19 PRs num deploy só, e a exigência é validar cada
correção antes de passar à seguinte. Portar primeiro custa resolver os mesmos
conflitos em pedaços; em troca, cada deploy carrega UMA mudança e, se algo
quebrar, sabe-se qual.

## 4. O protocolo de cada fase (o portão)

1. **Medir contra o nosso código.** Provar que o defeito existe (ou não) no
   NOSSO código: teste que reproduz, consulta na produção ou leitura do fonte.
   Ler o commit do upstream inteiro. Se o defeito não existe aqui, o item fecha
   como "não se aplica" — com a medição escrita.
2. **Implementar** em branch saída de `main`, na worktree
   `.claude/worktrees/merge-upstream`. Cherry-pick com `-x` quando aplica limpo;
   port à mão quando não. Chave de i18n nova entra nos DOIS dicionários na
   mesma passada.
3. **Verificar local**: `typecheck`, `lint` (ler `✖ N problems`, nunca a última
   linha), suíte na major do CI (`npx -y node@22 node_modules/vitest/vitest.mjs
   run`), os dois portões de i18n, e `build` quando tocar dependência ou rota.
4. **Revisão em DUAS LENTES**, por dois subagentes independentes (modelo forte),
   cada um cego para o achado do outro:
   - **Lente 1 — correção (adversarial):** procura bug, corrida, borda, falha
     silenciosa; compara com o commit do upstream ("o que ele faz que o nosso
     port deixou de fazer?").
   - **Lente 2 — regressão do fork:** confere o diff contra as decisões
     load-bearing do `CLAUDE.md` (multi-canal, dono durável, nome fixado,
     transporte por predicado, i18n, migrations em banco vazio…) — "isto desfaz
     alguma decisão nossa?".
   P0/P1 corrige antes de seguir; P2 é decidido e registrado.
5. **Teste prático no preview** (dev server da worktree, contra o banco de
   produção), pelo roteiro da fase. Evidência: captura, consulta ou log.
   ⚠️ O agendador da VPS drena a MESMA base (memória de 08/09): teste com fila
   disputa a corrida com a produção. Dado de teste é criado rotulado e limpo no
   fim, com `WHERE` explícito.
   ⚠️⚠️ **O preview escreve na PRODUÇÃO, e ABRIR uma conversa já é escrita**
   (zera `unread_count` para a conta inteira). Regra desde a Fase 1: o teste só
   abre a conversa do LEAD DE TESTE autorizado (`?c=00cc34a4-…`), sempre pela
   URL ou pela busca do nome — nunca "a primeira linha da lista". Foi assim que
   o teste do voltar-no-celular zerou as 4 não lidas de um cliente real
   (seção da Fase 1).
   ⚠️ **`next dev` não prova navegação**: ele não faz prefetch. O que mexe em
   rota, roteador ou dependência de framework é testado num build de produção
   local (`next build`, copiar `.next/static` e `public` para
   `.next/standalone`, `PORT=… node --env-file=.env.local
   .next/standalone/server.js`).
   ⚠️ **Painel do navegador OCULTO = `requestAnimationFrame` parado.** O que
   depende de rAF (restauração de rolagem, animação) parece quebrado sem estar.
   Conferir `document.hidden` antes de acusar regressão.
6. **PR → CI verde → `@codex review` no HEAD** (conferir por `gh api` que a
   revisão é do HEAD; "usage limits" = sem revisão) → **merge = deploy de
   produção** → verificação pós-deploy: site 200, `/api/cb/scheduled/cron` 401
   (503 = env vazia), ingestão viva, e o roteiro mínimo da fase em produção.
7. **Registrar aqui** (resultado, evidências, desvios, decisões). O pós-deploy
   da fase N é escrito no PR da fase N+1, para não gerar deploy só de
   documentação.
8. **Só então a próxima fase.** Falhou na validação → conserta ou reverte
   (`git revert` do merge; migration aditiva fica).

## 5. Regras do fork que valem em TODAS as fases

- Canal é da CONVERSA: nada de credencial "da conta". Transporte por predicado
  (`ehMeta`/`ehEvolution`/`ehInstagram`), nunca literal.
- Quem cria contato/conversa/campo grava o DONO da conta, nunca o membro.
- `nome_fixado_em` protege o nome contra escrita automática.
- Migration: 4 dígitos, aplica em banco VAZIO (todo `REVOKE` com `GRANT` de
  volta; conferência não exige dado), aplicada ANTES do merge quando
  acrescenta. Conferir `ls` **e** o histórico do Supabase na hora de numerar.
- Frase de UI não cita o nome do produto; texto novo vai para `en.json` **e**
  `pt-BR.json`.
- `message-bubble.tsx`, `message-thread.tsx`, `conversation-list.tsx`,
  `deal-card.tsx` e `contact-sidebar.tsx` ficam NOSSOS: o que o upstream mudou
  ali é portado, nunca aceito cru.
- Divergência achada no `CLAUDE.md` é corrigida no mesmo PR.

## 6. Mapa das fases

| Fase | O que entra (PR upstream) | Valor hoje (medido) | Complexidade | Risco | Migration | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| **0** | Preparação: worktree, alvo pinado, linha de base | — | Baixa | — | — | ✅ concluída (falta só a decisão P1) |
| **1** | Segurança e dependências (#563, #510, #506) | Real: estamos no Next 16.2.12 | Baixa | Médio-baixo | — | 🔄 testada no preview; aguarda PR |
| **2** | Função de disparo (#536) | Real: quebrada na produção | Baixa | Baixo | `1030` | pendente |
| **3** | Pequenas e independentes: CSV (#529), textarea (#559), vários App Secrets (#500), tags da v1 (#560, só medir) | Moderado | Baixa | Baixo | — | pendente |
| **4** | Fluxos: `{{vars}}` em botões e listas (#553) | Inerte hoje (0 fluxos ativos) | Média | Médio-baixo | — | pendente |
| **5** | Motivo da falha da Meta (#535) | 2 `failed` desde 10/09 | Média | Baixo | `0045` | pendente |
| **6** | Modelos: cabeçalho de mídia (#562) e stub (#534) | Moderado | Média | Médio-baixo | — | pendente |
| **7** | Erros de conexão explicados (#505), portado para `cb-channels` | Moderado | Média | Baixo | — | pendente |
| **8** | Notificação do navegador (#516), com recorte por perfil | Bom no computador | Média | Médio | — | pendente |
| **9** | "Digitando…" da IA (#527), sobre o canal da conversa | Inerte hoje (auto-reply desligado) | Média | Médio | — | pendente |
| **10** | i18n das telas em inglês (#577, #578, #579) | 219 chaves | Média (braçal) | Baixo | — | pendente |
| **11** | **BSUID (#533)** — por último | Preventivo (0 fichas sem telefone) | **Alta** | **Alto** | `0043` ou adaptada | pendente |
| **12** | Merge de ancestralidade e fechamento | Evita os 38 conflitos no próximo ciclo | Baixa (por construção) | Baixo | — | pendente |

## 7. As fases

### Fase 0 — Preparação

- [x] Worktree isolada `.claude/worktrees/merge-upstream` (o checkout principal
      tem dev server vivo e há outras sessões no repositório).
- [x] Alvo pinado (`80c3f9a`) e medições da seção 2.
- [x] O #232 (Kommo) entrou no `main` durante a medição; os 38 conflitos não
      mudaram.
- [x] Linha de base na worktree: `typecheck`, `lint`, suíte em Node 22, portões
      de i18n — os números de referência para atribuir qualquer vermelho depois.
- [ ] Decisão P1 (o #229).

**Resultado (21/09/2026) — linha de base sobre `7a1dbb4`:**

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | limpo |
| `npm run lint` | `✖ 51 problems (0 errors, 51 warnings)` |
| Suíte em Node 22 | **362** arquivos, **4.710** testes, todos verdes (13,5 s) |
| `i18n-parity.mjs` | OK (avisos de ICU conhecidos) |
| `i18n-chaves-usadas.mjs` | OK — 3.847 literais conferidas, 153 dinâmicas, 3 arquivos em modo folha |
| `npm audit` | **12** vulnerabilidades: **1 crítica** (`next` ≤ 16.3.2, dependência direta), **4 altas** (`sharp`, `js-yaml`, `fast-uri`, `browserslist`), 6 moderadas, 1 baixa |

Qualquer número diferente destes numa fase posterior é daquela fase.

### Fase 1 — Segurança e dependências

**Origem:** #563 (`ffa583a`), #510 (`4368afb`), #506 (`ca87b5e`).

**Já medido:** `main` em `next 16.2.12`; upstream em `16.3.5` (dois avisos
críticos corrigidos na 16.3.3, segundo o commit), mais `vitest`, `sharp`,
`js-yaml`, `fast-uri`, `hono` e `@xyflow/react`. O commit deles toca SÓ
`package.json` e os dois lockfiles — **nenhuma linha de código**. O nosso
`package-lock.json` é idêntico ao da base; o `package.json` difere só em
`name`/`homepage`/`repository`/`bugs`/`engines`.

**Falta medir (passo 1):** `npm audit` antes e depois; o guia de upgrade da 16.3
em `node_modules/next/dist/docs/` (exigência do `AGENTS.md`); onde o fork usa
API sensível a versão: `src/middleware.ts`, `after()` nos webhooks,
`generateImageMetadata` (`apple-icon.tsx`), `manifest.ts`, `metadata` do layout.

**Implementação:** versões e `overrides` no `package.json`; os dois lockfiles do
upstream; prova de consistência com `npx npm@10.9.9 ci` (o `packageManager` do
projeto — lock regenerado com npm 11 diverge do CI). `supabase/setup-cli` v1→v3
no `pipeline.yml` em commit SEPARADO: quem valida é o job `migrations` do
próprio PR; vermelho, o commit sai.

**Lentes:** L1 — mudanças de comportamento 16.2→16.3 contra o nosso uso. L2 —
CI, `Dockerfile` (standalone, build-args), `.nvmrc`/`engines`/`packageManager`.

**Teste no preview:** build de produção local + dev. Roteiro: login → painel;
rota protegida sem sessão → `/login`; `/inbox` abre conversa e recebe realtime;
envio real ao lead de teste; POST assinado no webhook LOCAL da Evolution grava
a mensagem (prova o `after()`); cron local 401; `<head>` com manifesto e
`apple-touch-icon`; funil; Configurações; console sem erro novo.

**Pós-deploy:** site 200, cron 401, `entrega_recebida_em` avançando nas conexões.

**Reversão:** `git revert` do merge.

**Resultado (21/09/2026) — implementada, verificada e testada no preview;
aguardando PR, CI e Codex.** Branch `chore/upstream-f1-seguranca-e-deps`.

*Medição contra o nosso código*

| | Antes | Depois |
| --- | --- | --- |
| `npm audit` | 12 (1 crítica no `next`, 4 altas) | **0** |
| `npx npm@10.9.9 ci` | — | passa, 690 pacotes |
| `typecheck` | limpo | limpo |
| `lint` | 51 avisos, 0 erros | 58 avisos, 0 erros |
| Suíte em Node 22 | 362 / 4.710 | 362 / 4.710 (vitest 4.1.11) |
| `next build` | — | compila em 10 s |

Os 7 avisos novos são de UMA regra que a 16.3 estreou
(`no-location-assign-relative-destination`): apontam `window.location.href = '/…'`
em sete lugares — navegações de página INTEIRA deliberadas (saída de sessão,
convite aceito, porta de entrada). Não se mexe nelas aqui.

O build avisa duas obsolescências que NÃO mudam nada hoje: a convenção
`middleware` (renomeada para `proxy` desde a 16.0; o upstream também a mantém) e
o Edge Runtime (`src/app/icon.tsx`, arquivo do upstream).

*Revisão em duas lentes*

- **Lente 2 (CI, Docker, deploy): nenhum P0/P1; quatro P2.**
  1. ⚠️ **O `next dev` da 16.3 REESCREVE o `AGENTS.md` rastreado** quando detecta
     um agente de IA (log: "Generated AGENTS.md for AI agents"). Decisão:
     `agentRules: false` no `next.config.ts` e o arquivo restaurado — pacote não
     escreve no arquivo que o `CLAUDE.md` importa, e worktree com dev server não
     fica suja. Conferido: depois do reinício o log não repete a escrita.
     (Reversível em uma linha — decisão P7.)
  2. O lock do upstream não é ponto fixo do npm 10.9.9 com o NOSSO
     `package.json` (8 linhas: `name`, `engines` e 5 marcações `dev`). Já era
     assim antes; `npm ci` não é afetado e nenhum caminho usa `--omit=dev`.
     Fica como veio: normalizar faria todo merge futuro do lock conflitar.
  3. ⚠️ A imagem `node:22-alpine` com o Next 16.3.5 só é construída DEPOIS do
     merge (o job `deploy` só roda no `main`, e não há Docker nesta máquina). Se
     o build da imagem falhar, o rollout não acontece e a produção fica na
     imagem antiga — **conferir o job `deploy` logo após o merge**.
  4. `eslint-visitor-keys` (dev) pede Node ≥ 22.13; o `engines` diz 22.12. Só
     aviso de `EBADENGINE`, já existia — anotado, sem mudança.
- **Lente 1 (comportamento 16.2 → 16.3): nenhum P0.** Mediu os dois `dist/`, as
  duas documentações embarcadas e o config RESOLVIDO de dois builds deste app.
  1. ⚠️ **P1 a confirmar — cinco padrões do roteador viraram sem opt-in**
     (`validateRSCRequestHeaders`, `optimisticRouting`, `prefetchInlining`,
     `varyParams`, `appNewScrollHandler`), o React embutido do App Router saltou
     de canário, e o cache de segmentos foi reescrito. **O meu primeiro teste
     não alcançava isso: `next dev` não faz prefetch.** Confirmado depois num
     build de PRODUÇÃO local (tabela abaixo) — limpo.
  2. P1 só na máquina de dev: o `next build` passou a checar tipos com o `tsc`
     do projeto inteiro, **incluindo `.next/dev/types`** — o `.next` velho de
     outra branch agora reprova também o BUILD local, não só o `typecheck`. CI
     e Docker não têm `.next` e não sentem.
  3. P2: a validação de RSC acrescenta um salto a todo redirect do middleware
     (uma passada a mais do `getUser()` em sessão expirada). Com o Traefik é
     inofensivo; se um CDN voltar à frente, o 307 sai com `s-maxage=300` —
     desliga-se com `experimental.validateRSCRequestHeaders: false`.
  4. P2: `useRouter()` deixou de ser um objeto único (um por componente, com
     `bfcacheId`). Os 4 efeitos do app que dependem de `router` foram lidos:
     todos com guarda e idempotentes. Vale para efeito NOVO.
  5. P2: o cache de build do Turbopack virou padrão (227 MB em
     `.next/cache/turbopack` por build; no Docker é escrito e nunca lido).
  6. Limpos, com evidência: middleware (9 sondas de caminho idênticas nas duas
     versões), `after()` (fiação `waitUntil`/`onClose` igual; ficou mais
     robusto), route handlers (corpo de 300 KB atravessa o middleware até o
     HMAC), ícones (Edge Runtime é só `warnOnce`), `next.config.ts`, next-intl,
     e os binários `musl` no lock para a imagem Alpine.

*Teste prático 2 — build de PRODUÇÃO local (standalone, como no Docker: `node
server.js` na porta 3140, Next 16.3.5)*

| Roteiro | Resultado |
| --- | --- |
| `/login`, cron sem segredo | 200 · 401 |
| Sessão expirada: navegação RSC sem cookie | `/inbox?c=abc` → 2 redirects → 200 em `/login` — **sem laço** (na 16.2.12 era 1 redirect) |
| Link direto para a conversa do lead de teste | abre com 116 mensagens e compositor |
| **Menu inteiro por clique** (navegação do cliente, com prefetch) | os 15 destinos renderizam; console só com os 403 de foto expirada |
| **Funil → card do lead de teste → conversa → "Voltar ao funil"** | abre `?c=00cc34a4…&de=funil`; na volta a rolagem é a de antes: **378 × 4.234** |
| `/automations/<id>/edit` × `/automations/new` | cada uma abre a SUA tela (a rota estática vence a dinâmica com o roteamento otimista) |
| Voltar no celular (375 px), só com o lead de teste | `push` (33 → 34), `history.back()` → `/inbox` com a conversa fechada |

⚠️ **Armadilha do teste, que custou um falso alarme:** com o painel do
navegador OCULTO o `requestAnimationFrame` não dispara (medido: não rodou em
2 s), e a restauração da rolagem do funil depende de dois. A primeira passada
deu rolagem 0 e parecia regressão do manipulador de scroll novo; com o rAF
apoiado em timer, restaurou. **Conferência visual pendente do operador** (painel
visível): funil → conversa → "Voltar ao funil".

Não exercitado: o editor de fluxos (`@xyflow/react` 12.11.3) — a conta não tem
fluxo nenhum, e criar um seria escrita só para o teste. Fica coberto na Fase 4,
que cria um fluxo de teste.

*Teste prático no preview (dev server da worktree, Next 16.3.5, porta 3130)*

| Roteiro | Resultado |
| --- | --- |
| `/login` | 200 |
| `/inbox` sem sessão | 307 → `/login` (o middleware protege) |
| `/api/cb/scheduled/cron` sem segredo | 401 (env carregada) |
| `<head>` | manifesto, `icon` e os três `apple-touch-icon` |
| `/manifest.webmanifest`, `/icon`, `/apple-icon/{180,192,512}` | 200, `scope: /`, `start_url: /inbox` |
| Meu dia → Continuar → caixa de entrada | renderiza; conversa do lead de teste abre com 116 mensagens e compositor ativo |
| Voltar no celular (375 px): abrir conversa = `push`, `history.back()` | histórico 6 → 7; volta para `/inbox` com a conversa fechada |
| Funil, Contatos, Configurações | renderizam (596 negócios; 25 linhas) |
| Console | só os dois 403 de foto de perfil EXPIRADA do WhatsApp (`pps.whatsapp.net`), que já existiam |
| **`after()` do webhook da Evolution** | POST sem `Authorization` → 401; com o segredo → 200 em 679 ms; o log da API do Supabase mostra o `PATCH …message_id=eq.TESTE-F1-AFTER-20260921-1635` rodando DEPOIS da resposta, casando zero linhas |

⚠️ **Erro do teste, registrado:** o roteiro do celular clicou na primeira linha
da lista — a conversa de um cliente real — e abrir zerou as 4 não lidas dela
(o alerta "em atraso" seguiu aceso; nada foi enviado). Virou regra no passo 5 do
protocolo. A restauração do contador depende de OK do operador.

Fora do roteiro desta fase, de propósito: envio real de WhatsApp (exige OK do
operador na conversa).

### Fase 2 — Disparos: a função que nunca funcionou

**Origem:** #536 (`e9b6c74`, `a8023ec`).

**Já medido (produção, 21/09):** a função vigente é
`create_broadcast_with_recipients(…, uuid)` — a de **9 parâmetros** da nossa 940
— com `RETURNING id, contact_id` AMBÍGUO (a coluna de saída do `RETURNS TABLE`
também é variável em escopo: SQLSTATE 42702 na primeira execução). `broadcasts`
tem **0 linhas**; **0** chaves de API ativas. Chamadores: `broadcast-core.ts` ←
`POST /api/v1/broadcasts` e `broadcast/[id]/resume`.

**Falta medir:** reproduzir o 42702 num Postgres 16 local **CHAMANDO** a função
(o plpgsql só resolve nomes na execução — aplicar não prova nada); por que o
painel nunca gravou campanha (ninguém usou, ou o caminho da tela também falha?).

**Implementação:** `1030_cb_disparo_contact_id_qualificado.sql` —
`CREATE OR REPLACE` da assinatura de 9 parâmetros qualificando
`broadcast_recipients.contact_id`, mesmos `REVOKE`/`GRANT` da 940, conferência
por `pg_get_functiondef` (banco vazio não tem conta para chamar). Asserção no
`verify-schema.sql` com a assinatura de **9** parâmetros. Pino lendo o SQL.
A `041` do upstream NÃO entra (é apagada na Fase 12).

**Lentes:** L1 — assinatura exata, overload, privilégios, idempotência.
L2 — replay em banco vazio e convenções de migration.

**Teste no preview:** aplicar a 1030 na produção; criar chave de API de teste;
`POST /api/v1/broadcasts` local com 1 destinatário (o lead de teste autorizado),
modelo aprovado, canal oficial → mensagem chega; `broadcasts` = 1 linha COM
`channel_id`, 1 destinatário `sent`. ⚠️ Efeito externo: uma mensagem de modelo
(tarifada) para o lead de teste. Limpeza: revogar a chave; a campanha fica
rotulada "TESTE" (apagar só com OK do operador).

**Resultado:** — (a preencher)

### Fase 3 — Correções pequenas e independentes

**3a. Importação de CSV (#529, `a0e804b`).** Medido: o nosso `dedupeByPhone`
conta telefone inválido como DUPLICATA (`dedupe.ts:146`) e o modal só diz "N
falharam", sem motivo. Chamadores: `import-modal.tsx` e `lib/broadcast-csv.ts`
(a forma de retorno ganha `invalid` — aditivo). `import-modal.tsx` mescla em
silêncio nos dois lados: conferir que a nossa régua (`chaveDeTag` na prévia, dono
durável) sobrevive. 6 chaves novas. Teste: CSV com linha válida, duplicada, sem
telefone e telefone inválido → contadores certos e o motivo por linha; limpar
os contatos criados.

**3b. Texto do nó em várias linhas (#559, `7f42918`).** 1 linha em
`node-config-form.tsx` (idêntico à base no nosso lado). Teste: abrir o editor.

**3c. Vários App Secrets (#500, `a4eb921`).** `webhook-signature.ts` idêntico à
base. Falha FECHADA preservada (vazio ou só vírgulas = recusa). Conflito só no
`.env.local.example`. `docs/multi-waba.md` entra adaptado (sem o nome do produto
original) e indexado em `docs/README.md`. Teste: POST assinado no webhook LOCAL
da Meta com o segredo certo (200), errado (401) e com `A,B` no env (os dois
passam). A assinatura do Instagram é outra e não é tocada.

**3d. Tags da v1 (#560, `77d403b`) — só medir.** Já corrigimos em 09/09
(`set-contact-tags.test.ts`). Medição: rodar os testes de regressão DELES contra
a NOSSA implementação; adotar os que acrescentam cobertura; o código fica o nosso.

**Resultado:** — (a preencher)

### Fase 4 — Fluxos: `{{vars}}` em botões e listas

**Origem:** #553 (`56ed3d9`). **Medido:** o nosso engine manda `cfg.text` cru em
`sendButtonsAndSuspend`/`sendListAndSuspend` (`engine.ts:433` e `:470`) — o
defeito existe aqui. Inerte hoje: 0 fluxos ativos.

**O nó da fase:** os dois lados resolveram a FALHA desses nós de jeitos
diferentes — nós com `try/catch` nos nós interativos, eles com `logEvent` de
erro + `endRun('failed')` (e a re-pergunta mantém a run viva). Medir o que o
nosso faz hoje e ficar com UM contrato. `reply_id` NÃO é interpolado (é chave de
roteamento). Não truncar: o validador do `meta-api` acusa o estouro.

**Teste no preview:** fluxo de teste no canal OFICIAL, palavra-chave improvável:
`collect_input` (nome) → `send_buttons` "Oi {{vars.name}}". Entrada simulada por
POST assinado no webhook LOCAL da Meta, como o lead de teste → botões REAIS
chegam com o nome. Título acima do limite → run `failed` com evento. Canal
Evolution → o motivo claro de hoje continua. ⚠️ Fluxo ativo vale para cliente
real: ativo por minutos, desativado e apagado em seguida.

**Resultado:** — (a preencher)

### Fase 5 — O motivo da falha da Meta na mensagem

**Origem:** #535 (`a52febf`). **Medido:** o nosso `handleStatusUpdate` grava só
`status` (escopado por canal); 2 mensagens `failed` desde 10/09.

**Implementação:** migration `0045_message_failure_reason.sql` (a `042` deles,
3 colunas anuláveis — ler contra as regras de banco vazio antes; se precisar
mudar, vira `103x_cb_…`). No webhook: os campos de erro entram no MESMO `UPDATE`
escopado por canal; status posterior não-falha NÃO limpa o motivo. Em
`broadcast_recipients`, o motivo é dobrado em `error_message`. A bolha é NOSSA:
portar o tooltip no X e a linha discreta para `message-bubble.tsx`.
`Inbox.bubble.notDelivered` nos dois dicionários. Asserção no `verify-schema.sql`.
Falha da Evolution não preenche essas colunas — dizer isso no código.

**Teste no preview:** POST assinado LOCAL com `statuses[failed]` + `errors[0]`
sobre uma mensagem de teste do canal oficial → colunas gravadas, bolha mostra o
motivo; depois `delivered` → o motivo fica. Limpeza: restaurar a mensagem.

**Resultado:** — (a preencher)

### Fase 6 — Modelos da Meta

**6a. Cabeçalho de vídeo/documento (#562, `8223896`).** Medido:
`ensureImageHeaderHandle` sai cedo para o que não é imagem — modelo com
documento ou vídeo vai à Meta com URL e é recusado. `submit/route.ts` e
`template-manager.tsx` mesclam em silêncio: conferir que token e WABA continuam
sendo os DO CANAL (`resolveMetaChannel`). 16 chaves. Teste: criar modelo com
cabeçalho PDF na WABA oficial → a Meta aceita (PENDING). ⚠️ **Efeito externo —
peço OK na hora** (cria um modelo de teste, apagável no painel da Meta).

**6b. Stub de modelo desconhecido (#534, `422895e`).** Medido:
`template-webhook.ts` é idêntico à base (só atualiza; evento de modelo criado no
painel da Meta é descartado). O stub deles resolve a conta por
`whatsapp_config.waba_id` — na produção nunca casaria. **Port:** resolver por
`cb_channels.waba_id`, carimbar `channel_id` (senão nasce um modelo "global"
fantasma ao lado do da sincronização) e gravar o dono da conta em `user_id`.
Teste: POST assinado LOCAL de `message_template_status_update` para id
desconhecido → stub COM canal; segundo evento atualiza, não duplica; "Sincronizar"
adota o stub. Limpeza: apagar o stub.

**Resultado:** — (a preencher)

### Fase 7 — Por que a conexão com a Meta falhou

**Origem:** #505 (`45c3d7a`). **Medido:** a tela legada não é montada; o canal
Meta nasce por `meta-admin.ts`. A rota legada mescla em silêncio com a guarda de
papel intacta.

**Implementação:** `MetaApiError`, `meta-error-explain.ts` e `waba-pairing.ts`
entram como vieram (o `message` do erro não muda — os consumidores atuais
seguem). **Port do benefício:** explicação acionável e conferência do par
WABA/telefone em `meta-admin.ts` / `POST /api/cb/channels`, exibidas no
`cb-channels-panel.tsx`. `docs/whatsapp-connection-troubleshooting.md` adaptado.
Anotado para depois, FORA deste plano: `MetaApiError.status` é o que faltava
para a retentativa de automação valer na Meta.

**Teste no preview:** tentar criar conexão Meta com token inválido e com WABA
trocada → mensagem acionável. ⚠️ **Só caminhos de falha e leitura** — nada de
registrar nem reconfigurar o número oficial da produção.

**Resultado:** — (a preencher)

### Fase 8 — Notificação do navegador

**Origem:** #516 (`06b7b97`). Funcionalidade nova (5 arquivos, 24 chaves).

**Adaptações (proposta — decisão P2):** respeitar o recorte de conexões do perfil
(a régua do Meu dia, com o contexto REAL, nunca a lente do "Ver como"); **grupo
fora**; montar DENTRO da `<PortaDeEntrada>`, ao lado do `PresenceHeartbeat`. No
app instalado no iPhone não funciona (sem service worker) — o cartão diz
"não suportado". Custo: mais uma assinatura realtime por aba.

**Teste no preview:** ligar em Configurações → perfil; entrada simulada com a
aba em outra conversa → notificação (espiã de `Notification` na página; o aviso
do sistema operacional fica para o operador conferir); mensagem de grupo e de
conexão fora do perfil → nada; clique abre `/inbox?c=`.

**Resultado:** — (a preencher)

### Fase 9 — "Digitando…" enquanto a IA responde

**Origem:** #527 (`ec010c7`). **Medido:** resposta automática DESLIGADA na
produção — inerte hoje. **Não adotar** `loadAccountMetaCredentials`: o indicador
sai pelo canal DA CONVERSA, e só quando `ehMeta`. Melhor esforço: falha vira
aviso no log e nunca segura a resposta.

**Teste:** unitário + prático sem ligar a IA para ninguém: o operador manda uma
mensagem do celular dele ao número oficial e um script local dispara o indicador
para aquele `wamid`. ⚠️ Depende do operador (decisão P5).

**Resultado:** — (a preencher)

### Fase 10 — i18n das telas que estavam em inglês

**Origem:** #577 (`6eb7eef`), #578 (`50c11b2`), #579 (`a8d8a12`, `bbb6ff1`).

Onde os DOIS traduziram (14 arquivos): fica o nosso, e as chaves deles que
sobrarem órfãs saem do `en.json`. Onde só ELES traduziram: entra o deles, com as
chaves no `en.json` e no `pt-BR.json` (aproveitando o `pt.json` deles, revisando
a terminologia da casa). `pt.json`, `es.json` e `ko.json` são apagados (decisão
P3); `messages.test.ts` fica em `pt-BR`. "wacrm" vira `{appName}` ou "este CRM".
Pode ser fatiada em 10a/10b/10c, uma por PR do upstream.

**Teste no preview:** percorrer em pt-BR cada tela tocada (signup,
forgot-password, join, notificações, agentes, cabeçalho do fluxo, construtor de
interativa, toasts) — nenhuma chave crua, nenhum inglês novo.

**Resultado:** — (a preencher)

### Fase 11 — BSUID (por último)

**Origem:** #533 (`2cf9806`, 17 arquivos, +1.325). A Meta deixou de mandar o
telefone de quem adotou nome de usuário e não tem histórico recente com a
empresa: o webhook vem só com `from_user_id`.

**Medido:** o nosso webhook tem a mesma falha (`normalizePhone(undefined)` →
`''` → `findExistingContact('')` → contato E conversa novos a cada mensagem, e
resposta impossível). Na produção ainda não mordeu: **0** fichas sem telefone;
22 mensagens de cliente em 3 conversas no número oficial desde 10/09. Cresce
quando o número oficial assumir o lugar da Kommo.

**Decisões que abrem a fase (P4):** `phone = ''` (deles) × `NULL` (nosso, 989) —
proposta: `NULL`, alargando o CHECK para "telefone OU instagram OU BSUID";
BSUID só vale em canal Meta — Evolution e Instagram recusam com motivo claro;
a guarda `nome_fixado_em` e o backfill do BSUID viram DOIS `UPDATE`s; Asaas,
Calendly, régua, foto de perfil e "nova conversa" contam com telefone (a ficha
sem telefone já existe por causa do Instagram — reduz o risco, não zera).

**Subfases, cada uma pelo portão da seção 4:** 11.0 desenho e decisões ·
11.1 migration · 11.2 entrada (identidade, contato por BSUID primeiro, backfill)
· 11.3 saída (`recipientFields`, alvo de envio atrás de `ehMeta`, em TODOS os
senders do fork) · 11.4 tela (identidade sem telefone) · 11.5 teste de ponta a
ponta com entregas assinadas locais (duas mensagens só-BSUID → UMA ficha, UMA
conversa; depois payload com telefone + BSUID → backfill na mesma ficha).
Limite conhecido: envio real a BSUID só se prova com um cliente de verdade nessa
situação.

**Resultado:** — (a preencher)

### Fase 12 — Merge de ancestralidade e fechamento

`git merge 80c3f9a` em `chore/merge-upstream-2026-09-DD`. Todo conflito → o
nosso (já contém os ports). Apagar de novo: `ko.json`, `pt.json`, `es.json`,
`ci.yml`/`migrations.yml`, e os arquivos `040/041/042` deles (substituídos).
**Prova:** `git diff main <merge>` só lista sobras esperadas, cada uma revisada.
Portões, fumaça no preview, merge. Depois: bloco "Decisões fixadas no merge de
2026-09-DD" no `CLAUDE.md`, e fechar o #229 com comentário apontando para cá.

**Resultado:** — (a preencher)

## 8. Decisões pendentes do operador

| # | Decisão | Proposta | Trava qual fase |
| --- | --- | --- | --- |
| P1 | Fechar o #229 agora (com comentário apontando para este plano) ou só no fim | Agora — evita que alguém tente mesclá-lo | nenhuma |
| P2 | Notificação: respeitar o perfil e deixar grupo de fora | Sim | 8 |
| P3 | Apagar `pt.json`/`es.json` depois de aproveitar as traduções | Sim | 10 |
| P4 | BSUID: `NULL` + CHECK alargado, em vez de `''` | `NULL` | 11 |
| P5 | Testes com efeito externo: modelo tarifado ao lead de teste (F2), modelo de teste na WABA (F6a), mensagem do celular do operador (F9) | OK na hora de cada um | 2, 6, 9 |
| P6 | Alguma fase a DESCARTAR? (a 9 é inerte hoje) | Manter todas | — |
| P7 | `agentRules: false` (o `next dev` da 16.3 não reescreve o `AGENTS.md`) — ou aceitar o bloco que o Next gera e commitá-lo | Manter desligado | nenhuma (já aplicado na Fase 1, reversível em uma linha) |
| P8 | Restaurar para 4 as não lidas da conversa que o teste da Fase 1 abriu por engano (UPDATE de uma linha, cercado por `unread_count = 0`) | Restaurar | nenhuma |

## 9. Diário

| Data | Fase | O que aconteceu |
| --- | --- | --- |
| 21/09/2026 | 0 | Medições da seção 2; estratégia "portar primeiro"; worktree criada; o #232 entrou no `main` no meio da medição sem mudar os conflitos. Linha de base: 362 arquivos / 4.710 testes verdes; `npm audit` com 12 vulnerabilidades (1 crítica). |
| 21/09/2026 | 1 | Dependências do upstream aplicadas: `npm audit` 12 → 0. As duas lentes não acharam P0. A Lente 2 pegou o `next dev` da 16.3 reescrevendo o `AGENTS.md` (→ `agentRules: false`). A Lente 1 mostrou que o teste em `next dev` não exercitava o roteador novo (→ refeito num build de produção local: limpo). Dois erros MEUS de teste viraram regra do protocolo: abrir conversa de cliente real zera as não lidas, e painel oculto congela o `requestAnimationFrame`. |

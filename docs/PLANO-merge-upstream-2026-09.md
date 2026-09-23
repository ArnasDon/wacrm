# Plano — trazer as novidades do upstream (setembro/2026) sem retrocesso

Documento INTERNO e vivo. **Cada fase só começa depois de a anterior estar
validada na prática**, e o resultado de cada uma é escrito aqui — na seção da
fase e no diário do fim.

| | |
| --- | --- |
| **Estado** | Fases 0, 1 e 2 concluídas. **Fase 1** (Next 16.3.5, `npm audit` 12 → 0) em produção desde 21/09/2026 15:08Z (PR #239). **Fase 2** (função de disparo, migration `1030`, `channel_id` respeitado) **em produção desde 21/09/2026 17:33Z** (PR #242), pós-deploy conferido. **Pausado a pedido do operador antes da Fase 3.** |
| **Alvo PINADO** | `upstream/main` = **`80c3f9a`** (13/09/2026). Base comum com o nosso `main`: `98b5bd2` (upstream #532, 31/08). Tudo neste plano se refere a esse commit — se o upstream andar, é outro ciclo. ⚠️ **Ele ANDOU (medido em 21/09/2026): `upstream/main` = `aee1b01f`, 2 commits novos** — `b9969fa2` (#586: exige `+` e código do país em telefone digitado e na API; 21 arquivos) e `f8a1cc72` (chaves do modal de importação em `pt`/`es`). Estão FORA deste plano até a decisão P9 (seção 8). Conferido de novo em 22/09/2026: não andou mais. |
| **Pedido do operador (21/09/2026)** | Trazer todas as atualizações como COMPLEMENTO ou CORREÇÃO, nunca retrocesso. BSUID por último (é o mais complexo e o de maior risco). Toda correção é **medida contra o nosso código**, **revisada em duas lentes** e **testada no preview, na prática**. Merge e migration estão autorizados quando o teste exigir. Só depois da validação passa-se à fase seguinte. |
| **PR #229** | Aberto por `devgabrielslv` com head em `ArnasDon/wacrm:main`. **Não tinha como ser mesclado**: resolver conflito ali seria commitar no upstream, e o conteúdo dele muda sozinho (a origem é uma branch viva). **FECHADO em 21/09/2026 por decisão do operador (P1)**, com comentário apontando para este plano — fechar o PR não descarta o conteúdo: ele entra pelas fases daqui, e a worktree `.claude/worktrees/merge-upstream` fica de pé para isso. |
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
   ⚠️ **Fase com MIGRATION: o passo 5 acontece NO MEIO deste** (a lição da 1010,
   reafirmada na Fase 2) — (a) PR em RASCUNHO → replay do CI verde no commit
   EXATO; (b) aplicar a migration e registrá-la no `CLAUDE.md`; (c) o passo 5;
   (d) pronto para revisão → Codex no HEAD → merge. Commit novo que toque o
   `.sql` volta a (a). Na janela entre (b) e o merge a PRODUÇÃO roda o código
   antigo contra o banco novo — escrever o pior caso na seção da fase.
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
| **0** | Preparação: worktree, alvo pinado, linha de base | — | Baixa | — | — | ✅ concluída (P1 decidida em 21/09: #229 fechado) |
| **1** | Segurança e dependências (#563, #510, #506) | Real: estamos no Next 16.2.12 | Baixa | Médio-baixo | — | ✅ em produção (PR #239, 21/09) |
| **2** | Função de disparo (#536) + 2 achados nossos (params em 2-D; `channel_id` descartado) | Real: quebrada na produção | Baixa → Média | Baixo | `1030` (aplicada 21/09) | ✅ em produção (PR #242, 21/09) |
| **1b** | Segurança depois do alvo: #588 (SSRF), #587 (automação por conta), #589 (conversa por conta) — PRs ABERTOS do mantenedor — e a mídia do Instagram (achado nosso) | Real: brechas presentes; o #587 também dava 404 ao admin não-autor | Média | Médio-baixo | — | ✅ em produção (PR #261, 23/09) |
| **3** | Pequenas e independentes: CSV (#529), textarea (#559), vários App Secrets (#500), tags da v1 (#560, só medir), e o resolvedor do canal Meta (3e — achado NOSSO da Fase 2, sem PR do upstream); com a P9, a normalização do telefone digitado — dividida em 3-I a 3-IV | Moderado | Baixa | Baixo | — | 3-I no PR #262; 3-II a 3-IV pendentes |
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
- [x] Decisão P1 (o #229): **fechado em 21/09/2026** por ordem do operador, com
      comentário explicando por que não pode ser mesclado e apontando para este
      plano. A worktree fica de pé — é por ela que as correções seguem entrando.

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

**Resultado (21/09/2026) — ✅ EM PRODUÇÃO.** PR #239 (branch
`chore/upstream-f1-seguranca-e-deps`), CI verde (o replay já com o `setup-cli`
v3), Codex sem achados no HEAD `a5924f5`, mesclado às 15:00Z (`9277c6f`).

*Pós-deploy (rollout convergiu às 15:08Z, na PRIMEIRA tentativa — a imagem
`node:22-alpine` com o Next 16.3.5 construiu)*

| Verificação em produção | Resultado |
| --- | --- |
| `/login` · rota protegida sem sessão · cron sem segredo | 200 · 307 → `/login` · **401** (segredos no lugar) |
| Manifesto e `<head>` | 200; manifesto e os três `apple-touch-icon` |
| Webhook da Evolution sem segredo | 401 |
| Ingestão com o 16.3.5 no ar (15:09Z → 15:22Z) | **31** mensagens gravadas (16 de cliente), **30** recibos aplicados, as **3** conexões medindo entrega — o `after()` dos webhooks funciona em produção |

P8 resolvida: as 4 não lidas da conversa aberta por engano foram devolvidas
(UPDATE de uma linha, cercado por `unread_count = 0` E pela mesma
`aguardando_desde` — ninguém tinha respondido ao cliente).

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

**Origem:** #536 (`e9b6c74`, `a8023ec`) — e DOIS achados nossos que o upstream
não tem.

**Medido contra o nosso código (21/09/2026)**

| O que | Resultado |
| --- | --- |
| A função vigente na produção | UMA, a de **9 parâmetros** da nossa 0940, com `RETURNING id, contact_id` AMBÍGUO |
| Pela rota de verdade, no preview, contra a produção | `POST /api/v1/broadcasts` → **500** "Failed to create broadcast"; no log, `42702 column reference "contact_id" is ambiguous`. Nada gravado, nada enviado |
| Quem chama a função | SÓ `createBroadcast` (`broadcast-core.ts`), alcançado só por `POST /api/v1/broadcasts` (e pelo MCP, via HTTP). ⚠️ O "retomar" NÃO chama, e a tela de Disparos grava a campanha direto na tabela — `broadcasts` com 0 linhas quer dizer que ninguém usou Disparos, não que a tela falha |
| Postgres 16 local, função da 0940 | reproduz o 42702, inclusive com as listas VAZIAS |
| A `041` do upstream aplicada crua | deixa **2 funções** com o mesmo nome (o overload de 8 que a 0940 apagou) |

**Os dois achados da revisão em duas lentes (nenhum está no upstream)**

1. ⚠️⚠️ **Lente 1 — o conserto do upstream NÃO basta: os parâmetros por
   destinatário chegam em DUAS DIMENSÕES.** `p_template_params` era `JSONB[]` e
   o app manda `string[][]`. O PostgREST converte o corpo com
   `json_to_record(... AS _(p_template_params jsonb[]))`, e a lista de listas
   vira um array 2-D. Medido (com SÓ a qualificação do upstream aplicada, e as
   restrições REAIS da tabela): 2 destinatários × 2 params → a função EXECUTA e
   grava **4 linhas para 2 contatos** — o 2º contato com o parâmetro do 1º, duas
   linhas SEM contato — e a campanha fica commitada em `sending`, órfã (o app
   estoura logo depois, ao parear as linhas devolvidas); 1 param → grava
   `"Ana"` (texto) em vez de `["Ana"]`, e o "retomar" (`Array.isArray`)
   reenviaria SEM as variáveis; contagens diferentes → `malformed JSON array`
   (22P02). Era invisível enquanto o defeito 1 derrubava toda chamada.
   ⚠️ **Erro meu, pego pela 2ª passada da Lente 1:** a primeira medição dizia
   "23502, a campanha inteira falha" — o meu banco descartável declarava
   `contact_id NOT NULL`, que a 0004 tirou. O dublê imitava a forma SUPOSTA, e
   a verdade era pior. Virou nota no `CLAUDE.md` (regra 3).
2. ⚠️ **Lente 2 — `POST /api/v1/broadcasts` DESCARTAVA o `channel_id`**, que
   `docs/public-api.md`, `docs/mcp.md` e a ferramenta `send_broadcast` do
   mcp-server prometem. Invisível enquanto a rota devolvia 500; com a função
   consertada e dois números oficiais, a campanha sairia pelo número errado, sem
   erro. (E um teste com `channel_id` inválido "esperando 400" devolveria 202 e
   ENVIARIA o modelo.)

**Implementação**

- `1030_cb_funcao_de_disparo_executavel.sql`: apaga as duas formas antigas (a
  de 8 e a de 9 com `JSONB[]`), recria a de 9 com `p_template_params JSONB`,
  pareia contato × lista por **ORDINALIDADE**, qualifica o RETURNING,
  `REVOKE`/`GRANT`, `NOTIFY pgrst`. A conferência **CHAMA a função pelo caminho
  do PostgREST** na conta que tem MAIS contatos — com dois, leva listas de
  tamanhos DIFERENTES e prova o PAREAMENTO (o mutante `ON true` no lugar de
  `USING (ord)` reprova) — e desfaz a chamada num subbloco (banco vazio pula
  com NOTICE). O app não muda: chama por NOME, e o mesmo corpo é convertido para
  o tipo novo.
- `src/app/api/v1/broadcasts/route.ts`: o `channel_id` chega ao núcleo, que já
  falhava FECHADO (canal inválido = 400, nada enviado). Presente e inválido
  (número, lista, texto vazio) também é **400** — num envio em massa, "tratar
  como ausente" é a campanha saindo por um número que ninguém pediu. O 202 e o
  `GET /broadcasts/{id}` passam a dizer por QUAL número a campanha saiu.
- Pinos: `supabase/migrations/funcao-de-disparo-1030.test.ts` (lê TODO `.sql`,
  casa as quatro grafias de `CREATE FUNCTION`, cobra a forma final e proíbe
  outra assinatura fora das três históricas) e
  `src/app/api/v1/broadcasts/route.test.ts`. Os dois reprovam por MUTAÇÃO.
- `verify-schema.sql`: uma assinatura, a final, por `to_regprocedure` (mensagem
  honesta com 0, com 2 e com a assinatura errada — provado nos quatro estados).
- `CLAUDE.md`: a exceção da `041` do upstream (APAGADA, não renomeada), a regra
  3 do banco vazio (função plpgsql tem de ser CHAMADA, pelo caminho do
  PostgREST, lendo o resultado em OUTRA instrução) e duas linhas na tabela de
  divergências. `docs/public-api.md`, `docs/mcp.md` e `CHANGELOG.md` (com a **migration
  necessária**).

⚠️ **Erro meu, pego pelo teste local:** a primeira conferência lia o que a
função gravou com um `JOIN` na MESMA instrução — que não enxerga a linha recém-
inserida — e acusava a função certa. Virou regra no `CLAUDE.md`.

**Ordem desta fase (sugestão da Lente 2, adotada — é a lição da 1010):** PR em
rascunho → replay do CI VERDE no commit exato → aplicar a 1030 → teste prático
no preview → pronto para revisão → Codex → merge.

⚠️ **A janela entre aplicar a 1030 e o deploy** (achado das duas lentes): a
produção roda a rota ANTIGA contra a função NOVA. O endpoint passa a funcionar,
mas ainda ignora o `channel_id` — um id inválido devolveria 202 e enviaria pelo
único número oficial. Quem alcança isso é só a chave de teste desta fase (a
única ativa). Por isso: todo pedido do teste vai SÓ para `localhost`, e a chave
é revogada logo depois do teste, sem esperar o Codex nem o merge.

**Reversão:** `git revert` do merge; a 1030 FICA (a função antiga não
executava — não há para onde voltar). Com o revert a rota volta a descartar o
`channel_id`: revogar as chaves com `broadcasts:send`.

**Teste prático no preview:** canal inválido → 400 e nada sai; depois o disparo
de verdade (1 destinatário, o lead de teste, modelo aprovado sem variáveis, pelo
número oficial) → 202, campanha gravada COM `channel_id`, destinatário `sent`;
e a função chamada pelo PostgREST de verdade com 1 contato × 2 parâmetros →
gravado como lista. Limpeza: revogar a chave; a campanha do disparo real fica
rotulada "TESTE"; a campanha criada pela chamada direta ao PostgREST (que nasce
`sending` com destinatário `pending` e botão "Retomar" na tela) é APAGADA por
id na mesma hora.

**Resultado (21/09/2026) — ✅ validada na prática; ⚠️ um achado fora do escopo, levado à Fase 5**

| Passo | Resultado |
| --- | --- |
| Replay do CI no commit exato (`01eb764b`) | verde nas duas etapas |
| Colisão de número | nenhuma: histórico até a `1026` (sessão da Kommo); nenhum arquivo em `1027–1030` no `origin/main` nem na branch do #241 |
| Chaves de API ativas ANTES de aplicar (o pior caso da janela) | UMA no banco inteiro — a de teste desta fase |
| `1030` aplicada pela Management API | histórico **`20260921164342`**. Depois: UMA função, `(…,uuid[],jsonb,uuid)`, RETURNING qualificado e SEM o cru, `USING (ord)`, `SECURITY DEFINER`, EXECUTE só do `service_role`. A conferência CHAMOU a função no Postgres 17 da produção (a conta tem 2+ contatos → provou o pareamento lá) e não deixou nada: 0 linhas em `broadcasts` |
| Canal presente e INVÁLIDO (`42`, lista, `'   '`) | **400** `bad_request` ×3 |
| UUID inexistente · canal Evolution DA PRÓPRIA conta | **400** `meta_channel_required` ×2 |
| Depois das cinco recusas | 0 campanhas, 0 destinatários |
| Disparo REAL ao lead de teste (`lembrete_reuniao_kckkhz`, `pt_BR`, canal oficial pedido por escrito) | **202** — a primeira resposta de sucesso da história deste endpoint — com `channel_id`. No banco: campanha COM `channel_id`; destinatário = a ficha do lead (achada, não recriada); `template_params = []` como LISTA; `wamid` gravado e `sent_at` 16:45:32Z (a Meta ACEITOU). `GET /broadcasts/{id}` → 200 com `channel_id` e as contagens |
| Pelo PostgREST de verdade, 1 contato × 2 parâmetros | 200; gravado `["Ana","10h"]`, `Array.isArray` verdadeiro, contato certo; campanha apagada por id (1 linha), 0 destinatário sobrando |
| Chave de teste | REVOGADA logo depois do disparo, antes do Codex e do merge: o uso seguinte devolve 401, e o banco ficou com ZERO chaves ativas — até o deploy ninguém alcança a rota antiga da produção |

Todos os pedidos saíram de `localhost:3130`. O que ficou no banco: UMA campanha,
rotulada "TESTE Fase 2 — merge do upstream (disparo real ao lead de teste)".

⚠️⚠️ **O que o teste achou e NÃO é desta fase: a Meta ACEITOU e depois FALHOU a
entrega — e o motivo se perdeu.** Segundos depois do `sent`, o destinatário
virou `failed` (a campanha fechou `sent` com `failed_count = 1`): foi o status
`failed` da Meta chegando pelo webhook da PRODUÇÃO, que o espelha no
destinatário pelo `wamid` — o que, de quebra, provou o espelho e o gatilho de
contagem sobre uma campanha criada pela função nova. `error_message` ficou NULO:
`handleStatusUpdate` grava só o status e descarta o `errors[]`. É exatamente o
defeito da **Fase 5** (#535), agora com um caso real. O código desta mensagem
não é recuperável: o payload não é logado, e a Meta não tem consulta de status.

O que dá para afirmar, medido: o MESMO modelo foi ENTREGUE ao MESMO contato pelo
MESMO número em 12/09 22:07Z — seis minutos depois de o lead escrever, com a
janela de atendimento ABERTA. Hoje a janela está fechada (a última mensagem dele
ao número oficial é de 12/09) e o modelo é da categoria **Marketing**. Hipótese
mais provável, NÃO confirmada: os limites da própria Meta para marketing fora
da janela (a família dos códigos 131049 "engajamento saudável", 131050 "o
usuário parou o marketing desta empresa" e 130472 "número em experimento") —
falha assíncrona, decidida do lado de lá, que nenhum código nosso alcança. Não
dá para excluir outra causa (pagamento, 131042) sem o código.

**Revisão final NO LUGAR do Codex (21/09/2026).** O Codex respondeu "usage
limits" no HEAD — **não houve revisão dele neste PR**, e isso fica escrito. No
lugar, uma TERCEIRA leitura independente do diff inteiro (revisor sem o
enquadramento do autor, medindo num Postgres 16 descartável e por mutação):
**nenhum P0 nem P1**; 2 P2 e 6 P3.

| Achado | Destino |
| --- | --- |
| P2 — nenhum teste reprovava se o NÚCLEO voltasse a descartar o `channel_id` (o pino da rota mocka o núcleo inteiro: o mesmo defeito, um nível abaixo, passava 18/18) | ✅ 3 casos em `broadcast-core.test.ts`, com uma fake que CONFERE os filtros; o mutante reprova |
| P2 — `channel_id: null` sai pelo número escolhido, e a doc dizia 400 | ✅ decidido por escrito: `null` = AUSENTE (é o JSON de "sem valor", e o 202 diz qual número saiu). Doc e comentário da rota corrigidos |
| P3 — o filtro por CONTA de `resolveMetaChannel` não tinha pino (a fake devolvia a linha às cegas) — e ele é a única barreira entre contas, porque quem chama usa a service role | ✅ a fake confere os filtros; o mutante sem `.eq('account_id')` reprova |
| P3 — `resolveAuditUserId` (2 SELECTs) rodava ANTES da validação do canal | ✅ invertido, com pino |
| P3 — `verify-schema.sql`: o LIKE é literal, e a mensagem enganava quem reescrevesse a função de forma legítima | ✅ a mensagem diz as duas causas e o que fazer (provada num 5º estado) |
| P3 — doc: o 202 pode trazer `channel_id: null` (configuração legada); "account default first" era impreciso (um CONECTADO vence o padrão desconectado); o cabeçalho da rota não listava o campo; nada prendia o `channel_id` do `GET` | ✅ corrigidos; pino estrutural no `select` da rota de progresso |
| P3 — `resolveMetaChannel` descarta o `error` da busca por id (um timeout vira 400 "conecte um número", e quem integra não reenvia) e não confere `status` | ➡️ FORA deste PR — o resolvedor é compartilhado com as rotas de modelo; virou cartão próprio e, em 22/09, o item **3e** deste plano (confirmado no `main` naquele dia) |
| P3 — a função commita entradas que o app não manda (lista de contatos vazia ou com NULL) | aceito: inalcançável (o núcleo barra lista vazia e os ids vêm do banco) — guarda para cenário impossível contraria a regra da casa |
| P3 — o teto de 1000 destinatários é igual ao "Max rows" padrão do PostgREST | aceito e anotado: com o limite REDUZIDO no painel do Supabase, a RPC devolveria menos linhas do que gravou (os que sobram ficam `pending`; o "Retomar" os recupera) |

Os quatro pinos novos reprovam por MUTAÇÃO. A rota mudou só de ORDEM (validar o
canal antes de ir ao banco) — reconferida no preview pela sonda pós-deploy
apontada para `localhost`.

**Pós-deploy (21/09/2026) — ✅ conferido.** Merge `7ecb0efb` às 17:27Z; os
três jobs verdes, e o rollout deu certo na PRIMEIRA tentativa (a segunda nem
rodou), terminando às 17:33:41Z.

| Conferência | Antes do merge | Depois do deploy |
| --- | --- | --- |
| Sonda na PRODUÇÃO: `channel_id: 42` + destinatário inválido (nenhuma das duas rotas consegue enviar) | 400 "No recipients had a valid E.164…" — a rota ANTIGA ignorava o canal | **400 "'channel_id' must be a non-empty string…"** — a rota NOVA |
| `GET /api/v1/broadcasts/{id}` da campanha de teste | sem `channel_id` | **com `channel_id`** |
| Sem chave | 401 | 401 |
| Site / rota protegida | — | `login` 200 · `/inbox` 307 → `/login` |
| Crons (agendadas, automações, radar) | — | 401 nos três (503 seria env vazia) |
| Webhooks sem assinatura (Evolution e Meta) · API v1 sem chave · manifesto | — | 401 · 401 · 401 · 200 |
| Ingestão depois do rollout | — | 3 mensagens gravadas em ~3 min (1 de cliente, 2 da equipe já com recibo); as 5 conexões `connected`, atraso de entrega de segundos |
| Chaves de API ativas no banco | 0 | 0 (a sonda cria a dela em processo, por 20 min, e a revoga no `finally`) |

⚠️ **Dois registros de método desta fase:**
- A sonda que prova "a rota nova está no ar" foi desenhada para NÃO conseguir
  enviar nem contra a rota antiga (destinatário inválido) — provar deploy com um
  pedido que a versão velha executaria é como se manda mensagem por engano.
  Rodá-la ANTES do merge deu a linha de base que torna o "depois" uma prova.
- Logo depois do merge, o classificador de permissões da sessão negou até
  leitura anônima do site ("[Production Deploy]"), porque o operador tinha
  pedido "resumo e pausa" no meio do turno. Parei, relatei, e a conferência só
  rodou com a ordem explícita dele ("finalize tudo da fase 2"). Instrução nova
  no meio do turno muda o que está autorizado — inclusive o que já estava.

Ficou no banco, de propósito: UMA campanha rotulada "TESTE Fase 2 — merge do
upstream…" (`fc068dcf-…`, 1 destinatário `failed`) — é a evidência do achado da
entrega e o alvo da sonda. Apagar é decisão do operador.

**Consequência para o escritório, fora deste plano:** campanha de Marketing para
quem não escreveu nas últimas 24 h pode simplesmente não ser entregue — e hoje a
tela só diz "falhou". → Vira o teste prático da Fase 5: repetir ESTE disparo com
o motivo sendo gravado (um `failed` real, sem precisar simular).

### Fase 1b — Segurança depois do alvo (acrescentada em 23/09/2026)

**Por que existe.** Na remedição de 22/09 o original não tinha andado além de
`aee1b01f`, mas o mantenedor tinha **3 PRs de segurança ABERTOS** (não
mesclados lá, e posteriores ao alvo `80c3f9a`) — e os três valem aqui. Pedido
do operador em 23/09: seguir o plano inteiro, conferindo o que já tinha sido
corrigido desde a última medição.

**Conferido antes de mexer (23/09, `origin/main` = `f2a61293`):**

| Item | Situação | O que se fez |
| --- | --- | --- |
| #597 — link de "esqueci a senha" | ✅ JÁ CORRIGIDO pelo nosso #254 (22/09): `curl -sI https://crm.cbadvogados.com/auth/callback` → `location: https://crm.cbadvogados.com/forgot-password?erro=link` (em 22/09 era `https://0.0.0.0:3000/…`) | nada; o resto do #597 (`token_hash`/`otp_expired`, cadastro pelo callback) não se aplica — o cadastro público foi FECHADO pelo #258 |
| Cadastro público aberto (amplificava os três) | ✅ FECHADO pelo #258 (22/09, `disable_signup`) | nada; os 4 logins avulsos que já existiam seguem podendo explorar — por isso a fase continua |
| #588 — SSRF por IPv6 mapeado/6to4/NAT64 | ❌ presente (`ssrf.ts` byte-idêntico ao do original) | cherry-pick `-x` |
| Download da mídia do Instagram sem guarda (achado NOSSO de 22/09) | ❌ presente | `baixarUrlPublica` |
| #587 — rotas de automação pelo AUTOR (= achado #234 da auditoria de 22/09) | ❌ presente na medição; ✅ corrigido pelo #260 (outra sessão) no meio da fase | só o que o #260 não tinha (ver abaixo) |
| #589 (1) — conversa do contexto sem conferência de conta | ❌ presente | port à mão |
| #589 (2)/(3) — ciclo de vida dos modelos só para admin | ✅ já nosso desde 26/08 (`barrarPorPapel`) | nada |

**O que entrou (PR da Fase 1b):**

- **#588** (cherry-pick `2f5b8156`): a guarda classifica por OCTETOS e falha
  fechada. Medido antes: o único destino real que passa por ela na produção é
  um `send_webhook` de automação DESLIGADA, sem URL; nenhum webhook de saída,
  nenhum fluxo com URL — a guarda mais rígida não bloqueia nada que funciona.
- **Instagram** (`src/lib/instagram/midia.ts`): a URL do anexo vem do corpo do
  webhook, que a própria conexão assina; baixada crua, era SSRF com LEITURA
  (a resposta ia para o bucket público). Agora: só `https`, cada salto por
  `isDeliverableUrl`, redirecionamento seguido à mão (até 3). O redirecionamento
  NÃO foi desligado: não foi medido se o CDN da Meta redireciona.
- **#587** (`api/automations/[id]` e `duplicate`): ⚠️ **o conserto em si
  entrou por OUTRA sessão enquanto esta fase era feita** — o PR #260
  ("correções da auditoria", mesclado em 23/09 de manhã) resolveu o achado
  #234 com a mesma forma do #587 (conta, não autor; GET por qualquer membro,
  escrita por `requireRole('admin')`; DELETE conferindo linhas; e, de quebra,
  a duplicata copiando o "Assinar como"). O port desta fase tinha sido escrito
  em paralelo; no rebase ficou a versão do #260 (já em produção) e esta fase
  acrescentou por cima só o que faltava: o UPDATE do PATCH com a conta e as
  linhas conferidas (apagada entre a leitura e a escrita: 404, sem regravar
  passos), o comentário que ainda dizia `agent`, e pinos no teste do #260 —
  o mock dele recusava o `agent` SEM olhar o piso pedido, então um merge que
  trouxesse o `requireRole('agent')` do original passava verde.
- **#589 (1)**: `dispararAutomacoes` e `resolveConversationId` conferem a
  conversa por conta, e os QUATRO envios do robô chamam
  `assertConversationInAccount` antes do provedor (arquivo do original,
  idêntico); as prévias ganharam `.eq('account_id')`.

**Verificação local:** `typecheck` limpo; suíte **377 arquivos / 4.924
testes**; lint `✖ 59 problems (0 errors, 59 warnings)` — nenhum aviso novo nos
arquivos da fase (o único ali, `_init` em `engine.test.ts`, já existe no
`main`); portões de i18n OK. **Mutação:** 22 mutantes, todos reprovam (5 no
Instagram, 7 nas rotas, 10 no #589). Um deles (o teto de saltos) só reprovava
travando o processo — o teste foi refeito para reprovar limpo.

**Teste prático (23/09, preview `localhost:3130`, sessão do operador):**

| Caso | Resultado |
| --- | --- |
| `GET` de automação existente / de id inexistente | 200 / 404 |
| `DELETE` e `PATCH` de id inexistente | **404** (antes: `ok`) |
| Duplicar automação inativa → renomear a cópia → apagar → ler → apagar de novo | 201 (cópia inativa) → 200 → 200 → 404 → 404; banco conferido depois: 17 automações, 0 cópias, 0 passos órfãos |
| `POST /api/automations/engine` com conversa de OUTRA conta (gatilho sem automação ativa na conta — nada rodaria mesmo se a guarda falhasse) | log: `conversation not in account, refusing dispatch` |
| O mesmo com a conversa do lead de teste | segue, sem recusa |
| Guarda de SSRF contra a rede REAL | recusa `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`, NAT64, 6to4, `127.1`, `2130706433`, `0x7f.0.0.1`; aceita o CRM, `lookaside.fbsbx.com`, `graph.instagram.com`, `api.calendly.com` |
| `baixarUrlPublica` contra a rede REAL | manifesto 200; `/inbox` (307 → `/login`) seguido à mão até 200 — prova que o `fetch` do Node devolve o `Location` em `redirect: 'manual'`; `http:`, `127.0.0.1` e `localhost` recusados |

Não testável ao vivo: o admin NÃO autor (não há sessão de outro membro no
preview — coberto pelo teste com banco falso que aplica os filtros) e a DM do
Instagram (nenhuma conexão Instagram na produção).

**Revisão em duas lentes (23/09):** nenhum P0/P1. A Lente 1 mediu o que
mais importava: o `fetch` do Node 22/24 devolve o 3xx com `Location` legível
em `redirect: 'manual'` (resposta `basic`, não opaca) — a mídia que redireciona
é seguida; e todas as formas estranhas de endereço interno (decimal, octal,
hex, `127.1`, `0`) chegam à guarda já canonizadas pelo `URL` e são recusadas.

| Achado | Destino |
| --- | --- |
| P2 (as duas lentes) — o piso `admin` das rotas de automação sem pino: o mock de `requireRole` ignorava o argumento, e o #587 do original escreve `agent` nas MESMAS linhas | ✅ o teste cobra `requireRole('admin')` nas três escritas e `getCurrentAccount` no GET (mutante `'agent'` reprova) |
| P2 — o download do Instagram lia o corpo inteiro para a memória antes do teto (o webhook não traz tamanho): DoS com URL pública gigante, no processo de todas as contas | ✅ `lerComTeto` (`content-length` acima recusa sem ler; sem ele, conta durante a leitura) |
| P3 — prazo POR salto (até 80 s) e corpo do 3xx não descartado | ✅ um prazo para a cadeia; `body.cancel()` antes do próximo salto |
| P3 — o teste da retomada sem controle positivo | ✅ par com a conversa da própria conta (envia) e o detalhe da falha conferido |
| P3 — nenhum pino obriga um envio NOVO do robô a conferir a conversa | ✅ `conversation-scope.chamadores.test.ts` (estrutural, nos dois arquivos de envio) |
| P3 — comentários ainda diziam `agent` ao lado de `requireRole('admin')` | ✅ reescritos |
| P3 — DELETE de automação já apagada (lista aberta em duas telas) dava 404 e o cartão fantasma ficava | ✅ a tela fecha o diálogo e recarrega no 404 |
| P3 — o comentário de `ResultadoDoDisparo.erro` não citava a conversa | ✅ |
| P3 — o CLAUDE.md não registrava a guarda do Instagram nem o piso nosso das rotas | ✅ seção do Instagram + duas linhas na tabela do que é nosso |
| P3 — NAT64 (`64:ff9b::/32`) bloqueado inteiro; faixas IPv6 especiais (`fec0::/10`, `3fff::/20`, `::ffff:0:0:0/96`) passam — medido que não alcançam o loopback | aceito e escrito: a guarda fica IDÊNTICA à do original (divergir é conflito no merge); a VPS tem IPv4 |
| P3 — o GET é de qualquer membro: um atendente abre o construtor e só descobre no "Salvar" que não pode (403) | aceito: não é vazamento (os passos já são legíveis por membro pela RLS); construtor somente-leitura para quem não administra fica como melhoria de TELA, fora desta fase |
| P3 — "Duplicar" ignora o erro da leitura dos passos (cópia vazia com 201) e não copia o "Assinar como" | o "Assinar como" foi corrigido pelo #260; o erro dos passos ignorado é PRÉ-EXISTENTE e fica anotado no diário como follow-up |
| P3 — soluço do banco na conferência nova vira `falhou` (não reprocessável) no Calendly/webhook de entrada | pré-existente (a mesma semântica da conferência do contato); o comentário foi corrigido, a regra fica |
| **Codex no HEAD `70e77961`** (cota voltou): P2 — PATCH só com os PASSOS pulava o UPDATE e, com ele, a conferência de linhas; apagada no meio, `replaceSteps` respondia 200 com lista vazia (ou 500 pela chave estrangeira) | ✅ o PATCH só de passos também toca a linha (`updated_at`, que o gatilho `set_updated_at` regrava) — 2 casos no teste, mutante reprova |
| **Codex, 2ª rodada (HEAD `c2b43689`)**: P2 — ainda sobrava o DELETE concorrente ENTRE o UPDATE e a troca dos passos (lista vazia → 200; cheia → 500 pela chave estrangeira) | ✅ releitura por conta DEPOIS de `replaceSteps`: sumiu = 404 (3 casos, mutante reprova). Fechar de vez pediria transação (RPC + migration) para dois admins editando e apagando a mesma automação no mesmo segundo — não compensa, aceito por escrito |
| **Codex, 3ª rodada (HEAD `c51aeb36`)**: P2 — a conferência da conversa olhava só a CONTA: "contato A + conversa de B" da mesma conta passava, e o cliente A recebia o que aparece no fio de B | ✅ com contato, a conversa tem de ser DELE também — no disparo, em `resolveConversationId` e nos 4 envios (`conversation-scope.ts` passa a divergir do original; linha no CLAUDE.md). Conferido antes que todo caminho legítimo (webhook, Evolution, Calendly, régua, webhooks de entrada, execução manual, `send_to_number`) já passa a conversa do próprio contato. 3 mutantes reprovam |
| **Codex, 4ª rodada (HEAD `caf9808e`)** | nenhum achado |

**Resultado (23/09/2026):** PR #261 mesclado às 13:45Z (merge `09efcfa6`),
rollout na primeira tentativa (as três etapas do `pipeline.yml` verdes).
**Pós-deploy, só leituras anônimas da produção:** login 200; `/inbox` 307 →
login; os crons, a API v1 sem chave e os webhooks da Evolution e da Meta sem
credencial, 401; `GET`/`PATCH` de automação e `POST /api/automations/engine`
sem sessão, 401; o webhook do Instagram responde 200 a um corpo sem `object`
(é o desenho: só assinatura que não casa vale 401); `/auth/callback` sem
código → `forgot-password?erro=link`. Ingestão conferida no banco depois do
rollout: as quatro conexões da Evolution gravando mensagem nos minutos
seguintes (74 nos últimos 30 min). **FASE 1b FECHADA.**

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

**3e. O resolvedor do canal Meta — erro de banco não é "sem canal"** (achado
NOSSO, sem PR do upstream: dois P3 da revisão final do #242, deixados de fora
daquele PR porque o resolvedor é compartilhado com as rotas de modelo; era o
cartão `task_6706439b`). **Confirmado em 22/09/2026 no `origin/main`
(`ba5612ef`)**, em `src/lib/cb-channels/resolve-meta.ts`:

- **Busca por id (`:72-79`): o `error` é DESCARTADO.** Um tempo esgotado ou erro
  do PostgREST vira `null`, e o chamador responde 400 "conecte um número em
  Configurações" — e quem integra pela API não reenvia. É a regra da casa "erro
  de banco NÃO é não-encontrado" (o caso `getContactById`, seção da API pública
  do `CLAUDE.md`). ⚠️ `channel_id` com UUID MALFORMADO gera 22P02 no Postgres e
  hoje cai no mesmo ramo — esse caso TEM de continuar 400 (canal inválido):
  validar o formato ANTES (na rota ou no resolvedor) e tratar o resto como erro
  de verdade (500).
- **O mesmo descarte na LISTA e no espelho legado:** `:92` (`if (!error &&
  data)`) cai em silêncio para o `whatsapp_config` quando a lista falha, e a
  consulta do espelho (`:100-104`) também joga o `error` fora. Decidir e
  escrever o porquê.
- **Busca por id não confere o `status`** (`:79` só pergunta `utilizavel`): um
  canal Meta DESCONECTADO que ainda tem credenciais é aceito, e o disparo falha
  destinatário por destinatário. Não sai pelo número errado, mas a resposta
  poderia ser um erro claro ANTES de criar a campanha. (A busca SEM id já
  prefere `connected`, `:94`.) Decidir — recusar com motivo claro × manter — e
  escrever o porquê.

**Chamadores (7, em 6 arquivos) — hoje TODOS traduzem `null` em 400:**

| Chamador | De onde vem o canal | `null` vira |
| --- | --- | --- |
| `lib/whatsapp/broadcast-core.ts:125` (API v1 de disparos) | `channel_id` do corpo (validado na rota) | `BroadcastError('meta_channel_required', 400)` |
| `lib/whatsapp/broadcast-resume.ts:217` ("Retomar") | `broadcasts.channel_id` (NULL = campanha anterior à 903 → cai no padrão) | `BroadcastError('whatsapp_not_configured', 400)` |
| `app/api/whatsapp/broadcast/route.ts:134` (disparo pela tela) | `channel_id` do corpo, CRU | 400 "Broadcasts require an official Meta…" |
| `app/api/whatsapp/templates/submit/route.ts:171` | canal pedido | 400 "WhatsApp not configured…" |
| `app/api/whatsapp/templates/sync/route.ts:146` | `?channel_id=` | 400 "WhatsApp not configured…" |
| `app/api/whatsapp/templates/[id]/route.ts:152` (PATCH) | `channel_id` do próprio modelo | 400 |
| `app/api/whatsapp/templates/[id]/route.ts:299` (DELETE) | idem | 400 (também sem `wabaId`) |

Nenhum trata exceção vinda do resolvedor: mudar o contrato (lançar, ou devolver
um resultado com o motivo) exige ajustar os SETE na mesma passada e conferir o
`catch` de cada rota — não mudar o contrato sem isso.

**Verificação:** testes que reprovem por MUTAÇÃO (a fake de
`resolve-meta.test.ts` confere os filtros desde o #242 — os mutantes a provar:
erro engolido na busca por id, erro engolido na lista, UUID malformado virando
500, e o `status`, conforme a decisão); `typecheck`, `lint` (ler `✖ N
problems`), suíte em Node 22. Se o contrato de erro da API pública mudar (500
onde era 400, ou código novo), atualizar `docs/public-api.md` — e o `docs/mcp.md`
se a ferramenta `send_broadcast` descrever o erro. **Teste no preview:** o 500 de
erro de banco se prova no unitário (não se derruba o banco da produção);
no preview, pela API com chave de teste criada e revogada na hora: `channel_id`
malformado → 400; canal Meta desconectado → a resposta decidida, sem campanha
criada; caminho feliz → 202 (a sonda `f2-pos-deploy.mjs` da Fase 2 não envia
nada e serve de base). ⚠️ Toca `broadcast-core.ts`, que a metade aproveitável
do #586 (P9) também toca — se os dois entrarem na mesma fase, um PR só.

**Como a fase foi dividida (23/09/2026).** Com a P9 resolvida na retomada — o
`+` obrigatório do #586 NÃO entra (o escritório digita sem `+` e a nossa
`digitosDoTelefone` completa o 55 de propósito); entra a metade ADITIVA dele,
com a NOSSA régua —, a 3a deixou de ser pequena: ela passa a incluir a
normalização do telefone DIGITADO nas telas e na API. Para cada PR ter um raio
pequeno, a fase virou quatro, cada uma com revisão em duas lentes, preview,
Codex e deploy próprios:

| Sub-fase | O que entra | Estado |
| --- | --- | --- |
| **3-I** | 3b, 3c, 3d (só medir) e 3e — nada toca telefone | ✅ PR #262 |
| **3-II** | 3a (#529) + a metade aditiva do #586 NAS TELAS: formulário e ficha do contato, importação de CSV, CSV do disparo — telefone digitado sai normalizado pela nossa régua, e o inválido é CONTADO com motivo, nunca chamado de duplicata | pendente |
| **3-III** | a mesma normalização na ENTRADA da API (v1 de contatos, mensagens e disparos) e em `/api/cb/conversas/abrir`, com `docs/public-api.md` | pendente |
| **3-IV** | 3f — a CONTAGEM do público do disparo (#594) truncando em 1000 (o envio já pagina) | pendente |

**Resultado da 3-I (23/09/2026, PR #262):**

- **3b** (cherry-pick `7f42918`): o campo "Texto enviado ao cliente" do nó
  *Enviar mensagem* virou `textarea` de 3 linhas.
- **3c** (cherry-pick `a4eb921`): `META_APP_SECRET` aceita vários segredos
  separados por vírgula, cada um conferido em tempo constante; vazio ou só
  vírgulas continua recusando tudo. Só o webhook da Meta lê a variável (o do
  Instagram tem segredo próprio por conexão). `docs/multi-waba.md` foi
  REESCRITO em português para a nossa realidade (a conexão nasce em
  *Configurações → Conexões*; a tela legada que o original descreve não é
  montada aqui) e indexado no `docs/README.md`.
- **3d**: os 3 testes de regressão de tags do original passam contra o NOSSO
  `contacts.ts` (o 4º, de `serializeContact`, falha pela divergência esperada
  dos campos `instagram_*`) — fechado sem mudança; `set-contact-tags.test.ts`
  já cobre o caso.
- **3e**: o resolvedor LANÇA `ErroAoLerCanalMeta` quando a leitura falha — na
  busca por id, na lista (que antes caía em silêncio no espelho legado) e no
  próprio espelho — e os 7 chamadores já tinham `catch` que responde 500 (na
  v1, `internal`, sem o texto do banco). Id malformado (toda a classe `22` do
  Postgres) continua `null` → 400. **O `status` do canal pedido continua NÃO
  conferido, e a decisão foi escrita:** a sonda de saúde grava `disconnected` a
  qualquer erro da Meta — e só com um administrador com a tela aberta —, então
  recusar por ele barraria disparo sobre um canal que funciona.

**Verificação:** `typecheck` limpo; lint sem aviso novo nos arquivos da fase;
suíte em Node 22 verde; portões de i18n OK. **Mutação:** os pinos do 3e
reprovam os mutantes (erro engolido na busca por id, na lista e no espelho;
classe 22 virando 500; texto do banco na mensagem).

**Teste prático (preview `localhost:3130`, `next dev` com um `META_APP_SECRET`
de TESTE — dois segredos fictícios):**

| Caso | Resultado |
| --- | --- |
| Webhook da Meta LOCAL, corpo vazio assinado com o 1º segredo / com o 2º | 200 / 200 |
| Assinado com segredo errado / com a lista inteira como segredo / sem assinatura | 401 / 401 / 401 |
| 3b: fluxo rascunho "TESTE Fase 3b — apagar" (201), nó *Enviar mensagem* adicionado sem salvar | o campo é `textarea` de 3 linhas; fluxo apagado (200 → 404); banco: 0 fluxos de teste, 0 nós órfãos |
| 3e: sincronizar modelos com `channel_id` malformado / inexistente | 400 / 400, nada chamado na Meta |

O 500 por erro de banco se prova no unitário — não se derruba o banco da
produção para vê-lo.

**Revisão em duas lentes:** nenhum P0/P1.

| Achado | Destino |
| --- | --- |
| P2 (Lente 2, MEDIDO em bash) — `META_APP_SECRET=a, b` no `crm.env`, que o shell carrega com `set -a; .`, faz a variável SUMIR: o espaço termina a atribuição e todo webhook da Meta vira 401 | ✅ a doc manda escrever a lista SEM espaço e conferir com `printenv` dentro do contêiner (`.env.local.example`, `docs/multi-waba.md`, `CLAUDE.md`) |
| P2 (Lente 1) — o segredo não é amarrado ao número: um app da lista pode assinar entrega que diz ser de qualquer número | ✅ aviso escrito: só apps de confiança; a produção tem um app só |
| P3 — o motivo escrito para não conferir o `status` era FALSO | ✅ motivo corrigido (a sonda grava `disconnected` a qualquer erro); a decisão ficou |
| P3 — o texto do PostgREST chegava ao aviso na tela das rotas de modelo | ✅ mensagem genérica; o detalhe vai para o log |
| P3 — só `22P02` virava 400 | ✅ toda a classe `22` |
| P3 — "setup C" sem referência; CHANGELOG; lista de docs entregues no `CLAUDE.md`; item 10 do `multicanal-plano.md`; `META_APP_ID` descrito como se fosse medido | ✅ |
| Aceitos por escrito | as rotas de disparo e de retomada mostram "Internal server error" no lugar de "conecte um número" (mais honesto); na v1 o 500 é o contrato de erro interno |
| **Codex no HEAD `e583b291`** | nenhum achado |

**Pós-deploy:** — (a preencher)

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
⚠️ **Há um `failed` REAL à mão (achado da Fase 2, 21/09):** o disparo do modelo
de Marketing `lembrete_reuniao_kckkhz` ao lead de teste, FORA da janela de 24 h,
foi aceito pela Meta e falhou na entrega, e o motivo se perdeu porque o webhook
o descarta. Depois do deploy desta fase, repetir aquele disparo (chave de API de
teste, criada e revogada na hora) e ler o motivo gravado em
`broadcast_recipients.error_message` — é a prova de ponta a ponta com a Meta de
verdade, e responde a pergunta que a Fase 2 deixou aberta (131049? 131050?
130472? 131042?). ⚠️ O webhook que recebe esse status é o da PRODUÇÃO — por
isso só depois do deploy.

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
2026-09-DD" no `CLAUDE.md`. (O #229 já foi fechado em 21/09, decisão P1.)
⚠️ Se a P9 decidir trazer os 2 commits novos do original, o alvo do merge deixa
de ser `80c3f9a` e passa a ser o commit que os contém — e as medições da seção
2 são refeitas para a diferença.

**Resultado:** — (a preencher)

## 8. Decisões pendentes do operador

| # | Decisão | Proposta | Trava qual fase |
| --- | --- | --- | --- |
| P1 | ~~Fechar o #229 agora (com comentário apontando para este plano) ou só no fim~~ | ✅ FECHADO em 21/09/2026 por ordem do operador ("siga com sua orientação e feche o PR, mantendo a worktree do plano com todas as correções ainda pendentes — pra que possamos ir corrigindo por aqui") | — |
| P2 | Notificação: respeitar o perfil e deixar grupo de fora | Sim | 8 |
| P3 | Apagar `pt.json`/`es.json` depois de aproveitar as traduções | Sim | 10 |
| P4 | BSUID: `NULL` + CHECK alargado, em vez de `''` | `NULL` | 11 |
| P5 | ~~Testes com efeito externo: modelo tarifado ao lead de teste (F2), modelo de teste na WABA (F6a), mensagem ao número oficial (F9)~~ | ✅ delegado pelo operador em 21/09 ("faça você o que precisar ser feito para o teste prático no preview e2e") — eu executo e limpo o que cada teste criar | — |
| P6 | Alguma fase a DESCARTAR? (a 9 é inerte hoje) | Manter todas | — |
| P7 | `agentRules: false` (o `next dev` da 16.3 não reescreve o `AGENTS.md`) — ou aceitar o bloco que o Next gera e commitá-lo | Manter desligado | nenhuma (já aplicado na Fase 1, reversível em uma linha) |
| P8 | ~~Restaurar para 4 as não lidas da conversa que o teste da Fase 1 abriu por engano~~ | ✅ feito em 21/09 (o operador: "faça o que precisar para o teste prático e2e") | — |
| P9 | Os 2 commits que o original publicou DEPOIS do alvo (`b9969fa2` #586 e `f8a1cc72`): fase extra antes do fechamento, ou próximo ciclo? | A decidir na retomada. ⚠️ O #586 **exige `+` e código do país** em telefone digitado e na API — a nossa regra (`digitosDoTelefone`) faz o contrário de propósito: completa o 55 no número brasileiro sem `+`, que é como o escritório digita. E ele mexe nos MESMOS arquivos da Fase 3a (`dedupe.ts`, `import-modal.tsx`, `broadcast-csv.ts`) e no `broadcast-core.ts` da Fase 2. Medir contra o nosso código antes de qualquer coisa | 3a (se entrar junto) ou 12 |

## 9. Diário

| Data | Fase | O que aconteceu |
| --- | --- | --- |
| 21/09/2026 | 0 | Medições da seção 2; estratégia "portar primeiro"; worktree criada; o #232 entrou no `main` no meio da medição sem mudar os conflitos. Linha de base: 362 arquivos / 4.710 testes verdes; `npm audit` com 12 vulnerabilidades (1 crítica). |
| 21/09/2026 | 1 | Dependências do upstream aplicadas: `npm audit` 12 → 0. As duas lentes não acharam P0. A Lente 2 pegou o `next dev` da 16.3 reescrevendo o `AGENTS.md` (→ `agentRules: false`). A Lente 1 mostrou que o teste em `next dev` não exercitava o roteador novo (→ refeito num build de produção local: limpo). Dois erros MEUS de teste viraram regra do protocolo: abrir conversa de cliente real zera as não lidas, e painel oculto congela o `requestAnimationFrame`. |
| 21/09/2026 | 2 | A função de disparo NUNCA tinha executado (42702) — e as duas lentes acharam o que o upstream não tem: os parâmetros por destinatário chegavam em 2-D pelo PostgREST (Lente 1) e a rota descartava o `channel_id` (Lente 2). Na 2ª passada, a Lente 1 derrubou uma medição MINHA ("23502") feita num dublê com `NOT NULL` que a produção não tem. Ordem com migration: rascunho → replay verde no commit exato → `1030` aplicada (`20260921164342`) → teste prático: 5 recusas em 400 sem gravar nada, o PRIMEIRO 202 do endpoint, params como lista pelo PostgREST real → chave de teste revogada na hora (0 chaves ativas). Achado fora do escopo: a Meta aceitou e depois falhou a ENTREGA do modelo de Marketing fora da janela, e o motivo se perdeu — é o defeito da Fase 5, que ganhou um caso de teste real. |
| 21/09/2026 | 2 (fecho) | Codex SEM COTA no HEAD → terceira revisão independente no lugar dele: nenhum P0/P1; os 2 P2 e 3 P3 corrigidos (pino do salto núcleo → resolvedor, `null` = ausente, ordem da validação, mensagem do `verify-schema`, doc), 1 P3 corrigido em parte (o pino do filtro por conta entrou; o `error` descartado e o `status` não conferido de `resolveMetaChannel` viraram cartão) e 2 P3 aceitos por escrito. Merge 17:27Z, rollout 17:33Z na primeira tentativa. Pós-deploy: a sonda inverteu (rota antiga → rota nova; `GET` sem → com `channel_id`), saúde e ingestão conferidas, zero chaves ativas. **Operador pediu pausa antes da Fase 3.** |
| 21/09/2026 | 0 (P1) | **#229 FECHADO** por ordem do operador, com comentário explicando por que não podia ser mesclado (origem = o `main` do próprio original; conteúdo que muda sozinho; 19 PRs num deploy só) e apontando para este plano. A worktree fica de pé para as correções seguirem por aqui. Na conferência, o original tinha ANDADO: `upstream/main` = `aee1b01f`, 2 commits depois do alvo — o #586 (exige `+` e código do país; 21 arquivos, vários da Fase 3a) virou a decisão P9. |
| 22/09/2026 | 3 (plano) | A pedido do operador, o cartão do `resolveMetaChannel` (P3 da revisão final do #242) entrou no plano como **item 3e**, depois de confirmado no `origin/main` (`ba5612ef`): o `error` descartado na busca por id, na lista e no espelho, e o `status` não conferido. Levantados os 7 chamadores (6 arquivos), todos traduzindo `null` em 400. Nada implementado — a pausa antes da Fase 3 continua. |
| 23/09/2026 | 1b | Acrescentada a pedido do operador ("siga agora com todo o plano"): os 3 PRs de segurança ABERTOS do mantenedor valiam aqui, e o download da mídia do Instagram tinha SSRF com leitura. O #587 foi resolvido no meio da fase por OUTRA sessão (#260); ficou a versão dela, e esta fase acrescentou o que faltava. Quatro rodadas do Codex (3 com P2, todos corrigidos; a 4ª limpa). Mesclada e publicada; pós-deploy conferido. |
| 23/09/2026 | 3-I | A P9 resolvida (a metade aditiva do #586, com a nossa régua) partiu a Fase 3 em quatro. 3b/3c/3e entraram, a 3d fechou sem mudança. A Lente 2 MEDIU em bash que `a, b` no `crm.env` apaga o `META_APP_SECRET` inteiro (401 em todo webhook) → a doc manda escrever sem espaço. Codex limpo na 1ª rodada. |

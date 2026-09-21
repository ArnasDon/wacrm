# PLANO — CB-CRM como produto vendável (venda repetida, self-hosted pelo comprador)

**Data do levantamento:** 2026-09-08 · **Branch:** `claude/codigo-terceiros-vendavel-vxhn1m` ·
**Estado:** plano aprovado para aplicação futura, nada executado ainda.

> Este documento é INTERNO. Ele próprio entra na lista do que não é entregue
> ao comprador (Fase 4.4), porque descreve a nossa produção e o nosso
> repositório. Ao executar cada item, marque-o aqui e registre a data: o
> plano é a trilha do que foi feito, não só do que se pretende fazer.

## 0. Estado da execução (2026-09-08)

Aplicado o que NÃO depende de fechar o repositório. Tudo verde: lint sem
erro, typecheck, 2.832 testes, os dois portões de i18n e o build.

| Fase | Estado | O que ficou de fora |
|---|---|---|
| 0 — fechar o repositório | **não iniciada** | decisão do operador (D1) |
| 1 — infraestrutura parametrizada | **só o 1.6** (comentários e fixtures) | 1.1 a 1.5 exigem janela e `stack deploy` |
| 2 — buracos funcionais | **feita** | — |
| 3 — marca configurável | **feita** | 3.3 entregue como `NEXT_PUBLIC_APP_LOGO_URL`, não como detecção de arquivo |
| 4 — documentação | **feita** | 4.4 (tirar `docs/PLANO-*` e infra da árvore) e 4.5 (`ARQUITETURA.md` saneado) |
| 5 — portão de migrations | **feita** | a validação de instalação limpa exige Supabase e número de teste |
| 6.2 — portão de strings | **feita** | escopo estreito: `src/`, `messages/`, `supabase/`, raiz |
| 6.1, 6.3–6.5, 7 | **não iniciadas** | dependem de D2, D3 e da Fase 0 |

**Decisões respondidas pelo operador:** a venda será **repetida**, para
compradores diferentes. Isso mantém a Fase 5 (D-modelo) no escopo e torna
a Fase 6.1 (repositório do produto) e a 7 (instalador) necessárias, não
opcionais.

**Decisões ainda abertas:** D1 (como privar), D2 (como o comprador
recebe), D3 (licença das adições), D4 (nome do produto — hoje o padrão no
código é o genérico `CRM` e a nossa produção passa `NEXT_PUBLIC_APP_NAME`
pelo build-arg), D6 (segundo caminho de deploy), D7 (Supabase do
comprador), D8 (`CLAUDE.md` saneado).

**D5 foi respondida na prática:** o `ko.json` foi removido.

### O que foi entregue

- `src/lib/auth/destino-seguro.ts` (+teste), `src/app/auth/callback/route.ts`
  e `src/app/(auth)/reset-password/page.tsx` — a recuperação de senha, que
  não existia. `forgot-password` ganhou o aviso de link vencido.
- `.env.local.example` com as três variáveis da Evolution, mais
  `NEXT_PUBLIC_APP_NAME` e `NEXT_PUBLIC_APP_LOGO_URL`, e
  `scripts/env-documentado.test.ts` cobrando a cobertura.
- O fallback para o domínio de marketing do upstream saiu de
  `invitations/route.ts`: agora falha ANTES do insert, nomeando a variável.
- `messages/ko.json` apagado.
- `src/lib/marca.ts`, com `layout.tsx` e `sidebar.tsx` lendo dele;
  `Sidebar.title` removida dos dicionários; as 9 chaves com marca
  reescritas; `NEXT_PUBLIC_APP_NAME` como build-arg no `Dockerfile`, no
  `pipeline.yml` e no `docker-compose.yml`.
- `.github/` inteiro reapontado (CODEOWNERS, SECURITY, CODE_OF_CONDUCT,
  templates, dependabot); o asset da Hostinger removido.
- `needs: [verificar, migrations]` no `pipeline.yml`, com pino em
  `pipeline.test.ts`.
- `scripts/produto-gate.test.ts`.
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/README.md`,
  `docs/INSTALACAO.md`, `docs/ATUALIZAR.md`; `docs/SETUP-PRODUCAO.md`
  apagado.
- `CLAUDE.md`: quatro afirmações stale corrigidas e um bloco novo com as
  regras da marca, do portão de strings, do portão de env e do par de
  rotas de recuperação de senha.

---

## 1. Objetivo

Deixar o CB-CRM em condição de ser vendido **várias vezes**, para compradores
diferentes, cada um instalando **na própria VPS e no próprio projeto
Supabase**, a partir do código-fonte, sem depender de nada nosso (nem da nossa
infraestrutura, nem do nosso registro de imagens, nem de suporte por
telefone) e continuando a receber as nossas atualizações por `git merge`.

"Pronto para vender" significa, concretamente, que um técnico competente que
nunca falou conosco consegue: (1) obter o código sem ver nada do escritório;
(2) seguir um guia único e chegar a uma instalação funcionando, com WhatsApp
conectado; (3) trocar nome, domínio e idioma sem editar código; (4) puxar uma
versão nova nossa e aplicá-la sem quebrar o que customizou; (5) reportar
problema para NÓS, e não para o autor do template original.

## 2. Contexto: o que foi medido

O levantamento cobriu o repositório inteiro (437 commits, 122 migrations,
3.070 chaves de i18n), a API do GitHub, as cinco últimas execuções do CI no
`main` e uma instalação de dependências a partir de clone virgem.

### 2.1 Achados confirmados, com evidência

| # | Achado | Evidência | Gravidade |
|---|---|---|---|
| A1 | O repositório é **público** e é **fork** de `ArnasDon/wacrm` | API do GitHub: `private: false`, `fork: true`, 0 stars, 0 forks, 0 issues | Bloqueante comercial |
| A2 | Nenhum segredo jamais foi commitado | `.gitignore:37` cobre `.env*` desde o início; varredura do histórico completo sem chave de service-role, token da Meta ou API key literal | Bom (nada a rotacionar) |
| A3 | A infraestrutura do escritório está escrita em **15 arquivos** | `docker-stack.yml` (10 ocorrências), `docs/INFRA-VPS.md` (25), `docs/DEPLOY-VPS.md` (10), `pipeline.yml` (3), `evolution-lid-fix.yml`, `.mcp.json`, `docker/evolution-lid-fix/Dockerfile`, `scripts/vps-inventario.sh`, `ops/vps/README.md`, `evolution_localhost.md`, `docs/EVOLUTION-LID-FIX.md`, `docs/SETUP-PRODUCAO.md`, mais 3 comentários em código | Alta |
| A4 | Três variáveis que o código lê **não estão** no `.env.local.example` | `EVOLUTION_BASE_URL`, `EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` (lidas em `src/lib/whatsapp/transport/` e no webhook da Evolution) | Alta: sem elas o WhatsApp não conecta e o guia não avisa |
| A5 | **Recuperação de senha quebrada** | `src/app/(auth)/forgot-password/page.tsx:33` redireciona para `/auth/callback?next=/reset-password`; nenhuma das duas rotas existe em `src/app/` | Alta: defeito de produto |
| A6 | A marca está em três lugares e discorda | `src/app/layout.tsx:25-28` ("CB Advogados CRM", direto no código); 9 chaves de dicionário com "CB Advogados" ou "wacrm"; `src/app/icon.tsx` roxo Hostinger; `package.json` `name: wacrm` | Alta para white-label |
| A7 | Link de convite cai em domínio de terceiro | `src/app/api/account/invitations/route.ts:134` → `return "https://wacrm.tech"` quando não deriva o host | Média (nunca dispara com `SITE_URL` setada) |
| A8 | `README`, `CONTRIBUTING`, `CHANGELOG` e `.github/*` são do upstream | README descreve "wacrm" para Hostinger + Meta Cloud API; `CODEOWNERS` = `@ArnasDon`; `SECURITY.md` manda reportar para `a.donauskas@hostinger.com`; `ISSUE_TEMPLATE/config.yml` aponta para docs do wacrm; `CONTRIBUTING.md` linka `docs/README.md`, que não existe | Alta: é o que o comprador lê primeiro |
| A9 | `docs/SETUP-PRODUCAO.md` está errado | Manda instalar na Hostinger; afirma que só existem `en`/`ko` e que pt-BR "exigiria criar `messages/pt-BR.json`" (existe e é o servido); lista pendências já resolvidas | Alta |
| A10 | `ko.json` é armadilha | 1.472 chaves contra 3.070 de `en`/`pt-BR`; `src/i18n/request.ts` carrega o arquivo se existir, então `NEXT_PUBLIC_APP_LOCALE=ko` entrega metade da tela como chave crua | Média |
| A11 | Cada comprador precisa **construir a própria imagem** | `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` são lidas no navegador (`src/lib/supabase/client.ts`) e inlinadas no build | Restrição de arquitetura, não defeito; tem de estar escrita |
| A12 | `NEXT_PUBLIC_SITE_URL` é lida **só no servidor** | Os cinco leitores são rotas de API e módulos de `lib` (`invitations/route.ts:95`, `cb-channels/evolution-admin.ts:95`, `cb-channels/webhook-url.ts`, `calendly/conexao.ts:37`, `automations/engine.ts:1707`); nenhum componente cliente | Oportunidade: pode virar runtime |
| A13 | A Evolution de produção é imagem **derivada nossa** | `docker/evolution-lid-fix/Dockerfile` (patch de uma linha na Baileys); publicada em `ghcr.io/leonardocabralb/evolution-api-lidfix` por `evolution-lid-fix.yml:34` | Alta: sem ela 83% dos ecos do celular somem |
| A14 | Fuso, expediente e moeda estão fixos em código | `cb-radar/horario-comercial.ts` (`-03:00`, seg–sex 08h–19h), `agenda/fuso.ts:28` e `calendly/variaveis.ts:17` (`America/Sao_Paulo`), `currency.ts:35` (`pt-BR`) | Baixa para venda no Brasil; backlog |
| A15 | Não há versão do produto | Nenhuma tag git; `package.json` 0.8.0 e `CHANGELOG.md` 0.8.1, ambos do upstream | Média: sem isso não há "atualização" |
| A16 | O pacote no GHCR provavelmente está **público** | Publicado com `GITHUB_TOKEN` a partir de repositório público; conferir em `github.com/leonardocabralb?tab=packages` | Alta: a imagem pronta do produto pode ser puxada por qualquer um |
| A17 | O CLAUDE.md afirma o contrário do CI sobre migrations | CLAUDE.md e `pipeline.yml` dizem que as migrations "nunca foram escritas para reaplicar do zero"; a etapa "Apply to a clean database" está VERDE nas cinco últimas execuções do `main` (run 34213847287 e anteriores) | Baixa: nota stale, mas segura um portão que já poderia existir |

### 2.2 O que já está pronto (e não deve ser mexido)

O banco **reconstrói do zero**: a etapa `migrations` do CI sobe um Postgres
vazio, reaplica as 122 migrations em ordem e valida o schema. As extensões
(`uuid-ossp`, `btree_gist`, `pg_trgm`, `unaccent`, `vector`), os buckets de
Storage e a publicação realtime são criados pelas próprias migrations.

O código **não tem nada amarrado à nossa conta**: zero UUID fixo fora de
teste, zero dado nosso em migration.

A **conta nasce sozinha** no cadastro: o trigger `handle_new_user` (017) cria
`accounts` e `profiles` com papel `owner` na mesma transação.

O **inglês está completo**: `en.json` e `pt-BR.json` em paridade total
(3.070/3.070), com dois scripts de portão no CI.

`npm ci` roda limpo de clone virgem; lint, typecheck, testes e build verdes.

## 3. Decisões que dependem do operador

Cada uma trava uma fase. Registrar a resposta aqui antes de executar a fase.

**D1 — Como privar o repositório.** Caminho A (duplicar para repositório
privado novo e apagar o fork; self-service, 20 min, perde issues/PRs, que são
zero) ou Caminho B (pedir ao suporte do GitHub para desanexar o fork e depois
trocar a visibilidade; preserva tudo, leva dias). **Recomendação: A.**
Comandos no Apêndice B.

**D2 — O que o comprador recebe.** (a) Espelho completo do nosso repositório
(histórico e documentos internos inclusos: simples, mas entrega tudo);
(b) tarball por versão sem histórico (limpo, mas atualizar vira colar
arquivo); (c) um SEGUNDO repositório privado, `cb-crm-produto`, gerado do
`main` por workflow com lista de exclusão e histórico próprio, que o comprador
espelha e usa como `upstream` dele, exatamente como nós usamos o wacrm.
**Recomendação: (c).** Detalhes na Fase 6.1.

**D3 — Licença das nossas adições.** O upstream é MIT, o que permite vender e
sublicenciar, mas não impede o comprador de redistribuir o que recebeu. Para
venda repetida é preciso decidir os termos das nossas adições (licença
proprietária + contrato) e manter a nota de copyright do upstream. Este plano
reserva o lugar (`LICENSE` + `NOTICE`, Fase 6.5) e **não redige** o texto:
isso é seu.

**D4 — Nome do produto.** O nome padrão quando não é "CB Advogados CRM"
(valor de `NEXT_PUBLIC_APP_NAME`, nome em `package.json`, nome do repositório
produto). Sem isso a Fase 3 não fecha.

**D5 — `ko.json`.** Remover (recomendado; merge do upstream o traz de volta e
o CLAUDE.md passa a mandar apagar) ou completar (1.600 chaves a traduzir para
um idioma que ninguém pediu).

**D6 — Segundo caminho de deploy.** Manter só Swarm + Traefik (o que está
provado em produção) ou oferecer também `docker compose` + Caddy (TLS
automático, muito mais simples para quem tem uma VPS só). Cada caminho a mais
é um caminho a mais para dar suporte. **Recomendação: Swarm na v1.0, compose
como item do backlog** (Fase 7.3).

**D7 — Supabase do comprador.** Confirmar que cada comprador cria o PRÓPRIO
projeto Supabase (BYO). Hospedar nós para eles é outro produto (multi-tenant)
e não está neste plano.

**D8 — O que fazer com o CLAUDE.md.** Não entregar nada (o comprador fica sem
a memória das armadilhas), ou entregar uma versão saneada como
`docs/ARQUITETURA.md` (aumenta o valor percebido e reduz suporte, mas exige
curadoria a cada versão). **Recomendação: versão saneada, gerada com
critério na Fase 4.5.**

## 4. Princípios de execução

**Toda mudança de infraestrutura tem raio de explosão em produção**, porque o
`git push origin main` publica e porque `docker-stack.yml` só entra em vigor
com `docker stack deploy` manual na VPS. Por isso:

1. Mudança de código que muda comportamento entra com **fallback para o
   valor antigo** e o valor antigo é removido numa versão posterior. Renomear
   variável de ambiente é o caso típico: ler o nome novo E o velho.
2. Mudança em `docker-stack.yml` é aplicada **numa janela**, com o `crm.env`
   atualizado ANTES, com `CRM_IMAGE` fixado do `.Spec.TaskTemplate.
   ContainerSpec.Image` (nunca do rótulo) e com o preflight da Fase 1.5
   rodado antes. Reversão: `git checkout` do arquivo anterior + mesmo
   `stack deploy`.
3. Mudança em `pipeline.yml` é validada em PR (os jobs `verificar` e
   `migrations` rodam em PR; `deploy` só no `main`), e a primeira execução no
   `main` é acompanhada até o fim, com conferência pós-deploy (site 200,
   idioma certo, `printenv` dentro do container).
4. Documentação não tem raio de explosão em produção, mas tem no COMPRADOR:
   guia errado vira instalação errada. A Fase 5 existe para provar o guia
   seguindo-o ao pé da letra.
5. Nada que afete o comprador se considera pronto sem passar pelo gate de
   strings proibidas (Fase 6.2): `cbadvogados`, `CBAdvNet`, `82.25.76.63`,
   `hxnhakmyxyhalbsktzwe`, `leonardocabralb`, `a.donauskas`, `ArnasDon`.

## 5. Fases

Cada item traz **Objetivo**, **Contexto**, **Mudança**, **Resultado
esperado**, **Risco e raio de explosão**, **Validação** e **Reversão**.

---

### Fase 0 — Fechar o repositório (sem mudança de código)

**Objetivo.** Parar a exposição pública imediatamente. É pré-requisito de
todo o resto: investir nas fases seguintes com o código público é preparar um
produto que qualquer um já baixa de graça.

**Contexto.** A1, A2, A16. O GitHub não permite mudar a visibilidade de um
fork; a opção não aparece no Danger Zone. A relação de fork NÃO é o que traz
as atualizações do original: isso é feito por um remote git comum (`upstream`),
que o CLAUDE.md já documenta e que funciona igual num repositório privado.
Nenhum segredo foi commitado, então não há rotação de credencial.

**Mudança.** Executar o Caminho A (Apêndice B) ou o B, conforme D1. Em
qualquer caso, na ORDEM abaixo, porque a ordem é o que evita o deploy quebrado:

1. Criar um PAT com `read:packages` e fazer `docker login ghcr.io` na VPS
   como o usuário que o `pipeline.yml` usa por SSH. Conferir com
   `docker pull ghcr.io/leonardocabralb/cb-crm:latest`.
2. Só então mudar o pacote `cb-crm` (e `evolution-api-lidfix`) para privado
   em `github.com/leonardocabralb?tab=packages`.
3. Duplicar/desanexar o repositório. Repor os cinco segredos do Actions
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `VPS_SSH_HOST`, `VPS_SSH_USER`, `VPS_SSH_KEY`). Segredo não viaja no
   mirror. Recriar a regra de proteção do `main` se houver.
4. Push de teste numa branch; conferir que `verificar` e `migrations` rodam.
5. Mesclar um PR trivial no `main` e acompanhar o `deploy` até o
   `docker service update` terminar. É a única prova de que o pull privado
   funciona.
6. Apagar o fork antigo.

**Resultado esperado.** Repositório privado, não-fork, com o remote
`upstream` apontando para `ArnasDon/wacrm`, CI publicando no GHCR privado, VPS
puxando com autenticação, e o fluxo de merge do upstream inalterado.

**Risco e raio de explosão.** O passo 2 antes do passo 1 faz o próximo deploy
falhar no pull; o `failure_action: rollback` mantém a versão antiga no ar, mas
o `main` fica à frente da produção em silêncio. Segredo esquecido no passo 3
faz o `deploy` falhar alto (bom) ou o build inlinar URL vazia do Supabase
(ruim, e só aparece na tela de login). O que já esteve público continua
acessível a quem guardou a referência: objetos de uma rede de forks são
compartilhados e apagar o fork não os purga. Não há o que rotacionar (A2); o
que fica exposto é IP, domínio e arquitetura.

**Validação.** `docker service inspect crm_crm` mostrando a imagem do commit
mesclado no passo 5; `curl -I https://crm.cbadvogados.com/login` 200; o
pacote listado como Private.

**Reversão.** Não há: o fork antigo, uma vez apagado, não volta. Por isso o
passo 6 é o último e só depois do 5 verde.

---

### Fase 1 — Infraestrutura parametrizada

#### 1.1 `docker-stack.yml` sem nada do escritório

**Objetivo.** O mesmo arquivo servir a qualquer comprador só com o `crm.env`
diferente.

**Contexto.** A3. Hoje: `NEXT_PUBLIC_SITE_URL: https://crm.cbadvogados.com`
(chumbado, não `${...}`), `Host(\`crm.cbadvogados.com\`)` na regra do Traefik,
`CBAdvNet` na rede e no rótulo, `letsencryptresolver`, `pt-BR` e a imagem
`ghcr.io/leonardocabralb/cb-crm:latest` como default do `CRM_IMAGE`.

**Mudança.** Substituir por `${CRM_DOMAIN}`, `${CRM_NETWORK}`,
`${CRM_CERT_RESOLVER}`, `${CRM_LOCALE}` e `${CRM_IMAGE}`, **todas sem
default**: vazio tem de falhar no preflight (1.5), nunca cair num valor
"neutro". Resolver de certificado com nome errado faz o Traefik servir o
certificado padrão sem erro na tela; locale ausente vira `en` pela lógica do
`request.ts` (que lê a variável em RUNTIME, não só no build). Os dois são
a classe de defeito que responde 200 e está quebrado.
`SITE_URL` passa a vir de `${SITE_URL}` (ver 1.3), mantendo
`NEXT_PUBLIC_SITE_URL: ${SITE_URL}` por uma versão. Reescrever o cabeçalho do
arquivo (hoje diz "Values below match THIS VPS's Traefik") em termos
genéricos, movendo o que é nosso para `docs/INFRA-VPS.md`.

**Resultado esperado.** `grep cbadvogados docker-stack.yml` vazio; a nossa
produção sobe com o `crm.env` acrescido das cinco variáveis novas.

**Risco e raio de explosão.** ALTO se aplicado fora de ordem. `docker stack
deploy` com `CRM_DOMAIN` vazio gera `Host(\`\`)` e o Traefik deixa de rotear:
site fora do ar até o redeploy. `CRM_NETWORK` vazio faz o deploy falhar alto
(rede "" inexistente), que é o caso bom. `CRM_LOCALE` vazio sem default cairia
em `en` pela lógica do `request.ts`: produção em inglês, o incidente de
2026-07-25 de novo. É exatamente a classe do incidente de 2026-08-27 (deploy
sem `crm.env` carregado zerou todos os segredos com o site respondendo 200).
O agendador reinicia junto; agendadas em fila não se perdem (a reivindicação é
no banco).

**Validação.** Preflight (1.5) verde; após o deploy, `docker service inspect
crm_crm --format '{{json .Spec.Labels}}'` com o domínio certo,
`docker exec <cid> printenv SITE_URL`, site 200, uma agendada de teste saindo
no ciclo seguinte.

**Reversão.** `git checkout HEAD~1 -- docker-stack.yml` e o mesmo `stack
deploy` com o mesmo `crm.env` (as variáveis a mais não atrapalham).

#### 1.2 `pipeline.yml`: imagem e build-args vindos do repositório, não do arquivo

**Objetivo.** O workflow funcionar no repositório de qualquer comprador sem
edição.

**Contexto.** A3. `env: IMAGE: ghcr.io/leonardocabralb/cb-crm` e os build-args
`NEXT_PUBLIC_SITE_URL=https://crm.cbadvogados.com` e
`NEXT_PUBLIC_APP_LOCALE=pt-BR` estão escritos no arquivo. O comentário do
topo diz "o repositório é leonardocabralb/CB-CRM".

**Mudança.** `IMAGE` derivado de `${{ github.repository }}` em minúsculas
(um passo que exporta para `$GITHUB_ENV`, porque o GHCR exige minúsculas e o
nome do repositório não é). Locale e nome do app vindos de **variáveis de
repositório** (`vars.CRM_LOCALE`, `vars.CRM_APP_NAME`), com default na
expressão: `${{ vars.CRM_LOCALE || 'pt-BR' }}` para nós; o comprador define
as dele. `NEXT_PUBLIC_SITE_URL` sai dos build-args (1.3). O nome do serviço
Swarm (`crm_crm`) e o resto do `ROLLOUT_SCRIPT` ficam: são convenção do
stack, não do escritório, e mudam junto se o comprador renomear o stack.

**Resultado esperado.** O `pipeline.yml` do comprador é idêntico ao nosso; o
que difere está em Settings → Secrets and variables.

**Risco e raio de explosão.** MÉDIO. Build-arg vazio NÃO cai no default do
Dockerfile (`ARG NEXT_PUBLIC_APP_LOCALE=pt-BR` só vale se o arg não for
passado): `--build-arg X=` sobrescreve com string vazia, e o `request.ts`
resolve `'' || 'en'`. Daí o default na expressão do workflow, e não confiar
no do Dockerfile. O job `deploy` só roda no `main`: a primeira prova é um
push real. Se a imagem for construída errada, o rollout publica uma produção
em inglês com site 200.

**Validação.** PR verde; após o merge, `curl -s https://crm.cbadvogados.com/login
| grep -o 'lang="[^"]*"'` = `pt-BR` e um texto em português na página; a
imagem no GHCR com a tag do SHA.

**Reversão.** Reverter o commit; o deploy seguinte reconstrói com os valores
antigos.

#### 1.3 `NEXT_PUBLIC_SITE_URL` vira `SITE_URL`, lida em runtime

**Objetivo.** Trocar de domínio sem rebuild, e tirar um build-arg do caminho
do comprador.

**Contexto.** A12: os cinco leitores são server-side. O prefixo
`NEXT_PUBLIC_` só existe por herança do upstream, e custa um rebuild a cada
mudança de domínio. A `evolution-admin.ts:95` usa essa variável para montar
a URL do webhook ao provisionar instância; `calendly/conexao.ts:37` para
assinar o webhook do Calendly; `engine.ts:1707` para links absolutos; a rota
de convites para o link do convite.

**Mudança.** Criar `src/lib/site-url.ts` com uma função única que lê
`SITE_URL ?? NEXT_PUBLIC_SITE_URL`, aparando a barra final, e trocar os cinco
leitores por ela (o `webhook-url.ts:184` e a mensagem de erro de
`evolution-admin.ts:97` passam a citar `SITE_URL`). Dockerfile: remover o
`ARG`/`ENV` de `NEXT_PUBLIC_SITE_URL`. `.env.local.example`: documentar
`SITE_URL` e marcar a antiga como obsoleta por uma versão. `docker-stack.yml`
passa as duas por uma versão (1.1). Remover a leitura do nome antigo em
`v1.1`.

**Resultado esperado.** Produção lendo `SITE_URL` do `crm.env`; nenhum
webhook re-registrado (os já registrados na Evolution e no Calendly guardam
a URL absoluta e continuam válidos).

**Risco e raio de explosão.** BAIXO com o fallback; ALTO sem ele. Sem
fallback e com o `crm.env` não atualizado: provisionar canal novo falha com
"SITE_URL não está configurado", reassinar o Calendly falha, os links das
automações saem relativos. Mensagens em trânsito não são afetadas. Há teste
em `src/lib/cb-channels/webhook-url.test.ts` que cita o domínio do escritório
e vai precisar de ajuste.

**Validação.** Testes; em produção, abrir Conexões → Ressincronizar num canal
e conferir a URL de webhook que a Evolution mostra no manager.

**Reversão.** O fallback garante que o nome antigo continua funcionando;
reverter o commit basta.

#### 1.4 `evolution-lid-fix.yml` e o Dockerfile derivado

**Objetivo.** O comprador construir a própria imagem da Evolution corrigida
no próprio registro.

**Contexto.** A13. A imagem existe porque a Evolution 2.3.2 embarca a Baileys
6.7.19, que ignora `peer_recipient_pn` no eco do celular pareado; o patch é
uma linha. `IMAGE: ghcr.io/leonardocabralb/evolution-api-lidfix` está
chumbado em `evolution-lid-fix.yml:34`, e os comentários do Dockerfile falam
"da instância do escritório".

**Mudança.** `IMAGE` derivado de `${{ github.repository_owner }}`; comentários
do Dockerfile reescritos em termos do problema, não da nossa instância. E um
item de verificação na Fase 5: **testar a Evolution mais recente sem o patch**.
O PR WhiskeySockets/Baileys#1654 foi aceito em 2025-09-07; uma Evolution
publicada depois de a Baileys 7.x estabilizar pode já não precisar do patch,
e aí o comprador novo não precisa dessa imagem. Só a medição responde.

**Resultado esperado.** O comprador roda o workflow com `base_image` e `tag`
e obtém `ghcr.io/<ele>/evolution-api-lidfix:<tag>`; ou, se a Fase 5 provar
que a Evolution atual já lê `senderPn` no eco, o guia diz "use a oficial".

**Risco e raio de explosão.** Nenhum em produção (workflow manual; a nossa
Evolution não muda). Risco de DOCUMENTAÇÃO: afirmar que o patch é necessário
quando não é faz o comprador manter um fork de imagem à toa; afirmar que não
é quando é faz ele perder 83% dos ecos sem erro nenhum.

**Validação.** Fase 5.

**Reversão.** N/A.

#### 1.5 Preflight de deploy

**Objetivo.** Impedir o `docker stack deploy` com variável vazia, para nós e
para o comprador.

**Contexto.** O incidente de 2026-08-27 (CLAUDE.md, seção Deploy): `${VAR}`
ausente vira string vazia sem erro, o site responde 200 e o servidor inteiro
fica sem credencial. A 1.1 acrescenta cinco variáveis novas ao mesmo
mecanismo, então a janela para esse erro aumenta.

**Mudança.** `scripts/deploy-preflight.sh`: extrai todo `${NOME}` de
`docker-stack.yml`, confere que cada um está definido e não-vazio no
ambiente, valida formato dos que têm formato (`ENCRYPTION_KEY` 64 hex,
`SITE_URL` com esquema e sem barra final, `NEXT_PUBLIC_SUPABASE_URL` em
`.supabase.co`), e sai com código 1 nomeando o que falta. O `docs/DEPLOY-VPS.md`
e o instalador (Fase 7) o chamam antes do `stack deploy`. Nada de
`set -e` engolindo: cada falha listada.

**Resultado esperado.** Deploy com `crm.env` incompleto vira erro em
segundos, antes de tocar o Swarm.

**Risco e raio de explosão.** Nenhum: é leitura pura e roda antes do deploy.

**Validação.** Teste de shell com um `crm.env` faltando uma variável.

**Reversão.** N/A.

#### 1.6 Comentários e exemplos com o domínio do escritório

**Objetivo.** Nenhuma ocorrência de `cbadvogados` em `src/` e em
`supabase/migrations/`.

**Contexto.** `src/types/index.ts:717`, `src/lib/whatsapp/transport/
evolution-client.ts:140`, `supabase/migrations/0901_cb_channels.sql:67` (só
comentários) e os testes `webhook-url.test.ts`, `assinatura.test.ts`,
`notes/mentions.test.ts`.

**Mudança.** Trocar por `crm.example.com` / `api.example.com`. Nas migrations
APLICADAS, editar comentário é seguro (o replay do CI reaplica o arquivo, e o
histórico do Supabase registra por versão, não por hash), mas é a ÚNICA
edição admitida em migration aplicada: nenhum SQL muda.

**Resultado esperado.** Gate de strings (6.2) verde para `src/` e
`supabase/`.

**Risco e raio de explosão.** Nenhum.

---

### Fase 2 — Buracos funcionais

#### 2.1 `.env.local.example` completo

**Objetivo.** Todo nome que `process.env` lê estar no exemplo, com o motivo.

**Contexto.** A4. O arquivo é o do upstream; as três da Evolution nunca
entraram. `SITE_URL` (1.3) e `NEXT_PUBLIC_APP_NAME` (3.1) entram junto.

**Mudança.** Seção "WhatsApp via Evolution API" com as três, no mesmo estilo
das demais (o que é, onde obter, o que quebra sem ela). Um teste em
`scripts/` que extrai os `process.env.X` de `src/` e falha se algum não
estiver no exemplo (exceto uma lista explícita: `ALLOWED_DEV_ORIGINS`, os
`WACRM_*` do `mcp-server`, que têm doc própria em `docs/mcp.md`). É a
mesma ideia do `i18n-chaves-usadas.mjs`: o portão existe porque a lembrança
não bastou.

**Resultado esperado.** O comprador que copiar o exemplo e preencher tudo
tem o WhatsApp conectando.

**Risco e raio de explosão.** Nenhum em produção. O teste novo pode reprovar
o CI na primeira execução se houver leitor esquecido: é o objetivo.

#### 2.2 Recuperação de senha

**Objetivo.** O link do e-mail de "esqueci a senha" levar a uma tela que
troca a senha.

**Contexto.** A5. Herdado do upstream. O `middleware.ts:80` não protege
`/auth` nem `/reset-password`, então as rotas novas são alcançáveis sem
sessão, que é o necessário.

**Mudança.** `src/app/auth/callback/route.ts`: lê `code` e `next`, chama
`exchangeCodeForSession(code)` no client de servidor (cookies) e redireciona
para `next` (validado como caminho relativo, nunca URL absoluta: open
redirect). `src/app/(auth)/reset-password/page.tsx`: formulário de senha
nova com confirmação, `supabase.auth.updateUser({ password })`, redireciona
para `/dashboard`; sem sessão, redireciona para `/forgot-password` com
mensagem. Chaves de i18n nos DOIS dicionários (o portão cobra). Na
configuração de Auth do Supabase (nosso projeto e o de cada comprador):
`https://<domínio>/auth/callback` na lista de redirects, ao lado do
`/join/*` que já existe. Isso entra no guia de instalação (4.2).

**Resultado esperado.** Fluxo completo funcionando no nosso ambiente e
descrito no guia.

**Risco e raio de explosão.** BAIXO: arquivos novos, nenhum caminho existente
alterado. O único risco é o open redirect no `next`, tratado acima.

**Validação.** Teste manual do fluxo com e-mail real; teste unitário da
validação do `next`.

**Reversão.** Apagar os arquivos.

#### 2.3 O fallback `wacrm.tech`

**Objetivo.** O produto nunca apontar para domínio de terceiro.

**Contexto.** A7. Só dispara sem `SITE_URL` e sem host derivável, ou com
`ALLOWED_INVITE_HOSTS` recusando o host.

**Mudança.** Em `invitations/route.ts`, o último ramo passa a responder 500
com mensagem clara ("configure SITE_URL") em vez de devolver uma URL.
Trocar os dois `'our wacrm account'` de `invite-member-dialog.tsx` por chave
de dicionário sem marca. A string em inglês fixo de
`whatsapp/config/route.ts:250` ("one wacrm user") vira chave de dicionário.

**Resultado esperado.** `grep -rn wacrm src/ | grep -v test | grep -v
localStorage` devolvendo só chaves de `localStorage` e comentários.

**Risco e raio de explosão.** Nenhum prático: o ramo é inalcançável com
`SITE_URL` definida, que o preflight exige.

#### 2.4 `ko.json`

**Objetivo.** Nenhum locale oferecido que quebre a tela.

**Contexto.** A10, D5.

**Mudança (se D5 = remover).** Apagar `messages/ko.json`; `.env.local.example`
passa a listar `en` e `pt-BR` como os valores válidos; o CLAUDE.md ganha a
linha "merge do upstream traz `ko.json` de volta: apagar". `messages.test.ts`
já ignora `ko`. `request.ts` cai em `en` se o arquivo não existir, então
`NEXT_PUBLIC_APP_LOCALE=ko` passa a dar inglês em vez de chaves cruas.

**Resultado esperado.** Só dicionários completos no repositório.

**Risco e raio de explosão.** Nenhum: ninguém serve `ko`.

---

### Fase 3 — Marca configurável (white-label)

#### 3.1 Uma fonte para o nome do produto

**Objetivo.** O nome aparecer em um lugar só, vindo de configuração.

**Contexto.** A6. Três fontes: `layout.tsx` (código), dicionários
(`Sidebar.title`, `SignupPage.description`) e o nome fixo "wacrm" em sete
outras chaves. `NEXT_PUBLIC_APP_NAME` pode ser build-time sem prejuízo,
porque cada comprador constrói a própria imagem (A11), e precisa ser
`NEXT_PUBLIC_` porque o sidebar é componente cliente.

**Mudança.** `src/lib/marca.ts` exporta `NOME_DO_APP =
process.env.NEXT_PUBLIC_APP_NAME?.trim() || '<D4>'` e `DESCRICAO_DO_APP`
(dicionário, com `{appName}`). `layout.tsx` monta `metadata` a partir dele.
`sidebar.tsx:219` e a descrição do signup renderizam `NOME_DO_APP` diretamente
em vez de `t('title')`. Dockerfile ganha `ARG NEXT_PUBLIC_APP_NAME`;
`pipeline.yml` passa `vars.CRM_APP_NAME` com default (1.2); `docker-compose.yml`
idem.

**Resultado esperado.** Trocar a variável e rebuildar troca o nome no título
da aba, no sidebar, no cadastro e nos e-mails que citam o app.

**Risco e raio de explosão.** BAIXO. Default igual ao nome atual, então a
nossa produção não muda. O risco é o padrão "`{appName}` cru na tela" se
alguma chave ICU ganhar o parâmetro e um call site não o passar; a 3.2
evita isso preferindo REESCREVER as frases a parametrizá-las.

**Validação.** Build local com `NEXT_PUBLIC_APP_NAME=Teste` e conferência
das quatro superfícies.

#### 3.2 Dicionários sem marca

**Objetivo.** Nenhuma chave com "wacrm" ou "CB Advogados".

**Contexto.** As nove chaves: `Sidebar.title`, `SignupPage.description`,
`Settings.invite.whatsappMessage`, `Settings.templates.deleteMetaDesc`,
`Settings.templates.deleteLocalDesc`, `Settings.whatsapp.registered`,
`Settings.whatsapp.pinHint`, `Settings.aiConfig.description`,
`Settings.assinatura.autoNamePlaceholder`.

**Mudança.** Nas sete de "wacrm", reescrever sem citar o nome ("será
excluído da Meta e deste CRM", "a Meta vai entregar eventos a este sistema",
"Entre em {accountName} usando este link"). `autoNamePlaceholder` vira "ex.:
Escritório Silva". `Sidebar.title` e `SignupPage.description` deixam de ser
lidas (3.1) e são removidas dos dois dicionários (o `messages.test.ts`
reprova chave órfã). Um teste em `src/i18n/` que reprova qualquer valor
casando `/wacrm|cb advogados/i`, para o merge do upstream não trazer a marca
de volta em silêncio.

**Resultado esperado.** Gate verde; nada muda para o usuário além do texto.

**Risco e raio de explosão.** Nenhum funcional. Merge do upstream vai
reintroduzir "wacrm" em toda chave nova: o teste avisa.

#### 3.3 Ícone e logo

**Objetivo.** O comprador pôr o próprio logo sem tocar em código.

**Contexto.** `src/app/icon.tsx` gera um PNG roxo Hostinger no build;
`sidebar.tsx` usa o ícone genérico `MessageSquare`; `public/` só tem os SVGs
padrão do Next.

**Mudança.** Se existir `public/marca/logo.svg`, o sidebar o usa no lugar do
ícone; se existir `public/marca/icon.png`, o `icon.tsx` o serve no lugar do
gerado. Cor primária do tema já é CSS (`themes.ts`); documentar onde trocar.
Sem arquivo, comportamento atual.

**Resultado esperado.** Dois arquivos opcionais definem a identidade visual.

**Risco e raio de explosão.** BAIXO: caminhos novos com fallback no atual.

#### 3.4 Arquivos comunitários do `.github/`

**Objetivo.** O comprador reportar para nós, e o CI não exigir revisor
alheio.

**Contexto.** A8: `CODEOWNERS` (`@ArnasDon`), `SECURITY.md`
(`a.donauskas@hostinger.com`), `ISSUE_TEMPLATE/config.yml`,
`pull_request_template.md`, `CODE_OF_CONDUCT.md`, `assets/hostinger-deploy.png`.

**Mudança.** `CODEOWNERS` apontando para nós (ou removido); `SECURITY.md`
com o nosso canal (definir em D3/D4); templates de issue com os nossos links
ou removidos; remover o asset da Hostinger. `dependabot.yml` fica.

**Risco e raio de explosão.** Nenhum.

#### 3.5 `package.json`, `mcp-server/package.json`, `docker-compose.yml`

**Objetivo.** O nome do pacote e do projeto compose baterem com D4.

**Mudança.** `name` e `version` (ver 6.3). `docker-compose.yml` `name:`.
NÃO mexer nas chaves de `localStorage` (`wacrm:*`, `wacrm.*` em `themes.ts`,
`inbox/page.tsx`, `campos-do-card.ts`, `retorno.ts`, `lista.ts`,
`flow-editor-shell.tsx`): renomear apagaria as preferências salvas de todo
usuário nosso sem ganho nenhum. Registrar essa exceção no CLAUDE.md e no
gate (6.2) como permitida.

**Risco e raio de explosão.** Nenhum (`npm ci` não depende do `name`).

---

### Fase 4 — Documentação de instalação do zero e separação interno/entregue

#### 4.1 `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Objetivo.** O primeiro arquivo que o comprador abre descrever o produto que
ele comprou.

**Contexto.** A8. Os três são do upstream.

**Mudança.** README novo: o que é (CRM de WhatsApp para escritórios, com a
lista real de módulos), requisitos (Supabase, VPS com Docker, Evolution API
ou Meta Cloud API, opcionalmente chaves de IA), link para
`docs/INSTALACAO.md`, para `docs/ATUALIZAR.md` e para a arquitetura (D8),
nota de licença (D3) e agradecimento ao wacrm como base. CONTRIBUTING vira
"como customizar o seu fork sem perder as atualizações" (é a nossa própria
seção "Fork + upstream" reescrita para o comprador, com o `cb-crm-produto`
no papel de upstream). CHANGELOG: ver 6.3.

**Risco e raio de explosão.** Nenhum em produção. Erro aqui vira instalação
errada: por isso a Fase 5.

#### 4.2 `docs/INSTALACAO.md` (substitui `SETUP-PRODUCAO.md`)

**Objetivo.** Um guia único, do zero ao WhatsApp conectado, sem depender de
nenhum outro documento.

**Contexto.** A9. O atual está errado em três afirmações e descreve outra
hospedagem.

**Mudança.** Apagar `SETUP-PRODUCAO.md`. O novo cobre, nesta ordem: (1)
pré-requisitos e o aviso de A11 (cada instalação constrói a própria imagem);
(2) Supabase: criar projeto, `supabase link` + `supabase db push` (a validar
na Fase 5: para projeto NOVO o histórico nasce alinhado, então a restrição
que nos impede de usar `db push` não vale para o comprador), Auth → Site URL
e redirects (`/join/*`, `/auth/callback`), SMTP próprio; (3) gerar
`ENCRYPTION_KEY`, `AUTOMATION_CRON_SECRET`, `EVOLUTION_WEBHOOK_SECRET`; (4)
Evolution API na VPS (imagem oficial ou derivada, conforme 1.4; chave global;
`SERVER_URL`); (5) o `crm.env` completo, campo a campo; (6) fork do
`cb-crm-produto`, segredos e variáveis do Actions, primeiro `docker stack
deploy` manual com preflight; (7) cadastro do primeiro usuário, conexão do
número em Configurações → Conexões, primeiro funil, perfis de acesso; (8)
diagnóstico (a tabela de sintomas do arquivo antigo, atualizada, mais
`401/503` das rotas de cron). Cada passo com o comando e com o que se vê
quando deu certo.

**Risco e raio de explosão.** Nenhum em produção.

#### 4.3 `docs/README.md`

Índice dos documentos entregues, apontando para INSTALACAO, ATUALIZAR,
public-api, mcp, docker e ARQUITETURA. O `CONTRIBUTING.md` já o referencia.

#### 4.4 O que NÃO vai para o comprador

**Objetivo.** Nenhum documento que descreva a nossa operação sair daqui.

**Lista.** `docs/PLANO-*.md` e `docs/plano-*.md` (incluindo este),
`docs/NOVIDADES-MERGE-UPSTREAM-*.md`, `docs/INFRA-VPS.md`,
`docs/DEPLOY-VPS.md` (o conteúdo genérico dele migra para INSTALACAO; o
específico fica), `docs/EVOLUTION-LID-FIX.md` (o que for genérico vai para
o Dockerfile e para INSTALACAO), `evolution_localhost.md`, `ops/`,
`scripts/vps-inventario.sh`, `.mcp.json`, `CLAUDE.md` (substituído pelo
saneado, 4.5), `AGENTS.md` pode ir. A lista vira o `export-ignore` do
`.gitattributes` e a exclusão do workflow da 6.1, num lugar só.

**Risco e raio de explosão.** O oposto: risco de FALTAR algo na lista. O gate
de strings (6.2) pega o que escapar.

#### 4.5 `CLAUDE.md` → `docs/ARQUITETURA.md` saneado (se D8 = sim)

**Objetivo.** Entregar a memória das armadilhas sem entregar a operação.

**Mudança.** Curadoria manual, não busca-e-troca: manter cada regra
("load-bearing", o porquê, o que morde código novo), remover medições da
nossa produção, IDs de conversa, nomes de funil, números de mensagens,
datas de incidente e referências a PRs. Seções inteiras a remover: "Fork +
upstream" (substituída pela versão do comprador em CONTRIBUTING), "Deploy"
(específica), a lista de migrations aplicadas. Gerado uma vez e depois
mantido a cada versão: cada nota nova no CLAUDE.md pergunta "vai para o
ARQUITETURA?".

**Risco e raio de explosão.** O CLAUDE.md original NÃO é editado por esta
tarefa. Ele continua sendo o nosso, com tudo.

---

### Fase 5 — Validação de instalação limpa e portão de migrations

**Objetivo.** Provar o guia seguindo-o ao pé da letra, numa conta que nunca
existiu.

**Contexto.** Tudo até aqui prova o schema (CI) e o código (testes). Nada
prova o PRODUTO instalado por alguém de fora. Exige: um projeto Supabase
descartável, uma VPS ou VM com Docker (pode ser a nossa, num stack separado
`crmteste`, ou uma VM local), um número de WhatsApp sobrando para parear na
Evolution.

**Roteiro.** Seguir `docs/INSTALACAO.md` sem pular nada e anotar cada ponto
em que foi preciso "saber" algo que não estava escrito. Confirmar: `db push`
num projeto novo (4.2); Evolution oficial mais recente SEM o patch, medindo
se o eco do celular pareado chega com telefone (1.4); signup; funil com
etapa de entrada; canal conectado; mensagem recebida e enviada; agendada
saindo pelo agendador; reset de senha (2.2); troca de `NEXT_PUBLIC_APP_NAME`
e de `SITE_URL`. Apagar o projeto e o número ao fim.

**Portão de migrations.** Com A17 confirmado, acrescentar `migrations` ao
`needs` do `deploy` em `pipeline.yml`, remover o comentário que o
contraindica e corrigir a nota do CLAUDE.md.

**Risco e raio de explosão.** O portão pode segurar um deploy por falha de
infraestrutura do job (download da CLI, `supabase db start`). A etapa está
estável há semanas; deploy segurado é recuperável com re-run; migration que
NÃO replaya do zero é exatamente o que um comprador novo sofreria, e é isso
que passa a ser barrado. Aceito.

**Reversão.** Tirar do `needs`.

---

### Fase 6 — Distribuição, versionamento e atualização

#### 6.1 Repositório `cb-crm-produto` (se D2 = c)

**Objetivo.** O comprador ter um upstream limpo, com histórico próprio, que
ele espelha e de onde mescla versões, sem nunca ver o nosso trunk.

**Mudança.** Repositório privado `cb-crm-produto`. Workflow no nosso
repositório, disparado por tag `v*`: `git archive` do `main` respeitando o
`export-ignore` da 4.4, gate de strings (6.2), commit único "Release vX.Y.Z"
sobre o `main` do produto, tag igual lá. Histórico do produto é linear: uma
versão, um commit. O comprador faz mirror para o repositório dele, adiciona
o nosso como `upstream` e mescla tags. Acesso por convite (colaborador de
leitura) ou por deploy key, revogável por comprador.

**Risco e raio de explosão.** Nenhum na produção. Risco de processo: um
arquivo interno novo fora da lista escapa. Daí o 6.2 como portão do
workflow, não como aviso.

#### 6.2 Gate de strings proibidas

**Objetivo.** Nada nosso sair no produto, por construção.

**Mudança.** `scripts/produto-gate.mjs`: varre o archive por
`cbadvogados`, `CBAdvNet`, `82.25.76.63`, `hxnhakmyxyhalbsktzwe`,
`leonardocabralb`, `a.donauskas`, `ArnasDon`, `wacrm.tech`, `hostinger`
(com exceções nomeadas por arquivo, ex.: `LICENSE`/`NOTICE` citando o
autor original; as chaves de `localStorage` com `wacrm`) e falha listando
arquivo e linha. Roda também no CI do nosso repositório como aviso (não
portão), para o desvio aparecer no PR e não só na release.

#### 6.3 Versões, tags e CHANGELOG

**Objetivo.** O comprador saber o que mudou e o que precisa aplicar.

**Mudança.** Primeira tag `v1.0.0` na conclusão da Fase 5. `package.json` e
`mcp-server/package.json` com a mesma versão. CHANGELOG novo, no formato
Keep a Changelog, com uma seção por versão e, dentro dela, a lista das
migrations novas em ordem ("aplique 981, 982 antes de reiniciar") e as
mudanças em `docker-stack.yml` que exigem `stack deploy` manual. O
CHANGELOG do upstream fica referenciado como histórico da base. Regra: tag
só sai de `main` com CI verde e Fase 5 repetida no que mudou.

#### 6.4 `docs/ATUALIZAR.md`

**Objetivo.** O comprador atualizar sem quebrar o que customizou.

**Conteúdo.** `git fetch upstream --tags`, branch de integração, `git merge
vX.Y.Z`, conflitos esperados (os dicionários, se ele traduziu; os arquivos
que ele customizou), `supabase db push` (aplica só as migrations novas),
rebuild pelo pipeline, `stack deploy` só quando o CHANGELOG mandar,
conferência pós-deploy. É a nossa seção "Puxar atualizações do original"
com os papéis trocados.

#### 6.5 Licença e NOTICE (D3)

Reservado. `LICENSE` com os termos das nossas adições; `NOTICE` com o
copyright MIT do wacrm e a lista do que veio dele. Texto é seu.

---

### Fase 7 — Instalador

#### 7.1 `scripts/instalar.sh`

**Objetivo.** Gerar o `crm.env` sem o comprador digitar 64 hex à mão.

**Mudança.** Interativo: pergunta domínio, URL e chaves do Supabase, dados
da Evolution, nome do app, locale, rede e resolver do Traefik; gera
`ENCRYPTION_KEY`, `AUTOMATION_CRON_SECRET` e `EVOLUTION_WEBHOOK_SECRET`;
escreve `crm.env` com permissão 600; roda o preflight (1.5); imprime os
próximos passos (segredos do Actions, `stack deploy`). Idempotente: com
`crm.env` existente, só completa o que falta e NUNCA regenera
`ENCRYPTION_KEY` (regenerar torna ilegível todo token salvo).

**Risco e raio de explosão.** Nenhum para nós. Para o comprador, o único
perigo é o da `ENCRYPTION_KEY`, tratado acima.

#### 7.2 `scripts/deploy.sh`

As três linhas que o CLAUDE.md manda repetir juntas (`set -a; . crm.env`,
`CRM_IMAGE` do `ContainerSpec.Image`, `stack deploy`), mais o preflight
antes e a conferência dentro do container depois (`printenv` da service-role,
`curl` da rota de cron esperando 401). Usado por nós também: é o fim da
receita de memória.

#### 7.3 `docker-compose.prod.yml` + Caddy (se D6 = sim; backlog)

App + agendador + Caddy com TLS automático, para quem não tem Swarm. Mantém
o agendador (sem ele agendada não sai). Só entra depois da v1.0 e só se
houver comprador pedindo.

---

### Fase 8 — Backlog: configuração por conta

Fora da v1.0, registrado para não se perder: expediente (`ABRE_HORA`,
`FECHA_HORA`) e fuso por conta (hoje constantes; o próprio
`horario-comercial.ts` diz "virar configuração por conta é evolução
conhecida"). O offset fixo `-03:00` continua correto para o Brasil (sem
horário de verão desde 2019) e só muda se um comprador estiver fora do
país. Moeda já é por conta (021).

## 6. Ordem, dependências e estimativa

| Fase | Depende de | Estimativa | Pode andar em paralelo com |
|---|---|---|---|
| 0 | D1 | 0,5 dia (mais espera) | 1, 2 |
| 1 | nada (1.3 antes de 1.1) | 1 dia | 0, 2 |
| 2 | nada (2.4 depende de D5) | 0,5 dia | 0, 1 |
| 3 | 1.2 (build-args), D4 | 1 dia | 4 |
| 4 | 1, 2, 3, D8 | 2 dias | 3 |
| 5 | 4 | 1 dia (+ Supabase e número de teste) | nada |
| 6 | 5, D2, D3 | 1 dia | 7 |
| 7 | 1.5 | 1 dia | 6 |
| 8 | backlog | não estimado | |

Total até a `v1.0.0`: cerca de 8 dias de trabalho, sendo metade escrita.
As Fases 1 e 2 entram em PRs pequenos, um por item, cada um com o seu
raio de explosão isolado; a 1.1 é o único PR que exige janela e `stack
deploy` manual.

## 7. Checklist "pronto para vender"

- [ ] Repositório privado, não-fork, pacotes do GHCR privados, VPS logada (F0)
- [ ] `grep -rE "cbadvogados|CBAdvNet|82\.25|hxnhak|leonardocabralb" --exclude-dir=docs --exclude=CLAUDE.md` vazio (F1, F3)
- [ ] `docker-stack.yml` sobe com `crm.env` de outro domínio (F1.1, F5)
- [ ] Preflight recusa `crm.env` incompleto (F1.5)
- [ ] `.env.local.example` cobre todo `process.env` de `src/` e há teste (F2.1)
- [ ] Reset de senha funciona ponta a ponta (F2.2)
- [ ] Nenhum `ko.json` incompleto; nenhum `wacrm.tech` (F2.3, F2.4)
- [ ] Nome, logo e ícone trocáveis sem código; teste de marca nos dicionários (F3)
- [ ] `.github/` sem o autor do upstream (F3.4)
- [ ] `README`, `docs/README`, `docs/INSTALACAO`, `docs/ATUALIZAR`, `CHANGELOG` nossos (F4, F6)
- [ ] Instalação limpa percorrida do zero, anotações incorporadas ao guia (F5)
- [ ] `migrations` no `needs` do `deploy` (F5)
- [ ] `cb-crm-produto` gerado por workflow com gate de strings verde (F6.1, F6.2)
- [ ] Tag `v1.0.0`, versões alinhadas (F6.3)
- [ ] `LICENSE`/`NOTICE` decididos (D3)
- [ ] `scripts/instalar.sh` e `scripts/deploy.sh` usados na F5 (F7)

## Apêndice A — Inventário arquivo a arquivo

| Arquivo | O que tem de nosso | Fase | Ação |
|---|---|---|---|
| `docker-stack.yml` | domínio ×2, `CBAdvNet` ×2, resolver, locale, imagem | 1.1 | parametrizar |
| `.github/workflows/pipeline.yml` | imagem, domínio, locale, comentário do repo | 1.2, 1.3 | vars do repositório |
| `.github/workflows/evolution-lid-fix.yml` | imagem `leonardocabralb/…` | 1.4 | `repository_owner` |
| `docker/evolution-lid-fix/Dockerfile` | "instância do escritório" nos comentários | 1.4 | reescrever |
| `Dockerfile` | `NEXT_PUBLIC_SITE_URL` build-arg; default `pt-BR` | 1.3, 3.1 | tirar SITE_URL; `APP_NAME` |
| `src/types/index.ts:717`, `evolution-client.ts:140`, `0901_cb_channels.sql:67` | exemplo `cbadvogados` | 1.6 | `example.com` |
| `src/lib/cb-channels/webhook-url.test.ts`, `assinatura.test.ts`, `notes/mentions.test.ts` | domínio/nome em fixture | 1.6 | trocar fixture |
| `.env.local.example` | faltam 3 da Evolution; `ko` citado | 2.1, 2.4 | completar |
| `src/app/(auth)/forgot-password/page.tsx` | aponta para rotas inexistentes | 2.2 | criar rotas |
| `src/app/api/account/invitations/route.ts:134` | `wacrm.tech` | 2.3 | erro em vez de URL |
| `src/components/settings/invite-member-dialog.tsx:212,241` | `'our wacrm account'` | 2.3 | chave i18n |
| `src/app/api/whatsapp/config/route.ts:250` | inglês fixo com "wacrm" | 2.3 | chave i18n |
| `messages/ko.json` | incompleto | 2.4 | remover (D5) |
| `src/app/layout.tsx:23-28` | "CB Advogados CRM" em código | 3.1 | `marca.ts` |
| `src/components/layout/sidebar.tsx:219` | `t('title')` | 3.1 | `NOME_DO_APP` |
| `messages/en.json`, `pt-BR.json` (9 chaves) | "CB Advogados", "wacrm" | 3.2 | reescrever + teste |
| `src/app/icon.tsx` | cor Hostinger, sem override | 3.3 | `public/marca/` |
| `.github/CODEOWNERS`, `SECURITY.md`, `ISSUE_TEMPLATE/*`, `pull_request_template.md`, `assets/hostinger-deploy.png` | upstream | 3.4 | reescrever/remover |
| `package.json`, `mcp-server/package.json`, `docker-compose.yml` | `wacrm`, 0.8.0 | 3.5, 6.3 | D4 + versão |
| `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | upstream | 4.1, 6.3 | reescrever |
| `docs/SETUP-PRODUCAO.md` | Hostinger, "só en/ko", ref do projeto | 4.2 | apagar; `INSTALACAO.md` |
| `docs/DEPLOY-VPS.md`, `docs/INFRA-VPS.md`, `docs/EVOLUTION-LID-FIX.md`, `evolution_localhost.md`, `ops/`, `scripts/vps-inventario.sh`, `.mcp.json`, `docs/PLANO-*`, `docs/plano-*`, `docs/NOVIDADES-*`, `CLAUDE.md` | operação nossa | 4.4 | `export-ignore` |
| `supabase/config.toml` | `project_id = "wacrm"` (só CLI local) | 3.5 | cosmético |
| `src/lib/cb-radar/horario-comercial.ts`, `agenda/fuso.ts`, `calendly/variaveis.ts`, `currency.ts` | constantes Brasil | 8 | backlog |
| `src/lib/themes.ts`, `inbox/page.tsx`, `pipelines/{campos-do-card,retorno}.ts`, `funil/lista.ts`, `flows/flow-editor-shell.tsx` | chaves `localStorage` `wacrm` | 3.5 | NÃO mexer (exceção do gate) |

## Apêndice B — Caminho A para privar o repositório

```bash
# 1. No GitHub: Settings → renomear CB-CRM para CB-CRM-fork-antigo
#    (libera o nome e mantém válido ghcr.io/leonardocabralb/cb-crm).
# 2. No GitHub: novo repositório CB-CRM, Private, VAZIO (sem README/licença).
# 3. Duplicar:
git clone --bare https://github.com/leonardocabralb/CB-CRM-fork-antigo.git
cd CB-CRM-fork-antigo.git
git push --mirror https://github.com/leonardocabralb/CB-CRM.git
cd .. && rm -rf CB-CRM-fork-antigo.git
# 4. No GitHub (repo novo): Settings → Secrets and variables → Actions:
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#    VPS_SSH_HOST, VPS_SSH_USER, VPS_SSH_KEY. Habilitar Actions.
# 5. Clone local:
git remote set-url origin https://github.com/leonardocabralb/CB-CRM.git
git remote add upstream https://github.com/ArnasDon/wacrm.git   # se faltar
git remote -v
# 6. Validar: push numa branch → CI; merge trivial no main → deploy verde.
# 7. Só então: Settings → Danger Zone → Delete CB-CRM-fork-antigo.
```

Antes do passo 6, o passo 1 da Fase 0 (login do GHCR na VPS) tem de estar
feito, senão o deploy do passo 6 falha no pull da imagem privada.

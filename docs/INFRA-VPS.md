# INFRA-VPS — o que existe na VPS e como reconstruir

O banco tem migrations, histórico e ordem de aplicação. A infraestrutura não
tinha nada disso. Este documento é a resposta: **inventário do que roda hoje +
runbook para levantar do zero**.

> **Regra de manutenção, no molde das migrations: toda mudança na VPS ganha uma
> linha aqui, no mesmo PR.** Documento de infra que mente é pior que ausente —
> ele é lido justamente no dia em que ninguém tem tempo de conferir.

**Levantado em:** 2026-08-04, com [`scripts/vps-inventario.sh`](../scripts/vps-inventario.sh).
Para atualizar: `bash scripts/vps-inventario.sh`.

---

## 1. A resposta curta (leia isto primeiro)

**Se a VPS morrer agora, o que se perde?**

| | Sobrevive? | Onde está |
|---|---|---|
| Contatos, conversas, mensagens, funis, automações do **CB CRM** | ✅ **sim** | Supabase (gerenciado, fora da VPS) |
| Arquivos de mídia do CRM | ✅ sim | Supabase Storage |
| **Sessão do WhatsApp** (o pareamento) | ⚠️ **só se o disco sobreviver** | `postgres_data` + Redis db 8. Desde 09/09/2026 há dumps manuais em `/root/backups/` (banco `evolution`, Redis db 8, `RuntimeConfig` da licença), mas no **mesmo disco** e sem rotina |
| **Fluxos do n8n** | ❌ **não** | `postgres_data`, sem backup |
| Bots do Typebot | ❌ não | `typebot_typebot-db-data`, sem backup |
| Base vetorial (pgvector) | ❌ não | `pgvector`, sem backup |
| **Definições das stacks** (8 de 10) | ❌ **não** | só em `/root/*.yaml`, fora do git. A da Evolution está versionada desde 09/09/2026 (`ops/vps/evolution-stack.yml`; segredos em `/root/evolution.env`) |
| Certificados TLS | ⚠️ regeneráveis | Let's Encrypt reemite sozinho |
| Cache do Redis | ⚠️ descartável | por definição |

⚠️ **O maior risco não é o banco — é `/root/*.yaml`.** Nove das dez stacks
(Traefik, Postgres, Redis, pgvector, Evolution, n8n, Typebot, Portainer,
Chatwoot) existem **apenas como arquivo solto na VPS**. Só a do CRM está
versionada (`docker-stack.yml`). Perder o disco significa reescrever tudo de
memória.

⚠️ **Não existe backup automático.** Conferido em 2026-08-04 e de novo em
09/09/2026: sem crontab do root, sem tarefa de dump, sem volume espelhado. O
`/etc/cron.d` tem `certbot`, `docker-image-prune`, `docker-builder-prune`,
`e2scrub_all` e `popularity-contest` — nenhum faz backup. O que existe são os
**dumps manuais de 09/09** em `/root/backups/` (do plano da Baileys 7), no
mesmo disco.

⚠️ **`docker-image-prune` roda todo dia às 00:17 com `-a --filter until=24h`**:
apaga TODA imagem sem contêiner e com mais de 24 h — inclusive as imagens de
**rollback** da Evolution (`homolog@1e656f95…` e `lidfix@dd3e46…`). Elas são
públicas (Docker Hub e GHCR) e voltam com `docker pull`, mas o rollback passa
a depender de rede no pior momento. Ver §7.

**O que isso custa na prática:** perder `postgres_data` significa **reler o QR
code** de cada número de WhatsApp, com o escritório sem atendimento até alguém
com o celular na mão refazer o pareamento — e refazer os fluxos do n8n do zero.

---

## 2. A máquina

| | |
|---|---|
| Endereço | `82.25.76.63` = `vps.cbadvogados.com` |
| SO | Ubuntu 20.04.6 LTS (Focal), kernel 5.4.0-216 |
| Disco | 97 GB, 29% usado |
| Memória | 7,8 GB, **sem swap** |
| Docker | 28.0.1, Swarm de **nó único** (`vps`, Leader) |
| Acesso | `ssh root@82.25.76.63`; a chave `~/.ssh/cb-crm-vps` (`claude-leitura-cb-crm`) foi autorizada em 2026-08-04 |

⚠️ **O Ubuntu 20.04 saiu do suporte padrão em 31/05/2025.** Em 2026-08-04 havia
27 atualizações comuns e **163 de segurança** pendentes (estas só via ESM). Não
é urgência de hoje, mas é dívida que só cresce — e uma migração de SO numa
máquina sem backup e sem stacks versionadas é exatamente o cenário que este
documento existe para evitar.

⚠️ **Nó único.** Não há redundância: a máquina é o ponto único de falha de tudo
que não seja o Supabase.

---

## 3. As camadas, na ordem em que dependem umas das outras

Esta é a ordem de reconstrução. Cada camada precisa da anterior de pé.

```
1. Docker + Swarm init
2. Rede overlay CBAdvNet
3. Traefik            (TLS, roteamento)  ─┐
4. Postgres, Redis    (dados)             ├─ infra compartilhada
5. Evolution, n8n, Typebot, pgvector, Portainer, OpenClaw
6. CRM  (crm_crm + crm_agendador)
```

### 3.1 Rede

| Nome | Driver | Sub-rede | Attachable |
|---|---|---|---|
| `CBAdvNet` | overlay | 10.0.1.0/24 | **false** |
| `ingress` | overlay | 10.0.0.0/24 | false |
| `typebot_typebot_internal` | overlay | 10.0.2.0/24 | false |

⚠️ **`CBAdvNet` foi criada SEM `--attachable`**, então contêiner avulso
(`docker run --network CBAdvNet`) é recusado com *"network CBAdvNet not manually
attachable"*. Só serviço do Swarm entra nela. Isso já quebrou um comando de
diagnóstico documentado no `DEPLOY-VPS.md`.

```bash
docker network create --driver overlay --subnet 10.0.1.0/24 CBAdvNet
```

### 3.2 Traefik — `traefik:v2.11.2`

Faz o TLS e o roteamento de **tudo**. Argumentos em uso:

- entrypoints: `web` (:80, redireciona permanente para https) e `websecure` (:443)
- certresolver: `letsencryptresolver`, desafio **HTTP**, e-mail `contato@cbadvogados.com`
- armazenamento ACME: `/etc/traefik/letsencrypt/acme.json`
- provider: `docker` em modo Swarm, `exposedbydefault=false`, rede `CBAdvNet`
- monta `/var/run/docker.sock` e o volume `volume_swarm_certificates`

⚠️ **O volume dos certificados é `volume_swarm_certificates`, não
`traefik-letsencrypt`.** Os dois existem; o segundo é órfão (8 KB, nada monta).
Confundir na hora de restaurar faz o Traefik nascer sem certificado.

### 3.3 Domínios e rotas

Todos apontam para `82.25.76.63` e entram pelo `websecure`.

| Domínio | Serviço | Porta interna |
|---|---|---|
| `crm.cbadvogados.com` | `crm_crm` | 3000 |
| `api.cbadvogados.com` | `evolution_evolution` | 8080 |
| `n8n.cbadvogados.com` | `n8n_n8n_editor` | 5678 |
| `webhook.cbadvogados.com` | `n8n_n8n_webhook` | 5678 |
| `painel.cbadvogados.com` | `portainer_portainer` | 9000 |
| `typebot.cbadvogados.com` | `typebot_typebot-builder` | 3000 |
| `bot.cbadvogados.com` | `typebot_typebot-viewer` | 3000 |
| `openclaw.cbadvogados.com` | `openclaw_openclaw-gateway` | 18789 |

---

## 4. Inventário completo (2026-08-04)

**10 stacks, 16 serviços.**

| Stack | Serviço | Imagem | Réplicas |
|---|---|---|---|
| `traefik` | `traefik_traefik` | `traefik:v2.11.2` | 1 |
| `postgres` | `postgres_postgres` | `postgres:14` | 1 |
| `redis` | `redis_redis` | `redis:latest` | 1 |
| `pgvector` | `pgvector_pgvector` | `pgvector/pgvector:pg16` | 1 |
| `evolution` | `evolution_evolution` | `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto` (por digest) | 1 |
| `crm` | `crm_crm` | `ghcr.io/leonardocabralb/cb-crm:<sha>` | 1 |
| `crm` | `crm_agendador` | `curlimages/curl:8.11.1` | 1 |
| `n8n` | `n8n_n8n_editor` / `_webhook` / `_worker` | `n8nio/n8n:latest` | 1 / 1 / 1 |
| `typebot` | `typebot_typebot-builder` / `-viewer` / `-db` | `baptistearno/*`, `postgres:16` | 1 cada |
| `portainer` | `portainer_portainer` / `_agent` | `portainer/*` | 1 / global |
| `openclaw` | `openclaw_openclaw-gateway` | `ghcr.io/openclaw/openclaw:latest` | 1 |

⚠️ **A Evolution é uma IMAGEM NOSSA**, não a oficial — desde **17/09/2026
12:39**: `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto@sha256:a7d56788ba127de3c7f759e57addf97bb54c71fedb1e955ab60d672753924126`
(Evolution **2.4.0** / Baileys **7.0.0-rc13**, construída pelo workflow
`.github/workflows/evolution-cb.yml` a partir do commit `e273b904` do
`develop` oficial, com DOIS patches — a citação do cliente e a foto de perfil
que travava a fila de entrada em 1 msg/min (`docs/PLANO-baileys-7.md`, 5.10) —
e o `prisma.config.ts` dentro — ver `docker/evolution-cb/README.md`). De
09/09 21:11 a 17/09 12:39 rodou a `…-citacao@sha256:dc0f4e8b12de706414609464131b4099de5f0dd29d16bd011b74206089ff1adf`
(só o primeiro patch), que é o **rollback curto** de hoje: mesmo commit, mesmas
migrations, `docker service update --image <ela> evolution_evolution`, sem
mount — e devolve o teto de 1 msg/min. ⚠️ Qualquer troca de imagem só com a
fronteira de entrega da 1002 em ~0 s em todas as conexões: a Baileys confirma
a mensagem ao servidor ANTES do handler, e o que está na fila em memória morre
com o contêiner (medido em 17/09). O pacote no GHCR é **público**: a VPS o
puxou sem `docker login`. Restaurar com a `evoapicloud/evolution-api:homolog`
oficial exige montar `/root/evolution/prisma.config.ts` em `/evolution/prisma.config.ts`
(sem ele o Prisma 7 não migra e o serviço entra em laço) e perde os dois
patches; restaurar com a 2.3.2 (`lidfix`) traz de volta o "Aguardando mensagem".
A 2.4 exige **licença** (gratuita, cadastro no `/manager`); a ativação fica na
tabela `RuntimeConfig` do banco `evolution` — restaurado o banco, ela volta;
banco novo = cadastrar de novo. O label `com.docker.stack.image` ainda diz
`evoapicloud/evolution-api:latest` — **engana**, nunca pinar por ele. O que
foi medido, decidido e testado está em `docs/PLANO-baileys-7.md`.

⚠️ **Várias imagens estão em `:latest`** (n8n, redis, portainer, typebot,
openclaw). Um `docker service update --force` nelas pode trazer versão nova sem
ninguém pedir. O CRM e a Evolution estão fixados por digest — que é o certo.

### Arquivos de stack, todos em `/root/`

`docker-stack.yml` (CRM, **versionado**), `evolution-stack.yml` + `evolution.env`
(Evolution, **versionado** em `ops/vps/` sem os segredos, desde 09/09/2026),
`traefik.yaml`, `postgres.yaml`, `redis.yaml`, `pgvector.yaml`, `n8n.yaml`,
`typebot.yml`, `portainer.yaml`, `chatwoot.yaml` (stack desativada).
⚠️ `evolution.yaml` (28/07/2026) está **obsoleto** — imagem 2.3.2, sem as
variáveis novas; não usar.

### Volumes — o que morre com a máquina

| Volume | Tamanho | Conteúdo |
|---|---|---|
| `chatwoot_storage` | **3,6 G** | ⚠️ órfão — nenhum serviço Chatwoot roda |
| `postgres_data` | 882 M | **Evolution + n8n** — o mais crítico |
| `pgvector` | 157 M | base vetorial |
| `chatwoot_public` | 51 M | ⚠️ órfão |
| `typebot_typebot-db-data` | 48 M | bots |
| `redis_data` | 34 M | cache (descartável) |
| `portainer_data` | 836 K | config do painel |
| `chatwoot_mailers` / `chatwoot_mailer` | 268 K | ⚠️ órfãos |
| `volume_swarm_certificates` | 128 K | **certificados TLS em uso** |
| `evolution_instances` | 20 K | sessão do WhatsApp (arquivos) |
| `traefik-letsencrypt` | 8 K | ⚠️ órfão |

⚠️ **`evolution_instances` ter só 20 KB não quer dizer que a sessão é
descartável.** Com `DATABASE_ENABLED=true`, a Evolution guarda o grosso da
sessão no **Postgres** (banco `evolution`). O par que importa é
`evolution_instances` **+** `postgres_data`; restaurar um sem o outro não
recupera o pareamento.

### Segredos de runtime

`/root/crm.env` (fora do git, **corretamente**). Variáveis:

`AUTOMATION_CRON_SECRET`, `ENCRYPTION_KEY`, `EVOLUTION_BASE_URL`,
`EVOLUTION_GLOBAL_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`,
`NEXT_PUBLIC_APP_LOCALE`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

⚠️ **`META_APP_SECRET` está no `docker-stack.yml` mas NÃO no `crm.env`** —
opcional hoje, porque a produção roda no transporte Evolution. Vira obrigatória
na virada para a Meta.

⚠️ **`ENCRYPTION_KEY` não pode ser regenerada.** Ela decifra os tokens do
WhatsApp já gravados no Supabase; uma chave nova torna todos ilegíveis e exige
reconectar tudo. Numa migração, **copie a existente** — não gere outra.

⚠️ **`NEXT_PUBLIC_*` são build-arg, não runtime.** Editar o `crm.env` não muda
locale nem URL: eles são inlinados na imagem em tempo de build, no
`deploy.yml`/`docker-stack.yml`. Isso já mordeu (produção inteira em inglês até
2026-07-25).

---

## 5. Runbooks

### 5.1 ⚠️ Depois de um reboot: Evolution e n8n em laço de reinício

**Sintoma.** O CRM responde 200 normalmente, mas **nenhuma mensagem de WhatsApp
entra ou sai**. `docker service ps evolution_evolution` mostra `Failed` a cada
~10 segundos, com `non-zero exit (1)`. O log da Evolution diz:

```
Error: P1001: Can't reach database server at `postgres:5432`
Migration failed
```

**Causa.** A rede overlay do Swarm volta pela metade depois do reinício e a
descoberta de serviços quebra para as tarefas novas. O banco está saudável — o
que não funciona é resolver o nome. Já apareceu neste Swarm também como
*"network sandbox join failed: subnet sandbox join failed for 10.0.1.0/24:
error creating vxlan interface: file exists"*.

**Diagnóstico (2 segundos, sem risco).**

```bash
docker exec $(docker ps -q -f name=postgres_postgres | head -1) pg_isready -U postgres
```

`accepting connections` → o banco está bem; é rede. Siga abaixo.

**Cura.** Forçar a tarefa a nascer de novo e re-entrar na rede:

```bash
docker service update --force evolution_evolution
```

```bash
docker service update --force n8n_n8n_editor
```

**Verificação — a que vale é o fluxo de mensagem, não o HTTP.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -m 10 https://api.cbadvogados.com/
```

E, no Supabase, a prova de ponta a ponta:

```sql
select max(created_at), now() - max(created_at) as ha_quanto_tempo,
       count(*) filter (where created_at > now() - interval '10 minutes') as ultimos_10min
  from messages;
```

Ritmo normal do escritório: ~10 mensagens por 10 minutos em horário comercial.

⚠️ **Não reinicie o `postgres_postgres` depois de os dependentes voltarem** —
derruba a conexão deles de novo. Se precisar, reinicie o Postgres **primeiro** e
só então force os dependentes.

⚠️ **Ignore `deadlock detected` no log do Postgres.** São da tabela `Message` da
própria Evolution e aparecem há semanas sem relação com queda.

⚠️ **Se o `--force` não resolver**, o problema é a rede em si e o remédio derruba
tudo que está de pé, inclusive o que está funcionando. Não faça em horário
comercial sem avisar.

### 5.2 O agendador (laços de cron)

Ver [`DEPLOY-VPS.md`](DEPLOY-VPS.md) §6. Em resumo: `crm_agendador` roda **dois
laços** — rápido (60 s, automações) em segundo plano e lento (900 s, agendadas e
fluxos) em primeiro. O CI **não** sobe serviço novo; exige `docker stack deploy`
à mão.

```bash
docker service logs --since 5m -t crm_agendador
```

Silêncio = saúde (o `curl -fsS` só imprime quando falha).

### 5.3 Deploy do CRM

Automático a cada push no `main` (`.github/workflows/deploy.yml`). O workflow
**só troca a imagem** do `crm_crm`. Qualquer mudança no `docker-stack.yml` exige
o `stack deploy` manual descrito no `DEPLOY-VPS.md`.

---

## 6. Reconstruir do zero

1. **DNS** — apontar `crm`, `api`, `n8n`, `webhook`, `painel`, `typebot`, `bot`,
   `openclaw` (todos `.cbadvogados.com`) para o IP novo.
2. **Docker + Swarm** — `docker swarm init`.
3. **Rede** — `docker network create --driver overlay --subnet 10.0.1.0/24 CBAdvNet`.
4. **Volumes** — restaurar do backup. ⚠️ **Hoje não existe backup**; ver §7.
5. **Traefik** — `docker stack deploy -c traefik.yaml traefik`. Sem certificado
   restaurado, ele reemite sozinho assim que o DNS apontar.
6. **Postgres e Redis** — as stacks próprias, com os volumes já restaurados.
7. **Evolution** — recriar `/root/evolution.env` a partir de
   `ops/vps/evolution.env.example` (os valores: `AUTHENTICATION_API_KEY` é a
   mesma `EVOLUTION_GLOBAL_API_KEY` do `crm.env`; `DATABASE_CONNECTION_URI` e
   `CACHE_REDIS_URI` apontam para `postgres`/`redis` desta rede) e
   `docker stack deploy -c /root/evolution-stack.yml evolution` (imagem por
   digest, pública no GHCR — sem login). Depois:
   - com `postgres_data` **e** Redis db 8 restaurados: as 4 conexões voltam
     `open` sozinhas e a licença já está ativa (`RuntimeConfig`);
   - sem eles: o banco nasce vazio (as 59 migrations rodam no boot), a licença
     tem de ser **ativada no `/manager`** (`leonardocabralb@gmail.com`;
     telefone com o operador) e cada número precisa ser reconectado pelo CRM
     (Conexões → Reconectar → **ler o QR**, 4 celulares).
   Os backups de 09/09 (`/root/backups/evolution-*.dump`, `redis-*.rdb`,
   `evolution-runtimeconfig-*.dump`) restauram os dois pedaços — se o disco
   tiver sobrevivido, ou se tiverem sido copiados para fora.
8. **Demais** (n8n, Typebot, pgvector, Portainer).
9. **CRM** — recriar `/root/crm.env` (⚠️ com a **mesma** `ENCRYPTION_KEY`),
   `docker login ghcr.io`, e o `stack deploy` do `docker-stack.yml`.
10. **Segredos do GitHub** — se o IP mudar, atualizar `VPS_SSH_HOST` (e a chave,
    se for outra). Lista no cabeçalho do `deploy.yml`.

---

## 7. Dívidas conhecidas (em ordem de risco)

1. ⚠️ **Sem backup automático, e nada fora da máquina.** `postgres_data` carrega
   a sessão do WhatsApp e os fluxos do n8n. Desde 09/09/2026 há o roteiro de
   dump manual (banco `evolution` em 3–5 s, Redis db 8 → db 9 + RDB, `RuntimeConfig`,
   spec do serviço — Anexo B do `PLANO-baileys-7.md`), tudo em `/root/backups/`
   no **mesmo disco**. Falta: cron diário + cópia para fora (destino a decidir
   pelo operador).
2. ⚠️ **8 das 10 stacks só existem em `/root/`.** A da Evolution já está em
   `ops/vps/`; um `git add` dos outros `*.yaml` (sem segredos) fecha o resto.
   ⚠️ **O cron `docker image prune -af --filter until=24h` apaga as imagens de
   rollback** da Evolution na madrugada seguinte a qualquer troca. Ou o cron
   perde o `-a` (prune só do que está pendurado, ao custo de imagens velhas do
   CRM acumularem), ou as imagens de rollback ganham um contêiner parado que as
   segure (`docker create --name manter-<nome> <imagem@digest> true`) — decisão
   do operador.
3. ⚠️ **Nada monitora o WhatsApp.** Em 2026-08-04 o escritório ficou ~1 h sem
   atendimento e a descoberta foi acidental. O CRM respondia 200 o tempo todo,
   então qualquer monitor de "o site está no ar?" teria dito que estava tudo bem.
   O sinal certo é o fluxo de mensagens no Supabase, não o HTTP.
4. **Ubuntu 20.04 fora de suporte** (163 atualizações de segurança pendentes).
5. **3,7 GB de volumes órfãos** (`chatwoot_*`, `traefik-letsencrypt`).
6. **Imagens em `:latest`** em 5 serviços — atualização silenciosa num
   `--force`.
7. **`crm.env` como variável de ambiente**, não Docker secret.
8. **Sem swap** em 7,8 GB de RAM.

---

## 8. Histórico de incidentes

### 2026-09-09 — upgrade da Evolution para 2.4 (Baileys 7)

Planejado e executado em `docs/PLANO-baileys-7.md`: 2 paradas de ~1 min
(tentativa 1 falhou por falta do `prisma.config.ts` na imagem oficial; a
segunda subiu com o arquivo montado) e uma terceira de 71 s para a troca pela
imagem própria `evolution-api-cb`. Nenhuma conexão pediu QR. Lições que
valem para esta doc: `docker service update --image` começa a troca na hora
(escalar a 0 antes); a foto do Redis envelhece a cada mensagem (tirar com o
serviço parado); `| grep -q` sob `pipefail` é trava falsa; e nos ~6 primeiros
minutos depois de (re)conectar a Baileys 7 entrega a entrada em lotes de
30–120 s antes de normalizar.

### 2026-08-04 — ~1 h sem WhatsApp após reboot da VPS

**17:02 UTC** a VPS reiniciou (causa do reboot não identificada). Quase todos os
serviços voltaram; `evolution_evolution` e os três do `n8n` entraram em laço de
reinício por não resolverem `postgres:5432`.

**Impacto:** nenhuma mensagem entre 17:00 e 18:05 UTC. O ritmo normal é ~30
mensagens/hora. `api.cbadvogados.com` em timeout; `crm.cbadvogados.com`
respondendo 200 o tempo inteiro — por isso nada acusou.

**Descoberta:** acidental, durante o levantamento deste documento. O cabeçalho
do CRM chegou a mostrar *"1 conexão, 1 com problema"* uma hora antes e passou
despercebido.

**Cura:** `docker service update --force` na Evolution e no n8n (§5.1).
Confirmado pelo fluxo de mensagens voltando a 10 por 10 minutos.

**Efeito colateral registrado:** este mesmo reboot derrubou o `crm_agendador`
às ~17:03. O plano de automações havia registrado essa queda como "causa não
identificada" — era o reboot.

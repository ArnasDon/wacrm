# PLANO — Baileys 7 na Evolution: o conserto do "Aguardando mensagem"

> **Plano vivo.** Atualizar a cada fase: marcar as caixas, registrar as medições e
> as decisões com data. Foi escrito para sobreviver à compactação do contexto de
> quem o executa — tudo o que foi medido e decidido até aqui está registrado, com
> a fonte. Quem retomar o trabalho começa por **"Estado"** e **"Próximo passo"**.

| | |
| --- | --- |
| **Criado** | 09/09/2026 |
| **Estado** | **FASE 1 NO AR desde 09/09/2026 19:02 (BRT)**: Evolution **2.4.0 / Baileys 7.0.0-rc13** em produção. Desde **17/09 12:39** a imagem é a **nossa `-foto`**, `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto@sha256:a7d56788…` (mesmo commit da `homolog`, + patch da citação do cliente + patch da foto de perfil + `prisma.config.ts` dentro, sem bind mount; de 09/09 21:11 a 17/09 12:39 rodou a `-citacao@sha256:dc0f4e8b…`), licença continuou **ativa**, 4 conexões sem QR. Testes: T1, T2, T3, T4, T6, **T7**, T8, T9, T10, T11, T12, T17, T18 ✅; T13 (edição do cliente) mitigada. Registro em **9.4** e **9.5**. Em 10/09, o 1 ✓ das mensagens do celular: o recibo chegava ao CRM ANTES da mensagem — corrigido na rota (5.9, 9.6). **17/09**: o **ATRASO DE ENTREGA** (1 msg/min por conexão desde 10/09, rotativo) tem causa PROVADA e conserto pronto — a foto de perfil consultada pelo LID, esperada dentro do `concatMap` da fila de entrada, 60 s por mensagem; patch na imagem `2.4.0-e273b904-citacao-foto` (5.10, 9.7). **Rollout feito em 17/09 12:39 BRT** (1003 aplicada às 12:39:17; imagem `-foto` no ar desde 12:39:54, 4 conexões `open`). |
| **Próximo passo** | **Verificação do 5.10 a partir de 21/09/2026** (≥ 3 dias inteiros depois do rollout de 17/09 12:39 BRT): rodar as consultas A e B, comparar com o critério de sucesso escrito lá e registrar o "depois" em 9.7 — fechar, ou abrir a "solução 3" se houver pico em 5 s. Pendências antigas: T5, T14/T15, T16, T19–T22; P9 (rotação da chave). Rollback da imagem: só trocar o digest de volta (mesmo commit, mesmas migrations). |
| **Como retomar sem contexto** | Ler a **seção 0** abaixo primeiro; o prompt de retomada está no **Anexo C**. A memória privada do executor (`baileys-7-plano-e-decisoes.md`) guarda o telefone do cadastro. |
| **Estudo de origem** | seções 2–4 deste documento condensam o estudo de 09/09 |
| **Docs relacionadas** | `docs/EVOLUTION-LID-FIX.md` (fica OBSOLETA com este plano), `docs/INFRA-VPS.md`, `docs/DEPLOY-VPS.md`, `docs/INSTALACAO.md` |

## 0. Como retomar este plano sem o contexto de quem o escreveu

Quem pega este plano depois de uma compactação de contexto (ou outra pessoa)
precisa só do que está aqui, da memória privada do executor e dos acessos
abaixo. Nada foi deixado implícito de propósito.

### 0.1 Onde está cada coisa

| O quê | Onde |
| --- | --- |
| Repositório / trunk | `leonardocabralb/CB-CRM`, branch `main`. **Nunca** PR ou push para `ArnasDon/wacrm`. Branch nova sai só de `origin/main`, e numa **worktree separada** — em 09/09 outra sessão deixou o checkout principal em `feat/instagram-receptor-de-teste`; não mexer nele. |
| VPS (Swarm) | `ssh -i ~/.ssh/cb-crm-vps root@vps.cbadvogados.com`. Serviços: `evolution_evolution` (Evolution), `crm_crm` (CRM), `postgres_postgres` (banco `evolution`, `psql -U postgres` pelo socket entra sem senha), `redis_redis` (db 8 = Evolution; **db 9 = cópia de backup**; db0/db2 são de outros serviços). |
| Banco do CRM (Supabase) | projeto `hxnhakmyxyhalbsktzwe`, pelo conector MCP (`execute_sql`). |
| Backups da Fase 0 | `/root/backups/` na VPS, carimbo `20260909-1704` (dump, RDB, instances, log, env, imagem, migrations, amostras). |
| Imagem **em produção** (desde 17/09 12:39) | `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto@sha256:a7d56788ba127de3c7f759e57addf97bb54c71fedb1e955ab60d672753924126` (Evolution 2.4.0, Baileys 7.0.0-rc13, patch da citação do cliente + patch da foto de perfil — 5.10 —, `prisma.config.ts` dentro; GHCR público). Stack: `ops/vps/evolution-stack.yml` = `/root/evolution-stack.yml` + `/root/evolution.env`. Conferir o que está rodando: `docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'`. |
| Rollback curto (mesmo commit, sem tocar no banco) | a imagem ANTERIOR, `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao@sha256:dc0f4e8b12de706414609464131b4099de5f0dd29d16bd011b74206089ff1adf` (sem o patch da foto: devolve o teto de 1 msg/min do 5.10) — `docker service update --image <ela> evolution_evolution`, sem mount nenhum. ⚠️ Só com a fronteira da 1002 em ~0 s (0.4: a troca perde a fila represada). A `homolog@sha256:1e656f95…` **+** `--mount-add type=bind,source=/root/evolution/prisma.config.ts,target=/evolution/prisma.config.ts,readonly` continua sendo o rollback para a imagem OFICIAL, dois passos atrás. |
| Rollback total (2.3.2, seção 10) | `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694` — ⚠️ o cron de prune da VPS pode tê-la apagado; `docker pull` de volta (P12) |
| Cadastro da licença | e-mail `leonardocabralb@gmail.com`; **telefone só na memória privada** (`baileys-7-plano-e-decisoes.md`) ou com o operador. |
| Contato para testes reais | "Leonardo Cabral Baptista" (memória `lead-de-teste-autorizado`; único destinatário autorizado para mensagem de teste). Testar num contato endereçado por LID: conferir em `IsOnWhatsapp`. |
| Código do CRM que este plano mexeu | `src/lib/whatsapp/transport/evolution-inbound.ts` (`lidJidFromKey`), `evolution-group-inbound.ts` (`lidDoRemetente`, `senderLid`), `src/lib/cb-groups/persist.ts` (`aprenderNossoLid`), `src/lib/cb-groups/sync.ts` (`parseGroupInfo`), `src/app/api/whatsapp/evolution/webhook/route.ts`; nota em `CLAUDE.md` antes de "## Branches". |
| Regras que não se negociam | `docker stack deploy` **proibido** para a Evolution (só `service update`); imagem **por digest**; backup do Redis **só do db 8**; log da Evolution morre no reinício do contêiner; `GROUP_UPDATE` só entra na lista de eventos **depois** do upgrade; ação destrutiva pede autorização explícita do operador **naquela conversa**. |

### 0.2 O que já foi feito (linha do tempo)

| Quando | O quê | Prova |
| --- | --- | --- |
| 09/09 tarde | Diagnóstico: sessões duplicadas por aparelho na Baileys 6.7.19; imagens, 463, WA Web e celular do cliente descartados | seção 2 |
| 09/09 | Decisões do operador: rc13 via `develop`/`homolog`, cadastro aceito (e-mail/telefone informados), upgrade **no lugar** com backup testado, 2.3.7 pura descartada | seção 3 |
| 09/09 17:04 | Backup completo em `/root/backups/` | 9.1 |
| 09/09 17:25 | Restauração de prova: **todas as tabelas batem** no mesmo corte, 0 avisos | 9.1 |
| 09/09 17:27 | Instâncias órfãs `Bancario` e `CBAdv` apagadas; 6 hashes do Redis apagados (cópias no db 9); laço de QR parou; 4 conexões `open` | 9.1, Anexo A |
| 09/09 | Amostras de payload da 2.3.2 guardadas na VPS (600) | 9.1 |
| 09/09 | Ajustes 1–3 do CRM + testes (95/95, lint, typecheck) — **PR #161 mesclado no `main`** | seção 5 |
| 09/09 | Este plano — **PR #162 mesclado** | — |
| 09/09 18:43 | Segunda passada do pré-voo (itens 11–15): linhas de base de latência/entrada/decifragem, migrations da imagem, endpoint de licença, `DEL_INSTANCE`, `Chat` sem duplicata | 9.2 |
| 09/09 19:02 | **Fase 1 no ar**: Evolution 2.4.0 / Baileys 7.0.0-rc13, 4 migrations, 4 conexões sem QR, licença ativa às 19:13 (operador). Tentativa 1 (18:53) falhou por falta do `prisma.config.ts` na imagem e voltou em 4 min | 9.4 |
| 09/09 19:19 | Rodada 1 de testes: T1 e T17 passaram; achado o recibo fora de ordem (ajuste 6) e a forma `Long` do `fileLength` (ajuste 4) → PR #171; 2 anexos do intervalo do portão recuperados | 9.4, 5.4, 5.8 |
| 09/09 21:11 | **P10**: imagem `evolution-api-cb` (commit da homolog + patch #2708 + prisma.config.ts dentro) no ar; T7 ✅ às 21:14; aquecimento de 6 min com entrada em lotes, depois 0 s | 9.5 |
| 09/09 19:39–20:08 | Rodada 2: 10 testes ✅; T13 (edição do cliente) cifrada → PR #175/#177; T7 (citação do cliente) perdida pela Evolution 2.4 (#2713) → P10. Operador decide **ficar na 2.4** (48 h) | 9.4, 8.1, 12 |
| 09/09 noite | Revisão adversarial do roteiro (3 lentes + crítico): 6.2, 8.4, 10 e Anexo B reescritos — script por passo com preâmbulo, foto final conferida, rollback por **rename** de banco (sem `dropdb`), portão de licença só HTTP, `EVOLUTION_OPERATOR_EMAIL` morto, `AUTHENTICATION_API_KEY` exposta no boot (P9), migration em laço, `BGSAVE` | 0.4, 6.2, 8.4, 10, 14 |
| 09/09 18:24 | Pré-voo, parte de backup: dump novo (14,3 MB), db 9 renovado (36 = 36), RDB, restauração de prova **bate em todas as tabelas, 0 avisos**. Achado da cascata do `DELETE` das órfãs (9.3) | 9.3 |
| 09/09 18:10 | Revisão do Codex no #162 avaliada: rollback **reordenado** (escalar a 0 antes de trocar a imagem — procede); `FLUSHDB` do db 9 já estava no commit final; participante por `id` telefone já coberto no código do #161 (o texto de 5.3 estava defasado e foi sincronizado). Pré-voo **só de leitura** executado na VPS | 9.2, seção 10 |
| 10/09 09:55 | Operador: mensagens do celular com 1 ✓. Medido: o recibo chega ao CRM ANTES da mensagem — corrida da rota, anterior à 2.4 (~⅓ das mensagens do celular desde 20/08) → espera na rota (PR #191) | 5.9, 9.6 |
| 16/09 11:55 | Operador: mensagem de 11:24 apareceu às 11:53. Medido: Bancário-Comercial 26–30 min atrasada com a saúde VERDE; restart drenou 16 min em 1 min. O CRM ganhou o 3º eixo da saúde — a fronteira de entrega (migration 1002, PR #220) | 5.10 |
| 17/09 12:39 | **1003 aplicada** (Management API, histórico `20260917153917`) e **imagem `-foto` no ar** (`docker service update`, stop-first, 17 s; 4 conexões `open`, migrations em dia). Primeira amostra "depois": carimbo 12:41:49 → gravada 12:41:49 (0,0 min). Última "antes" com a 1003: celular 12:12:45 → 12:39:38 (26,9 min) | 5.10, 9.7 |
| 17/09 10:00–12:30 | **Causa raiz do atraso, provada por três vias**: `profilePicture(received.key.remoteJid)` — a foto de perfil consultada pelo LID, que o WhatsApp não responde — esperada dentro do `concatMap` do `BaileysMessageProcessor`, com os 60 s de `defaultQueryTimeoutMs` da Baileys 7. 1 msg/min por conexão. Patch na imagem (`-foto`), migration 1003 (instrumento) e protocolo de verificação | 5.10, 9.7 |

### 0.3 O que NÃO foi feito (e é o próximo trabalho)

- A **Fase 1** inteira (seção 6.2): trocar a imagem, ativar a licença, conferir as 4 conexões, rodar T1–T22, observar 48 h.
- O **pré-voo** da Fase 1 (seção 6.2.0), no dia da janela.
- P2 (forma de `group_sender_jid`), ajuste 4 (`fileLength`, depende de medição), ajuste 5 (`GROUP_UPDATE`, depois do upgrade), docs da seção 5.6, fixtures anonimizadas a partir das amostras.
- A parte de **backup** do pré-voo (6.2.0, item 4) — só faz sentido no dia da janela, porque a foto envelhece.
- **Apagar TODAS as worktrees paralelas ao fim de todo o trabalho** (pedido do operador em 09/09, para não ocupar espaço): `git worktree list` no checkout principal e `git worktree remove` de cada uma, inclusive as de outras sessões já encerradas (em 09/09 havia `wt-tldv`, `wt-calendly`, `wt-codex-2`, `migracao-kommo`, `wf_…/ensaio-2` e a desta sessão, `wt-pv`). As duas desta sessão da Fase 0 (`wt-plano`, `wt-fix`) já foram removidas em 09/09. Item na Fase 2.

### 0.4 Armadilhas encontradas na execução (para não repetir)

- `docker service logs evolution_evolution` (sem `--since`) **trava depois de imprimir tudo**; usar `--since` ou `timeout`.
- No `psql` do contêiner, `-d <banco>` vem **antes** de `-Atc`, senão o `-d` vira o SQL.
- `Message.id` da Evolution é **cuid (texto)**, não inteiro; e a produção continua recebendo enquanto se confere — comparar contagens no **mesmo corte de `messageTimestamp`** (Anexo B).
- `DELETE /instance/delete` responde `Instance deleted` mas a remoção é **assíncrona** (5 s depois ainda aparecia `close`); conferir 1 min depois.
- As chaves `evolution:baileys:*` têm TTL e expiram também na cópia do db 9; os hashes `evolution:instance:*` não têm TTL — são eles que importam.
- Comandos longos por SSH (dump + restore) passam de 10 min: rodar em segundo plano e ler a saída depois.
- O checkout principal pode estar em outra branch por causa de sessões paralelas: **sempre `git branch --show-current` antes de qualquer `checkout -b`**, e preferir worktree.
- `docker service update --image` **começa a troca na hora** (o serviço está em `stop-first`, medido em 09/09): num rollback, trocar a imagem com o serviço vivo sobe a 2.3.2 contra o banco já migrado pela 2.4 e o Redis com estado v7 — **escalar a 0 primeiro** (achado do Codex no PR #162; seção 10).
- **Apagar instância na Evolution apaga o histórico dela no banco da Evolution** (`onDelete: Cascade` em todas as tabelas filhas de `Instance`): as 2 órfãs levaram ~278 mil `Message`, 4,4 mil `Chat` e 11 mil `Contact` — invisíveis para as conexões vivas e duplicados no Supabase, mas o executor **não avisou isso antes** de pedir a autorização. Regra: antes de apagar instância, contar as linhas dela e dizer ao operador o que vai junto. Preservado no dump de 17:04 (9.3).
- **Variável de shell envelhece**: `$CID` aponta para OUTRO contêiner depois de cada `scale`/`update` (e é vazio a 0 réplicas); sessão SSH nova não tem as variáveis da anterior; `docker exec $CID … > arquivo` com `$CID` vazio cria o arquivo **vazio** sem parar nada. Por isso o Anexo B virou blocos com preâmbulo, a `KEY` sai da especificação do serviço e os passos mandam **reler `CID`**. E o `pg_restore` da prova apontava para `evolution-$(date +%F).dump` enquanto o dump gravava `evolution-$CARIMBO.dump` — pego pela revisão adversarial antes de doer.
- **O portão de licença só barra a API HTTP**: entre o `scale=1` e a ativação a Evolution **recebe** (instâncias conectam, webhooks chegam ao CRM) e o CRM **não consegue enviar nem baixar mídia** (503). Ativar imediatamente e recolher o intervalo (6.2, passos 4 e 8). O `fetchInstances` também responde 503 — o gatilho "open em 10 min" se mede no banco/log.
- **Migration que falha vira laço**: `RestartPolicy any/5 s` recria o contêiner para sempre, cada subida repete o `prisma migrate deploy` (P3009), e `docker service scale` sem `--detach` espera uma convergência que não vem. Sempre `--detach` + `docker service ps`.
- **A imagem `homolog` não traz o `prisma.config.ts`** (Dockerfile do `develop` não o copia), e o Prisma 7 recusa `migrate deploy` sem ele — descoberto na tentativa 1 (9.4). Antes de trocar imagem, **ensaiar a migration numa cópia** (`evolution_ensaio` + `docker run --rm --network container:$PGCID … deploy_database.sh`): custa 1 min e teria evitado a parada. O arquivo montado vive em `/root/evolution/` — quem rebuildar a imagem ou trocar de tag confere se ele continua necessário.
- **Recibos fora de ordem na 2.4**: `SERVER_ACK` chega DEPOIS do `DELIVERY_ACK` (5 recibos em 9 s por mensagem, alternando `@lid` e LID sem sufixo). Todo caminho que grave `messages.status` precisa da escada (`escada-de-status.ts`); "a Baileys não volta de READ para SENT" era verdade só na 6.7.19.
- **Deploy do CRM durante a janela confunde a leitura**: outra sessão mesclou 3 PRs no `main` e o `crm_crm` reiniciou 3 vezes em 20 min (rollout `start-first`, 502 por segundos, webhooks retentados). Antes de atribuir reinício ao upgrade, olhar a IMAGEM de cada contêiner (`docker ps -a --filter name=crm_crm`).
- **Anexo que chega durante o portão de licença fica sem arquivo** e a recuperação é manual: `getBase64FromMediaMessage` → Storage → `media_url` (script `recuperar-midia.js` no scratchpad do executor; a memória `recuperar-anexo-perdido-na-evolution` descreve o caminho). Por isso "ativar imediatamente" (6.2, passo 4).
- **Dois defeitos são do UPSTREAM, não nossos, e têm issue aberta**: citação do cliente descartada pelo `prepareMessage` da 2.4 (evolution-api #2713, PRs #2654/#2708) e edição do cliente cifrada que a Baileys não decifra (Baileys #2690/#2743). Antes de "consertar" no CRM, conferir se o upstream já mesclou — o CRM só pode mostrar o que chega.
- **`comando | grep -q` sob `set -o pipefail` é trava falsa**: o `grep -q` sai no primeiro acerto, o produtor leva SIGPIPE e a pipeline "falha" — abortou a troca de imagem com a Evolution a 0 (9.5). Escrever a saída em arquivo e contar depois.
- **Aquecimento da Baileys 7**: nos ~6 min depois de (re)conectar, a entrada sai em lotes de 30–120 s (buffer da sincronização de pendências) e depois normaliza. Não é defeito nem gatilho; avisar o operador ANTES da janela, senão o print de "não chegou" chega antes da mensagem.
- Cópia local de fonte pode ser **página de erro**: `baileys-v7-migration.md` e `CHANGELOG.md` no scratchpad eram um 503 do Varnish (470 bytes) até a noite de 09/09 — a revisão adversarial pegou. Conferir tamanho e `<title>` de tudo que se baixa antes de citar. Re-baixados: o guia v7 (283 KB, real) e `messages-recv.ts` da rc13 e da 6.7.19.
- O estado Signal no Redis **muda a cada mensagem** (ratchet): uma cópia tirada horas antes restaura sessões velhas e o cliente não decifra o que vem depois. Por isso a **foto final** (dump + db 8 → db 9 + RDB) é tirada com o serviço **a 0**, segundos antes da troca (6.2, passo 1). A do pré-voo serve de prova de restauração.
- **A fila de ENTRADA da Evolution 2.4 é SERIAL, e uma consulta de rede dentro dela é um teto de vazão** (5.10): `BaileysMessageProcessor` → `concatMap` → handler de `messages.upsert` → `await profilePicture(...)`. Qualquer `await` que possa demorar ali multiplica pelo número de mensagens. Os recibos (`messages.update`) NÃO passam por essa fila — daí "11 recibos e 1 mensagem no mesmo despacho" ser a assinatura para reconhecer o problema. E o restart NÃO conserta: só esvazia a fila.
- **`profilePictureUrl` por `@lid` não é respondida pelo servidor** (7 de 8 estouraram o timeout; por telefone, 0,2–0,7 s). Toda mensagem chega em LID na Baileys 7 (681 × 0 em 48 h numa conexão). Quem for consultar qualquer coisa por JID na Baileys 7 usa o telefone (`remoteJidAlt`, sempre preenchido — 1011/1011 medido) e passa `timeoutMs`.
- **O `date_time` do webhook da Evolution é HORA LOCAL com sufixo `Z`** (`TZ=America/Sao_Paulo`): ao comparar com `messageTimestamp` (epoch), somar 3 h — senão o atraso sai negativo em exatamente −10800 s. Intervalos entre despachos não são afetados.
- **O log da Evolution roda a 30 MB (`max-size 10m` × 3)** — ~2 dias no volume atual — além de morrer no reinício. Medição que precise de dias vai pelo banco (a 1003), nunca pelo log.
- ⚠️⚠️ **Trocar o contêiner da Evolution com a fila de entrada represada PERDE a fila para o CRM.** A Baileys envia o ack ao servidor ANTES de emitir o `messages.upsert` (`lib/Socket/messages-recv.js`: `sendMessageAck` na linha 1427, `upsertMessage` na 1432), e o `ev.process` da Evolution não é aguardado — mensagem confirmada que morre na fila RxJS **não é reentregue** (só o que chegou ao servidor com o socket fora, `offline`, vem no reconectar). Medido em 17/09/2026: o rollout às 12:39:37 pegou a cbcrm com ~27 min represados; o processo novo entregou só carimbos ≥ 12:41 (mais um 12:25) — as mensagens de 12:13–12:39 da Bancário-Comercial (estimativa pela taxa da manhã: 10–20) ficaram só no celular pareado. O executor recomendou "agora" justamente por causa do atraso, sem ter conferido este ponto — era o argumento inverso. **Regra: reinício de contêiner ou troca de imagem SÓ com a fronteira da 1002 (`entrega_recebida_em − entrega_carimbo_em`) em ~0 s em todas as conexões.** Com o patch da foto de perfil não existe mais fila que represe; a regra vale para o dia em que voltar a existir.

**Sumário**

1. [O que acontece hoje](#1-o-que-acontece-hoje)
2. [O problema (diagnóstico com medições)](#2-o-problema-diagnóstico-com-medições)
3. [A resposta (decisões)](#3-a-resposta-decisões)
4. [O que muda de contrato entre o CRM e a Evolution](#4-o-que-muda-de-contrato-entre-o-crm-e-a-evolution)
5. [O que vai ser alterado no CRM](#5-o-que-vai-ser-alterado-no-crm)
6. [O que vai ser mexido na infraestrutura](#6-o-que-vai-ser-mexido-na-infraestrutura)
7. [Riscos](#7-riscos)
8. [Testes de aceitação](#8-testes-de-aceitação)
9. [Fases e checklist](#9-fases-e-checklist)
10. [Rollback](#10-rollback)
11. [Plano B de emergência (paliativo)](#11-plano-b-de-emergência-paliativo)
12. [Decisões pendentes e perguntas em aberto](#12-decisões-pendentes-e-perguntas-em-aberto)
13. [Anexo A — estado medido em 09/09/2026](#13-anexo-a--estado-medido-em-09092026)
14. [Anexo B — comandos de referência](#14-anexo-b--comandos-de-referência)
15. [Fontes](#15-fontes)

---

## 1. O que acontece hoje

**Sintoma.** Mensagens enviadas pelo CRM chegam ao celular do cliente como
*"Aguardando mensagem. Essa ação pode levar alguns instantes."* — com ✓✓ — e
o cliente responde "não está chegando suas mensagens". O **celular do
escritório** (aparelho pareado à mesma conta) mostra o mesmo aviso nas
próprias mensagens. É intermitente: numa mesma conversa, duas falham e a
terceira é lida.

**Casos medidos (09/09/2026, conexão Bancário - Comercial):**

| Hora | Cliente | Tipo | Origem | Status no CRM | No aparelho |
| --- | --- | --- | --- | --- | --- |
| 14:05:40 | Vitor | texto | CRM via Evolution (`from_device=false`) | `delivered` | "Aguardando mensagem" |
| 14:06:51 | Vitor | texto | CRM via Evolution | `delivered` | "Aguardando mensagem" |
| 14:08:35 | Vitor | texto | CRM via Evolution | **`read`** | chegou normal |
| 14:46:53 | Humberto | texto (com citação) | CRM via Evolution | `delivered` | "Aguardando mensagem" |

**Correção de premissa.** A queixa original falava em imagens. Os quatro casos
são **texto**. O problema não é de mídia.

**Por que o CRM não vê.** Em 12 dias, **zero** mensagens `failed`. O ✓✓ é
verdadeiro: os bytes chegaram; a **chave** para abri-los é que não serviu. O
WhatsApp não avisa o remetente disso. Hoje a única forma de descobrir é o
cliente reclamar. `Message.status = PENDING` no banco da Evolution **não**
indica falha (a mensagem lida de 14:08 também está `PENDING`; os acks chegam
pelo LID e a coluna não é atualizada).

**Contexto de uso.** O CRM **ainda não é o sistema principal**. O escritório
trabalha pelo celular pareado e por outro CRM: em 09/09 foram 105 textos pelo
celular contra 1 pelo CRM (08/09: 265 × 15). A Evolution está pareada como um
dispositivo vinculado nos 4 números reais do escritório.

---

## 2. O problema (diagnóstico com medições)

### 2.1 A causa

A Evolution 2.3.2 embarca a biblioteca **Baileys 6.7.19 (31/08/2025)** — o
`package.json` da tag declara `"baileys": "github:WhiskeySockets/Baileys"`,
**sem versão**; a nossa imagem congelou na data em que foi construída. Essa
versão **não conhece o endereçamento LID** que o WhatsApp adotou desde então.
Resultado: ela trata o LID como se fosse *outro telefone* e mantém **duas
sessões de criptografia para o mesmo aparelho** — uma pelo número, outra pelo
LID. Cada envio escolhe uma delas; quando cai na que o aparelho já descartou,
o cliente recebe os bytes sem a chave.

**Provas (Redis da instância Bancário - Comercial, hash `evolution:instance:44982408-…`):**

| Contato | Sessões gravadas | Leitura |
| --- | --- | --- |
| Vitor (5511995313317 ↔ LID 276819265749011) | `session-5511995313317.0`, `.99`, `session-276819265749011.0`, `.99` | **4 sessões para 2 aparelhos** |
| Humberto (555491761508 ↔ LID 29266007871686) | `session-555491761508.0`, `session-29266007871686.0` | **2 sessões para 1 aparelho** |
| Nosso número (5511964102992) | `.0 .21 .22 .29` | celular + **3 aparelhos vinculados** — cada envio é cifrado 4 vezes a mais |
| Em todos os hashes | sessões em formato LID (`_1`): **0**; `lid-mapping`: **0** | a biblioteca não faz ideia do que é LID |

- Enviamos para `…@s.whatsapp.net`; os recibos (`MessageUpdate`) voltam por
  `…@lid`. A Evolution **sabe** o mapeamento (`IsOnWhatsapp`:
  `5511995313317@s.whatsapp.net` ↔ `276819265749011@lid`); a biblioteca não o usa.
- Escala: **3.325 dos 7.019 chats** e **12.267 dos 22.618 `IsOnWhatsapp`** já são
  LID; **6.103 das 6.501** mensagens do CRM em 30 dias têm `remote_jid_lid`
  (medição das 16h de 09/09).
- Log da Evolution 4 min depois de subir: `Closing stale open session for new
  outgoing prekey bundle` — a linha exata das issues da Baileys.

### 2.2 O que foi descartado

| Hipótese | Por que não |
| --- | --- |
| Imagens | os quatro casos são texto |
| Bloqueio 463 / `tctoken` ("PENDING para sempre") | tudo é entregue (✓✓) e mensagens vizinhas são lidas |
| `CONFIG_SESSION_PHONE_VERSION` antiga | a variável está cravada em `2.3000.1025193442`, mas o log mostra a 2.3.2 buscando a atual (`2.3000.1047094411`, 10×) — ignorada |
| Celular do cliente | dois clientes e o nosso próprio aparelho falharam juntos |
| `Message.status = PENDING` como sinal | a de 14:08, lida, também é `PENDING` |

### 2.3 Achados de carona (não são a causa; entram na Fase 0)

- **Duas instâncias órfãs em laço de QR** (a cada ~45 s, `QRCODE_LIMIT=1902`):
  `Bancario` (id `385dac9a-…`, criada 06/2025, `ownerJid` **5511964102992 — o
  mesmo número da Bancário - Comercial**, 9.454 chaves no Redis) e `CBAdv`
  (`c68ecb8d-…`, `ownerJid` 558386262646 — o mesmo da Trabalhista - Jurídico,
  3.074 chaves). Não existem no CRM.
- **4 hashes no Redis de instâncias já apagadas**: `f71807c0-…` (3.078
  campos), `7fc75fe2-…` (86), `dcbf9851-…` (30), `60a309e7-…` (2.720).
- **1 duplicata em `Chat(instanceId, remoteJid)`**, na órfã `Bancario` — a
  migration da 2.4.0 cria índice único ali (com dedup antes).
- **O log da Evolution morre no reinício**: driver `json-file` (10 MB × 3), e o
  Swarm recria o contêiner — o log da hora da falha (14:05) se perdeu com o
  reboot da VPS às 14:47:59. Um `0` num grep sobre esse log não prova nada.
- A VPS foi **reiniciada em 09/09 às 14:47:59** (boot anterior desde 03/09
  09:00). O reinício funciona como o paliativo "reconectar" (sem QR).
- O celular do escritório tem **3 aparelhos vinculados** além do celular
  (Evolution, outro CRM, WhatsApp Web/Desktop) — desligar o outro CRM, já
  planejado, reduz o número de sessões a manter em dia.

---

## 3. A resposta (decisões)

### 3.1 O conserto

**Baileys ≥ 7.0.0-rc13.** É a linha que (a) cria as sessões no formato LID e
migra as existentes sozinha, (b) recria sessão quebrada automaticamente
(`enableAutoSessionRecreation: true` por padrão) e (c) manda o `tctoken`/
`cstoken` que o WhatsApp exige para não contar cada mensagem como "abordagem a
desconhecido" (o erro 463). A própria linha 6 foi abandonada para isso: a nota
da v6.7.21 diz *"Move to 7.0.0-rc.6 as soon as possible."*

A Baileys só chega até nós por dentro da Evolution:

| Versão da Evolution | Baileys | "Aguardando" | 463 | Cadastro obrigatório | Migrations novas | Prisma / Node | Release |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **2.3.2 + `lidfix` (hoje)** | 6.7.19 + patch nosso | tem | não tem (tolerado) | não | — | 6 / 20 | sim |
| 2.3.7 | 7.0.0-rc.9 | resolve | **cria** | não | +2 | 6 / 20 | sim (05/12/2025) |
| 2.4.0-rc2 | 7.0.0-rc.9 | resolve | **cria** | sim | +4 | 7 / 24 | pré-release (17/05/2026) |
| **`develop` = imagem `homolog`** | **7.0.0-rc13** | resolve | resolve | sim | +4 | 7 / 24 | não — branch (último commit 14/07/2026) |

**Descartadas:** 2.3.7 pura e 2.4.0-rc2 (rc.9 traz o "PENDING para sempre":
sem o carimbo, o WhatsApp conta toda mensagem como abordagem a estranho, o
limite estoura em dias e o número entra numa quarentena que dura dias — e o
risco de restrição do número é exatamente o que o escritório não pode correr).

**Escolhida (09/09/2026, confirmada pelo operador):** `develop`/`homolog`, com
o cadastro (seção 7.3) — e-mail do cadastro `leonardocabralb@gmail.com`; o
telefone foi informado e fica fora deste documento de propósito (pedir ao
operador na hora da ativação). **Alternativa** descartada, registrada para
histórico: 2.3.7 com `npm install baileys@7.0.0-rc13` no entrypoint — sem
cadastro, combinação não testada pelo projeto, e a 2.3.7 **perde o LID no
payload** (seção 4.2).

**Imagem candidata, conferida em 09/09 na própria VPS** (`docker pull` +
inspeção, sem tocar no serviço):
`evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549`
— criada 14/07/2026, 1,53 GB, **Evolution 2.4.0, Baileys 7.0.0-rc13,
`tc-token-utils` presente, Node 24.18.0, `patches/` vazio**. (Um relato de
21/07 dizia que o `homolog` ainda tinha rc.9 — era imagem antiga em cache; a
conferência local decide.)

### 3.2 Como aplicar

**Upgrade no lugar, com backup testado — sem ambiente paralelo.** Decisão do
operador em 09/09/2026, porque o CRM ainda não é o sistema principal: o
escritório continua atendendo pelo celular e pelo outro CRM durante a obra, e
o pior caso realista do rollback é **ler 4 QRs** num momento em que ninguém
depende do CRM. Daqui a meses, com a equipe dentro do sistema, esse custo não
caberia — é o argumento para fazer agora.

O paliativo (purga de sessões, seção 11) **não** foi escolhido como resposta:
é reset, a duplicidade volta em dias ou semanas. Fica documentado como plano
de emergência.

---

## 4. O que muda de contrato entre o CRM e a Evolution

### 4.1 O que NÃO muda (conferido nos fontes das três versões)

- **21 endpoints** que o CRM chama: `message/sendText`, `message/sendMedia`,
  `message/sendWhatsAppAudio`, `message/sendReaction`, `chat/markMessageAsRead`,
  `chat/deleteMessageForEveryone`, `chat/updateMessage`, `chat/sendPresence`,
  `chat/getBase64FromMediaMessage`, `chat/findChats`, `chat/fetchProfilePictureUrl`,
  `group/findGroupInfos`, `group/updateGroupSubject`, `webhook/set`, `webhook/find`,
  `instance/connectionState`, `instance/connect`, `instance/logout`,
  `instance/delete`, `instance/create`, `instance/fetchInstances` — todos
  existem no `develop`, mesmas rotas e corpos. `sendMessage.dto` só ganhou
  opcionais (`messageId`, `gifPlayback`); `webhook.schema.ts` é **byte a byte
  igual** ao da 2.3.2; `instance.dto` aceita `integration`, `qrcode`, `token` e
  o `webhook` aninhado.
- **8 eventos** assinados (`MESSAGES_UPSERT`, `MESSAGES_UPDATE`,
  `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `MESSAGES_DELETE`, `MESSAGES_EDITED`,
  `GROUPS_UPSERT`, `GROUP_PARTICIPANTS_UPDATE`): todos no enum do `develop`,
  que ganhou `GROUP_UPDATE` (nome do grupo mudou; a 2.3.2 não tem).
- Forma dos payloads de ack (`keyId` + `status`), exclusão (chave achatada ou
  aninhada em `key`) e edição (`protocolMessage` com `key` + `editedMessage`).
- `getBase64FromMediaMessage`: `m?.message ? m : getMessage(m.key)` — igual.
- Auth state (`use-multi-file-auth-state-prisma.ts`): **idêntico entre 2.3.7 e
  `develop`**, só cosmética desde a 2.3.2 — creds na tabela `Session`, chaves de
  sinal num hash do Redis por instância. A v7 grava os tipos novos
  (`lid-mapping`, `device-list`, `tctoken`) no mesmo hash.
- `AUTHENTICATION_API_KEY` continua sendo a chave HTTP (`auth.guard.ts` lê do
  env); a licença não a substitui. As chaves **por instância** (tabela
  `Instance.token`, guardadas cifradas em `cb_channels.api_key`) e a
  configuração de webhook de cada instância (tabela `Webhook`) ficam no banco
  da Evolution e sobrevivem ao upgrade — nada a refazer no CRM.
- Prisma 7 tirou a URL do banco do schema, mas o `prisma.config.ts` do
  `develop` lê **`DATABASE_CONNECTION_URI`** e **`DATABASE_PROVIDER`** — as duas
  variáveis que o nosso serviço já tem. O entrypoint da imagem roda
  `Docker/scripts/deploy_database.sh` (`npm run db:deploy` → `prisma migrate
  deploy`, depois `db:generate`) e só então `start:prod`; o log diz
  `Migration succeeded` ou `Migration failed` (e nesse caso o contêiner sai
  com erro — o serviço não sobe com banco pela metade).

### 4.2 O que muda: onde o telefone e o LID aparecem

| Versão | Mensagem endereçada por LID chega ao webhook como |
| --- | --- |
| **2.3.2 (+ patch)** | `key.remoteJid = senderPn` (telefone); LID em `key.previousRemoteJid` |
| **2.3.7** | `key.remoteJid = key.remoteJidAlt` (telefone). **O LID é perdido**: `remoteJidAlt` fica igual ao telefone, `previousRemoteJid` não existe |
| **`develop`** | **Troca**: `remoteJid` = telefone, `remoteJidAlt` = LID, `addressingMode = 'pn'`. O LID sobrevive |

O parser do CRM (`phoneJidFromKey`) já aceita `remoteJidAlt`/`senderPn`/
`participantPn`/`participantAlt` para achar o telefone — a mensagem **entra**
nas três versões. O que se perde sem ajuste é o `remote_jid_lid` (migration
917), que apagar/editar em conversa migrada exige.

### 4.3 O que muda: participantes de grupo

Baileys 7, tipo `Contact`: `{ id, lid?, phoneNumber?, … }` — `id` é o
identificador preferido (LID ou telefone), `phoneNumber` vem quando `id` é
LID, `lid` vem quando `id` é telefone. **Não existe mais `.jid`.** O `develop`
devolve `group.participants` cru em `findGroup`. Em mensagens de grupo, quando
`participant` é LID, `participantAlt` é o telefone (e vice-versa).

### 4.4 O que pode mudar: tamanho declarado do anexo

Hoje `fileLength` chega como **string**. Dentro do `develop` o campo é um
`Long {low, high}` (ele lê `size.fileLength?.low`). A forma no webhook só a
medição dirá. `mediaBytesOf` já devolve `null` para forma desconhecida, e
`null` cai em "tamanho desconhecido = baixa e confere no backstop".

### 4.5 Comportamentos novos da biblioteca que interessam

- Sessões nascem em formato LID; as PN existentes são migradas sozinhas, sem
  re-parear (guia v7; relato de campo rc.x → rc13 sem QR).
- `enableAutoSessionRecreation` e `enableRecentMessageCache` ligados por
  padrão: o *retry receipt* do aparelho que não decifrou vira reenvio automático.
- **Recibo de entrega continua sendo enviado** para toda mensagem recebida
  (conferido no fonte da rc13, `src/Socket/messages-recv.ts` 1740–1758); o guia
  fala em "parou de mandar acknowledgments", mas a opção `sendActiveReceipts`
  controla só o "lido". O cliente continua vendo ✓✓ ao nos escrever.
- 2.3.7: "Resolve *waiting for message* state after reconnection" — chaves
  velhas deixam de ser carregadas na reconexão.
- 2.4.0-rc2: bypass do `onWhatsApp` para `@lid` (`sendMessageWithTyping` e
  `sendPresence` deixam de lançar 400 para JID LID); `quoted` passa a valer em
  `sendWhatsAppAudio` (hoje áudio com citação não sai encadeado — melhora).
- `develop`: `sendMessageWithTyping` recebe o número, `createJid` monta o JID
  de telefone e a Baileys 7 resolve o LID por baixo; `deleteMessage` chama
  `client.sendMessage(del.remoteJid, { delete })` direto; `updateMessage` exige
  `oldMessage.key.remoteJid === createJid(number)` (a Evolution grava telefone
  no `key.remoteJid` — igual a hoje); `reactionMessage` passa por
  `sendMessageWithTyping(data.key.remoteJid, …)`; a mensagem citada é buscada
  **por `key.id`** no banco dela (`m?.message ? m : getMessage(m.key, true)`).

---

## 5. O que vai ser alterado no CRM

Todos os ajustes são **retrocompatíveis** (funcionam com a 2.3.2 de hoje) e
entram **antes** do upgrade, num PR próprio, para que uma falha nos testes
seja atribuível à Evolution e não ao CRM.

### 5.1 Ajuste 1 — reter o LID (`src/lib/whatsapp/transport/evolution-inbound.ts`)

- Em `normalizeUpsert`, `remoteJidLid` passa a ser o **primeiro** LID entre
  `key.previousRemoteJid` (2.3.2), `key.remoteJidAlt` (`develop`) e
  `key.remoteJid` cru (caso a Evolution não troque e o telefone tenha vindo de
  um campo alternativo). Na 2.3.7 os dois são telefone → continua `null`
  (limitação documentada daquela versão).
- `EvolutionMessageKey` ganha `addressingMode?: 'pn' | 'lid'` (informativo).
- Testes: fixtures com as três formas (2.3.2 medida hoje; `develop` conforme
  o código das linhas 1668–1675; "sem troca").
- Sem isso: `remote_jid_lid` nasce `NULL` e **apagar/editar mensagem do
  celular em conversa LID volta a não fazer nada** (o bug de 28/07).

### 5.2 Ajuste 2 — nosso LID e o remetente de grupo (`evolution-group-inbound.ts`, `src/lib/cb-groups/persist.ts`, `webhook/route.ts`)

- `normalizeGroupUpsert` passa a expor **`senderLid`** (o `participant` ou
  `participantAlt` que for `@lid`) separado de `senderJid`.
- `aprenderNossoLid` recebe `senderLid` (hoje recebe `senderJid`, que com a
  Baileys 7 passa a ser o telefone — e a função só aceita `@lid`, então nunca
  mais aprenderia). Hoje só o canal Bancário - Jurídico tem `own_lid`
  (`40373380473043@lid`, 12 grupos); os outros três estão `NULL`.
- **Decisão proposta (confirmar):** `group_sender_jid` continua sendo o **LID**
  quando houver — identidade estável e igual a 100% das linhas existentes
  (`remetenteDoGrupo` hoje prefere o telefone dos campos alternativos, que na
  6.7.19 não vêm; na v7 viriam e trocariam a forma da coluna). O telefone, se
  um dia for gravado, ganha coluna própria — fora deste plano.

### 5.3 Ajuste 3 — participantes de grupo (`src/lib/cb-groups/sync.ts`, `parseGroupInfo`)

- **Como ficou no código (PR #161)** — o telefone do participante sai de
  **três** lugares, nesta ordem: `p.phoneNumber` (v7, quando o `id` preferido
  é o LID), `p.jid` (2.3.2) e o **próprio `p.id` quando termina em
  `@s.whatsapp.net`** (v7, quando o `id` preferido é o telefone — aí o LID vem
  em `p.lid`). A nossa linha é a que tem `soDigitos(telefone) === nosso`.
- `ourLid` = `p.lid` se for `@lid`, senão `p.id` se for `@lid`, senão `null`.
- Teste com participante nas **três** formas: `{id: lid, jid, lid}` de hoje,
  `{id: lid, phoneNumber}` e `{id: telefone, lid}` da v7 (`sync.test.ts`).
  ⚠️ Uma versão anterior deste item dizia só `phoneNumber ?? jid` — o Codex
  apontou (PR #162) que a forma `{id: telefone, lid}` ficaria sem casar; o
  código já cobria, o texto é que estava atrás. O `develop` devolve
  `participants: group.participants` **cru** da Baileys (`findGroup`, conferido
  no fonte), então a forma é a do tipo `GroupParticipant` da biblioteca.

### 5.4 Ajuste 4 — `fileLength` como objeto (`src/lib/whatsapp/transport/anexo-declarado.ts`) — **FEITO (PR #171)**

Medido em 09/09 (9.4): na 2.4 o `fileLength` é o `Long` do protobuf,
`{ low, high, unsigned }`. `bytesDeclarados()` compõe `high * 2^32 + low` (sem
sinal); string e número continuam aceitos; teste com as três formas.

- **Só depois de medir** (T5). Se vier `{low, high, unsigned}`: bytes =
  `high × 2³² + low`. Teste com as três formas (string, número, objeto).

### 5.8 Ajuste 6 — recibo fora de ordem (`src/app/api/whatsapp/evolution/webhook/route.ts`, `escada-de-status.ts`) — **FEITO (PR #171)**

Descoberto no T1 (9.4): a 2.4 emite `SERVER_ACK` **depois** do `DELIVERY_ACK`
da mesma mensagem, e a rota rebaixava o status. Agora o `UPDATE` só acerta
linha em status inferior (`aceitamAvancoPara`), e o fan-out
`message.status_updated` só dispara quando alguma linha avançou. Regra no
`CLAUDE.md`.

### 5.9 Recibo antes da mensagem (`webhook/route.ts`, `recibo-antes-da-mensagem.ts`) — **FEITO (PR #191)**

Relatado pelo operador em 10/09 (mensagens do celular com 1 ✓) e medido no
mesmo dia (9.6): a Evolution despacha o `messages.upsert` e o `messages.update`
da mesma mensagem no mesmo segundo, e o CRM só grava a mensagem do celular
depois de esperar 2 s de propósito (`jaGravada`: o prazo para o eco de um envio
do próprio CRM aparecer), enquanto o recibo é um UPDATE só — o UPDATE rodava antes do
INSERT, achava zero linhas e o recibo morria. **Anterior à 2.4**: 38% das
mensagens do celular presas em `sent` antes do upgrade, 34% depois; o envio
pelo CRM tem a mesma janela (a linha nasce depois que a Evolution responde).
Correção: sem linha, a rota tenta de novo em pausas (1, 2, 4, 8 e 15 s);
linha que existe e não avança é recibo velho (a escada do 5.8 recusou) e ela
desiste; recibo de mensagem recebida (`fromMe` false) não espera. Testes em
`recibo-antes-da-mensagem.test.ts`, com um pino na rota.

### 5.10 Atraso de entrega: a foto de perfil trava a fila de entrada (`docker/evolution-cb/foto-de-perfil-por-telefone-com-teto.patch`, migration 1003) — **PATCH PRONTO (17/09/2026, PR #221)**

Relatado pelo operador em 16/09 (mensagem de 11:24 na tela às 11:53, com a saúde
verde) e diagnosticado em 17/09. A resposta do dia 16 foi dar ao CRM o terceiro
eixo da saúde — a fronteira de entrega (migration 1002, PR #220), que passou a
ACUSAR o atraso (>5 min, medição fresca). A causa ficou para o dia 17.

**A causa, em quatro peças (provada por código, cronômetro e assinatura no log):**

1. `src/api/integrations/channel/whatsapp/baileysMessage.processor.ts`: todo
   `messages.upsert` entra num `Subject` RxJS e sai por **`concatMap`** — UM
   lote por vez, o próximo só começa quando o anterior termina. Só o UPSERT é
   montado nele (`messageProcessor.mount`); os recibos (`messages.update`) têm
   handler próprio e não passam por ali.
2. `whatsapp.baileys.service.ts:1699`, dentro desse handler:
   `profilePicUrl: (await this.profilePicture(received.key.remoteJid)).profilePictureUrl` —
   uma consulta de REDE ao WhatsApp, esperada, no caminho serializado.
3. Ela usa `received` (o objeto cru, com o **LID**), enquanto 30 linhas antes
   (1668–1674) a própria Evolution já trocou o LID pelo telefone em
   `messageRaw.key.remoteJid` (`prepareMessage` cria uma `key` nova; a troca
   não alcança `received`). O servidor NÃO responde a consulta de foto por
   LID; por telefone responde em 0,2–0,7 s.
4. A Baileys 7.0.0-rc13 tem `defaultQueryTimeoutMs: 60000` e a Evolution passa
   `connectTimeoutMs`, `keepAliveIntervalMs` e `qrTimeout` — não esse. Consulta
   sem resposta = 60 s inteiros.

**Vazão: 1 mensagem por 60 s, por conexão, nos DOIS sentidos** — o eco de
cada mensagem enviada pelo celular pareado tem o mesmo `remoteJid` e paga igual.
Só vira atraso quando o tráfego passa de 1/min: a Comercial-Trabalhista (0,12
msg/min) cabe folgada, a Trabalhista-Jurídico (0,77) estoura em qualquer
rajada — daí "intermitente e rotativo". Começou em 10/09 porque a Baileys 7
tornou o LID o endereçamento padrão. O campo que a consulta preenche
(`profilePicUrl` do `contacts.update`) o CRM não lê — a foto vem da 973.
Não há conserto por configuração (a chamada é incondicional; não existe env
para o timeout) e o `develop` do upstream em 17/09 tem a linha idêntica.

**O conserto (22 linhas, um arquivo, mesma esteira do patch da citação):**

- `profilePicture(number, timeoutMs?)` repassa o teto a
  `client.profilePictureUrl(jid, 'image', timeoutMs)` — o parâmetro já existe
  na Baileys (`lib/Socket/chats.d.ts:40`); omitido, vale o padrão de 60 s.
- O handler chama `this.profilePicture(messageRaw.key.remoteJid, 5_000)`: o
  telefone resolvido (correção 1) e um teto de 5 s (correção 2). O teto vai SÓ
  nesse chamador, de propósito: o mesmo método atende `chat/fetchProfilePictureUrl`,
  que a 973 do CRM usa — com teto ali, um timeout carimbaria `avatar_checked_at`
  por 30 dias sobre um contato com foto. Chamadores de contatos (966, 1020),
  grupos e Chatwoot não mudam.
- Pior caso depois do patch (telefone também sem resposta, medido 1 em 10):
  5 s por mensagem — piso de 12 msg/min por conexão, 12× o teto de hoje.
- Efeito colateral esperado e BOM: mais fotos gravadas na Evolution (a
  consulta passa a ser respondida).
- `tsc --noEmit` do upstream com os dois patches: 0 erros (cliente Prisma
  gerado com URI fictícia); `git apply --check` limpo na ordem do workflow
  a partir do e273b904 pristino.
- **Imagem construída** pelo workflow a partir da branch (run 35240353664,
  17/09/2026 12:29 BRT):
  `ghcr.io/leonardocabralb/evolution-api-cb:2.4.0-e273b904-citacao-foto@sha256:a7d56788ba127de3c7f759e57addf97bb54c71fedb1e955ab60d672753924126`.
  **EM PRODUÇÃO desde 17/09/2026 12:39:37 BRT** (`docker service update
  --image …`, autorizado pelo operador; stop-first, 17 s de troca, `prisma
  migrate deploy` sem pendência, HTTP ON às 12:39:54, as 4 conexões `open`).
  A 1003 foi aplicada 20 s antes (12:39:17, histórico `20260917153917`).
  **Fronteira antes × depois das consultas A e B: `2026-09-17 15:39:37+00`.**
  ⚠️ **Custo da troca (medido, 0.4):** o que estava na fila em memória do
  processo antigo se perdeu para o CRM — a Baileys acka antes do handler. A
  Bancário-Comercial tinha ~27 min represados: as mensagens de 12:13–12:39
  daquela conexão (estimativa 10–20) existem só no celular pareado; a
  Trabalhista-Jurídico tinha ~5 min (12:34–12:39, poucas). As outras duas
  estavam em dia. Fica como lição para a próxima troca de imagem (fila vazia
  primeiro), não como defeito da imagem nova.
- Amostra do "antes" às 12:35 BRT, com o pente da doc já corrigido: cbcrm com
  **1777–2368 s** (30–39 min) de atraso, intervalo de 60 s em 18 das 25 linhas.

**O instrumento — migration 1003 (`messages.gravada_em`).** `created_at`
recebe o carimbo do WhatsApp na ingestão, e NENHUMA coluna guardava o instante
em que o CRM gravou a linha; a 1002 guarda só a fronteira atual de cada conexão
e o log da Evolution roda a 30 MB. `gravada_em timestamptz DEFAULT now()` — o
banco preenche, nenhuma linha de código muda, as antigas ficam NULL. Aplicar
**antes** do rollout, para o "antes" ser medido com a mesma régua do "depois".

**Protocolo de verificação (rodar ≥ 3 dias inteiros depois do rollout).**
Escopo: as 4 conexões Evolution, TODAS as mensagens 1:1 que passaram pela fila
de entrada (do cliente e do celular pareado — 3.150 + 2.799 em 7 dias, ~850/dia;
grupo fica fora, como na 1002), dia a dia, antes × depois. As duas consultas rodam no Supabase (`execute_sql`):

```sql
-- A) Atraso de entrega por conexão e por dia (BRT): gravada_em − created_at.
select (m.created_at at time zone 'America/Sao_Paulo')::date as dia,
       c.label as conexao,
       count(*) as n,
       round((percentile_cont(0.5) within group (order by extract(epoch from m.gravada_em - m.created_at)) / 60)::numeric, 1) as mediana_min,
       round((percentile_cont(0.9) within group (order by extract(epoch from m.gravada_em - m.created_at)) / 60)::numeric, 1) as p90_min,
       round((max(extract(epoch from m.gravada_em - m.created_at)) / 60)::numeric, 1) as max_min,
       round(100.0 * count(*) filter (where m.gravada_em - m.created_at > interval '1 min') / count(*)) as pct_acima_1min,
       round(100.0 * count(*) filter (where m.gravada_em - m.created_at > interval '5 min') / count(*)) as pct_acima_5min,
       -- o teto NOVO (5 s) se lê pelo ATRASO, e a régua é "> 5 s": pega tanto a mensagem que
       -- pagou o teto sozinha (5-5,5 s; 7 s no eco do celular, com os 2 s do jaGravada) quanto a
       -- CAUDA de uma rajada em que cada mensagem pagou 5 s em série (10, 14, 19 … 43 s — medido
       -- às 13:03 de 17/09, 9.7). Linha de base sem teto: cliente 0,5-2,6 s; celular ≤ 4 s.
       round(100.0 * count(*) filter (where m.gravada_em - m.created_at > interval '5 seconds') / count(*)) as pct_acima_5s
  from messages m
  join cb_channels c on c.id = m.channel_id
  join conversations v on v.id = m.conversation_id
 where m.gravada_em is not null
   and c.kind = 'evolution'                      -- só a fila testada: Meta e Instagram não passam por ela
   and v.group_id is null                        -- grupo fora: com dois números no mesmo grupo, o channel_id é o do webhook que chegou PRIMEIRO (Codex, PR #221; a mesma regra da 1002)
   and (m.sender_type = 'customer' or m.from_device = true)
   and m.created_at >= now() - interval '14 days'
 group by 1, c.id, c.label                       -- pelo id: o rótulo não é único (Codex, PR #221)
 order by 1, 2;

-- B) O "pente": intervalos entre gravações consecutivas da MESMA conexão.
--    Antes, 60 s era a moda (38× e 22× em 3 h). Depois, a distribuição deve
--    seguir as chegadas: sem pico em 60. ⚠️ Intervalo de 4-7 s NÃO é o teto
--    novo — é gente conversando (medido 17/09: carimbos já espaçados de 3-9 s);
--    o teto de 5 s se lê em A, pelo atraso (`pct_teto_5s`).
with g as (
  select c.id as canal_id, c.label as conexao,
         (m.gravada_em at time zone 'America/Sao_Paulo')::date as dia,
         round(extract(epoch from m.gravada_em - lag(m.gravada_em) over (partition by m.channel_id order by m.gravada_em))) as intervalo_s
    from messages m
    join cb_channels c on c.id = m.channel_id
    join conversations v on v.id = m.conversation_id
   where m.gravada_em is not null
     and c.kind = 'evolution'
     and v.group_id is null
     and (m.sender_type = 'customer' or m.from_device = true)
     and m.created_at >= now() - interval '14 days')
select dia, conexao,
       count(*) as intervalos,
       count(*) filter (where intervalo_s between 58 and 63) as em_60s,
       round(100.0 * count(*) filter (where intervalo_s between 58 and 63) / count(*)) as pct_em_60s
  from g
 where intervalo_s is not null
 group by 1, canal_id, conexao
 order by 1, 2;
```

Mais o eixo da saúde (1002), que deve ficar calado:
`select label, entrega_carimbo_em, entrega_recebida_em, extract(epoch from entrega_recebida_em - entrega_carimbo_em) as atraso_s from cb_channels order by 4 desc nulls last;`
— e, se o log ainda cobrir o período, o pente no log (Anexo B, "Assinatura do
pente de 60 s").

**Critério de sucesso (escrito antes de medir):** em cada uma das 4 conexões,
em cada dia inteiro depois do rollout — `pct_acima_5min = 0`, `pct_acima_1min`
≤ 2 (o dia do rollout tolera os ~6 min de entrega em lotes ao reconectar),
`mediana_min` = 0,0, `pct_em_60s` ≈ 0 e `pct_acima_5s` ≤ 20 (antes: 53% acima
de 5 min e mediana 6,0 min na Trabalhista-Jurídico; 26–30 min na
Bancário-Comercial no dia 16). ⚠️ O teto de 5 s continua SERIAL: contato cujo
telefone tampouco responde paga 5 s por mensagem, e uma rajada dele empilha
(9 mensagens em 4 s → a última a 43 s, e as conversas atrás dela esperam
junto — medido às 13:03 de 17/09, 9.7). Na primeira hora: `pct_acima_5s` =
14% na Bancário-Comercial e 37% na Trabalhista-Jurídico (dominado por essa
rajada, n = 35). É a assinatura da **"solução 3"** — montar o contato sem a
foto e buscá-la DEPOIS, fora do `concatMap` —, que fica como decisão do
operador: 43 s no pior caso contra os 15–39 min de antes.
**Como ler uma falha:** `pct_acima_5s` acima de 20 num dia inteiro, ou caudas
de dezenas de segundos em rajada, = a solução 3; pico em **60 s** ainda = a
imagem em produção não é a `-foto`
(conferir `docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'`);
atraso SEM pente = outra causa, voltar ao `xmin` e ao banco da Evolution
(memória `sonda-atraso-de-entrega`).

### 5.5 Ajuste 5 — `GROUP_UPDATE` (`evolution-provision.ts`) — **DEPOIS do upgrade**

- ⚠️ **Não antes.** A 2.3.2 recusa o pedido de webhook INTEIRO quando a lista
  traz evento que ela não conhece (conferido em 28/07/2026 com `GROUPS_UPDATE`):
  incluir agora quebraria a criação de conexão nova.
- Depois do upgrade: incluir e clicar "Ressincronizar" nas 4 conexões (a
  Evolution guarda a lista no momento do registro).

### 5.6 Documentação e regras

- `docs/EVOLUTION-LID-FIX.md`: marcar **obsoleto** (o `remoteJidAlt` é nativo
  na v7); manter como histórico. O workflow `.github/workflows/evolution-lid-fix.yml`
  **falha de propósito** com base ≠ 6.7.19 — não aplicar sobre a imagem nova.
- `docs/INFRA-VPS.md` (linha da imagem), `docs/INSTALACAO.md` (versão da
  Evolution: 2.3.2 → a nova, com o passo do cadastro), `docs/DEPLOY-VPS.md`.
- `CLAUDE.md`: a nota que desaconselha a 2.3.7 fala do erro 463 e continua
  verdadeira para a 2.3.7 pura — reescrever citando este plano; registrar a
  imagem por digest, `TELEMETRY_ENABLED=false`, e que `docker stack deploy`
  segue proibido para a Evolution.
- `.env.local.example`: nada muda (as variáveis da Evolution já estão lá).

### 5.7 Testes automatizados a acrescentar

- `evolution-inbound.test.ts`: as três formas de chave (5.1).
- `evolution-group-inbound.test.ts`: `senderLid` com `participant`/`participantAlt`
  em cada ordem.
- `cb-groups/sync.test.ts`: `parseGroupInfo` com participante v6 e v7.
- `anexo-declarado.test.ts`: `fileLength` objeto (quando medido).
- Fixtures **reais** capturadas em produção antes e depois do upgrade
  (Fase 0, item 5), com telefones anonimizados.

---

## 6. O que vai ser mexido na infraestrutura

Tudo na VPS (`vps.cbadvogados.com`, Swarm). **Regra que segue valendo:
`docker stack deploy` é proibido para a Evolution** — o `/root/evolution.yaml`
(28/07) não carrega as 7 variáveis `S3_*` nem várias outras que o serviço tem
(hoje `S3_ENABLED=false`, mas a regra é a mesma). Toda mudança vai por
`docker service update`.

### 6.1 Fase 0 — preparação (sem trocar versão)

1. **Instâncias órfãs**: `DELETE /instance/delete/Bancario` e `/CBAdv` (chave
   global). Conferir depois que os hashes `evolution:instance:385dac9a-…` e
   `…c68ecb8d-…` sumiram do Redis db 8; se não, `DEL` à mão. Apagar também os
   4 hashes de instâncias inexistentes (`f71807c0-…`, `7fc75fe2-…`,
   `dcbf9851-…`, `60a309e7-…`). ⚠️ Ação destrutiva: pede autorização explícita.
2. **Backup** (criar `/root/backups/`):
   - Postgres: `pg_dump -U postgres -Fc evolution` (579 MB; 348.735 `Message`,
     317.219 `MessageUpdate`). Contém a tabela `Session` (creds das 4 conexões).
   - Redis **só o db 8** — o Redis é compartilhado (db0: 559 chaves de outros
     serviços; db2: 4). Duas cópias: (a) `COPY <chave> <chave> DB 9 REPLACE`
     para cada chave do db 8 (restauração instantânea, preserva TTL);
     (b) `SAVE` + `docker cp` do `/data/dump.rdb` para `/root/backups/`
     (cópia fora do Redis; restaurar dele restauraria os outros dbs também —
     só em último caso).
   - `docker cp` de `/evolution/instances` (28 K; volume `evolution_instances`).
   - Anotar: digest atual
     `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694`,
     a lista de env do serviço, e o `_prisma_migrations` (última:
     `20250613143000_add_lid_column_to_is_onwhatsapp`, aplicada 04/09/2025).
3. **Restauração de prova**: `createdb evolution_ensaio` + `pg_restore` +
   `select count(*) from "Message"` = 348.735 + `dropdb evolution_ensaio`.
   Backup que nunca foi restaurado é esperança, não rollback.
4. **Guardar o log atual** da Evolution (`docker service logs … > /root/backups/`).
5. **Capturar payloads reais** (upsert 1:1 do cliente, eco do celular, grupo,
   imagem, documento) como fixtures — do log do CRM ou de um webhook de
   captura temporário.
6. **Fila de agendadas**: `cb_scheduled_messages` com `status = 'pending'`
   tem de estar vazia na janela (cancelar e reagendar depois). ⚠️ Em
   09/09 às 16h havia **1 pendente** — conferir o que é antes de marcar a
   janela.
7. **Aviso à equipe**: usar celular/outro CRM na janela (a Dra. Isa mandou 17
   pelo CRM em 09/09).

### 6.2.0 Pré-voo da Fase 1 (no dia da janela, ANTES de trocar a imagem)

Todos os comandos estão no Anexo B. Ordem:

1. **Confirmar com o operador**: janela aberta agora, os 4 celulares à mão,
   equipe avisada (celular/outro CRM), decisão P2 tomada. ✅ 09/09 noite: janela
   aberta, equipe avisada, P2 = LID; **só 1 celular** — aceito porque os outros
   3 números são conexões de teste sem uso (QR em 10/09 se pedirem).
2. **CRM publicado com o PR #161**: na VPS, a imagem de `crm_crm` termina no
   sha do `main` que contém o merge do #161 (`git log origin/main`).
3. **Fila de agendadas**: só a linha de teste de 2030 (P8) pode estar
   `pending`.
4. **Backup NOVO** (o de 17:04 de 09/09 é anterior à limpeza e envelhece):
   `pg_dump` com carimbo; **`FLUSHDB` no db 9** (ele guarda a cópia antiga —
   em 09/09 18:10 ainda tinha 10 hashes, os 6 apagados inclusos) e copiar o
   db 8 de novo; `SAVE` + `docker cp` do RDB; `instances`; log; env; e a
   **restauração de prova** com o corte de tempo (Anexo B). Este backup é a
   **prova** de que a restauração funciona; o que o rollback restaura é a
   **foto final**, tirada com o serviço a 0 no passo 1 da 6.2.
5. **Imagem**: `docker image inspect evoapicloud/evolution-api:homolog` mostra
   o digest `1e656f95…`; `docker run --rm --entrypoint sh <imagem> -c 'grep
   version node_modules/baileys/package.json'` → `7.0.0-rc13`. Se a tag
   `homolog` tiver sido re-puxada e mudado, **parar e reavaliar** (é branch
   sem release). ✅ 09/09 18:10: digest intacto, `2.4.0` / `7.0.0-rc13` /
   Node `v24.18.0`.
6. **Serviço**: `docker service inspect evolution_evolution --format '{{json
   .Spec.UpdateConfig}}'` → `Order` tem de ser `stop-first` (é, medido em
   09/09) — com `start-first` duas Evolutions abririam as mesmas 4 sessões ao
   mesmo tempo. Como a 6.2 escala a 0 antes de trocar, isso vira só
   conferência.
7. **Linha de base**: `fetchInstances` 4 × `open`; contagem de sessões PN por
   hash (Anexo B) — comparar com a de 8.3. ✅ 09/09 18:10 em 9.2.
8. **Log atual guardado** (`docker service logs --since 24h > /root/backups/…`).
9. **Imagem de rollback no nó**: `docker image inspect ghcr.io/…lidfix@sha256:dd3e46…`
   responde (✅ 09/09: id `7e614b07…`, criada 28/07, 1,11 GB). Regra: **nenhum
   `docker image prune`/`system prune`** na janela nem nas 48 h; o `service
   update` do rollback não passa `--with-registry-auth`, então a imagem tem de
   estar local.
10. **Tempos medidos** (para o relógio dos gatilhos): dump **5 s**, restore de
    prova **5 s** (14 MB, 09/09 18:24). A foto final leva menos de 1 min; o
    relógio dos 10 min de 8.4 começa no `scale=1`.
11. **O que dispara sozinho na reconexão** (Supabase, só leitura): automações
    ativas com gatilho de entrada, esperas com `run_at` na janela e `flow_runs`
    ativos — o WhatsApp entrega de uma vez o que chegou durante os minutos a 0,
    e cada mensagem dispara isso contra o portão 503 (ou em rajada, se a
    ativação for rápida). ✅ 09/09 18:43: **1** automação de entrada ativa
    ("Teste do plano — follow-up (pode apagar)", `keyword_match` — só dispara
    com a palavra-chave), **0** esperas, **0** fluxos ativos. Nada a pausar.
12. **Migrations da imagem × produção**: `comm` entre `ls prisma/postgresql-
    migrations` da imagem e `_prisma_migrations` — nada de produção pode faltar
    na imagem. ✅ 09/09: imagem 59, produção 55, **as 4 novas**:
    `20250918182355_add_kafka_integration`,
    `20251122003044_add_chat_instance_remotejid_unique`,
    `20251216143054_increase_token_length`,
    `20260506184850_add_runtime_config`. E **`Chat` duplicado
    `(instanceId, remoteJid)` = 0** (a 2ª migration cria índice único ali;
    duplicata = P3009 em laço).
13. **Endpoint de licença da imagem**: o Dockerfile do `develop` diz que a
    URL entra XOR-codificada por build-arg e, vazia, cai num fallback de dev.
    ✅ 09/09: o bundle não expõe a URL em claro (XOR de produção), e o
    fallback de `endpoint.ts` **monta a mesma** `https://license.evolutionfoundation.com.br`
    de partes — os dois caminhos apontam para produção. `SERVER_URL=https://api.cbadvogados.com`
    no env, então o `register_url` que o 503 anuncia sai certo; conferir no
    corpo do primeiro 503 depois do `scale=1`.
14. **`DEL_INSTANCE`**: tem de ser `false` — instância desconectada por dias
    (as 3 de teste até 10/09) seria apagada pelo monitor, com a cascata da
    9.3. ✅ 09/09: `DEL_INSTANCE=false`, `QRCODE_LIMIT=1902`.
15. **Linhas de base de 8.3** (latência, entrada por hora, decifragem)
    registradas em 9.2. ✅ 09/09 18:43.

### 6.2 Fase 1 — o upgrade (janela combinada; celulares à mão)

Ordem revista em 09/09 (revisão do Codex no PR #162 e revisão adversarial da
noite): a Evolution é **parada antes** de qualquer troca, a foto final é
tirada com ela parada e **conferida**, e só então a imagem muda. O `stop-first`
do serviço já evitaria duas Evolutions ao mesmo tempo, mas não daria a foto no
instante certo — e é a foto que decide se o rollback devolve as sessões como
estavam (0.4). Tudo abaixo roda por SSH em **scripts** (um por passo, com as
variáveis definidas no topo — Anexo B), nunca colando linhas soltas: as
variáveis de shell envelhecem entre os passos, e `$CID` aponta para outro
contêiner depois de cada `scale`/`update`.

**Antes do passo 0, na mesma hora**: navegador já em
`https://api.cbadvogados.com/manager/login`, a caixa de e-mail
`leonardocabralb@gmail.com` aberta e o telefone do cadastro à mão (o portão
de licença bloqueia a API do CRM até a ativação — passo 4); `date` anotado a
cada passo.

```bash
# 0. parar a Evolution (janela aberta; equipe no celular/outro CRM).
#    Com 0 réplicas nada escreve no banco nem no Redis.
docker service scale evolution_evolution=0
docker service ps evolution_evolution --format '{{.Name}} {{.CurrentState}}' | head -3   # nenhuma Running

# 1. FOTO FINAL, com o serviço a 0 (medido no pré-voo: dump 5 s, restore 5 s, 14 MB).
#    Bloco "Backup" do Anexo B com CARIMBO=<data-hora>-final: dump + `pg_restore -l`
#    + referência (count/max de Message, HLEN dos 4 hashes) em foto-$CARIMBO.txt +
#    FLUSHDB do db 9 + cópia + DBSIZE 8 = DBSIZE 9 (exato, porque nada escreve) + RDB.
#    ⚠️ SÓ SEGUIR depois do "DUMP-OK": um `prisma migrate deploy` com o dump ainda
#    rodando ficaria preso atrás dos locks (a 2.4 cria índice único em Chat e a
#    tabela RuntimeConfig) e o arquivo do rollback não estaria fechado em disco.

# 2. trocar a especificação (0 réplicas: nenhuma tarefa sobe ainda)
#    ⚠️ O prisma.config.ts é OBRIGATÓRIO (9.4): a imagem homolog não o traz, e sem ele o
#    Prisma 7 não migra ("datasource.url property is required"). O arquivo é o do develop
#    (lê DATABASE_CONNECTION_URI), guardado em /root/evolution/prisma.config.ts na VPS.
docker service update \
  --image evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549 \
  --env-add TELEMETRY_ENABLED=false \
  --mount-add type=bind,source=/root/evolution/prisma.config.ts,target=/evolution/prisma.config.ts,readonly \
  evolution_evolution

# 3. subir SEM bloquear e vigiar: o entrypoint roda `prisma migrate deploy` (4 migrations)
#    a CADA subida; com RestartPolicy any/5 s, migration que falha vira LAÇO de reinício
#    (P3009 a cada volta) e um `scale` sem --detach esperaria para sempre.
docker service scale --detach evolution_evolution=1
docker service ps evolution_evolution --no-trunc --format '{{.Name}} {{.CurrentState}} {{.Error}}' | head -4   # repetir a cada 30 s
timeout 300 docker service logs evolution_evolution --since 2m -f                      # "Migration failed" = gatilho (8.4)
CID=$(docker ps -q -f name=evolution_evolution | head -1)                              # RELER: é outro contêiner
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json; grep -m1 "\"version\"" node_modules/baileys/package.json'   # 2.4.0 / 7.0.0-rc13
PGCID=$(docker ps -q -f name=postgres_postgres | head -1)
docker exec $PGCID psql -U postgres -d evolution -Atc 'select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 6'
```

4. **Ativar a licença IMEDIATAMENTE.** O portão (`gateMiddleware`) é só um
   middleware HTTP de **entrada**: `main.ts` **aguarda** `initializeRuntime`
   (que apresenta a chave global ao `/v1/activate`, com timeout de 10 s) no
   começo do `bootstrap()`, sobe o HTTP e chama `initWA()` por último — e
   `initWA` conecta as instâncias **sem olhar** o resultado da licença; nada
   em `baileys.service.ts` a consulta. Ou seja, ~10–20 s depois do
   `Migration succeeded`, as 4 instâncias **conectam** ao WhatsApp, a
   migração PN→LID começa e os webhooks **chegam** ao CRM — mas **toda chamada do CRM à Evolution**
   (enviar, marcar lida, baixar mídia, `fetchInstances`) responde
   `503 LICENSE_REQUIRED` até a ativação. Consequências desse intervalo, e o
   passo 8 as recolhe: anexo 1:1 recebido fica sem arquivo (o CRM baixa pela
   API); automação/IA/agendada que dispare falha sem retentativa (5xx vira
   `evolution_error`). Anotar o `date` do `scale=1` e o da ativação.
   - `https://api.cbadvogados.com/manager/login` → cadastro com o e-mail e o
     telefone decididos → `curl -s https://api.cbadvogados.com/license/status`
     (linha de base hoje: **404**; depois tem de dizer ativo).
   - **Guardar a ativação**: `docker exec $PGCID pg_dump -U postgres -Fc -t
     '"RuntimeConfig"' evolution > /root/backups/evolution-runtimeconfig-$FOTO.dump`
     (`$FOTO` vem do preâmbulo do Anexo B — o carimbo da foto final mais recente)
     — a licença local mora nessa tabela (`licensing-runtime.ts`,
     `model RuntimeConfig`); a foto final é anterior à 2.4 e não a tem. Numa
     2ª tentativa depois de rollback, restaurar só essa tabela depois do
     `prisma migrate deploy` dispensa cadastrar de novo.
   - ⚠️ **`EVOLUTION_OPERATOR_EMAIL` NÃO serve nesta instalação** (uma versão
     deste plano o oferecia como alternativa): `initializeRuntime` só chama
     `tryAutoRegisterFromEnv` quando `globalApiKey` está **vazia**, e
     `globalApiKey` é a `AUTHENTICATION_API_KEY` (`main.ts:57`), que é a chave
     HTTP do CRM e nunca está vazia. O `/manager` é o **único** caminho.
   - ⚠️ **No boot sem licença a Evolution apresenta a nossa
     `AUTHENTICATION_API_KEY` ao servidor da fundação** como candidata a chave
     de licença: `POST /v1/activate` com o cabeçalho `X-Api-Key: <a chave>` em
     claro (sobre TLS) mais assinatura HMAC (`transport.ts`). Falha, imprime o
     banner e fica inativa — mas a chave HTTP do escritório viajou para um
     terceiro, e viaja de novo a cada reinício até a ativação. Decisão **P9**:
     rotacionar a chave depois da Fase 1 (é a mesma `EVOLUTION_GLOBAL_API_KEY`
     do CRM: `crm.env` + `--env-add` nos dois serviços; as chaves por instância
     em `cb_channels.api_key` não mudam).
5. **Conexões — contando do `scale=1`, não do início do rollback.** Antes da
   ativação o `fetchInstances` responde 503, então o estado sai do **banco** e
   do **log**: `docker exec $PGCID psql -U postgres -d evolution -Atc 'select
   name, "connectionStatus" from "Instance"'` (o `connection.update` grava
   `open` ali) e `timeout 60 docker service logs evolution_evolution --since
   10m 2>&1 | grep -ciE "connection.*open|CONNECTED"`. Depois da ativação, a
   `KEY` lida da **especificação** do serviço (Anexo B) e `fetchInstances` →
   4 × `open` sem QR. Se alguma pedir QR: ler (é o custo aceito; em 09/09 só 1
   celular à mão — as outras ficam para 10/09, decisão do operador).
   **Onde ler o QR**: *antes* da ativação o botão Reconectar do CRM não
   funciona (`instance/connect` está atrás do portão → 503); o QR sai pelo
   `/manager` (instância → conectar) ou pelo log em ASCII (`timeout 60 docker
   service logs evolution_evolution --since 2m 2>&1 | grep -A 40
   qrcodeCount`, num terminal com ≥ 45 linhas). *Depois* da ativação:
   Conexões → Reconectar no CRM. Ordem preferida: ativar primeiro, ler QR
   depois — o relógio de 8.4 já conta do `scale=1`. ⚠️ Instância em laço de
   QR imprime o QR no log a cada renovação (444 `qrcodeCount` em 24 h com as
   órfãs) e rotaciona o `json-file 10m×3`: **guardar o log a cada marco**
   (depois das migrations, dos `open`, da ativação, ao fim dos testes e a
   cada 12 h) e medir 8.3 sobre os arquivos, com `grep -v -E '▄|█|qrcodeCount'`.
6. **Sinais no Redis**: campos `lid-mapping-*` e `session-*_1.*` começam a
   aparecer nos hashes vivos.
7. **Prova da FOTO FINAL** (não prolonga a parada — só I/O no Postgres):
   `pg_restore --exit-on-error` da foto em `evolution_ensaio`, `count(*)` de
   `Message` **igual** ao de `foto-$CARIMBO.txt` (total exato: o serviço estava
   a 0), `dropdb evolution_ensaio`. Só depois disto o rollback tem dump
   comprovado.
8. **Recolher o intervalo `scale=1` → ativação** no Supabase: mensagens
   recebidas nesse intervalo com mídia e sem arquivo (recuperar pelo caminho da
   memória `recuperar-anexo-perdido-na-evolution`), `automation_logs` /
   `cb_calendly_eventos` com falha, agendadas em `entrega_incerta`.
9. **Testes** da seção 8 no lead de teste autorizado. **Antes do T22**, guardar
   o log (`docker service logs --since 6h > /root/backups/evolution-log-pos-upgrade-…`).
10. **Observação de 48 h** com os medidores da seção 8.3.
11. **Depois**: ajuste 5 (`GROUP_UPDATE` + Ressincronizar), atualizar
    `/root/evolution.yaml` com a imagem por digest e `TELEMETRY_ENABLED=false`
    (para um futuro `stack deploy`, ainda proibido, não regredir), docs, P9.

`CONFIG_SESSION_PHONE_VERSION` fica como está (é ignorada). Variáveis novas do
`develop` (Kafka, SQS, métricas, proxy, EvoHub) são todas opcionais e
desligadas por padrão; o EvoHub fica inerte sem chave.

---

## 7. Riscos

### 7.1 Funcionais (por funcionalidade do CRM)

**B** = baixo (contrato igual) · **M** = médio (comportamento muda ou depende
de teste) · **A** = alto (perda de mensagem/dado possível).

| # | Funcionalidade | O que muda | Risco | Cobertura |
| --- | --- | --- | --- | --- |
| 1 | Receber texto de cliente | LID muda de campo (4.2) | B | ajuste 1, T4 |
| 2 | **Mensagem enviada pelo celular pareado** (`from_device`) | mesmo caminho do item 1; o patch `lidfix` deixa de existir e a v7 entrega `remoteJidAlt` nativo | **M** — já falhou uma vez (83% dos ecos perdidos em 07/2026) e o CRM **descarta em silêncio** | **T17**; medidor `DESCARTADA` |
| 3 | Mensagem enviada pelo WhatsApp Web / Desktop / outro CRM | idêntico ao item 2 | **M** | **T18** |
| 4 | Eco do que o próprio CRM enviou (dedup) | nada (`jaGravada` por `message_id`) | B | — |
| 5 | Enviar texto | nada; a v7 resolve LID por baixo — é o conserto | B | T1 |
| 6 | Enviar imagem/vídeo/documento | nada (DTO só ganhou opcionais) | B | T2 |
| 7 | Nota de voz (gravador e acervo) | nada; citação em áudio passa a funcionar | B | T3 |
| 8 | Mensagem agendada | nada de contrato; risco de horário (dispara sem gente olhando) | B, com fila vazia | T20 |
| 9 | Receber mídia | endpoint igual; `mediaKey` mais robusto desde a 2.3.3 | B | T4, T5 |
| 10 | Tamanho declarado do anexo (`too_large`, "sob demanda") | forma de `fileLength` pode mudar (4.4) | M (degradação: baixa antes de decidir) | T5, ajuste 4 |
| 11 | Pré-visualização de mídia no CRM | nada (é o nosso Storage) | B | — |
| 12 | Link preview no envio | igual (`linkPreview` ligado por padrão) | B | T6 |
| 13 | Citação — preview no aparelho do cliente | busca por `key.id` igual; `participant` montado pela v7 em conversa LID | M (cosmético, visível) | T7, T8 |
| 14 | Reação (enviar) | passa por `sendMessageWithTyping` com bypass `@lid` | M | T9 |
| 15 | Reação (receber) | nada | B | — |
| 16 | Apagar para todos | sem ajuste 1, volta o bug de 28/07; com a v7, apagar pelo telefone pode passar a funcionar | M | T10, T11 |
| 17 | Editar | igual (Evolution grava telefone no `key.remoteJid`) | B | T12 |
| 18 | Exclusão/edição feitas pelo cliente | formas iguais | B | T13 |
| 19 | ✓/✓✓/lido das nossas mensagens | igual (casado por `keyId`); retry vira reenvio automático | B | — |
| 20 | ✓✓ que o cliente vê nas mensagens dele | recibo de entrega continua (fonte rc13) | B | T14 |
| 21 | Marcar como lida (✓✓ azul no cliente) | igual; em conversa LID depende do servidor | B/M | T15 |
| 22 | Presença (digitando/gravando) | igual, com bypass `@lid` | B | — |
| 23 | Foto de perfil | igual; `findChats` já filtra `@s.whatsapp.net` (3.325 chats LID ficam fora do botão em lote — pré-existente; o caminho por mensagem cobre) | B | — |
| 24 | Grupos — mensagens | `participantAlt` traz telefone; forma de `group_sender_jid` decidida no ajuste 2 | B/M | T19 |
| 25 | Grupos — participantes / somos admin / nosso LID | `participants[]` sem `.jid` | M | ajuste 3, T19 |
| 26 | Grupos — menção a nós (`mentions_us`) | `own_lid` deixaria de ser aprendido | M (canais novos) | ajuste 2, T19 |
| 27 | Grupos — avisos de entrada/saída | `participants` mantido + `participantsData` novo | B | — |
| 28 | Nome do grupo mudou | `GROUP_UPDATE` passa a existir | B (melhora) | ajuste 5 |
| 29 | Conexão nova / QR / estado / Ressincronizar | schemas iguais | B | T16 |
| 30 | Automações, fluxos, IA, Radar, transcrição, busca, funil, webhooks de saída | não falam com a Evolution; só dependem de a mensagem entrar | indireto | itens 1–3, 9 |
| 31 | Canal Meta Cloud API | não existe em produção | — | — |

**Onde está o risco real:** itens 2–3 e 16. Os três já quebraram uma vez,
quebram em silêncio e se resolvem com o ajuste 1 + T17/T18.

### 7.2 Operacionais

| Risco | Detalhe | Mitigação |
| --- | --- | --- |
| **Migração das sessões exigir QR** | v7 migra PN → LID sozinha (guia + relato); há relatos de re-pareamento em outros setups | 4 celulares à mão; CRM fora de uso; é o custo aceito |
| **Regressão da `develop`** (branch sem release) | `homolog` é retag; pode mudar | imagem **por digest** conferido (3.1); observação de 48 h; gatilhos de rollback (8.4) |
| **463 / quarentena do número** | só com rc.9; a rc13 manda o carimbo; hoje a 6.7.19 não manda e é tolerada | usar rc13 (conferido na imagem); volume de envio pelo CRM baixo (17 a 77 textos/dia em 09/09 e 08/09, contra 225–493 pelo celular); watch de `463` no log |
| **Efeitos colaterais reportados com rc13** | (a) entrada 1:1 em lotes de 0–60 s; (b) FK em `IntegrationSession` bloqueando `instance/create` | (a) T21 mede; (b) não usamos chatbots internos — `DELETE FROM "IntegrationSession"` é seguro |
| **Migrations sem volta** | 4 migrations; dedup de `Chat` mexe na órfã `Bancario` | backup + restauração de prova (6.1) |
| **Redis compartilhado** | restaurar o RDB inteiro regrediria db0/db2 (outros serviços) | backup por chave para o db 9 (6.1) |
| **Telemetria** | nova, ligada por padrão, manda nome do evento + versão para `log.evolution-api.com` | `TELEMETRY_ENABLED=false` no `service update` |
| **Log morre no reinício** | prova do defeito some | guardar antes; capturar depois; (futuro) log fora do contêiner |
| **`docker stack deploy`** | yaml incompleto zeraria env | proibido; só `service update` |
| **Sessão paralela no checkout** | outra sessão mudou a branch do checkout principal em 09/09 | trabalhar **só na worktree** desta branch |

### 7.3 O cadastro (licença) — decisão do operador

- **Gratuito.** Doc oficial: *"The community license is free"*, *"no usage,
  message or instance limit for the community tier"*, sem função bloqueada.
- **Obrigatório**: sem ativação, toda rota de negócio responde
  `503 LICENSE_REQUIRED` — e **só** as rotas HTTP: as instâncias conectam e
  os webhooks saem normalmente (`main.ts` aguarda `initializeRuntime` e depois
  chama `initWA()` sem olhar o resultado; `baileys.service.ts` não consulta a
  licença). Ativação
  uma vez (e-mail + telefone do operador) pelo `/manager`. ⚠️ A alternativa
  sem navegador (`EVOLUTION_OPERATOR_EMAIL`) **não vale aqui**: só é tentada
  com `AUTHENTICATION_API_KEY` vazia, e ela é a chave do CRM (6.2, passo 4).
  Depois: **portão local** (hash no banco; funciona com o servidor deles fora
  do ar — conferido em `licensing/runtime.ts`); heartbeat separado e não
  bloqueante (relato de campo com heartbeat 404 e API normal). A **primeira**
  ativação, porém, exige o servidor deles no ar (`/v1/register/*` →
  `/v1/activate`).
- **O que sai**: na ativação, e-mail, telefone, versão e UUID da instância; nos
  heartbeats, versão, **contadores agregados** (ex.: total de mensagens no
  período), features ligadas e IP. **E, a cada boot antes da ativação, a nossa
  `AUTHENTICATION_API_KEY`** — apresentada em claro (`X-Api-Key`, sobre TLS)
  ao `/v1/activate` como candidata a chave de licença (`transport.ts`,
  `licensing-runtime.ts`). Achado da revisão adversarial de 09/09 → P9. A doc diz que **não** manda mensagens,
  contatos, números de clientes, mídia nem tokens. **Não documentado**: o que
  acontece se revogarem.
- Reinstalação do zero exige ativar de novo (`RuntimeConfig`).
- **Hoje × depois**: hoje ninguém sabe que temos a Evolution e nada sai do
  servidor; depois, cadastro único + relatório periódico de volume. O preço
  não é dinheiro — é dependência e um relatório saindo do escritório.

---

## 8. Testes de aceitação

Todos no **lead de teste autorizado** (contato "Leonardo Cabral Baptista"),
num contato **endereçado por LID** (conferir em `IsOnWhatsapp`), com o log da
Evolution e do CRM abertos. Registrar resultado e data em cada linha.

### 8.1 Roteiro

| T | Teste | Passa quando | Resultado |
| --- | --- | --- | --- |
| T1 | Texto pelo CRM | legível no celular do cliente (sem "Aguardando"); ✓✓ no CRM | **09/09 19:19: chegou legível, ✓✓ no WhatsApp do escritório; no CRM ficou 1 ✓ até o ajuste 6 (PR #171)** |
| T2 | Imagem, PDF e vídeo pelo CRM | abrem no cliente; `media_type`/`media_filename` gravados | 09/09: imagem e PDF ✅; vídeo — 10/09 |
| T3 | Nota de voz (gravador e acervo), com e sem citação | toca como voz; com citação, encadeada | 09/09: gravador ✅ (acervo e com citação — 10/09) |
| T4 | Cliente manda foto | aparece no CRM com arquivo no Storage | 09/09 19:06 (cliente real, antes da ativação): entrou sem arquivo por causa do portão 503 — recuperada às 19:34; repetir depois da ativação |
| T5 | Cliente manda documento >16 MiB e outro >50 MiB | o primeiro entra; o segundo vira `too_large` com nome; **anotar a forma de `fileLength`** | |
| T6 | Texto com URL | preview do link no cliente | 09/09 ✅ |
| T7 / T8 | Responder citando mensagem do cliente / nossa | o cliente vê o preview da citação | 09/09: **T8 ✅**; **T7 ✅ às 21:14** com a imagem `evolution-api-cb` (P10) — antes dela a citação do lead chegava sem `contextInfo` (#2713) |
| T9 | Reagir a mensagem do cliente | reação aparece no celular dele | 09/09: reação DO lead (❤️) entrou em `message_reactions` ✅; a nossa para ele — 10/09 |
| T10 / T11 | Apagar para todos: mensagem do CRM / do celular | some no cliente; `messages.delete` volta | 09/09 ✅ nos dois sentidos (celular e lead); a 2.4 manda um `messages.edited` vazio antes — ignorado |
| T12 | Editar mensagem nossa (<15 min) | edita no cliente; `text_before_edit` gravado | 09/09 ✅ (pelo CRM). Pelo CELULAR: chega cifrada → só "editada" (P11) |
| T13 | Cliente apaga e edita mensagem dele | CRM risca / atualiza | 09/09: apaga ✅; edita ❌ (cifrada, P11 — mitigada: "editada" sem texto novo) |
| T14 | Cliente nos escreve | ele vê ✓✓ na mensagem dele | |
| T15 | Abrir a conversa no CRM (marcar lida) | ✓✓ azul no cliente | |
| T16 | Criar canal de teste pelo CRM, ler QR, Ressincronizar, apagar | `open`, webhook aplicado, mensagem entra | |
| **T17** | **Mensagem pelo CELULAR pareado para contato LID** | **aparece no CRM "pelo celular"; `DESCARTADA` = 0** | **09/09 19:20: passou** (etiqueta CELULAR, `delivered`, `DESCARTADA` = 0). **10/09: ~⅓ das mensagens do celular ficavam em 1 ✓ — o recibo chegava antes da mensagem (5.9, 9.6)** |
| **T18** | **Mensagem pelo WhatsApp Web para contato LID** | idem | 09/09 ✅ (CELULAR, `DESCARTADA` = 0) |
| T19 | Grupo: mensagem nossa e de participante, menção a nós | entra; `mentions_us` acende no canal com `own_lid`; `findGroupInfos` acha nossa linha | |
| T20 | Agendar mensagem para +3 min | sai na hora, `sent`, sem duplicar | |
| T21 | Latência de entrada | 5 mensagens espaçadas do cliente; atraso = `conversations.last_message_at` (relógio do CRM) − `messages.created_at` (relógio do WhatsApp) da última mensagem da conversa. ⚠️ `messages.created_at` **é** o `messageTimestamp` (`inbound-store.ts`): comparar os dois dá zero por construção. Linha de base 09/09 (7 dias, n=186): **p50 1,2 s · p95 2,1 s · máx 3,5 s** | |
| T22 | Reinício do serviço (`service update --force`) | 4 instâncias voltam `open` sem QR | |

### 8.2 O que só o teste responde

1. Citação e reação em conversa LID chegam com preview? (T7–T9)
2. Apagar pelo telefone passa a funcionar, ou continua exigindo o LID? (T10–T11)
3. `fileLength`: string, número ou objeto? (T5)
4. As 4 sessões sobrevivem sem QR? (T22 e o próprio upgrade)
5. A entrada em lotes de 0–60 s acontece aqui? (T21)

### 8.3 Medidores (antes, durante e nas 48 h seguintes)

| Medidor | Onde | Esperado depois |
| --- | --- | --- |
| `Closing session` / `Closing stale open session` | log da Evolution | tende a zero após a migração das sessões |
| `"463"` / `messageStubParameters` | log da Evolution | **zero** — qualquer ocorrência é gatilho de rollback |
| `DESCARTADA: endereçada por @lid` | log do CRM (`crm_crm`) | **zero** |
| `RETIDA: endereçada por @lid` (desde a 1010) | log do CRM **e** a tabela `cb_mensagens_sem_telefone` (durável — o log some quando o Swarm recicla a tarefa) | raro (≈ 1 a cada 10 dias, medido em 19/09/2026). `DESCARTADA` passou a significar só "a retenção FALHOU" — esse, sim, tem de ser zero. Causa e conserto: `docs/PLANO-lid-sem-telefone.md` |
| campos `session-*_1.*` e `lid-mapping-*` | Redis db 8, hashes vivos | aparecem e crescem. **Linha de base (09/09 17:30, depois da limpeza)**: `44982408` (Bancário - Comercial) PN=291, `be282022` (Bancário - Jurídico) PN=35, `200ac9ef` (Trabalhista - Comercial) PN=152, `d1d9caf5` (Trabalhista - Jurídico) PN=140; LID=0 e `lid-mapping`=0 em todos |
| acks (`MessageUpdate`) e `read` no CRM | banco da Evolution / `messages.status` | continuam chegando |
| latência de entrada | T21 (consulta em Anexo B) | segundos, não minutos. **Base 09/09: p50 1,2 s, p95 2,1 s** |
| **entrada continua chegando** | Supabase: recebidas por hora (Anexo B) | **Base 09/09 (mediana por hora do dia, 7 dias)**: 8h–17h entre 20 e 48/h; 18h 14; noite 1–9/h. Hora cheia com 0 recebidas onde a base dá ≥ 5 = investigar na hora (webhook 401/400 é descartado sem retentativa pela Evolution e o CRM não loga o 401). A **primeira** mensagem de cliente depois do `scale=1` tem de aparecer no Supabase — prova de que o `Authorization` guardado na tabela `Webhook` ainda vale |
| **falha de decifragem do NOSSO lado** (a direção silenciosa: a mensagem do cliente não vira webhook e ele vê ✓✓) | log da Evolution, contagens sobre o arquivo guardado por marco (`grep -ci`) | **Base 09/09, 24 h até 18:24** (inclui o laço de QR das órfãs até 17:27): `Bad MAC` **166**, `No matching sessions` 20, `failed to decrypt` 20, `Decrypt` 352, `SessionError` 10, `keep alive` 82, `stream:error` 4, `Closing open session` 3, `Closing stale` 24, `qrcodeCount` 444. Esperado depois: **cai ou zera**; SUBIR = sessão migrada errada para algum contato → abrir a conversa daquele JID no celular e comparar com o CRM |
| relato de "Aguardando mensagem" | **ativo, não passivo**: (a) com T1 verde, a Dra. Isa volta ao CRM e reporta QUALQUER "Aguardando" na hora; (b) 3× por dia o operador abre no **celular do escritório** as conversas em que o CRM enviou texto e confere que a cópia **não** diz "Aguardando mensagem" (é o único detector do próprio sintoma que não depende de reclamação — seção 1) | 0/N em 24 h e 48 h |

### 8.4 Gatilhos de rollback (decididos antes, sem discutir na hora)

- **`Migration failed` no log, ou a tarefa reiniciando em laço** (`docker
  service ps` mostrando `Failed`/`Shutdown` com `non-zero exit` em sequência)
  → `scale=0` na hora e seção 10. A 2ª tentativa exige o banco restaurado
  (o rollback já faz) — nunca `scale=1` de novo sobre a migration marcada
  como falha (P3009).
- **A instância do celular à mão** (nomeada antes do `scale=0` — em 09/09 o
  operador tinha 1 celular; ver P4) não volta a `open` em 10 min **contados
  do `scale=1`** (nem com QR) — medido no banco/log, porque a API responde
  503 até a ativação (6.2, passo 5). As outras 3 pedindo QR **não é
  gatilho**: são conexões de teste, ficam em `connecting` até a leitura (em
  10/09), e ao bater `QRCODE_LIMIT=1902` viram `refused` (o CRM marca
  `disconnected`) — esperado; reconectar depois é **Reconectar** no CRM
  (`instance/connect`), não recriar a conexão.
- `RuntimeConfig table was not found` no log = a migration da 2.4 não entrou
  (`initializeRuntime` faz `process.exit(1)` → laço) → primeira linha acima.
- `/license/status` não fica ativo em **15 min** depois do `scale=1` → o
  operador decide (o custo de esperar é a foto final envelhecendo); em
  **30 min** → rollback.
- Qualquer `463` no log.
- T17 ou T18 reprovando **depois** dos ajustes do CRM.
- T1 reprovando (texto do CRM não chega legível).
- Latência de entrada: **p95 das últimas 2 h > 60 s** (base 09/09: p95 2,1 s),
  pela consulta do Anexo B — não por impressão (decisão do operador).
  ⚠️ **Só depois de 10 min da (re)conexão**: nos primeiros minutos a Baileys 7
  entrega em lotes de 30–120 s enquanto sincroniza pendências (9.5) — medido
  duas vezes em 09/09, e normaliza sozinho.

---

## 9. Fases e checklist

### Fase 0 — preparação (sem trocar versão) — **CONCLUÍDA em 09/09/2026**

- [x] Operador: e-mail e telefone do cadastro decididos (09/09)
- [x] PR com os ajustes 1, 2, 3 + testes (5.1–5.3, 5.7) — **PR #161 mesclado no `main`** em 09/09 (95 testes verdes, lint e typecheck limpos); a publicação é o run do pipeline do `main` seguinte ao merge — conferir no pré-voo (6.2.0, item 2)
- [x] Decisão do ajuste 2 (`group_sender_jid` = LID) confirmada pelo operador em 09/09 (P2) — nada muda no código
- [x] Instâncias órfãs `Bancario` e `CBAdv` removidas (autorizado e executado 09/09 17:27; a API respondeu `Instance deleted` e a remoção completou em segundo plano — `Instance` ficou com 4 linhas)
- [x] 6 hashes do Redis removidos (2 órfãs + 4 mortos); sobraram os 4 vivos
- [x] `/root/backups/` criado (09/09 17:04): `evolution-20260909-1704.dump` (105,8 MB), `redis-20260909-1704.rdb` (33,9 MB), cópia do db 8 no **db 9**, `instances-…`, `evolution-log-…txt` (25.968 linhas), `evolution-env-…txt` (600), `evolution-image-…txt`, `evolution-migrations-…txt`
- [x] Restauração de prova feita e removida (ver registro em 9.1)
- [x] Payloads reais capturados: `/root/backups/evolution-amostras-20260909-1704.jsonl` (10 linhas, 600) — falta anonimizar e transformar em fixtures no repositório
- [x] Fila de agendadas conferida: a única pendente é um resto de teste marcado para 2030 (P8) — nada real dispara na janela
- [x] Equipe avisada para usar celular/outro CRM na janela (operador, 09/09 noite)
- [x] Janela aberta em 09/09 (noite) com **1 celular** à mão — os outros 3 são conexões de teste sem uso; QR delas, se preciso, em 10/09 (P4)
- [x] Refazer o `pg_dump` e a cópia db 8 → db 9 imediatamente antes da janela → feito no pré-voo de 09/09 18:24 (9.3); a **foto final** repete com o serviço a 0 (6.2, passo 1)

#### 9.2 Registro do pré-voo — parte só de leitura (09/09/2026, 18:10, horário de Brasília)

Executado por SSH, sem alterar nada (script no scratchpad do executor):

- **Serviço** `evolution_evolution`: imagem `…lidfix:2.3.2-lidfix@sha256:dd3e46…`, 1 réplica, `UpdateConfig` = `{Parallelism 1, FailureAction pause, Monitor 5s, Order stop-first}`, `RollbackConfig` idem, `RestartPolicy` = `any`/5 s, volume `evolution_instances` → `/evolution/instances`. Tarefa atual `Running` há 3 h; as três falhas listadas são de **5 semanas atrás**. Dentro do contêiner: Evolution `2.3.2`, Baileys `6.7.19`.
- **Imagem candidata**: `evoapicloud/evolution-api@sha256:1e656f95…` (criada 2026-07-14), `2.4.0` / Baileys `7.0.0-rc13` / Node `v24.18.0` — **intacta**.
- **Instâncias** (`fetchInstances` e tabela `Instance` batem): `comercial-trabalhista-e7c7ea`, `juridico-bancario-d5a458`, `trabalhista-juridico-bf8a08`, `cbcrm-a3af0191-…-76ac04` — **4 × `open`**; `Session` = 4 linhas. `/license/status` → **404** (linha de base da 2.3.2).
- **Redis**: db 8 = 42 chaves; db 9 = **10** chaves (só os hashes de 17:04, sem TTL — os 6 apagados ainda estão lá: daí o `FLUSHDB` do 9 antes da cópia nova). Sessões PN por hash: `200ac9ef` **154** (era 152), `d1d9caf5` **142** (era 140), `be282022` 35, `44982408` 291; LID = 0, `lid-mapping` = 0 em todos.
- **Postgres**: banco `evolution` 579 MB, 6 conexões ativas (da Evolution); última migration `20250613143000_add_lid_column_to_is_onwhatsapp`.
- **Log 24 h**: `Closing session`/`stale` = 45; `"463"` = **0**; `DESCARTADA: endereçada por @lid` no CRM = **0**.
- **CRM**: `crm_crm` roda `cb-crm:7fe112d…` (= `origin/main` com o #161 e o #162) — item 2 do pré-voo **ok**.
- **Agendadas `pending`**: só `625d0c42…` (01/01/2030, a P8) — item 3 **ok**.
- **Máquina**: 65 GB livres em disco, ~5 GB de RAM disponíveis; `/root/backups/` com os 9 artefatos de 17:04.
- **Segunda passada (18:43, itens 11–15 do pré-voo)**: `DEL_INSTANCE=false`, `QRCODE_LIMIT=1902`, `SERVER_URL=https://api.cbadvogados.com`. Log de 24 h (arquivo de 18:24, 73.722 linhas, inclui o laço das órfãs até 17:27): `Bad MAC` 166, `No matching sessions` 20, `failed to decrypt` 20, `Decrypt` 352, `SessionError` 10, `keep alive` 82, `stream:error` 4, `Closing open session` 3, `Closing stale` 24, `qrcodeCount` 444, `error` 656. Migrations: imagem 59 × produção 55, nada faltando, 4 novas (nomes no item 12). `Chat` duplicado = 0. Bundle da imagem sem URL de licença em claro; fallback = mesma URL de produção. CRM: 1 automação de entrada ativa (teste, `keyword_match`), 0 esperas, 0 fluxos ativos; recebidas em 7 dias **2.324**, mediana por hora do dia (BRT) 8h 21 · 9h 21 · 10h 20 · 11h 37 · 12h 28 · 13h 28 · 14h 39 · 15h 47 · 16h 48 · 17h 34 · 18h 14 · 19h 4 · 20h 9 · 21h 3 · 22h 2 · 23h–7h 1–7; latência de entrada (n=186) **p50 1,22 s · p90 1,82 s · p95 2,09 s · máx 3,46 s**. Imagem de rollback no nó (id `7e614b07…`, 1,11 GB).

#### 9.3 Registro do pré-voo — parte de backup (09/09/2026, 18:24–18:25, horário de Brasília)

Script `prevoo-backup.sh` em segundo plano na VPS (`/root/backups/prevoo-run.log`), com o serviço **vivo**; carimbo **`20260909-1824`**:

- `pg_dump -Fc` → `evolution-20260909-1824.dump`, **14,3 MB em 5 s** (o de 17:04 tinha 105,8 MB — ver a cascata abaixo).
- Redis: db 8 = 36 chaves (era 42 às 18:10 — chaves `evolution:baileys:*` com TTL expirando); **`FLUSHDB` do db 9** (tinha 10 hashes, os 6 apagados inclusos) e cópia nova: **36 copiadas, 0 falhas, db 9 = db 8 = 36**; os 4 hashes `evolution:instance:*` vivos conferidos no db 9. `SAVE` + `redis-20260909-1824.rdb` (3,2 MB — o de 17:04 tinha 33,9 MB porque carregava os 6 hashes mortos).
- `instances-20260909-1824` (20 K, 4 pastas), log de 24 h (73.722 linhas), env (124 linhas, `chmod 600`), imagem, 55 migrations.
- **Restauração de prova** (`evolution_ensaio`, `pg_restore` em **5 s, 0 avisos**), mesmo corte: `Message` até 1 h antes **70.482 = 70.482**, última hora **52 = 52**; `Chat` 2.607 = 2.607; `Contact` 6.220 = 6.220; `IsOnWhatsapp` 22.626 = 22.626; `Instance` 4 = 4; `Session` 4 = 4; `Webhook` 4 = 4; `Setting` 4 = 4; `MessageUpdate` 10.836 = 10.836; `Media` 0 = 0; 55 migrations; 4 instâncias `open` no ensaio. Banco de ensaio apagado. Disco: 65 GB livres.
- ⚠️⚠️ **Achado: o `DELETE /instance/delete` das órfãs levou o HISTÓRICO delas junto.** Entre a prova de 17:25 (348.805 mensagens, 7.019 chats, 17.202 contatos, 6 instâncias) e esta (70.482 / 2.607 / 6.220, 4 instâncias) o banco perdeu ~278 mil linhas de `Message`: o `schema.prisma` da Evolution tem `onDelete: Cascade` de **toda** tabela filha para `Instance` (Message, Chat, Contact, MessageUpdate, IsOnWhatsapp não — ela é global —, Label, Media…). As linhas apagadas eram das instâncias `Bancario` e `CBAdv`: já **inalcançáveis** pelas conexões vivas (a Evolution consulta sempre por `instanceId`), e o CRM tem a cópia própria de tudo no Supabase. Nada do que as 4 conexões vivas usam mudou (hoje: `trabalhista-juridico` 30.280, `cbcrm-…` 26.916, `comercial-trabalhista` 11.908, `juridico-bancario` 1.430). O dump de **17:04** continua em `/root/backups/` com as 348 mil — é o único lugar onde o histórico das órfãs existe fora do Supabase. `pg_database_size` continua dizendo 579 MB (tuplas mortas até o `VACUUM`).
  **Prova** (dump de 17:04 restaurado de novo em `evolution_ensaio` às 18:40, 20 s, 0 avisos, e apagado): `Bancario` **177.185** mensagens / 3.512 chats / 6.309 contatos, `CBAdv` **101.287** / 900 / 4.684 — as duas em `connecting` (laço de QR); as vivas tinham `trabalhista-juridico` 30.231, `cbcrm-…` 26.894, `comercial-trabalhista` 11.894, `juridico-bancario` 1.430 — hoje 30.280 / 26.916 / 11.908 / 1.430, ou seja, **só cresceram**. 177.185 + 101.287 = 278.472 = a diferença.

#### 9.4 Registro da execução da Fase 1 (09/09/2026, 18:53–19:03, horário de Brasília — UTC−3)

- **Tentativa 1 (18:53–18:57)**: `scale=0` 18:53:17 UTC; foto final `20260909-1853-final` (dump 14,26 MB em 3 s, 36 `TABLE DATA`, `Message` 70.540, Redis 16 = 16, RDB 3,2 MB); especificação trocada (imagem por digest + `TELEMETRY_ENABLED=false`); `scale=1` 18:53:32. **Falhou na migration, antes de tocar no banco**: `Error: The datasource.url property is required in your Prisma config file when using prisma migrate deploy` — laço de reinício detectado em 20 s (2 tarefas `non-zero exit`), `scale=0` às 18:54. Causa: a imagem `homolog` (build de 14/07, Prisma **7.8.0**, `datasource` do schema sem `url`) **não contém o `prisma.config.ts`** — o `develop` o tem desde 15/06 (commit `dd552c7`), mas o Dockerfile não o copia para a imagem final (`COPY` só de `package*.json`, `dist`, `prisma/`, `manager`, `public`, `.env`, `Docker/`, `runWithProvider.js`, `tsup.config.ts`). Não há build `homolog` mais novo no Docker Hub (a tag é de 14/07, mesmo digest). Banco intocado (55 migrations, sem `RuntimeConfig`), Redis intocado.
- **Volta (18:56–18:57)**: como nada rodou, bastou trocar a especificação de volta (`--image …lidfix@dd3e46…`, `--env-rm TELEMETRY_ENABLED`) e `scale=1` — **sem restaurar nada**. HTTP no ar 18:57:22; 4 × `open` sem QR (API e banco). Parada total: **4 min**.
- **Ensaio da correção (18:59)**: `prisma.config.ts` do `develop` (lê `env('DATABASE_CONNECTION_URI')`, a nossa variável) copiado para `/root/evolution/prisma.config.ts`; foto final restaurada em `evolution_ensaio`; a imagem `homolog` rodada como contêiner avulso (`docker run --rm --network container:$PGCID -v /root/evolution/prisma.config.ts:/evolution/prisma.config.ts:ro …`, URI apontando para `127.0.0.1:5432/evolution_ensaio`) só com `. ./Docker/scripts/deploy_database.sh`: **as 4 migrations aplicaram em 9 s**, `prisma generate` ok, `RuntimeConfig` criada, `Chat_instanceId_remoteJid_key` criado, `Message` 70.540 intacta. Autorizado pelo operador na hora.
- **Tentativa 2 (19:02–19:03)**: `scale=0` 19:02:03; foto final **`20260909-1902-final`** (dump 14,26 MB, `Message` **70.550** / máx `messageTimestamp` 1788991209, Redis **59 = 59**, `HLEN` 437/726/275/1276, RDB 3,2 MB); especificação: imagem por digest + `TELEMETRY_ENABLED=false` + **`--mount-add type=bind,source=/root/evolution/prisma.config.ts,target=/evolution/prisma.config.ts,readonly`**; `scale=1` **19:02:22**; `Migration succeeded` + `Prisma generate succeeded` às 19:02:26 (as 4: `add_kafka_integration`, `add_chat_instance_remotejid_unique`, `increase_token_length`, `add_runtime_config`); HTTP no ar ~19:02:35; **4 × `CONNECTED TO WHATSAPP` sem QR** (19:02:36), `Instance` 4 × `open`, webhooks `connection.update` entregues ao CRM (os 4 `cb_channels` marcados `connected` às 19:02:36 — o `Authorization` guardado continua válido). Contêiner: `2.4.0` / `7.0.0-rc13`. `/license/status` → `{"status":"inactive","instance_id":"02510f09-…"}`; `fetchInstances` sem chave → 503 com `register_url = https://api.cbadvogados.com/manager/login` (certo).
- **Sinais aos 4 min**: `lid-mapping-*` = **2** em cada um dos 4 hashes (campo novo da v7), `session-*_1.*` ainda 0 (migra no primeiro tráfego), PN inalteradas (154/142/35/291); log: `463` = 0, `Bad MAC` = 0, erros = 0. Apareceu um hash `evolution:instance:whatsapp_web_version` (cache novo da 2.4).
- **Ativação (19:13)**: pelo operador, no `/manager`; `/license/status` → `active`; `RuntimeConfig` guardada em `evolution-runtimeconfig-20260909-1902-final.dump`; `fetchInstances` com chave → 4 × `open`. Entre o `scale=1` e a ativação o CRM registrou 13 × `[health] servidor Evolution não respondeu` e **2 anexos sem arquivo** (uma imagem de cliente às 19:06 e uma nota de voz do celular às 19:11 — o download passa pela API, que respondia 503). Os dois foram **recuperados às 19:34** por `getBase64FromMediaMessage` → Storage (`account-…/1788993295164-4A7B0AA03B1C7F4E584D.jpg`, `…-2A78908AE8C263E859CE.oga`) → `media_url`/`media_type` na linha.
- **Rodada 1 de testes (19:19–19:20, lead autorizado, canal Bancário - Comercial)**: **T1 passou** — os 4 textos do CRM chegaram legíveis, e o WhatsApp Web do escritório mostra ✓✓ neles **sem "Aguardando mensagem"** (a mensagem das 18:16, anterior ao upgrade, continua com o aviso — é o sintoma antigo); **T17 passou** — o texto do celular pareado apareceu no CRM com a etiqueta CELULAR, `DESCARTADA` = 0; as respostas do lead ("Oi", "Teste") entraram (T14 do lado dele e T15 a confirmar com o operador). **Defeito achado**: no CRM os 4 textos ficaram com **um ✓** enquanto o WhatsApp mostrava ✓✓. Causa medida no log: a 2.4 emite **vários `messages.update` fora de ordem** para a mesma mensagem — `SERVER_ACK` 19:19:12.089, `DELIVERY_ACK` 19:19:12.241, `SERVER_ACK` 19:19:12.270, `DELIVERY_ACK` 19:19:13.306 e **`SERVER_ACK` 19:19:21.531** (e outro às 19:19:51 nas três seguintes), alternando `remoteJid` `143838555439152@lid` e `143838555439152` (sem sufixo); a rota do CRM aplicava o status sem guarda e o último rebaixava `delivered` → `sent`. O replay manual do `DELIVERY_ACK` real contra a rota virou a linha `delivered` — o caminho está íntegro. **Ajuste 6** (escada monotônica) no **PR #171**. No banco da própria Evolution as 4 ficaram `PENDING` (ela não casa o recibo por LID com a linha guardada por telefone — só afeta o bookkeeping dela).
- **Decifragem**: 3 mensagens de clientes deram `SessionError` ×3 cada (19:06 e 19:13, `failed to decrypt`), e as três **entraram** depois da repetição (retry receipt da v7): a imagem das 19:06 é a recuperada acima; as duas mensagens do lead às 19:19:57 entraram na hora. `463` = 0, `Bad MAC` = 0.
- **`fileLength` (P5)**: chega como **objeto `Long`** `{ low: 59064, high: 0, unsigned: true }` (webhook e banco). `mediaBytesOf` devolvia `null` (tentava baixar, sem dano), mas o portão da 986 ficava cego → **ajuste 4** (`bytesDeclarados`) no mesmo PR #171. `mediaKey` chega como `Uint8Array` serializado.
- **Reinícios do `crm_crm` (19:01, 19:10, 19:19)**: não foi defeito — foram **três deploys** do pipeline (PRs #163, #164, #168 de outra sessão mesclados no `main` durante a janela); o rollout `start-first` dá uns segundos de 502 no Traefik, e a Evolution registrou 8 × `Request failed with status code 502` nos webhooks às 19:19:57–19:20:15 — **retentados** (as mensagens do lead entraram). Lição em 0.4.
- **Sinais aos 12 min**: `session-*_1.*` (LID) = 2 em `d1d9caf5` e `44982408`, `lid-mapping` 6 e 8; PN inalteradas.
- **PR #171 mesclado e publicado (19:50–20:00)**: `crm_crm` em `1fc6efc…`; os 3 recibos pendentes das mensagens de teste reaplicados por replay (`delivered`) e um `SERVER_ACK` atrasado reaplicado **não rebaixou** — a escada está em produção.
- **Rodada 2 de testes (19:39–20:08, lead autorizado)**: **T2** (foto e PDF pelo CRM) ✅ arquivo no Storage, `media_type` gravado; **T3** (nota de voz pelo gravador) ✅; **T4** (foto do lead, depois da ativação) — a foto do celular pareado entrou com arquivo ✅; **T6** (texto com link) ✅; **T8** (CRM citando mensagem do lead) ✅ — o lead viu a caixinha da citação; **T9** (reação ❤️ do lead) ✅ `reactionMessage` registrado em `message_reactions`; **T10/T11** (apagar para todos, do celular e do lead) ✅ — as duas riscadas no CRM (a 2.4 emite `messages.edited` VAZIO com `type: 0` antes do `messages.delete` — a rota ignora o edited sem texto, de propósito); **T12** (editar pelo CRM) ✅ `text_before_edit`/`edited_at`; **T18** (WhatsApp Web do escritório) ✅ etiqueta CELULAR, `DESCARTADA` = 0; **T15** (✓✓ azul) — a confirmar visualmente em 10/09.
  ❌ **T13 (cliente/celular EDITA)**: a edição chega como `secretEncryptedMessage` (`secretEncType: 2`, `targetMessageKey`), cifrada com *message secret*, que a **Baileys rc13 não decifra** (PRs upstream WhiskeySockets/Baileys **#2690** e **#2743** abertos; nenhuma versão publicada decifra). O CRM inseria uma bolha VAZIA (aconteceu 2×). **Ajuste 7** (PR **#175**, mesclado 20:07): o item é descartado e a mensagem alvo ganha `edited_at` mantendo o texto antigo (a bolha diz "editada", sem o "era: …"). PR **#177**: escopo de conta no carimbo (achado do Codex).
  ❌ **T7 (lead CITA uma mensagem nossa)**: a resposta chega como `conversation` **sem `contextInfo`** (sem `stanzaId`/`quotedMessage`) — no banco da Evolution e no webhook. Reteste limpo às 20:08 confirmou. É **bug da Evolution 2.4** (`prepareMessage` achata `extendedTextMessage` em `conversation` e descarta o `contextInfo`, linhas 5184–5187 do `develop`): issue **evolution-foundation/evolution-api #2713** ("incoming text replies flattened to 'conversation' — contextInfo lost", 26/08/2026) com PRs de correção **#2654** e **#2708** abertos e não mesclados. Nada a fazer no CRM (o dado não chega). Saída possível: imagem própria com o patch (P10).
- **Decisão do operador (20:05)**: **ficar na 2.4** em observação de 48 h — o conserto principal funciona (texto do CRM chega sem "Aguardando", 4 conexões sem QR, entrada normal), e as duas perdas (edição do cliente, citação do cliente) são limitações do upstream, mitigadas/registradas.

#### 9.5 Registro da P10 — imagem própria com a citação do cliente (09/09/2026, 20:50–21:25, BRT)

- **Autorização**: "Faça a correção para a citação" (20:45). Conferido antes que o CRM **nunca** leu a citação no transporte Evolution (só o caminho da Meta resolvia `context.id`) — então eram duas partes.
- **PR #184** (mesclado 20:59): workflow `.github/workflows/evolution-cb.yml` + `docker/evolution-cb/` (o diff do PR upstream #2708, 51 linhas, `git apply --check` limpo no commit `e273b904` = o `org.opencontainers.image.revision` da `homolog`; o Dockerfile ganha `COPY` do `prisma.config.ts` no builder e na imagem final); CRM: `quotedProviderId()` em `evolution-inbound.ts` (lê `contextInfo.stanzaId` no nível de cima — 2.4 com patch — ou dentro do corpo — 2.3.2 e mídia) e `inbound-store.ts` grava `reply_to_message_id` quando a citada está na mesma conversa. **PR #186** (Codex): `locationMessage` na leitura, e contato existente nunca é renomeado para um número (o fallback de `pushName` do patch fica em `fetchMessages`, fora do webhook — defesa em profundidade).
- **Build**: run 34418839311 (GitHub Actions, ~10 min); conferido na VPS: `2.4.0` / `7.0.0-rc13`, `prisma.config.ts` com `DATABASE_CONNECTION_URI`, **59 migrations = 59 da produção** (troca sem tocar no banco), `quotedContext` não aparece no bundle minificado (o workflow confere no fonte antes do build).
- **Troca (21:10–21:11)**: roteiro `fase1-troca-cb.sh`. ⚠️ A 1ª execução **abortou na trava do dump** com o serviço a 0: `pg_restore -l | grep -q` fecha o pipe cedo e, com `set -o pipefail`, o próprio `pg_restore` devolve erro — a trava (sugerida pelo Codex no #165 e escrita por mim no Anexo B) era falsa. Corrigida na hora (TOC para arquivo + `grep -c`) e reexecutada: foto final **`20260909-2110-final`** (dump 14,3 MB, `Message` 70.620, Redis 25 = 25, RDB, `RuntimeConfig` guardada), `service update --image …cb@dc0f4e8b… --mount-rm /evolution/prisma.config.ts`, `scale 1` às 21:10:54, `Migration succeeded` (nada a aplicar), **4 × CONNECTED em 20 s**, HTTP no ar 21:11:15, licença **ativa** sem reativar, `fetchInstances` 4 × `open`. Parada total: **71 s**, contando o abort.
- **T7 ✅ (21:14)**: o lead respondeu citando o "oi" do CRM; a Evolution entregou `contextInfo.stanzaId = 3EB095D4…` + `quotedMessage`, e a linha no CRM nasceu com `reply_to_message_id = ecb206ba…`. A caixinha da citação aparece na bolha.
- **Aquecimento da conexão (T21, P6)**: nos ~6 primeiros minutos depois da troca a entrada saiu em **lotes**: latências de **1 s, 105 s, 120 s, 73 s** (rajadas às 21:15:33 e 21:16:33, 60 s de intervalo); às **21:19:41 já era 0 s**. É a Baileys 7 segurando eventos em buffer durante a sincronização de pendências (`offline_preview` → `ev.buffer()`; descarga automática a cada **30 s** — `BUFFER_TIMEOUT_MS` em `event-buffer.ts`; `ev.flush()` no `ib offline`). O operador viu o CRM sem as mensagens às 21:15 e reportou "não chegam" — chegaram às 21:16:33. **Regra nova para 8.4**: latência só conta como gatilho **depois de 10 min** da (re)conexão.
- Rollback agora: seção 10 com a foto `20260909-2110-final`; a imagem de volta é a `homolog@1e656f95…` **com** `--mount-add type=bind,source=/root/evolution/prisma.config.ts,target=/evolution/prisma.config.ts,readonly` (mesmo commit, sem migration).

#### 9.6 Registro — 1 ✓ nas mensagens do celular (10/09/2026, 09:55–10:30, BRT)

- **Relato**: na conversa de um lead, as mensagens de 06:00, 09:01 e 09:51 — mandadas pelo
  outro CRM através do celular pareado — com 1 ✓ no CRM.
- **A Evolution recebeu o recibo**: `MessageUpdate` tem `DELIVERY_ACK` para as três (e para as
  do mesmo lead em 09/09); no CRM elas seguiam `sent`.
- **A corrida, medida nas duas pontas**: no log da Evolution, mensagem e recibo saíram juntos
  (06:00:27/06:00:28; 09:05:42/09:05:42; 09:51:55/09:51:55). No log do PostgREST, a das 09:51:
  `PATCH …message_id=eq.3EB050AAE0004250FB26…status=in.(sending,sent)` às 12:51:55.708 UTC
  e o `POST /rest/v1/messages` dela às 12:51:57.644 — o UPDATE rodou 1,9 s antes de a linha
  existir, e o recibo morreu. As duas leituras `select=id&message_id=eq.…&limit=1` (12:51:55.531
  e 12:51:57.568) são o `jaGravada` e a sua espera de 2 s — a causa do atraso da gravação.
- **Tamanho**: desde 20/08, 1.267 de 3.315 mensagens do celular presas em `sent` antes do
  upgrade (38%) e 51 de 149 depois (34%) — é da rota do CRM, não da Baileys 7. Pelo CRM:
  20 de 147 antes, 5 de 12 depois. Correção na rota: 5.9.
- **Acervo**: 1.361 mensagens `sent` (agent/bot) no CRM; **1.258** têm recibo guardado na
  Evolution (celular: 999 → `delivered`, 237 → `read`; CRM: 15; robô: 7); 103 sem recibo
  nenhum. **Decisão do operador (10/09): o acervo fica como está — basta valer daqui para frente.**
- **À parte, não explicado**: as mensagens das 09:01 e das 09:51 só chegaram à Evolution às
  09:05:42 e às 09:51:55 (4 min e 27 s depois do envio), sem reconexão registrada no
  intervalo. Não afeta o ✓; afeta a hora em que a mensagem aparece no CRM. Acompanhar nos
  medidores de 24/48 h (8.3).

#### 9.7 Registro — o atraso de entrega e o limite de 1 msg/min (16–17/09/2026, BRT) — o "ANTES" da verificação do 5.10

**16/09.** Bancário-Comercial com 26–30 min de atraso e os dois eixos da saúde
verdes. No banco da Evolution, no MESMO instante de gravação: carimbo 12:02:15
numa conexão e 11:36:22 na outra. VPS ociosa (load 0,16; Evolution 0,4% de
CPU; API em 23 ms), zero timeout de webhook, zero queda. `POST
/instance/restart` → 16 min viraram 1min40s em um minuto. PR #220 (1002).

**17/09, o "antes", com três instrumentos:**

| medida | valor |
| --- | --- |
| Log 07:00–10:24, Trabalhista-Jurídico (75 msgs) | mediana **6,0 min**, p90 13,1, max 15,5, **53% > 5 min** |
| Log, mesmo período, cbcrm (37 msgs) | mediana 0,0 min, 0% > 5 min |
| Cadência de despacho (log) | intervalo de **60 s** 38× numa instância, 22× noutra; 61 s 12× |
| Mesma rajada | **11 recibos e 1 mensagem** |
| Tipo de mensagem × atraso | `conversation` 6,3 min, `audioMessage` 5,5 min — NÃO é mídia |
| Banco da Evolution, 11:16 (atraso da última msg) | cbcrm **8,8**, trabalhista-juridico **7,3**, juridico-bancario 2,2, comercial-trabalhista 0,5 min |
| Cronômetro `chat/fetchProfilePictureUrl`, mesmo instante | cbcrm **60,1 s**, trabalhista-juridico **60,1 s**, juridico-bancario **60,0 s**, comercial-trabalhista **0,3 s** |
| Por LID (4 + 4 contatos) | **7 de 8 = 60,1 s**; 1 respondeu em 0,3 s |
| Por telefone | 0,2–0,7 s (1 em 10 estourou 60 s) |
| Mesmo número, duas conexões | 60,1 s × 0,7 s — o estado é do PAR (sessão, contato) |
| Assinatura no log (3 h) | 4 msgs em 9 s → despachos 11:26:27, 11:27:27, 11:28:28, 11:29:28; intervalos 120/181/241/362 s = múltiplos de 60 (ecos do celular na mesma fila); conexão sadia: 1 s |
| JIDs em 48 h (banco da Evolution) | cbcrm 999 LID × 17 telefone; comercial 321 × 0; jurídico 25 × 1; trabalhista **681 × 0**; `remoteJidAlt` telefone em 100% (1011/1011, 314/314, 25/25, 687/687) |
| Settings das 4 instâncias | `readMessages`/`readStatus`/`groupsIgnore`/`syncFullHistory`/`alwaysOnline` = false (nenhum outro `await` de rede no handler) |
| Ambiente | sem rate limit; `CONFIG_SESSION_PHONE_VERSION=2.3000.1025193442`; RabbitMQ/SQS/S3 off; Chatwoot global on, por instância off |

**Rollout (17/09 12:39:37 BRT).** 1003 às 12:39:17; `docker service update` às
12:39:37; HTTP ON às 12:39:54; 4 conexões `open` em < 1 min; API 200. Com a
1003: a última mensagem gravada pelo processo ANTIGO (12:39:38) era do celular,
carimbo 12:12:45 — **26,9 min** de atraso; a primeira do processo novo, carimbo
12:41:49 → gravada 12:41:49 — **0,0 min**. Aos 10 min: 16 despachos, e **10
mensagens da cbcrm carimbadas 12:45 gravadas dentro do mesmo minuto** (antes
levariam 10 min); mediana 0,0. ⚠️ **Nenhum carimbo antigo da cbcrm
(12:13–12:39) chegou** — a fila em memória do processo antigo se perdeu (0.4);
as outras duas conexões estavam em dia (comercial: 12:29:56 → 12:29:57;
jurídico: 12:17:59 → 12:18:00).

**Primeira hora com a 1003 (12:40–13:01, Bancário-Comercial, 20 msgs 1:1):**
cliente 0,5–2,6 s; celular 2,6–3,4 s (os 2 s do `jaGravada`, 5.9) e **três
ecos do celular a 6,6–7,4 s** = o teto de 5 s + 2 s — para aquele contato o
telefone tampouco responde a consulta de foto em alguns ecos. Os intervalos de
4–7 s entre gravações eram uma conversa ao vivo (carimbos já espaçados de
3–9 s), não o teto em série — por isso a consulta B perdeu a coluna `em_5s` e
a A ganhou `pct_acima_5s`.

**13:03, Trabalhista-Jurídico — o teto em SÉRIE, medido:** um cliente mandou 9
mensagens entre 13:03:06 e 13:03:10; foram gravadas 13:03:11, :17, :22, :27,
:32, :37, :42, :47, :52 — **5,1 s uma da outra**, atraso 6,0 → 10,1 → 14,3 →
19,3 → 24,5 → 29,5 → 33,7 → 38,8 → **42,9 s**; três conversas presas atrás
(28,1 / 30,5 / 20,7 s). Para esse contato a consulta pelo telefone tampouco
responde, e o `concatMap` continua serial: 5 s × 9. Antes do patch seriam
60 s × 9 = 9 min. `pct_acima_5s` na primeira hora: Bancário-Comercial 14%,
Trabalhista-Jurídico 37% (n = 35, dominado pela rajada), Trabalhista-Comercial
0%. É a assinatura da "solução 3" (5.10), já na primeira hora.

O fonte foi recuperado do `dist/main.js.map` da imagem em produção
(`sourcesContent`, 198 arquivos). O logger `BaileysMessageProcessor` está
silenciado pelo nível de log em produção — o cronômetro no endpoint provou em
4 min o que o log não mostrava. ⚠️ `127.0.0.1:8080` no host não alcança a rede
overlay: o curl sai por `https://api.cbadvogados.com`.

#### 9.1 Registro da execução da Fase 0 (09/09/2026, 17:04–17:30)

- **Prova de restauração** (`evolution_ensaio`, 0 avisos do `pg_restore`), comparando o mesmo corte:
  `Message` até 1 h antes do dump **348.805 = 348.805**, última hora **116 = 116**; `Chat` 7.019 = 7.019; `Contact` 17.202 = 17.202; `IsOnWhatsapp` 22.622 = 22.622; `Instance` 6 = 6; `Session` 6 = 6; `Webhook` 5 = 5; `Setting` 6 = 6. Banco de ensaio apagado.
  ⚠️ Duas armadilhas da conferência, para não repetir: (1) comparar a contagem TOTAL de `Message` da produção com a do dump reprova sempre — chegam mensagens entre o dump e a conta (14 em 15 min); (2) `Message.id` é **texto (cuid)**, não inteiro — o corte tem de ser por `messageTimestamp`, não por `id`.
- **Amostras** (forma real da 2.3.2 em produção): mensagem de cliente em conversa LID chega com `remoteJid` = telefone, `previousRemoteJid` = LID e o telefone repetido em `senderPn`/`remoteJidAlt`; `fileLength` chega como **string** (`'43407'`, `'148421'`); `source` ∈ {`ios`, `web`, `unknown`}.
- **Órfãs**: `DELETE /instance/delete/{Bancario,CBAdv}` → `Instance deleted`; 5 s depois ainda apareciam como `close` (remoção assíncrona); ao fim, 4 instâncias, duplicata em `Chat` = 0, **0 linhas de QR** no minuto seguinte, 4 conexões `open`.
- **Redis**: 6 `DEL` confirmados; sobraram os 4 hashes vivos; o db 9 guarda a cópia de 17:04 (as chaves `evolution:baileys:*` têm TTL e expiram também na cópia — o que interessa são os hashes das instâncias, sem TTL).
- **Log durante a Fase 0**: `error in sending keep alive` (Timed Out) às 17:14, 17:18, 17:22 e 17:25 — **antes** das exclusões, durante o dump/restore (I/O pesado no mesmo Postgres) e com as órfãs ainda em laço; `stream:error 503` às 17:26:39 seguido de `connection.update` → `state: 'open'` às 17:26:40. As 4 conexões vivas terminaram `open`.
- **Agendada pendente**: ver a linha em 12 (P8).

### Fase 1 — upgrade

- [x] Pré-voo, parte só de leitura (6.2.0, itens 2, 3, 5, 6, 7) — 09/09 18:10, registro em 9.2
- [x] Pré-voo, parte de backup (6.2.0, item 4): dump novo, `FLUSHDB` do db 9 + cópia, RDB, restauração de prova, log — 09/09 18:24, carimbo `20260909-1824`, registro em 9.3
- [x] Operador confirmou janela e equipe avisada; **1 celular** à mão (os outros 3 números são de teste — QR em 10/09 se pedirem); P2 decidida (LID) — 09/09 noite
- [x] Instância do celular à mão **nomeada** (P4): `cbcrm-…-76ac04` (11 96410-2992)
- [x] `docker service scale evolution_evolution=0` e **foto final** (6.2, passos 0–1) — `20260909-1902-final` (9.4)
- [x] `service update` com a imagem por digest + `TELEMETRY_ENABLED=false` + o mount do `prisma.config.ts` (a 0 réplicas) e `scale --detach =1` — 19:02:22 BRT (9.4); a tentativa 1 sem o mount falhou e voltou em 4 min
- [x] Migrations aplicadas — as 4 em `_prisma_migrations` às 19:02:26 (nomes em 9.4); sem laço na tentativa 2
- [x] 4 × `CONNECTED TO WHATSAPP` sem QR às 19:02:36; `lid-mapping` = 2 por hash aos 4 min
- [x] Cadastro/ativação feito pelo operador às 19:13; `/license/status` = `active`; `RuntimeConfig` guardada
- [x] 4 conexões `open` no banco, no log e na API — **nenhum QR pedido**
- [x] `lid-mapping-*` / `session-*_1.*` no Redis (19:15: LID = 2 em duas conexões, `lid-mapping` 2–8)
- [ ] Prova da foto final em `evolution_ensaio` (count total igual) — depois do `scale=1`
- [ ] Log guardado a cada marco (migrations, `open`, ativação, fim dos testes) e antes do T22
- [x] Rodada 1 e 2 executadas em 09/09 (9.4): T1, T2, T3, T4, T6, T8, T9, T10, T11, T12, T17, T18 ✅; T7 ❌ (bug Evolution, P10); T13 ❌ (limitação Baileys, P11, mitigada); T5, T14, T15, T16, T19, T20, T21, T22 — 10/09
- [x] Forma de `fileLength` anotada (objeto `Long`); ajuste 4 feito no PR #171
- [x] Ajuste 6 (recibo fora de ordem) — PR #171
- [x] Intervalo `scale=1` → ativação recolhido: 2 anexos recuperados (9.4); nenhuma agendada/automação disparou

### Fase 2 — observação (48 h) e fechamento

- [ ] Medidores (8.3) registrados em 24 h (10/09 ~19h) e 48 h (11/09 ~19h) — usar o script `prevoo-ro.sh`/`pos-ativacao.sh` do executor (contagens de log, sessões LID por hash, latência e entrada por hora no Supabase)
- [ ] Testes que sobraram (T5, T14/T15, T16, T19, T20, T21, T22, vídeo, acervo, reação nossa) — 10/09
- [x] P10 feita (9.5); [ ] P9 (rotação da `AUTHENTICATION_API_KEY`) decidido
- [x] `/root/evolution.yaml` **substituído** (09/09 21:37) por `/root/evolution-stack.yml` + `/root/evolution.env` (600), gerados da especificação viva e validados com `docker stack config`; cópia sem segredos em `ops/vps/` (README explica quando usar)
- [x] Docs e `CLAUDE.md` atualizados (5.6): `INFRA-VPS.md` (§1, §4, §6, §7, §8), `EVOLUTION-LID-FIX.md` marcado obsoleto, `INSTALACAO.md` 3.1, `ops/vps/README.md`, `cb-evo-baileys` reescrito para a 2.4 e reinstalado
- [ ] Cron `docker image prune -af` × imagens de rollback (P12)
- [ ] Nenhum "Aguardando mensagem" relatado
- [x] 1 ✓ nas mensagens do celular — recibo antes da mensagem, corrigido na rota (5.9, 9.6, PR #191); acervo de 1.258 mensagens presas em `sent`: **fica como está** (decisão do operador, 10/09)
- [x] Atraso de entrega (1 msg/min por conexão): sonda na saúde (1002, PR #220, 16/09); causa provada e patch pronto (5.10, 9.7, 17/09)
- [x] Migration 1003 aplicada em produção — 17/09 12:39:17 BRT, histórico `20260917153917`
- [x] Rollout da imagem `-foto` — **FEITO em 17/09 12:39:37 BRT** (não repetir: `docker service inspect evolution_evolution` mostra `…citacao-foto@sha256:a7d56788…`); custo medido em 5.10
- [ ] **Verificação em ≥ 3 dias** (a partir de 21/09; consultas A e B do 5.10) → registrar o "depois" em 9.7 e fechar, ou abrir a "solução 3" se houver pico em 5 s
- [ ] Ajuste 5 (`GROUP_UPDATE`) + Ressincronizar nas 4 conexões
- [ ] `/root/evolution.yaml` atualizado (imagem por digest, `TELEMETRY_ENABLED`)
- [ ] Docs e `CLAUDE.md` atualizados (5.6); `EVOLUTION-LID-FIX.md` marcado obsoleto
- [ ] Memória do projeto atualizada
- [ ] **Apagar todas as worktrees paralelas** (`git worktree list` → `git worktree remove` de cada uma, inclusive as de outras sessões já encerradas) — pedido do operador em 09/09, para não ocupar espaço
- [ ] (Depois) log da Evolution fora do contêiner; desligar o outro CRM reduz aparelhos vinculados

---

## 10. Rollback

Gatilho batido (8.4) → executar na ordem, sem discutir. Comandos prontos no
Anexo B (bloco "Rollback"), em script. ⚠️ A ordem foi **corrigida em 09/09**
(revisão do Codex no PR #162): a versão anterior trocava a imagem **antes** de
escalar a 0, e `service update --image` começa a troca na hora — a 2.3.2
subiria contra o banco já migrado pela 2.4 e o Redis com estado v7, antes do
restore. E o banco vivo **não é dropado**: a foto é restaurada num banco novo,
conferida, e os dois trocam de nome (revisão adversarial da noite de 09/09) —
um `pg_restore` interrompido no meio deixaria a Evolution sem banco nenhum.

1. `docker service scale evolution_evolution=0` — **primeiro**; conferir
   `docker service ps` sem tarefa `Running`. Com 0 réplicas nada escreve no
   banco nem no Redis, e a troca de imagem do passo 4 não sobe tarefa nenhuma.
2. Postgres, **sem dropar**: `createdb evolution_volta` → `pg_restore
   --exit-on-error` da **foto final** (o dump mais recente com `-final`) em
   `evolution_volta`, em segundo plano com log → `count(*)` de `Message` em
   `evolution_volta` **igual** ao de `foto-<carimbo>.txt` → `pg_terminate_backend`
   em `evolution` → `ALTER DATABASE evolution RENAME TO evolution_v24; ALTER
   DATABASE evolution_volta RENAME TO evolution` (instantâneo; exige só que
   ninguém esteja conectado). O `evolution_v24` fica como evidência — e guarda
   a `RuntimeConfig` da licença. As 4 migrations novas **não** são desfeitas
   pela Evolution — só o dump volta, e ele traz o `_prisma_migrations` da
   2.3.2, então a 2.3.2 sobe sem migration pendente.
3. Redis db 8: `FLUSHDB` no **8** + `COPY` de cada chave do db 9 (foto final)
   de volta para o 8; `DBSIZE` do 8 = do 9 e `HLEN` dos 4 hashes = os de
   `foto-<carimbo>.txt`.
4. `docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --env-rm TELEMETRY_ENABLED --mount-rm /evolution/prisma.config.ts evolution_evolution`
   — a 0 réplicas, só a especificação muda. ⚠️ Se a migration **não** chegou a
   rodar (caso da tentativa 1 em 9.4: o banco ainda tem 55 migrations e não
   existe `RuntimeConfig`), os passos 2 e 3 são desnecessários — basta trocar a
   especificação e subir. A imagem está no nó (id
   `7e614b07…`, 1,11 GB, conferido em 09/09); **nenhum `docker image prune` /
   `system prune`** na janela nem nas 48 h.
5. `docker service scale --detach evolution_evolution=1`; **reler `CID`**;
   versão `2.3.2`/`6.7.19` no contêiner; `Instance."connectionStatus"` = `open`
   nas 4 (banco), depois `fetchInstances`.
6. **Conferência obrigatória, não espera**: trocar mensagem nos dois sentidos
   com o contato autorizado por cada conexão viva e `grep -E 'Bad MAC|No
   session|Failed to decrypt|Closing stale'` no log da 2.3.2. Regra decidida
   antes: rollback executado **depois de tráfego real com a v7** (T1 em
   diante, ou minutos de mensagens do celular) → os clientes já usam as chaves
   publicadas pela v7 e o estado restaurado não as tem → **desconectar e ler
   QR** nas conexões (em 09/09 só a do celular à mão; as outras 3 em 10/09).
   O celular do escritório não é afetado. O CRM **não enxerga** "Aguardando
   mensagem" (seção 1) — por isso é conferência, não espera por reclamação.
7. Licença: a ativação **local** fica em `evolution_v24` (tabela `RuntimeConfig`)
   e no dump `evolution-runtimeconfig-…` do passo 4 da 6.2; numa 2ª tentativa,
   restaurar só essa tabela depois do `prisma migrate deploy` dispensa novo
   cadastro. O cadastro na fundação fica registrado (inofensivo para eles).
   Mensagens recebidas durante a janela quebrada ficam no celular/outro CRM,
   não no nosso.

**O que o rollback NÃO devolve:** o que o WhatsApp registrou do lado dele
(chaves/aparelho) — coberto pelo passo 6; o volume `evolution_instances`, que
fica como a 2.4 o deixou (28 K, **sem material de sessão**: as creds estão em
`Session` e as chaves Signal no hash do Redis — `auth-prisma.ts`; a cópia do
pré-voo `instances-<carimbo>` é o plano B); e as chaves `evolution:baileys:*`
com TTL, que expiram no db 9 durante a janela — são cache de dedup/ack,
recriadas sozinhas, não restauradas de propósito.

---

## 11. Plano B de emergência (paliativo)

Se a operação precisar de alívio **antes** do upgrade: purgar as sessões da
instância afetada e reiniciar a Evolution. É **reset**, não conserto — a
duplicidade volta em dias ou semanas (relatos de 1–2 dias a semanas).

1. `docker service scale evolution_evolution=0` — **obrigatório**: a Evolution
   (2.3.2 e `develop`, conferido no fonte) envolve as chaves em
   `makeCacheableSignalKeyStore`, um cache em memória; apagar no Redis com a
   instância viva deixa sessão fantasma em memória até o cache expirar.
2. No Redis db 8, no hash `evolution:instance:<id>`: apagar **só** os campos
   `session-*` (manter `pre-key-*`, `app-state-sync-*`, `sender-key-*`; as creds
   estão no Postgres e não são tocadas). Fazer a cópia para o db 9 antes.
3. `docker service scale evolution_evolution=1`. Sem QR. A primeira mensagem a
   cada contato reestabelece uma sessão única.
4. Também remover as instâncias órfãs (6.1, item 1).

---

## 12. Decisões pendentes e perguntas em aberto

| # | Pendência | De quem |
| --- | --- | --- |
| ~~P1~~ | **Resolvida 09/09**: cadastro com `leonardocabralb@gmail.com` (telefone informado ao executor, fora do repositório) | — |
| ~~P2~~ | **Resolvida 09/09 (noite)**: `group_sender_jid` continua LID (5.2) — decisão do operador; nada muda no código | — |
| ~~P3~~ | **Autorizada 09/09** e executada (seção 9, Fase 0) | — |
| ~~P4~~ | **Resolvida 09/09 (noite)**: janela aberta; o operador tem **só 1 celular à mão** e aceitou o risco — os outros 3 números foram conectados **para teste**, ninguém os usa; se pedirem QR, ficam desconectados e a leitura fica para 10/09. Equipe avisada (celular/outro CRM). Celular à mão atende `cbcrm-a3af0191-…-76ac04` (11 96410-2992) — confirmado 09/09 18:50 | — |
| ~~P5~~ | **Resolvida 09/09**: objeto `Long {low, high, unsigned}` → ajuste 4 (PR #171) | — |
| ~~P10~~ | **Resolvida 09/09 21:11**: imagem própria `evolution-api-cb` (workflow `evolution-cb.yml`, `docker/evolution-cb/`) com o patch do #2708 + `prisma.config.ts` dentro, em produção; CRM lê a referência (PRs #184/#186). T7 ✅. Quando o upstream mesclar o #2708, voltar à imagem oficial (9.5) | — |
| P12 | **Cron `docker image prune -af --filter until=24h`** (00:17, diário) apaga as imagens de rollback (`homolog`, `lidfix`) na madrugada seguinte à troca. São públicas e voltam com `pull`, mas o rollback passa a depender de rede. Opções: tirar o `-a` do cron, ou `docker create --name manter-<nome> <imagem@digest> true` para segurá-las | operador decide |
| P11 | **Edição do cliente cifrada** (limitação da Baileys rc13; PRs #2690/#2743 abertos): mitigada no CRM (PR #175/#177 — "editada" sem o texto novo). Quando o upstream decifrar, nada muda no CRM | acompanhar |
| P6 | Latência de entrada com rc13 (5.6 dos riscos) | teste T21 |
| P7 | Log da Evolution fora do contêiner (fora deste plano, registrar) | depois |
| P9 | **Rotacionar a `AUTHENTICATION_API_KEY` depois da Fase 1?** Ela viaja em claro (sobre TLS) ao servidor da fundação em todo boot sem licença (7.3). Custo: novo valor em `AUTHENTICATION_API_KEY` (Evolution) e `EVOLUTION_GLOBAL_API_KEY` (`crm.env` + `service update --env-add` no `crm_crm`); as chaves por instância em `cb_channels.api_key` não mudam | operador |
| P8 | A única agendada `pending` (09/09) é **resto de teste automatizado** de 30/08 ("TESTE Fase 3 - fora do escopo", autor "TESTE AUTOMATIZADO", marcada para 01/01/**2030**) — não dispara na janela; cancelar quando quiser. Reconferida em 09/09 18:10: continua a única `pending` | operador (sem urgência) |

---

## 13. Anexo A — estado medido em 09/09/2026

### Instâncias na Evolution (tabela `Instance`) × canais do CRM (`cb_channels`)

| Instância (Evolution) | `id` | `ownerJid` | Estado | Canal no CRM | `own_lid` | Grupos | Hash Redis (campos) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cbcrm-a3af0191-5adc-4fa8-9c27-d69c2e5666d8-76ac04` | `44982408-b357-449c-adae-06ff28dc1dd3` | 5511964102992 | open | Bancário - Comercial (padrão) | NULL | 0 | 1.235 (280 sessões PN, 908 pre-keys, 13 sender-keys) |
| `juridico-bancario-d5a458` | `be282022-d83d-4800-a4da-f139ce034310` | 558388711991 | open | Bancário - Jurídico | `40373380473043@lid` | 12 | 274 |
| `comercial-trabalhista-e7c7ea` | `200ac9ef-98e0-4f35-a43e-f22ea168e7bd` | 558399673788 | open | Trabalhista - Comercial | NULL | 0 | 407 |
| `trabalhista-juridico-bf8a08` | `d1d9caf5-24db-48a6-a58c-8d0953200f7c` | 558386262646 | open | Trabalhista - Jurídico (`display_phone` NULL) | NULL | 0 | 664 |
| ~~`Bancario`~~ (órfã, **removida 09/09 17:27**) | `385dac9a-e446-44d9-be94-68ab94935e2e` | 5511964102992 | era `connecting` em laço de QR | — | — | — | 9.454 (cópia no db 9) |
| ~~`CBAdv`~~ (órfã, **removida 09/09 17:27**) | `c68ecb8d-5b13-4d0b-85b9-c3d9b89a01a2` | 558386262646 | era `connecting` em laço de QR | — | — | — | 3.074 (cópia no db 9) |
| ~~(apagadas, só hash)~~ **removidas 09/09** | `f71807c0-…`, `7fc75fe2-…`, `dcbf9851-…`, `60a309e7-…` | — | — | — | — | — | 3.078 / 86 / 30 / 2.720 (cópias no db 9) |

Canais do CRM sem instância na Evolution: "WhatsApp (QR Code)" (`Gabriel -
Teste`, padrão, 0 msgs) e "TESTE Bancario" (`teste-bancario-fase3`,
desconectado) — sobras de teste.

### Serviço `evolution_evolution`

- Imagem: `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694`
  (Evolution 2.3.2, Baileys 6.7.19 com o patch `peer_recipient_pn`, sem `tc-token-utils`).
- Label `com.docker.stack.image` diz `evoapicloud/evolution-api:latest` — **stale**, como o `CLAUDE.md` já documenta; nunca pinar por ele.
- Traefik: `Host(api.cbadvogados.com)`, entrypoint `websecure`.
- Volume: `evolution_instances` → `/evolution/instances` (28 K).
- `UpdateConfig` e `RollbackConfig` (medidos 09/09 18:10): `Order: stop-first`, `Parallelism 1`, `FailureAction pause`, `Monitor 5s`; `RestartPolicy: any`, atraso 5 s. Ou seja, um `service update` para a tarefa antiga antes de subir a nova — nunca há duas Evolutions vivas.
- Log: `json-file`, `max-size 10m`, `max-file 3`.
- Env relevante: `CACHE_REDIS_ENABLED=true`, `CACHE_LOCAL_ENABLED=false`,
  `CACHE_REDIS_SAVE_INSTANCES=false`, `CACHE_REDIS_PREFIX_KEY=evolution`,
  Redis `redis://redis:6379/8` (sem senha), Postgres host `postgres`, banco
  `evolution`, user `postgres` (PostgreSQL 14.17), `DATABASE_SAVE_DATA_NEW_MESSAGE=true`,
  `DATABASE_SAVE_MESSAGE_UPDATE=true`, `S3_ENABLED=false`, `WEBHOOK_GLOBAL_ENABLED=false`,
  `QRCODE_LIMIT=1902`, `CONFIG_SESSION_PHONE_VERSION=2.3000.1025193442` (ignorada),
  `TELEMETRY`/`TELEMETRY_URL` presentes com nome que a versão nova **não lê**
  (ela lê `TELEMETRY_ENABLED`).
- Redis 7.4.2, `dir /data`; keyspace: db0 559 chaves (outros serviços), db2 4, db8 130 (Evolution). `COPY … DB n REPLACE` conferido funcionando (teste em db descartável).
- Tabela `Session` (creds): uma linha por instância, as 6 presentes (1,2–3,2 KB cada); `psql -U postgres` pelo socket do contêiner entra sem senha.
- Postgres: bancos `evolution` (579 MB), `n8n_queue` (262 MB), `postgres`. ⚠️ Depois da remoção das órfãs (17:27) o `evolution` tem **70,5 mil** `Message` (eram 348,8 mil): a cascata do `DELETE` — ver 9.3. O tamanho em disco não caiu (tuplas mortas).
- VPS: 2 CPUs, 8 GB RAM (5 GB disponíveis), 67 GB livres em disco.
- `/root/evolution.yaml` (28/07/2026) incompleto; `/root/backups` não existe.

### Envios por origem (CRM, `messages.from_me = true`)

| Dia | Texto pelo celular | Texto pelo CRM | Áudio | Imagem | Documento |
| --- | --- | --- | --- | --- | --- |
| 09/09 (até ~15h) | 225 | 17 | 31 | 1 | 1 |
| 08/09 | 493 | 77 | 90 | 16 | 0 |
| 04/09 | 306 | 49 | 44 | 7 | 5 |

Zero `failed` em 12 dias.

---

## 14. Anexo B — comandos de referência

Acesso: `ssh -i ~/.ssh/cb-crm-vps root@vps.cbadvogados.com` (chave da máquina
do operador). Todos os comandos abaixo são de leitura, salvo onde marcado.
⚠️ **Cada bloco começa pelo preâmbulo de variáveis** e roda como **script**
(`nohup bash bloco.sh > /root/backups/bloco-$CARIMBO.log 2>&1 &`, e ler o log)
— as variáveis de uma sessão SSH não existem na seguinte, `$CID` muda a cada
`scale`/`update`, e `docker exec $CID …` sem contêiner falha em silêncio dentro
de uma redireção (o arquivo nasce vazio). A `KEY` sai da **especificação** do
serviço, que não depende de contêiner vivo.

```bash
# Preâmbulo (repetir no topo de TODO bloco/script)
set -uo pipefail
CID=$(docker ps -q -f name=evolution_evolution | head -1)        # vazio com 0 réplicas — reler depois de scale/update
RCID=$(docker ps -q -f name=redis_redis | head -1)
PGCID=$(docker ps -q -f name=postgres_postgres | head -1)
RC="docker exec $RCID redis-cli -n 8"
KEY=$(docker service inspect evolution_evolution --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | sed -n 's/^AUTHENTICATION_API_KEY=//p')
B=/root/backups; mkdir -p $B
q() { docker exec $PGCID psql -U postgres -d "$1" -Atc "$2"; }   # ⚠️ -d ANTES de -Atc
FOTO=$(ls -t $B/evolution-*-final.dump 2>/dev/null | head -1 | sed -E 's#.*/evolution-(.*)\.dump#\1#')   # carimbo da foto final mais recente (ex.: 20260909-1902-final)

# Contêiner e imagem em execução
docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
docker service inspect evolution_evolution --format '{{json .Spec.UpdateConfig}}'   # Order tem de ser stop-first
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json; grep -m1 "\"version\"" node_modules/baileys/package.json'
docker image inspect ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --format '{{.Id}} {{.Created}}'   # imagem de rollback no nó

# Medidores no log (o log só cobre desde o último reinício do contêiner)
timeout 90 docker service logs evolution_evolution --since 24h 2>&1 | grep -cE 'Closing session|Closing stale'
timeout 90 docker service logs evolution_evolution --since 24h 2>&1 | grep -c '"463"'
timeout 90 docker service logs crm_crm --since 24h 2>&1 | grep -c 'DESCARTADA: endereçada por @lid'   # desde a 1010: só quando a RETENÇÃO falhou — tem de ser zero
timeout 90 docker service logs crm_crm --since 24h 2>&1 | grep -c 'RETIDA: endereçada por @lid'       # raro (~1 a cada 10 dias)
# A fonte DURÁVEL das retidas é o banco do CRM (Supabase), não o log, que some quando o Swarm recicla a tarefa:
#   select situacao, resolvida_por, count(*) from cb_mensagens_sem_telefone group by 1, 2;

# Estado das instâncias (token não impresso). ⚠️ Atrás do portão de licença: 503 até ativar — use o banco.
curl -s -m 20 -H "apikey: $KEY" https://api.cbadvogados.com/instance/fetchInstances | python3 -c 'import sys,json; [print(i["name"], i["connectionStatus"]) for i in json.load(sys.stdin)]'
q evolution 'select name, "connectionStatus", "ownerJid" from "Instance"'

# Redis db 8: hashes e composição (só contagens)
for h in $($RC --scan --pattern 'evolution:instance:*'); do printf '%s ' "$h"; $RC HKEYS "$h" | awk '/^session-[0-9]+_1\./{lid++} /^session-[0-9]+\./{pn++} /^lid-mapping/{lm++} END{print "PN="pn+0" LID="lid+0" lid-mapping="lm+0}'; done

# Postgres da Evolution (a senha está no env do contêiner; não imprimir)
q evolution 'select migration_name from _prisma_migrations order by finished_at desc limit 5'
q evolution 'select "remoteJid", lid from "IsOnWhatsapp" where "remoteJid" like '"'"'55119953%'"'"''

# Backup — pré-voo COM o serviço vivo (CARIMBO=<data-hora>) ou FOTO FINAL com o serviço a 0
# (CARIMBO=<data-hora>-final). Cria arquivos; não altera o serviço. Medido em 09/09: dump 5 s.
CARIMBO=$(date +%Y%m%d-%H%M)          # foto final: CARIMBO=$(date +%Y%m%d-%H%M)-final
docker exec $PGCID pg_dump -U postgres -Fc evolution > $B/evolution-$CARIMBO.dump
test -s $B/evolution-$CARIMBO.dump || { echo "DUMP VAZIO"; exit 1; }
# ⚠️ TOC para ARQUIVO, nunca `| grep -q`: o grep fecha o pipe cedo e, com `set -o pipefail`,
#    o próprio pg_restore devolve erro — abortou a troca de 09/09 21:10 com o serviço a 0 (9.5).
docker exec -i $PGCID pg_restore -l < $B/evolution-$CARIMBO.dump > $B/toc-$CARIMBO.txt 2>/dev/null
[ "$(grep -c 'TABLE DATA' $B/toc-$CARIMBO.txt)" -gt 20 ] \
  && ls -l $B/evolution-$CARIMBO.dump && echo DUMP-OK || { echo "DUMP RUIM (truncado?)"; exit 1; }   # o DUMP-OK depende da validação (Codex, PR #165)
q evolution 'select count(*), max("messageTimestamp") from "Message"' > $B/foto-$CARIMBO.txt      # referência para o rollback
# ⚠️ O db 9 guarda a cópia anterior: esvaziar ANTES de copiar de novo — só o db 9! (Codex, PR #162)
docker exec $RCID redis-cli -n 9 FLUSHDB
n=0; for k in $($RC --scan --pattern '*'); do r=$($RC COPY "$k" "$k" DB 9 REPLACE); n=$((n+1)); [ "$r" = 1 ] || echo "COPY falhou: $k"; done; echo "copiadas=$n"
echo "db8=$($RC DBSIZE) db9=$(docker exec $RCID redis-cli -n 9 DBSIZE)"   # foto final (serviço a 0): IGUAIS. Pré-voo: podem diferir (chaves com TTL nascendo/expirando) — compare os 4 hashes:
for h in $($RC --scan --pattern 'evolution:instance:*'); do echo "$h $($RC HLEN $h) $(docker exec $RCID redis-cli -n 9 HLEN $h)"; done | tee -a $B/foto-$CARIMBO.txt
antes=$($RC LASTSAVE); $RC BGSAVE; until [ "$($RC LASTSAVE)" != "$antes" ]; do sleep 1; done   # BGSAVE, não SAVE: o Redis é compartilhado (db0/db2)
docker cp $RCID:/data/dump.rdb $B/redis-$CARIMBO.rdb && ls -l $B/redis-$CARIMBO.rdb
[ -n "$CID" ] && docker cp $CID:/evolution/instances $B/instances-$CARIMBO   # só com o contêiner vivo (pré-voo)
timeout 120 docker service logs evolution_evolution --since 24h > $B/evolution-log-$CARIMBO.txt 2>&1
[ -n "$CID" ] && { docker exec $CID printenv | sort > $B/evolution-env-$CARIMBO.txt; chmod 600 $B/evolution-env-$CARIMBO.txt; }

# Restauração de prova (cria e apaga um banco de ensaio). Mesmo $CARIMBO do dump acima.
# Serviço VIVO: comparar Message no MESMO corte de messageTimestamp (o id é cuid; a produção
# continua recebendo). Serviço a 0 (foto final, depois do scale=1): o count(*) TOTAL bate.
docker exec $PGCID dropdb -U postgres --if-exists evolution_ensaio
docker exec $PGCID createdb -U postgres evolution_ensaio
docker exec -i $PGCID pg_restore --exit-on-error -U postgres -d evolution_ensaio < $B/evolution-$CARIMBO.dump; echo "restore rc=$?"
MTS=$(q evolution_ensaio 'select max("messageTimestamp") from "Message"')
q evolution_ensaio "select count(*) from \"Message\" where \"messageTimestamp\" < $MTS - 3600"
q evolution        "select count(*) from \"Message\" where \"messageTimestamp\" < $MTS - 3600"   # têm de bater
q evolution_ensaio 'select count(*), max("messageTimestamp") from "Message"'; cat $B/foto-$CARIMBO.txt   # foto final: iguais
docker exec $PGCID dropdb -U postgres evolution_ensaio

# Rollback (DESTRUTIVO — só com um gatilho de 8.4 batido; a ORDEM é a da seção 10). FOTO=<carimbo>-final
docker service scale evolution_evolution=0
docker service ps evolution_evolution --format '{{.Name}} {{.CurrentState}}' | head -3      # nenhuma Running
docker exec $PGCID dropdb -U postgres --if-exists evolution_volta; docker exec $PGCID createdb -U postgres evolution_volta
docker exec -i $PGCID pg_restore --exit-on-error -U postgres -d evolution_volta < $B/evolution-$FOTO.dump || { echo "RESTORE FALHOU — nada foi trocado"; exit 1; }
[ "$(q evolution_volta 'select count(*) from "Message"')" = "$(head -1 $B/foto-$FOTO.txt | cut -d'|' -f1)" ] || { echo "CONTAGEM DIFERE da foto — PARAR"; exit 1; }   # as duas travas: Codex, PR #165
ARQ="evolution_v24_$(date +%Y%m%d%H%M)"   # nome ÚNICO por rollback (numa 2ª tentativa o anterior ainda existe)
q postgres "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('evolution','evolution_volta') and pid <> pg_backend_pid()"
q postgres "alter database evolution rename to \"$ARQ\"" || { echo "RENAME 1 falhou — PARAR (o banco vivo continua intacto)"; exit 1; }
q postgres 'alter database evolution_volta rename to evolution' || { echo "RENAME 2 falhou — desfazer: alter database \"$ARQ\" rename to evolution"; exit 1; }
docker exec $RCID redis-cli -n 8 FLUSHDB     # só o db 8!
for k in $(docker exec $RCID redis-cli -n 9 --scan --pattern '*'); do docker exec $RCID redis-cli -n 9 COPY "$k" "$k" DB 8 REPLACE >/dev/null; done
echo "db8=$($RC DBSIZE) db9=$(docker exec $RCID redis-cli -n 9 DBSIZE)"   # iguais
for h in $($RC --scan --pattern 'evolution:instance:*'); do echo "$h $($RC HLEN $h)"; done; cat $B/foto-$FOTO.txt   # HLEN iguais
docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --env-rm TELEMETRY_ENABLED --mount-rm /evolution/prisma.config.ts evolution_evolution
docker service scale --detach evolution_evolution=1
sleep 20; CID=$(docker ps -q -f name=evolution_evolution | head -1)                       # RELER
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json'                              # 2.3.2
q evolution 'select name, "connectionStatus" from "Instance"'                             # 4 × open
```

Consultas no Supabase do CRM (projeto `hxnhakmyxyhalbsktzwe`):

```sql
-- mensagens por origem e status (últimos dias)
select date_trunc('day', created_at at time zone 'America/Sao_Paulo')::date dia, content_type, status,
       count(*) filter (where from_device) pelo_celular, count(*) filter (where not from_device) pelo_crm
from messages where from_me and created_at > now() - interval '7 days' group by 1,2,3 order by 1 desc;

-- canais e own_lid
select label, instance_name, display_phone, own_lid, groups_enabled, status from cb_channels order by created_at;

-- agendadas pendentes (tem de ser zero na janela)
select count(*) from cb_scheduled_messages where status = 'pending';

-- latência de entrada (T21 / 8.3): última mensagem do cliente por conversa, relógio do CRM − relógio do WhatsApp
select percentile_cont(0.5) within group (order by extract(epoch from c.last_message_at - m.created_at)) p50,
       percentile_cont(0.95) within group (order by extract(epoch from c.last_message_at - m.created_at)) p95, count(*)
from conversations c join lateral (select created_at, from_me from messages where conversation_id = c.id order by created_at desc limit 1) m on true
where not m.from_me and c.last_message_at > now() - interval '2 hours';

-- entrada por hora (8.3): comparar com a mediana por hora do dia de 9.2
select date_trunc('hour', created_at at time zone 'America/Sao_Paulo') h, count(*) from messages
 where not from_me and created_at > now() - interval '48 hours' group by 1 order by 1;

-- o que dispara sozinho na reconexão (6.2.0, item 11)
select id, name, trigger_type from automations where is_active and trigger_type in ('new_message_received','first_inbound_message','keyword_match');
select count(*) from automation_pending_executions where status = 'pending' and run_at < now() + interval '3 hours';
select count(*) from flow_runs where status = 'active';

-- intervalo scale=1 → ativação (6.2, passo 8): anexos recebidos sem arquivo, disparos que falharam
select id, conversation_id, content_type, media_state, created_at from messages
 where from_me = false and media_url is null and content_type in ('image','document','audio','video')
   and created_at between '<scale=1>' and '<ativação>';
select status, count(*) from cb_scheduled_messages where updated_at between '<scale=1>' and '<ativação>' group by 1;
```

---

## Anexo C — prompt de retomada (colar numa sessão nova)

> Estamos no meio do plano `docs/PLANO-baileys-7.md` do repositório CB-CRM
> (conserto do "Aguardando mensagem": subir a Evolution para a imagem
> `homolog` com Baileys 7.0.0-rc13). Leia o plano inteiro antes de agir —
> primeiro a **seção 0** (onde está cada coisa, o que já foi feito, o que
> falta, as armadilhas), depois **6.2.0** (pré-voo), **6.2** (upgrade), **8**
> (testes e gatilhos de rollback), **10** (rollback) e o **Anexo B**
> (comandos). Leia também a memória `baileys-7-plano-e-decisoes` (tem o
> telefone do cadastro, que não está no repositório). A Fase 0 está
> concluída; o próximo trabalho é o **pré-voo e a Fase 1**. Não execute nada
> destrutivo nem troque a imagem da Evolution sem eu autorizar nesta conversa
> — comece me perguntando se a janela está aberta e se os 4 celulares estão
> à mão, e então rode o pré-voo (só leitura e backup) e me apresente o
> resultado antes do `service update`. Trabalhe numa worktree separada
> criada de `origin/main`; o checkout principal pode estar em outra branch.
> Ao terminar cada fase, atualize o plano (checklist + registro com data) e
> a memória.

### B.x — Assinatura do "pente de 60 s" no log da Evolution (5.10)

Só serve enquanto o log cobrir o período (30 MB, ~2 dias; morre no reinício).
Imprime, por instância e na ordem de despacho, carimbo × despacho × intervalo;
a assinatura do `concatMap` + timeout é o intervalo cravado em 60 s dentro das
rajadas (e múltiplos de 60 entre recebidas — os ecos do celular na mesma fila).

```bash
# 1) O script num ARQUIVO. Um heredoc direto em `python3 -` substituiria o stdin
#    do pipe: o Python leria o programa e `sys.stdin.read()` acharia EOF — o
#    pente sairia vazio com cara de "sem achados" (Codex, PR #221).
cat > /tmp/pente.py <<'EOF'
import sys, re, datetime as dt
# date_time vem em HORA LOCAL (TZ=America/Sao_Paulo) com sufixo "Z": +3 h.
DESLOC = 3*3600
txt = sys.stdin.read()
por = {}
for b in re.split(r'\n(?=\{\n)', txt):
    if "event: 'messages.upsert'" not in b: continue
    i = re.search(r"instance: '([^']+)'", b); ts = re.search(r"messageTimestamp: (\d+)", b)
    d = re.search(r"date_time: '([^']+)'", b); fm = re.search(r"fromMe: (true|false)", b)
    if not (i and ts and d and fm) or fm.group(1) != 'false': continue
    desp = dt.datetime.fromisoformat(d.group(1).replace('Z','+00:00')).timestamp() + DESLOC
    por.setdefault(i.group(1).split('-')[0], []).append((desp, int(ts.group(1))))
brt = dt.timezone(dt.timedelta(hours=-3))
for inst, lst in sorted(por.items()):
    lst.sort(); print(f"=== {inst} ({len(lst)} recebidas) ===  carimbo  despacho  atraso  intervalo"); prev = None
    for desp, ts in lst[-25:]:
        iv = desp - prev if prev else 0
        print(f"  {dt.datetime.fromtimestamp(ts, brt):%H:%M:%S}  {dt.datetime.fromtimestamp(desp, brt):%H:%M:%S}  {desp-ts:6.0f}s  {iv:6.0f}s{'  <-- ~60s' if 58 <= iv <= 63 else ''}")
        prev = desp
EOF
# 2) O log entra pelo PIPE; o script, pelo arquivo.
ssh -i ~/.ssh/cb-crm-vps root@vps.cbadvogados.com \
  'docker logs $(docker ps -q --filter name=evolution_evolution) --since 3h 2>&1 | grep -v apikey' \
  | python3 /tmp/pente.py
```

Para cronometrar a consulta de foto de perfil por instância (o que o handler
faz), `POST https://api.cbadvogados.com/chat/fetchProfilePictureUrl/<instância>`
com `{"number": "<jid ou número>"}` e a `AUTHENTICATION_API_KEY` lida de
DENTRO do contêiner (`docker exec … printenv`), nunca colada na conversa; por
LID: 60 s; por telefone: < 1 s.

## 15. Fontes


**Reverificado em 09/09 (noite)**, depois de a revisão adversarial achar que as cópias locais do guia e do changelog eram páginas 503: o guia v7 real (`baileys.wiki/migration/v7`) diz textualmente *"By default, all new Signal sessions in Baileys 7.x are created in the LID format, and existing sessions are migrated automatically"* (a premissa "sem QR" da 4.5/7.2) e descreve o `Contact` como o código do #161 implementa (*"id is the preferred identifier; phoneNumber is populated when id is a LID; lid is populated when id is a PN — these changes also affect participants on GroupMetadata"*). O guia também diz *"ACKs no longer sent"* — **não** é o recibo de entrega: `src/Socket/messages-recv.ts` da rc13 (linhas 1740–1758) manda `sendReceipt(remoteJid, participant, [id], type)` com `type` vazio (= entregue) exatamente como a 6.7.19 (linha 856); só o `read` depende de `sendActiveReceipts`. T14 continua sendo o teste. A release rc13 no GitHub é só o conserto do `protocolMessage` (`fromMe` falso) sobre a rc12.

- Evolution API — fontes por tag/branch (`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, `src/api/dto/*`, `src/validate/instance.schema.ts`, `src/api/integrations/event/**`, `src/config/env.config.ts`, `src/utils/use-multi-file-auth-state-prisma.ts`, `src/utils/sendTelemetry.ts`, `src/licensing/runtime.ts`, `src/api/guards/auth.guard.ts`, `prisma/postgresql-migrations/**`, `Dockerfile`, `package.json`): https://github.com/evolution-foundation/evolution-api — tags `2.3.2`, `2.3.7`, `2.4.0-rc2`, branch `develop` (commit de 14/07/2026)
- Notas de release 2.3.3 → 2.4.0-rc2: https://github.com/evolution-foundation/evolution-api/releases
- Licença: https://docs.evolutionfoundation.com.br/en/licensing · issue #2534 (ativação e deploys automatizados): https://github.com/evolution-foundation/evolution-api/issues/2534
- `PENDING` para sempre / 463 (rc.9) e relatos com rc13: https://github.com/evolution-foundation/evolution-api/issues/2597
- "Aguardando mensagem" na Evolution: https://github.com/EvolutionAPI/evolution-api/issues/1731 · https://github.com/evolution-foundation/evolution-api/issues/1934
- Baileys — guia v7: https://baileys.wiki/migration/v7 · rc13: https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc13 · investigação do 463: https://github.com/WhiskeySockets/Baileys/issues/2441 · sessões: https://github.com/WhiskeySockets/Baileys/issues/1701 · https://github.com/WhiskeySockets/Baileys/issues/1964
- Baileys rc13 — fontes conferidos: `src/Socket/messages-recv.ts` (recibos), `src/Types/Contact.ts` e `src/Types/GroupMetadata.ts` (participantes), `src/Defaults/index.ts` (opções padrão)
- Docker Hub `evoapicloud/evolution-api` (tags/datas) e inspeção local da imagem `homolog` na VPS (09/09/2026)
- Medições próprias de 09/09/2026: Supabase do CRM, banco `evolution`, Redis db 8, logs e serviço na VPS, código do CRM (`src/lib/whatsapp/transport/*`, `src/app/api/whatsapp/evolution/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts`, `src/lib/cb-groups/*`, `src/lib/contacts/foto-de-perfil.ts`, `src/lib/whatsapp/send-message.ts`)

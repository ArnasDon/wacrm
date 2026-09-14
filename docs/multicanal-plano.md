# PLANO DE TRABALHO CONSOLIDADO — Adaptação do CB CRM ao multi-canal

> **Origem e validade.** Resultado de uma varredura completa do app feita em
> **2026-07-25**, contra o commit `735081a` da `main`, cobrindo 7 subsistemas
> (núcleo/webhooks, automações, flows, IA/RAG, inbox, templates+broadcasts,
> API v1+MCP). Foram confirmadas **78 lacunas** — 3 CRÍTICAS, 31 ALTAS, 29 MÉDIAS,
> 15 BAIXAS — cada uma verificada contra o código antes de entrar aqui.
>
> Como todo documento de plano, **isto fica stale conforme as fases são
> executadas**. Antes de agir a partir de uma referência `arquivo:linha` daqui,
> confirme contra o código atual. Ao concluir uma fase, marque-a neste arquivo.

## 1) VEREDICTO GERAL

O multi-canal foi entregue completo no eixo **"conversa → canal → credencial"**: entrada roteia por chave técnica, saída (manual, engines, reações, IA, flows) resolve o canal da conversa, e `messages.channel_id` é carimbado em todos os caminhos. Fora desse eixo, **o app inteiro ainda é single-channel**: nenhuma tabela de regra ou disparo (`automations`, `flows`, `flow_runs`, `broadcasts`, `message_templates`, `ai_configs`, `ai_knowledge_*`, `ai_usage_log`) tem coluna de canal, e o `channelId` já resolvido no webhook é **jogado fora** antes de chegar em automações, flows e webhooks de saída. Não existe operação "tornar padrão", então tudo que não passa por uma conversa (broadcast, templates, sync Meta, proxy de mídia, API v1) fica preso ao espelho `whatsapp_config` — e em produção esse espelho é Evolution, o que **hoje já deixa broadcast e templates mortos**. Há ainda 4 defeitos ativos independentes de schema (flow que trava e engole mensagens, mídia Meta que dá 500, mídia Evolution descartada, verify do webhook Meta impossível). O plano abaixo separa o que é conserto imediato do que exige a migration `903`.

---

## 2) MUDANÇAS DE SCHEMA — migration única `0903_cb_multicanal.sql`

**Princípio transversal:** toda coluna de canal é **NULLABLE**, e `NULL` significa sempre **"qualquer canal / herda o padrão"** — nunca "nenhum canal". Isso preserva 100% do comportamento das linhas existentes sem backfill obrigatório. `ON DELETE SET NULL` em toda FK para `cb_channels`, seguindo o padrão já estabelecido em `supabase/migrations/0902_cb_conversation_channel.sql:28-29`.

### 2.1 Escopo de disparo e execução

| Tabela | Coluna | Tipo | Null | FK | Linhas existentes |
|---|---|---|---|---|---|
| `automations` | `channel_ids` | `uuid[]` | sim | — (array, ver trigger 2.6) | ficam `NULL` = dispara em todos os canais (comportamento atual) |
| `automation_logs` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | `NULL` = histórico anterior, sem atribuição |
| `flows` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | `NULL` = curinga, dispara em qualquer canal |
| `flow_runs` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | `NULL` = runs antigos; o sender cai no canal da conversa |

> `automations.channel_ids` como array evita tabela de junção para um filtro de 1 linha de código (`resolveEngineChannel` já existe). `NULL` = todos; array **vazio nunca deve existir** — normalizar para `NULL` no trigger de limpeza (2.6). Se preferir FK real, a alternativa é `cb_automation_channels(automation_id, channel_id)` com "zero linhas = todos", mas ela cria a armadilha descrita em §5.

### 2.2 Templates e broadcasts

| Tabela | Coluna | Tipo | Null | FK | Linhas existentes |
|---|---|---|---|---|---|
| `message_templates` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | backfill **condicional**: recebe o id do canal padrão **somente se** ele for `kind='meta'`; senão fica `NULL` |
| `broadcasts` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | `NULL` = campanha histórica disparada pelo padrão |

Índices de `message_templates` — o atual é `UNIQUE(user_id, name, language)` (`supabase/migrations/0014_message_templates_meta_integration.sql:190-191`). Substituir por dois parciais:
- `UNIQUE (user_id, name, language) WHERE channel_id IS NULL`
- `UNIQUE (user_id, channel_id, name, language) WHERE channel_id IS NOT NULL`

`broadcast_recipients` **não** precisa de coluna: o canal é da campanha inteira e `idx_broadcast_recipients_wamid` (`0003_broadcast_recipient_wamid.sql:29-32`) já é UNIQUE global, então não há ambiguidade de ACK.

### 2.3 IA

| Tabela | Coluna | Tipo | Null | FK | Linhas existentes |
|---|---|---|---|---|---|
| `cb_channels` | `ai_autoreply_enabled` | `boolean` | não, `DEFAULT true` | — | todas viram `true` = comportamento atual |
| `cb_channels` | `default_agent_id` | `uuid` | sim | `auth.users(id)` ON DELETE SET NULL | `NULL` = sem roteamento automático (atende inbox + handoff por canal) |
| `ai_configs` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | linha existente fica `NULL` = agente padrão da conta |
| `ai_knowledge_documents` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | `NULL` = documento comum a todos os canais |
| `ai_knowledge_chunks` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | denormalizado do documento, como já se faz com `account_id` (`0030_ai_knowledge.sql:96`) |
| `ai_usage_log` | `channel_id` | `uuid` | sim | `cb_channels(id)` ON DELETE SET NULL | `NULL` = histórico sem atribuição de custo |

`ai_configs` hoje tem `account_id NOT NULL UNIQUE` (`0029_ai_reply.sql:47`). **Dropar essa constraint** e criar dois índices parciais:
- `UNIQUE (account_id) WHERE channel_id IS NULL` — garante um único agente padrão
- `UNIQUE (account_id, channel_id) WHERE channel_id IS NOT NULL` — um agente por canal

⚠️ As duas RPCs `match_ai_knowledge_semantic` e `match_ai_knowledge_fts` (`0030_ai_knowledge.sql:155-190`) precisam de `DROP FUNCTION` antes do `CREATE` para mudar a assinatura (novo `p_channel_id`), e `src/lib/ai/knowledge.ts:113-136` tem que mudar **no mesmo PR** — senão a busca quebra entre o deploy do banco e o do app. Ver §5.

### 2.4 Integridade de canal ↔ conta

- Índice `UNIQUE (id, account_id)` em `cb_channels` + FK composta `conversations (channel_id, account_id) → cb_channels (id, account_id)`. Fecha o buraco de `conversations.channel_id` ser gravado direto do browser (`src/components/inbox/message-thread.tsx:907-911`) apontando para canal de outra conta.

### 2.5 Anti-duplicação (opcional, mas barato)

- `UNIQUE (account_id, display_phone) WHERE display_phone IS NOT NULL` em `cb_channels` — impede dois canais pareando o mesmo número.
- `UNIQUE (conversation_id, message_id) WHERE message_id IS NOT NULL` em `messages` — fecha a duplicação de inbound na raiz. ⚠️ **Validar antes** se não há duplicatas legadas (`SELECT conversation_id, message_id, count(*) ... HAVING count(*)>1`); se houver, o `CREATE UNIQUE INDEX` falha.

### 2.6 Triggers de limpeza

- `BEFORE DELETE ON cb_channels`: `UPDATE conversations SET channel_pinned = false WHERE channel_id = OLD.id` — mata o estado inválido `(channel_id NULL, channel_pinned TRUE)` que `src/lib/cb-channels/stamp.ts:47-51` nunca mais consegue mover.
- `AFTER DELETE ON cb_channels`: `UPDATE automations SET channel_ids = nullif(array_remove(channel_ids, OLD.id), '{}')` **e** `is_active = false` quando o array esvaziar (ver armadilha em §5).

### 2.7 Deixar de fora desta migration

- `cb_channels.app_secret` (numero Meta de outro App do Facebook) — cenário especulativo; documentar a restrição no painel em vez de codificar.
- `UNIQUE(account_id, contact_id, channel_id)` em `conversations` — é troca de modelo de produto, não conserto. Decisão do operador (ver §5).
- REVOKE de colunas de segredo em `cb_channels` — defesa em profundidade, mesma postura já existente em `whatsapp_config`/`api_keys`. Pode virar `904_cb_channels_column_grants.sql` depois.

---

## 3) POR SUBSISTEMA

### 3.1 Flows — **CRÍTICO**

**Engine (`src/lib/flows/engine.ts`)**
- `:742` (`send_buttons`) e `:758` (`send_list`) estão **fora de try/catch**, e o reprompt `:1015`/`:1017` também. O sender lança de propósito em canal Evolution (`src/lib/flows/meta-send.ts:406-410`), a exceção sobe até o catch genérico `:881-887` e o run fica `active` com `current_node_key` congelado, sem nenhum `flow_run_events` de erro. Envolver os quatro pontos com `logEvent(...,'error',...)` + `endRun(...,'failed','send_interactive_failed')`, exatamente o padrão de `send_message` (`:584-603`) e `send_media` (`:609-634`).
- `findEntryFlow` (`:326-331`) filtra só `account_id + status`. Passar a filtrar `.or('channel_id.is.null,channel_id.eq.<id>')` e **priorizar o match específico sobre o curinga**.
- `startNewRun` (`:1066-1084`) grava `flow_runs.channel_id` do canal de entrada; os senders passam a receber o canal do **run**, não re-resolver pela conversa a cada nó (`meta-send.ts:93`, `:223`, `:402`).
- `DispatchInboundInput` (`src/lib/flows/types.ts:332-342`) ganha `channelId`; os dois call-sites já têm o valor: `src/lib/whatsapp/inbound-store.ts:231-242` (tem `m.channelId` em `:223`) e `src/app/api/whatsapp/webhook/route.ts:787-806` (tem `channelId` em `:758`).
- Configs de nó de envio (`types.ts:30-98`) ganham `channel_id?: string` opcional (vazio = canal do run) — atende "envie a resposta PELO canal Y".

**API/Validação** — `src/lib/flows/validate.ts` não menciona canal: bloquear ativação de flow com `send_buttons`/`send_list` quando o canal alvo for Evolution (`src/app/api/flows/[id]/activate/route.ts:84-106`). Persistir `channel_id` no POST `/api/flows` e PUT `/api/flows/[id]`.

**UI/i18n** — Select de canal no `TriggerPanel` (`src/components/flows/flow-builder.tsx:264-341`) e nos formulários de nó de envio; coluna de canal na tela de runs (`src/app/(dashboard)/flows/[id]/runs/page.tsx:253-273`); marcar templates de fábrica que exigem canal Meta (`src/lib/flows/templates.ts:90` e `:148`). Chaves novas em **`en.json` e `pt-BR.json` na mesma passada**.

---

### 3.2 Broadcasts + Templates — **CRÍTICO / ALTO**

**Engine**
- `src/lib/whatsapp/broadcast-core.ts:114-118` e `src/app/api/whatsapp/broadcast/route.ts:136-140` leem `whatsapp_config.single()` e congelam `phoneNumberId` para todos os destinatários (`broadcast-core.ts:251`, `:285-293`). Trocar por `getChannelWithSecrets` (`src/lib/cb-channels/repo.ts:75`) resolvendo o canal pedido → primeiro `kind='meta'` conectado → padrão se for Meta.
- A guarda `meta_channel_required` (`broadcast-core.ts:129-135`, `broadcast/route.ts:155-167`) hoje pergunta "**o padrão** é Meta?". Trocar para "**existe** canal Meta utilizável?".
- `src/lib/whatsapp/send-message.ts:344-352` busca o template só por `account_id+name+language`. Filtrar por `channel.channelId` com fallback `channel_id IS NULL`.
- Rate limit: chave `broadcast:${user.id}` (`src/app/api/whatsapp/broadcast/route.ts:77`) passa a compor o canal. ⚠️ **Achado colateral que merece issue própria e não é multi-canal**: `src/lib/rate-limit.ts:120-123` dá 5 POSTs/60s enquanto `src/hooks/use-broadcast-sending.ts:62-63` fatia em lotes de 10 com 1s de pausa — a partir de ~51 destinatários **todo lote leva 429** e é marcado `failed` (`:528-539`). Campanha de 500 = ~50 enviados, ~450 falsos-negativos.

**API** — as quatro rotas de template (`templates/sync/route.ts:153-184`, `templates/submit/route.ts:152-197`, `templates/[id]/route.ts:141-171` e `:280-299`) leem `whatsapp_config` e usam `config.waba_id`. Passar a aceitar `channel_id` e resolver por `getChannelWithSecrets`, com fallback no padrão. O sync itera todos os canais `kind='meta'` com `waba_id` e grava cada linha com o `channel_id` de origem. `cb_channels.waba_id` já existe (`0901_cb_channels.sql:62`) e nunca foi lido.

**UI/i18n** — seletor de canal no passo 4 do wizard (`src/app/(dashboard)/broadcasts/new/page.tsx:191-230`, hook em `use-broadcast-sending.ts:476-485`); pré-checagem de canal Meta no **passo 1**, não no envio; coluna "Canal" na lista e no detalhe da campanha; seletor de canal no `template-manager.tsx`; corrigir a condição do banner em `src/components/settings/template-manager.tsx:150-154` — hoje testa "existe algum Meta" e some justamente no cenário quebrado (padrão Evolution + Meta adicional); filtro de canal em `template-picker.tsx:114-118` e `step1-choose-template.tsx:36-40`.

---

### 3.3 Automações — **CRÍTICO**

**Engine (`src/lib/automations/engine.ts`)**
- `runAutomationsForTrigger` `:95-101` filtra só `account_id + trigger_type + is_active`. Adicionar descarte em memória quando `channel_ids` não for NULL e não contiver o canal do inbound — ao lado do `triggerMatches` já existente em `:109`.
- `AutomationContext` `:32-45` ganha `channel_id?: string | null`, preenchido em `src/app/api/whatsapp/webhook/route.ts:847-853` (tem `channelId` em `:617`/`:758`) e `src/lib/whatsapp/inbound-store.ts:255-260` (tem `m.channelId` em `:223`). **Bônus de graça**: `automation_pending_executions.context` é JSONB gravado intacto (`:284`) e devolvido intacto pelo cron (`src/app/api/automations/cron/route.ts:56-69`) — o canal do disparo passa a sobreviver ao `wait` sem nenhuma coluna nova, resolvendo o follow-up que hoje sai pelo canal errado.
- Senders passam a preferir `context.channel_id` (canal do disparo) ao canal atual da conversa; `cfg.channel_id` opcional nos configs de envio (`src/types/index.ts:522-538`) vence os dois.
- Novo sujeito `'channel'` em `evaluateCondition` `:684-734` e na union `ConditionSubject` (`src/types/index.ts:574-578`).
- Corrigir strings factualmente erradas: `:367`, `:387`, `:422` dizem `sent via Meta` mesmo quando saiu pela Evolution (`meta-send.ts:160-163`).
- `interpolate()` `:741-748` ganha `{{channel.id}}`/`{{channel.label}}`; `send_webhook` `:589` herda o canal de graça ao serializar o context.
- Novo trigger aditivo `first_inbound_on_channel` (COUNT em `messages` por `channel_id`, índice `messages_channel_idx` já existe) — o atual conta por conversa (`webhook/route.ts:708-713`, `inbound-store.ts:182-187`).

**API/UI/i18n** — `channel_ids` no POST `/api/automations:62` e na allowlist do PATCH (`[id]/route.ts:81-89`); validação de ativação recebendo a lista de canais (`src/lib/automations/validate.ts:57-76`) para bloquear `send_template`/`send_buttons`/`send_list` em escopo Evolution; multi-select no `TriggerCard` (`automation-builder.tsx:820-882`); seletor "Enviar por" nos editores de envio; badge + filtro de canal na lista (`src/app/(dashboard)/automations/page.tsx:311-327`); coluna de canal na tela de logs.

---

### 3.4 IA / RAG / auto-reply — **ALTO**

- **Interruptor por canal** (maior retorno, menor custo): checar `cb_channels.ai_autoreply_enabled` no início de `dispatchInboundToAiReply` (`src/lib/ai/auto-reply.ts:51`), com `channelId` passado pelos dois call-sites (`webhook/route.ts:862-869`, `inbound-store.ts:263-270`) — o valor já está em escopo nos dois. Toggle por linha no `cb-channels-panel.tsx`.
- **Portão de automações** `:61-68`: hoje qualquer automação ativa da conta **cala a IA em todos os números**, com `return` mudo. Assim que automações tiverem escopo de canal, herdar o filtro. Antes disso, no mínimo trocar o return mudo por `console.warn` nomeando a automação e avisar na UI.
- **Agente por canal**: `loadAiConfig(db, accountId, channelId)` (`src/lib/ai/config.ts:31-41`) com fallback no agente padrão; `/agents` vira lista; cada canal escolhe o seu no painel de canais.
- **RAG por canal**: `retrieveKnowledge` (`src/lib/ai/knowledge.ts:99-136`) passa `p_channel_id`; RPCs recriadas com `(c.channel_id IS NULL OR c.channel_id = p_channel_id)`.
- **Histórico**: `buildConversationContext` (`src/lib/ai/context.ts:24-30`) filtra por canal **apenas quando a conta tiver 2+ canais**, e sempre como `channel_id = X OR channel_id IS NULL` (senão apaga todo o histórico pré-902).
- **Handoff**: usar `cb_channels.default_agent_id` com fallback em `ai_configs.handoff_agent_id`; incluir o label do canal em `buildHandoffSummary` (`src/lib/ai/handoff.ts:20-41`).
- **Playground e draft**: seletor de canal em `/api/ai/playground` e derivação do canal da conversa em `/api/ai/draft:61-105` — obrigatório **no mesmo PR** que criar agente/KB por canal, senão o playground deixa de ser fiel.
- **Custo**: `channel_id` em `logAiUsage` (`src/lib/ai/usage.ts:35-44`) e recorte por canal em `/api/ai/usage`.

> **Não mexer**: o throttle `ai-autoreply:${accountId}` (`src/lib/rate-limit.ts:169`) protege a chave BYO única da conta — um balde por canal permitiria N×30 chamadas na mesma chave e seria o bug.

---

### 3.5 Inbox / Conversas / Contatos — **ALTO / MÉDIO**

- **Quote e reação pelo canal do alvo** (ALTO, sem schema): `src/lib/whatsapp/send-message.ts:313-318` busca a mensagem pai sem ler `messages.channel_id`, e `src/app/api/whatsapp/react/route.ts:72-76,:118` pega o alvo por id e o canal pela conversa. Um `wamid`/`key.id` de outro canal é rejeitado pelo provedor. Resolver o envio **pelo canal carimbado no alvo** e, se ele não existir mais, degradar para envio sem contexto (o caminho já existe em `send-message.ts:327-331`).
- **Assert de canal no envio** (ALTO): o compositor manda `{conversation_id, message_type, content_text, reply_to_message_id}` (`message-thread.tsx:523-532`) sem canal, e o servidor resolve no instante do request. Aceitar `channel_id` no POST `/api/whatsapp/send` e devolver **409 com o canal novo** quando divergir, para o compositor pedir confirmação.
- **Primeiro contato pela ficha** (ALTO): `contact-detail-view.tsx:334-351` → `send/route.ts:238-242` cria a conversa sem `channel_id`. Aceitar `channel_id` e gravar com `channel_pinned=true`; seletor ao lado do botão.
- **Roteamento por canal** (ALTO): nenhum dos seis call-sites de `assigned_agent_id` lê canal. Caminho mais barato: `cb_channels.default_agent_id` carimbado na criação da conversa quando ela não tem dono — sem engine nova.
- **Filtro de canal na lista** (MÉDIO): `conversation-list.tsx:161-191` não tem nenhuma referência a canal em 504 linhas, embora `channel_id` já chegue de graça (`CONVERSATION_SELECT = '*'`, `src/lib/inbox/conversations.ts:9-10`). Dropdown no molde exato do de tags (`:266-306`) + chip no item.
- **Janela de 24h por canal** (MÉDIO): `sessionInfo` (`message-thread.tsx:284-308`) pega a última mensagem do cliente de qualquer canal. Filtrar por `m.channel_id === activeChannel?.id`, com fallback para o comportamento atual quando nada estiver carimbado.
- **Contatos** (MÉDIO): zero ocorrências de canal em `src/components/contacts/` e `contact-sidebar.tsx`. Mostrar o canal da conversa no painel lateral e coluna/filtro derivado na lista.

---

### 3.6 Núcleo, webhooks e infra — **ALTO**

- **Proxy de mídia** (`src/app/api/whatsapp/media/[mediaId]/route.ts:53-75`): faz `decrypt(config.access_token)` **incondicional** antes de olhar `?channel=`. Em conta Evolution o token é NULL (`0037_evolution_transport.sql:49`) e `encryption.ts:51` estoura → 500. **Inverter a ordem**: resolver o `?channel=` primeiro, só cair no `whatsapp_config` se não houver canal, e nunca decriptar valor nulo.
- **Verify do webhook Meta** (`webhook/route.ts:117-144`): varre só `whatsapp_config.verify_token`. `cb_channels.verify_token` é escrito (`cb/channels/route.ts:359`, `:388`) e **nunca lido**. Adicionar varredura aditiva em `cb_channels` (`kind='meta'`, token não nulo).
- **Mídia inbound Evolution** (`src/lib/whatsapp/transport/evolution-inbound.ts:108`): devolve `mediaUrl: null` — hoje 100% da mídia recebida em produção se perde. Baixar via Evolution dentro do `after()` do webhook e subir para o bucket da 023.
- **Fail-fast da API v1** (`src/lib/whatsapp/resolve-conversation.ts:58-69`): pergunta sobre `whatsapp_config`, tabela errada. Aceitar `cb_channels` como fonte, na mesma ordem de `resolveChannelForConversation`. ⚠️ Gatilho determinístico: `DELETE /api/whatsapp/config` (`config/route.ts:477-493`) apaga o espelho e mata a API pública enquanto o inbox continua funcionando.
- **Tornar padrão**: `POST /api/cb/channels/[id]/default` (ou `PATCH` aceitando `is_default`) numa transação que zera o padrão atual, marca o novo e **reescreve o espelho `whatsapp_config`** reaproveitando `mirrorDefaultMeta` (`cb/channels/route.ts:320-342`). Botão em `cb-channels-panel.tsx`. Hoje o comentário em `cb/channels/[id]/route.ts:7-10` admite a lacuna e o DELETE (`:87-92`) manda fazer algo que não existe.
- **Rotas legadas Evolution** (`evolution/connect/route.ts:84-114`, `evolution/state/route.ts:63-72`): sem UI apontando para elas e sem espelho para `cb_channels` (o `legacy-mirror.ts:48-50` só cobre `kind='meta'`). Desativar com 410.
- **Escopar o ACK Meta** (`webhook/route.ts:405-409`): `UPDATE messages SET status WHERE message_id = <wamid>` sem escopo de conta/conversa. Escopar pela conversa dona do wamid.

---

### 3.7 API v1 + MCP + webhooks de saída + dashboard — **ALTO / MÉDIO**

- **Serializers** (`src/lib/api/v1/conversations.ts:13-47`, `:53-100`): acrescentar `channel_id` a `ApiConversation`/`ApiMessage`. O dado **já vem do banco** (`select('*')`) e o tipo já o declara (`src/types/index.ts:190`, `:264`). É a correção mais barata do plano inteiro.
- **Webhooks de saída**: os quatro dispatches (`inbound-store.ts:174` e `:272`, `webhook/route.ts:646` e `:878`) omitem canal com o `channelId` em escopo. Campo novo em `data` é aditivo e não invalida assinatura HMAC (`src/lib/webhooks/deliver.ts:66-72`).
- **`message.status_updated` nunca dispara para Evolution** (`evolution/webhook/route.ts:108-127` não chama `dispatchWebhookEvent`). Adicionar dentro do `after()`, best-effort, como no lado Meta.
- **`channel_id` no POST `/api/v1/messages`** com validação de conta e `channel_pinned=true` na escolha explícita; devolvê-lo na resposta 201 (`route.ts:130-139`).
- **`GET /api/v1/channels`** + escopo `channels:read` (`src/lib/api-keys/scopes.ts:16-24`; escopos são `text[]`, não precisa migration), reusando `listChannels` que já projeta `CB_CHANNEL_SAFE_COLUMNS`. Sem isso, ninguém descobre os UUIDs válidos.
- **MCP** (`mcp-server/src/tools/write.ts:33-54`, `broadcast.ts:24-44`): `channel_id` opcional + tool `list_channels`. É wrapper fino — só depois da v1.
- **Dashboard** (`src/lib/dashboard/queries.ts`, zero ocorrências de canal): `channelId` opcional nas quatro funções + seletor no cabeçalho. ⚠️ o modo "Todos" tem que continuar **sem filtro**, senão o histórico pré-902 (`channel_id NULL`) some.
- **Docs** (`docs/public-api.md`, `docs/mcp.md`): zero menções a canal, e `meta_channel_required` / `not_supported` não estão documentados. Atualizar **no mesmo PR** de cada mudança, conforme CLAUDE.md.

---

## 4) ORDEM DE EXECUÇÃO

Todas as fases são deploy-safe: nenhuma altera o comportamento existente da Evolution single-channel em produção. Cada fase = uma branch a partir de `main` atualizado → PR no CB-CRM → merge (**merge no `main` = deploy de produção**, avisar o operador).

**Fase A — Consertos ativos, sem schema, sem dependências** *(pode ir hoje)*
1. `try/catch` + `endRun('failed')` nos quatro pontos de `flows/engine.ts:742,758,1015,1017`.
2. Proxy de mídia: resolver canal antes de decriptar (`media/[mediaId]/route.ts`).
3. Verify do webhook Meta varrendo `cb_channels`.
4. `resolve-conversation.ts` aceitando `cb_channels`.
5. DELETE de canal limpando `conversations.channel_pinned` (no route, sem trigger ainda).
6. Strings `sent via Meta` corrigidas em `automations/engine.ts:367,387,422`.
7. `channel_id` nos serializers da API v1.
> Desbloqueia: onboarding do número Meta, mídia do canal oficial, flows que travam. **Nenhuma dependência.**

**Fase B — "Tornar padrão"** *(depende de A apenas por higiene)*
- `POST /api/cb/channels/[id]/default` movendo `is_default` **e** o espelho `whatsapp_config`; botão no painel.
> Destrava broadcast e templates **sem tocar em schema** — é o desbloqueio de menor custo para o escritório enquanto B2/C não chegam.

**Fase C — Plumbing do `channelId`** *(depende de nada; puramente aditivo)*
- `AutomationContext.channel_id`, `DispatchInboundInput.channelId`, canal no payload dos 4 webhooks de saída + `message.status_updated` da Evolution, `channel_id` opcional no POST `/api/v1/messages` e `GET /api/v1/channels`.
> Nada muda de comportamento; é o pré-requisito de D, E e F. Ganho colateral imediato: o canal do disparo passa a sobreviver ao `wait` das automações.

**Fase D — Migration `0903_cb_multicanal.sql`** *(depende de C só na ordem lógica; pode ser aplicada antes)*
- Todas as colunas de §2, índices parciais, FK composta, triggers de limpeza, recriação das RPCs de knowledge.
- ⚠️ Aplicar via **MCP do Supabase** (`apply_migration`), conferindo o `project_ref` do `.mcp.json` do CB CRM. Nunca `db push`.
> Colunas nullable + defaults preservam tudo. **Deploy do app pode vir depois** — nenhum código antigo lê as colunas novas.

**Fase E — Escopo de canal nos engines** *(depende de C + D)*
- E1: automações (filtro no dispatch, condição `channel`, `channel_id` nos configs de envio, validação de ativação, trigger `first_inbound_on_channel`).
- E2: flows (`findEntryFlow` filtrando canal, `flow_runs.channel_id` travando o canal do run, `channel_id` nos nós de envio, validador).
- E3: IA — **começar pelo `ai_autoreply_enabled` por canal** (independente do resto), depois agente por canal + KB por canal + playground/draft **no mesmo PR**, depois handoff/usage.
- E4: templates e broadcasts por canal (engine + rotas + wizard).
> E1 e E2 podem ir em paralelo; E3 e E4 são independentes entre si.

**Fase F — UI, visibilidade e i18n** *(depende de E)*
- Filtro de canal no inbox, badge/filtro nas listas de automações e flows, coluna de canal em logs e runs, canal no dashboard, canal na ficha do contato, seletor no primeiro contato, assert 409 no compositor.
- **Toda chave nova em `en.json` E `pt-BR.json` na mesma passada** — o fallback do next-intl é por arquivo; chave faltando vira `MISSING_MESSAGE` na tela. Rodar `node scripts/i18n-parity.mjs`.

**Fase G — Integrações externas e docs** *(depende de E)*
- MCP (`channel_id` + `list_channels`), `docs/public-api.md`, `docs/mcp.md`, `mcp-server/README.md`.

**Fase H — Independentes, encaixar onde couber**
- Mídia inbound Evolution (ALTO, isolado — pode ir junto com A se houver fôlego).
- Desativar rotas legadas `/api/whatsapp/evolution/connect|state` (410).
- Escopar o ACK Meta por conversa.
- Issue separada, **não multi-canal**: rate limit de broadcast × lotes de 10 do hook (§3.2).

---

## 5) RISCOS E ARMADILHAS

1. **Dados legados sem `channel_id`.** `messages.channel_id` e `conversations.channel_id` só existem desde a 902; tudo anterior é NULL. Todo filtro por canal em leitura (histórico da IA, dashboard, janela de 24h, contagem de "primeira mensagem") tem que ser `channel_id = X OR channel_id IS NULL` ou ter um modo "todos" sem filtro. Um `.eq('channel_id', X)` cru **apaga o passado da tela**.
2. **Espelho `whatsapp_config` divergindo.** Enquanto broadcast/templates/proxy/API v1 lerem o espelho, ele é fonte de verdade paralela. A operação "tornar padrão" (Fase B) **tem que mover o espelho junto**, senão cria drift silencioso: o painel mostra um canal e o envio usa outro.
3. **RPCs de knowledge exigem `DROP FUNCTION`.** Mudar a assinatura de `match_ai_knowledge_semantic`/`match_ai_knowledge_fts` quebra `src/lib/ai/knowledge.ts` entre o deploy do banco e o do app. Ou criar **funções novas com nome novo** (`..._v2`) e trocar o chamador depois, ou aceitar uma janela de RAG indisponível.
4. **`array_remove` esvaziando o escopo de automação.** Se o único canal de uma automação for excluído e o array virar `{}` normalizado para `NULL`, a automação **passa a disparar em todos os números** — o oposto da intenção. Por isso o trigger de §2.6 também marca `is_active = false`.
5. **Unique novo em `messages(conversation_id, message_id)`** falha se já houver duplicatas legadas. Rodar o `HAVING count(*)>1` antes; se houver, deduplicar ou pular esse índice.
6. **Corrida do canal no envio.** Mesmo com o assert 409 (Fase F), `followConversationChannel` continua movendo o canal por baixo. A UI precisa tratar o 409 como pergunta ("o cliente escreveu pelo Jurídico — responder por qual número?"), não como erro.
7. **Duas conversas por contato continuam sendo UMA.** `UNIQUE(account_id, contact_id)` (`036:125-126`) é decisão explícita da 902 (`:18-19`). Este plano assume que ela **permanece** e resolve as consequências pontualmente. Mudar para `(account_id, contact_id, channel_id)` é troca de modelo, exige migração de merge/split e refaz inbox, atribuição e IA — só decidir isso se o escritório de fato operar números por área.
8. **Push no `main` = produção.** Cada fase deve ir com o operador ciente. Evolution single-channel do colega já roda: nenhuma fase pode alterar o comportamento quando a conta tem **um** canal — usar `channels.length >= 2` como gate de UI e `NULL = todos` como gate de engine.
9. **i18n.** Toda fase com UI toca os dois dicionários. `scripts/i18n-parity.mjs` sai com código 1 se faltar chave.
10. **`META_APP_SECRET` global.** Números Meta de **outro App do Facebook** terão 100% do inbound rejeitado (`webhook-signature.ts:25-46`). Números do mesmo App/WABA funcionam. Documentar essa restrição no painel de canais em vez de codificar `app_secret` agora.

---

## 6) O QUE NÃO PRECISA MEXER

- **Schema de `cb_channels` e roteamento de entrada** — `0901_cb_channels.sql:35-102`: CHECKs por tipo, índices únicos globais por `phone_number_id`/`instance_name`, índice parcial de um padrão por conta, RLS. Desenho correto.
- **`conversations.channel_id` / `messages.channel_id` / `channel_pinned`** — `902:27-43`. Nullable, `ON DELETE SET NULL`, indexados. Nada a mudar.
- **Resolução de saída** — `src/lib/cb-channels/resolve.ts:89-119` e `engine-send.ts:33-50`: ordem correta, filtro por `account_id`, deploy-safe (engolem erro pré-901/902). Os senders de flows (`meta-send.ts:93,223,402`), automações (`meta-send.ts:142`), IA (via `engineSendText`) e reações (`react/route.ts:118`) **já saem pelo canal certo**.
- **Carimbo de saída e de entrada** — `send-message.ts:587`, `stamp.ts:17-58`, `inbound-store.ts:223-226`, `webhook/route.ts:758-761`. Os dois transportes se comportam de forma idêntica.
- **Subscriptions realtime** (`src/hooks/use-realtime.ts:49-70`) — não filtram por canal, e está **certo**: o inbox é um só. Só mudaria se surgir "inbox por canal".
- **Banner "WhatsApp não conectado"** (`inbox/page.tsx:203-225`), **seletor de canal na conversa** (`message-thread.tsx:1057-1119`), **rótulo "via canal"** (`message-bubble.tsx:323-333`), **compositor ciente do canal** (`message-composer.tsx:707-731`) — Fase 4c/5, funcionando.
- **Throttle de auto-reply por conta** (`rate-limit.ts:169`) — protege a chave BYO única; um balde por canal seria o bug.
- **ACK da Evolution sem escopo de canal** (`evolution/webhook/route.ts:113-122`) — decisão documentada e correta: o `keyId` da Baileys já mira uma mensagem, e escopar quebraria o duplo-check pré-Fase 3.
- **Cron de flows** (`src/app/api/flows/cron/route.ts:87`) — só marca `timed_out`, não envia nada.
- **Autenticação da API pública** (`src/lib/api-keys/store.ts:34-57`, `scopes.ts:70-75`) — canal e autorização são ortogonais; `account_id` já isola.
- **`broadcast_recipients`** — o UNIQUE global de `whatsapp_message_id` (`003:29-32`) já impede ambiguidade de ACK; não precisa de coluna de canal.
- **Quick replies de texto** (`0035_interactive_messages.sql:24-40`) — snippets de conta, corretamente agnósticos a canal.
- **Webhook de ciclo de vida de template** (`src/lib/whatsapp/template-webhook.ts:133-159`) — casa por `meta_template_id`, único por WABA; continua correto com N WABAs.
- **Infra de entrega de webhook de saída** (`src/lib/webhooks/deliver.ts:66-128`) — envelope, HMAC, SSRF guard, auto-disable: agnóstica a canal; acrescentar campo em `data` é aditivo.
- **Opt-in/consentimento de broadcast** — a ausência é herdada do upstream e idêntica antes e depois do multi-canal. Só entra na conversa se o escritório pedir como funcionalidade nova.

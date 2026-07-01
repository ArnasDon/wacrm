# Plano de Integração: Uazapi como segundo provedor de WhatsApp

## Objetivo

Adicionar a Uazapi (API não-oficial, conexão via QR code) como um **segundo
provedor** de WhatsApp, coexistindo com a API Oficial (Meta Cloud API) já
implementada. Uma conta poderá ter uma conexão Meta, uma conexão Uazapi, ou
ambas simultaneamente. Todas as funcionalidades do sistema (inbox, dashboard,
automações, flows, broadcasts, API pública v1, webhooks de saída) devem
funcionar com qualquer provedor.

## Decisões confirmadas com o usuário

- **Escopo do MVP**: implementar primeiro as Fases 1-4 (schema, abstração de
  provider, conexão via QR, envio/recebimento de texto e mídia). Automações,
  Flows, broadcasts, backfill de histórico e API v1 (Fases 5-9) ficam para uma
  segunda etapa, depois que o MVP estiver validado ponta a ponta.
- **Provider padrão para outbound novo**: quando uma conta tiver Meta e
  Uazapi conectados simultaneamente, **Uazapi é o canal padrão** para
  mensagens novas (broadcast a contato frio, automação disparando para quem
  nunca conversou). Meta só é usado quando a conversa já pertence a ela ou é
  explicitamente escolhida.
- **Mídia inbound da Uazapi**: usar o mesmo padrão de **proxy on-demand** já
  usado para a Meta (`/api/whatsapp/media/:id`) — criar um equivalente
  `/api/uazapi/media/:id` que chama `POST /message/download` sob demanda ao
  carregar o inbox, em vez de subir a mídia para o Supabase Storage no
  momento do recebimento. Sem armazenamento duplicado, mas depende da mídia
  continuar acessível na Uazapi.
- **Multi-tenant**: esta é uma **capability geral do produto**, não uma
  customização de uma conta específica. Qualquer conta poderá conectar uma
  instância Uazapi pelas Configurações, então o design de schema/RLS deve
  tratar isso desde o início (sem hardcode de account_id).

## Estado atual (baseline)

- `whatsapp_config` é **1:1 com `account_id`** (`UNIQUE(account_id)`) —
  hoje só existe espaço para uma conexão por conta.
- As chamadas à Meta estão **hardcoded em 4 lugares**, sem nenhuma
  abstração de provedor:
  1. `src/lib/whatsapp/send-message.ts` — envio a partir do inbox / API v1.
  2. `src/lib/automations/meta-send.ts` — passos `send_message` / `send_template` das automações.
  3. `src/lib/flows/meta-send.ts` — nós do bot conversacional (texto, mídia, botões, listas).
  4. `src/app/api/v1/broadcasts/route.ts` (`deliverBroadcast`) — disparo de campanhas.
- O recebimento é feito em `src/app/api/whatsapp/webhook/route.ts` — handshake
  `GET` (challenge com `verify_token`) + `POST` (HMAC `x-hub-signature-256`),
  que faz find-or-create de contact/conversation, insere `messages`, atualiza
  `broadcast_recipients`, dispara `automations`, `flows` e webhooks de saída.
- **As tabelas core (`contacts`, `conversations`, `messages`, `broadcasts`,
  etc.) já são agnósticas de provedor.** `messages.message_id` é um campo
  genérico de texto — hoje guarda o `wamid` da Meta, mas não há nada que
  impeça guardar o ID da Uazapi. **O dashboard lê essas tabelas diretamente
  e não precisa de nenhuma mudança** — uma vez que mensagens Uazapi
  entrem/saiam pelas mesmas tabelas, o dashboard "é alimentado pela Uazapi"
  automaticamente.
- Criptografia: AES-256-GCM (`src/lib/whatsapp/encryption.ts`) já usada para
  `access_token` e `verify_token` — deve ser reutilizada para o token da
  Uazapi.

## Decisão arquitetural central: `WhatsAppProvider`

Criar uma interface única em `src/lib/whatsapp/provider.ts`:

```ts
interface WhatsAppProvider {
  sendText(params): Promise<{ externalMessageId: string }>
  sendMedia(params): Promise<{ externalMessageId: string }>
  sendTemplate(params): Promise<{ externalMessageId: string }> // Meta: template real; Uazapi: fallback texto
  sendInteractive(params): Promise<{ externalMessageId: string }> // botões/listas
  downloadMedia(params): Promise<{ url: string }>
}
```

Duas implementações — `src/lib/whatsapp/providers/meta.ts` (wrapper do atual
`meta-api.ts`) e `src/lib/whatsapp/providers/uazapi.ts` (novo) — resolvidas
por uma factory `getProvider(config)` a partir da linha de
`whatsapp_config` (ou tabela renomeada, ver schema abaixo).

Os **4 call-sites acima** passam a chamar `provider.sendX()` em vez de
`sendTextMessage()`/`sendMediaMessage()`/`sendTemplateMessage()` da Meta
diretamente. Isso é o núcleo do trabalho — sem isso, cada nova funcionalidade
continuaria acoplada à Meta.

## Mudanças de schema

### 1. `whatsapp_config` → múltiplos providers por conta

Hoje: `UNIQUE(account_id)`. Precisa virar `UNIQUE(account_id, provider)`.

```sql
ALTER TABLE whatsapp_config
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'uazapi'));

ALTER TABLE whatsapp_config DROP CONSTRAINT whatsapp_config_account_id_key;
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_account_provider_key UNIQUE (account_id, provider);

-- Colunas Uazapi-específicas (ficam NULL para linhas provider='meta')
ALTER TABLE whatsapp_config
  ADD COLUMN uazapi_instance_token TEXT,       -- encrypted, AES-256-GCM
  ADD COLUMN uazapi_base_url TEXT,             -- ex: https://nuvtex.uazapi.com (default do servidor)
  ADD COLUMN uazapi_instance_name TEXT,
  ADD COLUMN uazapi_connection_status TEXT,    -- 'disconnected' | 'connecting' | 'connected'
  ADD COLUMN uazapi_last_qr_at TIMESTAMPTZ,
  ADD COLUMN uazapi_connected_at TIMESTAMPTZ;
```

`phone_number_id` continua `UNIQUE` mas passa a ser `UNIQUE` parcial (só
aplicável a `provider='meta'`), já que Uazapi não tem esse campo.

### 2. Coluna de roteamento — `conversations.provider`

Este é o ponto crítico apontado na revisão: **uma conversa precisa saber
qual provedor a "possui"**, senão `sendMessageToConversation` não tem como
decidir se chama Meta ou Uazapi.

```sql
ALTER TABLE conversations
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'uazapi'));
ALTER TABLE messages
  ADD COLUMN provider TEXT CHECK (provider IN ('meta', 'uazapi'));
```

Regras de roteamento:
- **Inbound**: o webhook de cada provedor estampa `provider` na conversa (na
  criação) e na mensagem.
- **Outbound em conversa existente**: lê `conversations.provider` — nunca
  ambíguo.
- **Outbound novo (broadcast, automação disparando para contato "frio",
  primeira mensagem via API v1 por telefone)**: usa um provider padrão por
  conta. **Decisão**: o padrão é `uazapi` quando a conta tiver as duas
  conexões ativas (Meta só é usado para conversas que já pertencem a ela ou
  quando explicitamente selecionado). Implementar como coluna
  `whatsapp_config.is_default` (uma linha marcada `true` por conta) — a
  linha Uazapi recebe `is_default = true` automaticamente ao conectar, se
  não houver Meta já marcada como padrão. Se a conta tiver apenas um
  provedor conectado, esse é o padrão implícito.

### 3. Diferenças de capacidades — precisa estar explícito em código, não só na doc

| Recurso | Meta | Uazapi | Tratamento |
|---|---|---|---|
| Templates aprovados / janela 24h | Sim | **Não existe** | `sendTemplate()` no provider Uazapi renderiza o template como texto simples e envia via `/send/text` (ou `/send/media` se tiver header de mídia). Passos `send_template` de automação/flow continuam funcionando, só sem restrição de janela. |
| Botões / listas interativas | `interactive.button_reply`/`list_reply` | `POST /send/menu` (`button`/`list`/`poll`) | `sendInteractive()` mapeia o formato dos nós de Flow para o `choices` da Uazapi. Cuidado: Uazapi mistura reply-buttons com call/url/copy só com aviso de incompatibilidade web — mapear 1:1 quando possível. |
| Registro/conexão | `register` + `subscribed_apps`, permanente | Login via QR feito **fora do wacrm**, direto no painel da Uazapi; sessão pode cair | wacrm só anexa o token e monitora `GET /instance/status` (leitura); nunca dispara o pareamento. Ver Fase 2. |
| ID da mensagem | `wamid` simples | `owner:messageid` — formato composto obrigatório para reply/react/delete/pin | Persistir sempre o ID completo retornado pela Uazapi em `messages.message_id`/`external_message_id`. |
| Download de mídia inbound | Meta entrega media ID, buscamos URL sob demanda via proxy | Uazapi exige `POST /message/download` explícito | **Decisão**: mesmo padrão de proxy on-demand já usado para a Meta. Novo endpoint `/api/uazapi/media/[messageId]/route.ts`, análogo a `/api/whatsapp/media/[id]`, que chama `provider.downloadMedia()` (→ `POST /message/download`) a cada request do inbox, sem persistir a mídia no Supabase Storage. `messages.media_url` guarda essa URL de proxy interna, igual ao fluxo Meta atual. |
| Handshake de webhook | `GET` com `hub.verify_token` + `POST` HMAC | **Não existe handshake `GET`** | Endpoint Uazapi só implementa `POST`; autenticação por token de instância no payload (ver abaixo). |

### 4. Autenticação do webhook Uazapi

**Decisão final (validada contra a implementação de referência
`modelo-agente-de-ia`, que já funciona em produção)**: endpoint **único e
global** `POST /api/uazapi/webhook` — sem `configId` nem secret na URL.
A Uazapi ecoa o `token` da própria instância no corpo de cada webhook
(`{ instanceName, token, chat, message }`); o handler decripta e compara
esse `token` contra `uazapi_instance_token` de cada linha
`whatsapp_config` com `provider='uazapi'` (fallback: casar por
`instanceName`). Isso elimina a necessidade de registrar uma URL
diferente por instância — todas as contas apontam para a mesma URL.

O scan é O(n) sobre as contas Uazapi conectadas (poucas nesta fase);
revisitar com uma coluna indexada se isso deixar de ser verdade.

## Novos módulos / arquivos

```
src/lib/whatsapp/
  provider.ts                 # interface WhatsAppProvider + factory getProvider()
  providers/
    meta.ts                   # wrapper fino sobre meta-api.ts existente
    uazapi.ts                 # novo client HTTP: send/text, send/media, send/menu,
                               #   message/download, message/presence, instance/*
  uazapi-instance.ts           # gestão de ciclo de vida: create/connect/status/disconnect

src/app/api/uazapi/
  webhook/route.ts             # POST — endpoint único e global; resolve a instância pelo token ecoado no payload
  instance/route.ts            # POST attach token (valida via GET status + configura webhook), GET status, DELETE (remove credenciais salvas)
  backfill/route.ts            # POST — dispara backfill inicial (ver fase 6)

supabase/migrations/
  0XX_uazapi_provider_support.sql   # schema descrito acima
```

## Fases de implementação

> **Escopo do MVP (decisão confirmada)**: implementar e validar ponta a
> ponta as **Fases 1-4** primeiro (schema, provider, conexão/QR, envio e
> recebimento de texto/mídia). As Fases 5-9 (paridade de automações/flows,
> broadcasts, backfill de histórico, API pública v1, UI de seleção de
> provider em campanhas) ficam para depois — o objetivo do MVP é ter uma
> conversa completa (enviar, receber, aparecer no inbox e no dashboard)
> funcionando com Uazapi, coexistindo com Meta.

### Fase 1 — Schema + abstração de provider (sem UI ainda)
1. Migration: `whatsapp_config.provider`, colunas Uazapi, `UNIQUE(account_id, provider)`, `conversations.provider`, `messages.provider`.
2. Criar `WhatsAppProvider` interface e `providers/meta.ts` (só encapsula o que já existe — **zero mudança de comportamento para contas Meta**).
3. Criar `providers/uazapi.ts` com os métodos: `sendText`, `sendMedia`, `sendTemplate` (→ texto), `sendInteractive` (→ `/send/menu`), `downloadMedia` (→ `/message/download`), `reactToMessage`, `markRead`.
4. `getProvider(configRow)` factory.

### Fase 2 — Anexar instância Uazapi (sem QR)

> **Decisão confirmada**: o wacrm **não gerencia o ciclo de vida da
> sessão WhatsApp da Uazapi de forma alguma** — nem cria a instância
> (`POST /instance/create`), nem faz o pareamento por QR
> (`POST /instance/connect`), nem desconecta a sessão
> (`POST /instance/disconnect`). Tudo isso é feito **diretamente no
> painel da Uazapi** pelo usuário/operador. O papel do wacrm se limita
> a: (1) receber e guardar as credenciais (token de instância), e
> (2) receber mensagens via webhook que a Uazapi chama. Isso elimina a
> dependência de `UAZAPI_ADMIN_TOKEN` e qualquer UI de QR code.

1. UI em Configurações: card "Uazapi connection" ao lado da conexão Meta existente, com campos **Instance token** (obrigatório), **Base URL** (opcional, default `https://nuvtex.uazapi.com`) e **Instance name** (opcional).
2. Fluxo: usuário loga a instância no WhatsApp direto no painel da Uazapi → cola o token no wacrm → `POST /api/uazapi/instance` valida via `GET /instance/status` (só leitura, nunca `/instance/connect`) → grava `uazapi_instance_token` (encriptado) → configura o webhook (`POST /webhook`) apontando para a URL global `/api/uazapi/webhook` (mesma para todas as instâncias/contas).
3. Estado exibido na UI: **Connected** (sessão logada — mostra nome da instância, base URL, conectado desde), **Token attached but not logged into WhatsApp** (token válido mas sessão não logada — orienta o usuário a logar no painel da Uazapi e clicar em "Refresh status"), ou **Not connected** (nenhum token anexado ainda).
4. "Detach" (`DELETE /api/uazapi/instance`) apenas remove as credenciais salvas no wacrm — **não** desloga a sessão WhatsApp na Uazapi (isso é gerenciado externamente).

### Fase 3 — Envio (outbound)
1. Reescrever os 4 call-sites para usar `provider.sendX()`:
   - `send-message.ts` — resolve provider a partir de `conversations.provider` (ou da config, se `provider` ainda não setado na conversa legada — default `meta`).
   - `automations/meta-send.ts` → renomear para `automations/provider-send.ts`, resolvendo provider por contato/conversa.
   - `flows/meta-send.ts` → idem, `flows/provider-send.ts`. Mapear nós `send_buttons`/`send_list` para `sendInteractive()`.
   - `broadcasts` (`deliverBroadcast`) — cada broadcast roda contra **um provider só** (escolhido na criação da campanha, já que templates só existem de fato na Meta); para Uazapi, broadcast usa texto/mídia livre. Antes de disparar campanha em massa via Uazapi, checar `GET /instance/wa_messages_limits` — risco de ban por ser API não-oficial; expor esse limite na UI de campanha.
2. Manter a lógica de phone-variant retry só para Meta (não é um problema conhecido da Uazapi, mas manter a validação E.164/sanitização comum).

### Fase 4 — Recebimento (inbound)
1. Handler global `/api/uazapi/webhook/route.ts` (uma única URL, sem `configId`/secret):
   - Resolve a instância decriptando `uazapi_instance_token` de cada linha `provider='uazapi'` e comparando com o `token` ecoado no payload (fallback: `instanceName`).
   - Parseia payload flat `{ instanceName, token, chat, message }` — formato confirmado contra a implementação de referência (`modelo-agente-de-ia`), não o `{event, instance, data}` da doc da skill.
   - Reaproveita `findExistingContact`/dedupe existentes (agnóstico de provider).
   - `findOrCreateContact` / `findOrCreateConversation` — estampando `provider='uazapi'` na criação da conversation.
   - Mapeia tipos de mensagem Uazapi → `content_type` permitido (mesmo `ALLOWED_CONTENT_TYPES` já existente).
   - Para mídia: chama `provider.downloadMedia()` e persiste URL (storage ou proxy).
   - Dispara os mesmos `runAutomationsForTrigger`, `dispatchInboundToFlows`, `dispatchWebhookEvent` já usados pelo webhook Meta — **nenhuma automação/flow precisa saber de qual provider veio a mensagem**, elas operam sobre `contact_id`/`conversation_id`.
2. Extrair a lógica comum de `processMessage` do webhook Meta (find-or-create contact/conversation, disparo de automations/flows/outbound-webhooks) para um helper compartilhado `src/lib/whatsapp/inbound-dispatch.ts`, chamado pelos dois handlers de webhook — evita duplicar ~150 linhas de lógica de negócio entre Meta e Uazapi.
3. Status de mensagem: Uazapi não tem exatamente a mesma escada de status da Meta (webhook de `messages` não separa status como a Meta faz); mapear o que a Uazapi expõe (evento `messages` com `ack`/status, se disponível) para o mesmo `messages.status`/`broadcast_recipients` — verificar payload real via `uazapi search-docs`.

### Fase 5 — Automações e Flows (paridade de capacidades)
1. Passo `send_template` (automations/flows): quando o provider ativo é Uazapi, renderiza o corpo do template como texto simples (sem variáveis de aprovação Meta) via `provider.sendTemplate()`.
2. Nós `send_buttons`/`send_list` do Flow: `sendInteractive()` traduz para `/send/menu` (`type: button|list`), preservando IDs para que `interactive_reply_id` continue funcionando igual ao fluxo Meta.
3. `http_fetch` e outros nós agnósticos: sem mudança.

### Fase 6 — Backfill inicial (o "dashboard alimentado pela Uazapi" além do live)
Diferente do handshake Meta, ao conectar uma instância Uazapi que já tem
histórico de conversas no WhatsApp, vale trazer esse histórico para o CRM:
1. Endpoint `POST /api/uazapi/backfill` (ou automático pós-conexão):
   - `POST /chat/find` — lista chats existentes.
   - `POST /contacts/list` — contatos.
   - `POST /message/find` por chat — últimas N mensagens.
2. Faz upsert em `contacts`/`conversations`/`messages` (marcando `provider='uazapi'`, `sender_type` inferido por `fromMe`).
3. Roda em background (job assíncrono, não bloqueia a UI de conexão) — importante logar contagem de itens importados e falhas parciais.

### Fase 7 — API pública v1 e webhooks de saída
1. `src/app/api/v1/messages` — ao enviar por telefone (`resolveConversationByPhone`), se a conversa ainda não existir, decide provider pelo default da conta; resposta inclui `provider` usado.
2. `src/app/api/v1/broadcasts` — permite indicar `provider` na criação (obrigatório se a conta tem os dois conectados).
3. Payloads de webhook de saída (`message.received`, `message.status_updated`, `conversation.created`) passam a incluir `provider` no payload — consumidores externos que hoje assumem Meta continuam funcionando (campo novo, não-breaking).
4. Documentar em `docs/public-api.md`.

### Fase 8 — UI / Configurações
1. Tela de Configurações mostra duas seções: "WhatsApp Oficial (Meta)" (existente) e "WhatsApp via Uazapi" (nova) — cada uma com seu próprio status de conexão.
2. Inbox: badge discreto por conversa indicando o provider (ícone), útil quando os dois estão ativos.
3. Criação de Broadcast/Automação: seletor de provider quando a conta tiver mais de um conectado.

### Fase 9 — Testes e rollout
1. Testes unitários do provider Uazapi (mock HTTP) — igual ao padrão de testes já existente para `meta-api.ts` (verificar `vitest.config.ts`).
2. Teste manual ponta a ponta: conectar instância de teste, enviar/receber texto, mídia, botão/lista, verificar dashboard e automações.
3. Feature flag por conta (`accounts.uazapi_enabled` ou similar) para rollout gradual antes de expor a todos os clientes.
4. Monitorar `wa_messages_limits` e taxa de erro do provider Uazapi nos logs — é API não-oficial, risco de ban da instância deve ser comunicado ao usuário na UI (aviso ao configurar).

## Riscos e avisos a comunicar ao usuário final

- Uazapi é **API não-oficial** (conexão via sessão WhatsApp Web) — risco de
  bloqueio de número em uso excessivo/bulk sending. Checar
  `GET /instance/wa_messages_limits` antes de campanhas e expor isso na UI.
- Sessões Uazapi podem cair (logout remoto, troca de celular). Como o wacrm
  não gerencia o pareamento, a UI mostra um alerta "token anexado mas não
  logado no WhatsApp" e orienta o usuário a resolver **direto no painel da
  Uazapi**, depois clicar em "Refresh status" — não é "configure uma vez e
  esqueça" como a Meta.
- Templates aprovados e a janela de 24h só existem na Meta — comunicar essa
  diferença ao usuário ao escolher provider para campanhas.

## Resumo do que muda vs. o que não muda

- **Não muda**: schema das tabelas core (`contacts`, `messages`,
  `conversations`, `broadcasts`, `automations`, `flows`) além das colunas
  `provider` aditivas; queries do dashboard; engine de automações/flows
  (agnósticos de provider); criptografia AES-256-GCM (reutilizada).
- **Muda**: `whatsapp_config` (multi-provider), os 4 call-sites de envio
  (via `WhatsAppProvider`), novo webhook `/api/uazapi/webhook`, novo cliente
  HTTP Uazapi, UI de conexão/configuração, roteamento por
  `conversations.provider`.

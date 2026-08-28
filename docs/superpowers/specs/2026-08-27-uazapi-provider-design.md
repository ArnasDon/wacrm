# Suporte a segundo provedor de WhatsApp (UAZAPI)

**Data:** 2026-08-27
**Status:** design aprovado, aguardando plano de implementação

---

## 1. Contexto e objetivo

Hoje o CRM fala com o WhatsApp exclusivamente pela **Meta Cloud API**. O
objetivo é adicionar a **UAZAPI** — uma API não-oficial que conecta um
número via leitura de QR Code — como segunda opção, sem quebrar nada do
que já funciona com a Meta.

As duas integrações são estruturalmente diferentes:

| | Meta Cloud API | UAZAPI |
|---|---|---|
| Vínculo do número | credenciais (`phone_number_id` + token) | QR Code escaneado no celular |
| Autenticação de saída | Bearer token por WABA | token por instância |
| Autenticação de entrada | HMAC `x-hub-signature-256` | **nenhuma** |
| Envelope de entrada | `entry[].changes[].value` | `{ event, instance, data }` |
| Templates | obrigatórios fora da janela de 24h | não existem |
| Janela de 24h | sim | não |
| Grupos | fora do escopo do CRM | recebidos por padrão |

O desafio central não é falar com a UAZAPI — é que o CRM **assume um único
provedor e um único número** em praticamente todo lugar.

---

## 2. Decisões travadas

| # | Decisão | Escolha |
|---|---|---|
| 1 | Provisionamento | Servidor UAZAPI compartilhado do operador; o CRM cria instâncias via `admintoken`. O usuário nunca vê token. |
| 2 | Multi-conexão | Um account pode ter Meta e UAZAPI ativos ao mesmo tempo. |
| 3 | Paridade | Destino é paridade quase total (menos templates). Entrega em ondas. |
| 4 | Conexão de saída | Resolução em 3 níveis: conversa de origem → `connection_id` explícito → conexão primária. Schema completo desde já; seletor de UI faseado. |
| 5 | Identidade de contato | **Um contato por telefone**, com uma conversa por conexão. |
| 6 | Fase 1 | **Dois canais fixos**: no máximo um Meta e um UAZAPI por account. |

### Por que a decisão 5 é "um contato, várias conversas"

Cerca de 10 tabelas penduram em `contact_id` — `deals`, `contact_tags`,
`contact_custom_field_values`, `broadcast_recipients`, `automation_logs`,
`flow_runs`, `notifications`. Separar contatos por conexão significaria
que o mesmo cliente falando pelos dois números apareceria como duas
pessoas, sem histórico, sem deal e sem tag compartilhados.

O argumento decisivo é reversibilidade. Como a conversa carrega
`connection_id`, sair de "contato compartilhado" para "contato por
conexão" depois é mecânico: dá para separar sabendo exatamente qual
mensagem veio de onde. O caminho inverso exigiria reconciliar deals e
tags duplicados — que é precisamente o que a função
`merge_duplicate_contacts()` da migração 022 faz, e o custo daquilo já é
conhecido.

### Por que a decisão 4 separa schema de UI

O motivo de ter dois números é poder dizer "esta campanha sai pelo
não-oficial, este fluxo transacional sai pelo oficial". Um modelo de
"só a conexão primária" fecharia exatamente a porta que a decisão 2
abriu. Mas a UI do seletor pode chegar depois — o que **não** pode
chegar depois é `connection_id` nas tabelas, porque isso vira backfill
em produção.

---

## 3. Escopo

### Dentro (Ondas 0 a 2)

- Extração do seam de provedor (refactor puro, só Meta).
- Migração de schema completa, incluindo colunas que só serão usadas na
  Onda 3.
- Conexão UAZAPI via QR Code na tela de configuração.
- Inbox: enviar e receber texto e mídia; status de entrega e leitura.
- Flows, Automations e respostas de IA funcionando em número UAZAPI.

### Fora (spec própria, Onda 3)

- Broadcast por número UAZAPI (exige relaxar `broadcasts.template_name
  NOT NULL` e reformular a UI de campanha, que hoje é orientada a
  template).
- Mensagens interativas via `/send/menu` da UAZAPI.
- Seletor explícito de conexão em Flows, Automations e API pública
  (nesta fase essas superfícies usam a primária).

### Fora indefinidamente

- Grupos, canais/newsletter, comunidades.
- Sincronização de histórico na conexão (`history`).
- Espelhar no CRM mensagens que o usuário enviou direto do celular.

---

## 4. Arquitetura

### 4.1 Schema — migração `040_whatsapp_connections.sql`

#### `whatsapp_config` → `whatsapp_connections`

O rename é deliberado. O pressuposto de linha única está embutido em
~41 arquivos como `.eq('account_id', x).single()`. Mantendo o nome, um
call site esquecido só quebraria quando aparecesse a segunda conexão —
em produção, sem erro claro. Renomeando, o TypeScript e os testes
apontam todos os pontos de uma vez.

```sql
ALTER TABLE whatsapp_config RENAME TO whatsapp_connections;

-- Meta: access token | UAZAPI: instance token. Mesma coluna, mesmo
-- encrypt()/decrypt(); o nome antigo passaria a mentir.
ALTER TABLE whatsapp_connections RENAME COLUMN access_token TO credential;

ALTER TABLE whatsapp_connections
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta','uazapi')),
  ADD COLUMN label TEXT,
  ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN display_phone TEXT,
  ADD COLUMN profile_name TEXT,
  ADD COLUMN webhook_secret_hash TEXT,
  ADD COLUMN uazapi_instance_id TEXT,
  ADD COLUMN uazapi_base_url TEXT,
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN last_connection_error TEXT;
```

Colunas que passam a ser nullable (só fazem sentido para
`provider='meta'`): `phone_number_id`, `waba_id`, `verify_token`,
`registered_at`, `subscribed_apps_at`, `last_registration_error`.

O `CHECK` de `status` é ampliado para cobrir o ciclo de vida da UAZAPI:

```
disconnected | connecting | connected | hibernated | banned
```

Constraints:

```sql
-- Some o "um por account".
DROP INDEX IF EXISTS whatsapp_config_account_id_key;

-- Fase 1: dois canais fixos, um por provedor.
-- Relaxar depois = dropar este índice, nada mais.
CREATE UNIQUE INDEX idx_connections_account_provider
  ON whatsapp_connections (account_id, provider)
  WHERE archived_at IS NULL;

-- Preserva a regra da migração 013.
CREATE UNIQUE INDEX idx_connections_phone_number_id
  ON whatsapp_connections (phone_number_id)
  WHERE provider = 'meta' AND archived_at IS NULL;

-- No máximo uma primária por account.
CREATE UNIQUE INDEX idx_connections_one_primary
  ON whatsapp_connections (account_id)
  WHERE is_primary AND archived_at IS NULL;

-- Lookup do webhook UAZAPI.
CREATE UNIQUE INDEX idx_connections_webhook_secret_hash
  ON whatsapp_connections (webhook_secret_hash)
  WHERE webhook_secret_hash IS NOT NULL;
```

**Backfill:** toda linha existente vira `provider='meta'`,
`is_primary=true`. Ninguém perde conexão.

#### `conversations.connection_id`

```sql
ALTER TABLE conversations ADD COLUMN connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE RESTRICT;
-- backfill: a única conexão do account; depois SET NOT NULL

DROP INDEX idx_conversations_account_contact;
CREATE UNIQUE INDEX idx_conversations_account_contact_connection
  ON conversations (account_id, contact_id, connection_id);
```

`ON DELETE RESTRICT` é intencional: apagar uma conexão não pode apagar
histórico. Remover conexão significa arquivar (ver 4.4).

#### `messages` — sem alteração (decisão deliberada)

Uma conversa pertence a exatamente uma conexão, então `message →
connection` sai por join. Denormalizar criaria uma coluna capaz de
divergir da conversa. O `UNIQUE(conversation_id, message_id)` da
migração 037 continua correto sem tocar.

#### `flow_runs` — corrigir o unique de run ativo

```sql
DROP INDEX idx_one_active_run_per_contact;   -- (account_id, contact_id)
CREATE UNIQUE INDEX idx_one_active_run_per_conversation
  ON flow_runs (account_id, conversation_id) WHERE status = 'active';
```

Sem isso, o mesmo contato falando nos dois números conseguiria manter
apenas um flow ativo — o segundo morreria em violação de constraint.
`flow_runs.conversation_id` já existe, então não há coluna nova.

#### `broadcasts.connection_id`

Adicionada agora (nullable → backfill para a primária → `NOT NULL`),
mesmo com broadcast UAZAPI só na Onda 3. `template_name` continua
`NOT NULL`; relaxar é trabalho da Onda 3.

#### `contacts` — sem alteração

`UNIQUE(account_id, phone_normalized)` fica como está. É a decisão 5
materializada.

#### Colaterais

- Políticas RLS acompanham o rename.
- `supabase/ci/verify-schema.sql` checa
  `to_regclass('public.whatsapp_config')` — precisa apontar para o nome
  novo, senão a CI quebra imediatamente.
- `mirror_inbound_media` passa a ser por conexão (era por account), que
  é o comportamento correto de qualquer forma.

#### Risco de deploy

O rename preserva dados, índices e FKs, mas é uma **quebra
coordenada**: código antigo apontando para `whatsapp_config` para de
funcionar no instante em que a migração roda. Migração e aplicação
sobem juntas, não em fases.

---

### 4.2 Seam de envio

Hoje a sequência "carrega config → decripta token → retry de variante →
chama API → persiste → atualiza conversa" está **copiada em 5 lugares**:

- `src/lib/whatsapp/send-message.ts` (inbox + `/api/v1/messages`)
- `src/lib/whatsapp/broadcast-core.ts`
- `src/lib/flows/meta-send.ts`
- `src/lib/automations/meta-send.ts`
- `src/app/api/whatsapp/react/route.ts`

`automations/meta-send.ts` já delega o interativo para
`flows/meta-send.ts` — a convergência já começou de forma acidental.

Adicionar um segundo provedor sem extrair isso transformaria 5 cópias
em 10 ramos `if (provider === ...)`.

#### Interface do transporte

```ts
// src/lib/whatsapp/providers/types.ts
export type ProviderName = 'meta' | 'uazapi'

export interface ProviderCapabilities {
  templates: boolean
  interactive: boolean
  reactions: boolean
  media: boolean
}

export interface TransportResult {
  providerMessageId: string
  /** Telefone que a API realmente aceitou, quando o transporte
   *  aplicou alguma normalização própria. O núcleo compara com o
   *  original e faz o writeback no contato. */
  normalizedRecipient?: string
}

export interface WhatsAppTransport {
  readonly provider: ProviderName
  readonly capabilities: ProviderCapabilities
  sendText(args): Promise<TransportResult>
  sendMedia(args): Promise<TransportResult>
  sendInteractive(args): Promise<TransportResult>
  sendReaction(args): Promise<TransportResult>
  sendTemplate(args): Promise<TransportResult>
  fetchMedia(ref: ProviderMediaRef): Promise<{ buffer: Buffer; contentType: string }>
}

export function createTransport(conn: ResolvedConnection): WhatsAppTransport
```

`ResolvedConnection` é a linha de `whatsapp_connections` com a
credencial **já decriptada**. O transporte nunca vê o banco.

`ProviderMediaRef` é o ponteiro opaco de mídia de cada provedor —
`{ provider: 'meta', mediaId }` ou `{ provider: 'uazapi', messageId }`.
Só o transporte que o emitiu sabe resolvê-lo; o núcleo apenas o
carrega.

**Capacidades** são consultadas pelo núcleo antes do envio. Chamar
`sendTemplate` num transporte UAZAPI lança `UnsupportedCapabilityError`,
que o núcleo mapeia para 400 com mensagem clara — em vez de a chamada
morrer no fio com erro opaco. A UI usa o mesmo descritor para esconder
affordances que não se aplicam.

O descritor diz o que o transporte **implementa hoje**, não o que a API
do provedor é capaz de fazer. A UAZAPI tem `/send/menu`, mas o
transporte declara `interactive: false` até a Onda 3 implementá-lo — é
isso que mantém a UI honesta durante as ondas intermediárias. Valores
por onda:

| | Meta | UAZAPI (Ondas 1–2) | UAZAPI (Onda 3) |
|---|---|---|---|
| `templates` | ✅ | ❌ (não existe na API) | ❌ |
| `media` | ✅ | ✅ | ✅ |
| `reactions` | ✅ | ✅ | ✅ |
| `interactive` | ✅ | ❌ (ainda não implementado) | ✅ |

O retry de variantes de telefone (`phoneVariants` /
`isRecipientNotAllowedError`) é gambiarra específica do sandbox da Meta
e do trunk 0 brasileiro. **Fica dentro do transporte Meta**, não vaza
para a interface. É por isso que `TransportResult` carrega
`normalizedRecipient`.

#### Núcleo de envio

```ts
// src/lib/whatsapp/send-core.ts
sendViaConnection(db, accountId, {
  conversationId?, connectionId?, contactId?,
  message: OutboundMessage,          // union: text | media | interactive | template | reaction
  senderType: 'agent' | 'bot',
  aiGenerated?, replyToMessageId?,
  pauseActiveFlowRun?: boolean,      // true nos envios de agente
}): Promise<{ messageId, providerMessageId }>
```

Passos, na ordem:

1. `resolveConnection()` — conversa de origem → `connectionId` explícito
   → primária do account. Erro claro se nenhuma resolver.
2. Checagem de capacidade.
3. Resolve contato e valida telefone.
4. Decripta credencial e monta o transporte.
5. Chama o método correspondente do transporte.
6. Writeback do telefone se `normalizedRecipient` divergir.
7. Persiste em `messages`.
8. Atualiza `conversations` (`last_message_text`, `last_message_at`).
9. Pausa `flow_run` ativo, quando `pauseActiveFlowRun`.

Os 5 call sites viram invocações finas deste núcleo, cada um mantendo
seu próprio mapeamento de erro (`SendMessageError` na inbox, envelope
v1 na API pública, `BroadcastError` no broadcast).

#### Critério de aceite da Onda 0

**Refactor puro. Só Meta. Zero mudança de comportamento observável. A
suíte de testes existente passa sem ser alterada.** Merge sozinha,
antes de qualquer linha de código UAZAPI.

---

### 4.3 Entrada (inbound)

Duas rotas, um pipeline.

| | Meta | UAZAPI |
|---|---|---|
| Rota | `/api/whatsapp/webhook` (existente) | `/api/whatsapp/webhook/uazapi/[secret]` |
| Autenticação | HMAC `x-hub-signature-256` | segredo opaco na URL + conferência do `instance` |
| Envelope | `entry[].changes[].value` | `{ event, instance, data }` |

Ambas normalizam para uma forma canônica e chamam o **mesmo**
`processInboundMessage()` — que é o `processMessage` de hoje extraído
da rota da Meta, preservando dedup de contato, idempotência de replay,
bump de unread, e todo o fan-out (Flows, Automations, IA, webhooks
públicos, marcação de resposta de broadcast).

```ts
interface InboundMessage {
  connectionId: string
  accountId: string
  configOwnerUserId: string
  providerMessageId: string
  from: string              // telefone normalizado
  senderName?: string
  timestamp: Date
  replyToProviderMessageId?: string
  content:
    | { kind: 'text'; text: string }
    | { kind: 'media'; mediaKind: MediaKind; caption?: string;
        filename?: string; mimeType?: string; ref: ProviderMediaRef }
    | { kind: 'location'; latitude: number; longitude: number;
        name?: string; address?: string }
    | { kind: 'interactive_reply'; replyId: string; title: string }
    | { kind: 'reaction'; targetProviderMessageId: string; emoji: string }
    | { kind: 'unsupported'; rawType: string }
}
```

Mudanças dentro de `processInboundMessage()`:

- Resolução de conversa passa a ser por
  `(account_id, contact_id, connection_id)`.
- Resolução de contato **não muda** (contato compartilhado).
- Idempotência não muda: `UNIQUE(conversation_id, message_id)` já
  cobre, porque a conversa é por conexão.
- O espelhamento de mídia (`mirrorInboundMedia`) passa a buscar os
  bytes por `transport.fetchMedia(ref)` — Meta usa
  `getMediaUrl` + `downloadMedia`; UAZAPI usa `POST /message/download`.

#### Atualizações de status

Meta manda `statuses[]`; UAZAPI manda evento `messages_update`. Ambos
normalizam para `{ providerMessageId, status, timestamp }` e caem no
`handleStatusUpdate` compartilhado. A escada de status
(`pending → sent → delivered → read → replied`, com `failed` como ramo
terminal só a partir dos estados iniciais) permanece intacta.

#### Eventos de conexão

O evento `connection` da UAZAPI atualiza
`whatsapp_connections.status`. É assim que o CRM descobre desconexão,
hibernação e ban **sem polling**.

#### Autenticação do webhook UAZAPI

A UAZAPI não assina os payloads e sua config de webhook aceita apenas
URL e lista de eventos. A saída é um segredo de alta entropia (32 bytes
base64url) embutido no path.

O banco guarda **apenas o SHA-256** do segredo; o lookup é por hash. O
texto claro existe uma única vez, no momento do provisionamento, para
configurar o webhook na UAZAPI. Um vazamento do banco não permite
forjar mensagens de entrada. Rotacionar = gerar novo e reconfigurar.

Defesa em profundidade: o handler confere que `data.instance` do
payload bate com `uazapi_instance_id` da conexão encontrada.

#### Filtros configurados na UAZAPI

Ao registrar o webhook, o CRM assina apenas
`['messages', 'messages_update', 'connection']` e envia:

```json
{ "excludeMessages": ["isGroupYes", "fromMeYes"] }
```

Dois motivos concretos:

- **`isGroupYes`** — a UAZAPI entrega mensagens de grupo por padrão.
  Sem o filtro, cada grupo viraria um "contato" com telefone
  esdrúxulo, poluindo a base.
- **`fromMeYes`** — cobre tanto o que o usuário digita no celular
  quanto o eco dos nossos próprios envios via API. Sem isso, toda
  mensagem enviada pelo CRM voltaria pelo webhook e seria persistida
  uma segunda vez.

O evento `history` **não** é assinado: ele despeja meses de conversa no
ato da conexão.

---

### 4.4 Provisionamento e QR Code

Variáveis de ambiente, **somente no servidor**:

```
UAZAPI_BASE_URL
UAZAPI_ADMIN_TOKEN
```

O `admintoken` governa todas as instâncias do servidor. Nunca vai ao
cliente, nunca é persistido por account.

#### Fluxo de conexão

1. Usuário clica em "Conectar via QR Code".
2. `POST /api/whatsapp/connections` → o servidor:
   - chama `POST /instance/create` (admin token);
   - grava a linha com `provider='uazapi'`, `uazapi_instance_id`,
     `credential = encrypt(instance token)`, `status='disconnected'`;
   - gera o segredo do webhook, chama `POST /webhook` na UAZAPI com a
     nossa URL, os eventos e os filtros da seção 4.3;
   - persiste apenas o hash do segredo.
3. `POST /api/whatsapp/connections/[id]/connect` → `POST
   /instance/connect` → resposta traz `instance.qrcode` (data URI PNG),
   que a UI renderiza.
4. A UI faz polling em `GET /api/whatsapp/connections/[id]/status`, que
   consulta `GET /instance/status`. Ao virar `connected`, grava
   `status`, `display_phone` (de `status.jid.user`) e `profile_name`.
5. O QR expira em 2 minutos; a UI oferece "gerar novo QR".

O polling é do momento da conexão apenas. Depois disso, o evento
`connection` do webhook mantém o status em dia.

#### Superfície de rotas

| Rota | Destino |
|---|---|
| `/api/whatsapp/config` (GET/POST/DELETE) | Permanece, **específica da Meta**. Internamente passa a ler e escrever a conexão `provider='meta'` do account em vez da linha única. Contrato HTTP inalterado. |
| `/api/whatsapp/connections` (GET/POST) | Nova. Lista conexões do account; cria a conexão UAZAPI. |
| `/api/whatsapp/connections/[id]` (PATCH/DELETE) | Nova. `PATCH` define `label`, `is_primary`, `mirror_inbound_media`; `DELETE` arquiva (ver abaixo). |
| `/api/whatsapp/connections/[id]/connect` (POST) | Nova. Dispara `/instance/connect` e devolve o QR. |
| `/api/whatsapp/connections/[id]/status` (GET) | Nova. Proxy de `/instance/status` para o polling da UI. |

Manter `/api/whatsapp/config` como está evita mexer no formulário da
Meta durante as Ondas 0–2 — ele continua sendo o caminho de menor
risco para o que já funciona.

O toggle de `mirror_inbound_media` hoje escreve direto na tabela via
`.eq('account_id', ...)` a partir do cliente; com duas conexões isso
atingiria as duas linhas. Passa a ir por `PATCH
/api/whatsapp/connections/[id]`.

#### Ciclo de vida

- **Desconectar:** `POST /instance/disconnect`, `status='disconnected'`.
  A linha e o histórico permanecem; reconectar reabre o QR.
- **Remover:** como `conversations.connection_id` é `ON DELETE
  RESTRICT`, remover não apaga a linha. Remover significa: desconectar,
  chamar `DELETE /instance` na UAZAPI (senão a cota do operador vaza) e
  gravar `archived_at`. O histórico sobrevive; os índices únicos
  parciais liberam o slot para uma nova conexão do mesmo provedor.
- **Ban / desconexão inesperada:** chega pelo evento `connection`,
  grava `status` e `last_connection_error`, e a UI mostra o estado com
  caminho para reconectar.

---

### 4.5 UI

#### Configurações → WhatsApp

Vira dois cards fixos (fase 1 = dois canais fixos):

- **API Oficial (Meta)** — o formulário atual, sem mudança funcional.
- **QR Code (UAZAPI)** — botão de conectar, exibição do QR, status ao
  vivo, nome e número do perfil quando conectado.

Quando ambos estiverem conectados, aparece a escolha de **canal
padrão** (a conexão primária), usada por broadcast, Flows, Automations
e API pública enquanto o seletor explícito não existir nessas
superfícies.

O card da UAZAPI carrega um aviso claro: é API não-oficial, e o número
está sujeito a bloqueio pelo WhatsApp.

#### Inbox

- Lista de conversas: selo de canal por conversa.
- Cabeçalho da conversa: por qual número aquela conversa corre.
- Composer: as affordances seguem `capabilities` da conexão — nada de
  botão de template numa conversa UAZAPI.

#### Ficha do contato

Se a mesma pessoa escreveu para os dois números, aparecem as duas
conversas, cada uma identificada pelo canal. Tags, deals, campos
personalizados e notas continuam únicos, no contato.

#### i18n

O projeto usa `next-intl` (`useTranslations('Settings.whatsapp')`).
Toda string nova entra nos arquivos de mensagem; nada hard-coded.

---

## 5. Ondas de entrega

| Onda | Conteúdo | Observação |
|---|---|---|
| **0** | Extração do seam, só Meta | Refactor puro. Testes existentes passam sem alteração. Merge sozinha. |
| **1** | Migração 040 + conexão por QR + inbox (texto, mídia, status) | Prova o seam de ponta a ponta. |
| **2** | Flows, Automations, IA em número UAZAPI | Quase de graça depois da Onda 0 — os três já passam pelo mesmo núcleo. |
| **3** | Broadcast + interativo (spec própria) | A cara: exige relaxar `template_name NOT NULL` e reformular a UI de campanha. |

A ordem não é negociável na Onda 0: qualquer código UAZAPI antes da
extração multiplica o que precisa ser refatorado depois.

---

## 6. Estratégia de testes

- **Onda 0:** o critério de aceite *é* a suíte existente passando sem
  modificação. Qualquer teste que precise mudar indica mudança de
  comportamento — ou seja, o refactor deixou de ser puro.
- **Contrato de transporte:** uma suíte única rodada contra os dois
  transportes, pulando o que as capacidades não cobrem. Garante que
  Meta e UAZAPI respondem à mesma interface do mesmo jeito.
- **Normalização de entrada:** payloads reais da UAZAPI (fixtures) →
  `InboundMessage` canônico, incluindo os casos que devem ser
  descartados (grupo, `fromMe`).
- **Resolução de conexão:** os três níveis, mais o caso de nenhuma
  conexão resolver.
- **Migração:** o repositório já tem validação de migração em CI
  (`ci/validate-migrations`); a 040 entra nela, com atenção especial ao
  backfill e ao `verify-schema.sql` renomeado.

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Rename de tabela quebra código antigo em produção | Deploy coordenado de migração + aplicação; nunca faseado. |
| Número UAZAPI banido pelo WhatsApp | Aviso explícito na UI; `status='banned'` via evento `connection`; conexão Meta permanece intacta. |
| Vazamento do `UAZAPI_ADMIN_TOKEN` compromete todas as instâncias | Somente no ambiente do servidor; nunca ao cliente; nunca por account. |
| Vazamento do banco permitiria forjar entrada | Só o hash do segredo é persistido; conferência adicional do `instance`. |
| Mensagens de grupo poluindo a base de contatos | `excludeMessages: ["isGroupYes"]` na configuração do webhook. |
| Envios do CRM voltando pelo webhook e duplicando | `excludeMessages: ["fromMeYes"]`. |
| Cota de instâncias do operador vazando | `DELETE /instance` no arquivamento da conexão. |
| Onda 0 introduzir regressão silenciosa na Meta | Suíte existente inalterada como critério de aceite; merge isolada. |

---

## 8. Trabalho futuro (fora desta spec)

- Onda 3: broadcast e interativo na UAZAPI.
- Seletor explícito de conexão em Flows, Automations e API pública.
- Mais de dois canais por account (dropar
  `idx_connections_account_provider`).
- Espelhar mensagens enviadas do celular do usuário (remover
  `fromMeYes` do filtro e resolver a atribuição de autoria).

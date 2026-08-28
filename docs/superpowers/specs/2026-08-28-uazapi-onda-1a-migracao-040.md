# Onda 1a — Migração `040_whatsapp_connections` (rename puro)

**Data:** 2026-08-28
**Status:** design aprovado, aguardando plano de implementação
**Spec-mãe:** `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`
(§4.1 é a fonte do detalhe de schema; esta spec escopa a fatia 1a e
registra as decisões da sessão de brainstorming de 2026-08-28)

---

## 1. Contexto

A spec-mãe divide o suporte a UAZAPI em ondas (§5). A **Onda 1** dela
("Migração 040 + conexão por QR + inbox") é grande demais para um plano
de implementação só — a migração sozinha é uma *quebra coordenada* que
toca ~41 arquivos. Na sessão de brainstorming de 2026-08-28 a Onda 1 foi
decomposta em três sub-levas, cada uma com spec + plano próprios:

| Sub-leva | Conteúdo | Merge |
|---|---|---|
| **1a** (esta) | Migração 040 como **rename puro**, só-Meta, zero mudança de comportamento observável + os testes de cobertura adiados da Onda 0 | Sozinha, deployável isolada |
| **1b** | Transporte UAZAPI + provisionamento + QR Code + UI de conexões. Ao fim, dá para conectar um número e **enviar** | Sozinha |
| **1c** | Pipeline de inbound (receber texto/mídia, status, eventos de conexão) = canal de duas vias completo | Sozinha |

O servidor UAZAPI do operador já está disponível, então 1b e 1c são
construíveis e testáveis de ponta a ponta — mas 1a não depende disso.

A **Onda 0** (já mergeada, PR #1) extraiu o seam de envio: `providers/`
(interface `WhatsAppTransport` + Meta), `resolve-connection.ts` (único
leitor de `whatsapp_config` no caminho de envio), `send-core.ts`. A 1a é
a primeira leva que muda a forma da tabela que a Onda 0 isolou.

---

## 2. Escopo

### Entrega

A migração `040_whatsapp_connections.sql` **completa** (todas as colunas
de §4.1, inclusive as que só a 1b/1c/Onda 3 usam) mais a atualização de
todos os call sites em lockstep, como **rename puro**: nenhuma mudança
de comportamento observável, ainda exclusivamente Meta. Mergiável e
deployável sozinha, mesma disciplina de aceite da Onda 0.

Não inclui novos testes: a 1a só acrescenta renames de identificador em
mocks. Os três testes de cobertura adiados da Onda 0 foram movidos para
a **1b** — ver §3.3.

### Defere para a 1b

- Os três testes de cobertura adiados da Onda 0 (`deliverBroadcast`,
  `broadcast/route.ts`, `react/route.ts`). A revisão final da Onda 0 os
  queria "antes de `resolve-connection.ts` mudar de forma", mas esses
  três caminhos **não referenciam `whatsapp_config`** (recebem
  `connection` pronto), então não são rede para o rename da 1a — e sim
  para o `providers/` quando a 1b acrescenta o transporte UAZAPI e
  `TransportConnection` vira união. `deliverBroadcast` também não tem
  harness de teste hoje (`broadcast-core.test.ts` não mocka
  `@/lib/whatsapp/providers`).
- Resolução de conexão em 3 níveis (conversa → `connection_id` explícito
  → primária). Na 1a, `resolveConnection` continua colapsando para a
  conexão `provider='meta'` do account.
- União discriminada por provider em `TransportConnection` — o tipo
  continua *flat*, com `phoneNumberId`.
- Qualquer código, rota (`/api/whatsapp/connections/*`), variável de
  ambiente (`UAZAPI_*`) ou UI de UAZAPI.
- Mover o toggle de `mirror_inbound_media` do cliente para
  `PATCH /api/whatsapp/connections/[id]` (só passa a importar quando
  existe uma segunda conexão).

### Defere para a 1c

- Todo o pipeline de inbound: extração de `processInboundMessage()`, a
  rota `/api/whatsapp/webhook/uazapi/[secret]`, normalização,
  atualizações de status, eventos de conexão, `transport.fetchMedia`.

### Fora (spec-mãe §3, §8)

Broadcast UAZAPI, mensagens interativas, seletor explícito de conexão em
Flows/Automations/API pública, mais de dois canais por account, grupos.

---

## 3. Arquitetura

### 3.1 Migração `040_whatsapp_connections.sql`

Segue §4.1 da spec-mãe integralmente. Resumo operacional:

**Rename + colunas**

- `whatsapp_config` → `whatsapp_connections`.
- Coluna `access_token` → `credential` (mesmo `encrypt()`/`decrypt()`,
  mesmo formato de ciphertext).
- Adiciona: `provider TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN
  ('meta','uazapi'))`, `label`, `is_primary BOOLEAN NOT NULL DEFAULT
  false`, `display_phone`, `profile_name`, `webhook_secret_hash`,
  `uazapi_instance_id`, `uazapi_base_url`, `archived_at`,
  `last_connection_error`. Todas entram agora, mesmo sem uso na 1a.
- Passam a ser nullable (só fazem sentido para `provider='meta'`):
  `phone_number_id`, `waba_id`, `verify_token`, `registered_at`,
  `subscribed_apps_at`, `last_registration_error`.
- CHECK de `status` ampliado para
  `disconnected | connecting | connected | hibernated | banned`.

**Índices / constraints**

- `DROP` do unique `whatsapp_config_account_id_key` (o "um por account",
  da migração 017).
- `idx_connections_account_provider` UNIQUE
  `(account_id, provider) WHERE archived_at IS NULL` — os dois canais
  fixos da fase 1.
- `idx_connections_phone_number_id` UNIQUE
  `(phone_number_id) WHERE provider='meta' AND archived_at IS NULL` —
  preserva a regra da migração 013.
- `idx_connections_one_primary` UNIQUE
  `(account_id) WHERE is_primary AND archived_at IS NULL`.
- `idx_connections_webhook_secret_hash` UNIQUE
  `(webhook_secret_hash) WHERE webhook_secret_hash IS NOT NULL`.

**Outras tabelas**

- `conversations.connection_id UUID REFERENCES whatsapp_connections(id)
  **ON DELETE SET NULL**`. Add a coluna + backfill para a conexão única
  do account, mas **NÃO** roda `SET NOT NULL` na 1a (ver a decisão
  1a-6). Troca `idx_conversations_account_contact` (migração 036) por
  `idx_conversations_account_contact_connection` UNIQUE
  `(account_id, contact_id, connection_id)`.
- `flow_runs`: `DROP INDEX idx_one_active_run_per_contact`
  (`(account_id, contact_id)`, migração 017) →
  `idx_one_active_run_per_conversation` UNIQUE
  `(account_id, conversation_id) WHERE status='active' AND
  conversation_id IS NOT NULL`. `flow_runs.conversation_id` já existe
  (nullable, `ON DELETE SET NULL`); sem coluna nova. Com um único
  número, os dois índices selecionam o mesmo conjunto — mudança inerte
  hoje; vira correção efetiva só quando houver dois números.
- `broadcasts.connection_id` UUID `ON DELETE SET NULL` — add + backfill,
  **sem `SET NOT NULL`** na 1a. `broadcasts.template_name NOT NULL`
  **fica** (relaxar é Onda 3).
- **Duas funções Postgres referenciam a tabela pelo nome no corpo** e
  `plpgsql` resolve isso em runtime (o rename não reescreve corpo de
  função): `redeem_invitation()` (migração 019) tem
  `... FROM whatsapp_config ...` num `UNION ALL`. A 040 acrescenta um
  `CREATE OR REPLACE FUNCTION` com o corpo byte-idêntico a 019 e só a
  tabela trocada. (`create_broadcast_with_recipients` da 038 também
  insere em `broadcasts` sem `connection_id` — coberto por a coluna
  ficar nullable.) Estas são as **únicas** duas refs SQL-resident vivas
  a `whatsapp_config` (verificado grepando `supabase/` inteiro).
- `messages` e `contacts` — **sem alteração** (decisão deliberada da
  spec-mãe: `message → connection` sai por join; `contacts` é a decisão
  5 materializada).

**Backfill**

Toda linha existente de `whatsapp_config` vira `provider='meta'`,
`is_primary=true`. Nenhuma conexão é perdida. `conversations` e
`broadcasts` recebem a conexão única do account.

**Colaterais**

- Políticas RLS acompanham o rename (nomes, não regras).
- `supabase/ci/verify-schema.sql:20-21` checa
  `to_regclass('public.whatsapp_config')` — passa a apontar para
  `public.whatsapp_connections`, senão a CI quebra imediatamente.
- `mirror_inbound_media` conceitualmente passa a ser por conexão; na 1a
  o efeito é idêntico (uma conexão por account). A rota dedicada é 1b.

### 3.2 Mudanças na aplicação (rename em lockstep)

- **`src/lib/whatsapp/resolve-connection.ts`** — lê
  `whatsapp_connections` com `.eq('account_id', …).eq('provider',
  'meta')`. `TransportConnection` **inalterado** (flat, `phoneNumberId`,
  `credential`). `connectionId` / `conversationId` seguem aceitos e
  ignorados. O self-heal de ciphertext legado continua igual, só muda o
  nome da tabela nas duas chamadas `.from()`.
- **Os call sites de `whatsapp_config` / `.access_token`** — o repo
  **não tem tipos gerados do Supabase** (o client não é tipado com um
  genérico `Database`) e **não há constante compartilhada** para o nome
  da tabela: toda referência é a string literal `'whatsapp_config'`.
  Logo, renomear a tabela **não gera erro de compilação**. A rede de
  segurança da 1a é, em ordem:
  1. **Grep exaustivo.** `git grep -l "whatsapp_config" -- 'src/**'` dá
     **23 arquivos** (alguns só citam a string em comentário —
     `encryption.ts`, `meta-api.ts`; alguns são `*.test.ts`). Não há
     construção dinâmica do nome da tabela em lugar nenhum (verificado),
     então o grep pela string literal é completo. O plano parte dessa
     lista, arquivo por arquivo.
  2. **Falha alta em runtime.** Um `.from('whatsapp_config')` esquecido
     lança `relation "whatsapp_config" does not exist` — barulhento, não
     silencioso. Os testes de integração e o app rodando pegam na hora.
  3. **O rename da coluna se autoverifica.** Após
     `RENAME COLUMN access_token TO credential`, qualquer código que lê
     `config.access_token` recebe `undefined`, e `decrypt(undefined)`
     lança. O caminho da credencial é self-checking.
  A "~41 arquivos" da spec-mãe §4.1 conta o padrão mais amplo
  `.eq('account_id', x).single()` (pressuposto de linha única), não as
  referências literais a `whatsapp_config` — que são 23.
- **`access_token` → `credential` é decisão por ocorrência, não
  find-replace.** Só renomeia a **leitura da coluna da linha de
  config/conexão** (`config.access_token` → `config.credential`, e o
  campo correspondente no tipo `WhatsAppConfig` em `src/types/index.ts`).
  **Não** mexe em: o parâmetro `accessToken` das chamadas à `meta-api`
  (camelCase, outro identificador), o `access_token` do upload resumível
  da Meta (`meta-api.resumable.test.ts`), nem qualquer `access_token`
  não relacionado à tabela.
- **`src/lib/api/v1/contacts.ts` (`resolveAuditUserId`, ~linha 78)** — o
  call site que a revisão final da Onda 0 destacou por também consultar
  `whatsapp_config`. Entra na lista explicitamente.
- **`/api/whatsapp/config` (GET / POST / DELETE)** — internamente passa
  a ler e escrever a linha `provider='meta'` do account, em vez de "a
  linha única". **Contrato HTTP byte a byte inalterado** — o formulário
  da Meta não muda.
- **Tipo `WhatsAppConfig` em `src/types/index.ts`** — o campo
  `access_token` vira `credential`; o nome do tipo pode acompanhar
  (`WhatsAppConfig` → `WhatsAppConnection`) se o plano julgar barato, ou
  ficar como está (não há tipos gerados do Supabase para regenerar).
- **RLS / policies** — nomes acompanham o rename; nenhuma regra muda.

### 3.3 Testes de cobertura adiados da Onda 0 — movidos para a 1b

A revisão final da Onda 0 registrou como dívida que `deliverBroadcast`,
`broadcast/route.ts` e `react/route.ts` não têm teste asseriando a
chamada ao transporte, e pediu que fossem "antes de
`resolve-connection.ts` mudar de forma".

Durante o planejamento ficou claro que esse enquadramento não se aplica
à 1a: os três caminhos recebem `connection` pronto e **não tocam
`whatsapp_config`**, então o rename da 1a não os afeta. Eles protegem o
`providers/` na 1b, quando surge o segundo transporte e
`TransportConnection` vira união discriminada. Além disso
`broadcast-core.test.ts` não mocka `@/lib/whatsapp/providers` hoje —
escrever o teste de `deliverBroadcast` exige montar esse mock do zero,
que é trabalho de 1b, não "rename puro".

Decisão: **os três testes entram na 1b**, como primeira task, antes de
`providers/index.ts` ganhar o ramo `'uazapi'`.

---

## 4. Decisões desta leva (brainstorming 2026-08-28)

| # | Decisão | Motivo |
|---|---|---|
| 1a-1 | Decompor a Onda 1 da spec-mãe em 1a / 1b / 1c | A migração é uma quebra coordenada de dezenas de arquivos; isolá-la como rename puro permite deploy e verificação em produção antes de qualquer código UAZAPI. Mesma lógica de "merge sozinha" que a spec-mãe aplicou à Onda 0. |
| 1a-2 | `resolveConnection` na 1a só troca o nome da tabela; 3 níveis e união discriminada ficam para a 1b | Menor rename possível. Com uma conexão por account os 3 níveis são equivalentes na prática — o código só seria exercitado na 1b, quando o UAZAPI passa a importar. |
| 1a-3 | `TransportConnection` continua flat na 1a | A união `meta`\|`uazapi` só ganha campos reais na 1b. |
| 1a-4 | `mirror_inbound_media` fica como está (cliente → `.eq('account_id')`) | Efeito idêntico com uma conexão; mover para rota é superfície de 1b. |
| 1a-5 | Os 3 testes de cobertura da Onda 0 vão para a **1b**, não a 1a | Os 3 caminhos recebem `connection` pronto e não tocam `whatsapp_config` — não são rede para o rename da 1a. Protegem o `providers/` na 1b. `deliverBroadcast` ainda nem tem harness de teste. Revertido do rascunho inicial da spec após verificação no planejamento. |
| 1a-6 | `conversations.connection_id` e `broadcasts.connection_id` ficam **nullable** na 1a; `SET NOT NULL` + `ON DELETE RESTRICT` + ciclo de arquivo vão **juntos para a 1b/1c** | Achado na revisão da Task 1: `NOT NULL` obrigaria a tocar os paths de criação de conversa (inbound webhook, `resolve-conversation`) que são 1c; `NOT NULL` + `RESTRICT` quebra o botão "Reset Configuration" (`config/route.ts:441-465` faz `DELETE` da linha de config); e o RPC `create_broadcast_with_recipients` (038) insere em `broadcasts` sem `connection_id`. Com a coluna nullable + `ON DELETE SET NULL`, os três somem e o estado "órfão" pós-reset é o mesmo de hoje. Custo: o índice único `(account_id, contact_id, connection_id)` fica mais fraco só para linhas com `connection_id` NULL (histórico de accounts que clicaram reset). |

---

## 5. Testes e critério de aceite

Mesma disciplina da Onda 0:

- **A suíte existente passa inalterada.** A única mudança permitida em
  arquivos de teste é o rename mecânico do identificador
  `whatsapp_config` → `whatsapp_connections` (e `access_token` →
  `credential`) em fixtures e mocks. Qualquer teste cuja **asserção de
  comportamento** precise mudar indica que o rename deixou de ser puro —
  é um defeito, não um ajuste.
- **Nenhum teste novo.** A dívida de cobertura da Onda 0 (§3.3) foi
  movida para a 1b. A 1a não cria arquivo de teste nem caso de teste.
- **CI de migração:** a 040 entra em `ci/validate-migrations`; atenção
  ao backfill de `conversations.connection_id` / `broadcasts.connection_id`
  e ao `verify-schema.sql` renomeado. `migrations.yml` roda no PR.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
  limpos. As 5 falhas pré-existentes de locale/fuso do baseline
  continuam sendo as mesmas 5.

---

## 6. Deploy

Spec-mãe §7: **quebra coordenada**. Código antigo apontando para
`whatsapp_config` para de funcionar no instante em que a 040 roda.
Migração e aplicação sobem **juntas, nunca em fases**. O merge desta
leva é um evento de deploy de produção coordenado — declarado
explicitamente no corpo do PR.

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Um call site de `whatsapp_config` escapa do rename e só quebra em produção | Sem tipos gerados do Supabase, o compilador **não** ajuda (ver §3.2). A rede é tripla: grep exaustivo pela string literal (não há nome de tabela dinâmico — verificado), falha alta em runtime (`relation does not exist`) que os testes de integração pegam, e o rename da coluna que torna o caminho da credencial self-checking (`decrypt(undefined)` lança). O plano trata os 23 arquivos um a um. |
| A spec-mãe §4.1 justifica o rename dizendo que "o TypeScript aponta todos os pontos" — o que não vale neste repo | Registrado. O rename continua sendo a escolha certa: as três redes da §3.2 substituem o compilador, e manter o nome deixaria um call site esquecido quebrar só quando surgisse a segunda conexão (silencioso). A força do argumento cai de "compilador" para "falha barulhenta + grep completo"; a decisão não muda. |
| Backfill de `conversations.connection_id` erra em account sem conexão | Account sem linha em `whatsapp_config` também não tem conversas com número (não há como ter mandado/recebido). O `SET NOT NULL` roda após o backfill; a migração falha alto se sobrar `NULL`. |
| `verify-schema.sql` desatualizado quebra a CI silenciosamente cedo | Está na lista de colaterais da §3.1; o plano tem um passo dedicado. |
| Rename mecânico em teste mascara uma mudança de comportamento real | Critério de aceite separa "rename de identificador em mock" (permitido) de "mudança de asserção" (defeito); a revisão de cada task verifica isso. |
| `flow_runs` — a troca de índice altera comportamento | Com um número por account, `(account_id, contact_id)` e `(account_id, conversation_id)` selecionam o mesmo conjunto. Inerte na 1a; vira correção efetiva só quando existe a segunda conexão. O predicado leva `AND conversation_id IS NOT NULL` para deixar explícito que runs sem conversa não têm backstop (era plan-mandated pela §4.1). |
| Uma função/RPC Postgres referencia `whatsapp_config` pelo nome e o rename não reescreve corpo de função | A revisão da Task 1 grepou `supabase/` inteiro: só `redeem_invitation` (019) e `create_broadcast_with_recipients` (038) são refs vivas. A 040 faz `CREATE OR REPLACE` de `redeem_invitation`; a coluna nullable cobre o INSERT do RPC de broadcast. `verify-schema.sql` ganha uma asserção de que o CHECK novo de `status` existe. |

---

## 8. Fora de escopo desta leva

- Os 3 testes de cobertura adiados da Onda 0 (§3.3) — 1b.
- `SET NOT NULL` em `conversations.connection_id` /
  `broadcasts.connection_id`, `ON DELETE RESTRICT`, e o ciclo de
  arquivo de conexão (`archived_at` via `PATCH`/`DELETE`) — 1b/1c,
  junto dos paths de criação de conversa que passam a popular
  `connection_id` (decisão 1a-6).
- Qualquer código UAZAPI (transporte, provisionamento, rotas, env, UI) —
  1b e 1c.
- Resolução de conexão em 3 níveis e união discriminada em
  `TransportConnection` — 1b.
- Mover `mirror_inbound_media` para rota — 1b.
- Pipeline de inbound — 1c.
- Broadcast UAZAPI, interativo, seletor de conexão, >2 canais — Onda 3+.

# EterWA agent — variáveis de ambiente adicionais

## Provider "claude-agent-sdk" — subscrição Claude Code da Eter (Bloco 3-A)

Novo provider de IA (`ai_configs.provider = 'claude-agent-sdk'`), a par
de `openai`/`anthropic` (BYO-key, inalterados). Fala com o Claude via
`@anthropic-ai/claude-agent-sdk` (`query()`) em vez da Messages API
crua — ver `src/lib/ai/providers/claude-agent-sdk.ts` para o
racional completo e as guardas de segurança.

**Não é uma chave por conta.** Autentica-se pela subscrição Claude
Code da própria Eter, com uma única variável partilhada por todo o
serviço:

```bash
# EXACTAMENTE o mesmo token já em produção para o AI SDR
# (tools/ai-sdr no repo "Gestor - Eter Growth"), lido de
# /etc/ai-sdr/.env pelos units systemd desse worker (EnvironmentFile=,
# ver tools/ai-sdr/deploy/ai-sdr-heartbeat.service). NÃO gerar um token
# novo — copiar o mesmo valor para o ambiente do container EterWA.
# Só se esse token deixar de existir/for revogado é que se gera um novo
# com "claude setup-token" (requer sessão Claude Code activa).
CLAUDE_CODE_OAUTH_TOKEN=
```

Sem esta variável, qualquer chamada a este provider falha de forma
explícita (`AiError`, code `missing_oauth_token`) — nunca em silêncio
— com uma mensagem que aponta para esta secção.

### Wiring no Docker (proposta — por fazer no deploy real)

O `Dockerfile` actual (`output: standalone` do Next.js) não precisa de
nenhum passo extra de instalação: o pacote
`@anthropic-ai/claude-agent-sdk` traz o seu próprio executável bundled
(não depende do CLI `claude` estar instalado globalmente na imagem —
ver `pathToClaudeCodeExecutable` no SDK, "usa o executável embutido se
omitido"). O que falta é só levar a variável de ambiente para dentro do
container, ao lado das outras variáveis de runtime (nunca como `ARG`/
`ENV` no `Dockerfile` — essas ficam gravadas na imagem):

```yaml
# docker-compose.yml — mesmo padrão do resto das variáveis de runtime
# (SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, etc.), nunca em `build:`.
services:
  eterwa:
    env_file:
      - .env.production   # ou: environment: [ "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}" ]
```

**Risco não validado nesta sessão** (documentado, não resolvido — ver
relatório da tarefa que introduziu este provider): o `Dockerfile` usa
`.next/standalone`, que só copia para a imagem final os ficheiros que o
Next consegue rastrear estaticamente a partir dos `import`/`require`
do código. O AI SDR (Bun, sem pruning de `node_modules`) nunca teve
este problema — não é uma referência directa aqui. Se o build de
produção acusar módulos em falta do Agent SDK/MCP em runtime, a
correcção é adicionar `outputFileTracingIncludes` no `next.config.ts`
para as rotas que importam `@/lib/ai/providers/claude-agent-sdk`
(`src/app/api/whatsapp/webhook/route.ts`, `src/app/api/ai/config/route.ts`,
`src/app/api/ai/test/route.ts`, `src/app/api/ai/draft/route.ts`,
`src/app/api/ai/playground/route.ts`), apontando para
`node_modules/@anthropic-ai/claude-agent-sdk/**`. Não foi possível
confirmar isto com um `docker build` real nesta sessão (regra do
projecto: sem build/deploy na máquina local).

## Bloco 3-A — CRM Twenty (sincronização num só sentido, leads de anúncio)

Quando uma conversa nasce de um clique num anúncio Meta Click-to-
WhatsApp (`conversations.source = 'meta_ad'`), o EterWA cria a Pessoa
correspondente no Twenty CRM — ver `src/lib/crm/sync.ts`
(`syncMetaAdLeadToCrm`) e `src/lib/crm/twenty-client.ts`. Ligação
**apenas EterWA → Twenty**, nunca o inverso, e **desligada por
omissão** (`ai_configs.crm_sync_enabled = false`, migração 048).

Credenciais — mesmo padrão de autenticação já documentado em
`/Users/ricardo/twenty-crm/API.md` (Bearer token), lidas do ambiente
do serviço, nunca por conta na base de dados:

```bash
# Mesma instância https://crm.etergrowth.com já usada pela skill /crm.
TWENTY_BASE_URL=https://crm.etergrowth.com
# Mesmo valor de /Users/ricardo/twenty-crm/.env (TWENTY_API_KEY) —
# NUNCA copiar para logs, ficheiros temporários ou este documento.
TWENTY_API_KEY=
```

Sem estas duas variáveis, `syncMetaAdLeadToCrm` regista o erro em log
(sem dados pessoais) e não afecta a conversa — ver a secção "fail-safe"
no cabeçalho de `sync.ts`.

**O que É feito:** Pessoa (nome + telefone, a partir do que o WhatsApp
dá na primeira mensagem). **O que NÃO é feito:** nenhuma Empresa é
criada — o campo `origemContacto` que motivou esta ligação só existe em
Company no Twenty, e não há dados suficientes numa primeira mensagem de
WhatsApp para inventar uma empresa. Actualizar o registo mais tarde com
email/empresa (quando o agente comercial os obtiver) fica documentado
como TODO em `sync.ts`, por implementar.

**Nota de arquitectura por resolver:** este ficheiro chama
`db.from('ai_configs'|'conversations'|'contacts')` directamente, o que
vai contra a "regra dura" descrita mais abaixo neste documento
("nunca chamar `supabase.from(...)` directamente — passa sempre por
`src/lib/eter/repo/*.repo.ts`"). Não foi refeito para passar pelo
padrão de repo nesta sessão por prioridade de prazo (Agent SDK primeiro
— ver relatório da tarefa); fica identificado para follow-up.

## Google Calendar (Fase 2 — em uso)

`src/lib/calendar/google/client.ts` (`googleOAuthCredentialsFromEnv`) lê
estas duas no runtime — sem elas, qualquer tool call que precise do
calendário (`check_availability`, e a execução real por trás de
`book_meeting` / `reschedule` / `cancel_booking` em
`confirm-pending-action.ts`) falha com um erro explícito
(`missing_oauth_config`), nunca em silêncio.

```bash
# Google Cloud Console → APIs & Services → Credentials → OAuth 2.0
# Client ID, tipo "Web application".
GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret

# Redirect URI registado no OAuth client acima — tem de corresponder
# exactamente a um "Authorized redirect URI" na Google Cloud Console.
# É o path da rota de callback real (src/app/api/calendar/google/callback).
GOOGLE_OAUTH_REDIRECT_URI=https://your-deployment.example.com/api/calendar/google/callback
```

### "Ligar Google Calendar" — fluxo web (novo)

Settings → Calendário (`/settings?tab=calendar`) tem agora um botão
"Ligar Google Calendar" que faz o round-trip de consentimento
completo:

1. `GET /api/calendar/google/authorize` (admin-only) — assina um
   `state` HMAC e redirige para o ecrã de consentimento da Google
   (scopes mínimos: `calendar.freebusy` + `calendar.events`, nunca o
   scope `calendar` completo). `access_type=offline` +
   `prompt=consent` garantem que a Google devolve sempre um
   `refresh_token`.
2. `GET /api/calendar/google/callback` — verifica a assinatura e
   validade do `state` (anti-CSRF/replay, expira aos 10 min), troca o
   `code` por tokens, e grava via `upsertCalendarConfig` com
   `isActive: false` — a conta tem de escolher calendário/horário e
   activar manualmente antes do agente marcar reuniões a sério.
3. `GET|PATCH /api/calendar/config` — ler/editar calendarId, fuso
   horário, `business_hours`, durações e o interruptor `isActive`.
   Nunca aceita nem devolve `refresh_token` — esse campo só entra pelo
   callback acima.

Requer uma nova variável, o segredo que assina o `state` (distinto do
`ENCRYPTION_KEY` que cifra o refresh token em repouso — ameaças
diferentes, um só precisa resistir a forjadura, o outro a
decifração):

```bash
# Qualquer string aleatória de alta entropia — ex.: `openssl rand -hex 32`.
GOOGLE_OAUTH_STATE_SECRET=your-random-high-entropy-secret
```

### Resiliência a revogação

Se o utilizador revogar o acesso à app na sua Conta Google, a próxima
chamada ao calendário (em `confirm-pending-action.ts`) apanha o erro
`invalid_grant` da Google, desactiva `calendar_configs.is_active`
automaticamente, e notifica o `handoff_agent_id` configurado via
`notify_admin` — nunca falha em silêncio nem deixa o agente a tentar
repetidamente contra uma ligação morta.

## Bloco 3-A — agenda comercial (Google Service Account)

Modo comercial para leads de anúncios Meta Click to WhatsApp
(`ai_configs.commercial_mode_enabled`, ver
`src/lib/ai/commercial.ts` / `src/lib/calendar/commercial-availability.ts`).
Marca reuniões directamente no calendário de leads dedicado, mas SÓ
quando a hora está livre em TODOS os calendários configurados
(`ai_configs.commercial_busy_calendar_ids`) — nunca no calendário
pessoal.

Auth completamente separada do fluxo OAuth acima: uma única Google
Service Account com domain-wide delegation, a impersonar
`geral@etergrowth.com` (mesmo padrão do projecto "Gestor - Eter
Growth", `tools/google-calendar/setup-leads-calendar.ts`). Sem
`googleapis`/`google-auth-library` como dependência — o JWT-bearer é
assinado à mão com `node:crypto` em
`src/lib/calendar/google/service-account.ts`.

```bash
# Conteúdo JSON da service account (Google Cloud Console → IAM →
# Service Accounts → chave), OU um caminho absoluto para esse ficheiro
# (útil em dev local; em produção normalmente o valor JSON completo).
# NUNCA commitar o ficheiro nem colar o conteúdo em código.
GOOGLE_SERVICE_ACCOUNT_JSON=<conteúdo JSON da chave, ou caminho absoluto para o ficheiro>
# Campos obrigatórios dentro desse JSON: client_email, private_key.

# Utilizador Workspace impersonado pela service account (domain-wide
# delegation tem de já autorizar este client id para o scope do
# Calendar). Default quando omitido: geral@etergrowth.com.
GMAIL_IMPERSONATE_USER=geral@etergrowth.com
```

**Setup na Google Admin Console** (uma vez, fora deste repo): Security
→ Access and data control → API controls → Domain-wide Delegation →
associar o Client ID da service account aos scopes
`https://www.googleapis.com/auth/calendar.freebusy` e
`https://www.googleapis.com/auth/calendar.events`. Sem isto, todo o
agendamento comercial falha com `invalid_grant`/`unauthorized_client`
— `getServiceAccountAccessToken` traduz esse erro num `CalendarError`
com `code: 'invalid_grant'` e uma mensagem que aponta para este passo.

O calendário de destino (`ai_configs.commercial_calendar_id`) e a
lista de calendários verificados
(`ai_configs.commercial_busy_calendar_ids`) já vêm com um valor por
omissão sensato na migração 046 — o calendário "Eter | Leads WhatsApp"
existente e o "primary" do utilizador impersonado — mas são editáveis
por conta em Settings → Agente IA.

Se `commercial_calendar_id` estiver vazio para uma conta, o agente
comercial não tenta agendar: cai para o link de `commercial_booking_url`
(quando configurado) ou pede o email e diz que a equipa entra em
contacto.

**Em Docker (produção):** o ficheiro JSON da service account NUNCA
entra na imagem nem no `.env.local` versionado — vive fora da árvore
da app no host (ex.: `/opt/eterwa/secrets/google-sa.json`, dono
`root`, permissões `600`) e é montado só-de-leitura pelo
`docker-compose.yml` (`volumes:` do serviço `app`), via a variável de
host `GOOGLE_SA_HOST_PATH` (por omissão `/dev/null`, para
`docker compose up` continuar a funcionar sem esta funcionalidade
configurada). `GOOGLE_SERVICE_ACCOUNT_JSON` no `.env.local` desse host
aponta para o caminho DENTRO do container
(`/run/secrets/google-sa.json`), nunca para o caminho no host.

## Tool-calling / agent loop (Fase 2)

Ambas opcionais — têm defaults sensatos em `src/lib/ai/defaults.ts`.

```bash
# Tecto de round-trips pedido↔ferramenta por turno do agente (loop em
# providers/anthropic.ts `runAnthropicToolLoop` / providers/openai.ts
# `runOpenAiToolLoop`). Default: 6.
AI_MAX_TOOL_ITERATIONS=6

# Orçamento de wall-clock por chamada individual a uma ferramenta antes
# de devolver um erro ao modelo (nunca deixa a conversa pendurada).
# Default: 10000 (10s).
AI_TOOL_TIMEOUT_MS=10000
```

## Confirmação de propostas + follow-ups/lembretes (039_eter_agent_scheduled_messages.sql)

Duas peças novas, ligadas ao webhook inbound do WhatsApp
(`src/app/api/whatsapp/webhook/route.ts`):

1. **Detecção de confirmação** (`src/lib/eter/pending-confirmation.ts`) —
   classifica uma resposta inbound a uma proposta pendente
   (`agent_pending_actions`) como confirmação/recusa/outra coisa.
   Determinístico primeiro (`confirmation-classifier.ts`, lista fechada
   de frases PT-PT); só cai para o LLM configurado da conta
   (`loadAiConfig` / `generateReply`) quando o determinístico não
   apanhou nada — nunca inventa uma segunda chamada a um provider
   externo. Uma proposta com mais de 24h (`SESSION_WINDOW_MS_FOR_EXPIRY`)
   nunca é confirmada — é marcada `expired` e o lead é informado que o
   horário pode já não estar livre.

2. **Follow-ups de lead "morno" + lembretes de reunião**
   (`src/lib/eter/followups.ts` + `agent_scheduled_messages`, migração
   039) — fila de envios diferidos, drenada por
   `/api/eter-agent/cron` (**reutiliza `AUTOMATION_CRON_SECRET`** — o
   mesmo header `x-cron-secret` dos outros dois crons, para não
   obrigar a provisionar um terceiro segredo só para isto). Precisa de
   ser chamado periodicamente (ex.: a cada 5-15 min) pelo mesmo
   mecanismo que já dispara `/api/automations/cron` e `/api/flows/cron`.

   **Templates aprovados fora da janela de 24h.** Quando um envio cai
   fora da janela de atendimento ao cliente do WhatsApp (ancorada na
   última mensagem INBOUND do lead — `src/lib/eter/session-window.ts` —
   não em `conversations.last_message_at`, que também avança em envios
   outbound), o cron nunca usa texto livre. Procura por convenção de
   nome um `message_templates` com `status = 'APPROVED'` para a conta:

   ```
   eter_follow_up_1d
   eter_follow_up_3d
   eter_follow_up_7d
   eter_reminder_24h
   eter_reminder_2h
   ```

   Sem o template aprovado correspondente, a linha fica `failed` com o
   motivo em `agent_scheduled_messages.error` — nunca envia texto livre
   fora da janela, nunca falha em silêncio.

## AI SDR — aprovação de decisões via WhatsApp (042_aisdr_approval_forward_queue.sql)

`src/lib/eter/aisdr-approval-forward.ts` reencaminha os botões
[Enviar]/[Descartar] que o Ricardo toca no WhatsApp (aprovação de
mensagens de outreach do AI SDR) para o worker do AI SDR. Guardado
atrás de `AISDR_APPROVAL_FORWARD_ENABLED` (`false` por omissão).

**Protecção contra forjadura (CRÍTICO).** `approval_id` é um inteiro
sequencial pequeno, adivinhável. O guarda em
`src/app/api/whatsapp/webhook/route.ts` só reencaminha uma decisão
quando o remetente (`message.from`) está na lista de aprovadores
autorizados:

```bash
# Números autorizados a aprovar/descartar via WhatsApp (separados por
# vírgula, qualquer formatação — normalizado internamente). Falha
# FECHADA: por omissão (variável ausente/vazia), TODAS as tentativas de
# aprovação são recusadas, nunca aceites.
AISDR_APPROVER_PHONES=351916944664
```

A verificação acontece ANTES de qualquer chamada de rede ou escrita em
BD (`isAuthorizedApprover`, `aisdr-approval-forward.ts`) — um
remetente não autorizado nunca chega a tocar em
`aisdr_approval_forwards` nem no worker do AI SDR. Sem
`AISDR_APPROVER_PHONES` configurada, `AISDR_APPROVAL_FORWARD_ENABLED=true`
regista um aviso alto nos logs no arranque (primeira chamada) a dizer
que todas as aprovações vão ser recusadas até a variável ser definida.

A verificação adicional por `message.context.id` (a resposta tem de
apontar para a mensagem de aprovação exacta que enviámos) está
**preparada mas inactiva** — `verifyApprovalContext` em
`aisdr-approval-forward.ts` — porque este repositório não guarda hoje
o wamid da mensagem de aprovação de saída (essa mensagem é enviada por
um serviço diferente, o worker do AI SDR via `WHATSAPP_AGENT_URL`). Ver
o comentário da função para o que seria preciso para activar isto.

## Alertas operacionais por WhatsApp

`src/lib/notifications/whatsapp-admin-alert.ts` é o emissor partilhado
usado por `aisdr-approval-alert.ts` (falhas a reencaminhar aprovações)
e `data-deletion-email.ts` (pedidos RGPD, ver secção abaixo) — SEMPRE
ligado por omissão, sem nenhum passo de configuração extra.

```bash
# Número do Ricardo que recebe os alertas operacionais (aprovações AI
# SDR falhadas, pedidos de eliminação RGPD com falha de registo, cron
# parado). Sem esta variável, os alertas ficam só em log (alto, nunca
# silencioso) e NÃO são enviados por WhatsApp.
AISDR_ALERT_ADMIN_PHONE=351900000000
```

O envio usa o `whatsapp_config` da conta a que o alerta pertence
(mesmo número de negócio que recebeu o toque de aprovação, ou que
recebeu o "APAGAR"). Fora da janela de 24h de atendimento ao cliente
do WhatsApp, cai automaticamente para um template APROVADO (nunca
tenta texto livre outra vez):

```
eter_admin_alert
```

Provisionar este template no WhatsApp Manager com um único parâmetro
de corpo (`{{1}}`) que carrega o texto do alerta. Sem o template
aprovado, um alerta fora da janela fica apenas registado em log
(`reason: 'outside_window_no_template'`), nunca falha em silêncio.

## Cron de reprocessamento das aprovações AI SDR (`/api/eter-agent/aisdr-approvals/cron`)

Drena `aisdr_approval_forwards` presas em `failed` (todas as
tentativas dentro do grupo original, no momento do webhook, foram
esgotadas — ver `forwardApprovalDecision`) para mais um grupo de
tentativas, até `MAX_QUEUE_ATTEMPTS` (5) antes de desistir em
definitivo (`gave_up`).

Mesmo padrão de autenticação dos outros crons: segredo partilhado via
cabeçalho `x-cron-secret`, reutilizando `AUTOMATION_CRON_SECRET`.

**Agendamento (cadência pretendida: a cada 15 minutos)**, ex. crontab
externo:

```bash
*/15 * * * * curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" \
  https://<deployment>/api/eter-agent/aisdr-approvals/cron
```

**Sinal de vida.** Cada execução bem sucedida regista
`cron_heartbeats.last_success_at` (migração 044). No INÍCIO de cada
execução, compara o heartbeat ANTERIOR com agora: se passaram mais de
45 minutos (3x a cadência de 15 min — tolera uma falha isolada de tick
sem alarme falso, mas apanha um agendador realmente parado em menos de
uma hora) desde a última execução bem sucedida, dispara um alerta por
WhatsApp (ver secção acima). **Limitação documentada:** esta verificação
só corre quando o cron É INVOCADO — se o agendador externo nunca
chegar a ser configurado (ou parar de todo), este código nunca corre e
nenhum alerta dispara; isso precisa de monitorização externa (ex.:
health-check ping) fora do âmbito deste repositório. O que ESTE
mecanismo apanha: o cron a ser chamado no horário certo mas a falhar
antes de chegar a escrever o seu próprio heartbeat (segredo errado,
Supabase em baixo, bug).

O alerta de heartbeat precisa de uma conta para resolver o
`whatsapp_config` a partir do qual enviar (o sweep em si não está
ligado a uma única conta):

```bash
# Conta cujo WhatsApp Business number envia o alerta de "cron parado".
# Sem esta variável, o alerta fica só em log.
AISDR_ALERT_ACCOUNT_ID=<uuid da conta>
```

## Cron de reprocessamento dos pedidos RGPD (`/api/eter-agent/data-deletion-retries/cron`)

Mesma protecção dada às aprovações AI SDR, aplicada ao pedido "APAGAR"
(ver `src/lib/eter/data-deletion.ts`). Se o INSERT em
`data_deletion_requests` falhar (erro transitório de BD), a tentativa
é registada em `data_deletion_insert_failures` (migração 043) em vez
de se perder — este cron drena essas linhas `failed` até
`MAX_INSERT_RETRY_ATTEMPTS` (5) tentativas antes de desistir em
definitivo.

Mesmo padrão de auth, mesma cadência recomendada e o mesmo mecanismo de
heartbeat/staleness (`cron_heartbeats`, limiar de 45 min) que o cron de
aprovações acima — ver essa secção para o racional completo.

```bash
*/15 * * * * curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" \
  https://<deployment>/api/eter-agent/data-deletion-retries/cron
```

## Nota sobre persistência (037_eter_agent.sql / 038_eter_agent_pending_actions.sql)

Ricardo confirmou (Fase 2): manter Supabase por agora, desacoplar mais
tarde como projecto próprio. `037_eter_agent.sql` é tratada como
definitiva. `038_eter_agent_pending_actions.sql` (Fase 2) acrescenta
`agent_pending_actions` — a persistência do write-gate (ver
`src/lib/ai/tools/write-gate.ts`) — e estende `notifications.type` com
`'agent_notification'` para o `notify_admin`.

**Regra dura para código novo neste domínio:** nunca chamar
`supabase.from(...)` directamente — passa sempre por
`src/lib/eter/repo/*.repo.ts`, cada função com `accountId` como
primeiro argumento explícito. Ver o cabeçalho de cada ficheiro em
`src/lib/eter/repo/` para o porquê (o executor de tools corre sob o
service-role client, sem RLS — o filtro por conta em código é a única
fronteira entre workspaces).

## Lead Ads — formulário nativo da Meta → EterWA (059_meta_leads.sql)

Segunda origem de leads, ao lado do Click to WhatsApp (Bloco 3-A):
alguém submete o formulário nativo da Meta ("Lead Ads") sem sair do
Facebook/Instagram; a Meta chama `POST /api/meta/leads/webhook` com
apenas o `leadgen_id`, `src/lib/meta/leads.ts` busca os campos à Graph
API, cria/reaproveita contacto + conversa (`conversations.source =
'meta_lead_ad'`), sincroniza com o Twenty e envia um template
WhatsApp de abertura (ver `src/lib/meta/lead-templates.ts`).

### Variáveis de ambiente

- `META_LEADS_VERIFY_TOKEN` — token do handshake `GET
  /api/meta/leads/webhook` (separado do `verify_token` por
  `whatsapp_config`, porque a subscrição de `leadgen` é feita na
  Página, não na WABA). Sem esta variável o GET recusa sempre
  (503) — fica assim até o Ricardo a definir. Gerar com:
  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
  ```
  Acrescentar a `.env.local` / ao ambiente de produção como
  `META_LEADS_VERIFY_TOKEN=<valor>` — nunca commitado.
- Reaproveita `META_APP_SECRET` (assinatura HMAC, mesma app Meta) e
  `whatsapp_config.access_token` (já tem `leads_retrieval` segundo o
  Bloco 4/5 — mesma conta de sistema usada pela Conversions API).

### Mapear a Página à conta (`whatsapp_config.meta_page_id`)

O webhook de `leadgen` chega por `page_id`, não por
`phone_number_id`. Antes de qualquer lead poder ser processado, uma
linha de `whatsapp_config` tem de ter `meta_page_id` preenchido:

```sql
UPDATE whatsapp_config
SET meta_page_id = '1260498167142264'  -- Página Eter Growth
WHERE account_id = '<account_id da Eter>';
```

### Subscrever o webhook (App Dashboard, ou por API)

1. Confirmar que a app `Eter_Wpp` (1491272395910926) já está
   subscrita ao campo `leadgen` do objecto `page` — `GET
   /{page_id}/subscribed_apps` (ver descoberta da tarefa: confirmar
   se o campo aparece; se não, subscrever com `POST
   /{page_id}/subscribed_apps?subscribed_fields=leadgen`).
2. Meta for Developers → Webhooks → Page → Callback URL
   `https://<deployment>/api/meta/leads/webhook`, Verify Token =
   `META_LEADS_VERIFY_TOKEN`, campo `leadgen`.
3. Permissão necessária no token: `leads_retrieval` (o token
   guardado em `whatsapp_config.access_token` já a tem, segundo as
   leituras de permissões feitas para o Bloco 4/5 — confirmar em
   Graph API Explorer → Debug Token se o webhook não receber nada).

### Templates (`src/lib/meta/lead-templates.ts`)

Três variantes (`eter_lead_ads_ceo`, `eter_lead_ads_diretor_comercial`,
`eter_lead_ads_empresario`) + uma genérica (`eter_lead_ads_generico`,
usada enquanto `AD_ID_TO_PERSONA` estiver vazio — preencher assim que
os conjuntos de anúncios por persona existirem). Corpo (categoria
MARKETING, `pt_PT`, variável `{{1}}` = primeiro nome):

> Olá {{1}}, aqui é o agente de IA da Eter Growth. Deixou o contacto no
> nosso anúncio sobre responder a clientes no WhatsApp em segundos.
> Quer que lhe explique como funciona na sua empresa?

Botões de resposta rápida: "Sim, explique" / "Agora não".

Para submeter os quatro à Meta (uma vez, requer permissão
`whatsapp_business_management` no token):

```ts
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import { LEAD_TEMPLATES, buildLeadTemplateSubmitPayload } from '@/lib/meta/lead-templates'

for (const def of Object.values(LEAD_TEMPLATES)) {
  await submitMessageTemplate({
    wabaId: '2561963054199648',
    accessToken: '<whatsapp_config.access_token decifrado>',
    payload: buildLeadTemplateSubmitPayload(def),
  })
}
```

Se a chamada for bloqueada por permissões, o payload de
`buildLeadTemplateSubmitPayload` é exactamente o que submeter à mão
em WhatsApp Manager → Contas → Templates de mensagens → Criar
template (categoria Marketing, corpo + botões acima).

### Payload do formulário (por criar — decisão do Ricardo)

`POST /{page_id}/leadgen_forms` — fora do âmbito desta tarefa (não
tocar em campanhas/anúncios/formulários), mas o payload fica pronto:

```json
{
  "name": "Eter Growth — Responder no WhatsApp em segundos",
  "follow_up_action_url": "https://etergrowth.com/obrigado",
  "questions": [
    { "type": "FULL_NAME" },
    { "type": "EMAIL" },
    { "type": "PHONE" },
    { "type": "COMPANY_NAME" },
    {
      "type": "CUSTOM",
      "key": "consentimento_whatsapp",
      "label": "Aceita ser contactado pela Eter Growth via WhatsApp sobre este assunto?"
    }
  ],
  "privacy_policy": {
    "url": "https://etergrowth.com/privacidade",
    "link_text": "Política de privacidade"
  }
}
```

`normalizeLeadFields` (`src/lib/meta/leads.ts`) lê tanto os nomes
padrão da Meta (`first_name`/`last_name`/`email`/`phone_number`/
`company_name`) como a chave custom `consentimento_whatsapp` acima —
funciona com este payload sem alterações.

### Campanha (por criar — decisão do Ricardo)

`POST /act_2570186960131561/campaigns` com `objective:
OUTCOME_LEADS`; o conjunto de anúncios optimizado para leads usa
`optimization_goal: LEAD_GENERATION`, `destination_type: ON_AD` e o
`page_id`/`promoted_object.page_id` da Eter Growth. Fora do âmbito
desta tarefa.

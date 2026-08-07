# EterWA agent — variáveis de ambiente adicionais

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
# Ainda não há um fluxo de "Ligar Google Calendar" na UI que use isto —
# `calendar_configs.refresh_token` tem de ser preenchido manualmente
# (ex.: via OAuth Playground) até esse fluxo existir.
GOOGLE_OAUTH_REDIRECT_URI=https://your-deployment.example.com/api/calendar/oauth/callback
```

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

# Setup Telnyx — Número para llamar + SMS en WACRM

> Guía operativa end-to-end, auditada contra el código real del repo y la
> documentación oficial de Telnyx (developers.telnyx.com, verificado con
> context7). Si algo de este doc no coincide con el código, el código manda.
>
> Alcance de esta guía: poner un número de Telnyx a funcionar en WACRM para
> **llamar (voz), enviar/recibir SMS y el softphone WebRTC** (widget VoIP ya
> implementado). El módulo Telnyx está documentado en `docs/telnyx-voice.md`
> (DAD §0–§13); este doc es la guía operativa de setup, no el diseño.

---

## Fase 0 — Env vars (requisito CRÍTICO, fail-closed)

El webhook **rechaza todo** si falta la public key: `webhook-signature.ts:14,29-31`
devuelve `ok: false` → los eventos se ignoran con warning (la firma se valida
ANTES de cualquier acceso a DB, `webhook/route.ts:49-56`).

| Env var | Por qué | Dónde se obtiene |
|---|---|---|
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Verificación Ed25519 de webhooks (obligatoria) | `GET /v2/public_key` con tu API key → base64 SPKI (formato exacto que espera `webhook-signature.ts:51`) |
| `ENCRYPTION_KEY` | Encripta la API key en reposo (`telnyx_config.api_key_encrypted`) | Ya existente si WhatsApp funciona (misma lib `src/lib/whatsapp/encryption.ts`) |
| `SUPABASE_SERVICE_ROLE_KEY` | El webhook escribe con service-role (`admin-client.ts`) | Ya existente |
| `NEXT_PUBLIC_SITE_URL` | Base del `webhook_url` al hacer dial saliente (`call/route.ts:52`) | Tu dominio de producción |

**Obtener la public key** (devuelve base64 Ed25519 SPKI — es EXACTAMENTE lo que
el código espera, sin conversión extra):

```bash
curl -H "Authorization: Bearer TU_API_KEY" https://api.telnyx.com/v2/public_key
# → base64 → pegar en TELNYX_WEBHOOK_PUBLIC_KEY
```

---

## Fase 1 — En Mission Control (dashboard de Telnyx)

> La compra de números y la creación de la Call Control App / Messaging Profile
> van por el dashboard — es la source of truth (`telnyx-config.tsx:22-24`).
> WACRM también puede comprar números vía API: `POST /api/telnyx/numbers/buy`
> (`buy/route.ts` → `POST /v2/number_orders`, con gate de reputación score<60).
> La compra inicial desde WACRM requiere `telnyx_config` con API key.

1. **Comprar/portar el número** → Numbers → Buy. (No se compra desde WACRM.)
2. **Crear un Messaging Profile** (Messaging → Profiles) y **asignarle el número**
   → esto habilita SMS saliente y entrante. Copiar su **UUID** → será
   `messaging_profile_id` en WACRM.
3. **Crear una Call Control App** (Voice → Call Control Apps) → esto habilita voz.
   Copiar su **UUID** → será `call_control_app_id` en WACRM (es el `connection_id`
   que exige `POST /v2/calls`, `api.ts:106`).
4. **Crear una API Key** (Auth → API Keys) con permisos de voz, SMS y telephony
   credentials (la necesita también `ensureWebrtcCredential`, `api.ts:267-271`).
5. **Configurar el webhook en DOS sitios** (el código maneja 5 eventos,
   `webhook/route.ts:81-85`):
   - **Call Control App** → Webhook URL = `https://tudominio.com/api/telnyx/webhook`
     - Eventos: `call.initiated`, `call.answered`, `call.hangup`, `call.recording.saved`
   - **Messaging Profile** → misma URL
     - Evento: `message.received`
   - Asegurar delivery firmado (headers `telnyx-signature-ed25519` +
     `telnyx-timestamp`), que es lo que valida `webhook-signature.ts:5-9`.

> Nota: el número debe estar asociado a AMBOS recursos (Call Control App para voz
> y Messaging Profile para SMS) para que funcionen los dos canales.

---

## Fase 2 — En el WACRM (Settings → Telnyx)

La UI (`telnyx-config.tsx:200-228`) pide 4 campos, que mapean 1:1 a la tabla
`telnyx_config` (migraciones 038/043/044):

| Campo UI | Columna DB | Lo que pegas |
|---|---|---|
| API Key | `api_key_encrypted` | Key de Mission Control (se valida contra `GET /v2/phone_numbers` en `config/route.ts` antes de persistir) |
| From Number | `default_from_number` | `+1555…` E.164 — tu número de Telnyx |
| Call Control App ID | `call_control_app_id` | UUID del paso 1.3 (voz) |
| Messaging Profile ID | `messaging_profile_id` | UUID del paso 1.2 (SMS; columna añadida en migración 043) |

Al guardar: la API key se encripta AES-256-GCM y persiste vía cliente autenticado
(RLS owner-only, migración 038:33-46). **Desde aquí el número ya está operativo.**

La URL del webhook se muestra en la misma pantalla (con botón copiar,
`telnyx-config.tsx:42-43,127-130`) — es `{origin}/api/telnyx/webhook`.

---

## Fase 3 — Qué esperar de cada feature

### 📞 Llamada saliente (marcar) — `call/route.ts`

Flujo servidor (botón de llamada desde ficha de contacto):

1. `POST /api/telnyx/call` con `contact_id` (`requireRole('agent')`)
2. Valida que el contacto pertenezca a tu cuenta (`.eq('account_id', ctx.accountId)`,
   404 si no), normaliza a E.164 (`normalizePhone`) y valida `isValidE164`
3. Dial vía `POST /v2/calls` con `{ to, from: default_from_number,
   connection_id: call_control_app_id, webhook_url }` (`api.ts:94-115`)
4. Inserta fila outbound en `calls` vía cliente autenticado (refuerza RLS
   `calls_insert`, migración 039:141-142)
5. Los webhooks `call.answered`/`call.hangup` actualizan estado, duración y
   disposición (`webhook/route.ts:163-210`)

### 💬 SMS saliente — step `send_sms` de automatizaciones

- `sendSms` (`api.ts:117-129`) → `POST /v2/messages` con `{ from, to, text,
  messaging_profile_id }` — usa la config de `loadTelnyxSendConfig`
  (`api.ts:195-211`).

### 📥 SMS entrante — webhook `message.received`

- `onMessageReceived` (`webhook/route.ts:314-367`): resuelve tu cuenta por
  número, crea/actualiza contacto + conversación + mensaje (`channel='sms'`),
  con dedupe por `telnyx_message_id` en `messages.metadata`
  (migración 041: `messages.channel`).
- ⚠️ **Este flujo requiere el fix del Hallazgo P1** (abajo): la API real de
  Telnyx envía `to` como **array** en el payload de mensajes, y `numStr()`
  antes no lo manejaba.

### 🎧 Softphone WebRTC — widget VoIP (YA implementado)

Montado en todo el dashboard: `dashboard-shell.tsx:49` → `voice-launcher.tsx`
→ `voice-window.tsx`; y embebido en la página Calls: `calls/page.tsx:36` →
`voice-panel.tsx`.

1. Al abrir la ventana → `useTelnyx.connect()` (`use-telnyx.ts:158-258`) →
   `POST /api/telnyx/token` (`token/route.ts:24-51`, rol `agent`)
2. `ensureWebrtcCredential` crea/guarda la Telephony Credential en tu Call
   Control App (`api.ts:251-279`, columna `telephony_credential_id` migración 044)
3. `POST /v2/telephony_credentials/{id}/token` → JWT `login_token` →
   `new TelnyxRTC({ login_token })` (`use-telnyx.ts:174`)
4. Marcado directo WebRTC (`client.newCall({ destinationNumber })`,
   `use-telnyx.ts:284-305`); estados/timer/mute/hold/DTMF en `voice-window.tsx`
   + `use-telnyx.ts`; el registro de llamadas llega por los webhooks
   `call.*` (el servidor siempre los recibe con `connection_id`).
5. Para que el WebRTC funcione en dev hace falta HTTPS/dominio seguro (riesgo
   documentado en DAD §12).

### 🎙️ Grabaciones (Fase 2) — `call.recording.saved`

- `onRecordingSaved` (`webhook/route.ts:250-308`): descarga el mp3 de la URL
  temporal de Telnyx, lo sube al bucket **privado** `call-recordings` con path
  account-scoped (`buildMediaPath`, `upload-media.ts`) y guarda
  `recording_storage_path` + `recording_url` (URL del proxy autenticado
  `GET /api/telnyx/recordings/[callId]`, firmada 5 min).
- Playback disponible en el tab Recent del widget (`voice-recent-tab.tsx:79-90`).

---

## Checklist de verificación end-to-end

Criterio de salida de Fase 1 (DAD §13): *llamada real entrante → cuelga → llega
seguimiento automático*.

- [ ] `.env` con `TELNYX_WEBHOOK_PUBLIC_KEY` + resto de vars (Fase 0)
- [ ] `curl` de prueba al webhook con firma válida → `{ ok: true }`
      (firma inválida/timestamp viejo → 403, `webhook-signature.test.ts`)
- [ ] SMS entrante crea contacto + conversación + mensaje `channel='sms'`
      (requiere fix P1 aplicado)
- [ ] Llamada saliente: fila en `calls` → `answered` → `ended` con `duration_sec`
- [ ] Llamada entrante no contestada → `disposition='missed'` + dispara
      automatización `missed_call` (test `route.test.ts:202-215`)
- [ ] Llamada entrante contestada → NO marca missed (test `route.test.ts:217-222`)
- [ ] Reentrega de webhook no duplica filas (dedup por `telnyx_call_control_id`
      y `telnyx_message_id`)
- [ ] Abrir widget VoIP → aparece "online" → llamada de prueba
- [ ] Enviar SMS de prueba desde una automatización (step `send_sms`) → llega

---

## Hallazgos de la auditoría (con fix aplicado donde aplica)

1. **P1 — `numStr()` no manejaba arrays** (FIX APLICADO en este commit):
   la API real de Telnyx envía el campo `to` del payload de mensajes como
   **array** `[{ phone_number }]` (doc oficial Message Object, verificado
   context7), pero `numStr()` (`webhook/route.ts:37-44`) solo manejaba
   string/objeto → devolvía `''` → la tenancy caía al `from` (número del lead)
   → el lookup en `default_from_number` fallaba → **SMS entrante ignorado**.
   El test simulaba `to` como objeto (shape que la API nunca envía), por eso
   pasaba sin detectarlo. Fix: rama `Array.isArray` en `numStr()` + tests con
   shape real. Ver `git diff` de este commit.
 2. ~~`numbers/check` es un stub (`score: 100` fijo)~~ — **resuelto**: `check/route.ts`
    consulta `number_lookup` + `reputation` reales y calcula score defensivo
    (spam_risk 'high' → 20; promedio de maturity/connection/engagement; `blocked`
    si score < 60). DAD §3 implementado.
 3. ~~`numbers/buy` = 501 intencional~~ — **resuelto**: `buy/route.ts` compra vía
    `POST /v2/number_orders` con el mismo gate score<60 que check y
    `customer_reference` `wacrm-{accountId[:8]}`.
 4. ~~`listPhoneNumbers` sin paginación~~ — **resuelto**: pagina con
    `page[number]`/`page[size]` siguiendo `meta.total_pages` (max 3 páginas).
 5. `sendSms` envía `from` + `messaging_profile_id` juntos — aceptado por la
   API (el profile es requerido solo para number pool / alphanumeric sender),
   pero conviene validar con un envío real de prueba (P3).
6. `use-telnyx.ts:246-254`: el timeout de 15 s se limpia justo tras
   `await client.connect()`, no al llegar `telnyx.ready` — higiene menor (P3).
7. `voice-recent-tab.tsx:28-31` hace `.select('*')` sin `.eq('account_id', …)`
   explícito — OK porque RLS `calls_select` (viewer+) filtra por cuenta (P3).

---

## Referencias (verificadas en este repo)

- Webhook + firma: `src/app/api/telnyx/webhook/route.ts`,
  `src/lib/telnyx/webhook-signature.ts` (+ tests)
- Cliente Telnyx: `src/lib/telnyx/api.ts`
- Token WebRTC: `src/app/api/telnyx/token/route.ts`
- Config UI: `src/components/settings/telnyx-config.tsx`
- Widget VoIP: `src/hooks/use-telnyx.ts`, `src/components/voice/*`
- Migraciones: `supabase/migrations/038_telnyx_config.sql`,
  `043_telnyx_config_messaging_profile.sql`, `044_telnyx_fase2_columns.sql`
- Diseño: `docs/telnyx-voice.md`

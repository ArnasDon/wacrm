# Setup Telnyx — Número para llamar + SMS en WACRM

> Guía operativa end-to-end, auditada contra el código real del repo y la
> documentación oficial de Telnyx (developers.telnyx.com, verificado con
> context7). Si algo de este doc no coincide con el código, el código manda.
>
> Alcance de esta guía: poner un número de Telnyx a funcionar en WACRM para
> **llamar (voz), enviar/recibir SMS, el softphone WebRTC** (widget VoIP ya
> implementado) **y recibir llamadas en el navegador** (Fase 4, patrón de dos
> patas). El módulo Telnyx está documentado en `docs/telnyx-voice.md`
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

La UI pide 4 campos para saliente + SMS, que mapean 1:1 a la tabla
`telnyx_config` (migraciones 038/043/044). Los dos campos del entrante van en su
propia tarjeta y se explican en la **Fase 4**:

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

## Fase 4 — Llamadas entrantes al navegador (patrón de dos patas)

> Esta fase es independiente de las anteriores. Sin ella, una llamada al número
> entra en la tabla `calls` pero **nunca suena en el navegador**: hasta la
> migración 057 el webhook solo hacía contabilidad — no contestaba, no creaba la
> segunda pata y no unía nada.

### 4.1 Por qué hacen falta dos patas

Una llamada que llega de la red telefónica **no se puede "mandar" al navegador**.
Hay que crear una **segunda llamada** hacia el cliente WebRTC y unir las dos
(Telnyx lo llama Pattern 2):

```
Llamada PSTN → tu número (en la Call Control App) → webhook
                                                      ↓
                                         answer sobre la pata A
                                                      ↓
                              POST /v2/calls → pata B hacia sip:<agente>@sip.telnyx.com
                              connection_id = CONEXIÓN DE CREDENCIALES
                                                      ↓
                                         el navegador contesta
                                                      ↓
                                         bridge  pata A ↔ pata B
```

**El error que produce el "siempre ocupado" (SIP 486 `user_busy`) es usar el
`connection_id` equivocado al crear la pata B.** Tiene que ser el de la
**conexión de credenciales** (la que autentica al softphone), no el de la Call
Control App. La CCA sirve para recibir del exterior; la conexión de credenciales
es la que sabe enrutar hacia registros SIP. Si mandas la pata B a la CCA, el SIP
no encuentra a nadie registrado y responde ocupado.

### 4.2 Qué crear en Mission Control

1. **Crear una Credential Connection** → Voice → SIP Connections → *Create SIP
   Connection* → tipo **Credentials**.
   - `active`: sí
   - *Anchorsite*: **Latency**
   - *SIP URI calling preference*: **internal**
   - Copiar su **UUID** → será `credential_connection_id` en WACRM.
   - **No** le pongas webhook URL: para este patrón no hace falta. WACRM manda
     el `webhook_url` en cada `POST /v2/calls` de la pata B, así que los eventos
     de las dos patas llegan al mismo endpoint. Ese `webhook_url` se construye
     con `NEXT_PUBLIC_SITE_URL` (Fase 0), así que **esa env var es obligatoria
     para el entrante**: sin ella, `call.answered` de la pata B nunca llega y el
     puente no se hace nunca.

2. **Crear una Telephony Credential** dentro de esa conexión → Voice → SIP
   Connections → (tu credential connection) → *Credentials* → *Add*.
   - Anota el **SIP username** (algo tipo `gencred-xxxxxxxx`).
   - El destino de la pata B es `sip:<sip_username>@sip.telnyx.com` → será
     `agent_sip_uri` en WACRM.
   - Verifica que su `connection_id` apunta a la conexión de credenciales y que
     `expires_at` no está en el pasado:
     ```bash
     curl -H "Authorization: Bearer TU_API_KEY" \
       https://api.telnyx.com/v2/telephony_credentials/<id>
     ```

3. **El número se queda en la Call Control App.** No lo muevas a la conexión de
   credenciales: es la CCA la que recibe la llamada de fuera y dispara el webhook.

4. **Webhook de la Call Control App**: el mismo de la Fase 1, más el evento
   `call.bridged` si quieres verlo en los logs (el código no lo necesita).

> Si WACRM ya te había creado una Telephony Credential colgando de la Call
> Control App (comportamiento anterior a la migración 057), **bórrala y limpia
> `telnyx_config.telephony_credential_id`** para que se regenere sobre la
> conexión de credenciales. Una credencial colgada de la CCA es la causa típica
> del `registration_status = "Not Registered"` en el softphone.

### 4.3 Qué pegar en WACRM (Settings → Telnyx → *Llamadas entrantes*)

| Campo UI | Columna DB | Lo que pegas |
|---|---|---|
| ID de la conexión de credenciales | `credential_connection_id` | UUID del paso 4.2.1 — **no** el de la Call Control App |
| URI SIP del agente | `agent_sip_uri` | `sip:gencred-xxxxxxxx@sip.telnyx.com` del paso 4.2.2 |

Ambas columnas son nulables (migración 057). Mientras estén vacías, el entrante
se comporta como antes: se registra en `calls` y no se toca la llamada. En
cuanto las rellenas, el webhook pasa a contestar y puentear.

### 4.4 Cómo probarlo

1. Abre el widget VoIP y espera a que ponga **online** (el softphone registrado).
   Si no llega a online, el problema es la credencial, no el puente: pruébala
   suelta en `https://webrtc.telnyx.com` con el SIP username y password.
2. Llama a tu número desde un móvil.
3. Deberías ver, en orden: la llamada suena en el navegador → contestas → hay
   audio en las dos direcciones.
4. En los logs del servidor: `call.initiated` (incoming) → `call.answered`
   (pata A) → `call.initiated`/`call.answered` (pata B) → bridge.
5. En la tabla `calls` quedan **dos filas**: la pata A (`leg_role='pstn'`) y la
   pata B (`leg_role='webrtc'`), cada una con `bridge_peer_control_id` apuntando
   a la otra.

**La prueba que de verdad importa (criterio de salida): tres llamadas seguidas
al mismo número, contestadas y colgadas desde el navegador. Si la tercera entra
igual que la primera, el 486 está resuelto.** Prueba también a colgar desde el
móvil *mientras el navegador todavía suena*: la pata B tiene que morir sola, y
la siguiente llamada tiene que entrar normal.

### 4.5 Si sigue dando ocupado

| Síntoma | Causa probable |
|---|---|
| Ocupado ya en la primera llamada | `credential_connection_id` es el de la CCA, o `agent_sip_uri` mal escrito |
| La primera entra, la segunda da ocupado | La pata anterior no se colgó. Mira que `call.hangup` esté llegando al webhook |
| El navegador nunca suena, pero hay filas en `calls` | Falta `NEXT_PUBLIC_SITE_URL`, así que la pata B no manda eventos de vuelta |
| `registration_status = "Not Registered"` | Credencial telefónica colgada de la CCA en vez de la conexión de credenciales, o expirada |
| Varias pestañas abiertas | Solo la última en registrarse recibe llamadas. Cierra las demás |

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

Entrante al navegador (Fase 4, migración 057):

- [ ] `credential_connection_id` y `agent_sip_uri` guardados en Settings → Telnyx
- [ ] La credencial telefónica cuelga de la **conexión de credenciales**, no de
      la Call Control App (`GET /v2/telephony_credentials/<id>` → `connection_id`)
- [ ] `NEXT_PUBLIC_SITE_URL` apunta al dominio público — sin ella la pata B no
      devuelve eventos y el bridge no ocurre
- [ ] Llamada entrante → suena en el navegador → contestada → audio en ambos
      sentidos
- [ ] Quedan **dos** filas en `calls` (`leg_role` `pstn` y `webrtc`) con
      `bridge_peer_control_id` cruzado
- [ ] Colgar desde el móvil mientras el navegador suena → la pata B muere sola
- [ ] **Tres llamadas seguidas**: la tercera entra igual que la primera (486
      resuelto)

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
  `043_telnyx_config_messaging_profile.sql`, `044_telnyx_fase2_columns.sql`,
  `057_telnyx_inbound_bridge.sql` (entrante: conexión de credenciales, SIP del
  agente y emparejamiento de patas)
- Diseño: `docs/telnyx-voice.md`

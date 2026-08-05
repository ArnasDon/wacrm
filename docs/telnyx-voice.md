# Módulo Telnyx — Voz, SMS y Números para WACRM

> **Especificación de diseño y arquitectura (DAD)** — nivel DevOps
> Repo: `Dacasan/wacrm` (fork personal). Rama de trabajo: `feat/telnyx-voice-calls`.
> Referencia externa (solo lectura): `/home/daniel/Escritorio/original/policyjar`.
> Status: **validado** (auditado contra código real de WACRM + policyjar + docs Telnyx).

---

## 0. Resumen ejecutivo

WACRM (Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase Postgres + Auth + Storage + RLS) es un CRM **personal, single-account** (`account_id` scoped) que **reemplaza a GoHighLevel** en la operación real del operador. Este módulo añade **voz, registros de llamadas (logs), grabaciones, SMS, números (Telnyx) y email (Resend)**, con la misma UX que el setup de IA: **pegar 1 API Key y funciona**. Integración full con el motor de automatizaciones existente para reproducir el flujo GHL de *missed call → seguimiento automático*.

**Objetivo de negocio (por qué existe):** dejar de pagar GHL (~$97-297/mes) usando WACRM, **sin romper la operación** (recibir/hacer llamadas, mails, secuencias, missed-call → SMS/email/WhatsApp). La fiabilidad es P0; las features son P1. Mientras no esté validado con llamadas reales, se opera **en paralelo** con GHL.

**Corte MVP (decisión de planificación, ver §13):**
- **Fase 1 (MVP, va primero):** voz inbound/outbound (forward a móvil), SMS, trigger `missed_call`, step `send_email` (Resend) y `send_sms` (Telnyx). **Sin softphone WebRTC** (pasa a fase 2 por ser la pieza más cara/frágil).
- **Fase 2:** softphone WebRTC en navegador, grabaciones avanzadas.

Explícitamente **NO** se implementa: IVR trees, ACD/colas, whisper/barge, campañas, power dialer, RTB/Ringba, DNC/TCPA, Redis/BullMQ, Stripe billing, Supabase Auth emails. Todo eso es bloat para uso personal y queda fuera del alcance. (Resend sí se usa, para **email transaccional** — no acepta invitaciones de cuenta.)

**Decisiones de arquitectura clave (verificadas con evidencia):**

| Decisión | Verificación |
|---|---|
| Reutilizar `encrypt()/decrypt()` de WhatsApp (AES-256-GCM) | `src/lib/whatsapp/encryption.ts:37/50` |
| Reutilizar `requireRole()` y `is_account_member()` | `src/lib/auth/account.ts:182`, `supabase/migrations/017_account_sharing.sql:136` |
| **Reutilizar** `normalizePhone`/`isValidE164` (ya existen en `src/lib/whatsapp/phone-utils.ts:15`) — misma lib que usa el webhook WhatsApp y el dedupe | `src/lib/whatsapp/phone-utils.ts:15/39` — no crear módulo duplicado (KISS, §9.3.1) |
| **Generalizar** `use-realtime.ts` (hoy hardcodeado a `messages`+`conversations`) | `src/hooks/use-realtime.ts:47-70` |
| Sin librería de virtualización: usar `ScrollArea` + slice (no hay react-window) | `package.json` — ausente; `src/components/ui/scroll-area.tsx` existe |
| Token WebRTC: lo emite Telnyx (login_token), NO se firma localmente | policyjar `src/lib/telnyx-credentials.ts:116-123` |
| Bucket `call-recordings` **privado** + proxy autenticado | grabaciones solo vía `GET /api/telnyx/recordings/[callId]` (`requireRole`), `createSignedUrl` 5 min; `recording_url` guarda la URL del proxy |
| Webhook valida firma Ed25519 ANTES de tocar DB | policyjar `src/app/api/webhooks/telnyx/route.ts:15-34` |
| **Email con Resend** (vanilla, 1 dep, firma Svix) | `developers.resend.com` (verificado context7), §10 |
| **Motor de automatizaciones reutilizable** — `runAutomationsForTrigger(engine.ts:67)` acepta cualquier trigger_type | `src/lib/automations/*` (auditado), §9 |
| **Templates de email HTML full (copy/paste)** — cuadro de texto + guardar + lista de nombres, disparo por tags en automatizaciones | `email_templates` (040), §10 — similar a `message_templates`/broadcasts de WACRM |

**Numeración de migraciones:** el repo termina en `037_harden_function_grants.sql` y **no existe `038`**. La SPEC original pedía `039/040/041`; se **corrige a `038/039/040/041`** (4 migraciones consecutivas, guardrail 9, tras simplificación KISS): `038` telnyx_config, `039` calls, `040` email (config + templates HTML), `041` messages.channel (hallazgo BDD — ver §2.5). Descartadas por KISS: `phone_numbers` (Telnyx API es la fuente de verdad) y catálogo `media` (las URLs viven en la tabla de negocio, patrón WACRM actual).

---

## 1. Arquitectura general

```
┌─────────────────────────────┐
│  Browser (React 19)         │
│  VoiceWindow (floating UI)  │
│  @telnyx/webrtc ^2.25.18    │  ← softphone WebRTC (login_token de Telnyx)
└──────┬──────────┬───────────┘
       │ HTTPS    │ WebSocket (SIP via Telnyx)
       ▼          ▼
┌─────────────────────────────┐        ┌──────────────────────────┐
│  Next.js 16 App Router      │        │  Telnyx Cloud            │
│  src/app/api/telnyx/*       │◄──────►│  Call Control App        │
│  requireRole() + encrypt()  │  REST  │  POST /v2/calls          │
└──────┬──────────────────────┘        │  Number Lookup/Orders    │
       │ service-role (admin-client)    │  Telephony Credentials   │
       ▼                                │  Webhooks → /api/telnyx/webhook
┌─────────────────────────────┐        └────────────▲─────────────┘
│  Supabase Postgres          │                     │ firma Ed25519
│  telnyx_config (038)        │                     │ (validada ANTES de DB)
│  calls (039)                │◄────────────────────┘
│  email (040: config +       │
│  templates HTML)            │
│  + Storage: call-recordings │  ← privado, solo proxy autenticado
└─────────────────────────────┘
```

- **Voz/SMS** salen por Telnyx (Call Control + Messaging Profile).
- **WhatsApp** sigue 100% por Meta Cloud API vía `whatsapp_config` existente — sin tocar ese flujo.
- Realtime: suscripción a `calls` filtrada por `account_id` (hook generalizado).

---

## 2. Modelo de datos (4 migraciones, consecutivas: 038–041)

### 2.1 `supabase/migrations/038_telnyx_config.sql`

```sql
-- 1:1 con accounts. Guarda la API key ENCRIPTADA (AES-256-GCM, encrypt/decrypt de WhatsApp).
create table if not exists public.telnyx_config (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null unique references public.accounts(id) on delete cascade,
  api_key_encrypted   text not null,                     -- encrypt(api_key)
  call_control_app_id text,                              -- id de la Call Control App creada en Telnyx
  default_from_number text,                              -- E.164
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.telnyx_config enable row level security;

create policy "telnyx_config_select" on public.telnyx_config
  for select using (public.is_account_member(account_id, 'owner'::public.account_role_enum));
create policy "telnyx_config_insert" on public.telnyx_config
  for insert with check (public.is_account_member(account_id, 'owner'::public.account_role_enum));
create policy "telnyx_config_update" on public.telnyx_config
  for update using (public.is_account_member(account_id, 'owner'::public.account_role_enum))
  with check (public.is_account_member(account_id, 'owner'::public.account_role_enum));
-- delete: no policy (no se borra; se revoca en su lugar)
```

> **Nota RLS:** solo `owner` puede leer/editar la API key. Las rutas server-side usan `admin-client` (service-role) y `requireRole('owner')`.

### 2.2 `supabase/migrations/039_calls.sql`

Subset de la tabla `calls` de policyjar (`001_initial_schema.sql:253-294`), **scoped a `account_id`** y sin columnas de ACD/IVR/whisper/campaña.

```sql
create table if not exists public.calls (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  contact_id             uuid references public.contacts(id) on delete set null,
  direction              text not null check (direction in ('inbound','outbound')),
  status                 text not null default 'initiated'
                         check (status in ('initiated','ringing','answered','ended','failed')),
  from_number            text not null,                  -- E.164
  to_number              text not null,                  -- E.164
  initiated_at           timestamptz not null default now(),
  answered_at            timestamptz,
  ended_at               timestamptz,
  duration_sec           integer,                        -- calculado: ended_at - answered_at
  hangup_cause           text,                           -- user_busy, normal, etc. (de Telnyx)
  disposition            text
                         check (disposition in ('completed','missed'))  -- completed | missed
  recording_url          text,                           -- URL firmada (Storage call-recordings)
  telnyx_call_control_id text unique,                    -- leg control
  telnyx_call_leg_id     text,
  telnyx_call_session_id text,
  created_at             timestamptz not null default now()
);

create index if not exists idx_calls_account_initiated on public.calls(account_id, initiated_at desc);
create index if not exists idx_calls_contact on public.calls(contact_id);

alter table public.calls enable row level security;

-- Lectura: viewer+. Escritura: agent+ (vía RPC server-side / admin-client).
create policy "calls_select" on public.calls
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
create policy "calls_insert" on public.calls
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));
```

> Actualizaciones de estado (`answered_at`, `ended_at`, `duration_sec`, `recording_url`) las hace **solo el webhook con service-role** (admin-client). El cliente nunca hace UPDATE directo — evita que un agente falsifique logs.

### 2.3 `supabase/migrations/040_email.sql` — config + templates HTML (cierra el hueco GHL)

> **Decisión KISS:** NÚMEROS Telnyx **NO se copian a una tabla local** — `GET /v2/phone_numbers` es la fuente de verdad (single-account, 1-3 números; una tabla espejo solo añade sync + deuda). El email, en cambio, **sí necesita almacenamiento propio**: `email_config` (1 fila por account, API key) + `email_templates` (HTML completo copy/paste, lista de nombres, disparo por tags). Mismo patrón que `message_templates` existente (verificado: `src/lib/whatsapp/template-webhook.ts:134`).

```sql
-- ============ email_config: 1:1 con accounts ============
create table if not exists public.email_config (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null unique references public.accounts(id) on delete cascade,
  resend_api_key_encrypted  text not null,   -- encrypt(api_key) via src/lib/whatsapp/encryption.ts
  from_email                text not null,   -- "Mi Pyme <hola@midominio.com>"
  reply_to                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.email_config enable row level security;
create policy "email_config_select" on public.email_config
  for select using (public.is_account_member(account_id, 'owner'::public.account_role_enum));
create policy "email_config_insert" on public.email_config
  for insert with check (public.is_account_member(account_id, 'owner'::public.account_role_enum));
create policy "email_config_update" on public.email_config
  for update using (public.is_account_member(account_id, 'owner'::public.account_role_enum))
  with check (public.is_account_member(account_id, 'owner'::public.account_role_enum));

-- ============ email_templates: HTML full, lista de nombres ============
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,                -- nombre único por account (seleccionable en automatizaciones)
  subject     text not null,                -- asunto del correo
  body_html   text not null,                -- HTML completo copiado del template del usuario
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (account_id, name)
);

create index if not exists idx_email_templates_account on public.email_templates(account_id);

alter table public.email_templates enable row level security;
create policy "email_templates_select" on public.email_templates
  for select using (public.is_account_member(account_id, 'agent'::public.account_role_enum));
create policy "email_templates_insert" on public.email_templates
  for insert with check (public.is_account_member(account_id, 'owner'::public.account_role_enum));
create policy "email_templates_update" on public.email_templates
  for update using (public.is_account_member(account_id, 'owner'::public.account_role_enum))
  with check (public.is_account_member(account_id, 'owner'::public.account_role_enum));
```

### 2.4 Storage — solo `call-recordings` (usa la lógica YA impuesta por WACRM)

> **Principio: no crear infraestructura paralela.** Se reutiliza **exactamente** el patrón de storage que WACRM ya tiene (verificado contra `src/lib/storage/upload-media.ts`), no uno nuevo:
> - Helper único ya existente: `uploadAccountMedia(bucket, file)` → `upload` + `getPublicUrl` (`upload-media.ts:79-117`). Es el ÚNICO camino de subida del sistema; el módulo **no añade helpers de subida nuevos**.
> - Path account-scoped ya impuesto: `account-<id>/<ts>-<basename>.<ext>` (`upload-media.ts:46-62`), con RLS storage por `foldername(name)[1]`.
> - GC ya existente: `deleteAccountMedia(bucket, path)` (`upload-media.ts:130`), reutilizado.

| Bucket | Visibilidad | Uso | Nota |
|---|---|---|---|
| `call-recordings` | **PRIVADO** | Grabaciones de llamadas (datos de clientes) | **Único bucket no-público del sistema.** No `getPublicUrl`: se sirve solo vía `GET /api/telnyx/recordings/[callId]` (`requireRole('agent')`) → `createSignedUrl(path, 300)` expire 5 min. `calls.recording_url` guarda esa URL de proxy. |

- **No se crea tabla `media` ni catálogo**: las URLs viven en la columna de la tabla de negocio (`calls.recording_url`), que es **el patrón que WACRM ya usa** (`media_url` en `messages:170`, `avatar_url` en `profiles:18`, `header_media_url` en `014:47`). No se inventa un ecosistema de metadatos adyacente que no existe en el proyecto.
- **No se crea bucket `template-media`**: los templates de email guardan el HTML completo en `email_templates.body_html` (los mails NO cuelgan imágenes de un bucket nuevo; si un template usa imágenes, se suben a `chat-media` existente — misma mecánica de hoy `template-manager.tsx:474`).
- Buckets existentes (`avatars`, `chat-media`, `flow-media`) **NO se tocan**.

### 2.5 Migración `041_messages_channel.sql` (hallazgo BDD)

> **El schema real de `messages` NO tiene columna `channel`.** Para que el webhook `message.received` (SMS entrante) viva en `messages` y aparezca en el inbox existente sin romper Realtime/notificaciones, se añade UNA columna aditiva con default que no toca filas previas:

```sql
alter table public.messages
  add column if not exists channel text not null default 'whatsapp'
  check (channel in ('whatsapp','sms'));
```

- Default `'whatsapp'` → las filas existentes no quedan rotas, y el row/message generado por WhatsApp no pide relleno.
- No rompe: `messages.conversation_id NOT NULL` se reutiliza (SMS se adjunta a la conversación del contacto).
- Separación real: **voz → tabla `calls`; SMS → tabla `messages` (canal `sms`)**. Mezcla solo visual en el inbox.

> **Numeración:** el módulo son **4 migraciones consecutivas** (038 telnyx_config, 039 calls, 040 email config+templates, 041 messages.channel). Sigue cumpliendo el guardrail "consecutivas".

---

## 2.6 Análisis BDD — Tabla de relaciones: Existente ⟷ Nuevo

Análisis de un experto en modelado de BDD sobre el **schema real** (36 tablas, extraído de Supabase), decidiendo **reutilizar** vs **crear** para no dejar campos vacíos ni acoplar sistemas.

### 2.6.1 Matriz de relaciones

| Tabla/Col existente | Objeto nuevo | Relación | FK? | Motivación / reutilización | Evita deuda (campos vacíos) |
|---|---|---|---|---|---|
| `accounts.id` | `telnyx_config.account_id` | 1:1 (UNIQUE) | ✅ `references accounts(id) on delete cascade` | Mismo patrón que `whatsapp_config.account_id` | `NOT NULL` (1:1 estricto, sin row huérfano) |
| `accounts.id` | `calls.account_id` | 1:N | ✅ cascade | Scoping multi-cuenta | `NOT NULL` |
| `accounts.id` | `email_templates.account_id` | 1:N | ✅ cascade | Scoping multi-cuenta | `NOT NULL` |
| `contacts.id` | `calls.contact_id` | N:1, opcional | ✅ `references contacts(id) on delete set null` | Reutiliza contacto existente; permite llamada sin contacto (inbound desconocido) | `NULL` legítimo y semántico (inbound sin match) — NO requiere un contacto falso |
| `contacts.phone` / `contacts.phone_normalized` | `normalizePhone` (`src/lib/whatsapp/phone-utils.ts:15`) | reutiliza columna **computada** existente | — | `phone_normalized` ya existe (`regexp_replace(phone,'\D','','g')`) y `normalizePhone` emite **el mismo formato** (quitar no-dígitos) → JOIN `WHERE phone_normalized = normalizePhone(to_number)` **usa el índice existente, sin función SQL en el WHERE** (sargable) | No se crea `contact_phone_numbers` ni "teléfono secundario" (no existen; inventarlos = deuda) |
| `conversations.id` | SMS en `messages` | N:1 (SMS se adjunta a la conversación del contacto) | ✅ vía `messages.conversation_id` existente | Inbox/Realtime/notificaciones de `messages` se reutilizan tal cual | `messages.conversation_id NOT NULL` (toda SMS tiene conversación) |
| `messages.*` | SMS (`channel='sms'`) | usa `messages` **+ 1 columna** `channel` (041) | — | Reutiliza schema completo de mensajes | Solo se añade campo si falta; `channel` default `'whatsapp'` → sin filas vacías |
| `profiles` / `member_presence` | `calls` (agente) | NO se linkea | — | WACRM single-account personal: `assigned_agent_id` de conversaciones ya cubre contexto. Añadir `calls.agent_id` = campo casi siempre NULL | Evitar `agent_id`/`initiated_by` innecesario (single-user) |
| `deals` / `pipelines` (CRM) | `calls` | NO se cruza en v1 | — | No aporta query crítica para el caso personal | Evitar FKs cruzados con CRM en v1 (modularidad: crecer después) |
| Storage `call-recordings` | `calls.recording_url` | bucket → columna de negocio | — | Privado + proxy autenticado (único bucket no-público); `recording_url` guarda la URL del proxy (patrón WACRM: URL en la tabla de negocio) | No URL pública permanente (privacidad clientes) |
| `uploadAccountMedia` (`upload-media.ts:79`) | subida de grabaciones | reutiliza helper único existente | — | Mismo helper, mismos paths `account-<id>/...`, misma RLS storage | Cero helpers de subida nuevos; `deleteAccountMedia` (`:130`) reutilizado para GC |
| `merge_duplicate_contacts` (022) / `filter_contacts_by_tags` (025) | trigger `tag_added` → step `send_email` | reutiliza motor de automatizaciones + tags | — | "Disparar email por tags" = trigger `tag_added` (ya existe en `AutomationTriggerType`) + step `send_email` (nuevo) con `template` de `email_templates` | Sin flujo de tags paralelo; reutiliza tagging existente de contacts |
| `resolveVariables` (`use-broadcast-sending.ts:87`) + `VariableMapping` | interpolación en SMS/email steps + templates | reutiliza función exportada | — | Decidir por **campos**: name/email/phone/company + custom_field es el ecosistema de un contacto (broadcast/SMS/email usan el mismo) | Sin 3ª sintaxis de plantillas; `step3-personalize.tsx:210` comparte el mismo fieldMap (UI ya existente) |

### 2.6.2 Modularidad y diseño de consultas

**Enfoque:** un solo dato vive en un solo lugar; los joins se hacen sobre la tabla fuente, no con copias.

1. **Normalización central (1 sola fuente E.164) — REUSO, no duplicación.**
   - `contacts.phone_normalized` (columna computada ya existente) = formato dígitos sin `+` (`022:32`).
   - `normalizePhone()` (`src/lib/whatsapp/phone-utils.ts:15`) ya emite **exactamente ese formato** (quitar no-dígitos) — la MISMA función que usa el webhook de WhatsApp (`webhook/route.ts:5`) y el dedupe de contactos (`dedupe.ts:2`). Por eso el módulo **no necesita lib nueva**: se reutiliza `normalizePhone`/`isValidE164`.
   - Así el lookup de `message.received` es `WHERE phone_normalized = normalizePhone(to_number)` → **usando el índice existente**, sin función en el WHERE (sargable), y sin crear una 2ª variante de normalización que pudiera divergir.

2. **`calls` autónoma para voz; `messages` reutilizada para SMS.**
   - Voz: tabla `calls` propia (con `from_number`, `to_number` E.164, `duration_sec`, `recording_url`) → queries de "Recent" y logs directos en `calls(account_id, initiated_at desc)`.
   - SMS: reutiliza `messages` (con `channel='sms'`) → aparece automáticamente en el inbox y Realtime existentes; **no hay tabla duplicada ni UNION**.
   - La separación "calls vs messages" es estructural y coincide con la semántica real (voz vs texto).

3. **Índices para las queries críticas (evitar full-scan):**
   - `calls(account_id, initiated_at desc)` → "Recent" (tab ordenada por tiempo).
   - `calls(contact_id)` → histórico por contacto.
   - `email_templates(account_id)` + UNIQUE `(account_id, name)` → listado por account + dedup de nombres en automatizaciones.
   - `messages` ya indexado por `conversation_id` (existe) → el SMS inbound no necesita índice nuevo.

4. **Estado de "número por defecto":** fuente autoritativa **única** = `telnyx_config.default_from_number` (038). La ruta `POST /api/telnyx/call` lee `default_from_number` de `telnyx_config`. Los números Telnyx se consultan on-demand (`GET /v2/phone_numbers`) — **no hay tabla espejo local** → 0 sync, 0 consistencia duplicada.

### 2.6.3 Cómo evita la deuda (resumen ejecutivo)

| Trampa que se evitó | Decisión |
|---|---|
| "Teléfono secundario" en Contact tab | se reutiliza `phone`; **no** se crea `contact_phone_numbers` (columna no existe) |
| SMS sin `channel` | se **añade** `041_messages_channel` (aditiva, default) — no se inventa schema paralelo |
| Tabla espejo de números Telnyx | **no** — `GET /v2/phone_numbers` es la fuente de verdad (single-account) |
| `default_from_number` (fuente única) | se mantiene en `telnyx_config` |
| Agente en `calls` (single-user) | se omite — sin campo casi siempre NULL |
| Duplicar mensajes para SMS | se reutiliza `messages` — sin UNION ni 2 tablas de mensajería |
| Catálogo de media nuevo | **no** — URLs en la tabla de negocio (`calls.recording_url`), patrón WACRM actual |

> **Neto:** módulo añade **4 tablas nuevas** (`telnyx_config` 038, `calls` 039, `email_config` + `email_templates` en 040) + 1 columna aditiva (`messages.channel` 041) + 1 bucket (`call-recordings` privado, único no-público). Reutiliza: `accounts`, `contacts` (con `phone_normalized` computada), `conversations`, `messages`, `whatsapp_config` (no tocado), `encrypt/decrypt`, `requireRole`, `is_account_member`, `normalizePhone`/`isValidE164` (`whatsapp/phone-utils`), `uploadAccountMedia`, `resolveVariables`, Realtime, shadcn, theme tokens.

Se crea vía **migración SQL** (patrón existente en 008/016/023) o script de bootstrap:

```sql
-- La política INSERT la firma el webhook con service-role; el SELECT solo con URL firmada.
insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

-- RLS: solo service-role escribe; lectura via signed URL (storage.getSignedUrl).
```

- **Retención**: no se borran automáticamente en v1 (uso personal). Se documenta `recording_url` como URL firmada (expiración configurable).
- **Limpieza**: `hangup_cause != 'normal'` → `disposition='missed'`; las llamadas sin `recording_url` no generan archivo.

---

## 3. API Design — `src/app/api/telnyx/`

Patrón de cada ruta (verificado en el repo): `requireRole()` + `adminClient` (service-role) + `route.test.ts` vitest al lado.

| Ruta | Método | Rol | Cuerpo | Comportamiento |
|---|---|---|---|---|
| `/config` | POST | `owner` | `{ api_key }` | Encripta y guarda. Llama `GET /v2/phone_numbers` (valida key). Crea/actualiza Call Control App con `webhook_event_url: {APP_URL}/api/telnyx/webhook` |
| `/numbers/buy` | POST | `owner` | `{ country, features: ['voice','sms'] }` | `POST /v2/number_orders` → `GET /v2/number_lookup/{num}` para validar reputation/carrier. **No inserta en ninguna tabla local** (Telnyx es la fuente de verdad; la UI lee `GET /v2/phone_numbers`). Reputation score < 60 → rechaza |
| `/numbers/check` | POST | `agent` | `{ number }` | Lookup API + Reputation → `{ score, carrier, line_type }` |
| `/call` | POST | `agent` | `{ contactId }` | Valida contacto pertenece al account (404 si no). `POST /v2/calls` con `connection_id` de la Call Control App + `webhook_url`. Inserta fila outbound en `calls` |
| `/webhook` | POST | **sin auth** | Telnyx | Valida firma Ed25519 ANTES de DB. Maneja `call.*`, `message.received`, `recording.saved`. Service-role |
| `/token` | POST | `agent` | — | `POST /v2/telephony_credentials/{id}/token` → `{ token, sip_username, sip_password }` |

> **DECISIÓN (Fase 1) — mecanismo de forward a móvil:** la llamada entrante se enruta por **forwarding NATIVO de Telnyx**, configurado en el dashboard/número (la Call Control App apunta al destino del agente). El webhook **solo observa y hace bookkeeping** en DB (**NO** hay `bridge`/`dial` por código en Fase 1 → 0 piezas móviles, mismo KISS del documento). El bridge programático se reserva a Fase 2 si se quiere lógica de fallback (2º destino / voicemail). El flujo `missed_call` sigue funcionando porque el webhook recibe igualmente `call.hangup` de cada leg.

### 3.1 Firmas de las rutas

```ts
// src/app/api/telnyx/config/route.ts
export async function POST(req: NextRequest): Promise<NextResponse>
// ctx = await requireRole("owner")
// apiKey = (await req.json()).api_key
// apiKeyEncrypted = encrypt(apiKey)  // src/lib/whatsapp/encryption.ts

// src/app/api/telnyx/call/route.ts
export async function POST(req: NextRequest): Promise<NextResponse>
// ctx = await requireRole("agent")
// contact = await getContactForAccount(ctx, contactId) → 404 si no pertenece
// telnyx.calls.dial({ connection_id, from: defaultFrom, to: normalizePhone(contact.phone) })  // src/lib/whatsapp/phone-utils.ts:15
// El INSERT outbound en `calls` se hace vía **ctx.supabase** → ejecuta la policy
//   `calls_insert` (exige agent+); así el rol se refuerza en RLS, no solo en
//   requireRole() (decisión consciente, patrón de cliente-user, no admin-client).
// Fase 1: el inbound entrante es forwarding NATIVO Telnyx (sin bridge por código, §3).
```

### 3.2 Webhook — validación de firma (crítico)

Patrón de policyjar (`src/app/api/webhooks/telnyx/route.ts:15-34`), con crypto nativo (sin librería externa):

```ts
const signature = req.headers.get("telnyx-signature-ed25519");
const timestamp = req.headers.get("telnyx-timestamp");
// 1. Rechazar si falta TELNYX_WEBHOOK_PUBLIC_KEY → fail-closed
// 2. |Date.now() - timestamp| > 300_000 → 403 (replay)
// 3. payload = `${timestamp}|${rawBody}`
// 4. crypto.verify(null, payload, publicKey, signature) — Ed25519
// 5. SOLO después: dispatch de eventos con admin-client (service-role)
```

Eventos manejados:

| Evento | Acción (admin-client, service-role) |
|---|---|
| `call.initiated` | INSERT fila en `calls` (directión, from/to E.164, status='initiated') **con `ON CONFLICT (telnyx_call_control_id) DO NOTHING`** → reentrega de Telnyx NO duplica fila. Luego `UPDATE status='ringing'` por `telnyx_call_control_id` |
| `call.answered` | UPDATE `answered_at = now()`, `status='answered'` |
| `call.hangup` | UPDATE `ended_at`, `duration_sec`, `hangup_cause`, `status='ended'`; si es missed → `disposition='missed'` (criterio único, §3.3) + dispara `missed_call` **idempotente** (guarda `call_id` en la ejecución; si ya procesado, skip). **colgar leg opuesta (anti-486)** |
| `call.bridge` | Marcar leg como bridged (cuando aplique) |
| `message.received` | SMS entrante → INSERT en `messages` (`channel='sms'`) **deduplicado** por el id del mensaje Telnyx (rellena en la columna metadata del mensaje y usa el patrón `findExistingContact`/dedupe existente si reentrega) |
| `recording.saved` | Descargar/servir → subir a bucket `call-recordings` → `calls.recording_url` firmada |

> **Máquina de estados de `calls.status`:** `initiated` → `ringing` → `answered` → `ended`; y `failed` set por la ruta `/call` si la llamada saliente no puede iniciarse. `disposition` = `completed` | `missed` | (sin voicemail en scope).

### 3.3 Anti-486 (`user_busy`) — lección de policyjar

Bug real documentado en `TELNYX_SOLUTION.md:16` y fix en policyjar `handlers.ts:3956-3972`:

**Aplica YA en Fase 1 (server-side, en el webhook):**
- En **hangup**: colgar **ambas** legs (leg 1 = quien llama, leg 2 = tu celular) para no dejar el leg 2 sonando huérfano / sesión zombie SIP.
- Delay 1-2s entre hangup y nueva llamada si el estado quedó sucio.

**Aplica cuando llegue el softphone (Fase 2, client-side):**
- En el **browser**: `call.hangup()` y dereferenciar el objeto (nunca `call.reject()`).
- Fase 1 **no** tiene cliente WebRTC, así que esta parte no existe todavía.

### 3.4 Regla ÚNICA de "missed call" (fuente autoritativa)

> Definición única en todo el sistema — tanto `disposition='missed'` como el trigger `missed_call` usan **el mismo criterio**:

```ts
// Outbound: no contestada (no hay cliente esperando) — no aplica.
// Inbound por forward a móvil: MISSED = el agente no contestó a TIEMPO.
// El `hangup_cause` se lee del **leg del AGENTE (celular)** — la señal de negocio.
//   El webhook distingue el leg por su `leg_id` en el evento: si el leg L1 (quien
//   llama) cuelga primero, ESO NO es missed (el lead ya llegó a tu operación).
const IS_MISSED_INBOUND =
  call.direction === 'inbound'
  && call.hangup_leg === 'agent'                     // leg 2 = celular del operador
  && ['no_answer', 'user_busy', 'normal'].includes(call.hangup_cause)
  && call.status === 'ended';
```

- **Solo inbound** (forward a móvil): MISSED es **exclusivamente el leg del agente (celular)** que no contestó (`no_answer`), ocupado (`user_busy`) o cortado antes de contestar (`normal`), y la llamada terminó → `disposition='missed'` **y** dispara `missed_call`. El leg 1 (el que llama cuelga) NO dispara seguimiento: el lead ya llegó a tu operación.
- **Outbound**: nunca se marca `missed` (la llamada la inicio tú; no genera seguimiento).
- La **misma función** decide `disposition` y el dispatch → 0 divergencia entre estado y trigger.

---

## 4. UI — Ventana flotante VoIP (**Fase 2** — softphone WebRTC)

> **Fase 1** (MVP) NO incluye softphone: solo un **botón "Llamar"** en la ficha del contacto (hace forward) **+ una lista simple de llamadas recientes** en `src/components/inbox/contact-sidebar.tsx` (account_id + contact_id por `initiated_at desc`) para ver el historial real desde el día 1, sin adelantar la ventana flotante. La UI completa de abajo es de **Fase 2** (referencia; ver §13). Se documenta igual para no perder la spec.

### 4.1 Archivos nuevos

```
src/components/voice/
  voice-window.tsx        ← contenedor flotante (spec exacta)
  voice-contacts-tab.tsx  ← lista de contactos (ScrollArea, sin virtualización pesada)
  voice-recent-tab.tsx    ← calls DESC initiated_at
  voice-keypad-tab.tsx    ← grid 3x4
  voice-incoming-view.tsx ← llamada entrante
  voice-active-view.tsx   ← llamada activa (timer mm:ss)
src/hooks/use-telnyx.ts   ← wrapper @telnyx/webrtc (adaptado de policyjar, sin ACD)
src/lib/whatsapp/phone-utils.ts← REUSO normalizePhone (no crear módulo nuevo)
src/lib/telnyx/admin-client.ts ← cliente service-role (patrón src/lib/automations/admin-client.ts)
src/lib/telnyx/api.ts     ← cliente Telnyx (REST) con api_key desencriptada
```

### 4.2 Componentes shadcn existentes a usar (verificados en `src/components/ui/`)

`tabs.tsx`, `avatar.tsx`, `button.tsx`, `input.tsx`, `badge.tsx`, `card.tsx`, `dialog.tsx`, `scroll-area.tsx`, `tooltip.tsx`, `separator.tsx`, `switch.tsx`.

### 4.3 Spec exacta del contenedor (tokens, sin hex)

```tsx
// voice-window.tsx
<div className="fixed bottom-6 right-6 z-50 flex h-[520px] w-[380px] flex-col
                overflow-hidden rounded-xl border bg-card shadow-2xl">
  <header className="flex h-12 items-center justify-between bg-primary px-4 text-primary-foreground">
    <span>VoIP</span>
    <Button variant="ghost" size="icon"><X /></Button>
  </header>
  {/* Tabs: Contacts | Recent | Keypad — activo con border-b-2 border-primary */}
  {/* Incoming: Accept bg-green-600 / Reject bg-destructive */}
  {/* Active: timer mm:ss, Mute/Hold/Keypad, End bg-destructive */}
</div>
```

Todos los colores vía tokens `globals.css:8-50` (`bg-card`, `bg-primary`, `text-foreground`, `border-border`, `bg-destructive`, `bg-background`). Única excepción funcional: `bg-green-600` para Accept (token de estado semántico no existe; se documenta).

### 4.4 Realtime — generalizar `use-realtime.ts`

El hook actual está **hardcodeado** a `messages`/`conversations` (`src/hooks/use-realtime.ts:47-70`). Se **extiende sin romper el API existente**:

```ts
interface UseRealtimeOptions {
  channelName: string;
  table?: "messages" | "conversations" | "calls";   // nuevo
  filter?: string;                                   // "account_id=eq.<uuid>"
  onMessageEvent?; onConversationEvent?;
  onCallEvent?: (e: RealtimeEvent<Call>) => void;    // nuevo
  enabled?: boolean;
}
```

Compatibilidad: llamadas existentes (ej. `src/app/(dashboard)/inbox/page.tsx:344`) siguen igual — `table` y callbacks opcionales.

---

## 5. Settings — sección Voice

- **Archivo**: `src/components/settings/settings-sections.ts` — se agrega `voice` a `SETTINGS_SECTIONS` (hoy 11 secciones, grupo `workspace`).
- **Panel**: `src/app/(dashboard)/settings/page.tsx:72` — se agrega `voice` al `Record<SettingsSection, ReactNode>`.
- **Contenido del panel**:
  1. Config: pegar API key (botón "Guardar y verificar" → `POST /api/telnyx/config`).
  2. Números: lista vía `GET /v2/phone_numbers` (sin tabla local), botón "Comprar número" → `POST /api/telnyx/numbers/buy`.
  3. Por número: estado (`line_type`, `reputation_score`) + botón **"Verificar para WhatsApp"**.
  4. Checker: input número → `POST /api/telnyx/numbers/check` (lookup + reputation).

### 5.1 Flujo WhatsApp (1 número para todo) — **Fase 2**

> Nota: la verificación OTP del mismo número para WhatsApp es **post-MVP** (largo y manual, según §13). Se documenta como diseño de referencia; NO bloquea el flujo core (voz + SMS + email).

1. Usuario compra número (Telnyx) → queda en Telnyx (fuente de verdad).
2. UI: "Verificar para WhatsApp" → backend inicia verificación Meta (Embedded Signup) con ese E.164.
3. Meta envía OTP vía SMS → llega como `message.received` al webhook Telnyx.
4. Backend muestra el OTP en UI (o auto-inserta en `messages` con `channel='sms'`).
5. Usuario pega OTP → Meta verifica el número (estado en Telnyx/Meta, no en tabla local).
6. Mensajería WhatsApp sigue por `whatsapp_config` (Meta); voz/SMS por Telnyx. Sin conflicto.
7. Si Meta devuelve "número ya en WhatsApp": mensaje claro pidiendo desvincular la app de WhatsApp antes.

---

## 6. Guardrails (todos verificados/comprometidos)

| # | Guardrail | Estado |
|---|---|---|
| 1 | RLS en todas las tablas ANTES del primer INSERT | ✅ en 038/039/040 (ENABLE RLS + policies en telnyx_config, calls, email_config, email_templates) |
| 2 | `is_account_member(account_id, min_role)` siempre | ✅ función existe (`017:136`), se usa en las 4 tablas nuevas |
| 3 | `requireRole()` en rutas | ✅ (`account.ts:182`); `owner` para config/números, `agent` para call/token |
| 4 | Encriptación `encrypt()/decrypt()` para api_key | ✅ reutiliza `whatsapp/encryption.ts:37/50` |
| 5 | Validación firma webhook PRIMERO | ✅ patrón policyjar Ed25519 pre-DB |
| 6 | Service-role para webhook | ✅ `src/lib/telnyx/admin-client.ts` |
| 7 | `normalizePhone` único | ✅ **reutilizado** (`src/lib/whatsapp/phone-utils.ts:15`); no se crea módulo nuevo (KISS) |
| 8 | No logs con api_key ni tokens | ✅ regla: nunca loggear `api_key` / `sip_password` / `login_token` |
| 9 | Migraciones consecutivas | ✅ **038/039/040/041** (4, consecutivas; ver §0) |
| 10 | Colores por tokens, no hex | ✅ tokens `globals.css:8-50`; excepción `bg-green-600` documentada |

---

## 7. Testing (vitest, patrón existente)

| Archivo | Casos |
|---|---|
| `src/app/api/telnyx/config/route.test.ts` | sin api_key → 400; role < owner → 403; encripta y guarda |
| `src/app/api/telnyx/call/route.test.ts` | contacto de otra cuenta → 404; contacto válido → 200 |
| `src/app/api/telnyx/webhook/route.test.ts` | firma inválida → 403; timestamp viejo → 403; `call.answered` escribe `answered_at`; `call.hangup` escribe `ended_at`+`duration_sec` |
| `src/app/api/telnyx/numbers/check/route.test.ts` | número inválido → 400; score < 60 → bloqueo de compra |
| `src/components/voice/voice-window.test.tsx` | tabs (Contacts/Recent/Keypad), dial desde keypad, incoming (Accept/Reject), active (timer, End) |

Patrón de mockeo: `vi.mock("@/lib/auth/account")` para `requireRole`, mock de `admin-client`, mock de Telnyx API (`src/lib/telnyx/api.ts`). Env de test: `ENCRYPTION_KEY` dummy (ya en `vitest.config.ts`).

---

## 8. Checklist sin deuda (verificado contra el código)

- [x] RLS habilitado (patrón: las 36 tablas existentes lo tienen)
- [x] Policies con `is_account_member` (`017:136`)
- [x] `requireRole()` (`account.ts:182`, 30+ rutas lo usan)
- [x] Firma webhook validada (patrón policyjar verificado)
- [x] Service-role para webhook (patrón `automations/admin-client.ts`)
- [x] Credenciales encriptadas (`whatsapp/encryption.ts:37/50`)
- [ ] Test junto a route (patrón `tags/route.test.ts:1` vitest) → **se crean**
- [x] Normalización centralizada → **se reutiliza** `normalizePhone` (`whatsapp/phone-utils.ts:15`); el JOIN usa el índice `phone_normalized` existente (022)
- [x] Tablas separadas calls/messages (calls nueva; mezcla solo visual en UI)
- [x] Colores via theme tokens (`globals.css:8-50`)
- [x] **Grabaciones privadas** → bucket `call-recordings` no-público + proxy autenticado (única excepción al patrón público, justificada por privacidad). **Sin tabla `media`**: la URL vive en `calls.recording_url`, patrón WACRM actual
- [x] **Templates de email HTML full** → tabla `email_templates` (040): cuadro de texto, guardar, lista de nombres, seleccionable en automatizaciones
- [x] **UNA lógica de interpolación** → SMS/email importan `resolveVariables` (`use-broadcast-sending.ts:87`), mismo `VariableMapping` de broadcasts — sin 3ª sintaxis de templates (§9.3.1)

---

## 9. Integración full — Motor de automatizaciones (clave para reemplazar GHL)

> **Por qué existe esta sección:** el objetivo real del módulo NO es "hacer llamadas VoIP", es **reproducir la operación de GoHighLevel**: *missed call → seguimiento automático por SMS/WhatsApp/email*, llamadas salientes, secuencias. El motor de automatizaciones de WACRM ya existe y está auditado (`src/lib/automations/`); Telnyx y Resend se **enchufan** a él, no se construye nada paralelo.

### 9.1 Estado verificado del motor (evidencia real, no memoria)

| Pieza | Ubicación | Detalle |
|---|---|---|
| Tipos de trigger | `src/types/index.ts:432-442` | `AutomationTriggerType` = `'new_message_received' \| 'first_inbound_message' \| 'keyword_match' \| 'new_contact_created' \| 'conversation_assigned' \| 'tag_added' \| 'time_based' \| 'interactive_reply'` |
| Metadatos UI de triggers | `src/lib/automations/trigger-meta.ts:9-42` | `TRIGGER_META: Record<AutomationTriggerType, TriggerMeta>` con `label` + `pillClass` (Badge) |
| Tipos de step | `src/types/index.ts:444-457` | `AutomationStepType` = `'send_message' \| 'send_buttons' \| 'send_list' \| 'send_template' \| 'add_tag' \| 'remove_tag' \| 'assign_conversation' \| 'update_contact_field' \| 'create_deal' \| 'wait' \| 'condition' \| 'send_webhook' \| 'close_conversation'` |
| Dispatch (fire-and-forget) | `src/lib/automations/engine.ts:67` | `runAutomationsForTrigger(input: DispatchInput): Promise<void>` — nunca lanza, verifica tenencia del contacto (78-93), filtra por `account_id + trigger_type + is_active` (95-101), `triggerMatches` (109), `executeAutomation` (111) |
| Contexto del evento | `engine.ts:32-45` | `AutomationContext` = `{ message_text?, conversation_id?, vars?, tag_id?, agent_id?, interactive_reply_id? }` |
| DispatchInput | `engine.ts:47-57` | `{ accountId, triggerType, contactId?, context? }` |
| Eval de trigger | `engine.ts:658-690` | `triggerMatches(automation, ctx)` — casos especiales para `keyword_match`, `interactive_reply`, `tag_added`; **default `return true`** |
| Punto de entrada manual | `src/app/api/automations/engine/route.ts:27` | POST de prueba, `requireRole('agent')`, dispara cualquier trigger_type |
| Envío WhatsApp | `src/lib/automations/meta-send.ts` | `engineSendText / engineSendTemplate / engineSendInteractive` |
| Resumen de `wait` | `src/app/api/automations/cron/route.ts` | cron + `automation_pending_executions` |

### 9.2 Lo que falta para `missed_call` (cambio mínimo, 5 ficheros)

El motor acepta **cualquier** trigger_type en runtime (`triggerMatches` hace `return true` por defecto para los no especiales, y `runAutomationsForTrigger` filtra por string). **No requiere cambios en el engine** — solo registrar el tipo nuevo:

| # | Fichero | Cambio |
|---|---|---|
| 1 | `src/types/index.ts:432-442` | Añadir `\| 'missed_call'` a la unión `AutomationTriggerType` |
| 2 | `src/lib/automations/trigger-meta.ts:9-42` | Añadir `missed_call: { label: 'Missed Call', pillClass: 'border-red-500/30 bg-red-500/10 text-red-300' }` (Badge rojo = oportunidad de ingreso perdida) |
| 3 | `src/lib/automations/validate.ts` | Permitir `missed_call` como trigger válido (validación de schema del builder) |
| 4 | `src/app/api/telnyx/webhook/route.ts` (nuevo) | Al detectar `call.hangup` con `hangup_cause` de no-answer → `await runAutomationsForTrigger({ accountId, triggerType: 'missed_call', contactId, context })` |
| 5 | `src/components/automations/automation-builder.tsx:132` | Añadir `{ value: 'missed_call' }` a `TRIGGER_OPTIONS` — lista **hardcodeada** que alimenta el `<select>` del builder (`:831`), **no** se deriva de `TRIGGER_META`. Sin esto el trigger no aparece en la UI aunque el motor lo soporte (bug silencioso que pasa typecheck/build) |

> **Nota (hallazgo BDD):** `automation-builder.tsx` mantiene `TRIGGER_OPTIONS` separado de `TRIGGER_META`. Si se quiere una única fuente, alinear ambos en una refactor posterior — por ahora, el cambio mínimo es añadir el valor en ambos.

**Contexto a pasar en `AutomationContext` (extensión aditiva):**
```ts
// engine.ts:32-45 — se añaden campos opcionales (no rompe callers existentes)
interface AutomationContext {
  // ...campos actuales...
  call_id?: string
  call_direction?: 'inbound' | 'outbound'
  call_hangup_cause?: string   // 'user_busy' | 'no_answer' | 'normal' | ...
  missed_call_number?: string  // E.164 del que llamó (para el texto del seguimiento)
}
```
> La condición `message_content` (engine.ts:720) sigue funcionando con `message_text`; para seguimiento por tipo de perdida se usan las condiciones `condition` sobre `call_hangup_cause` vía el campo nuevo.

### 9.3 Steps nuevos para canal SMS y Email (integración full)

| Step nuevo | `AutomationStepType` | Implementación |
|---|---|---|
| `'send_sms'` | añadir en `src/types/index.ts:444-457` | llama a `src/lib/telnyx/api.ts` → `POST /v2/messages` con `messaging_profile_id` (Telnyx) |
| `'send_email'` | añadir en `src/types/index.ts:444-457` | llama a `src/lib/email/send.ts` → `resend.emails.send(...)` (ver §10) |

Ambos se registran en `engine.ts` como ramas nuevas de `executeAutomation` junto a `engineSendText` (imports en `engine.ts:24`), con su config type en `src/types/index.ts` (p.ej. `SendSmsStepConfig { text: string; variables?: Record<string, VariableMapping> }`, `SendEmailStepConfig { template: 'missed_call' | 'follow_up' | ...; variables?: Record<string, VariableMapping> }`) — variables reutilizando `resolveVariables` (ver §9.3.1).

### 9.3.1 Interpolación de variables — UNA fuente, no duplicar (KISS)

**Decisión (confirmada):** email y SMS **reutilizan `resolveVariables`** de `src/hooks/use-broadcast-sending.ts:87` — la misma función que ya usa broadcasts para personalizar mensajes. **No se crea una tercera sintaxis de plantillas** (WACRM ya tiene: posicional `{{1}}`/`{{2}}` para Meta, y `resolveVariables` para named fields).

Evidencia del campo real (verificado `use-broadcast-sending.ts:106-111`):
```ts
const fieldMap: Record<string, string | undefined> = {
  name:    contact.name,
  phone:   contact.phone,
  email:   contact.email,
  company: contact.company,
};
// + custom_field → customValues.get(v.value) ?? ''
```
La firma `resolveVariables(variables, contact, customValues?)` ya resuelve `static | field(name/phone/email/company) | custom_field`. **Decidir por campos, no por tablas**: el "ecosistema de campos" de un contacto (name/email/phone/company) es la fuente única, no importa si el destino es broadcast, SMS o email.

**Consecuencia en `SendSmsStepConfig` / `SendEmailStepConfig`:**
```ts
// NO: vars?: Record<string, string> con sintaxis inventada
// SÍ: se reutiliza el mismo VariableMapping de broadcasts
SendSmsStepConfig   { text: string; variables?: Record<string, VariableMapping> }
SendEmailStepConfig { template: string; variables?: Record<string, VariableMapping> }
```
- `engine.ts` importa `resolveVariables` (no lo copia) y lo aplica al `contact` que ya tiene el contexto de la automatización.
- Cero duplicación de lógica: 1 función, 4 campos + custom fields, usada por broadcasts, SMS y email.

#### 9.3.2 Flujo "disparar email por tag" (tag_added → send_email)

> Replica las **campañas** de GHL con la infraestructura de WACRM (sin construir nada paralelo).

```
1. En el builder de automatizaciones se crea: trigger_type='tag_added' + step 'send_email'
   (template = una `email_templates` seleccionada por name, §10.3).
2. Cuando se añade un tag a un contacto (desde la ficha, inbox, u otra automatización),
   WACRM ya llama `runAutomationsForTrigger({ triggerType: 'tag_added', contactId, context: { tag_id } })`
   — es un trigger EXISTENTE (`AutomationTriggerType` en types/index.ts), reutilizado tal cual.
3. El engine evalúa el step 'send_email' → carga `email_templates` por name → aplica
   `resolveVariables(variables, contact)` al `body_html` → `sendEmail({ to: contact.email, html, subject })`.
4. `contact.email` + variables se resuelven del contacto que ya está en el contexto (misma fuente que broadcasts).
```

- **Archivos de cambio** (mismo patrón que `missed_call`, §9.2): `validate.ts` (permitir `send_email` en builder), `engine.ts` (rama `send_email` → `email/send.ts`), y nada de dispatch nuevo (trigger `tag_added` ya dispara).

### 9.4 Flujo objetivo end-to-end (replica GHL)

```
1. Llamada entrante → Telnyx Call Control → POST /api/telnyx/webhook
2. call.initiated → INSERT calls(direction='inbound', from_number, to_number)  [service-role]
3. No contestas → call.hangup con hangup_cause no-answer → UPDATE calls(ended_at, duration_sec, hangup_cause, disposition='missed')
4. → runAutomationsForTrigger({ triggerType: 'missed_call', contactId, context: { call_id, missed_call_number } })
5. Motor ejecuta la automatización activa del account:
   a. step 'send_sms'   → Telnyx SMS: "Hola, vi tu llamada perdida…"  (elegir según hangup_cause con step 'condition')
   b. step 'send_email' → Resend: correo de seguimiento (template 'missed_call')
   c. step 'send_message' → WhatsApp (Meta) — opcional
   d. step 'create_deal' → opcional: abre deal en pipelines
   e. step 'wait' → secuencia de seguimiento con cron resume (motor ya existente)
6. Logs en automation_logs; estado en calls; UI Recent + inbox
```

---

## 10. Email — Resend (cierra el hueco GHL)

> **Hallazgo de auditoría:** WACRM **no tiene ninguna capacidad de email** (grep: sin nodemailer/sendgrid/resend/SES/SMTP, sin tabla `emails`, sin step `send_email`). GHL manda mails y secuencias → **sin email no se puede apagar GHL**. Solución vanilla e integrada: **Resend** (verificado en context7, `developers.resend.com`).

### 10.1 Por qué Resend (comparativa)

| Opción | Veredicto |
|---|---|
| **Resend** | ✅ 1 dep (`resend`), SDK Node, `emails.send({ html })`, webhooks con firma **Svix** verificada con `resend.webhooks.verify()`, entrega gestionada (SPF/DKIM) |
| Supabase Auth emails | ❌ solo auth (reset password), no transaccional/campañas |
| Edge Functions + Resend | ❌ Deno + deploy aparte + secretos en edge → más piezas móviles (deuda) |
| Nodemailer + SMTP propio | ❌ servidor SMTP + deliverability (SPF/DKIM/reputación) = mucho ops |
| SendGrid/SES raw | ❌ más config AWS/dominio; Resend es "pega 1 API key y funciona" |

### 10.2 Modelo — migración `040_email.sql` (definido en §2.3)

> Las 2 tablas del email (`email_config` 1:1 con accounts, y `email_templates` con HTML completo) se crean en la **migración `040_email.sql`** (ver §2.3 para el SQL completo y RLS). Aquí solo se resumen las decisiones de diseño:

| Tabla | Propósito | Columnas clave |
|---|---|---|
| `email_config` | API key Resend encriptada + remitente | `resend_api_key_encrypted`, `from_email`, `reply_to` |
| `email_templates` | HTML **completo** del template (copy/paste), disp. por nombre | `name` (único por account), `subject`, `body_html` |

> **Decisión de diseño (KISS):** el template se guarda como **HTML full** en `body_html` — el usuario **copia y pega sus templates HTML existentes** directamente, sin JSX/React Email ni compilación previa. `sendEmail` pasa ese HTML tal cual a `resend.emails.send({ html })`. Igual que elegir un template de broadcast por nombre, la automatización elige `email_templates` por `name`.

### 10.3 Rutas y lib (nuevos)

| Archivo | Función |
|---|---|
| `src/lib/email/send.ts` | `sendEmail({ accountId, to, subject, html, variables })` — desencripta key, aplica `resolveVariables` al HTML (reemplaza `{{nombre}}` etc.), `resend.emails.send({ html })`. ÚNICO punto de envío (reutilizado por engine + rutas) |
| `src/app/api/email/templates/route.ts` | CRUD de `email_templates`: `GET` lista nombres, `POST` crear/guardar (cuadro HTML), `DELETE`. `requireRole('agent')` read, `('owner')` write |
| `src/app/api/email/send/route.ts` | `requireRole('agent')`, body `{ contactId? | to?, template: name, variables }` → carga el `body_html` por nombre, aplica `resolveVariables`, envía. 400 sin template/to |
| `src/app/api/email/config/route.ts` | `requireRole('owner')`, `{ api_key, from_email }` → encrypt + upsert |
| `src/app/api/email/webhook/route.ts` | POST, verifica firma **Svix** con `resend.webhooks.verify()` (payload raw + headers `svix-id/timestamp/signature`), maneja `email.delivered` / `email.bounced` → actualiza estado (opcional v1) |

### 10.4 Webhook de eventos (firma Svix — fail-closed)

```ts
// src/app/api/email/webhook/route.ts — patrón verificado (context7)
const payload = await req.text();                       // SIEMPRE raw body
const id = req.headers.get('svix-id');
const timestamp = req.headers.get('svix-timestamp');
const signature = req.headers.get('svix-signature');
if (!id || !timestamp || !signature) return new NextResponse('Missing headers', { status: 400 });
const result = resend.webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret: process.env.RESEND_WEBHOOK_SECRET! });
```

### 10.5 Dependencias nuevas (total del módulo)

```jsonc
// package.json — añadir:
// Fase 1 (email core):
"resend": "^4"          // email — NUEVA dep a añadir (pnpm add resend); API `resend.emails.send` (SDK Node) verificada en context7 (resend.com/docs)
// Fase 2 (softphone WebRTC):
"@telnyx/webrtc": "^2.25.18"  // policyjar usa esta versión exacta
// NO react-email: los templates se guardan como HTML full (copy/paste) en email_templates.body_html
```

### 10.6 Env vars nuevas

```
RESEND_WEBHOOK_SECRET=...      // firma Svix (dashboard Resend)
// No se guarda RESEND_API_KEY en env: va encriptada en email_config (multi-account pattern).
// TELNYX_API_KEY tampoco: encriptada en telnyx_config.
```

---

## 11. Plan de implementación (orden atómico, 0 deuda)

| Paso | Archivos | Verificación |
|---|---|---|
| 1. Migraciones 038/039/040/041 + bucket `call-recordings` | `supabase/migrations/038_telnyx_config.sql`, `039_calls.sql`, `040_email.sql` (config + templates), `041_messages_channel.sql` + bucket `call-recordings` (privado) | apply vía MCP (1 a 1, verificando cada una) + RLS enabled + policies OK |
| 2. Reuso de `normalizePhone`/`isValidE164` (`src/lib/whatsapp/phone-utils.ts:15`) | 0 archivos nuevos (ya existe; usado por webhook WhatsApp/dedupe) | `pnpm test` + reutilizado en rutas/webhook |
| 3. `src/lib/telnyx/{api.ts,admin-client.ts}` | 2 archivos | unit test con api key mockeada |
| 4. `src/lib/email/send.ts` | 1 archivo | unit test con key mockeada (`resend.emails.send` mockeado); aplica `resolveVariables` al HTML (§9.3.1) |
| 5. `src/hooks/use-realtime.ts` generalizado | 1 archivo modificado | tests existentes de inbox siguen verdes |
| 6. Motor: trigger `missed_call` + steps `send_sms`/`send_email` | `src/types/index.ts`, `trigger-meta.ts`, `validate.ts`, `engine.ts`, `automation-builder.tsx` (TRIGGER_OPTIONS), `meta-send`/`email/send` (importa `resolveVariables`, sin copiar) | typecheck + tests engine existentes verdes |
| 7. Rutas API Telnyx fase 1 (config, numbers/buy, numbers/check, call, webhook) | 5 rutas + 4 test | `pnpm test` + curl firma |
| 8. Rutas API Email (config, send, templates CRUD, webhook Svix) | 4 rutas + 4 test | `pnpm test` + curl firma Svix |
| 9. Softphone WebRTC (**fase 2**): ruta `/token` + `src/hooks/use-telnyx.ts` | 1 ruta (`/token`, 1 test) + 1 archivo (`use-telnyx.ts`) | `pnpm test` + integración manual (HTTPS) |
| 10. UI `src/components/voice/*` (**fase 2** — softphone; fase 1: solo botón llamar en contacto) | 5-6 archivos | test de componentes |
| 11. Settings secciones `voice` + `email` (incl. editor email_templates HTML) | 2-3 archivos modificados (`settings-sections.ts`, `settings/page.tsx`) | `pnpm build` + `pnpm dev` |
| 12. Proxy grabaciones (**fase 2**) | `GET /api/telnyx/recordings/[callId]` (signed URL corta, `requireRole`) | unit test (proxy solo con rol válido) |
| 13. Commit + push | branch `feat/telnyx-voice-calls` → `main` (fork `Dacasan/wacrm`) | build + typecheck + grep residual |

**Verificación final**: `pnpm typecheck`, `pnpm build`, `pnpm test`, grep de `#[0-9a-f]{6}` en componentes nuevos (0 hex hardcodeado), grep residual de `api_key`/`sip_password`/`login_token` en logs.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| API de Reputation Database no 100% documentada | Fallback: `number_lookup` (carrier/line_type) como gate mínimo; `reputation_score` nullable |
| `use-realtime.ts` generalización rompe inbox | Parametrización aditiva + tests existentes |
| Softphone WebRTC en dev sin cert válido | **Fase 2** (MVP usa forward a móvil); si se hace, documentar `ngrok`/HTTPS para WebRTC; SIP necesita dominio seguro |
| Número ya vinculado a WhatsApp | Flujo de error claro pidiendo desvincular primero; validar con Telnyx/Meta si el mismo E.164 puede ser voz-Telnyx + WhatsApp a la vez (si no, usar números separados) |
| Grabaciones ocupan Storage + privacidad | Retención: `recording_url` firmada con expiración 5 min; job de purga/archivo quincenal de grabaciones >N meses; bucket privado (único no-público) |
| **Missed-call no dispara** (perdida de ingreso) | Webhook Telnyx con retry/idempotencia (`ON CONFLICT` + dedup por id de mensaje/call_id en logs); `runAutomationsForTrigger` fire-and-forget que nunca lanza (engine.ts:67-119); logs en `automation_logs` |
| **Email no entregado** (cliente no recibe seguimiento) | Paso OBLIGATORIO de setup: verificación del dominio en Resend (registros TXT **SPF + DKIM + DMARC**) ANTES de apagar GHL + correo de prueba; webhook `email.bounced` actualiza estado; `from_email` verificado |
| **Forward a móvil falla** (móvil apagado/ocupado → cliente perdido) | Fallback en Telnyx: 2º destino o salto a voicemail configurado en la Call Control App; health-check del webhook; alerta al operador si no se reciben eventos |
| **Se rompe la operación GHL durante transición** | Paralelo: WACRM nuevo + GHL activo hasta validar llamadas reales; luego migración de contactos/historial (CSV/API) — no arranque en vacío si GHL tenía historial |
| Firma webhook Telnyx/Resend mal implementada | Validación ANTES de DB (patrón WhatsApp `webhook-signature.ts:21-47` fail-closed), tests `route.test.ts` con firma inválida → 403 |

---

## 13. Corte MVP y roadmap por fases (no romper la operación)

> **Principio:** se publica lo que **resuelve el flujo de dinero** (missed-call → seguimiento, llamadas reales) primero, y lo **bonito pero caro** (softphone WebRTC) después. Validación en paralelo con GHL hasta confirmar llamadas reales.

### Fase 1 — MVP (P0, va primero)

| Entregable | Archivos | Valor |
|---|---|---|
| Migraciones 038-041 + bucket `call-recordings` | 4 SQL (privado) | Schema completo (telnyx_config, calls, email config+templates HTML, messages.channel) |
| Voz inbound/outbound **forward a móvil** | `telnyx/api.ts`, `calls`, rutas `config`/`call`/`webhook` | Recibir/hacer llamadas reales SIN WebRTC |
| Números + compliance | `GET/POST /v2/phone_numbers` y `numbers/buy`/`numbers/check` (sin tabla local) | Comprar/verificar números |
| **Trigger `missed_call`** | `types/index.ts`, `trigger-meta.ts`, `validate.ts` + dispatch en webhook | Seguimiento automático (el flujo GHL) |
| **Step `send_sms`** | Telnyx messaging | SMS de seguimiento |
| **Email (Resend + templates HTML)** | `email/send.ts`, `email_templates` CRUD, rutas `config`/`send`/`templates`, migración 040 | Mails + secuencias (gap GHL) — copy/paste de HTML propio |
| **Step `send_email`** | `types/index.ts` + `engine.ts` | Email dentro de automatizaciones |
| Lista de llamadas recientes (**ver historial sin esperar Fase 2**) | `src/components/inbox/contact-sidebar.tsx` (account_id + contact_id por `initiated_at desc`) | Ver el historial real desde el día 1 (no operar a ciegas) |
| Settings `voice` + `email` | `settings-sections.ts`, `settings/page.tsx` | Config UI |
| Tests | `route.test.ts` × rutas | Calidad |

**Criterio de salida Fase 1:** llamada real entrante → cuelga → llega SMS y email de seguimiento automático. Se apaga GHL de llamadas/email.

> **Notificaciones `missed_call` (campanita): NO en Fase 1.** El sistema `notifications` hoy solo soporta `type = 'conversation_assigned'` (`027_notifications.sql:10` CHECK) y las filas se crean **solo** por función SECURITY DEFINER (sin policy de INSERT de cliente, `027:36-37`). Llevarlo sería una migración extra (ampliar CHECK + nueva función/trigger). En Fase 1 el `missed_call` se ve en la lista de llamadas del sidebar + `automation_logs`. Se sube de nivel post-MVP.

### Fase 2 — Post-MVP

| Entregable | Archivos |
|---|---|
| Softphone WebRTC en navegador | `use-telnyx.ts`, `components/voice/*` (~520 líneas esenciales de policyjar) |
| Grabaciones reales (proxy autenticado) | `recording.saved` → `call-recordings` (privado) → `calls.recording_url` = `GET /api/telnyx/recordings/[callId]` (§2.4) |
| Verificación WhatsApp (OTP) del mismo número | UI + flujo Meta (largo, manual) |
| Notificaciones `missed_call` en la campanita | migración extra: ampliar `CHECK (type IN (...))` de `notifications.type` (`027:10`) + nueva función/trigger SECURITY DEFINER (hoy solo `conversation_assigned`) |

### Lo que NO se hace nunca (bloat confirmado)

IVR, ACD/colas, whisper/barge, campañas, power dialer, RTB/Ringba, DNC/TCPA, Redis/BullMQ, Stripe, Supabase Auth emails.

---

*Documento generado con evidencia real del repo. Ver: `src/hooks/use-realtime.ts`, `src/lib/auth/account.ts`, `supabase/migrations/017_account_sharing.sql`, `src/app/globals.css`, `src/lib/whatsapp/encryption.ts`, `src/lib/automations/engine.ts`, `src/lib/automations/trigger-meta.ts`, `src/types/index.ts`, `docs/public-api.md`, `docs/docker.md`.*

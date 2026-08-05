# Módulo Analytics — Revenue Engine (Landing + Atribución DOM + Eventos)

Especificación de diseño y arquitectura (DAD) — nivel DevOps
Repo: wacrm. Rama: main (pendiente feat/revenue-engine-analytics).
Status: **v8** — + auditoría cruzada (4 agentes): "usar lo que ya existe". tracking_events reducido, Cola de Hoy sobre el overview actual, lead vía /api/v1/contacts existente, secuencias de email con cero motor nuevo, 3 correcciones de la spec. Migración `047_analytics.sql` escrita y lista para aplicar (NO aplicada aún).

---

## 0. Resumen ejecutivo

WACRM es el Revenue Engine. La landing Astro es el home (`/`), wacrm vive en `/dashboard`, y la página post-form es `/thank-you` (con `?lead=1`). Cero PHP: toda la lógica de atribución dispersa en scripts heredados se descarta como código y se re-traduce a TypeScript en nuestro stack, rescatando el **concepto**.

El corazón es la **atribución por el DOM**: el navegador es la única pieza que ve el query string de entrada (`gclid`, `fbclid`, `ttclid`, UTM…) y el referrer. Ese primer contacto se persiste **90 días cross-session** (localStorage con TTL + cookie mirror + cookie compuesta `wacrm_attr`) y viaja con el formulario en hidden fields. El **ref_code** (código de 6 chars) ata conversiones offline — un WhatsApp, una llamada — al canal de origen. Y cuando la conversión nace en un anuncio **Click-to-WhatsApp de Meta**, el propio `ctwa_clid` del webhook cierra el ciclo server-side sin depender del navegador (§2.3). Sin esto no sabes qué campaña trajo a quién.

**Filosofía (confirmada por el dueño):**
1. Máquina de estados **NO bloquea** — prioriza; la card (fit + prioridad + siguiente acción) es el producto.
2. Los **12 estados del pipeline son configurables** por pipeline (`guard_rules` JSONB); el spec de 12 estados que sigue es el template preconfigurado.
3. El **score es un feature, no core** — vive detrás de los eventos de cualificación (good/better lead), no los define.
4. Landing Astro = home `/`; wacrm = `/dashboard`; post-form = `/thank-you`.
5. Cero PHP — solo se traduce el concepto.
6. KISS: **usar lo que ya existe** (auditoría v8): ActivityFeed ya es timeline, automations ya hacen secuencias de email, `/api/v1/contacts` ya ingesta leads, broadcasts ya miden campañas. **1 tabla nueva** (`tracking_events`, reducida), columnas aditivas, 1 VIEW, 0 tablas espejo.
7. Inspiración Mautic: adoptamos timeline único, identidad de visitante con merge anónimo→conocido, exclusión de tráfico interno (P0); y en Fase 2 campañas de seguimiento, decisions por comportamiento y frequency rules (ver §8).
8. La card muestra **info, no score** (diferenciador del producto); el reporting, el email (secuencias + visor + reactivación) y la landing completa van en código (§3, §7.6, §7.7).

---

## 0.5 Lo que YA existe en wacrm vs lo que falta (auditoría cruzada — 4 agentes)

**Regla del dueño: "tal vez no son los nombres pero sí existen los campos y las tablas — usemos lo que ya tiene wacrm sin crear cosas de nuevo."** Verificado contra código real:

### Reutilizar (NO construir)

| Propuesta del MD | Ya existe en wacrm | Evidencia |
|---|---|---|
| Timeline único (`tracking_events` para todo) | **ActivityFeed** mergea messages+contacts+deals+broadcasts+automation_logs en feed cronológico con deep-links | `src/lib/dashboard/queries.ts:268-398` (loadActivity), `src/components/dashboard/activity-feed.tsx` |
| Secuencias de email (motor nuevo) | Motor de **automations** ya tiene steps `send_email` + `wait` + cron de reanudación (`automation_pending_executions`) → `[send_email, wait, send_email]` modelable HOY | `src/lib/automations/engine.ts:293-319` (wait), `:453-476` (send_email), `src/app/api/automations/cron/route.ts:18-71` |
| Ingest de leads (`/api/events` para el form) | **`POST /api/v1/contacts`** con API key, find-or-create por teléfono, rate-limit | `src/app/api/v1/contacts/route.ts:96-148`, `src/lib/auth/api-context.ts:80-118` |
| Base de campañas | **Broadcasts**: audiencias + contadores incrementales O(1) + replied por webhook (correlación wamid) | `src/lib/whatsapp/broadcast-core.ts`, migración `005_broadcast_counts_incremental.sql:36-99` |
| Máquina de estados completa desde cero | El kanban YA es el "estado": `deals.stage_id` → `pipeline_stages.name` (5 stages seed) + `deals.status` open/won/lost | `src/app/(dashboard)/pipelines/page.tsx:40-46` (SPEC_DEFAULT_STAGES), `:217-233` (handleDealMoved) |
| "Última interacción" de la card | `conversations.last_message_at` + `last_message_text` ya existen y se usan | schema real + `src/components/inbox/conversation-list.tsx:101,447` |
| RLS/seguridad | `is_account_member` (017:136), patrón de contadores por trigger (005:36-99), patrón de lock/claim (`claim_ai_reply_slot` 029:118) | migraciones 017/005/029 |
| Envío de email real | **Resend** ya envía con templates interpoladas desde `email_templates` | `src/lib/email/send.ts:34-81`, `engine.ts:453-476` |

### Gaps reales (esto SÍ hay que construir — no existe equivalente)

1. `deals.score / tags / priority / version / won_at / lost_at` — deals NO tiene nada de esto (schema verificado).
2. `contacts.attribution` (UTM/click_ids/ref_code/visitor_id) — búsqueda negativa: `ref_code|utm_|attribution|visitor_id|gclid|fbclid|ctwa` no aparece en `src/`.
3. `pipeline_stages.guard_rules` — stages solo tienen `name/position/color`.
4. `email_sends` — el email enviado **NO se persiste** (ni subject, ni html renderizado, ni resend_message_id); webhook de Resend es stub (solo ack + console.log, sin Svix).
5. `tracking_events` (reducida) — los eventos sin hogar (anónimos de la landing, `state_changed`, `score_changed`, `identity_merged`) no tienen dónde vivir.
6. Captura de `referral.ctwa_clid` en el webhook de WhatsApp — hoy se pierde para siempre (grep sin hallazgos).
7. Rutas `/api/events`, `/api/track`, `/api/analytics/*`, `/api/report/*` — no existen (0 archivos).
8. **Cola de Hoy** — no existe en ninguna forma (ni componente, ni campos de prioridad/urgencia, ni tabla de tareas).

### 3 correcciones de la spec v7 (errores detectados por los agentes)

1. **Dedup wamid**: la v7 decía "ya existe en el schema (003)" → **FALSO para `messages`**: `messages.message_id` es TEXT con índice NO único (`001:172`); el UNIQUE de 003 es solo de `broadcast_recipients.whatsapp_message_id`. La idempotencia app-level solo existe en el runner de flows (por `meta_message_id`). **Fix**: dedup por `message_id` en el handler del webhook (app-level) o índice único parcial (igual que 046 para SMS).
2. **`getServiceClient` no existe**: el patrón real es `supabaseAdmin()` por módulo con `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/automations/admin-client.ts`, `src/lib/flows/admin-client.ts`, webhook WhatsApp `route.ts:26-34`). Fix: usar ese patrón.
3. **Ruta del webhook**: es `/api/whatsapp/webhook`, NO `/api/webhooks/whatsapp`.

---

## 1. Arquitectura — una sola app

```
┌──────────────────────────────────────────────────────────┐
│  wacrm (Next.js 16 + Supabase) — UN deploy               │
│  /              → landing Astro (home, estático)         │
│  /thank-you     → página post-form (?lead=1)             │
│  /dashboard/*   → wacrm (sin cambios)                    │
│  /god.js        → script de atribución (bundled TS)      │
│  /api/track     → beacon (clicks/scroll, anónimo)        │
│  /api/events    → enrutador de eventos (reducido §4)     │
│  /api/v1/contacts → ingest lead (EXISTE, se reutiliza)   │
│  /api/analytics/* → panel + exports OCI/ECL              │
└──────────────────────────────────────────────────────────┘
```

**Integración Astro ↔ Next (verificada en docs oficiales):**
- Monorepo pnpm (ya es workspace): se añade `landing/` (Astro estático). Build: `astro build` → copia `dist/` a `public/landing/`.
- `next.config.ts` — añadir `rewrites() { beforeFiles }` (se evalúan antes que el filesystem, permiten sobreescribir páginas):

```ts
async rewrites() {
  return { beforeFiles: [
    { source: '/',          destination: '/landing/index.html' },
    { source: '/thank-you', destination: '/landing/thank-you.html' },
  ] }
}
```

- `src/app/page.tsx`: eliminar el `redirect('/dashboard')` (hoy línea 4). `/dashboard` no se toca (el middleware ya lo protege sin afectar `/`).
- El cache `public, max-age=0, s-maxage=300, stale-while-revalidate=86400` existente sirve bien la landing; el CSP actual (`form-action 'self'`) ya permite el POST del formulario al mismo dominio. Sin cambios en security headers.
- Formulario: POST al mismo dominio (`/api/v1/contacts` con API key + un evento en `/api/events`) — cero llamadas a terceros desde el front.
- **Cliente Supabase**: usar el patrón real `supabaseAdmin()` por módulo (NO existe `getServiceClient`).

---

## 2. Atribución por DOM — el motor

Por qué es la genialidad: el servidor solo ve lo que el cliente le manda. El navegador, en el primer render, tiene en el DOM (`location.search` + `document.referrer`) la verdad completa de cómo llegó el usuario. El script la captura antes de que se pierda, la persiste 90 días y la re-inyecta en cada formulario y cada click.

### 2.1 El módulo puro — `src/lib/analytics/attribution.ts`

```ts
// ============================================================
// Atribución — lógica pura (sin DOM), testeable con vitest.
// Concepto traducido del script de atribución por DOM cross-session.
// ============================================================

export const UTM_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

export interface ClickIds {
  gclid?: string; gbraid?: string; wbraid?: string;
  fbclid?: string; msclkid?: string; ttclid?: string;
  li_fat_id?: string; gad_source?: string;
  ctwa_clid?: string;  // SOLO server-side: llega en el webhook de WhatsApp (referral del 1er mensaje), no en el DOM
}

export interface Attribution {
  utm: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  click_ids: ClickIds;
  channel?: string;    // google|bing|tiktok|linkedin|facebook|instagram|organic|social|direct
  medium?: string;     // cpc|organic|social|none
  landing_slug: string;
  ref_code?: string;
  first_seen?: number;
  last_touch?: number;
  event_id?: string;
  consent?: string;    // hook Consent Mode (ad_storage)
}

// 13 campos leídos del query string
const URL_FIELDS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "gclid","gbraid","wbraid","fbclid","msclkid","ttclid","li_fat_id","gad_source"] as const;

/** 1. Captura del query string — el DOM es la fuente de verdad */
export function parseUrlParams(search: string): Partial<Attribution> {
  const p = new URLSearchParams(search);
  const utm: Attribution["utm"] = {};
  const click_ids: ClickIds = {};
  for (const f of URL_FIELDS) {
    const v = p.get(f);
    if (!v) continue;
    if (f.startsWith("utm_")) utm[f.replace("utm_", "") as keyof typeof utm] = v;
    else click_ids[f as keyof ClickIds] = v;
  }
  const out: Partial<Attribution> = {};
  if (Object.keys(utm).length) out.utm = utm;
  if (Object.keys(click_ids).length) out.click_ids = click_ids;
  return out;
}

/** 2. Mapeo clid → canal (Google te da gclid, no utm) */
export function mapClickIdToChannel(ids: ClickIds): string | undefined {
  if (ids.gclid || ids.gad_source) return "google";
  if (ids.msclkid) return "bing";
  if (ids.ttclid) return "tiktok";
  if (ids.li_fat_id) return "linkedin";
  return undefined;
}

/** 3. Mapeo referrer → canal (cuando no hay ads, el referrer cuenta la historia) */
export function mapReferrerToChannel(referrer: string): { channel: string; medium: string } | undefined {
  const r = referrer.toLowerCase();
  if (r.includes("google.")) return { channel: "google", medium: "organic" };
  if (r.includes("bing."))   return { channel: "bing", medium: "organic" };
  if (r.includes("facebook.") || r.includes("fb.com"))  return { channel: "facebook", medium: "social" };
  if (r.includes("instagram.")) return { channel: "instagram", medium: "social" };
  if (r.includes("linkedin."))   return { channel: "linkedin", medium: "social" };
  if (r.includes("t.co") || r.includes("twitter.")) return { channel: "twitter", medium: "social" };
  return undefined;
}

/** 4. Compone la atribución completa — el contrato DOM → cookie → server */
export function buildAttribution(input: {
  search: string; referrer: string; landingPath: string;
  existing?: Partial<Attribution>; consent?: string;
}): Attribution {
  const url = parseUrlParams(input.search);
  const clickIds = url.click_ids ?? {};
  const ref = mapReferrerToChannel(input.referrer);
  const channel =
    mapClickIdToChannel(clickIds) ??      // 1º: click id de ads (el más preciso)
    url.utm?.source ??                    // 2º: utm explícito
    ref?.channel ??                       // 3º: referrer
    "direct";
  const medium =
    clickIds.gclid || clickIds.msclkid || clickIds.ttclid || clickIds.li_fat_id ? "cpc"
    : url.utm?.medium ?? ref?.medium ?? "none";
  return {
    utm: url.utm ?? {},
    click_ids: clickIds,
    channel, medium,
    landing_slug: input.landingPath.replace(/^\/|\/$/g, "") || "home",
    ref_code: input.existing?.ref_code ?? genRefCode(),
    first_seen: input.existing?.first_seen ?? Date.now(),
    last_touch: Date.now(),
    event_id: input.existing?.event_id ?? genEventId(),
    consent: input.consent,
  };
}

/** 5. ref_code: ata una conversión OFFLINE (WhatsApp/tel) al canal de origen */
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I/L/O/0/1 (legibilidad)
export function genRefCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += REF_CHARS.charAt(Math.floor(Math.random() * REF_CHARS.length));
    if (i === 2) code += "-";
  }
  return code;
}

/** 6. event_id: dedup universal (Meta + Google + nuestra tabla) */
export function genEventId(): string {
  return "a" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}
```

### 2.2 El script de browser — `src/lib/analytics/god.ts` (bundled a `/god.js`)

```ts
// ============================================================
// Script de atribución (browser). Se bundlea a public/god.js
// en build. Atribución cross-session 90d.
// ============================================================
import { UTM_TTL_MS, genRefCode, genEventId, type Attribution } from "./attribution";

const KEY = (k: string) => `_exp_${k}`; // claves de expiración

/** localStorage con TTL 90d — sobrevive el cierre del navegador */
export function utmSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(KEY(key), String(Date.now() + UTM_TTL_MS));
    localStorage.setItem(key, value);
  } catch {}
}
export function utmGetItem(key: string): string | null {
  try {
    const exp = localStorage.getItem(KEY(key));
    if (exp && Date.now() > parseInt(exp, 10)) {
      localStorage.removeItem(key); localStorage.removeItem(KEY(key));
      return null;
    }
    return localStorage.getItem(key);
  } catch { return null; }
}

/** Cookie mirror — el server lee la atribución sin JS (path=/, 90d, SameSite=Lax) */
export function setCookieMirror(fields: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(fields)) {
    if (!v) continue;
    try { document.cookie = `${k}=${encodeURIComponent(v)};path=/;max-age=${90*24*60*60};SameSite=Lax`; } catch {}
  }
}

/** Cookie compuesta wacrm_attr (JSON) — first_seen/last_touch/landing/ref_code */
export function readAttrCookie(): Partial<Attribution> {
  try {
    const raw = document.cookie.split("; ").find(r => r.startsWith("wacrm_attr="));
    return raw ? JSON.parse(decodeURIComponent(raw.split("=")[1])) : {};
  } catch { return {}; }
}
export function writeAttrCookie(attr: Attribution): void {
  try {
    document.cookie = `wacrm_attr=${encodeURIComponent(JSON.stringify(attr))};path=/;max-age=${90*24*60*60};SameSite=Lax`;
  } catch {}
}

/** Identidad de visitante (inspiración Mautic device_id): uuid persistente
 *  en localStorage + cookie first-party 1 año. Permite unir visitas
 *  cross-session y reasignarlas al contacto al identificarse (merge). */
export function getVisitorId(): string {
  const COOKIE = "wacrm_visitor";
  const LS = "_wacrm_visitor";
  try {
    const ls = localStorage.getItem(LS);
    if (ls) { setCookieFirstParty(COOKIE, ls, 365); return ls; }
    const c = document.cookie.split("; ").find(r => r.startsWith(COOKIE + "="));
    if (c) { localStorage.setItem(LS, c.split("=")[1]); return c.split("=")[1]; }
  } catch {}
  const id = crypto.randomUUID?.() ?? genEventId();
  try { localStorage.setItem(LS, id); } catch {}
  setCookieFirstParty(COOKIE, id, 365);
  return id;
}
function setCookieFirstParty(name: string, value: string, days: number): void {
  try { document.cookie = `${name}=${value};path=/;max-age=${days*24*60*60};SameSite=Lax`; } catch {}
}

/** Rellena hidden inputs del formulario con la atribución (el viaje al server) */
export function fillHiddenInputs(form: HTMLFormElement, attr: Attribution): void {
  const set = (name: string, v?: string) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (input && v) input.value = v;
  };
  set("utm_source", attr.utm.source); set("utm_medium", attr.utm.medium);
  set("utm_campaign", attr.utm.campaign); set("utm_term", attr.utm.term);
  set("utm_content", attr.utm.content);
  for (const [k, v] of Object.entries(attr.click_ids)) set(k, v);
  set("landing_slug", attr.landing_slug);
  set("ref_code", attr.ref_code);
  set("event_id", attr.event_id);
  set("channel", attr.channel); set("medium", attr.medium);
  set("visitor_id", getVisitorId());
}

/** Init idempotente: captura DOM → persiste → rellena forms → dataLayer page_view */
export function initAttribution(): void {
  const existing = readAttrCookie();
  const attr = buildAttribution({
    search: location.search,
    referrer: document.referrer,
    landingPath: location.pathname,
    existing,
    consent: (window as any).getConsent?.("ad_storage") ?? "granted",
  });
  // persiste campos individuales (mirror) + cookie compuesta
  setCookieMirror({ ...attr.utm, ...attr.click_ids });
  writeAttrCookie(attr);
  utmSetItem("ref_code", attr.ref_code!);
  // hidden inputs ya presentes en el DOM
  document.querySelectorAll("form:not([data-no-track])").forEach(f => fillHiddenInputs(f, attr));
  // dataLayer page_view (compat GTM)
  (window as any).dataLayer ??= [];
  (window as any).dataLayer.push({ event: "page_view", ...attr, landing_slug: attr.landing_slug, event_id: attr.event_id });
}
```

**Beacon de clicks** (el ref_code viaja en el texto pre-rellenado del WhatsApp):

```ts
/** En clicks a wa.me / tel: → dataLayer + sendBeacon a /api/track (anon, ref_code) */
export function wireClickBeacons(siteUrl: string): void {
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    const wa = target.closest('a[href*="wa.me"], a[href*="whatsapp.com"]');
    const tel = target.closest('a[href^="tel:"]');
    if (!wa && !tel) return;
    const attr = readAttrCookie();
    const type = wa ? "whatsapp" : "phone";
    (window as any).dataLayer?.push({ event: wa ? "whatsapp_click" : "phone_click", href: wa?.href ?? tel?.href, event_id: attr.event_id });
    if (navigator.sendBeacon) {
      const qs = new URLSearchParams({ type, ref: attr.ref_code ?? "", landing: location.pathname, event_id: attr.event_id ?? "" });
      navigator.sendBeacon(`${siteUrl}/api/track?${qs}`, "");
    }
  }, true);
}
```

**Enlace click-to-WhatsApp** (la landing lo genera): el `ref_code` y el `visitor_id` no caben en `wa.me` (solo acepta `text`), así que el código se incrusta en el mensaje pre-rellenado y es el **puente offline** para el tráfico que no viene de anuncios de Meta:

```
https://wa.me/<tel>?text=Hola%2C%20vengo%20del%20sitio%20(c%C3%B3digo%20XX7-8XK)
```

El router de entrada de WhatsApp parsea el patrón `/([A-Z0-9]{3}-[A-Z0-9]{3})/` del texto entrante → resuelve `ref_code` → atribuye la conversión al canal de origen (first-touch) y hace merge con `visitor_id` si el beacon ya lo registró.

**PERO si el clic viene de un anuncio Click-to-WhatsApp de Meta, ni `ref_code` ni `visitor_id` hacen falta:** el primer mensaje entrante llega con un objeto `referral` en el webhook de WhatsApp Cloud API que contiene `ctwa_clid` (el click ID único de Meta, generado en el momento del tap en el anuncio). Se captura UNA sola vez — el segundo mensaje ya no lo trae — y con él se cierra el ciclo vía CAPI (§2.3).

### 2.3 Identity Resolution — Visitor ≠ Contact (el modelo)

> **Co-diseñado con el dueño.** Es la arquitectura de Mautic traducida a nuestro stack y extendida con los click IDs de ads. La idea central: **el tracking NO pertenece al contacto — pertenece al visitante (la identidad). El contacto es solo la representación de negocio de esa identidad.**

**Por qué:** la mayoría de los CRMs hacen `formulario → crear contacto → empezar historial` y pierden todo lo que pasó ANTES del formulario. Nosotros (como Mautic) acumulamos comportamiento anónimo primero, resolvemos identidad después, y nada se pierde.

```
Anuncio → Click (UTMs + gclid/fbclid/msclkid/ttclid) → Cookie (visitor_id)
  → Navegación (tracking_events anónimos) → Formulario/WhatsApp (identificación)
  → Merge → Contacto → Timeline completo → Atribución → Campañas
```

**Identificadores que conoce la identidad** (todos en JSONB — sin tabla nueva):

| Identificador | Origen | Dónde vive | Rol |
|---|---|---|---|
| `visitor_id` (browser cookie) | `god.js` | `tracking_events.attribution` + `contacts.attribution` | Une visitas anónimas cross-session |
| WhatsApp number | Webhook WhatsApp Cloud API | contacto (dedup único de negocio) | Merge principal |
| Email | Formulario | contacto | Merge secundario |
| Phone | Formulario | contacto | Merge secundario |
| `gclid`/`gbraid`/`wbraid` | query string (DOM) | `attribution.click_ids` | Atribución Google Ads |
| `fbclid` | query string (DOM) | `attribution.click_ids` | Atribución Meta (web) |
| `msclkid`/`ttclid`/`li_fat_id` | query string (DOM) | `attribution.click_ids` | Atribución Bing/TikTok/LinkedIn |
| `ctwa_clid` | **webhook WhatsApp (`referral` del 1er mensaje)** | `attribution.click_ids` | Atribución Meta CTWA (server-side, sin navegador) |
| `ref_code` | generado en `god.js`, viaja en el texto del WhatsApp | `attribution.ref_code` | Puente offline genérico (orgánico/directo) |
| Customer ID | `deals`/pagos | contacto/deal | Cierre del ciclo (recompra) |

**Merge (identity resolution) — 3 vías, todas idempotentes:**
1. **Formulario** con `visitor_id` + email/phone → `UPDATE tracking_events ... WHERE attribution->>'visitor_id' = $1` reasigna el historial anónimo al contacto (first-touch intacto).
2. **Webhook WhatsApp entrante** con teléfono (y/o `ref_code` en el texto) → mismo merge por teléfono.
3. **Webhook WhatsApp con `referral.ctwa_clid`** → guardar `ctwa_clid` en `attribution.click_ids` y disparar CAPI `Lead` con `action_source: "business_messaging"` (cierra el ciclo clic→conversación sin depender del navegador).

**El visitante anónimo que nunca se identifica** sigue existiendo: `tracking_events` agrupados por `visitor_id` muestran "visitó 12 veces, vio Pricing, vino de Google" — sin nombre, pero con todo el comportamiento. No se descarta.

**Cambio de dispositivo:** nuevo `visitor_id` → nuevo visitante anónimo. Si luego se identifica con el mismo teléfono/email, el merge une ambos historiales en el mismo contacto.

**`ctwa_clid` es el cierre del ciclo en Meta (verificado en docs oficiales):**
- El clic en un anuncio Click-to-WhatsApp no pasa por landing ni formulario: WhatsApp se abre directo. Sin `ctwa_clid`, ese gasto publicitario es una caja negra.
- Meta lo inyecta en el objeto `referral` del primer mensaje entrante; hay que capturarlo en el momento o se pierde para siempre.
- Para reportar la conversión: POST a CAPI con `action_source: "business_messaging"` + `messaging_channel: "whatsapp"` + `user_data.ctwa_clid` + `user_data.ph` (sha256 del teléfono). Con `action_source: "website"` **no** asocia el evento al anuncio (error más común).
- `event_name` por defecto para CTWA: `Lead`. Luego `Purchase`/`AppointmentBooked` con `custom_data.value` cuando la venta/cita ocurre en el CRM.

**Implementación en el webhook real (`/api/whatsapp/webhook`):** en el procesado del primer mensaje (hoy `route.ts:662-683` inserta en `messages`), leer `entry[].changes[].value.messages[0].referral` → si tiene `ctwa_clid`, persistirlo en `tracking_events` (`ctwa_lead`) y en `contacts.attribution.click_ids` del contacto recién creado/resuelto, y disparar CAPI (idempotente por `event_id`).

---

## 3. Landing Astro (solo frontend — home del Revenue Engine)

### 3.1 Estructura de archivos (todo en código)

```
landing/                          # paquete Astro estático (workspace pnpm)
  astro.config.mjs                # base: '/landing'  ← CRÍTICO (assets _astro/* bajo /landing/)
  package.json                    # astro, tailwind, web-vitals, @justinribeiro/lite-youtube
  src/
    layouts/BaseLayout.astro      # god.js (is:inline) + initAttribution() + wireClickBeacons()
    pages/index.astro             # home: Hero, SocialProof, Especialidades, CómoFunciona, Video, FAQ, Form
    pages/thank-you.astro         # /thank-you?lead=1 → evento form_submit (dedup por event_id)
    components/
      LeadForm.astro              # form + hidden fields + fetch JSON a /api/events → redirect
      WhatsAppCta.astro           # wa.me?text=...ref_code (lee ref_code persistido)
      YouTubeLite.astro           # facade lite-youtube (click-to-load)
      sections/{Hero,SocialProof,Specialties,HowItWorks,Faq,Footer}.astro
    scripts/vitals.ts             # web-vitals (la landing es estática: el hook de Next NO corre aquí)
```

Build: `astro build` → copia `dist/` a `public/landing/`. `/god.js` vive en `public/` **raíz de Next** (nunca en `landing/dist` — quedaría en `/landing/god.js` y rompería la referencia). Falta registrar `landing/` en `pnpm-workspace.yaml`.

### 3.2 El formulario (la relación con todo el flujo)

- Astro es estático: el POST va al mismo dominio Next. **Reutilizar el ingest existente**: `POST /api/v1/contacts` (API key, find-or-create por teléfono, ya existe) crea el lead; un evento `form_submit` (con el MISMO `event_id`) va a `/api/events` para el tracking/atribución. El form manda ambos (lead + evento) — cero motor nuevo.
- `god.js` rellena los hidden fields (`utm_*`, 8 click-ids, `landing_slug`, `ref_code`, `event_id`, `channel`, `medium`, `visitor_id`) antes del submit → el servidor recibe la atribución completa.
- El `thank-you` detecta `?lead=1` y emite `form_submit` con el MISMO `event_id` (idempotente por UNIQUE).
- Validación Zod en cliente + re-validación server.

### 3.3 YouTube on-demand (verificado: facade, ~3 KB vs ~540 KB del player)

Patrón facade (recomendado por Lighthouse/web.dev): no insertar el iframe real; renderizar thumbnail + play, e inyectar el iframe SOLO al clic.

- **Opción A (recomendada, respeta CSP `script-src 'self'`)**: `import '@justinribeiro/lite-youtube'` en un `<script>` de Astro (Astro lo bundlea desde 'self') + `<lite-youtube videoid="..." playlabel="Ver testimonio" nocookie>`.
- **Opción B (sin librería)**: `<iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/ID?autoplay=1" srcdoc="<img thumbnail + ▶>">` — click-to-load nativo, sin JS.
- **CSP**: al enforcear, añadir `frame-src https://www.youtube-nocookie.com` (hoy no existe → el iframe se bloquearía).

### 3.4 Analytics de velocidad (Core Web Vitals)

- **Dashboard (Next)**: componente `'use client'` con `useReportWebVitals` de `next/web-vitals` (bundled, sin instalar aparte) importado en `app/layout.tsx` → `navigator.sendBeacon` / `fetch(keepalive)` a `/api/analytics/vitals`. Métricas: TTFB, FCP, LCP, FID, CLS, INP.
- **Landing (Astro)**: la landing es HTML estático — el hook de Next NO corre ahí (verificado). `web-vitals` como dependencia del paquete `landing/` (`onTTFB/onFCP/onLCP/onCLS/onINP`) en `src/scripts/vitals.ts`, enviando al mismo `/api/analytics/vitals`.

### 3.5 Machote básico de landing (clínica, alta conversión)

| Sección | Contenido | Tracking |
|---|---|---|
| Hero | Propuesta en 1 frase + CTA WhatsApp (ref_code) + CTA a form | page_view · whatsapp_click |
| Social proof | Testimonios, rating, cifras | — |
| Especialidades | Grid 4-6 servicios con micro-CTA WhatsApp | whatsapp_click |
| Cómo funciona | 3 pasos (contacto → diagnóstico → cita) | — |
| Video testimonial | Facade lite-youtube (on-demand) | (opcional) iframe_loaded |
| FAQ | `<details>` nativo (cero JS, INP-friendly) | — |
| Form / CTA final | name/email/phone/message + hidden de atribución | form_submit |
| Footer | tel:, WhatsApp, dirección, legal | phone_click |

---

## 4. Enrutador de eventos — `/api/events` (REDUCIDO v8)

Dedup hard por `event_id` (`tracking_events.event_id UNIQUE`) + idempotencia: reintentos con el mismo `event_id` no duplican.

**v8 — alcance reducido:** `tracking_events` NO duplica `message_sent`/`call_logged` (ya viven en `messages`/`calls`; el VIEW `deal_evidence` los une). `/api/events` solo acepta eventos sin hogar: `form_submit`, `ctwa_lead`, `page_view`, `whatsapp_click`, `phone_click`, `scroll_depth`, `utm_recorded`, `identity_merged`, y los internos `state_changed`/`score_changed` (estos últimos SOLO escritos por RPC/trigger, no por la API).

```ts
// src/app/api/events/route.ts (esquema — reducido)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = trackEventSchema.safeParse(body);      // Zod
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { event_id, account_id, event_type, attribution, payload } = parsed.data;
  // dedup: ON CONFLICT (event_id) DO NOTHING → si ya existe, 200 idempotente
  const { error } = await admin.from("tracking_events").insert({ ... }, { onConflict: "event_id", ignoreDuplicates: true });
  // dispatch asíncrono: Meta CAPI + Google OCI (con retry, mismo event_id)
  await dispatchConversion({ event_id, event_type, attribution, payload, account_id });
  return NextResponse.json({ ok: true }, { status: 202 });
}
```

**Eventos default + custom (médicos):**

| Evento | Disparador | Meta CAPI | Google Ads |
|---|---|---|---|
| `ctwa_lead` | 1er mensaje WhatsApp con `referral.ctwa_clid` | Lead (`business_messaging`) | — |
| `form_submit` | Formulario landing completado | Lead | lead |
| `conversion` | Contacto identificado / creado | — | conversion |
| `good_lead` | **estado ≥ INTERES_CONFIRMADO** (responde + interés) | LeadQualified | — |
| `better_lead` | **estado ≥ CALIFICADO** | LeadQualified | — |
| `appointment_booked` | RESERVA_CONFIRMADA | AppointmentBooked | cita (con valor) |
| `purchase` / `closed_won` | SERVICIO_COMPLETADO (`value > 0`) | Purchase (value + currency) | compra (valor) |
| `lead_value` | deal con valor | — | lead_value |

> **Decisión (orquestador):** `good_lead`/`better_lead` se disparan por **estado** (core, configurable en `guard_rules`). El score (§7) es un feature que refina la prioridad de la card, no define eventos.
>
> **CAPI Business Messaging (verificado en docs Meta):** los eventos que nacen de WhatsApp (CTWA) se envían con `action_source: "business_messaging"` y `messaging_channel: "whatsapp"`, con `user_data.ctwa_clid` + `user_data.ph`. Con `action_source: "website"` Meta no asocia la conversión al anuncio.

---

## 5. Modelo de datos — migración `047_analytics.sql` (ESCRITA, lista para aplicar)

> ⚠️ Estado real: el archivo `supabase/migrations/047_analytics.sql` YA EXISTE en el repo (escrito) pero **NO está aplicado** (la última migración aplicada es `046_deals_fk_consistency`). Verificado con `supabase_list_migrations`.

```sql
alter table public.contacts
  add column if not exists attribution jsonb;          -- {utm, click_ids (incl. ctwa_clid), channel, medium, landing_slug, ref_code, first_seen, last_touch, event_id, consent, visitor_ids[]}

alter table public.deals
  add column if not exists score    int  not null default 0,   -- recalculado por trigger tras cada Interaction (no editable)
  add column if not exists tags     jsonb,                     -- {intencion, respuesta, documentos, urgencia, valor}
  add column if not exists priority text not null default 'warm' check (priority in ('top','warm','tibio','cold')),
  add column if not exists version  int  not null default 1;   -- optimistic locking (transiciones atómicas vía RPC)
  add column if not exists won_at   timestamptz,                -- fecha real de cierre (sin proxy updated_at)
  add column if not exists lost_at  timestamptz;                -- fecha real de pérdida (reports de perdidos)

-- Tabla de envíos de email (reporting de correos enviados — HOY nada se persiste)
create table if not exists public.email_sends (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete set null,
  template_name     text not null,
  recipient         text not null,
  subject           text not null,
  html              text not null,            -- snapshot renderizado (para el visor)
  status            text not null default 'sent' check (status in ('sent','delivered','bounced','failed')),
  resend_message_id text,
  sent_at           timestamptz not null default now()
);
alter table public.email_sends enable row level security;
create policy "email_sends_insert" on public.email_sends for insert with check (true);
create policy "email_sends_select" on public.email_sends
  for select using (public.is_account_member(account_id,'viewer'::public.account_role_enum));

alter table public.pipeline_stages
  add column if not exists guard_rules jsonb;          -- 12 estados configurables (template) + reglas no bloqueantes

create table if not exists public.tracking_events (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  event_type   text not null check (event_type in ('form_submit','ctwa_lead','conversion','purchase','lead_value','good_lead','better_lead','appointment_booked','service_started','closed_won','page_view','whatsapp_click','phone_click','email_click','outbound_click','scroll_depth','state_changed','utm_recorded','score_changed','identity_merged')),
  attribution  jsonb,
  landing_slug text, ref_code text,
  event_id     text unique,            -- dedup hard
  payload      jsonb,                  -- {deal_id, from_stage, to_stage, ...} / {href, value, currency, scrollPercent, ...}
  ip           text,
  created_at   timestamptz not null default now()
);
alter table public.tracking_events enable row level security;
create policy "tracking_events_insert" on public.tracking_events for insert with check (true);
create policy "tracking_events_select" on public.tracking_events
  for select using (public.is_account_member(account_id,'viewer'::public.account_role_enum));
```

**v8 — cambio clave respecto a v7:** el CHECK de `event_type` ya NO incluye `message_sent`/`message_received`/`call_logged` — esos eventos viven en sus tablas nativas (`messages`, `calls`). `tracking_events` es el timeline de eventos **sin hogar**: atribución/anónimos + `state_changed` + `score_changed` + `identity_merged`. La columna `payload.deal_id` enlaza con deals; el VIEW `deal_evidence` une `calls`+`messages`+`deals` para el timeline del deal (KISS, 0 sincronización).

**RPC incluidas en 047 (verificadas):** `set_deal_tags(uuid, jsonb, text)` (merge parcial de las 5 dimensiones con rangos fijos, recalcula score/priority, emite `score_changed`) · `transition_deal(uuid, uuid, text, text, jsonb, text, integer)` (SELECT FOR UPDATE → check agent+ → optimistic locking version → guard_rules del stage destino → UPDATE stage_id/status/won_at/lost_at/priority/version+1 → INSERT `state_changed`) · helpers `_sum_score`, `_compute_priority` · trigger `_deal_on_interaction` (AFTER INSERT en messages por conversation_id y calls por contact_id → auto-score respuesta/documentos de deals `open`). Grants según patrón 037 (solo authenticated + service_role).

---

## 6. API design (revisado v8)

| Ruta | Método | Público | Descripción |
|---|---|---|---|
| `/api/track` | GET/beacon | sí | Clicks WhatsApp/tel + scroll, anónimo, `ref_code` |
| `/api/events` | POST | sí | Enrutador de eventos (REDUCIDO v8: solo eventos sin hogar, §4) |
| `/api/v1/contacts` | POST | API key | Ingest lead (**EXISTE**, se reutiliza para el form de la landing) |
| `/api/analytics/overview` | GET | agente | Panel: leads, conversiones, canal, first-touch |
| `/api/analytics/export/oci` | GET | owner | Export Google Offline Conversion Import |
| `/api/analytics/export/ecl` | GET | owner | Export Enhanced Conversions for Leads |
| `/api/analytics/meta-capi` | GET | owner | Reusa `webhook_endpoints` (028) + `sign.ts` |
| `/api/analytics/vitals` | POST | público | Core Web Vitals (dashboard + landing) |
| `/api/report/*` | GET | agente | Pestañas de reporting: overview, campañas, canales, ads, email, llamadas, top leads, perdidos |

> **Patrón cliente Supabase (corrección v8):** usar `supabaseAdmin()` por módulo con `SUPABASE_SERVICE_ROLE_KEY` (patrón real del repo, NO existe `getServiceClient`). Sesión de usuario: `createServerClient` + `requireRole` (`src/lib/auth/account.ts:106-190`).

---

## 7. Máquina de estados NO bloqueante (core) + Scoring (feature)

> **CRM ≠ máquina de estados (respuesta al dueño):** el CRM es el depósito de verdad — identidades, contactos, `tracking_events` (timeline), atribución. La máquina de estados es un **motor dentro del CRM** que gobierna el ciclo de vida del deal (12 estados, transiciones, `guard_rules`). No compiten: la máquina de estados **consume** los datos del CRM — sus `guard_rules` leen el timeline (`message_received`, `call_logged`) para validar transiciones. El estado se **deriva** de los eventos (§2.3); el tracking pertenece al visitante/identidad, el estado pertenece al deal.

> **v8 — integrar con lo que YA existe:** hoy "estado" = `stage_id` (kanban, 5 stages seed app-level en `pipelines/page.tsx:40-46`) + `status` (open/won/lost). La transición HOY es UPDATE directo del cliente (drag&drop `handleDealMoved` page.tsx:217-233, `handleStatusChange` deal-form.tsx:214-231). El plan: conectar la RPC `transition_deal` (ya escrita en 047) a esos dos puntos — sin romper el kanban.

### 7.1 Los 12 estados configurables (template preconfigurado)

```
LEAD_CREADO → CONTACTO_INTENTADO → CONTACTADO → INTERES_CONFIRMADO → CALIFICADO
            → PROPUESTA_ACEPTADA → RESERVA_CONFIRMADA → SERVICIO_INICIADO
            → SERVICIO_COMPLETADO
Branches:   NO_CONTESTO · LARGO_PLAZO · DESISTIO
```

- Los estados y sus reglas de transición viven en `pipeline_stages.guard_rules` (JSONB) — **configurables por pipeline**. Este spec es el template que se precarga. HOY el seed son 5 stages ("New Lead", "Qualified", "Proposal Sent", "Negotiation", "Won") — el template de 12 estados reemplaza/expande ese seed según decisión del dueño.
- `src/lib/pipelines/state-machine.ts`: lee `guard_rules` → `evaluateTransition(deal, to, evidence)` → `{ allowed, missing[], warnings[] }`. (Archivo NO existe aún — 047 lo referencia.)
- **NO bloqueante**: `missing[]` es un checklist; el agente avanza con `override + reason` (se registra como evento `state_changed`).
- **Transiciones atómicas (capa de ejecución, auditoría dev)**: cada transición es la **RPC `transition_deal` de Postgres** (ya escrita en 047): (1) `SELECT ... FOR UPDATE` sobre el deal (row-level lock — Postgres real, no serverless sin transacciones), (2) valida `guard_rules` contra el timeline, (3) `UPDATE deals SET stage_id, status, version = version + 1 WHERE id = $1 AND version = $2` (**optimistic locking** — si `version` no coincide → 409, reintento), (4) INSERT evento `state_changed` en `tracking_events` (from_state, to_state, triggered_by, evidence_id, override_reason). Sin RPC no hay transición; ninguna ruta edita `deals.stage_id`/`status` directo.
- **Concurrentes (auditoría: "el primero gana")**: si `documentos_recibidos` y `timeout_desistio` llegan a la vez, el primero que commitea el lock gana; el segundo falla el guard porque el estado actual ya no es el esperado. Sin ifs sueltos, sin cron que compita con el webhook.
- **Invariante de auditoría**: todo cambio de estado inserta su fila en `tracking_events` en la misma transacción. Sin fila, no hubo cambio.

### 7.2 Scoring — FEATURE (no core), con trazabilidad (auditoría)

**5 dimensiones, valores fijos — nada de texto libre** (el score no es una caja negra):

| Tag | Valores | Ejemplo de negocio |
|---|---|---|
| `intencion` | 0=no · 1=curioso · 2=sí verbal · 3=dinero listo | "sí verbal" tras llamada |
| `respuesta` | 0=nunca · 1=una vez · 2=frecuente · 3=pide llamada | contesta siempre |
| `documentos` | 0=nada · 1=prometido · 2=enviados | subió la historia clínica |
| `urgencia` | 0=sin fecha · 1=3-6 meses · 2=<30 días | quiere cita ya |
| `valor` | 1=bajo · 2=medio · 3=alto | tratamiento premium |

`deals.tags jsonb {intencion, respuesta, documentos, urgencia, valor}` · **score = suma (máx 13)**.

- **Se calcula, no se edita a mano**: RPC `set_deal_tags` (agente fija las 5 dimensiones con rangos validados) + trigger `_deal_on_interaction` (auto-deriva `respuesta`/`documentos` desde messages/calls) recalculan `tags` + `score` y emiten evento `score_changed` con `payload {tags, score, reason}` → "¿por qué este lead es 10?" se responde leyendo el historial de `score_changed` (trazabilidad completa, sin caja negra).
- **Prioridad derivada**: 🔥 TOP = `urgencia=2` + `score>=9` · ⭐ WARM = estado INTERES_CONFIRMADO · 💤 TIBIO = CONTACTADO · 👻 COLD = DESISTIO/NO_CONTESTO.
- **Decisión:** el score NO dispara eventos de conversión (eso es del estado). Solo afina la prioridad de la card.
- Card = producto: **la info, no el score** — nombre, email y teléfono arriba; debajo, la info: chips (🔥⏳👻), siguiente acción, tiempo desde último contacto y valor. El score numérico es interno (dashboard), nunca en la card. **"Info en vez de score" es el diferenciador del producto.**

### 7.3 Cadencia llamada + WhatsApp — saga simple (auditoría dev)

Cada paso es una secuencia con dependencia, no dos tareas sueltas. Sin BullMQ ni Temporal: **tabla `tasks` + worker `pg_cron`** en Supabase (verificado: pg_cron nativo, batch-limit).

- `tasks (id, deal_id, type 'call'|'whatsapp', due_at, status 'pending'|'done'|'blocked', blocked_by_task_id, call_outcome)`.
- Regla: **ningún WhatsApp de seguimiento sin llamada registrada en las 4h previas**. El worker de WhatsApp consulta `WHERE blocked_by_task_id IS NULL` o la llamada ya `done` con outcome.
- Ejemplo INTERES_CONFIRMADO: Día 1 llamada "¿mandaste los docs?" → si `answered`, se desbloquea el WhatsApp con el link · si no, reprogramar +4h · Día 3 recordatorio · Día 7 si `documentos != 2` → transición a DESISTIO (vía la RPC, con guards).
- **Idempotencia de webhooks WhatsApp (duplicados)**: CORRECCIÓN v8 — el dedup por `wamid` NO existe en `messages` (001:172, TEXT sin UNIQUE). Fix: dedup app-level por `message_id` en el handler del webhook (patrón `ON CONFLICT DO NOTHING` con índice único parcial, igual que `idx_messages_telnyx_message_id` de 046:27-29 para SMS). Un webhook duplicado no duplica interacciones ni transiciones.

### 7.4 Cola de Hoy — la vista principal (auditoría UI)

> **v8 — construir SOBRE el overview existente:** el dashboard actual (`src/app/(dashboard)/dashboard/page.tsx`, client component) ya carga 5 queries en paralelo con `loadAll` y monta MetricCards + charts + ActivityFeed. La Cola de Hoy **reemplaza el bloque de MetricCards/charts** en esa misma página (NO es una página nueva ni un sidebar nuevo). El ActivityFeed (timeline) se mantiene debajo o como pestaña.

- Tres secciones: **🔥 Menos de 30 días** (`urgencia=2`) · **⏳ Esperando docs** (`documentos != 2`) · **💤 Nurturing** (el resto).
- Tarjeta = producto: nombre, chips, tiempo desde último contacto, botón grande **Llamar** → abre el dialer y bloquea el WhatsApp de seguimiento hasta que la llamada termine.
- Móvil: botones grandes **Contestó** / **No contestó** (un tap; el swipe se descartó por bloat).
- El SDR ve "por llamar hoy", "esperando cliente", "nurturing" — nunca 12 columnas en la operación del día.
- **Layout de la card** (la info debajo del email y el teléfono, como pidió el dueño):
  - Fila 1: nombre + chips (🔥⏳👻).
  - Fila 2: email y teléfono (tap → dialer / WhatsApp).
  - Debajo: **info** — última interacción (usar `conversations.last_message_at` + `last_message_text` que YA EXISTEN), tiempo desde último contacto, siguiente acción (botón Llamar / Enviar), valor estimado. Nada de score numérico.
- La card deal-card existente (`src/components/pipelines/deal-card.tsx`) ya muestra title/value/contact/expected_close_date/assignee — falta email + última interacción + siguiente acción: se extiende, no se reemplaza desde cero.
- **Reutilizar**: `loadAll` + queries (se añade una query nueva `loadTodayQueue`), patrón MetricCard/SkeletonCard, `formatCurrency`, deep links `/inbox?c=` y dialer de Telnyx ya existentes.

### 7.5 Revenue checkpoints (auditoría revenue)

- **SLA por estado**: tiempo en INTERES_CONFIRMADO < 48h → métrica diaria (tiempo-en-estado promedio).
- **Tasa de fuga TOP**: leads con `urgencia=2` que pasan a DESISTIO. Meta <5%.
- **Ingreso proyectado** = Σ(`valor × score/13`) — pipeline ponderado.
- **Gap de fuga manual**: `leads_creados` vs `leads_con_evidencia`. Si el gap >10%, hay transición manual sin guard.
- **DESISTIO que vuelve en 6 meses**: el contacto conserva todo el historial y la atribución (first-touch intacto, §2.3); el nuevo deal es una nueva oportunidad sobre la misma identidad — no se resetean tags (afecta LTV, queda medido).

### 7.6 Reporting — el panel que hoy NO existe (auditoría del repo)

**Estado actual verificado (evidencia):** el repo no tiene ni vista ni API de reporting. Lo único: `/dashboard` (4 tarjetas + serie + donut, agregación client-side en `src/lib/dashboard/queries.ts`), `PipelineAnalytics` (won/lost del mes con `updated_at` como proxy — no hay `won_at`), funnel de broadcasts y llamadas "Recent". No existe `/reports` en el sidebar ni `/api/analytics/*` (67 rutas API, ninguna de analytics). `deals.status` solo permite `open/won/lost`; no hay 12 estados, ni attribution, ni score.

**Lo que hay que construir (nuevo ítem del sidebar: Reports):**

| Pestaña | Qué muestra | Query base (047) |
|---|---|---|
| Overview | KPIs: revenue ganado, pipeline, leads, conversión, llamadas, correos | agregados por rango |
| Campañas | Por `utm_campaign`: leads, deals, revenue | `c.attribution->'utm'->>'campaign'` |
| Canales | Por `channel` (google/meta/organic/direct/ctwa): leads + revenue | `c.attribution->>'channel'` |
| Ads | Por click_id (`gclid`/`fbclid`/`ctwa_clid`/…): leads + revenue | `c.attribution->'click_ids'` |
| Email | Enviados/entregados/rebotados (`email_sends`) | contadores + webhook Resend |
| Llamadas | Por día: count, perdidas, completadas, duración (039) | `calls` |
| Top leads | Score desc (047) / fallback `deals.value` | `deals.score` |
| Perdidos | DESISTIO/NO_CONTESTO/LARGO_PLAZO + botón **Reactivar** | `deals.state` + `lost_at` |

**Verificado contra el esquema real:** revenue por canal usa `contacts.attribution` (047 — hoy no existe); perdidos hoy = `status='lost'` fechado por `updated_at` (proxy); correos enviados hoy = imposible (nada se persiste; solo pasos `send_email` en `automation_logs.steps_executed` JSONB).

**Fixes que desbloquean el reporting:**
1. Migración 047 (attribution, tracking_events, score/tags/priority/version, guard_rules) — **ya escrita, aplicar**.
2. `deals.won_at` / `deals.lost_at` (fecha real de cierre — sin proxy).
3. Tabla `email_sends` + webhook Resend real (hoy es stub) — §7.7.
4. Vista "Perdidos" con Reactivar → reabre deal sobre la misma identidad (`identity_merged`) + secuencia de reactivación.

### 7.7 Email — secuencias, visor y reactivación (auditoría del repo)

**Estado actual verificado:** el envío REAL existe vía Resend (`src/lib/email/send.ts:34-81`, key encriptada en `email_config`, templates en `email_templates` 040); **el step `send_email` ya existe en el motor de automations** (`engine.ts:453-476`). PERO: sin cola propia, sin log de envíos (nada se persiste), webhook stub (`/api/email/webhook` solo ackea; delivered/bounced "para v2").

**Decisiones (v8 — cero motor nuevo):**
- **Secuencias programadas** (no uno por uno): **reutilizar el motor de automatizaciones existente (006)** — el step `wait` + `automation_pending_executions` + cron HTTP (`AUTOMATION_CRON_SECRET`) ya implementa delay y reanudación. Una secuencia = automation con steps `[send_email, wait, send_email, ...]`. **Ya es modelable HOY** (verificado por agente backend). Faltan 2 piezas:
  1. Índice único `(contact_id, automation_id)` contra duplicados de re-ejecución (hoy no existe).
  2. Un disparador por **cambio de estado** (hoy `AutomationTriggerType` no lo incluye; `time_based` está tipado pero sin dispatch) para lanzar la reactivación al pasar a DESISTIO/NO_CONTESTO — se dispara desde la RPC `transition_deal` o un trigger en `deals`.
- **Visor de correos (simple)**: `<iframe srcdoc={html} sandbox="">` con el `body_html` interpolado (misma interpolación del envío). Para templates sin enviar: viable hoy. Para emails enviados: requiere persistir el HTML final en `email_sends.html` (snapshot) — por eso la tabla lleva el campo.
- **Reactivación a perdidos (remarketing)**: lista de Perdidos (047) → botón "Reactivar" → crea automation de reactivación (template + delay) sobre el mismo contacto, conservando atribución first-touch (§2.3). NO_CONTESTO ≠ DESISTIO ≠ LARGO_PLAZO: cada estado terminal tiene su plantilla y su cadencia.
- **Reporting de correos**: `email_sends` + contadores incrementales por trigger (patrón probado en broadcasts 005:36-99) + webhook Resend real con verificación de firma (**Svix** — hoy el stub no la verifica) para delivered/bounced.
- **Persistir el envío**: en `engine.ts:453-476` (step send_email) y en `src/app/api/email/send/route.ts:15-83` (envío manual), insertar fila en `email_sends` con el html renderizado + `resend_message_id`.

---

## 8. Inspiración Mautic — qué implementamos (síntesis orquestador)

Tres agentes auditaron la documentación oficial de Mautic 7.1 (tracking, analytics, campañas) en la iteración v4-v7. Síntesis cruzada y decisiones — priorizando impacto en ingresos:

### 8.1 Tracking — **core ahora (P0)**

| Concepto Mautic | Qué hace | Decisión wacrm |
|---|---|---|
| Identidad de dispositivo (`device_id`, cookie 1 año) | Un mismo uuid une todas las visitas del navegador | `visitor_id` en localStorage + cookie first-party 365d (§2.2) |
| Merge anónimo→conocido por identificador único | Al aparecer el dato único, todo el historial anónimo se fusiona al contacto conservando la primera fuente | El identificador único es el **teléfono**: al primer webhook de WhatsApp entrante con `ref_code`/`visitor_id`, reasignar eventos anónimos al contact (first-touch intacto). §2.3 |
| CTWA attribution (`ctwa_clid` en `referral`) | El clic en anuncio Click-to-WhatsApp se ata a la conversación sin pasar por navegador | Capturar `referral.ctwa_clid` del 1er mensaje (hoy se pierde — gap v8) + CAPI con `action_source: business_messaging`. Cierra el ciclo que ni el pixel ni el `ref_code` pueden (§2.3) |
| UTM persistidas como datos del contacto (no eventos sueltos) | Filtros, segmentos y reports de atribución | `contacts.attribution` jsonb ya lo hace (§5) |
| Excluir tráfico interno (`track_private_ip_ranges`, usuarios logueados) | No polucionar atribución de campañas pagas | `/god.js` se sirve SOLO en landing + `/thank-you`, nunca en `/dashboard` |
| Events custom → GA/FB Pixel ("Send tracking event") | Conversiones a plataformas de ads | Es nuestro `/api/events` → Meta CAPI + Google OCI (§4) |

### 8.2 Analytics — **core ahora: timeline reducido (P0)** · Fase 2: el resto

| Concepto Mautic | Qué hace | Decisión wacrm |
|---|---|---|
| Contact timeline / event log | Cada interacción (page hit, form, email, puntos, stage) en un timeline filtrable | `tracking_events` = event log de eventos sin hogar (§5) + ActivityFeed existente para messages/calls/deals/broadcasts/automation_logs — juntos forman el timeline |
| First/Last/Multi-touch attribution (data source nativa de reports) | Atribuir el deal cerrado al canal/campaña de origen | **Fase 2**: SQL sobre `deals` + `tracking_events` (first-touch por `ref_code`, last-touch por `last_touch`) |
| Lead scoring: point actions + triggers por umbral | Deltas por evento (repeatable o one-shot); umbral → alerta/acción | **Feature §7**: `set_deal_tags` + trigger de interacción — sin decay inicial, KISS |
| Segments estáticos/dinámicos | Audiencias re-evaluadas por filtros | **Fase 2 (P2)**: audiencias como VIEWs/filtros sobre contacts + tracking_events (sin tabla de membresía al inicio) — alimentan públicos Meta/Google. Base: `filter_contacts_by_tags` (025) + tags de contacto existentes |
| Reports + dashboards con filtro global de fecha | Constructor con data sources, group by, calculated columns | **Fase 2 (P2)**: endpoints agregados por rango + widgets React |

### 8.3 Seguimiento / automatización — **Fase 2 (P1)**

| Concepto Mautic | Qué hace | Decisión wacrm |
|---|---|---|
| Campaigns: events (actions/decisions/conditions) con rutas verde/roja | Un builder visual; la ruta roja (no-acción) + delay = nurturing real | **Fase 2**: `campaigns` + `campaign_events` + paths; UI con React Flow. Fuentes: segmento (pg_cron batch) y evento |
| Decisions por comportamiento | Submits form, visita página, open/click/reply email; SMS reply por patrón | **Fase 2**: decisions nativas WhatsApp: `mensaje_leido` (check azul), `click_en_link` (redirect de tracking), `responde_mensaje` (regex, ej. SÍ/NO), `formulario_completado` |
| Actions de ciclo de vida | Enviar email, cambiar stage, puntos, segmentos, tags, owner, webhook | **Fase 2**: `enviar_plantilla_whatsapp` (transaccional repetible vs marketing 1 sola vez), `cambiar_estado_deal` (12 estados, vía RPC `transition_deal`), `asignar_owner`, `notificar_agente`, `añadir_segmento` |
| Frequency rules + cola de mensajes | Anti-spam: límite por canal; los que exceden se re-agendan, no se descartan | **Fase 2**: `frequency_rules` globales + por lead + `message_queue` (worker pg_cron). Cumplimiento en salud |
| Smart event schedule | Hora óptima de envío según historial de interacción | **Fase 2**: ventanas horarias de la clínica + hora óptima por patrón de aperturas/respuestas |
| Webhook action desde campaña → integración | Push condicionado a decisiones (base de atribución multi-sistema) | **Fase 2**: al cruzar `closed_won`/`appointment_booked` → POST Meta CAPI + Google OCI (retry + idempotency key) — ya diseñado en §4 |

### 8.4 Lo que NO implementamos

- Email marketing / SMS marketing (no aplica: canal único WhatsApp).
- Dynamic Web Content (P2 desechable por ahora).
- Máquina de aprendizaje / modelos ML.
- Sistema de plugins/theme (no aplica a nuestro stack).

---

## 9. Guardrails

1. **RLS**: `tracking_events_insert` público; todo select con `is_account_member` (los eventos anónimos tienen `account_id` de la clínica). `email_sends`: insert con `check(true)` (precedente: `messages` 001:185), select viewer+.
2. **Zod** en toda entrada (`/api/events`, `/api/track`): tipos estrictos, sin datos no esperados.
2b. **Idempotencia webhook WhatsApp**: CORRECCIÓN v8 — dedup por `message_id` app-level (índice único parcial como `idx_messages_telnyx_message_id` de 046) — los webhooks duplicados no duplican interacciones ni transiciones.
2c. **Transiciones solo por RPC**: ninguna ruta edita `deals.stage_id`/`status` directo; todo pasa por `transition_deal` con optimistic locking (`version`).
3. **Dedup**: `event_id UNIQUE` + `ON CONFLICT DO NOTHING`; reintentos idempotentes.
4. **Sin PII en URLs**: los click-ids van por POST/beacon, no en el query de páginas internas; `ref_code` es opaco (sin teléfono).
5. **No trackear agentes**: `/god.js` fuera del dashboard.
6. **Consent hook**: `getConsent("ad_storage")` se propaga a `attribution.consent`; la dispatch respeta el estado de consentimiento.
7. **Retención**: purga de `tracking_events` > 90 días (cron).
8. **Migración aditiva**: `047` es `alter ... add column if not exists` + 1 tabla — sin breaks.
9. **Dispatch asíncrono con retry**: cola de reintentos con backoff; el `event_id` garantiza no duplicar conversiones pagadas.
10. **CTWA es one-shot**: `referral.ctwa_clid` solo llega en el primer mensaje entrante; el handler del webhook lo persiste en el momento o se pierde para siempre.
11. **Sin inventar APIs**: toda integración Meta/Google verificada contra docs oficiales antes de implementar.
12. **PII solo en POST**: email/teléfono van en el body de `/api/v1/contacts` y `/api/events`, nunca en el query string de `/thank-you` ni en URLs.
13. **CSP de la landing**: al enforcear, añadir `frame-src https://www.youtube-nocookie.com` (lite-youtube) — hoy la bloquea.
14. **`email_sends` por RLS de cuenta**: insert acotado, select `is_account_member` — el log de correos es dato de negocio.
15. **Patrón Supabase**: `supabaseAdmin()` por módulo (NO `getServiceClient`); grants según patrón 037 (REVOKE PUBLIC → GRANT solo authenticated/service_role); helpers internos sin EXECUTE externo.
16. **Conectar 047**: el tipo `Deal` TS (src/types/index.ts:391-414) debe tipar score/tags/priority/version/won_at/lost_at antes de usar la RPC; el cliente debe leer `version` para el optimistic locking.

---

## 10. Testing

| Archivo | Cubre |
|---|---|
| `src/lib/analytics/attribution.test.ts` | parse 13 campos, mapeo clid→canal, referrer→canal, prioridad de canal, ref_code/event_id, TTL |
| `src/lib/analytics/identity-resolution.test.ts` | merge por form/webhook/ctwa_clid, first-touch intacto, idempotencia, cambio de dispositivo |
| `src/app/api/events/route.test.ts` | Zod rejects, dedup idempotente (mismo event_id → 202, 1 fila) |
| `src/app/api/analytics/export/oci/route.test.ts` | Formato OCI, permisos owner |
| `src/lib/pipelines/state-machine.test.ts` | 12 estados, guard_rules, override no bloqueante, transición a CALIFICADO sin documento → 422, concurrentes (docs vs timeout → primero gana), optimistic lock 409 |
| `src/lib/pipelines/scoring.test.ts` | tags 5 dims, RPC recalcula, `score_changed` con payload (trazabilidad), prioridad 🔥⭐💤👻 |
| `src/lib/pipelines/cadence.test.ts` | WhatsApp bloqueado sin llamada previa, reprogramar call +4h, D7 → DESISTIO |
| `src/app/api/webhooks/whatsapp/route.test.ts` | dedup por `message_id` (webhook duplicado → 1 interacción) — CORREGIDO v8 |
| `src/app/api/analytics/vitals/route.test.ts` | Zod metric, guarda CWV, dedup por metric id + path |
| `src/lib/reporting/reports.test.ts` | revenue por canal, campañas, ads, perdidos, top leads (047) |
| `src/lib/email/sequences.test.ts` | secuencia [send_email, wait, send_email] reanuda por cron, sin duplicados (contact, automation) |
| `src/app/api/email/webhook/route.test.ts` | firma Svix válida → delivered/bounced actualiza `email_sends` |
| `src/lib/dashboard/today-queue.test.ts` | NUEVO v8: Cola de Hoy (3 secciones 🔥⏳💤, última interacción vía last_message_at, info-no-score) |

---

## 11. Fuera de scope

- Cero PHP.
- Manifiesto de marketing (naming, pricing, ads Meta, claims).
- Consent Mode completo (solo hook de lectura).
- Tabla `interactions` (se usa VIEW).
- Softphone, IVR.
- Email/SMS marketing.
- Motor de secuencias de email nuevo (se reutiliza el de automations, §7.7).

---

## 12. Deploy — Docker vs "click & deploy" Hostinger

**Respuesta corta: no estamos haciendo nada mal.** El repo tiene DOS vías documentadas (README.md:96-112): el "click & deploy" es Hostinger **Managed Node.js (Web Apps)** — el README dice "No Docker" (README.md:69) — y Docker está documentado como la vía para VPS (README.md:93-94 → `docs/docker.md`). No compiten: eligen distinto por control vs cero-ops.

| | Web Apps (Managed Node.js) | VPS + Docker (Dockerfile/compose del repo) |
|---|---|---|
| Deploy | fork → push a main → Hostinger buildea (pnpm auto-detectado, `next start` automático, SSL gratis) | Docker Manager + Traefik (Let's Encrypt) |
| Proceso | ⚠️ **on-demand: duerme sin tráfico** → cold-start en webhook WhatsApp/API (docs.hostinger.com/node.js/overview.md) | 24/7, sin sleep |
| Cron automations | cron externo (hPanel) que mantenga el proceso despierto | scheduler externo vía `x-cron-secret` (docs/docker.md:61-66) |
| Coste/ops | más barato, cero mantenimiento | tú mantienes OS/Docker/TLS |
| Build | límite 15 min (sharp, recharts, telnyx-webrtc) | local/CI |

**Decisión (orquestador):** para una clínica cuyo webhook de WhatsApp debe contestar 24/7 y cuyas automatizaciones corren con cron, **VPS + Docker es el camino correcto**; Web Apps queda como fallback barato si se acepta el sleep + un cron cada minuto que mantenga el proceso despierto. Realtime es browser→Supabase directo (no pasa por Next), así que el sleep no rompe la app — solo añade latencia de wake.

**Gaps detectados en el Dockerfile actual (fixes pendientes):**
1. Falta `.next` writable para caché ISR/prerender (patrón oficial del Dockerfile de Next: `RUN mkdir .next && chown nextjs:nextjs .next` en el stage runner).
2. `docs/docker.md` no cubre HTTPS en VPS: para el webhook de Meta (https obligatorio) hay que montar Traefik/Caddy o nginx+certbot apuntando el dominio al puerto publicado (`HOST_PORT`).
3. La guía `wacrm.tech/docs/deployment-hostinger` manda `npm ci`, pero el repo solo tiene `pnpm-lock.yaml` — ese comando falla; en Web Apps Hostinger auto-detecta pnpm.

---

## 13. Plan de implementación — conectando 047 con la app (P0 primero)

**Estado actual (auditoría v8):** la migración 047 (DB) está escrita y lista, pero la app NO la consume: el tipo `Deal` TS no tipa los campos nuevos, no existe `src/lib/pipelines/state-machine.ts`, y nadie llama `transition_deal`/`set_deal_tags`. La DB y la app están desconectadas.

### Fase 1 — Aplicar y tipar (desbloquea todo)
1. Aplicar `supabase/migrations/047_analytics.sql` (es aditiva, sin breaks).
2. Tipar `Deal` (src/types/index.ts:391-414) con `score/tags/priority/version/won_at/lost_at` + `Contact.attribution`.
3. `supabase db pull` / regenerar tipos TS (o tipar a mano) + `pnpm build` verde.

### Fase 2 — Conectar la máquina de estados (sin romper el kanban)
4. Conectar `transition_deal` al drag&drop (`pipelines/page.tsx:217-233` handleDealMoved) y a `handleStatusChange` (deal-form.tsx:214-231) — reemplaza el UPDATE directo; el cliente envía `p_expected_version` (leer `version` del deal cargado) y maneja 409 con refresh.
5. Crear `src/lib/pipelines/state-machine.ts`: lee `guard_rules` → `evaluateTransition` (la RPC ya valida en DB; el lib da feedback al UI: missing/warnings).
6. Decidir con el dueño: ¿el template de 12 estados reemplaza el seed de 5 stages ("New Lead"...)? (guard_rules se precarga en los stages).

### Fase 3 — Cola de Hoy sobre el overview (P0, §7.4)
7. Nueva query `loadTodayQueue` en `src/lib/dashboard/queries.ts` (deals + contact + conversations.last_message_at + score/priority/urgencia).
8. Reemplazar el bloque MetricCards/charts de `dashboard/page.tsx` por las 3 secciones 🔥⏳💤 (mantener ActivityFeed).
9. Extender `deal-card.tsx` con email, última interacción y siguiente acción (info, no score).

### Fase 4 — Landing + atribución (P0, §3)
10. Paquete Astro `landing/` + `rewrites()` en next.config.ts + quitar redirect en `src/app/page.tsx:4`.
11. `src/lib/analytics/attribution.ts` + `god.ts` → bundle a `/god.js` + `/api/track`.
12. Lead del form: `POST /api/v1/contacts` (existente) + `/api/events` (reducido) con `form_submit`.

### Fase 5 — Email persistido + reporting (P0, §7.6-7.7)
13. Persistir `email_sends` en `engine.ts:453-476` y `email/send/route.ts`.
14. Webhook Resend real con Svix (delivered/bounced) + contadores por trigger (patrón 005).
15. Sidebar Reports + `/api/report/*` (8 pestañas §7.6) + `won_at`/`lost_at` en vez de proxy.

### Fase 6 — CTWA (P0, §2.3)
16. Capturar `referral.ctwa_clid` en `/api/whatsapp/webhook` (hoy se pierde) + CAPI `business_messaging`.

### Fase 7 — Fase 2 Mautic (P1/P2, §8.3)
17. Campañas, decisions, frequency rules — después del core.

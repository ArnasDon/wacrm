# WACRM ↔ Budun ERP — Análisis de preparación (solo auditoría)

> **Estado: NO IMPLEMENTADO.** Este documento es el único artefacto producido en esta
> etapa. No se creó ningún modelo, migración, endpoint, tool, componente de UI ni
> variable de entorno. Es una auditoría del código real de WACRM al momento de
> redactar este documento (commit `dc46242`, rama `main`), para que la implementación
> futura no tenga que re-descubrir la arquitectura desde cero.

---

## 1. Arquitectura actual encontrada

WACRM es un CRM de WhatsApp self-hosted sobre **Next.js 16 (App Router) + Supabase**
(Postgres + RLS + Auth), TypeScript estricto, sin ORM (queries vía `@supabase/supabase-js`
y `@supabase/ssr`). No usa un framework de agentes de terceros (no LangChain, no Vercel
AI SDK, no OpenAI Agents SDK). Todo el "agente IA" es código propio.

Puntos clave que cambian el plan de implementación respecto a lo que el spec asume:

1. **No existe hoy un tool-calling / function-calling loop.** El "AI Agent" de WACRM es
   un pipeline de generación de texto de un solo turno (RAG clásico), no un agente que
   invoca herramientas. Ver §5.
2. **No existe hoy una sección "Integrations" en Settings.** Cada integración externa
   (WhatsApp/Meta) tiene su propia sección de nivel superior en el rail de Settings, no
   un sub-árbol "Integrations → X". Ver §7.
3. **Ya existe un mecanismo paralelo para "inventario en el bot"**: el usuario sube un
   CSV/Excel/Google Sheet y su contenido se vuelca como texto en la Knowledge Base
   (RAG). Esto es exactamente lo que Budun ERP debe complementar/reemplazar con datos
   en vivo — y el spec ya prohíbe explícitamente cargar stock dinámico a la KB, así que
   no hay conflicto de diseño, pero sí hay que documentarlo para que la implementación
   no lo duplique ni lo confunda. Ver §9.
4. El repo incluye un `mcp-server/` **separado y no relacionado** con el agente
   conversacional: es un servidor MCP standalone que expone la API pública `/api/v1/*`
   de WACRM a clientes MCP externos (Claude Desktop, etc.). No es el "tool registry" del
   bot de WhatsApp y no debe confundirse con él. Ver §4.

---

## 2. Archivos y directorios relevantes (mapa completo)

```
src/lib/ai/                          — "cerebro" del agente (texto, no tools)
  types.ts                           — AiConfig, ChatMessage, AiError, GenerateResult
  config.ts                          — loadAiConfig() / loadEmbeddingsKey() (decrypt)
  defaults.ts                        — buildSystemPrompt(), timeouts, modelo por defecto
  generate.ts                        — generateReply() → despacha al provider
  providers/{openai,anthropic,openrouter,openai-compatible,shared}.ts
  context.ts                         — buildConversationContext() (últimos N mensajes)
  knowledge.ts                       — ingestDocument() / retrieveKnowledge() (RAG)
  chunk.ts, embeddings.ts            — chunking + embeddings opcionales
  inventory-parser.ts                — CSV/Excel/Sheets → texto plano para la KB
  auto-reply.ts                      — dispatchInboundToAiReply() (el "auto-reply bot")
  handoff.ts, usage.ts, query.ts, validate.ts, admin-client.ts

src/app/api/ai/
  config/route.ts                    — GET/POST/DELETE ai_configs (Setup tab)
  playground/route.ts                — POST — prueba el agente sin tocar WhatsApp
  draft/route.ts                     — "Draft with AI" en el Inbox
  autoreply/route.ts                 — toggles de auto-reply por conversación
  knowledge/…                        — upload, sheet, inventory/preview (ingest KB)
  usage/route.ts, test/route.ts, openrouter/route.ts

src/app/(dashboard)/agents/page.tsx  — página "AI Agents" (tabs: Playground/Setup/Usage)
src/components/agents/
  ai-playground.tsx                  — UI del Playground
  ai-usage.tsx                       — UI de consumo de tokens
src/components/settings/
  ai-config.tsx                      — UI del "Setup" tab (provider, modelo, api key…)
  ai-knowledge.tsx                   — UI de la Knowledge Base (CSV/Sheet/manual)

src/lib/whatsapp/
  encryption.ts                      — encrypt()/decrypt() AES-256-GCM (patrón de secretos)
  meta-api.ts                        — cliente HTTP hacia Meta (patrón de API client)
  send-message.ts                    — sendMessageToConversation() (envío desde dashboard)
src/lib/flows/meta-send.ts           — engineSendText() / engineSendMedia() (envío desde motor)
src/app/api/whatsapp/
  config/route.ts                    — GET/POST/DELETE whatsapp_config (patrón "Test Connection")
  config/verify-registration/route.ts
  send/route.ts, media/[mediaId]/route.ts

src/lib/api-keys/                    — keys.ts, scopes.ts, store.ts — API keys PÚBLICAS de WACRM
                                         (salientes, hash-only) — NO es el mecanismo a reusar
                                         para credenciales de Budun (ver §6).
src/lib/auth/
  account.ts                         — getCurrentAccount() / requireRole() (tenant context)
  api-context.ts                     — requireApiKey() (auth de /api/v1 vía API key)
  roles.ts                           — AccountRole, canEditSettings(), hasMinRole()

src/components/settings/
  settings-sections.ts               — registro de secciones del rail de Settings
  settings-rail.tsx, settings-overview.tsx, settings-panel-head.tsx
  whatsapp-config.tsx                — plantilla de referencia para el panel de Budun ERP
src/app/(dashboard)/settings/page.tsx

supabase/migrations/                 — 001…043_*.sql, siguiente índice libre: 044
mcp-server/                          — servidor MCP standalone, NO relacionado con el bot
```

---

## 3. Modelos de datos relevantes (tablas existentes)

| Tabla | Migración | Rol |
|---|---|---|
| `accounts`, `profiles` | 001, 017 | Tenant y membresía; `profiles.account_id` + `profiles.account_role` son la fuente de verdad del tenant actual. |
| `whatsapp_config` | 001, 015, 039 | Un row por `account_id` (UNIQUE). Credenciales Meta cifradas. Plantilla directa para `budun_erp_config`. |
| `ai_configs` | 029, 038 | Un row por `account_id` (UNIQUE). BYO-key del proveedor LLM, cifrado. |
| `ai_knowledge_chunks` (+ documentos) | 030, 040, 041 | RAG: chunks de texto + embedding opcional. Aquí es donde hoy cae el inventario subido por CSV — **no** debe caer aquí el catálogo de Budun. |
| `webhook_endpoints` | 028 | Tercer ejemplo del mismo patrón: secreto HMAC cifrado, RLS admin+. |
| `api_keys` | 026 | Claves **salientes** de WACRM (hash SHA-256, no reversible) — mecanismo distinto, no aplica a credenciales de un proveedor externo que WACRM debe volver a usar en texto plano. |
| `conversations`, `messages` | 001… | Usadas por `buildConversationContext` y por el envío de mensajes/medios. |

No existe ninguna tabla `integrations`, `erp_config`, `budun_*` ni `catalog_*` en el
repositorio actual.

---

## 4. Tool registry / tool calling — hallazgo principal

**No existe tool-calling/function-calling en el agente conversacional actual.**

El flujo real (`auto-reply.ts` → `context.ts` + `knowledge.ts` → `defaults.ts` →
`generate.ts` → `providers/*.ts`) es:

1. Se arma el historial de la conversación como texto (`ChatMessage[]`).
2. Se recuperan hasta *k* fragmentos de la Knowledge Base por búsqueda léxica/semántica
   (`retrieveKnowledge`) y se **incrustan como texto** dentro del system prompt
   (`buildSystemPrompt`).
3. Se llama al proveedor (`generateAnthropic` / `generateOpenAi` / `generateOpenRouter`)
   con una petición de **chat completion simple** — ninguno de los tres adapters envía
   el parámetro `tools`/`tool_choice`/`functions` de sus respectivas APIs.
4. La respuesta es texto plano; se detecta el sentinel `[[HANDOFF]]` y se envía por
   WhatsApp (`engineSendText`, solo texto).

Es decir: **implementar `buscar_producto_budun` / `consultar_disponibilidad_budun` /
`obtener_producto_budun` como "Tools" que el modelo invoca requiere construir el loop de
tool-calling desde cero** (definir el schema de tools en cada adapter de proveedor,
manejar la respuesta `tool_use`/`tool_calls`, ejecutar la tool server-side, reinyectar el
resultado como `tool_result` y volver a llamar al modelo) para los tres proveedores
soportados (OpenAI, Anthropic, OpenRouter). Esto es la pieza de mayor esfuerzo de toda la
integración y el principal riesgo de alcance (ver §11).

El `mcp-server/` (`mcp-server/src/tools/{read,write,broadcast}.ts`, registrado en
`mcp-server/src/tools/index.ts`) **sí** es un tool registry real, pero:
- Es un proceso Node **externo**, ejecutado por un cliente MCP (Claude Desktop, etc.),
  no por el bot de WhatsApp de WACRM.
- Sus "tools" llaman a la API pública `/api/v1/*` de WACRM autenticada con API keys
  (`wacrm_live_…`), no al ERP.
- Puede servir como **referencia de estilo** (un tool = una función con schema de
  input/output y manejo de errores tipado) pero no es el punto de enganche funcional.

**Punto de implementación futuro (no ejecutar aún):** un módulo nuevo, p. ej.
`src/lib/ai/tools/` con:
- `src/lib/ai/tools/registry.ts` — definición de tools disponibles por cuenta (hoy 0,
  futuro: `budun_catalog` si la integración está conectada).
- Extensión de `providers/*.ts` para aceptar/emitir `tools` y un segundo turno de
  ejecución.
- Extensión de `generate.ts`/`auto-reply.ts`/`playground/route.ts` para el loop
  "modelo pide tool → WACRM ejecuta → modelo responde".

---

## 5. Agent configuration / prompt / system instructions

- `src/lib/ai/defaults.ts::buildSystemPrompt()` es la única fuente del system prompt,
  compartida por `auto-reply.ts`, `draft` y `playground`. Ya contiene una regla explícita
  de "nunca inventar precio/stock" apoyada en la Knowledge Base — el prompt futuro deberá
  extender esta regla para cubrir la Tool de Budun en vez de (o además de) la KB.
- El prompt del negocio (`ai_configs.system_prompt`) es texto libre editado en
  `src/components/settings/ai-config.tsx` (tab "Setup" de `/agents`).
- No hay "Agent" como entidad separada (no hay tabla `agents` de IA, ni multi-agente); es
  una configuración única por cuenta (`ai_configs`, UNIQUE `account_id`).

---

## 6. Secret storage — mecanismo a reutilizar (confirmado)

WACRM tiene **un solo** mecanismo de cifrado reversible para credenciales que el
servidor necesita volver a usar en texto plano al llamar a una API externa:

- `src/lib/whatsapp/encryption.ts` — AES-256-GCM, clave desde `process.env.ENCRYPTION_KEY`
  (hex de 64 caracteres), formato `iv:ciphertext:authTag`. Soporta descifrado
  retrocompatible de un formato CBC legado (`isLegacyFormat`).
- Usado hoy por **tres** integraciones distintas, todas con el mismo patrón:
  `whatsapp_config.access_token` / `.verify_token`, `ai_configs.api_key` /
  `.embeddings_api_key`, `webhook_endpoints.secret`.
- El secreto nunca se devuelve al cliente tras guardarse: la UI muestra un placeholder
  enmascarado (`••••••••••••••••`) y solo se reenvía cuando el usuario lo edita
  explícitamente (`tokenEdited` en `whatsapp-config.tsx`).

Hay un **segundo** mecanismo, `src/lib/api-keys/keys.ts`, pero es de propósito distinto:
genera claves salientes de WACRM (`wacrm_live_…`), almacena solo su hash SHA-256
(irreversible) y se usa para autenticar llamadas *entrantes* a la API pública de WACRM.
**No aplica** a Application Secret / Catalog API Key de Budun, porque WACRM necesita
volver a leer esas credenciales en claro para llamar al ERP.

**Conclusión:** la futura tabla `budun_erp_config` debe cifrar `application_secret` y
`catalog_api_key`/`access_credential` exactamente como `whatsapp_config.access_token`,
reutilizando `encrypt()`/`decrypt()` de `src/lib/whatsapp/encryption.ts` (o extrayendo ese
módulo a una ubicación neutra tipo `src/lib/crypto/secrets.ts` si se prefiere no acoplar
conceptualmente el cifrado genérico al paquete `whatsapp/` — de cualquier forma, **no**
crear un segundo esquema de cifrado).

---

## 7. Settings / Integrations — flujo real encontrado

**No existe hoy una sección "Integrations" ni un sub-árbol de integraciones.** El rail de
Settings es plano por integración:

- `src/components/settings/settings-sections.ts` — `SETTINGS_SECTIONS` (array),
  `SECTION_META` (label/icono/grupo `top|account|workspace`), `RAIL_GROUPS`.
  Secciones actuales del grupo `workspace`: `whatsapp`, `templates`, `quick-replies`,
  `fields`, `deals`, `members`, `api`.
- `src/app/(dashboard)/settings/page.tsx` — mapea cada `SettingsSection` a un componente
  React (`panel: Record<SettingsSection, ReactNode>`).
- Cada integración es un panel independiente con su propio componente
  (`whatsapp-config.tsx` es la plantilla más cercana al caso Budun: credenciales +
  estado de conexión + botón "Test Connection" + botón "Reset/Reconectar").

**Punto de integración futuro (no ejecutar aún):**
1. Añadir `'budun-erp'` (o `'integrations'` como grupo con sub-secciones, a decidir) a
   `SETTINGS_SECTIONS` / `SECTION_META` en `settings-sections.ts`.
2. Nuevo componente `src/components/settings/budun-erp-config.tsx`, calcado de
   `whatsapp-config.tsx`: campos (Base URL, Application ID/App Key, Application Secret,
   Catalog API Key, scopes, estado, última prueba, último error), acciones (Guardar,
   Probar conexión, Rotar, Revocar).
3. Registrar el panel en `panel: Record<...>` de `settings/page.tsx`.
4. No existe un patrón "Rotate" reusable literal (los API keys de WACRM se revocan y se
   crea una nueva, ver `src/app/api/account/api-keys/[id]/route.ts`); "Rotar" para Budun
   probablemente significa: guardar una nueva credencial reemplazando la cifrada
   existente sin cambiar el resto de la fila (mismo patrón que actualizar
   `access_token` en `whatsapp_config`).

Nombrar la sección concreta como **"Budun ERP"** (no "Inventory API") dentro de WACRM,
tal como exige el kit — el nombre genérico `Inventory API` vive solo del lado del ERP.

---

## 8. Media — cómo WACRM envía imágenes hoy

Cadena de envío de medios saliente (confirmada en código):

```
sendMediaMessage({ phoneNumberId, accessToken, to, kind: 'image', link, caption })
   en src/lib/whatsapp/meta-api.ts
        ↑ usado por
src/lib/whatsapp/send-message.ts :: sendMessageToConversation()   (envíos desde el Inbox / API v1)
src/lib/flows/meta-send.ts       :: engineSendMedia()             (envíos desde el motor de Flows/Automations)
```

- Meta exige una **URL pública** (`link`) — WACRM no necesita descargar el binario, solo
  reenviar la URL a la Cloud API. Esto encaja directo con `primary_image.url` /
  `images[].url` del contrato de Budun (URLs absolutas).
- El auto-reply bot (`dispatch InboundToAiReply` en `auto-reply.ts`) **hoy solo llama a
  `engineSendText`** — no tiene ningún camino para enviar media. Para que el agente
  pueda mandar la foto de un producto, el futuro loop de tool-calling deberá, tras
  ejecutar `obtener_producto_budun`/`buscar_producto_budun`, invocar `engineSendMedia`
  (mismo módulo que usa Flows) además de (o en lugar de) la respuesta de texto — hoy esa
  rama no existe y debe construirse.
- `src/lib/media/`, `src/lib/storage/upload-media.ts` gestionan medios **entrantes**
  (inbound) y su cacheo/proxy (`blob-cache.ts`, `download.ts`, `gallery.ts`); no son el
  camino relevante para reenviar una imagen que ya vive en una URL externa del ERP.

Ruta de imágenes propuesta por el spec (`Budun → Tool → Agent → WACRM → WhatsApp`) es
compatible 1:1 con `engineSendMedia(link: producto.primary_image.url)`. La Tool nunca
necesita tocar credenciales de WhatsApp — `engineSendMedia` ya resuelve
`phoneNumberId`/`accessToken` desde `whatsapp_config` internamente.

---

## 9. Knowledge Base vs. Budun Catalog — separación ya coherente con el spec

- `src/lib/ai/knowledge.ts` + `ai_knowledge_chunks`: contenido **estable** (políticas,
  horarios, garantías, FAQ) más, hoy, el volcado estático de inventario subido por
  CSV/Excel/Google Sheets vía `src/lib/ai/inventory-parser.ts` y las rutas
  `src/app/api/ai/knowledge/{upload,sheet,inventory/preview}/route.ts`.
- El propio system prompt (`defaults.ts`) ya llama a este contenido *"Product inventory
  loaded from the business's CSV / Google Sheets files"* y lo trata como única fuente de
  verdad para precio/stock — **este es exactamente el mecanismo que la integración con
  Budun debe complementar (para cuentas con ERP conectado) sin tocarlo** para las cuentas
  que no lo tengan.
- **No implementar** ingestión de catálogo de Budun hacia `ai_knowledge_chunks`: el spec
  lo prohíbe explícitamente y la arquitectura actual ya deja ese camino libre para
  contenido estático; el catálogo dinámico debe resolverse en tiempo de consulta vía
  Tool, no vía RAG.

---

## 10. API client pattern — a reutilizar para el cliente Budun

No hay una librería HTTP compartida (no axios, no un `httpClient` genérico), sino un
patrón consistente repetido en cada integración:

- `src/lib/whatsapp/meta-api.ts`: funciones con **argumentos nombrados** (objeto único,
  ver el comentario de cabecera del archivo — evita bugs de argumentos posicionales
  invertidos), una constante de base URL a nivel de módulo, un helper de error tipado
  (`throwMetaError` — intenta parsear el cuerpo JSON de error de la API, cae a un mensaje
  fallback), y `fetch` nativo (sin librería de retry).
- Timeout: `AbortSignal.timeout(timeoutMs)` (ver `src/lib/ai/providers/anthropic.ts` y
  `defaults.ts::aiRequestTimeoutMs()`, configurable por env var).
- Reintentos: no hay una librería de retry genérica; los reintentos existentes son
  ad-hoc y de dominio específico (p. ej. el retry por variantes de teléfono en
  `send-message.ts`), no un middleware reusable.
- Logging: `console.error`/`console.warn` con prefijo `[modulo]`, **nunca** el secreto
  crudo en el mensaje (ver cómo `whatsapp/config/route.ts` registra el mensaje de error
  de Meta pero no el `access_token`).
- "Test Connection": patrón GET idempotente que descifra la credencial guardada y hace
  una llamada de solo lectura contra el proveedor, devolviendo siempre `200` con un
  `{ connected, reason, message }` estructurado en vez de propagar el status HTTP del
  proveedor (ver `src/app/api/whatsapp/config/route.ts` GET).

**Punto de implementación futuro:** un módulo nuevo `src/lib/budun/client.ts` (nombre
tentativo) calcado de `meta-api.ts` — base URL desde la config de la cuenta (no
hardcodeada, a diferencia de Meta), timeout vía `AbortSignal.timeout`, un tipo de error
propio (`BudunApiError`, mismo espíritu que `AiError`/`SendMessageError`), y sin filtrar
nunca `application_secret`/`catalog_api_key` en logs ni en el mensaje de error devuelto
al cliente.

---

## 11. Tenant / account isolation — mecanismo confirmado

- **Server-side (dashboard/admin):** `src/lib/auth/account.ts::getCurrentAccount()` /
  `requireRole(min)` resuelve `auth.uid()` → `profiles.account_id` +
  `profiles.account_role` → fila de `accounts`. Todas las queries subsecuentes deben
  filtrar explícitamente por ese `accountId`.
- **Server-side (API pública `/api/v1`):** `src/lib/auth/api-context.ts::requireApiKey()`
  resuelve una API key (`wacrm_live_…`) → `accountId` + `scopes` vía
  `src/lib/api-keys/store.ts`. Esto es un mecanismo distinto y **no** es el que debe
  usarse para que el LLM llame a la Tool de Budun (el LLM nunca porta una API key de
  WACRM; el tool-executor server-side ya conoce el `accountId` de la conversación).
- **Base de datos (RLS):** cada tabla "settings-class" (una fila por cuenta) sigue el
  mismo patrón, ejemplificado en `supabase/migrations/029_ai_reply.sql`: `UNIQUE
  (account_id)`, `ENABLE ROW LEVEL SECURITY`, SELECT para `is_account_member(account_id)`
  (viewer+), INSERT/UPDATE/DELETE para `is_account_member(account_id, 'admin')`. El
  motor de auto-reply corre con el cliente `service-role` (sin sesión de usuario), así
  que la RLS protege las lecturas/escrituras del *dashboard*, no el propio motor —
  la tenencia del motor depende de que cada query pase `accountId` explícitamente
  (mismo patrón que `auto-reply.ts` ya sigue).
- **Contexto del agente hacia la Tool:** hoy `dispatchInboundToAiReply(args)` recibe
  `accountId` como parámetro desde el webhook — el futuro tool-executor recibiría el
  mismo `accountId` y lo usaría para cargar `budun_erp_config` de esa cuenta
  exclusivamente. Nunca debe resolverse la cuenta desde algo que el LLM controle (p. ej.
  un parámetro del tool-call) — debe venir siempre del contexto de la conversación/cuenta
  ya autenticada, igual que hoy `loadAiConfig(db, accountId)`.

**Riesgo específico a vigilar en la implementación:** ninguna de las funciones de tool
debe aceptar `account_id`/`tenant_id` como argumento proveniente del LLM; debe inyectarse
server-side desde el contexto de ejecución del auto-reply/playground, exactamente como
ya hace `loadAiConfig`.

---

## 12. Permisos / scopes — mecanismo existente vs. lo que pide el spec

- `src/lib/auth/roles.ts` (roles de cuenta: `viewer < agent < admin < owner`) es lo que
  gobierna quién puede **editar Settings** (`canEditSettings` = admin+, la misma regla
  que ya usa `whatsapp-config.tsx` para gatear el switch de mirror-media). La futura
  pantalla "Settings → Integrations → Budun ERP" debe gatearse igual: admin+ para
  guardar/rotar/revocar, viewer+ puede ver el estado (mismo patrón RLS que
  `ai_configs`/`whatsapp_config`).
- `src/lib/api-keys/scopes.ts` (`API_SCOPES`: `messages:send`, `contacts:read`, …) es el
  sistema de scopes de las API keys **salientes** de WACRM — gobierna qué puede hacer un
  integrador externo contra `/api/v1`. Los scopes que pide el spec para el agente
  (`catalog:read`, `catalog:availability:read`, `catalog:media:read`) **no encajan** en
  este enum: son scopes del lado de Budun/ERP (qué puede leer la credencial que WACRM
  guarda), no scopes de WACRM hacia afuera. Deben modelarse como un campo propio en
  `budun_erp_config` (p. ej. `scopes text[]`) o simplemente documentarse como fijos
  (`catalog:read`, `catalog:availability:read`, `catalog:media:read`, sin UI de edición,
  dado que el spec no permite ampliarlos) — no reutilizar ni extender `API_SCOPES`.

---

## 13. Playground / auto-reply — impacto de la futura Tool

- `src/app/api/ai/playground/route.ts` corre el **mismo pipeline exacto** que
  `auto-reply.ts` (config → knowledge → prompt → generate), sin tocar WhatsApp. El
  criterio de aceptación #14 del spec ("el Playground funciona con datos reales de
  Budun") implica que el futuro loop de tool-calling debe vivir en una función
  compartida por ambos call sites (p. ej. dentro de `generate.ts` o un nuevo
  `src/lib/ai/agent.ts`), no duplicarse entre `auto-reply.ts` y `playground/route.ts`
  como ya evitan duplicar hoy `retrieveKnowledge`/`buildSystemPrompt`.
- `src/app/api/ai/draft/route.ts` ("Draft with AI" en el Inbox, invocado manualmente por
  un agente humano) es un tercer call site del mismo pipeline — también debería heredar
  la capacidad de tool-calling si se decide que el borrador humano también puede
  consultar el catálogo, aunque el spec no lo exige explícitamente.

---

## 14. Puntos exactos donde se implementará después (resumen accionable)

| Pieza | Archivo(s) a crear/tocar (futuro) | Patrón a copiar |
|---|---|---|
| Migración `budun_erp_config` | `supabase/migrations/044_budun_erp_integration.sql` | `029_ai_reply.sql` (RLS admin+/viewer+) |
| Cifrado de credenciales | Reusar `src/lib/whatsapp/encryption.ts` (o extraer a módulo neutro) | ya existente, sin cambios |
| Cliente HTTP Budun | `src/lib/budun/client.ts` (nombre tentativo) | `src/lib/whatsapp/meta-api.ts` |
| Servicio de integración (guarda config, test connection, expone datos ya filtrados al tool-executor) | `src/lib/budun/config.ts`, `src/lib/budun/catalog.ts` | `src/lib/ai/config.ts` + `whatsapp/config/route.ts` GET |
| Settings UI | `src/components/settings/budun-erp-config.tsx` + entrada en `settings-sections.ts` + registro en `settings/page.tsx` | `src/components/settings/whatsapp-config.tsx` |
| API routes de Settings | `src/app/api/integrations/budun-erp/{route.ts,test/route.ts}` (o bajo `/api/budun/config`) | `src/app/api/whatsapp/config/route.ts` |
| Tool-calling loop (pieza mayor, no existe hoy) | extensión de `src/lib/ai/providers/*.ts`, nuevo `src/lib/ai/tools/` | inspirarse en la forma de `mcp-server/src/tools/*` para el shape de cada tool, pero implementación propia — el MCP server no se reusa en runtime |
| Ejecución de las 3 tools | `src/lib/ai/tools/budun-catalog.ts` (`buscar_producto_budun`, `consultar_disponibilidad_budun`, `obtener_producto_budun`) | recibe `accountId` del contexto, nunca del LLM |
| Envío de fotos desde el agente | extender `auto-reply.ts` (hoy solo `engineSendText`) para invocar también `engineSendMedia` de `src/lib/flows/meta-send.ts` cuando la tool devuelva imágenes | `sendMessageToConversation` / `engineSendMedia` ya existentes |
| Prompt del agente | extender `buildSystemPrompt` en `src/lib/ai/defaults.ts` con la regla "usa la Tool de catálogo para precio/stock/color, nunca la inventes" | sección ya existente sobre la KB, mismo estilo |
| Playground | extender `src/app/api/ai/playground/route.ts` para ejercitar el mismo loop de tools | comparte pipeline con `auto-reply.ts` |

---

## 15. Riesgos

1. **Alcance subestimado por el spec.** El mayor riesgo es de ingeniería: el kit da por
   sentado que WACRM ya tiene "AI Agent → Tool" como concepto operativo. En realidad hay
   que construir el tool-calling loop desde cero para tres proveedores de LLM distintos
   (OpenAI, Anthropic, OpenRouter, cada uno con un formato de `tools`/`tool_result`
   diferente), lo cual es sustancialmente más trabajo que "agregar 3 funciones".
2. **Fuga de datos prohibidos.** El contrato exige nunca devolver IMEI/serial/costo/
   margen/proveedor ni siquiera enmascarados. Esto debe filtrarse en el cliente HTTP de
   Budun (server-side), no confiar en que el ERP nunca los envíe ni en que el prompt le
   diga al modelo que los ignore — un campo prohibido que llegue al tool-result ya está
   potencialmente expuesto al LLM (y a logs/tracing).
3. **Fuga de secretos al LLM.** El tool-result que se reinyecta al modelo debe construirse
   a mano (whitelist de campos permitidos), nunca pasar la respuesta cruda del ERP —
   igual de crítico que el punto anterior pero para credenciales en vez de datos de
   negocio, si el ERP algún día incluye metadata de auth en sus respuestas.
4. **Confusión Inventory API (ERP) vs. inventario-en-KB (WACRM).** Ya existe un camino de
   "inventario" en WACRM (CSV/Sheets → Knowledge Base) con su propio vocabulario
   (`sku`, `price`, `stock`) parecido pero no idéntico al contrato de Budun. Hay que
   documentar claramente en el prompt/UI cuál fuente gana cuando ambas están activas para
   una cuenta (el spec sugiere que el catálogo de Budun debe primar sobre la KB estática
   para precio/stock cuando la integración está conectada).
5. **Single-tenant por número de WhatsApp, pero potencialmente multi-cuenta por ERP.**
   `whatsapp_config` ya asume 1 número = 1 cuenta (constraint `UNIQUE(phone_number_id)`
   entre cuentas). Hay que decidir si `budun_erp_config` es estrictamente `UNIQUE
   (account_id)` (una integración Budun por cuenta) — parece razonable y consistente,
   pero debe declararse explícitamente en la migración futura.
6. **Rate limiting del tool-executor.** El sistema ya tiene rate limiting por cuenta para
   el LLM (`RATE_LIMITS.aiAutoReplyAccount`); una tool que dispara una llamada HTTP
   adicional a Budun por cada turno necesita su propio presupuesto (o compartir el
   existente) para no convertir un pico de mensajes en un ataque de facto contra la API
   del ERP del cliente.
7. **Generalización a "otros ERP" pedida por el spec (§13 del prompt).** El código no
   tiene hoy ningún concepto de "proveedor de catálogo" plugueable — construir
   directamente contra "Budun" sin una capa de abstracción mínima (interfaz
   `CatalogProvider`) haría más caro añadir un segundo ERP más adelante. No es bloqueante
   para esta fase, pero conviene decidirlo en el diseño antes de la implementación, no
   durante.

---

## 16. Dependencias

- Variable de entorno ya existente y reutilizable: `ENCRYPTION_KEY` (no se necesita una
  nueva clave de cifrado para Budun).
- Ninguna dependencia npm nueva es necesaria para el cliente HTTP (fetch nativo, como el
  resto del proyecto).
- El loop de tool-calling si el proyecto quisiera evitar reimplementar el formato de
  `tools` de cada proveedor a mano, podría considerar (evaluar en la fase de
  implementación, no ahora) una librería tipo Vercel AI SDK — hoy el proyecto no la usa,
  así que introducirla sería una decisión de arquitectura a validar con el equipo, no
  algo implícito en "seguir los patrones existentes".
- Depende de que la cuenta ya tenga `ai_configs` activo y configurado — la Tool de Budun
  no tiene sentido sin un agente LLM funcionando primero.

---

## 17. Propuesta de implementación (alto nivel, para la fase futura — NO ejecutar ahora)

1. Migración `044_budun_erp_integration.sql`: tabla `budun_erp_config` (uno por
   `account_id`, credenciales cifradas, columnas de estado/última prueba/último error,
   RLS admin+/viewer+ calcada de `029_ai_reply.sql`).
2. `src/lib/budun/encryption` → reusar `src/lib/whatsapp/encryption.ts` sin duplicar.
3. `src/lib/budun/client.ts`: cliente HTTP de solo lectura (Catalog + Availability),
   timeout + manejo de error tipado, sin logging de secretos, calcado de `meta-api.ts`.
4. `src/lib/budun/config.ts`: `loadBudunConfig(db, accountId)` (decrypt) + `testConnection()`,
   calcado de `src/lib/ai/config.ts` + `whatsapp/config/route.ts` GET.
5. Settings: nueva sección en `settings-sections.ts`, componente
   `budun-erp-config.tsx` calcado de `whatsapp-config.tsx`, rutas API bajo
   `/api/integrations/budun-erp/*` (o similar) calcadas de `/api/whatsapp/config`.
6. Tool-calling loop: extender los tres adapters de proveedor (`openai.ts`,
   `anthropic.ts`, `openrouter.ts`) para aceptar/declarar `tools` y manejar la respuesta
   de tool-call; nuevo módulo `src/lib/ai/tools/` con el registro condicional (solo si
   la cuenta tiene Budun conectado) y la ejecución de las tres tools contra
   `src/lib/budun/client.ts`, aplicando la whitelist de campos permitidos antes de
   reinyectar el resultado al modelo.
7. Envío de fotos: extender `auto-reply.ts` (y el futuro loop compartido con
   `playground`) para invocar `engineSendMedia` cuando el resultado de una tool incluya
   `primary_image`/`images`.
8. Prompt: extender `buildSystemPrompt` con la regla de uso obligatorio de la Tool para
   precio/stock/color/variantes, y la prohibición de inventar datos — en el mismo estilo
   que la regla ya existente sobre la Knowledge Base.
9. Tests: seguir la convención `*.test.ts` junto a cada módulo (ver `ai/*.test.ts`,
   `whatsapp/*.test.ts`) — cifrado, guardado de config, test-connection, cada tool,
   no-leakage de campos prohibidos, no-leakage de secretos, aislamiento de tenant,
   permisos.

---

## 18. Confirmación de alcance de esta etapa

- ✅ Se leyeron completos `WACRM_ERP_INVENTORY_API_INTEGRATION_SPEC.md`,
  `WACRM_IMPLEMENTATION_PROMPT.md`, `README.md` (sin modificarlos).
- ✅ Se auditó el código real (no se asumió ningún nombre de archivo sin verificarlo).
- ✅ No se creó ningún modelo, migración, endpoint, tool, componente de UI ni variable de
  entorno nueva.
- ✅ No se modificó ningún archivo funcional del repositorio.
- ✅ Único artefacto producido: este documento
  (`docs/integrations/budun-erp/WACRM_IMPLEMENTATION_ANALYSIS.md`).

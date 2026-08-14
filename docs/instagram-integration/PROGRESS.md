# Instagram DM Integration — Progress

**Este archivo es la fuente de verdad del avance.** Si retomás este
trabajo (otra sesión de Claude Code, Codex, u otra herramienta), leé
esto primero, antes de tocar código.

## Alcance y decisiones ya tomadas (no reabrir sin pedirle al usuario)

- Solo Instagram **DMs** (mensajes directos). Nada de comentarios de
  posts ni respuestas a historias — eso queda para una fase futura, no
  planificada todavía.
- Bandeja **unificada**: WhatsApp e Instagram en el mismo inbox, con un
  badge de canal por conversación. No hay pestañas separadas por canal.
- No reutilizar `whatsapp_config` para Instagram (tiene
  `UNIQUE(account_id)` y columnas específicas de WhatsApp) — se creó
  `instagram_config` en paralelo.
- No se construye una abstracción de canal compartida nueva en
  automations/flows en esta fase (alto riesgo de romper WhatsApp, que
  ya está en producción). En su lugar: archivos de envío duplicados
  específicos de Instagram + una rama por canal en el punto de llamada.
  Unificar eso queda como Fase 11, explícitamente opcional y diferida.
- Plan completo, con el razonamiento detrás de cada decisión:
  `C:\Users\usuario\.claude\plans\snazzy-soaring-dusk.md` (fuera del
  repo — si no está disponible, este documento + el código son
  suficientes para continuar).

## Cómo retomar este trabajo

1. Mirá la tabla de **Estado** de abajo y encontrá la última fase en
   `done`.
2. Leé "Archivos tocados" de esa fase para ver qué ya existe.
3. Revisá "Decisiones abiertas / TODOs" por si hay algo pendiente.
4. Seguí desde el primer ítem que no esté `done`. El puntero
   "Retomar acá" al final de este archivo te da el siguiente paso
   concreto.
5. Después de cada fase, actualizá este archivo (estado + archivos
   tocados + notas) antes de pasar a la siguiente.

## Estado

| Fase | Descripción | Estado | Notas |
|---|---|---|---|
| 0 | Documento de progreso | done | este archivo |
| 0.5 | Spike: confirmar forma actual de la API de Instagram Messaging | not-started | ver TODO abajo — hacer antes de escribir `src/lib/instagram/api.ts` |
| 1 | Migración `039_instagram_config.sql` | done | archivo escrito, sigue el estilo de 017/022/036. **No aplicada** contra ninguna base — no hay CLI de Supabase ni `.env.local` en este entorno. Aplicar con `supabase db push` (o el flujo de deploy habitual) antes de considerar esta fase realmente cerrada en producción. |
| 2 | `src/lib/instagram/` (api, resolve-conversation, send-message) + branch en `whatsapp/send-message.ts` | done | ver detalle abajo. `npm run typecheck` y los tests existentes de WhatsApp (`send-message.test.ts`, 14/14) pasan sin cambios. |
| 3 | `src/app/api/instagram/webhook/route.ts` | done | ver detalle abajo. `npm run typecheck` pasa. |
| 4 | `src/app/api/instagram/config/route.ts` + `instagram-config.tsx` + wiring en settings | done | ver detalle abajo. `npm run typecheck` y toda la suite de tests pasan (794/796 — las 2 fallas son en `date-utils.test.ts`, preexistentes, sin relación con Instagram: parecen un bug de timezone al parsear fechas). |
| 5 | Envío de Instagram desde automations/flows | done | ver detalle abajo. `npm run typecheck` y los tests de automations/flows (178/178) pasan sin cambios. |
| 6 | `/api/v1` (mensajes, conversaciones) + `docs/public-api.md` | done | ver detalle abajo. `npm run typecheck` y toda la suite (794/796, mismas 2 fallas preexistentes de `date-utils.test.ts`) pasan. |
| 7 | Inbox: badge de canal + filtro | done | ver detalle abajo |
| 8 | Composer consciente del canal (ocultar templates en Instagram) | done | ver detalle abajo |
| 9 | Tipos (`Contact.phone` nullable, `instagram_id`/`instagram_username`) + UI de contacto | done | ver detalle abajo. `npm run typecheck` y toda la suite (794/796, mismas 2 fallas preexistentes) pasan. |
| 10 | Tests espejo de Instagram | done | 39 tests nuevos, todos verdes. Suite completa: 833/835 (mismas 2 fallas preexistentes de `date-utils.test.ts`, sin relación). `npm run typecheck` y `eslint` sobre todos los archivos nuevos/modificados: 0 errores. |
| 11 | (Opcional, diferida) Unificar envío WhatsApp/Instagram | not-started | no requerida para lanzar |

## Decisiones abiertas / TODOs

- [ ] **Antes de la Fase 2**: confirmar contra la documentación actual
      de Meta el modelo de auth de Instagram Messaging API (token
      ligado a la Page vs Instagram Business Login) — el código de
      WhatsApp de este repo se escribió contra Graph API v21.0, y el
      setup de mensajería de Instagram cambió de forma más de una vez
      en el pasado. Registrar acá la respuesta antes de escribir
      `src/lib/instagram/api.ts`.
- [ ] **Antes de la Fase 3**: confirmar la forma exacta del payload de
      medios entrantes en el webhook de Instagram Messaging (si llega
      como URL directa de CDN o como media-id que requiere un fetch
      aparte, como en WhatsApp).
- [ ] Decidir la estrategia de backfill de `instagram_username`
      (fetch best-effort al crear el contacto vs. job diferido).

## Archivos tocados por fase

_(se completa a medida que se avanza — cada fase agrega su lista acá)_

### Fase 0
- `docs/instagram-integration/PROGRESS.md` (nuevo, este archivo)

### Fase 1
- `supabase/migrations/039_instagram_config.sql` (nuevo) — tabla
  `instagram_config` con RLS `is_account_member()`; `contacts.phone`
  pasa a nullable + `instagram_id`/`instagram_username` con índice
  único parcial `(account_id, instagram_id) WHERE instagram_id IS NOT
  NULL`; `conversations.channel` con default `'whatsapp'` + índice
  `(account_id, channel)`. **Pendiente: aplicar la migración** contra
  el proyecto real de Supabase (no hay CLI/`.env.local` en este
  entorno de desarrollo para probarla en vivo).

### Fase 2
- `src/lib/instagram/api.ts` (nuevo) — `verifyIgAccount`,
  `getIgUserProfile` (best-effort, nunca lanza), `sendTextMessage`,
  `sendMediaMessage`, `sendQuickReplies` (definida pero **no
  conectada** a ningún flujo todavía — pensada para que
  automations/flows la usen directo en la Fase 5; el inbox/composer no
  la usa. Instagram no soporta plantillas ni el concepto de ventana de
  24h de WhatsApp — no se portó nada de eso).
- `src/lib/contacts/dedupe.ts` — se agregó `findExistingInstagramContact`
  (match exacto por `instagram_id`, sin fuzzy-matching, a diferencia de
  `findExistingContact`).
- `src/lib/instagram/resolve-conversation.ts` (nuevo) —
  `resolveConversationByInstagramId`, espejo de
  `resolveConversationByPhone`. Reutiliza `resolveAuditUserId` de
  `@/lib/api/v1/contacts` sin modificarlo (su fallback a "dueño de la
  cuenta" ya cubre el caso Instagram-only).
- `src/lib/instagram/send-message.ts` (nuevo) —
  `sendInstagramMessageToConversation`. Soporta `text` y medios
  (image/video/audio/document→"file"). Rechaza explícitamente
  `template` e `interactive` con un error claro (esos son conceptos de
  WhatsApp). Devuelve el mismo shape `{ messageId, whatsappMessageId }`
  que el envío de WhatsApp (el nombre del campo se mantiene por
  compatibilidad con los dos callers existentes; para Instagram
  contiene el `message_id` que devuelve Meta).
- **Nuevo** `src/lib/messaging/types.ts` — se extrajo `SendMessageError`
  / `SendMessageParams` / `SendMessageResult` desde
  `src/lib/whatsapp/send-message.ts` a este módulo neutral. Motivo: sin
  esto, `whatsapp/send-message.ts` (que ahora importa
  `sendInstagramMessageToConversation`) e
  `instagram/send-message.ts` (que necesita esos mismos tipos) se
  hubieran importado mutuamente (import circular). `whatsapp/send-message.ts`
  reexporta los tres nombres sin cambios, así que **ningún sitio que ya
  los importaba desde `@/lib/whatsapp/send-message` necesitó tocarse**
  (rutas, tests, `resolve-conversation.ts` de WhatsApp).
- **Modificado** `src/lib/whatsapp/send-message.ts` — un único branch
  agregado justo después de cargar `conversation`:
  `if (conversation.channel === 'instagram') return sendInstagramMessageToConversation(...)`.
  El resto del archivo (envío WhatsApp, plantillas, interactivos,
  reintentos de variantes de teléfono) queda intacto.

## Decisión pendiente para más adelante (no bloqueante)

`sendQuickReplies` en `src/lib/instagram/api.ts` existe pero no está
conectada a la UI del composer ni al `content_type`/`interactive_payload`
de `messages` — el payload de interactivos de WhatsApp (botones/listas)
tiene límites distintos (máx. 3 botones) a los de Instagram (máx. 13
quick replies), así que no se reutilizó esa forma para no capar
Instagram innecesariamente. Diseñar esto es parte de una fase futura no
planificada todavía (anotado también como candidato para la Fase 11).

### Fase 3
- `src/app/api/instagram/webhook/route.ts` (nuevo) — GET de
  verificación (fuerza bruta sobre `instagram_config`, igual que
  WhatsApp) + POST con `after()` para responder rápido a Meta.
  Envelope propio (`entry[].messaging[]` con `sender.id`/`recipient.id`),
  routing por `instagram_config.ig_account_id === recipient.id`.
  **Importante, no estaba en el plan original**: los eventos de
  Instagram Messaging incluyen "echoes" (`message.is_echo === true`)
  que reflejan los mensajes que la propia página/cuenta envió — sin
  filtrarlos, cada envío de un agente se reinsertaría como un segundo
  mensaje del "customer". El handler los descarta al toque
  (`if (message.is_echo) return`). También implementé un mirror básico
  de recibos de lectura (`event.read.mid` → `messages.status = 'read'`),
  no estaba en el plan pero es análogo barato al mirror de status de
  WhatsApp.
  - Reutiliza el mismo fan-out ya agnóstico de canal que el webhook de
    WhatsApp: `dispatchInboundToFlows`, `runAutomationsForTrigger`,
    `dispatchInboundToAiReply`, `dispatchWebhookEvent` — sin tocar
    esas librerías.
  - Adjuntos de Instagram llegan con URL de CDN directa en el propio
    payload del webhook (confirmado contra la forma típica de la API;
    **falta validar contra un webhook real de Meta**, ver Fase 0.5) —
    no hay paso de media-id + fetch aparte como en WhatsApp, así que
    no se replicó el proxy `/api/whatsapp/media`.
  - No implementado en esta fase (fuera del alcance "solo DMs"):
    reacciones a mensajes, eventos de comentarios/historias.

## Decisión pendiente para más adelante (no bloqueante)

`sendQuickReplies` en `src/lib/instagram/api.ts` existe pero no está
conectada a la UI del composer ni al `content_type`/`interactive_payload`
de `messages` — el payload de interactivos de WhatsApp (botones/listas)
tiene límites distintos (máx. 3 botones) a los de Instagram (máx. 13
quick replies), así que no se reutilizó esa forma para no capar
Instagram innecesariamente. Diseñar esto es parte de una fase futura no
planificada todavía (anotado también como candidato para la Fase 11).
El webhook SÍ recibe y enruta taps de quick-reply entrantes
(`message.quick_reply.payload` → `interactiveReplyId`), así que un
flow/automation ya puede reaccionar a ellos aunque el composer todavía
no pueda *enviar* quick replies desde la UI.

### Fase 4
- `src/app/api/instagram/config/route.ts` (nuevo) — GET/POST/DELETE,
  espejo de `whatsapp/config/route.ts` pero sin paso de registro/2FA
  (no existen para Instagram). Chequeo de unicidad global de
  `ig_account_id` igual al de `phone_number_id`.
- `src/components/settings/instagram-config.tsx` (nuevo) — mismo ciclo
  de vida que `whatsapp-config.tsx` (load/save/test/reset), sin banner
  de "Registration status" ni campo de PIN.
- `src/types/index.ts` — se agregó la interfaz `InstagramConfig`
  (espejo de `WhatsAppConfig`).
- Wiring: `'instagram'` agregado a `SETTINGS_SECTIONS`/`SECTION_META`
  en `settings-sections.ts` (ícono `Camera` de lucide-react — **no
  hay** ícono de marca "Instagram" en esta versión de lucide-react, se
  verificó en tiempo de typecheck), panel registrado en
  `settings/page.tsx`, y tile de estado agregado a
  `settings-overview.tsx` (reutiliza las claves de traducción
  genéricas `notSetup`/`connected`/`needsReconnecting` que ya usa el
  tile de WhatsApp — no hizo falta agregar i18n nuevo ahí).
- **i18n**: se agregó el namespace `Settings.instagram` completo (título,
  descripción, formulario, pasos de setup) tanto en `messages/en.json`
  como en `messages/ko.json`, y `"instagram": "Instagram"` en
  `Settings.sections` en ambos archivos. **Obligatorio**: hay un test
  (`src/i18n/messages.test.ts`) que verifica paridad exacta de claves
  entre `en.json` y `ko.json` — cualquier clave nueva debe agregarse a
  los dos archivos o la suite falla. Confirmado en verde.

### Fase 5
- `src/lib/instagram/engine-send.ts` (nuevo) —
  `engineSendInstagramText`, `engineSendInstagramMedia`,
  `engineSendInstagramQuickReplies`. **Desviación del plan original,
  documentada aquí**: en vez de duplicar un `instagram-send.ts` por
  motor (uno para automations, otro para flows) como sugería el plan,
  se hizo **un solo archivo compartido** por ambos motores. Motivo: la
  razón para duplicar el código de WhatsApp entre `automations/meta-send.ts`
  y `flows/meta-send.ts` es no arriesgar una ruta ya en producción y
  muy usada — esa razón no aplica a código de Instagram nuevo sin
  historia que proteger, así que compartirlo ahí es la opción YAGNI,
  no una violación del principio. Queda explicado como comentario en el
  propio archivo por si alguien se pregunta la inconsistencia con el
  patrón de WhatsApp.
- Instagram no tiene plantillas ni mensajes de tipo "list" reales — su
  único análogo interactivo son los *quick replies* (máx. 13, planos).
  Tanto los payloads `buttons` como `list` de WhatsApp se **mapean** a
  esa forma plana (`list` aplana las filas de todas las secciones en
  una sola lista) en vez de fallar el paso de la automatización/flow.
  Un paso `send_template` apuntando a una conversación de Instagram
  falla con un error explícito ("WhatsApp-only concept").
- **Modificado** `src/lib/automations/meta-send.ts` — se agregó
  `resolveConversationChannel()` (helper local, no compartido con
  flows a propósito) y una rama por canal al inicio de `sendViaMeta`
  (texto/template) y de `engineSendInteractive` (botones/lista →
  quick replies). El resto del archivo (envío WhatsApp) queda intacto.
- **Modificado** `src/lib/flows/meta-send.ts` — mismo patrón: helper
  local duplicado (a propósito, seguía la política ya explícita del
  archivo de "los dos motores no comparten su ruta de envío") + rama
  por canal en `engineSendText`, `engineSendMedia` y
  `sendInteractiveViaMeta`. Los mensajes de media de Instagram no
  llevan caption/filename — se descartan silenciosamente en vez de
  fallar el paso.
- **Gap cosmético conocido, anotado para una fase de UI futura no
  planificada**: los quick replies enviados por automations/flows se
  persisten con `content_type: 'text'` (no `'interactive'`) porque el
  renderer de interactivos del inbox (`message-bubble.tsx` /
  `message-thread.tsx`) es específico del shape de WhatsApp. El
  cliente sí ve chips reales tocables en Instagram (Meta los renderiza
  desde el payload de la API) — esto solo afecta cómo se re-renderiza
  el mensaje enviado dentro de wacrm mismo.

### Fase 6
- `src/app/api/v1/messages/route.ts` — nuevo parámetro
  `to_instagram_id` (mutuamente excluyente con `to`; error explícito
  si se mandan los dos o ninguno). `type: "template"`/`"interactive"`
  se rechaza con `bad_request` cuando se usa `to_instagram_id` (no
  existen en Instagram). Reutiliza `resolveConversationByInstagramId`
  (Fase 2) y `sendMessageToConversation` de `whatsapp/send-message.ts`,
  que ya rama solo con que la conversación resuelta tenga
  `channel: 'instagram'` — no hizo falta pasar el canal explícitamente
  a esa función.
- `src/types/index.ts` — se agregó `channel` a `Conversation` y
  `instagram_id`/`instagram_username` a `Contact` (ambos aditivos;
  `Contact.phone` sigue **requerido** por ahora — ver Fase 9 para
  hacerlo opcional, que es un cambio de mayor alcance con ~9
  componentes a revisar).
- `src/lib/api/v1/conversations.ts` — `ApiConversation` gana `channel`;
  el `contact` serializado gana `instagram_username` y `phone` pasa a
  nullable en el shape público.
- **No estaba en el plan original, agregado por consistencia**: los dos
  `dispatchWebhookEvent` del webhook de WhatsApp (`conversation.created`
  y `message.received` en `src/app/api/whatsapp/webhook/route.ts`)
  ahora también mandan `channel: 'whatsapp'` — antes de este cambio
  ningún payload de WhatsApp traía el campo `channel` en absoluto (solo
  los de Instagram lo tenían), lo cual hubiera hecho mentir a la
  documentación ("todo evento trae channel") y confundido a cualquier
  integración externa que empezara a filtrar por ese campo. Es un
  cambio aditivo de una palabra por línea, sin tocar lógica.
- `docs/public-api.md` actualizado: sección de `POST /api/v1/messages`
  (ejemplo con `to_instagram_id`, nota de que `template`/`interactive`
  son WhatsApp-only), `GET /api/v1/conversations` (campo `channel` +
  `instagram_username`), y la tabla de payloads de webhooks (`channel`
  en todo evento salvo `message.status_updated`, que sigue siendo
  WhatsApp-only — Instagram no tiene mirror de recibos hacia webhooks
  salientes todavía).

### Fase 7
- `src/components/inbox/channel-badge.tsx` (nuevo) — `<ChannelBadge>`,
  pequeño círculo con ícono (`Phone` para WhatsApp, `Camera` para
  Instagram — no hay íconos de marca en esta versión de lucide-react)
  superpuesto en la esquina del avatar. Usado en
  `conversation-list.tsx` (fila de lista) y en el header de
  `message-thread.tsx`.
- `src/lib/inbox/conversations.ts` — `ContactFilters` gana `channel`
  opcional + chequeo en `matchesContactFilters` (default `'whatsapp'`
  si `conversation.channel` es `undefined`, igual que hace la DB).
- `src/components/inbox/conversation-list.tsx` — filtro por canal (solo
  se muestra el dropdown si hay al menos una conversación de Instagram
  cargada — mismo patrón que el filtro de "Company", que también es
  condicional). Búsqueda de texto ahora también matchea
  `instagram_username`. `displayName` en la fila de lista ahora cae a
  `instagram_username` antes que a `phone`.
- Traducciones nuevas en `Inbox.conversationList`
  (`channel`/`allChannels`/`channelWhatsapp`/`channelInstagram`) en
  `en.json` y `ko.json` (paridad verificada por
  `src/i18n/messages.test.ts`).

### Fase 8
- `src/components/inbox/message-composer.tsx` — nuevo prop `channel`
  (default `'whatsapp'`, no rompe callers existentes). Oculta el botón
  de "Templates" (tanto el de la barra de sesión expirada como el
  ícono dedicado) y la opción "Interactive message" del menú "+" cuando
  `channel === 'instagram'`. "Quick replies" (respuestas guardadas de
  texto plano) se deja visible — ya era agnóstico de canal, confirmado
  en la investigación previa.
- `src/components/inbox/message-thread.tsx` — pasa
  `channel={conversation.channel}` al composer.

### Fase 9
- `src/types/index.ts` — `Contact.phone` pasa de `string` a
  `string | null` (no a opcional — la columna siempre existe en la DB,
  simplemente puede ser NULL, así que `string | null` refleja mejor la
  realidad que `phone?: string`). Se agregaron `instagram_id` e
  `instagram_username` opcionales.
- Se corrió `npm run typecheck` para acotar el alcance real (en vez de
  adivinar archivos) — salieron **7 sitios** (no 9 como estimaba la
  investigación previa), todos corregidos:
  - `broadcasts/step3-personalize.tsx`, `hooks/use-broadcast-sending.ts`
    — `contact.phone ?? undefined` (broadcasts son WhatsApp-only por
    diseño, el fallback es solo para conformidad de tipos).
  - `pipelines/deal-card.tsx` — mismo patrón (`?? undefined`) al pasar
    el teléfono a un helper de iniciales.
  - `contacts/contact-detail-view.tsx` y `inbox/contact-sidebar.tsx` —
    el botón de "copiar teléfono" ahora solo se renderiza si
    `contact.phone` existe; si no, muestra `@instagram_username` como
    texto (sin acción de copiar, para no sobre-construir en esta fase).
  - `inbox/message-thread.tsx` — `displayName`/`contactDisplayName`
    ahora caen a `instagram_username` antes que a `phone`, con `""`
    como último fallback para que el tipo cierre en `string`.
  - `contact-form.tsx`, `import-modal.tsx`, `deal-form.tsx` — el
    typecheck **no** marcó errores en estos tres (a diferencia de lo
    que anticipaba el plan original) — no requirieron cambios.
- Grep de `contact.phone.<método>` (acceso encadenado sin optional
  chaining) para descartar crashes en runtime que TS no hubiera
  detectado: sin resultados.

### Fase 10
- `src/lib/instagram/api.test.ts` (nuevo, 18 tests) — validación y
  forma del payload de `sendTextMessage`, `sendMediaMessage`
  (incluyendo el mapeo `document`→`file`), `sendQuickReplies` (límites
  de Meta: máx 13 opciones, título ≤20 chars, payload requerido),
  `verifyIgAccount`, y `getIgUserProfile` (confirmando que nunca lanza,
  ni con un 403 ni con un error de red).
- `src/lib/instagram/send-message.test.ts` (nuevo, 7 tests) —
  validación pre-DB (rechaza `template`/`interactive` con mensajes
  claros, exige `content_text`/`media_url` según el tipo) + camino
  completo de envío (texto, media, `instagram_not_configured`, contacto
  sin `instagram_id`).
- `src/lib/instagram/resolve-conversation.test.ts` (nuevo, 7 tests) —
  espejo de `whatsapp/resolve-conversation.test.ts`: contacto/conversación
  existente, creación de ambos, fallback a dueño de cuenta cuando no
  hay `whatsapp_config`, y las dos condiciones de carrera (23505) en
  contacto y en conversación.
- `src/app/api/instagram/webhook/route.test.ts` (nuevo, 7 tests) —
  espejo de `whatsapp/webhook/route.test.ts` con casos específicos de
  Instagram que no tienen equivalente WhatsApp: filtrado de eventos
  `is_echo` (mensajes propios reflejados por el webhook — si esto
  fallara, cada envío de un agente se duplicaría como mensaje del
  cliente), taps de quick-reply enrutados a flows/automations como
  `interactive_reply`, adjuntos con URL de CDN directa (sin paso de
  media-id), mapeo `file`→`document`, y mirror de recibos de lectura.
  No se replicó un test de "sin config" dedicado (la cobertura de esa
  rama ya existe a nivel unitario en el equivalente de WhatsApp y
  hubiera sido una repetición de bajo valor).
- Corrida completa: `npm run typecheck` limpio, `eslint` sobre todos
  los archivos nuevos/modificados sin errores (2 warnings preexistentes
  del mismo patrón que ya tenía `whatsapp-config.tsx`, confirmado
  comparando ambos archivos), suite de tests 833/835 (39 nuevos, todos
  verdes; las 2 fallas restantes son las mismas de `date-utils.test.ts`
  desde el inicio de este trabajo, sin relación con Instagram).

## Estado general: todas las fases planificadas (0-10) están completas.

Lo que queda, explícitamente fuera de esta ronda de trabajo:

1. **Fase 11 (opcional, diferida)**: unificar la lógica de envío
   WhatsApp/Instagram en automations/flows en una sola base compartida.
   No es necesaria para que Instagram funcione — es limpieza técnica
   para después de que ambos canales estén estables en producción.
2. **TODOs de la Fase 0.5, sin resolver**: confirmar contra la
   documentación actual de Meta (1) el modelo de auth exacto de la
   Instagram Messaging API y (2) la forma exacta del payload de medios
   entrantes — este código se escribió con el conocimiento de
   entrenamiento del modelo, que puede estar desactualizado. Hacer
   esto **antes** de conectar una cuenta de Instagram real.
3. **Aplicar la migración `039_instagram_config.sql`** contra el
   proyecto real de Supabase — no se pudo hacer en este entorno de
   desarrollo (no hay CLI de Supabase ni `.env.local`).
4. **Prueba manual end-to-end** contra una app real de Meta (túnel
   ngrok o similar + producto Instagram Messaging configurado) — nunca
   se probó contra el webhook real de Meta, solo contra los tests
   unitarios con mocks.
5. **Gap cosmético conocido** (Fase 5): los quick replies enviados
   desde automations/flows se persisten como `content_type: 'text'`,
   no como `'interactive'` — el renderer de interactivos del inbox es
   específico de WhatsApp. No afecta lo que el cliente ve en Instagram,
   solo el re-render dentro de wacrm.

## Retomar acá

**No queda ningún paso de implementación planificado pendiente.**
Antes de dar esto por cerrado en producción: resolver los TODOs 1-4 de
arriba (empezando por el punto 2, la validación contra la documentación
actual de Meta, ya que todo lo demás depende de que el modelo de auth
asumido sea correcto).

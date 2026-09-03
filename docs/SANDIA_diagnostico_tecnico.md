# SANDÍA — Diagnóstico técnico del repositorio base (wacrm)

**Fecha:** 13 de agosto de 2026
**Repositorio auditado:** `wacrm` (este repositorio)
**Propósito:** diagnóstico previo a cualquier cambio de código, para compartir con Claude Code y alinear la visión de transformación hacia SANDÍA.

---

## Resumen ejecutivo

El repositorio no es un CRM genérico a medio construir: es **wacrm**, un template open source (MIT) de CRM para WhatsApp Business, construido sobre Next.js 16 + Supabase, publicado por un tercero (`ArnasDon/wacrm`) con el modelo de distribución "fork it, brand it, host it" — es decir, pensado para que **cada empresa despliegue su propia instancia**, no para que una sola instancia sirva a múltiples empresas como SaaS.

La buena noticia, y es una noticia muy buena: aunque el modelo de distribución pensado por sus autores es "una instalación por empresa", el 11 de agosto (migración `017_account_sharing.sql` en adelante) el propio proyecto evolucionó su base de datos de "un usuario = sus datos" a **"una cuenta (`accounts`) = un equipo de usuarios con roles, todos los datos aislados por `account_id` vía Row Level Security"**. Eso es, estructuralmente, el mismo mecanismo de aislamiento que necesita SANDÍA para multi-tenancy (cada `account` de wacrm puede convertirse, con trabajo dirigido pero no una reescritura, en una "empresa" de SANDÍA). El riesgo no es que la arquitectura esté mal planteada; es que **nunca fue operada ni probada como SaaS multi-tenant real** (muchas empresas desconocidas entre sí, compartiendo una sola instancia expuesta públicamente), y hay un puñado de huecos concretos que hay que cerrar antes de tratarla como tal.

Veredicto general: **base sólida, con deuda técnica localizada y conocida (no oculta)**. El código muestra un nivel de disciplina inusual para un template gratuito — comentarios explícitos sobre riesgos de tenancy, dos vulnerabilidades cross-tenant reales que ya fueron encontradas y corregidas por sus autores (evidencia de que sí se pensó en esto en serio), tests unitarios en los módulos más delicados (broadcasts, flows, automations). No hay que reconstruir el CRM. Hay que: (1) cerrar los huecos de aislamiento multi-tenant que quedan, (2) decidir el modelo de negocio "empresa" sobre `accounts`, (3) añadir lo que falta para el objetivo de SANDÍA (productos/inventario, temperatura de leads, eventos hacia n8n más ricos, planes/facturación), y (4) endurecer un par de piezas pensadas solo para una instancia (rate limiting, CSP).

---

## A. Stack tecnológico actual

- **Frontend/Backend:** Next.js 16 (App Router), React 19, TypeScript estricto, Tailwind v4. Un único framework full-stack — no hay backend separado.
- **Base de datos / Auth / Storage:** Supabase (Postgres + Supabase Auth + Supabase Storage + Row Level Security). Sin ORM: se usa el cliente `@supabase/supabase-js` / `@supabase/ssr` directamente, con RLS como capa de aislamiento de datos.
- **UI:** shadcn/ui + Tailwind, `@dnd-kit` (Kanban de pipeline), `@xyflow/react` + `@dagrejs/dagre` (constructor visual de flujos conversacionales), `recharts` (dashboard), `next-intl` (i18n — hay `messages/en.json` y `messages/ko.json`, sin español todavía).
- **WhatsApp:** integración directa con Meta Cloud API (WhatsApp Business API oficial), no con proveedores intermedios tipo Twilio/360dialog.
- **IA:** integración directa con APIs de OpenAI y Anthropic (el usuario final de wacrm trae su propia clave), no hay orquestador tipo LangChain.
- **Automatización:** motor propio (no depende de n8n todavía) para "Flows" (conversacional) y "Automations" (eventos), más un sistema de webhooks salientes genérico.
- **API pública:** REST en `/api/v1` con API keys propias por cuenta.
- **MCP server:** paquete Node separado (`mcp-server/`) que expone el CRM como herramientas MCP para asistentes de IA (Claude, Cursor, etc.), consumiendo la propia API pública.
- **Testing:** Vitest, con pruebas unitarias reales en los módulos críticos (middleware de auth, broadcasts, automations parciales, i18n).
- **Despliegue previsto por el template:** Hostinger/VPS/Docker — sin infraestructura de contenedores múltiples ni orquestación; pensado para una sola instancia Node.

## B. Arquitectura actual

Arquitectura monolítica Next.js clásica: páginas y layouts en `src/app/`, lógica de negocio en `src/lib/` organizada por dominio (contacts, conversations, whatsapp, ai, flows, automations, webhooks, api-keys, auth, supabase), componentes de UI en `src/components/` reflejando los mismos dominios. No hay microservicios ni colas externas: los "workers" son endpoints cron (`/api/automations/cron`, `/api/flows/cron`) invocados externamente (típicamente por un scheduler del hosting), y el envío masivo de broadcasts se resuelve con locks optimistas en base de datos, no con una cola real (Redis/SQS).

La autorización está implementada en tres capas independientes y consistentes entre sí: guardas de UI (ocultar botones), verificación de rol en cada endpoint (`requireRole()`/`requireApiKey()`), y políticas RLS en Postgres (`is_account_member()`). Esto es exactamente el patrón de "no confiar solo en el frontend" que se pidió — ya está aplicado, no hay que introducirlo desde cero.

No existen Server Actions de Next.js; todas las mutaciones pasan por Route Handlers (`src/app/api/**/route.ts`), lo cual es positivo para SANDÍA porque son más fáciles de versionar como API y de exponer también a n8n/integraciones externas.

## C. Estructura de carpetas (resumen)

```
src/app/(auth)/          páginas de login, signup, forgot-password
src/app/(dashboard)/     páginas protegidas: inbox, contacts, pipelines, broadcasts, flows, automations, agents, settings
src/app/api/             ~54 route handlers: account, ai, automations, contacts, flows, invitations, quick-replies, v1 (API pública), whatsapp
src/app/join/            flujo de aceptación de invitación a una cuenta
src/components/          UI por dominio (contacts, inbox, pipelines, broadcasts, flows, automations, agents, settings, interactive, presence, auth, layout)
src/lib/                 lógica de negocio por dominio (mismos nombres que components), + auth/, supabase/, api-keys/, webhooks/, media/, rate-limit.ts
supabase/migrations/     38 migraciones SQL numeradas, aplicadas en orden — es el "schema as code" del proyecto
mcp-server/              paquete Node independiente, servidor MCP
messages/                strings i18n (en, ko)
docs/                    documentación de docker, mcp, API pública
```

## D. Base de datos y modelos

El esquema vive en 38 migraciones SQL versionadas (`supabase/migrations/001` a `038`), aplicadas de forma idempotente. Esto es en sí mismo una buena práctica que hay que conservar (nada de "editar el schema a mano en el panel de Supabase").

**Modelo original (migración 001):** cada tabla (`contacts`, `conversations`, `messages`, `deals`, `pipelines`, `broadcasts`, `whatsapp_config`, etc.) tenía un `user_id` referenciando `auth.users`, con RLS del tipo `USING (auth.uid() = user_id)`. Es decir: nació como CRM de un solo usuario por instancia.

**Punto de inflexión (migración 017, "account_sharing"):** se introduce la tabla `accounts` (equipo/empresa) y `account_invitations`. Cada `profiles` pasa a tener `account_id` + `account_role` (`owner > admin > agent > viewer`). **Todas** las tablas de negocio reciben una columna `account_id`, se retro-llenan los datos existentes, y **todas las políticas RLS antiguas basadas en `user_id` se eliminan y se reemplazan** por políticas basadas en `is_account_member(account_id, rol_mínimo)`. La columna `user_id` se conserva en algunas tablas solo como referencia de auditoría/asignación (quién creó o quién tiene asignado un registro), nunca como mecanismo de aislamiento.

Esto es, literalmente, la migración de "single-tenant por usuario" a "multi-tenant por cuenta" — el mismo movimiento conceptual que exige la multi-tenancy de SANDÍA. La tabla `accounts` de wacrm **es** candidata directa a representar "empresa" en SANDÍA.

**Diseño deliberado: un usuario pertenece a una sola cuenta, siempre.** No es una tabla intermedia de membresías (`account_members`) sino una columna escalar en `profiles`, reforzada con un índice único (`un usuario = como máximo una cuenta propia`) y un trigger que impide cambiarla por fuera de las funciones autorizadas. Esto encaja perfectamente con "cada empresa tiene sus propios usuarios", sin necesidad de rediseñar el modelo — si mañana SANDÍA necesitara que un usuario trabaje para dos empresas a la vez, eso sí requeriría una migración real (tabla de membresías).

**Otras tablas relevantes ya existentes:** `whatsapp_config` (1 número de WhatsApp por cuenta — ver limitación en sección I), `message_templates`, `api_keys` (por cuenta, hash SHA-256), `webhook_endpoints` (salientes, firmados con HMAC), `notifications`, `flows`/`flow_nodes`/`flow_runs` (motor conversacional), `automations`/`automation_steps`/`automation_logs` (motor de eventos), `ai_configs`, `ai_knowledge_documents`/`ai_knowledge_chunks` (con `pgvector`, búsqueda híbrida léxica+semántica), `ai_usage_log`, `member_presence`.

**Lo que NO existe en el esquema actual (confirmado por búsqueda exhaustiva en el código):** ningún concepto de producto, catálogo, SKU, precio, costo, inventario, ni facturación/FEL. Cero superficie de "comercio". Esto es esperable — wacrm es un CRM conversacional puro — y es exactamente el área donde SANDÍA más se aparta del punto de partida.

## E. Sistema de autenticación

Supabase Auth, email/contraseña únicamente (sin login social ni magic link todavía). Sesiones vía cookies HttpOnly gestionadas con `@supabase/ssr`. El middleware (`src/middleware.ts`) refresca el token en cada request y tiene una solución específica, con tests, para un bug conocido de la librería (las cookies rotadas no sobrevivían a un redirect). Cubre con un allowlist de rutas protegidas (`/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings`) — **`/flows` falta en esa lista** (hallazgo menor, ver sección K). Las rutas de API no dependen del middleware: cada endpoint valida sesión/rol por su cuenta, y se confirmó que efectivamente lo hacen de forma consistente.

El trigger de registro (`handle_new_user`) crea automáticamente una cuenta (`accounts`) y un perfil `owner` para cada nuevo usuario que se registra. Esto es clave: **si el registro público está abierto, cada persona que se registra hoy ya se convierte en el "owner" de su propia empresa aislada** — el comportamiento multi-tenant ya ocurre de facto, aunque el README del proyecto no lo presente así.

## F. Sistema de autorización / permisos

Cuatro roles jerárquicos por cuenta: `owner > admin > agent > viewer`, definidos en un único lugar (`src/lib/auth/roles.ts`) y usados de forma consistente en frontend, backend y base de datos (triple capa, sección B). Ejemplos concretos verificados: enviar un mensaje de WhatsApp requiere rol `agent+` verificado *antes* de llamar a la API de Meta (no solo antes de escribir en base de datos, evitando que un `viewer` dispare un envío real aunque el insert posterior fallara por RLS); cambiar de dueño de cuenta requiere rol `owner` y pasa por una función `SECURITY DEFINER` que revalida todo server-side.

No es un sistema de permisos "de juguete" pensado solo para ocultar botones — es el nivel de rigor que SANDÍA necesita para separar Administrador / Vendedor / Otros usuarios internos prácticamente tal cual.

## G. Funcionalidades actuales del CRM

Todas verificadas leyendo el código real, no solo el README:

- **Contactos:** CRUD, deduplicación por teléfono normalizado, tags, campos personalizados, importación CSV con detección de duplicados. Maduro.
- **Bandeja compartida (inbox):** hilo de conversación en tiempo real, asignación a vendedor, notas, medios, respuestas rápidas, plantillas, reapertura automática al recibir un mensaje nuevo en una conversación cerrada. Maduro.
- **Pipelines / negociaciones (deals):** Kanban con drag-and-drop, **ya soporta múltiples pipelines con etapas configurables** (nombre, orden, color) — prácticamente completo.
- **Broadcasts (difusión masiva):** asistente de 4 pasos, motor de envío con reintentos, reanudación tras interrupción mediante locks distribuidos, deduplicación de destinatarios. Nivel de madurez notablemente alto para un CRM template gratuito.
- **Flows (constructor visual conversacional):** máquina de estados por conversación — botones, listas, captura de datos del cliente, condiciones, envío de medios, transferencia a humano (`handoff`). Es, en esencia, el motor de "bot conversacional guiado" que necesita SANDÍA (agendar, capturar datos, transferir a vendedor).
- **Automations (motor de eventos):** disparadores (mensaje nuevo, contacto nuevo, tag añadido, tiempo, respuesta a botón/lista) y acciones (enviar mensaje/plantilla, asignar conversación, actualizar campo, crear negociación, webhook saliente, esperar). Incluye ramas condicionales y ejecución diferida. Maduro.
- **IA (respuesta asistida):** genera respuestas de un solo turno, con base de conocimiento propia (RAG híbrido léxico+semántico sobre `pgvector`), transferencia automática a humano cuando corresponde, límite de respuestas automáticas por conversación, registro de consumo de tokens por cuenta. **Importante:** hoy la IA solo *redacta texto* — no ejecuta acciones (no crea clientes, no modifica pipeline, no consulta inventario porque no hay inventario). Este es el mayor gap frente a la visión de SANDÍA, aunque la base de recuperación de conocimiento y el sistema de permisos por rol ya están.
- **WhatsApp:** envío/recepción vía Meta Cloud API, gestión de plantillas (ciclo completo con Meta), mensajes interactivos (botones/listas), un número de WhatsApp por cuenta.
- **Dashboard:** métricas reales calculadas (no decorativas): conversaciones activas, contactos nuevos, valor de pipeline abierto, tiempo de respuesta por día de la semana, feed de actividad.
- **API pública + MCP server:** API REST con claves con alcance (scopes) por cuenta, y un servidor MCP de solo lectura por defecto que ya permite conectar SANDÍA a asistentes de IA externos.
- **Webhooks salientes:** solo 3 eventos hoy (`message.received`, `message.status_updated`, `conversation.created`), firmados con HMAC, protegidos contra SSRF — listo para conectar a n8n, pero el catálogo de eventos es mucho más chico que lo necesario (falta: nuevo lead, cambio de etapa, venta ganada/perdida, cliente inactivo, cotización creada).

## H. Qué ya cumple con los objetivos de SANDÍA

- Aislamiento de datos por empresa (`account_id` + RLS) — la base exacta que exige la multi-tenancy.
- Roles owner/admin/agent/viewer — mapea directo a Administrador/Vendedor.
- Pipeline Kanban configurable con múltiples pipelines — prácticamente completo.
- Bandeja de WhatsApp con identificación de conversación/contacto/cuenta.
- Motor de automatizaciones con webhooks salientes (falta ampliar catálogo de eventos).
- IA con base de conocimiento propia y transferencia a humano (falta capacidad de acción, no solo de respuesta).
- Seguridad de secretos (cifrado AES-256-GCM de tokens/claves) y disciplina de autorización en tres capas.

## I. Qué funcionalidades necesitan modificación

1. **Temperatura del cliente:** no existe como campo. Hay que agregar una columna/tabla de clasificación (frío/tibio/caliente) en `contacts`, inicialmente manual y luego calculable. Cambio de bajo riesgo, no toca el núcleo.
2. **Un número de WhatsApp por cuenta (hoy es un límite duro, con `UNIQUE(account_id)`):** la visión de SANDÍA permite varios números por empresa, asociados a distintos departamentos/flujos. Requiere quitar esa restricción única y añadir un identificador de "número principal", más lógica para enrutar conversaciones al número correcto. Complejidad media, ya anticipado en un comentario del propio código ("si algún día se necesita, quitar el unique y agregar un booleano `primary`").
3. **IA con capacidad de acción, no solo de respuesta:** hoy el asistente de IA no puede crear/actualizar clientes, consultar inventario ni generar cotizaciones porque esas funciones no existen o no están conectadas al motor de IA. Hay que definir explícitamente qué "herramientas" puede invocar la IA y con qué permisos configurables — probablemente reutilizando el mismo motor de "steps" que ya tienen Automations, exponiéndolo como tool-calling.
4. **Catálogo de eventos hacia n8n:** ampliar de 3 a ~9 eventos (nuevo lead, cambio de etapa, venta ganada/perdida, cliente inactivo, cotización creada, seguimiento pendiente). El código ya deja dicho que "extender esto es una entrada más" — trabajo incremental, no rediseño.
5. **Rate limiting:** hoy vive en memoria de un solo proceso Node — funciona para una instancia, pero se vuelve inefectivo si SANDÍA corre en más de una instancia (necesario para escalar). Hay que moverlo a un store compartido (Redis/Upstash); el propio código ya deja la interfaz lista para ese cambio.
6. **CSP (Content-Security-Policy):** actualmente solo en modo "Report-Only" (registra violaciones pero no bloquea nada) y permite `unsafe-inline`/`unsafe-eval`. Aceptable para una instancia por empresa; insuficiente para un SaaS que aloja el contenido de muchas empresas distintas en el mismo origen — hay que pasar a modo enforcing con nonces antes de escalar a multi-tenant real.
7. **Renombrar/reencuadrar `accounts` como "empresas":** no es un cambio de esquema grande, pero sí conviene decidir pronto la nomenclatura y si se necesitan campos adicionales de empresa (NIT, dirección, moneda por defecto — este último ya existe, `default_currency` se agregó en la migración 021).

## J. Qué funcionalidades faltan por completo

- **Productos, categorías, SKU, precios, costos, inventario, stock mínimo, variantes, imágenes de producto.** No existe absolutamente nada de esto hoy — es la brecha más grande frente a la visión de SANDÍA como "centro operativo comercial".
- **Cotizaciones** (generación, envío, seguimiento) — depende de que exista el catálogo de productos primero.
- **Registro de ventas cerradas** como entidad propia (hoy solo existe "deal ganado/perdido" dentro del pipeline, sin vínculo a productos ni a un total de venta desglosado).
- **Modelo de planes/límites/consumo/facturación SaaS:** no existe ningún concepto de plan, límite de usuarios, límite de números de WhatsApp, ni medición de conversaciones para cobrar por consumo. Hoy todo es "todo lo que la cuenta quiera usar".
- **Panel de super-administrador de la plataforma** (para el operador de SANDÍA, no para cada empresa): no existe ninguna vista que liste todas las cuentas/empresas, su plan, su consumo, ni permita administrar el SaaS desde arriba. Es 100% nuevo.
- **Detección de temperatura por IA basada en señales de comportamiento** (frecuencia de mensajes, preguntas de precio, tiempo desde última interacción) — depende de que primero exista el campo de temperatura (I.1).
- **Preparación explícita para SAT FEL:** no hay ninguna tabla de facturas/documentos tributarios. Correcto no construirla todavía, pero conviene reservar el espacio de nombres (`invoices`, `tax_documents`) y no chocar con nada existente — el terreno está limpio.
- **UI de gestión de webhooks salientes:** existe la API (`/api/v1/webhooks`) pero no hay pantalla en Settings para que un usuario no técnico los configure — hoy solo se puede hacer vía API/Postman.
- **Español:** el proyecto solo tiene mensajes de i18n en inglés y coreano. Hay que agregar el paquete de español (Guatemala) desde el inicio.

## K. Problemas de seguridad detectados

Ninguno de nivel crítico. En orden de severidad:

1. **(Media)** Rate limiting en memoria de un solo proceso — deja de funcionar en cuanto SANDÍA corra en más de una instancia; protege hoy las claves compartidas de Meta/IA de abuso, así que hay que resolverlo *antes* de escalar horizontalmente, no después.
2. **(Media)** CSP en modo "solo reporte", con `unsafe-inline`/`unsafe-eval` permitidos incluso cuando se active — sin mitigación real de XSS. Relevante especialmente porque en un SaaS multi-tenant, un bug de XSS en un campo de una empresa podría, en teoría, afectar la sesión de un usuario de esa misma empresa (no cruza cuentas por sí solo, pero conviene cerrarlo antes de tener muchas empresas confiando en la plataforma).
3. **(Baja)** Dos funciones de base de datos (`recompute_broadcast_counts`, `_bcast_bump`) y otras dos (`record_webhook_failure`, `claim_ai_reply_slot`) no tienen explícitamente revocado el permiso de ejecución público — en una instalación de Supabase no endurecida, cualquier usuario autenticado *de cualquier cuenta* podría, en teoría, alterar contadores de otra cuenta (no leer datos, solo corromper contadores/desactivar un webhook ajeno). Es una inconsistencia de "olvido", no de diseño — el resto de funciones similares sí tienen el `REVOKE` correcto. Corrección puntual, de una tarde.
4. **(Baja)** El webhook de actualización de estado de mensajes de WhatsApp busca el mensaje por `message_id` de Meta sin filtrar también por cuenta — inofensivo hoy (una sola app de Meta por instancia), pero en un SaaS con muchas empresas y muchos números de WhatsApp detrás de una sola instalación, una colisión de ID (rara pero posible) podría aplicar una actualización de estado al mensaje equivocado. Se corrige agregando el filtro de cuenta a esa consulta.
5. **(Baja)** El proxy de descarga de medios de WhatsApp no verifica explícitamente que el medio solicitado pertenezca a un mensaje de la cuenta que lo pide (se apoya en que el token de Meta ya está limitado a esa cuenta). Conviene añadir la verificación explícita por consistencia con el resto del código.
6. **(Informativo, no vulnerabilidad de código)** El archivo `.env` local de este repositorio contiene valores que parecen reales de `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` y `META_APP_SECRET`. Está correctamente excluido de git, pero conviene rotarlos antes de usarlos en un entorno de producción real y no compartir ese archivo.

Dato relevante: los propios autores del proyecto **ya encontraron y corrigieron dos vulnerabilidades reales de fuga entre cuentas** (una función RPC de búsqueda en la base de conocimiento de IA que permitía leer el conocimiento de otra empresa pasando su ID manualmente; y una política de actualización de perfil que permitía auto-promoverse a `owner` o saltar de cuenta editando columnas directamente). Ambas están documentadas como CVE/GHSA y corregidas en migraciones posteriores. Es una señal fuerte de que el modelo sí fue sometido a un pensamiento de amenaza multi-tenant real, no solo de "confío en que nadie lo intente".

## L. Problemas de arquitectura

- El sistema de colas para tareas diferidas (esperas en automations, reanudación de broadcasts) depende de endpoints cron llamados externamente, no de un scheduler propio. Funciona, pero es un punto a decidir explícitamente en el despliegue de SANDÍA (quién dispara esos crons: el propio hosting, o un servicio dedicado).
- No hay separación entre "capa de plataforma" (operador de SANDÍA) y "capa de cuenta" (cada empresa cliente) — todo el código asume que quien opera la instancia es también el único dueño. Para SANDÍA como SaaS hace falta introducir ese segundo nivel (rol "platform admin" fuera del esquema de roles por cuenta actual).
- El límite de "un número de WhatsApp por cuenta" está reforzado a nivel de base de datos (constraint único), no solo de UI — es fácil de quitar pero hay que hacerlo con una migración cuidada, no solo cambiando el frontend.
- La lógica de negocio está bien separada por dominio en `src/lib/`, lo cual facilita agregar el dominio nuevo de "productos/inventario" sin tocar los demás.

## M. Deuda técnica

- Columna `profiles.role` (heredada, distinta de `account_role`) marcada en el propio código como candidata a eliminar — riesgo de confusión para quien no conozca la historia.
- Plantillas de WhatsApp todavía usan una restricción de unicidad basada en `user_id` en vez de `account_id` (documentado como `TODO` en el propio código) — no es una fuga de datos, pero puede causar plantillas duplicadas entre compañeros de una misma cuenta.
- Métricas del dashboard se calculan en el cliente con consultas Supabase directas, no con funciones agregadas en base de datos — aceptable a la escala actual, pero es lo primero que hay que revisar si el dashboard se vuelve lento con más datos por empresa.
- Contraseña mínima de 6 caracteres en el registro — vale la pena subir el estándar.

## N. Riesgos para convertir esto en un SaaS multi-tenant real

1. **Riesgo de negocio, no técnico:** legalmente este es un fork de un proyecto MIT de un tercero (`ArnasDon/wacrm`). La licencia MIT permite exactamente lo que se quiere hacer (usar, modificar, comercializar), pero conviene mantener el aviso de licencia/atribución conforme al MIT y decidir desde ya el branding definitivo, para evitar cualquier confusión de marca con el proyecto original.
2. El proyecto nunca fue probado bajo carga real de "muchas empresas desconocidas entre sí" — los hallazgos de la sección K son exactamente el tipo de cosas que solo importan a esa escala, y hay que cerrarlas antes de vender al primer grupo de clientes reales.
3. Rate limiting y CSP (K.1 y K.2) son bloqueantes reales para escalar horizontalmente — no se puede correr SANDÍA en más de una instancia hasta resolver el primero.
4. No existe hoy un panel de operador de plataforma ni un modelo de planes — esto es trabajo 100% nuevo, no una adaptación, y probablemente el bloque de mayor tamaño de todo el plan.
5. El dominio de "comercio" (productos, precios, inventario, cotizaciones, ventas) es enteramente nuevo y es el corazón de lo que diferencia a SANDÍA de un simple "inbox de WhatsApp con CRM" — hay que diseñarlo con cuidado para que conviva bien con Pipeline/Deals sin duplicar conceptos.

## O. Recomendación de arquitectura futura

Mantener el stack (Next.js + Supabase + RLS) — es la decisión correcta y coincide con el principio de "no sobreingeniería". No se necesita microservicios, no se necesita un backend separado, no se necesita cambiar de base de datos. Recomendaciones concretas:

- **Renombrar conceptualmente `accounts` → "empresas"** en el código y la UI (puede mantenerse el nombre de tabla `accounts` para minimizar el churn de migraciones, o migrarse en una fase posterior si el equipo lo prefiere).
- **Introducir un rol de "platform admin"** fuera del esquema de roles por cuenta, con su propio panel, para que el operador de SANDÍA administre empresas, planes y consumo sin ser miembro de ninguna cuenta de cliente.
- **Nuevo dominio "commerce"** (`products`, `product_categories`, `inventory`, `quotes`/`quote_items`) siguiendo el mismo patrón de `account_id` + RLS que ya usa el resto del esquema — es aplicar la fórmula ya probada, no inventar una nueva.
- **Exponer productos/precios/inventario como "herramientas" del asistente de IA**, reutilizando el motor de permisos por rol ya existente para decidir qué puede hacer la IA sola vs. qué requiere confirmación humana.
- **Ampliar el catálogo de eventos salientes** (webhooks) para cubrir el ciclo comercial completo, dejando a n8n la orquestación de automatizaciones complejas en vez de construirlas todas dentro de SANDÍA.
- **Mover rate limiting a Redis/Upstash** antes de cualquier despliegue multi-instancia.
- **Endurecer CSP a modo enforcing con nonces** antes de recibir datos de clientes reales de producción.

## P. Plan de implementación por fases

**Fase 0 — Cierre de seguridad y housekeeping (1–2 semanas).**
Corregir los hallazgos de la sección K (permisos de funciones SQL, filtro de cuenta en webhook de estado, verificación de medios), decidir y documentar la política de licencia/atribución MIT, añadir `/flows` a las rutas protegidas del middleware, subir el mínimo de contraseña. Bajo riesgo, alto valor — deja la base limpia antes de construir encima.

**Fase 1 — SANDÍA como SaaS multi-tenant operable (2–4 semanas).**
Renombrar/reencuadrar `accounts` como empresas en la UI, construir el panel de "platform admin" (listado de empresas, estado, consumo básico), mover rate limiting a un store compartido, pasar CSP a enforcing. Al final de esta fase, SANDÍA puede alojar de forma segura a varias empresas reales en una sola instancia.

**Fase 2 — Núcleo CRM alineado a la visión (2–3 semanas).**
Campo de temperatura de cliente (manual primero), múltiples números de WhatsApp por empresa, UI de gestión de webhooks salientes en Settings, ampliación del catálogo de eventos hacia n8n, paquete de idioma español.

**Fase 3 — Comercio: productos, inventario, cotizaciones (3–5 semanas).**
Nuevo dominio `commerce` completo (productos, categorías, precios, costos, inventario, variantes), vínculo con Deals/Pipeline, generación de cotizaciones. Es el bloque más grande y el que más se aparta del código existente.

**Fase 4 — IA con capacidad de acción (2–4 semanas, en paralelo o después de la Fase 3).**
Exponer productos/precios/inventario/creación de clientes como "herramientas" que la IA puede invocar, con el sistema de permisos configurable por acción (consultar = permitido, dar descuento = configurable, etc.), cálculo automático de temperatura basado en señales de conversación.

**Fase 5 — Modelo comercial de SANDÍA (2–3 semanas).**
Planes, límites (usuarios, números de WhatsApp, conversaciones/mes), medición de consumo, y solo entonces la lógica de cobro — sin hardcodear los precios Q150/Q350/Q65 compartidos por el negocio, tratándolos como configuración.

**Fase 6 — Preparación (no implementación) de SAT FEL.**
Reservar modelo de datos (`invoices`, `tax_documents`) y puntos de extensión, sin construir la integración con el certificador todavía.

---

## Actualizaciones posteriores al diagnóstico

Cambios de código hechos **después** del corte del 13 de agosto de 2026. El
cuerpo del diagnóstico (secciones A–P) se mantiene como foto histórica; esta
sección registra lo que ya cambió.

### 2026-09-02 — Mensajes de seguimiento automáticos ("follow-up sweeper")

**Estado:** PR #33 fusionado a `main` (`1d35e4d`). Migración `099_ai_followups.sql`
**aplicada a producción**. Falta: desplegar la app, registrar el cron
(`100_schedule_followups_cron.sql`) y definir `FOLLOWUPS_CRON_SECRET` (cae a
`AUTOMATION_CRON_SECRET`). Hasta registrar el cron, el heartbeat `followups_cron`
marca "never" y dispara una alerta de nivel *warning*.

**Qué resuelve.** La IA solo se ejecuta ante un mensaje **entrante**
(`dispatchInboundToAiReply` se invoca desde los webhooks). Una instrucción en el
system prompt del tipo "escríbele al cliente una hora después de que dejó de
responder" nunca podía dispararse: no hay entrante que la active. Ahora un
barrido programado la ejecuta.

**Cómo funciona.** `GET /api/ai/followups/cron` (cada ~5 min, mismo patrón
`x-cron-secret` que automations/flows) → `src/lib/ai/followups-sweep.ts`. Para
cada cuenta con seguimientos activos, recorre sus conversaciones de WhatsApp
**abiertas, sin asignar, sin handoff, con auto-reply no desactivado**, donde el
último mensaje es nuestro y hay un entrante real como ancla, y no hay
`schedule_appointment` en `ai_action_log` para el contacto ni un `flow_run`
activo. Envía el siguiente paso vencido y registra el intento. Los pasos de
texto libre se omiten pasada la ventana de 24 h de WhatsApp (las plantillas
siguen saliendo). Lógica pura y testeada en `src/lib/ai/followups.ts`
(`nextDueFollowup`, `withinBusinessHours`, `parseFollowupSteps`,
`renderFollowupText`).

**Dónde se guarda la programación de los mensajes** (la respuesta directa a
"dónde quedó almacenado para programar los mensajes después de cierto tiempo"):

- **`ai_configs`** (una fila por cuenta) — la configuración editable en
  Settings → IA → "Mensajes de seguimiento" (`ai-followups-card.tsx`), guardada
  vía `POST /api/ai/config`:
  - `followups_enabled` (`boolean`) — interruptor maestro.
  - `followups` (`jsonb`) — **el arreglo ordenado de pasos**. Cada paso:
    `{ after_minutes, type: 'text' | 'template', text, template_name, template_language }`.
    `after_minutes` es la espera **desde el mensaje anterior** (el último
    entrante para el paso 0; el envío del paso previo para los siguientes).
    Máx. 5 pasos; `after_minutes` entre 15 y 20 160 (14 días). Validado en
    `parseFollowupSteps`.
  - `followups_business_hours_only` (`boolean`) + `followups_window_start_hour` /
    `followups_window_end_hour` (`smallint`, 0–24, hora local de la cuenta vía
    `accounts.timezone`) — ventana de horario laboral. Iguales = sin restricción.
- **`ai_followup_log`** (tabla nueva) — una fila por **intento** (éxito o
  fallo): `account_id, conversation_id, contact_id, step_index, step_type,
  message_id, error, since_customer_at, sent_at`. Índice único
  `(conversation_id, since_customer_at, step_index)`. Es lo que hace que cada
  paso se dispare **una sola vez** por racha de silencio y que un nuevo entrante
  del cliente **reinicie** la secuencia (las filas viejas quedan detrás del
  nuevo `since_customer_at`).

**No hay una fila de "run_at" precalculada** como en Automations
(`automation_pending_executions`). El "cuándo toca" se calcula en cada tick a
partir de los timestamps de `messages` y de `ai_followup_log`; solo la
*definición* de los pasos y sus esperas vive en `ai_configs.followups`.

**Relación con el diagnóstico.** Cubre parcialmente el hueco "seguimiento
pendiente" mencionado en la sección I.4 / J, pero resuelto **dentro** de SANDÍA
(no vía n8n) y acotado a WhatsApp. Añade un cron más al modelo de tareas
diferidas descrito en la sección L (mismo patrón pg_cron + `x-cron-secret`, sin
cola real).

### 2026-09-03 — Hoja de "Requerimientos" en Google Sheets

**Estado:** rama `feat/gsheets-requirements-sheet`. **Sin migración.**

**Qué resuelve.** El export a Google Sheets era solo por evento con columnas
fijas (leads, deals, cotizaciones, citas, difusiones). Ahora, cuando se
**registra un negocio para un contacto** (paso `create_deal` de una
automatización, o el `create_deal` autónomo de la IA en `auto-reply.ts`), se
emite el evento nuevo **`contact.brief_ready`** → `dispatchToGoogleSheets` →
`buildBriefRow` vuelca los **valores de campos personalizados** del contacto en
una fila ancha en la pestaña `<base> - Requerimientos`, **una columna por campo
personalizado** de la cuenta (ordenadas por nombre, para que todas las filas
alineen). Si la cuenta agrega un campo nuevo, el encabezado crece y
`dispatch.ts` reescribe la fila 1 vía `updateHeaderRow` (`headers_written`
ahora guarda el arreglo del encabezado, no solo `true`).

**Config:** Configuración → Google Sheets → activar el evento "Requerimientos
del prospecto". El implementador arma un Flujo/automatización que captura las
specs en campos personalizados (Medidas, Material, Acabado, …) y luego crea el
negocio en el paso "Registro en CRM".

**Relación con el diagnóstico.** Cierra el hueco "estructura los requerimientos
en una hoja" de la propuesta comercial del Plan Pro. Reutiliza el módulo
`src/lib/google-sheets/` y el evento saliente de la sección I.4 — es "una
entrada más", no rediseño.

### 2026-09-03 — Métricas operativas de la prueba en `/kpis`

**Estado:** rama `feat/kpis-trial-metrics`. **Sin migración.**

**Qué resuelve.** La página `/kpis` cubría solo las 4 KPIs de venta (leads
generados/calificados, conversión, CAC). Faltaban las de la página "Impacto
esperado" de la propuesta. Nueva sección **"Métricas de la prueba"** con:
tiempo de primera respuesta (mediana, de `messages`: primer entrante vs primer
saliente por conversación, ventana acotada), seguimientos enviados (de
`ai_followup_log`), oportunidades recuperadas (nudge seguido de respuesta del
cliente en la misma conversación), derivadas a asesor + cuántas avanzaron
después (`conversations.ai_handoff_at` ⋈ `deals`), y "brief iniciado" (% de
leads con ≥1 `contact_custom_values`).

**Dónde vive.** `src/lib/kpis/` — `loadTrialMetrics()` en `queries.ts` (una
sola lectura contigua de `messages` que cubre ventana actual + anterior, se
parte en JS), cálculos puros en `compute.ts`, tipo `TrialMetrics` en
`types.ts`, tarjetas en la página, hoja "Trial metrics" en el export a Excel,
i18n en/es/ko. Todo con el cliente RLS del usuario (mismas políticas de
lectura de miembro que el resto de `/kpis`).

**Relación con el diagnóstico.** Segundo cierre de hueco del Plan Pro. Aditivo
sobre un módulo ya estructurado; si `messages` crece mucho, mover el
tiempo-de-primera-respuesta a un RPC (hoy el volumen lo permite).

---

## Nota final

Este documento es el diagnóstico de referencia para el proyecto SANDÍA: confirma que **no hay que reconstruir el CRM**, identifica con precisión (archivo por archivo, migración por migración) qué ya sirve, qué hay que ajustar y qué falta, y ordena el trabajo en fases con la seguridad y la multi-tenancy primero. Claude Code debe consultar este documento antes de proponer cambios estructurales al proyecto.

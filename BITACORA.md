# Bitácora de cambios

Registro cronológico de los cambios solicitados por Fabian (fpizarrocl) sobre
el fork de `wacrm`, con el commit correspondiente en el repositorio. No
incluye los cambios que llegan del proyecto upstream (`ArnasDon/wacrm`) ni de
`dependabot`, solo el trabajo pedido directamente por el usuario.

## 2026-07-27

- **Configuración inicial de variables de entorno.** Se agrega el archivo
  `.env` con la configuración base del proyecto.
  (`7f76f8c` Create .env)

## 2026-07-29

- **Ajustes de variables de entorno.** Correcciones menores sobre el `.env`
  creado el día anterior.
  (`874f780` cambio1, `7b0ed1e` y `4bbb7e6` Variable de entorno)

- **Soporte de idioma español.** Se agrega el locale `es` completo
  (`messages/es.json`), selector de idioma en el header
  (`language-switcher.tsx`) y ajustes en `src/i18n/request.ts` y
  `src/lib/i18n/locales.ts` para habilitarlo.
  (`5b6941a` Se agrega idioma ES)

- **Integración con Gemini (IA).** Se agrega soporte para el proveedor
  Gemini en la configuración de IA (`ai-config.tsx`, `src/lib/ai/config.ts`,
  `src/lib/ai/defaults.ts`), endpoints `api/ai/config` y `api/ai/test`, y un
  componente de slider nuevo (`src/components/ui/slider.tsx`).
  (`be93f4c` y `45c6d79` integración gemini)

## 2026-07-30

- **Límite de reintentos de la IA.** Se agrega un máximo de 3 reintentos
  al generar respuestas de IA, con búsqueda de conocimiento por
  full‑text search (`038_ai_knowledge_fts_or_match.sql`) y pruebas nuevas
  en `generate.test.ts`.
  (`c139960` Max. Tries IA 3)

- **Mensaje de espera y "escribiendo..." en WhatsApp.** Se agrega
  comportamiento configurable de mensajería (buffer de respuestas, mensaje
  de espera, indicador de "escribiendo") vía nueva pantalla de
  configuración de WhatsApp, el `reply-buffer.ts`, cambios en el webhook y
  en `meta-api.ts`, con su migración `039_whatsapp_messaging_behavior.sql`
  (luego renumerada a `040`).
  (`5b7c2a4` mensaje de espera y typing, `513ad04` renombre de la
  migración)

- **Notificación al handoff a un agente humano.** Cuando la IA cede la
  conversación a un agente, ahora se notifica a los agentes y se le
  responde al cliente automáticamente. Incluye migración
  `039_ai_handoff_notify.sql` y pruebas en `auto-reply.test.ts`.
  (`5c7bd25` Notify agents and reply to the customer when AI hands off)

- **Herramientas de IA (Tools) y ajustes de tipado/buffer.** Se agregan
  endpoints y UI para administrar "herramientas" que la IA puede usar
  (`api/ai/tools`, `ai-tools.tsx`), sincronización de la base de
  conocimiento (`api/ai/knowledge/sync/[id]`), y se corrige la
  normalización de nombres de herramientas (`src/lib/ai/tools/name.ts`).
  (`73eac89` cambios de typing y bufferr, `3fb18df` Herramientas de IA)

- **Corrección de bug en herramienta de IA (Google Sheets).** Se corrige
  la carga y ejecución de la herramienta de Google Sheets.
  (`f3bc46c` corrección de bug herramienta IA)

- **Logo y branding de la app.** Se agrega pantalla de branding en
  configuración (`branding-card.tsx`) para subir logo propio, con
  redimensionado a WebP (`resize-to-webp.ts`), aplicado en el sidebar y en
  el shell del dashboard. Incluye migración `043_app_branding.sql`.
  (`4a227d7` Logo)

## 2026-08-01

- **Herramientas de IA: conectar cualquier API.** Además de Google
  Sheets, ahora una herramienta puede ser una API HTTP genérica
  (ej. OpenWeatherMap, tipo de cambio, un endpoint interno). Se
  configura URL/método/headers/body con placeholders `{parametro}` que
  el modelo completa, y un `{API_KEY}` opcional que se reemplaza con la
  clave guardada encriptada — nunca se muestra al modelo ni a la UI.
  Incluye protección SSRF (misma guardia que usan los webhooks salientes
  del proyecto) para que la URL configurada no pueda apuntar a
  direcciones internas/privadas. Migración `044_ai_tools_generic_api.sql`.
  (`src/lib/ai/tools/api.ts`, `src/lib/ai/tools/validate.ts`,
  `src/lib/ai/load-tools.ts`, `src/app/api/ai/tools/*`,
  `src/components/settings/ai-tools.tsx`)

---

*Este archivo se actualiza a medida que se piden nuevos cambios. Para ver
el detalle técnico de cada commit: `git show <hash>`.*

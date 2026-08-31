# Runbook operativo — SANDÍA / wacrm

Guía de recuperación para cuando algo se rompe en producción. Pensada para
ejecutarse bajo presión: pasos concretos, en orden, sin teoría.

**Instancia única**, desplegada en EasyPanel (VPS/Docker). Base de datos
Supabase, proyecto `puvbwzwmojpjplhdfnmk`.

---

## 0. Triage rápido (2 min)

1. Abrir `https://<dominio>/api/health` en el navegador.
   - **200 `{"status":"ok"}`** → la app y la base responden. El problema
     es de una función concreta, no de infraestructura → sección 4.
   - **503** → mirar el cuerpo: `db: "down"` (sección 2) o `env: "down"`
     (falta una variable de entorno → sección 3).
   - **No responde / timeout** → la app está caída → sección 1.
2. Abrir `https://<dominio>/api/health?full=1` → añade el estado de cada
   cron (`heartbeats`). `stale: true` o `lastStatus: "error"` señala qué
   job dejó de correr → sección 5.
3. Revisar el canal de Telegram de alertas y el correo `ALERTS_EMAIL`:
   `dispatchSystemAlert` ya deja el detalle y el `alert id`.

---

## 1. La app no responde (EasyPanel)

1. Entrar a EasyPanel → proyecto `wacrm` → pestaña **Logs**. Buscar el
   stack trace del último arranque o del último crash.
2. Pestaña **Deployments**: ver si el último deploy fue el que rompió.
   - Si sí → **Rollback** al deployment anterior marcado como sano.
   - EasyPanel conserva las imágenes; el rollback es inmediato, no
     recompila.
3. Si no fue un deploy: **Restart** el servicio.
4. Si tras el restart sigue cayendo, revisar en Logs:
   - `Missing ... environment variable` → sección 3.
   - Error de conexión a Postgres → sección 2.
   - `EADDRINUSE` / OOM → subir recursos del contenedor o reiniciar el
     host.
5. Confirmar recuperación con `curl -fsS https://<dominio>/api/health`.

**Regla:** ante la duda, primero rollback al último deployment sano y
luego se investiga con calma. No depurar en caliente sobre `main`.

---

## 2. La base de datos no responde (`db: "down"`)

1. Abrir el dashboard de Supabase → proyecto `puvbwzwmojpjplhdfnmk` →
   **Reports / Database Health**. Verificar:
   - ¿Proyecto pausado? (plan free se pausa por inactividad) → **Restore**.
   - ¿CPU / conexiones al 100%? → ver consultas activas en
     **Database → Roles / Query Performance**.
2. Conexiones agotadas: en **Database → Connection Pooling** confirmar que
   la app usa el **pooler** (puerto 6543, modo transaction), no el puerto
   directo 5432.
3. Consulta larga bloqueando todo:
   ```sql
   select pid, now() - query_start as run_time, state, query
   from pg_stat_activity
   where state != 'idle' and query_start < now() - interval '30 seconds'
   order by run_time desc;
   -- para matarla:
   select pg_terminate_backend(<pid>);
   ```
4. Si el problema es un cambio de esquema reciente aplicado a mano,
   revertirlo con una migración nueva (nunca editar tablas desde el panel;
   ver `supabase/migrations/`).
5. Restaurar desde backup: **Database → Backups**. Supabase toma backups
   diarios automáticos (y PITR si está habilitado). **Un restore
   sobreescribe TODO** — anunciarlo, exportar antes lo que se pueda, y
   preferir restaurar a un proyecto nuevo para comparar antes de
   promover.

---

## 3. Falta una variable de entorno (`env: "down"`)

`/api/health` marca `env: "down"` si falta alguna de estas:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`.

1. EasyPanel → `wacrm` → **Environment**. Comparar contra `.env.example`
   y contra la lista completa de la sección 7.
2. Añadir la que falte → **Redeploy** (las env vars solo se aplican en el
   siguiente build/arranque).
3. **Nunca** cambiar `ENCRYPTION_KEY` para "arreglar" algo. Ver sección 6.

---

## 4. La app responde pero una función falla

`/api/health` en 200, pero los usuarios reportan un flujo roto.

| Síntoma | Dónde mirar |
|---|---|
| No entran/salen mensajes de WhatsApp | Sección 4.1 |
| La IA no responde o responde error | `ai_key_invalid` en Telegram; `ai_configs` de la cuenta; `ai_usage_log` |
| Google Calendar desconectado | Alerta `google_calendar`; el owner debe re-autorizar en Ajustes |
| Broadcasts atascados | `broadcasts` en estado `sending` con `locked_at` viejo; cron `webhooks`/`automations` (sección 5) |
| Automations/flows no disparan | Heartbeats `automations_cron` / `flows_cron` (sección 5) |
| No se puede responder un chat de Instagram/Facebook | Alerta `inbox_integrity` en Telegram — `detail.sample_conversation_ids` lista las conversaciones sin `zernio_conversation_id`. Causa habitual: dos filas para el mismo contacto (carrera de webhooks de Zernio). Reparar = mover `messages`/`ai_usage_log` de la fila huérfana a la que tiene el id y borrar la huérfana (ver PR #28/#29). El envío ya tiene un fallback a una conversación hermana, así que la alerta es de "revisar", no de "caído". |

### 4.1 WhatsApp / Meta Cloud API

1. **Recepción:** Meta → WhatsApp → Configuration → Webhook. Verificar
   que el callback URL apunta a `https://<dominio>/api/whatsapp/webhook`
   y que el **Verify Token** coincide con `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
   Botón **"Test"** de Meta debe dar 200.
2. **Envío:** en Logs buscar respuestas de `graph.facebook.com`:
   - `190` / `OAuthException` → el token de acceso de esa cuenta
     caducó. El owner lo regenera en Ajustes → WhatsApp.
   - `131030` → número destino no en la lista de permitidos (modo
     sandbox de Meta).
   - `132xxx` → problema de plantilla (rechazada / pausada por Meta).
3. **Firma inválida (`META_APP_SECRET`)**: si tras rotar el secret en
   Meta no se actualizó en EasyPanel, todos los webhooks entrantes se
   rechazan con 401. Sincronizar y redeploy.

---

## 5. Un cron dejó de correr (heartbeats)

`/api/health?full=1` → `heartbeats[].stale = true`, o alerta de Telegram
con `source: cron_heartbeat`.

Crons, disparados por **pg_cron en Supabase** (`select * from cron.job`).
El nombre del heartbeat (columna `system_heartbeats.name`) y el nombre
del job de pg_cron difieren — tabla de equivalencias:

| Heartbeat | Job pg_cron | Ruta | Frecuencia | Secreto (`x-cron-secret`) |
|---|---|---|---|---|
| `automations_cron` | `automations-pending-drain` | `/api/automations/cron` | ~5 min | `AUTOMATION_CRON_SECRET` |
| `flows_cron` | `flows-timeout-sweep` | `/api/flows/cron` | ~5 min | `AUTOMATION_CRON_SECRET` (compartido, por diseño) |
| `conversations_cron` | `conversation-reassign-sweep` | `/api/conversations/cron` | ~5 min | `CONVERSATIONS_CRON_SECRET` / `WEBHOOK_CRON_SECRET` |
| `webhooks_cron` | `webhook-retry-sweep` | `/api/webhooks/cron` | ~5 min | `WEBHOOK_CRON_SECRET` |
| `retention_cron` | `data-retention-sweep` | `/api/maintenance/retention/cron?execute=true` | diario 09:20 UTC | `RETENTION_CRON_SECRET` / `WEBHOOK_CRON_SECRET` |
| `subscriptions_cron` | `subscriptions-alert-sweep` | `/api/admin/subscriptions/cron` | diario 13:00 | `SUBSCRIPTIONS_CRON_SECRET` |
| (vigilante) | `heartbeat-staleness-check` | `/api/system/heartbeat-check/cron` | ~5 min | `HEALTHCHECK_CRON_SECRET` / `WEBHOOK_CRON_SECRET` |

> El watchdog `heartbeat-staleness-check`, al abrir una alerta **nueva**
> de cron muerto, dispara el bot de triage (`runAlertTriage`) si
> `OPS_AI_API_KEY` está configurada — publica un diagnóstico en el hilo
> de Telegram. No arregla nada solo; es asesor.

Pasos:

1. **Probar el endpoint a mano** (sustituir secreto y dominio):
   ```bash
   curl -sS -H "x-cron-secret: $SECRET" https://<dominio>/api/automations/cron
   ```
   - **200** → el job funciona; el que falla es el *scheduler*. Ir al
     paso 2.
   - **401** → el secreto que usa el scheduler no coincide con el de
     EasyPanel. Resincronizar.
   - **500** → error real en el job; el cuerpo y los Logs dan la causa.
2. **Revisar el scheduler:**
   - Si es **pg_cron**: en Supabase SQL editor →
     `select * from cron.job;` y
     `select * from cron.job_run_details order by start_time desc limit 20;`
     Buscar `status = 'failed'` o que directamente no haya corrido.
   - Si es **EasyPanel Cron**: pestaña Cron del proyecto → ver últimas
     ejecuciones y su salida.
3. Re-registrar o reactivar el job. Confirmar con
   `/api/health?full=1` que el heartbeat vuelve a `stale: false` tras un
   ciclo.
4. El vigilante (`/api/system/heartbeat-check/cron`) cierra solo la
   alerta (`resolveSystemAlert`) en su siguiente pasada cuando el
   heartbeat se recupera.

---

## 6. Rotación de credenciales

### `ENCRYPTION_KEY` (AES-256-GCM, 64 hex) — CUIDADO

Cifra los tokens de WhatsApp/Meta, claves de IA y OAuth de Google
Calendar guardados en la base. **Cambiarla a secas deja todos esos
secretos ilegibles** y rompe envío de WhatsApp, IA y Calendar a la vez.

Rotación correcta:

1. Mantener la clave vieja disponible como `ENCRYPTION_KEY_OLD`.
2. Escribir una migración/script que, para cada fila con secreto cifrado
   (`whatsapp_config`, `ai_configs`, `google_calendar_config`,
   `instagram_config`, `facebook_config`, `api_keys` si aplica):
   descifra con la vieja y vuelve a cifrar con la nueva.
3. Desplegar con la clave nueva ya como `ENCRYPTION_KEY`.
4. Verificar envío de WhatsApp + una respuesta de IA + refresco de token
   de Calendar antes de retirar `ENCRYPTION_KEY_OLD`.

### `SUPABASE_SERVICE_ROLE_KEY`

Supabase → Settings → API → **Reset service_role**. Actualizar en
EasyPanel y redeploy. Rompe temporalmente todo el acceso admin/RLS-bypass
hasta el redeploy — hacerlo en ventana de bajo tráfico.

### `META_APP_SECRET` / tokens de WhatsApp

- `META_APP_SECRET`: Meta App Dashboard → Settings → Basic → **Reset**.
  Sincronizar con EasyPanel *inmediatamente* (mientras tanto los webhooks
  entrantes fallan la verificación de firma).
- Tokens de acceso por cuenta: los regenera cada owner desde Ajustes →
  WhatsApp; no son variables de entorno.

### Secretos de cron

Generar uno nuevo (`openssl rand -hex 32`), actualizarlo **a la vez** en
EasyPanel y en el scheduler (pg_cron / EasyPanel Cron). Desfase = 401.

### Telegram / correo de alertas

`TELEGRAM_BOT_TOKEN` se regenera con @BotFather (`/revoke`).
`TELEGRAM_ALERT_CHAT_ID`: enviar un mensaje al bot y leer
`https://api.telegram.org/bot<token>/getUpdates`.

---

## 7. Variables de entorno (referencia)

**Críticas** (la app no arranca sana sin ellas — las valida `/api/health`):

| Var | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente Supabase (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase con RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Cliente admin server-side (bypass RLS) |
| `ENCRYPTION_KEY` | AES-256-GCM de secretos en BD (64 hex) — ver 6 |
| `META_APP_SECRET` | Verificación de firma de webhooks de Meta |

**Integraciones:**
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_APP_ID`,
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (según config por cuenta trae la
suya), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_CALENDAR_REDIRECT_URI`, `NEXT_PUBLIC_SITE_URL` /
`SITE_URL` (base de enlaces de catálogo firmados).

**Crons:** `WEBHOOK_CRON_SECRET` (fallback de varios),
`AUTOMATION_CRON_SECRET` (automations **y** flows — nombre en singular),
`CONVERSATIONS_CRON_SECRET`, `RETENTION_CRON_SECRET`,
`SUBSCRIPTIONS_CRON_SECRET` (sin fallback),
`HEALTHCHECK_CRON_SECRET` (cae a `WEBHOOK_CRON_SECRET`).

**Alertas / observabilidad:** `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ALERT_CHAT_ID`, `ALERTS_EMAIL`. Bot de triage:
`OPS_AI_API_KEY`, `OPS_AI_PROVIDER` (`anthropic`/`openai`),
`OPS_AI_MODEL`. Todas opcionales — sin ellas, las alertas se graban en
`system_alerts` pero no se envían ni se diagnostican.

**Email saliente:** según provider configurado en `src/lib/email/`.

---

## 8. Escalar / a quién avisar

1. **Owner de la plataforma:** Angel Durán —
   `angelduran.management@gmail.com`. Primer y único punto de contacto
   para decisiones de datos (restores, rotaciones, suspensiones).
2. **Soporte Supabase:** dashboard → botón Support (según plan). Para
   incidentes de infraestructura de la base que no se resuelven con los
   pasos de la sección 2.
3. **Soporte Meta / WhatsApp Business:** Business Help Center. Para
   plantillas rechazadas en masa, número restringido o baja de calidad.
4. **EasyPanel / VPS:** panel del hosting. Para el host caído, disco
   lleno o recursos agotados.

Registrar cada incidente (qué se vio, qué se hizo, cómo se confirmó la
recuperación) para alimentar este runbook.

---

## Post-incidente

- Si el fix fue manual sobre infraestructura, abrir PR con el cambio
  equivalente en código/migración para que no se pierda.
- Si el incidente no disparó alerta cuando debió, añadir el
  `dispatchSystemAlert` correspondiente o un heartbeat nuevo en
  `src/lib/observability/`.
- Actualizar las secciones de arriba con lo aprendido.

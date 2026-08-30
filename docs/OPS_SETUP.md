# Puesta en marcha operativa — checklist para el operador

Estado del plan de endurecimiento de 8 puntos. Marca lo que ya está en
el código y lo que **tú** tienes que hacer en Supabase / EasyPanel /
GitHub. Nada de esto cambia el comportamiento de la app para los
clientes; solo hace que un fallo se detecte y se recupere rápido.

Dominio de producción usado en todos los ejemplos:
`https://sandia-sandia-crm.kmencc.easypanel.host`

---

## 1. Alertas por Telegram / correo — CÓDIGO LISTO, faltan variables

Ya en el código: `dispatchSystemAlert()` graba cada incidente operativo
en la tabla `system_alerts` y lo manda a Telegram (principal) + correo
(respaldo). Sin variables configuradas, las alertas **se siguen
grabando** en la tabla (visibles para platform admins) pero no se
empujan a ningún lado.

**Acción — añadir en EasyPanel → servicio `wacrm` → Environment:**

| Variable | De dónde sale |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/newbot` |
| `TELEGRAM_ALERT_CHAT_ID` | manda un mensaje al bot, abre `https://api.telegram.org/bot<token>/getUpdates`, copia `chat.id` (para un canal/grupo es negativo) |
| `ALERTS_EMAIL` | correo donde quieres recibir warning + critical |

Redeploy tras añadirlas. Prueba: en `/admin` (como platform admin) o
provocando un error; debe llegar el mensaje a Telegram.

Fuentes de alerta ya cableadas: cron muerto (`cron_heartbeat`), clave de
IA inválida (`ai_key_invalid`), Google Calendar desconectado
(`google_calendar`). Añadir más = una llamada a `dispatchSystemAlert`
donde haga falta.

> WhatsApp como canal de alerta **no** está cableado (solo Telegram +
> correo). Meterlo mezclaría ruido de ops en un número de cliente; si lo
> quieres, decide qué número usar primero.

---

## 2. Monitoreo cada minuto + vigilancia de automatizaciones

### 2a. Endpoint de salud — LISTO

`GET /api/health` ya existe:
- **200** `{"status":"ok"}` — app + BD + variables críticas OK.
- **503** — BD caída o falta una variable crítica (el cuerpo dice cuál).
- `GET /api/health?full=1` — añade el estado de cada cron; `degraded`
  (sigue 200) si algún cron está stale o con error.

**Acción — monitor externo** (UptimeRobot / BetterStack / Cronitor,
plan gratis sirve):
1. Monitor HTTP a `GET /api/health` cada 1 min. "Down" si status ≠ 200.
   Avisa a tu correo/Telegram.
2. (Opcional) un segundo monitor a `/api/health?full=1` cada 5 min
   buscando la palabra `degraded` en el cuerpo.

### 2b. Vigilancia de crons (watchdog) — HECHO 2026-08-27

**Hallazgo de la auditoría:** en `cron.job` solo estaban agendados
`webhook-retry-sweep`, `conversation-reassign-sweep` y
`subscriptions-alert-sweep`. **`/api/automations/cron` y
`/api/flows/cron` no tenían ningún disparador** — los pasos "Wait" de
automatizaciones y los timeouts de flows nunca se ejecutaban en
producción.

**Resuelto:** se aplicó `089_schedule_missing_cron_jobs.sql` (en el SQL
editor de Supabase, con los valores reales — los secretos no van al
repo, igual que los otros 3 jobs) + se puso `AUTOMATION_CRON_SECRET` en
EasyPanel. Verificado en el tick de las 21:40 UTC:
`automations-pending-drain` → 200, `flows-timeout-sweep` → 200.

`GET /api/system/heartbeat-check/cron` lee `system_heartbeats` y abre
una alerta por cada cron que dejó de firmar (`stale`) o cuya última
corrida falló; cuando el cron se recupera, cierra la alerta sola.
Devolverá 404 hasta que el código de esta rama esté desplegado.

Verificar: `select jobname, schedule, active from cron.job;` lista 6
jobs. Tras el deploy, `GET /api/health?full=1` debe mostrar los
heartbeats en `stale:false` a los ~10 min.

Si algún día EasyPanel también agenda automations/flows por su cuenta,
bórralo de ahí para que pg_cron sea la única fuente (las rutas
self-lock, así que un solapamiento breve es seguro).

### 2c. Retención de datos — RESUELTO (2026-08-29)

Política aprobada: se mantienen los plazos que ya trae `run_data_retention()`
(migración 080) — 30–180 días, solo historial técnico/operativo; contactos,
mensajes, conversaciones, deals, cotizaciones, difusiones, productos y
`ai_action_log` nunca se tocan.

**Aplicá `092_schedule_data_retention_cron.sql`** en el SQL editor de
Supabase (o por psql), reemplazando `:'base_url'` y `:'retention_secret'`
por literales. Lo más simple: usá tu `WEBHOOK_CRON_SECRET` actual como
`retention_secret` — la ruta lo acepta como fallback y no hay que agregar
nada en EasyPanel. Corre 1×/día a las 09:20 UTC (~03:20 Guatemala) con
`?execute=true`; por lotes de 1000 filas/tabla, así que un backlog inicial
se drena en varios días solo.

Verificar: `select jobname, schedule, active from cron.job;` lista
`data-retention-sweep`, y a los pocos minutos `/api/health` deja de
reportar `degraded (stale: retention_cron)`.

---

## 3. Entorno de staging — PENDIENTE (requiere tu aprobación de costo)

No lo creé: implica un proyecto Supabase aparte (o una branch de
Supabase, que factura) y un segundo servicio en EasyPanel. Pasos cuando
lo autorices:

1. **BD:** o un proyecto Supabase nuevo `sandia-staging` (plan free =
   Q0, sin flujo de branching), o `supabase branches create staging`
   (branch persistente ≈ **USD 0.0134/hora ≈ USD 9.70/mes** si queda
   encendida 24/7 — costo confirmado para la organización
   `angelsandia-rgb` el 2026-08-27).
2. **App:** duplica el servicio en EasyPanel apuntando a la rama git
   `staging`, con su propio set de variables (URL/keys de la BD de
   staging, `NEXT_PUBLIC_SITE_URL` del subdominio de staging, claves de
   Meta de una app de prueba, `WHATSAPP_TEMPLATES_DRY_RUN=true`).
3. **Migraciones:** hay drift — `supabase_migrations.schema_migrations`
   en producción solo registra desde `20260814` (~40 filas) pero el
   repo tiene 89 archivos `.sql`. Antes de poder correr migraciones por
   CI hay que **baselinar**: marcar como aplicadas en staging todas las
   migraciones ya presentes en el esquema, y de ahí en adelante que CI
   aplique solo las nuevas.
4. Regla: toda migración se prueba en staging antes de tocar producción.

---

## 4. Deploys protegidos — CÓDIGO LISTO, falta configurar GitHub

- `.github/workflows/ci.yml` (ya existía) corre lint + typecheck + test
  + build en cada push/PR a `main`.
- `.github/workflows/deploy.yml` (nuevo) se dispara **después** de que
  CI termina en `main` y solo si pasó; llama al deploy hook de EasyPanel
  y luego sondea `/api/health` hasta 200 (si no, marca el deploy como
  fallido para que lo veas).

**Acción:**
1. GitHub → repo → Settings → **Branches** → proteger `main`:
   - Require a pull request before merging.
   - Require status checks to pass → marca **CI**.
   - Include administrators (recomendado).
   - Prohibir push directo a `main`.
2. Si quieres que el deploy lo dispare GitHub (no EasyPanel solo):
   - EasyPanel → servicio → apaga "auto deploy on push", cambia a
     deploy por hook/API, copia la URL del hook.
   - GitHub → Settings → Secrets and variables → Actions → nuevo secret
     `EASYPANEL_DEPLOY_HOOK` = esa URL.
   - Si prefieres seguir con el auto-deploy de EasyPanel desde `main`,
     **no necesitas** `deploy.yml` — con la protección de rama basta
     para que solo llegue a producción lo que pasó CI. Puedes borrar el
     archivo.

---

## 5. Bot de triage con IA — CÓDIGO LISTO, falta la clave

Cuando se abre una alerta **nueva** (no una repetida), el watchdog llama
a `runAlertTriage()`: junta la telemetría (heartbeats, alertas
abiertas), le pide a un LLM "causa probable + qué revisar + arreglo
sugerido" y publica la respuesta en el mismo hilo de Telegram. También
hay `POST /api/system/triage` (solo platform admin, body
`{"dedupKey":"..."}`) para pedir un diagnóstico a mano.

**Es solo asesor:** no toca código, ni configuración, ni datos, ni abre
PRs. Un humano ejecuta el arreglo siguiendo `docs/RUNBOOK.md`.

**Acción — variables en EasyPanel (opcionales):**

| Variable | Valor |
|---|---|
| `OPS_AI_API_KEY` | clave de plataforma (SEPARADA de la BYO de cada cuenta). Sin esto, el triage es no-op silencioso |
| `OPS_AI_PROVIDER` | `anthropic` (default) o `openai` |
| `OPS_AI_MODEL` | opcional; default razonable por proveedor |

Presupuesto: un diagnóstico por alerta nueva, con throttle de 60 min por
condición → gasto mínimo. Si más adelante quieres que además **proponga
un parche** (PR), es otra fase: hay que decidir permisos y revisar todo
diff a mano.

---

## 6. Pendientes previos del diagnóstico

| Item | Estado |
|---|---|
| **K.1 rate limiting compartido** | **YA RESUELTO en el código.** Todos los call sites usan `checkSharedRateLimit()` → RPC `consume_rate_limit` sobre la tabla `rate_limit_buckets` (store compartido en Postgres, con fallback local si la BD cae). No hace falta Redis. |
| **RL6 "Leaked password protection"** | Manual: Supabase → Authentication → Policies → activar (HaveIBeenPwned). No hay herramienta para hacerlo por API. |
| **K.2 CSP en modo enforcing** | Pendiente, riesgo real. Requiere nonce en cada `<script>`/`<style>` inline + prueba página por página. No es un flag; es una tarea con regresión visual. Dejar para una ventana dedicada. |
| **§M columna `profiles.role` heredada** | Deuda cosmética. Sigue leyéndose en `settings/profile-form.tsx`. Quitarla = drop de columna + quitar el display; sin ganancia funcional, no vale un drop en producción ahora. |

---

## Orden sugerido

1. **Hoy:** variables de Telegram/correo (#1) + aplicar migración 089 +
   `AUTOMATION_CRON_SECRET` (#2b) — cierra el agujero de que
   automations/flows no corren.
2. **Esta semana:** monitor externo a `/api/health` (#2a), protección de
   rama `main` (#4), `OPS_AI_API_KEY` (#5), activar RL6 (#6).
3. **Cuando haya presupuesto/tiempo:** staging (#3), deploy hook (#4),
   política de retención (#2c), CSP enforcing (#6).

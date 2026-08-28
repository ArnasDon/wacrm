# Sistema de Heartbeat para Supabase

> Este documento es un tutorial operativo, paso a paso, orientado a
> instalar y mantener el heartbeat en un hosting concreto (Vercel hoy,
> Hostinger si el proyecto migra). Complementa —no reemplaza— a
> [`docs/heartbeat.md`](./heartbeat.md), que es la referencia técnica
> del endpoint en sí (qué consulta ejecuta, por qué esa consulta, el
> diseño de la autenticación). Si algo aquí y allá parecen decir cosas
> distintas, `docs/heartbeat.md` es la fuente de verdad técnica; este
> archivo solo debería diferir en que es más largo y más "hazlo así,
> paso 1, paso 2".

El objetivo es generar actividad periódica real hacia Supabase para
reducir el riesgo de que el proyecto entre en pausa por inactividad
(los proyectos gratuitos de Supabase se pausan tras un período sin
ninguna actividad de API/base de datos).

Aclaraciones importantes sobre qué **no** es este sistema:

- **No** es `autoRefreshToken` de Supabase — eso solo mantiene viva la
  sesión de un usuario ya logueado, no genera actividad si nadie está
  usando el CRM.
- **No** depende de que un usuario tenga el CRM abierto en el
  navegador.
- **No** usa `setInterval` en el navegador ni en ningún componente de
  React — un temporizador así deja de correr en cuanto se cierra la
  pestaña.
- Funciona mediante un **scheduler o cron externo** que llama
  periódicamente al endpoint:

  ```
  /api/internal/heartbeat
  ```

  Ese endpoint corre en el servidor (Next.js App Router), no en el
  navegador de nadie.

## Flujo

```
Scheduler / Cron
      ↓
https://DOMINIO.com/api/internal/heartbeat
      ↓
Validación del secreto (Authorization: Bearer ...)
      ↓
Next.js (route handler del servidor)
      ↓
Consulta ligera a Supabase (SELECT id FROM accounts LIMIT 1)
      ↓
Respuesta 200 OK
```

Si el secreto no es válido, la petición nunca llega a tocar Supabase
— corta en el paso de validación con `401`.

# Requisitos

- **Endpoint disponible:** `/api/internal/heartbeat` (acepta `GET` y
  `POST`, misma lógica en ambos). Código en
  [`src/app/api/internal/heartbeat/route.ts`](../src/app/api/internal/heartbeat/route.ts).
- **Variable `HEARTBEAT_SECRET`** configurada en el entorno donde
  corre la app. Sin ella, el endpoint responde `503` — nunca corre sin
  autenticación configurada.
- **En Vercel específicamente**, además la variable `CRON_SECRET`,
  **con el mismo valor exacto** que `HEARTBEAT_SECRET` (se explica por
  qué en la sección de instalación).
- **Nunca subir secretos a GitHub** — ni en un commit, ni en un
  archivo `.env` versionado, ni en la documentación.
- **Nunca colocar un secreto real** (ni de ejemplo parecido a uno
  real) dentro de código o documentación pública. Este documento no
  contiene ningún valor real en ningún ejemplo — donde haga falta un
  valor, dice literalmente `VALOR_GENERADO` o usa una variable de
  shell (`$HEARTBEAT_SECRET`) que nunca se imprime.

# Cómo generar un secreto seguro

En tu propia terminal (no en un archivo que se vaya a commitear):

```bash
openssl rand -hex 32
```

Esto genera 64 caracteres hexadecimales (256 bits de entropía). Guarda
el resultado en un gestor de contraseñas o similar — es el valor que
vas a usar como `HEARTBEAT_SECRET`. No lo pegues en un archivo del
repositorio, ni en un chat, ni en un ticket público.

Si no tienes `openssl` disponible, alternativas equivalentes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
[System.Convert]::ToHexString((New-Object byte[] 32 | %{[void](New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($_)}))
```

Para Vercel, ese mismo valor se usa dos veces:

```
HEARTBEAT_SECRET = VALOR_GENERADO
CRON_SECRET      = VALOR_GENERADO   (el MISMO valor, no uno nuevo)
```

Esto es obligatorio cuando se usa Vercel Cron: Vercel no permite
adjuntar un header `Authorization` personalizado a sus cron jobs —
en su lugar, si existe la variable `CRON_SECRET`, Vercel la envía
automáticamente como `Authorization: Bearer <CRON_SECRET>` en cada
ejecución programada. Si `CRON_SECRET` y `HEARTBEAT_SECRET` no
coinciden exactamente, el endpoint responderá `401` en cada corrida.

# Instalación en Vercel

1. Entra al proyecto en el dashboard de Vercel.
2. Ve a **Settings**.
3. Ve a **Environment Variables**.
4. Crea la variable `HEARTBEAT_SECRET` con el valor generado en el
   paso anterior.
5. Crea la variable `CRON_SECRET`.
6. Usa **exactamente el mismo valor** para ambas — cópialo, no lo
   regeneres una segunda vez.
7. Marca al menos el entorno **Production** para ambas variables — es
   el que realmente valida el cron job real.
8. **Preview** y **Development**: solo hace falta marcarlos si quieres
   poder probar manualmente el endpoint contra un deploy de preview o
   en tu entorno local — Vercel Cron en sí **solo** dispara sobre el
   deployment de producción, así que dejarlos sin marcar no rompe
   nada. Si los marcas, usa el mismo valor también (o uno distinto si
   quieres poder rotar el de producción sin afectar tus pruebas — a
   criterio tuyo, no hay restricción técnica).
9. Guarda. Si el proyecto ya estaba desplegado, Vercel requiere que
   las funciones se reconstruyan para recoger variables nuevas —
   dispara un **Redeploy** manual: `Deployments` → el deployment más
   reciente → menú `⋯` → **Redeploy**. Si en cambio vas a hacer push
   de código nuevo de todos modos, el próximo deploy ya las recoge
   solo, sin pasos adicionales.

### Verificar que Vercel Cron detecta `vercel.json`

El archivo [`vercel.json`](../vercel.json) en la raíz del repo ya
declara el cron job — no requiere ningún paso manual en el dashboard
para "activarlo", se detecta automáticamente en cada deploy que lo
incluya. Para confirmar que Vercel lo reconoció:

- `Project → Cron Jobs` en el dashboard debe listar
  `/api/internal/heartbeat` con su schedule.
- Si esa pestaña aparece vacía después de un deploy que sí incluye
  `vercel.json`, confirma que el deploy en cuestión es realmente el
  que tiene el archivo (revisa el commit desplegado) y que el archivo
  está en la raíz del repo, no dentro de una subcarpeta.

### Schedule actual configurado

```json
{
  "crons": [{ "path": "/api/internal/heartbeat", "schedule": "0 0 * * *" }]
}
```

`0 0 * * *` = una vez al día, a medianoche UTC. Se eligió esa
frecuencia deliberadamente: el plan **Hobby** de Vercel limita los
cron jobs a una ejecución diaria como máximo sin importar qué
schedule se configure, así que este archivo funciona sin cambios
tanto en Hobby como en Pro. Sigue siendo bastante más frecuente de lo
necesario para el objetivo real (evitar la pausa por inactividad).

### Cómo cambiar la frecuencia en el futuro

Edita únicamente el campo `"schedule"` en `vercel.json` y haz deploy
del cambio — no hace falta tocar ningún otro archivo. Ejemplos:

| Frecuencia deseada | Expresión cron |
| ------------------ | --------------- |
| Cada 6 horas        | `0 */6 * * *`  |
| Cada 12 horas        | `0 */12 * * *` |
| Una vez al día (actual) | `0 0 * * *` |

Una frecuencia sub-diaria (cada 6h, cada 12h) solo se ejecutará
realmente así en planes **Pro o superiores** de Vercel — en Hobby,
Vercel sigue limitando a una ejecución diaria aunque el archivo pida
más, sin que eso sea un error.

# Probar el heartbeat manualmente

Sin dejar el secreto en el historial de la terminal ni en un
screenshare:

```bash
read -s HEARTBEAT_SECRET
curl -X GET "https://TU-DOMINIO.com/api/internal/heartbeat" \
  -H "Authorization: Bearer $HEARTBEAT_SECRET"
```

`read -s` pide el valor y no lo muestra en pantalla ni lo guarda en el
historial del shell; `$HEARTBEAT_SECRET` solo vive en esa sesión de
terminal.

Interpretación de la respuesta:

- **200** → el heartbeat funcionó: el secreto fue válido y la consulta
  a Supabase se ejecutó correctamente.
- **401** → el secreto enviado no coincide con `HEARTBEAT_SECRET`
  configurado en el servidor.
- **503** → la variable `HEARTBEAT_SECRET` no está configurada en ese
  entorno todavía.

Ningún ejemplo de este documento incluye un secreto real — donde hace
falta un valor, se usa una variable de shell que nunca se imprime.

# Instalación futura en Hostinger

El README de este proyecto recomienda Hostinger como opción de
hosting principal (Node.js administrado). Hostinger **no** ejecuta
automáticamente el `vercel.json` de este repo — esa es una capacidad
específica de la plataforma Vercel, no algo que el propio código
implemente. Si el proyecto se despliega (o migra) a Hostinger, el
heartbeat sigue funcionando exactamente igual a nivel de código —
solo cambia QUIÉN llama al endpoint por un reloj.

Arquitectura alternativa (sin Vercel):

```
Scheduler externo
      ↓
https://DOMINIO.com/api/internal/heartbeat
      ↓
Authorization: Bearer HEARTBEAT_SECRET
      ↓
Supabase
```

`HEARTBEAT_SECRET` sigue siendo obligatorio — el endpoint no cambia
su lógica de autenticación según el hosting. `CRON_SECRET` deja de
ser necesario fuera de Vercel (es una convención propia de esa
plataforma), pero no hace daño dejarlo configurado sin uso.

Opciones compatibles según lo que Hostinger permita en tu plan:

1. **Cron job del propio hosting**, si el plan de Hostinger permite
   ejecutar una petición HTTP programada (algunos planes de hPanel
   incluyen "Cron Jobs" que pueden correr un comando `curl`
   directamente). Si está disponible, es la opción más simple: no
   depende de un tercero.
2. **[cron-job.org](https://cron-job.org)** u otro scheduler externo
   equivalente (EasyCron, healthchecks.io, ...) — funciona igual sin
   importar el hosting; el paso a paso completo (crear cuenta, URL,
   header de autorización) está en la sección "Option C — External
   scheduler" de [`docs/heartbeat.md`](./heartbeat.md).
3. **Un cron en un VPS o servidor propio** (`crontab -e`), si ya
   administras uno, con una línea como:

   ```
   0 0 * * * curl -s -X GET "https://TU-DOMINIO.com/api/internal/heartbeat" -H "Authorization: Bearer TU_HEARTBEAT_SECRET" > /dev/null
   ```

   (sustituye `TU_HEARTBEAT_SECRET` por el valor real solo en el
   `crontab` del servidor — nunca en un archivo versionado).

Configuración de la petición HTTP, para cualquiera de las tres
opciones:

- Método: `GET` o `POST` (ambos funcionan igual).
- Header obligatorio: `Authorization: Bearer TU_HEARTBEAT_SECRET`.
- Frecuencia recomendada: **una vez al día** es suficiente para
  cualquier plan de Supabase actual (los proyectos gratuitos pausan
  tras aproximadamente una semana sin actividad, no un día). Ajusta
  hacia arriba (cada 6-12h) solo si en el futuro cambian las reglas
  de inactividad de tu plan de Supabase y quieres más margen de
  seguridad.

# Cambio de Vercel a Hostinger

Guía paso a paso para migrar el heartbeat cuando se deje de usar
Vercel:

1. Confirma que `/api/internal/heartbeat` responde correctamente en
   el **nuevo dominio** (el de Hostinger) — usa la prueba manual de la
   sección "Probar el heartbeat manualmente" de este documento,
   apuntando la URL al dominio nuevo.
2. Configura `HEARTBEAT_SECRET` en el entorno de Hostinger (hPanel →
   variables de entorno del sitio, o el mecanismo que uses para
   `.env` en ese hosting) — puede ser el mismo valor que tenías en
   Vercel o uno nuevo; no hay ninguna dependencia técnica entre ambos.
3. Configura el scheduler externo o cron (cualquiera de las tres
   opciones de la sección anterior), apuntando al dominio de
   Hostinger.
4. Prueba manualmente el endpoint en el dominio nuevo (de nuevo, la
   sección "Probar el heartbeat manualmente").
5. Confirma que las respuestas son `200` de forma consistente, no solo
   en la primera prueba.
6. Verifica que el scheduler elegido registra ejecuciones exitosas en
   su propio historial (el panel del cron de Hostinger, el dashboard
   de cron-job.org, o los logs del VPS).
7. **Solo después** de confirmar los pasos 1-6, desactiva la
   configuración de Vercel Cron — si ya no vas a usar Vercel para
   nada, simplemente deja de desplegar ahí (o elimina el proyecto de
   Vercel); no hace falta borrar `vercel.json` del repo, un
   `vercel.json` sin un deployment activo en Vercel no hace nada.

# Seguridad

- **No subas archivos `.env` con secretos** al repositorio — `.env`,
  `.env.local`, etc. ya están en `.gitignore`; solo `.env.local.example`
  (sin valores reales) se versiona.
- **No hagas commit de `HEARTBEAT_SECRET`** en ningún archivo, mensaje
  de commit, comentario de código o issue/PR público.
- **No expongas `SUPABASE_SERVICE_ROLE_KEY`** al navegador — el
  endpoint de heartbeat corre enteramente en el servidor (route
  handler de Next.js) y usa el cliente de servicio ya existente en
  `src/lib/automations/admin-client.ts`; esa clave nunca viaja al
  cliente.
- **Mantén el endpoint protegido** — no elimines ni debilites la
  validación de `HEARTBEAT_SECRET` en el código; sin ella, cualquiera
  podría generar tráfico repetido hacia tu base de datos.
- **Usa secretos largos y aleatorios** — `openssl rand -hex 32` o
  equivalente, nunca una palabra o frase memorable.
- **Rota el secreto si sospechas que fue expuesto** — genera uno
  nuevo con el mismo comando, actualízalo en `HEARTBEAT_SECRET` (y en
  `CRON_SECRET` si usas Vercel, con el mismo valor nuevo) y en
  cualquier scheduler externo que lo tenga guardado, luego redeploy.
  El endpoint no necesita ningún cambio de código para esto.

# Solución de problemas

| Problema | Posible causa | Solución |
| --- | --- | --- |
| `401 Unauthorized` | El secreto enviado no coincide con `HEARTBEAT_SECRET`. En Vercel, suele ser que `CRON_SECRET` y `HEARTBEAT_SECRET` tienen valores distintos. | Verifica que ambas variables tengan exactamente el mismo valor (sin espacios extra). Prueba manualmente con `curl` para aislar si es el scheduler o el secreto en sí. |
| `503 Service Unavailable` | `HEARTBEAT_SECRET` no está configurada en ese entorno/deploy. | Confirma que la variable existe en el entorno correcto (Production/Preview/Development) y que hiciste un redeploy después de agregarla. |
| `404 Not Found` | La URL apunta a una ruta o dominio incorrecto, o el código del endpoint no llegó a desplegarse. | Verifica la URL exacta (`/api/internal/heartbeat`, sin barra final extra) y que el deploy activo incluye el commit con `src/app/api/internal/heartbeat/route.ts`. |
| `500 Internal Server Error` | Error inesperado no controlado (poco probable — el handler ya captura errores de Supabase y devuelve 502, no 500). | Revisa los logs de la función en el dashboard de Vercel/Hostinger para el stack trace exacto. |
| Vercel Cron no ejecuta | `vercel.json` no está en la raíz del deploy activo, o el proyecto está en un plan/región donde Cron Jobs no está disponible. | Revisa `Project → Cron Jobs` en el dashboard; si está vacío, confirma que el deployment activo incluye `vercel.json` y que tu plan de Vercel soporta Cron Jobs. |
| El scheduler externo falla | Credenciales/URL mal configuradas en el panel del scheduler, o el dominio cambió. | Revisa el historial de ejecuciones del scheduler (cron-job.org y similares muestran el código de respuesta de cada intento) y compáralo con una prueba manual por `curl`. |
| Supabase devuelve error | El proyecto de Supabase está pausado, la clave de servicio rotó, o hay un problema de conectividad. | El endpoint responde `502` en ese caso (nunca inventa un `200`). Revisa el dashboard de Supabase directamente y `SUPABASE_SERVICE_ROLE_KEY` en las variables de entorno. |
| Las variables de entorno no aparecen después del deploy | Se guardaron después de que el build ya había corrido, o se guardaron para el entorno equivocado (p. ej. solo Preview cuando el tráfico real es Production). | Haz un Redeploy manual y confirma que la variable está marcada para el entorno correcto. |

# Checklist final

- [ ] Código del endpoint desplegado (`/api/internal/heartbeat` responde algo distinto de 404).
- [ ] `HEARTBEAT_SECRET` configurado en el entorno de producción.
- [ ] `CRON_SECRET` configurado si se usa Vercel Cron.
- [ ] Ambas variables tienen el mismo valor exacto en Vercel.
- [ ] Se realizó un redeploy después de guardar las variables (si el proyecto ya estaba desplegado).
- [ ] El endpoint responde `200` al probarlo manualmente con `curl`.
- [ ] El cron (Vercel Cron o el scheduler externo elegido) ejecuta correctamente.
- [ ] Se revisó el historial de ejecuciones del cron al menos una vez.
- [ ] No existen secretos reales en GitHub (código, commits, docs, issues).
- [ ] Existe un plan documentado para migrar el heartbeat a Hostinger (esta misma guía, sección "Cambio de Vercel a Hostinger") si el hosting cambia en el futuro.

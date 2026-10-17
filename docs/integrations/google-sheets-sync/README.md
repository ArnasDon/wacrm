# Sincronización automática WACRM ↔ Google Sheets (vía Apps Script)

Permite que el Apps Script que ya procesa los correos de Gmail y
actualiza la Hoja de inventario avise a WACRM, inmediatamente después,
para que reimporte precios/stock — sin depender de un cron cada 15
minutos en el plan Hobby de Vercel.

## Qué NO cambia

- El proceso existente que lee Gmail y escribe en la Hoja: intacto.
- El importador/persistencia real de WACRM (`refreshDataSource()`):
  reutilizado sin cambios — este endpoint es solo un disparador nuevo
  para la misma función que ya usa el botón "Actualizar" del
  dashboard.
- No se agregó ninguna tabla ni migración de Supabase para esto — solo
  dos variables de entorno nuevas.

## Endpoint

`POST /api/internal/data-source-sync`

- Solo puede refrescar **una** fuente de datos, fijada por variable de
  entorno — nunca una que el llamador elija. Un `POST` con un
  `account_id`/`id` distinto en el cuerpo es ignorado por completo; el
  endpoint nunca lee el cuerpo de la petición para decidir qué
  refrescar.
- Esa fuente debe ser de tipo `google_sheets` o `remote_csv` (una
  `uploaded_csv` no tiene URL que volver a descargar) — si no lo es,
  responde `503` sin tocar nada.
- Autenticación: header `Authorization: Bearer <secreto>`, comparado
  con `timingSafeEqual` (mismo patrón que `/api/internal/heartbeat` y
  `/api/automations/cron` de este mismo proyecto) — nunca expone el
  secreto en logs ni en la respuesta.
- Límite: 10 solicitudes/hora (generoso para 2 correos diarios + unos
  reintentos; bloquea un secreto filtrado de martillar el refresh en
  loop).
- Respuestas: `200` éxito, `401` secreto ausente/incorrecto, `404` la
  fuente configurada fue borrada (caso raro), `409` ya hay un refresh
  en curso (reintenta en un momento), `422` la Hoja devolvió algo
  inválido (HTML, vacía, error de red) — **el inventario anterior se
  conserva intacto en todos los casos de error**, `503` el endpoint no
  está configurado o la fuente configurada no es válida.

## 1. Configurar WACRM (Vercel)

En el proyecto de Vercel (`kccrm`) → Settings → Environment Variables,
agregar:

| Variable | Valor |
|---|---|
| `DATA_SOURCE_SYNC_SECRET` | Un secreto largo y aleatorio generado por ti (ej. `openssl rand -hex 32`) — **nunca lo pegues en código ni en este repositorio**. |
| `DATA_SOURCE_SYNC_SOURCE_ID` | El `id` (UUID) de la fuente de datos de Google Sheets ya creada en WACRM que quieres sincronizar — visible en Settings → Data Sources, o en la URL al editarla. |

Después de agregarlas, hace falta un nuevo deploy para que Vercel las
cargue (las variables de entorno no se aplican a una función ya
desplegada).

## 2. Configurar el Apps Script

En el editor de Apps Script (el mismo proyecto que ya procesa los
correos) → ⚙️ Project Settings → Script Properties → agregar:

| Propiedad | Valor |
|---|---|
| `WACRM_SYNC_URL` | `https://kccrm.vercel.app/api/internal/data-source-sync` |
| `WACRM_SYNC_SECRET` | El MISMO valor que `DATA_SOURCE_SYNC_SECRET` en Vercel. |

`PropertiesService` mantiene esto fuera del código fuente y del
historial de versiones del script.

## 3. Añadir esta función al script existente

Pégala en el proyecto de Apps Script (nuevo archivo o al final del
existente) — **no reemplaza nada de lo que ya procesa Gmail/la Hoja**:

```javascript
/**
 * Avisa a WACRM que la Hoja de inventario se acaba de actualizar.
 * Llamar SOLO después de que tu rutina existente confirme que la
 * actualización de la Hoja terminó bien — nunca tras una actualización
 * parcial o fallida, y nunca más de una vez por corrida exitosa
 * (no por cada fila ni por cada correo).
 */
function notifyWacrmOfSync_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('WACRM_SYNC_URL');
  var secret = props.getProperty('WACRM_SYNC_SECRET');
  if (!url || !secret) {
    console.error('WACRM sync no configurado — revisa WACRM_SYNC_URL y WACRM_SYNC_SECRET en Script Properties.');
    return;
  }

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { Authorization: 'Bearer ' + secret },
      muteHttpExceptions: true, // leer el status/body real en vez de lanzar una excepción
    });
  } catch (err) {
    // Fallo de red (DNS, timeout) — nunca afirmar éxito.
    console.error('Solicitud de sincronización con WACRM falló: ' + err);
    return;
  }

  var status = response.getResponseCode();
  var body = response.getContentText();
  if (status === 200) {
    console.log('Sincronización con WACRM exitosa: ' + body);
  } else {
    // El secreto nunca aparece en la respuesta del servidor — solo lo
    // enviamos nosotros en el header Authorization, nunca se registra aquí.
    console.error('Sincronización con WACRM falló (HTTP ' + status + '): ' + body);
  }
}
```

Luego, al FINAL de la función que ya confirma que la Hoja terminó de
actualizarse correctamente (nunca antes, nunca si detectó un error a
mitad de camino), agrega una sola línea:

```javascript
notifyWacrmOfSync_();
```

## Por qué esta forma y no otra

- **No se creó un endpoint paralelo de importación** — este solo
  invoca `refreshDataSource()`, la misma función que ya usa el botón
  "Actualizar" del dashboard, con todas sus garantías existentes
  (nunca borra el inventario anterior antes de tener uno nuevo válido,
  nunca deja que una página HTML o un CSV vacío sustituya datos
  buenos, bloqueo de concurrencia por fuente).
- **El llamador nunca elige la cuenta/fuente** — ambas se resuelven en
  el servidor a partir de `DATA_SOURCE_SYNC_SOURCE_ID`, nunca del
  cuerpo de la petición. Un atacante que robara el secreto solo podría
  disparar un refresh de ESA fuente, nunca elegir otra cuenta ni otro
  usuario.
- **Sin cron de 15 minutos** — el disparo real es el propio Apps
  Script, inmediatamente después de que la Hoja cambia, no una
  revisión periódica a ciegas.

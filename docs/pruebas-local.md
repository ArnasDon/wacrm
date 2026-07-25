# Guía de pruebas locales — atribución de anuncios, ROI y vendedores

Rama `feat/ads-attribution`. Todo corre contra **Supabase local en Docker**, así que
nada de lo que hagas acá toca `crm.agenciakibo.com` ni la Supabase Cloud de
producción.

---

## 0. Levantar el entorno

Ya está levantado y con datos de prueba. Para volver a levantarlo después de
apagar la Mac:

```bash
cd ~/Proyectos/wacrm && npx supabase start
```

El servidor de Next corre en **http://localhost:3100**:

```bash
cd ~/Proyectos/wacrm && npm run dev -- --port 3100
```

**Entrar al CRM:**

| | |
|---|---|
| URL | http://localhost:3100/login |
| Usuario | `luis@local.test` |
| Contraseña | `Prueba1234` |

La cuenta se llama *Agencia Kibo (local)*, está en **PEN** y tiene un segundo
miembro (`vendedora@local.test`, misma contraseña, rol **agente**) para probar la
fase de vendedores.

Otras URLs útiles:

- **Supabase Studio** (ver/editar tablas a mano): http://127.0.0.1:54323
- **Mailpit** (correos que envía la app, ej. invitaciones): http://127.0.0.1:54324

Para borrar todo y empezar de cero: `npx supabase db reset`. Ojo: eso **borra el
usuario `luis@local.test`** y tendrías que volver a crearlo; la sección 6 explica
cómo.

---

## 1. Qué accesos y tokens hace falta conseguir

Esto es lo único que no se puede probar en local sin credenciales reales.

### Token de Meta Ads — el único imprescindible

Es lo que permite que el CRM lea tus campañas, el gasto y traduzca el ID de
anuncio a su campaña.

1. Entra a [developers.facebook.com](https://developers.facebook.com/) con la
   cuenta de Facebook que administra el Business Manager.
2. Abre tu app (o crea una de tipo *Business*).
3. Ve a **Herramientas → Explorador de la API Graph**.
4. En *Permisos*, agrega **`ads_read`**. Con eso alcanza — el CRM solo lee, nunca
   crea ni modifica anuncios.
5. Genera el token y cópialo.
6. Necesitas también el **ID de la cuenta publicitaria**, con el formato
   `act_123456789`. Está en el Administrador de Anuncios, arriba a la izquierda,
   o en la URL (`act=123456789`).

**Advertencia importante sobre la duración:** un token de usuario normal **caduca
en unas horas**. Para producción hay que generar un *System User token* desde
Business Manager → Configuración del negocio → Usuarios del sistema, que no
caduca. Si usas el token corto, el sync va a empezar a fallar el mismo día y
verás el error en Configuración → Cuentas publicitarias.

> El CRM guarda el token **cifrado** (AES-GCM con `ENCRYPTION_KEY`) y la API
> nunca lo devuelve al navegador. Aun así, cualquier miembro de la cuenta puede
> leer la fila cifrada vía Supabase; es el mismo comportamiento que ya tenía el
> token de WhatsApp, no algo nuevo de estos cambios.

### Google Ads — no hace falta ningún token

Google no tiene API usable acá (exige un *developer token* aprobado por Google,
que toma semanas). Por eso Google se maneja con **campaña manual + enlace
rastreable**, que no requiere credenciales. Está explicado en la sección 4.

### Secreto del cron — ya está puesto en local

`AUTOMATION_CRON_SECRET` en `.env.local` (vale `dev-local-cron-secret`). En
producción es el mismo secreto que ya usan las automatizaciones, así que no hay
que crear uno nuevo.

---

## 2. Fase 1 — De qué anuncio vino cada lead

Ya está probado y funcionando; esto es para que lo veas tú.

Un anuncio real de Click-to-WhatsApp costaría presupuesto y un tunnel público,
así que hay un script que envía **el mismo payload que manda Meta**, firmado
igual:

```bash
cd ~/Proyectos/wacrm && node scripts/dev/simulate-inbound.mjs --phone-number-id 999888777 --from 51987000111 --name "Cliente del anuncio" --ad-id 120210000000009 --headline "Promo julio" --url http://localhost:3100/api/whatsapp/webhook
```

Después entra a **Contactos**: el contacto nuevo aparece con fuente **Meta Ads**
y, al abrirlo, el panel derecho muestra el ID del anuncio y el titular.

**Qué más vale la pena probar:**

- **No se duplica ni se sobreescribe** (regla de "primer toque"): repetí el mismo
  comando agregando `--wamid wamid.REPETIDO` dos veces. El contacto conserva la
  primera fuente y no se crea un segundo registro de atribución.
- **Un post orgánico no cuenta como pagado:** agregá `--source-type post`. La
  fuente queda **Orgánico**, no Meta Ads — si contara como anuncio, dividiría tu
  gasto real entre más leads y te mostraría un costo por lead más bajo que el real.
- **Un mensaje normal** (sin `--ad-id`) queda como *Desconocido*, que es lo
  correcto.

**Límite que conviene tener claro desde ya:** Meta manda el dato del anuncio
**solo en el primer mensaje** después del clic. Si el cliente hace clic hoy y te
escribe por su cuenta tres días después, ese lead va a contar como orgánico. Es
una limitación de Meta, no del CRM.

---

## 3. Fase 2 — Conectar Meta Ads y ver gasto y costo por lead

1. **Configuración → Cuentas publicitarias**.
2. Pega el `act_...` y el token de la sección 1. Al guardar, el CRM **valida
   contra Meta antes de guardar nada**: si el token o el ID están mal, ves el
   error de Meta tal cual, en el momento, en vez de un sync que falla en silencio
   días después.
3. Si validó, aparece el nombre y la moneda que reporta Meta.
4. Dale a **Sincronizar ahora**.
5. Anda a **Campañas**: deberías ver tus campañas activas/pausadas con gasto,
   leads, costo por lead y las "conversaciones iniciadas" que reporta Meta.

**Sobre las dos cifras de leads:** la columna *Leads* son los contactos que el
CRM atribuyó a esa campaña; *Conversaciones iniciadas (Meta)* es el conteo de
Meta con su propia ventana de atribución. **No van a coincidir**, y eso es
esperado — se muestran las dos a propósito en lugar de elegir una y fingir que
es la verdad.

**Programar el sync diario (producción).** El endpoint ya está listo para que lo
llame n8n:

```bash
curl -H "x-cron-secret: TU_SECRETO" https://crm.agenciakibo.com/api/ads/sync
```

En local, para probar el mismo camino:

```bash
curl -H "x-cron-secret: dev-local-cron-secret" http://localhost:3100/api/ads/sync
```

---

## 4. Fase 3 — Google Ads, enlaces rastreables y ROI

Este flujo ya lo dejé armado y probado en tu cuenta local, para que lo veas
funcionando y puedas repetirlo con tus datos.

**El paso a paso completo también está dentro de la app**, en Configuración →
Cuentas publicitarias: hay un acordeón numerado para Meta y otro para Google, con
la advertencia del token que caduca y el orden en que se hacen las cosas.

### Activar Google

**Configuración → Cuentas publicitarias → «Activar Google Ads».** No pide ninguna
credencial; solo deja Google visible como plataforma en esa lista. (Si creás una
campaña manual sin pasar por acá, se activa igual, por el mismo camino interno.)

### Cargar una campaña de Google

**Campañas → Agregar campaña manual**: plataforma Google Ads, nombre, moneda,
gasto y **la fecha de ese gasto**.

Cada fecha guarda su propio monto. Eso es lo que hace que el rango 7/30/90 días
signifique algo: el ROI de «últimos 7 días» compara el gasto y las ventas del
mismo periodo. Para corregir o agregar gasto después, el ícono de lápiz en la fila
de la campaña abre el historial de entradas, donde podés editar una fecha o
borrarla.

### Crear el enlace rastreable

**Campañas → Enlaces rastreables → Nuevo enlace.** Le pones tu número de
WhatsApp, un mensaje prellenado y, opcionalmente, la campaña a la que suma.

Te devuelve una URL tipo `http://localhost:3100/l/zbm15w`. Esa es la URL que
pones como destino del anuncio de Google, en la bio de Instagram o en un QR
impreso. Al abrirla, redirige a WhatsApp con el mensaje ya escrito y un código
corto al final: `Hola, vengo de Google [#zbm15w]`.

Ese código es lo que ata la respuesta a la campaña. **El cliente lo ve** antes de
enviar, por eso es corto y opaco. Si lo borra a mano antes de enviar, se pierde
la atribución de ese lead — no hay forma de evitarlo en este camino.

Probar la cadena completa:

```bash
# 1. Simular el clic (sube el contador)
curl -sI "http://localhost:3100/l/zbm15w" | grep -i location

# 2. Simular que el cliente envía el mensaje prellenado
cd ~/Proyectos/wacrm && node scripts/dev/simulate-inbound.mjs --phone-number-id 999888777 --from 51987444555 --name "Lead de Google" --text "Hola, vengo de Google [#zbm15w]" --url http://localhost:3100/api/whatsapp/webhook
```

El contacto queda con fuente **Google Ads** y ligado a la campaña.

### Ver el ROI

Crea un negocio para ese contacto en **Embudos** y márcalo **Ganado**. Volvé a
**Campañas**: aparecen *Ingresos*, *Negocios ganados* y el **ROI**.

Verificado con datos reales en tu cuenta local: gasto PEN 450, 1 lead, costo por
lead PEN 450, ingresos PEN 500 → **ROI 11%**, que es `(500 − 450) / 450`.

**Dos detalles del diseño, para que no te sorprendan:**

- Si el gasto es 0, el ROI muestra "n/d" en lugar de un número. Un ingreso
  dividido por cero gasto no es "retorno infinito", es "faltan datos".
- Si la moneda de la cuenta publicitaria **no** coincide con la del CRM, en lugar
  del ROI ves un aviso. No hay conversión de monedas en la app, así que un número
  ahí estaría mezclando soles con dólares en silencio. Tu caso está bien: cuenta
  en PEN y Meta en PEN.

---

## 5. Fase 4 — Vendedores

1. **Embudos → filtro "Vendedor"** arriba del tablero: *Todos*, *Solo míos* o una
   persona. Filtra las tarjetas y las métricas de arriba.
2. **Tabla "Por vendedor"**: negocios, valor, ganados y tasa de conversión por
   persona. Ojo: **esta tabla no obedece al filtro de arriba**, y es a propósito —
   filtrarla ocultaría la comparación entre vendedores, que es justamente para lo
   que sirve.
3. **Notificación al asignar:** asigna un negocio a María (editando el negocio) y
   entra con `vendedora@local.test`; le llega la notificación. No te llega a ti si
   te lo asignas a ti mismo.
4. **Reparto automático:** **Automatizaciones → nueva automatización**, disparador
   "mensaje recibido", paso **"Asignar negocio"** en modo rotación. Dispara un
   mensaje con el script de la sección 2: el negocio se asigna a quien tenga
   **menos negocios abiertos** en ese momento.

---

## 6. Subir a producción

### Los errores de la revisión ya están corregidos

Los tres que te reporté (y que solo se despertaban al pasar un día) quedaron
resueltos, más los de rendimiento y los dos preexistentes de traducción:

- **Gasto manual duplicándose:** ahora son entradas con fecha. Probado guardando
  tres veces el mismo día: queda **una** fila con el último valor, y el campo del
  monto ya no se precarga con el total, que era el mecanismo que lo inflaba.
- **Anuncios que no se reintentaban:** hay reintentos con espera creciente
  (inmediato, 15 min, 1 h, 6 h, 24 h) y rendición explícita al quinto intento.
  Los anuncios que quedaron varados con el código anterior se reintentan solos.
- **Zona horaria:** la fecha ahora la manda el navegador, así que se escribe y se
  lee con el mismo reloj. La ventana que se le pide a Meta se calcula en UTC y se
  amplió a 4 días para no perder el día de borde.
- **Rendimiento del sync:** los upserts van en lote (de ~150 viajes a la BD por
  corrida a 2) y se sigue la paginación de Meta, que antes se truncaba en silencio
  e **inflaba el ROI** sin avisar. Las llamadas a Meta tienen timeout.
- **Traducciones:** el `roles.owner` y los selectores con valor crudo.

Queda una limitación que **no** es un error, y conviene tenerla presente: las
filas que sincroniza Meta llevan la fecha del huso de la cuenta publicitaria,
mientras que el gasto manual lleva la del navegador. Si algún día no coinciden, la
sección de Cuentas publicitarias lo avisa en vez de mostrar números que parecen
corridos sin explicación.

### Pasos del despliegue

**El SQL va antes del redeploy.** Los cambios son aditivos (tablas y columnas
nuevas con valor por defecto), así que el código que hoy corre en producción sigue
funcionando con el esquema nuevo. Al revés, la app nueva buscaría tablas que
todavía no existen.

1. **Supabase Cloud → SQL Editor → New query**, y pegá el contenido de
   [`docs/deploy/ads-attribution.sql`](deploy/ads-attribution.sql). Es un solo
   archivo con las migraciones 037 a 042 en orden. Se puede re-ejecutar sin
   romper nada (verificado corriéndolo dos veces sobre la misma base).
2. Merge de `feat/ads-attribution` a `main` en tu fork.
3. Redeploy en Coolify.
4. **Configuración → Cuentas publicitarias:** conectá Meta Ads siguiendo el paso a
   paso que está ahí mismo, y activá Google si lo vas a usar. Acordate del token
   de **usuario del sistema**, no el del Explorador.
5. Programá en n8n el GET diario a `/api/ads/sync` con el secreto del cron.
6. Validación real, una sola vez: un anuncio Click-to-WhatsApp con presupuesto
   mínimo, escribirle desde otro teléfono, y comprobar que el gasto y el costo
   por lead cuadran con el Administrador de Anuncios de Meta (con tolerancia por
   zona horaria y ventana de atribución).

Si en algún momento agregás más migraciones, el archivo se regenera con:

```bash
cd ~/Proyectos/wacrm && ./scripts/deploy/bundle-migrations.sh
```

---

## Apéndice — recrear el usuario después de un `db reset`

```bash
cd ~/Proyectos/wacrm
SR=$(npx supabase status -o json | python3 -c 'import json,sys;print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/admin/users' \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H 'Content-Type: application/json' \
  -d '{"email":"luis@local.test","password":"Prueba1234","email_confirm":true}'
```

Después, en Supabase Studio o por `psql`, poné la cuenta en PEN y apuntá el
número de WhatsApp de prueba a esa cuenta:

```sql
UPDATE accounts SET name = 'Agencia Kibo (local)', default_currency = 'PEN'
WHERE owner_user_id = (SELECT id FROM auth.users WHERE email = 'luis@local.test');

UPDATE whatsapp_config SET
  user_id = (SELECT id FROM auth.users WHERE email = 'luis@local.test'),
  account_id = (SELECT account_id FROM profiles
                WHERE user_id = (SELECT id FROM auth.users WHERE email = 'luis@local.test'))
WHERE phone_number_id = '999888777';
```

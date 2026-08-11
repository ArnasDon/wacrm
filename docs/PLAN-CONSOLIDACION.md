# Plan de consolidación del fork

Auditoría del fork contra `wacrm` original y plan de ejecución para que los módulos añadidos —telefonía, SMS, email, landing, analytics— se sientan parte del mismo producto y funcionen.

**Regla que gobierna todas las decisiones de este documento:** si el wacrm original ya resuelve algo, se usa lo original. No se añade una tabla, un componente ni un endpoint cuando basta una columna, una prop o un parámetro.

---

## 1. Veredicto

El fork **no es un Frankenstein**. Es un buen fork con siete fallos concretos, dos de ellos fatales y silenciosos, y una capa de duplicación en la base de datos que sí hay que colapsar.

Números: 68.169 líneas originales → 80.209 en el fork. 12.000 líneas añadidas, 10 tablas nuevas, 19 migraciones nuevas. `tsc --noEmit` pasa limpio. El middleware es **idéntico** al original, byte por byte — lo que se rompió en su momento ya está restaurado.

Lo que está bien hecho y **no se toca**:

| Área | Por qué está bien |
|---|---|
| `sidebar.tsx` | Diff de 6 líneas: tres imports de icono y tres entradas. Exactamente como lo habría hecho el autor |
| `telnyx_config`, `calls` | RLS con `is_account_member`, drop-then-create, idempotente, API key cifrada con el `encryption.ts` que ya existía |
| Reutilizar `Step2SelectAudience` | El wizard de email importa el paso de audiencia de broadcasts sin copiarlo |
| `messages.channel` (041) | Columna aditiva con default en vez de tabla nueva. Es el criterio correcto |
| `send_sms` / `send_email` en automatizaciones | Se añadieron como casos nuevos en el `switch` del engine, no como motor paralelo |
| `contact-detail-view` | Botón de email añadido dentro del componente existente |
| pnpm | Correcto y se mantiene |

---

## 2. Los siete fallos reales

### 2.1 La migración 052 es SQL inválido — el módulo de email nunca pudo escribir

`supabase/migrations/052_email_campaigns.sql:71`

```sql
DROP POLICY IF EXISTS email_campaigns_insert ON email_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
```

`DROP POLICY` no admite `FOR INSERT ... WITH CHECK`. Falta por completo el `CREATE POLICY`. El error se repite en las líneas 71, 74 y 78.

Consecuencia exacta: Postgres aborta la migración en la línea 71. Todo lo que viene después **no existe en la base de datos**:

- `email_campaigns` se creó (líneas 38-69) con RLS activo y **solo política de SELECT**. Cualquier INSERT o UPDATE desde el navegador se rechaza en silencio.
- `email_campaign_recipients` **no existe**.
- Los triggers de agregación de conteos **no existen**.

Esto es, por sí solo, la causa de "el módulo de email no funciona". No es un bug de la aplicación: la aplicación está bien, la tabla contra la que escribe está a medio crear.

### 2.2 El formulario de la landing envía TypeScript al navegador

`landing/src/components/LeadForm.astro:99-101`

```astro
<script define:vars={{ landingBase }}>
  function readHidden(form: HTMLFormElement, name: string): string {
```

`define:vars` implica `is:inline`, y Astro **no procesa los scripts inline**: no los compila, no les quita los tipos, no los empaqueta. El navegador recibe TypeScript literal.

Verificado en el build ya publicado:

```
$ grep -o 'function readHidden([^)]*)' public/landing/index.html
function readHidden(form: HTMLFormElement, name: string)

$ node --check  # sobre el script extraído
SyntaxError: Unexpected token ':'
```

El script lanza un `SyntaxError` antes de ejecutar una sola línea. El `addEventListener('submit')` nunca se registra. El formulario hace su submit nativo por GET, recarga la página y no llama a `/api/events`. **Por eso no entra nada a Supabase.**

Segundo bug detrás del primero: `readHidden` busca con `input[name="..."]`, pero `message` es un `<textarea>`. Aunque se arregle el primero, el mensaje siempre llegará vacío.

### 2.3 `email_sends` y `email_campaign_recipients` registran lo mismo

Dos tablas guardan "un correo enviado a alguien", con `resend_message_id` en ambas. El webhook de Resend tiene que decidir cuál actualizar y no hay forma correcta de decidirlo: un envío de campaña cumple las dos definiciones.

### 2.4 Los canales nuevos no se ven en el inbox

La migración 041 dice, textualmente, que añade `channel` para que "el SMS entrante viva en `messages` y aparezca en el inbox". La columna existe y el webhook escribe en ella. Pero:

- `Message` en `src/types/index.ts:260` **no declara** `channel`.
- `message-thread.tsx` no lo lee: cero ocurrencias.

Un SMS entra a la base de datos y aparece en el hilo disfrazado de mensaje de WhatsApp. La mitad de la migración se quedó sin hacer.

### 2.5 Las acciones nuevas de automatización están a medio conectar

El motor está bien: `engine.ts:429` y `engine.ts:454` implementan `send_sms` y `send_email` como casos del `switch` existente, que es exactamente como se debía hacer. Lo que falta es todo lo que rodea al motor.

**Los nombres salen crudos en pantalla.** El constructor renderiza el nombre del paso con `t('steps.' + label)` (`automation-builder.tsx:1263`). En los tres archivos de idioma, `Automations.builder.steps` tiene 13 entradas y **no incluye `send_sms` ni `send_email`**. `Automations.builder.triggers` tiene 8 y **no incluye `missed_call` ni `message_read`**. Cuando falta la clave, lo que se pinta es la ruta de traducción. Eso es lo que estás viendo.

```
en: steps=13 triggers=8   faltan: send_sms, send_email · missed_call, message_read
es: steps=13 triggers=8   faltan: send_sms, send_email · missed_call, message_read
ko: steps=13 triggers=8   faltan: send_sms, send_email · missed_call, message_read
```

**`message_read` es un disparador fantasma.** Está declarado en `types/index.ts:611`, tiene su píldora en `trigger-meta.ts:46`, `validate.ts:215` lo contempla, y el webhook de WhatsApp lo despacha en `webhook/route.ts:452`. Pero **no está en `TRIGGER_OPTIONS`** (`automation-builder.tsx:139`), así que no se puede elegir en el desplegable. El código funciona y nadie puede activarlo.

**Los pasos nuevos nacen inválidos.** `blankConfig()` (`automation-builder.tsx:171`) tiene un `case` por cada tipo de paso menos estos dos: caen en `default: return {}`. El paso se crea sin `text` ni `template`, y `validate.ts` lo marca como inválido en cuanto se añade. Todos los demás pasos nacen con su forma correcta.

**`send_email` pide escribir el nombre de la plantilla a mano.** Es un `<Input>` de texto libre. Todos los demás pasos que apuntan a una entidad usan selector: `TagSelect`, `AgentSelect`, `SendTemplateFields`, selectores de pipeline y etapa. Un nombre mal escrito no falla al guardar; falla en ejecución, con `template "x" not found`, cuando la automatización ya está en producción.

**Textos en inglés fijo.** `label="SMS text"`, `label="Email template name"`, `"no sms text yet"`, `"pick an email template"`. El resto del constructor pasa por `t(...)` sin excepción.

Ninguno de estos cinco puntos es de arquitectura. Es una integración que se quedó al 70%.

### 2.6 `/reports` tiene ocho pestañas y una fuga de datos

`src/app/(dashboard)/reports/page.tsx:23` declara ocho: Overview, Campaigns, Channels, Ads, Email, Calls, **Top leads** y **Lost**. Las dos últimas son las que recuerdas, y las dos tienen problemas propios.

**Top leads miente sobre el filtro de fechas.** `lib/reporting/queries.ts:279`:

```ts
export async function loadTopLeads(_range: DateRange): Promise<TopLeadRow[]> {
```

El guion bajo delante de `_range` significa "recibo este parámetro y no lo uso". La página muestra un selector de rango en la cabecera; en esa pestaña cambiarlo no hace nada. Además el corte es un `.limit(20)` fijo, sin criterio de negocio detrás.

**Ninguno de los ocho cargadores filtra por cuenta.** Los ocho usan `supabaseAdmin()`, que salta RLS por diseño, y ninguno lleva `.eq('account_id', …)`. Con una sola cuenta no se nota. En cuanto exista una segunda, `/reports` enseña los datos de todas. Es justo lo que el autor original evita en cada política con `is_account_member`.

**Y el conjunto de pestañas se solapa con el panel de inicio.** Overview repite lo que ya muestra `/dashboard`. Campaigns, Channels y Ads son tres cortes de la misma consulta sobre `tracking_events`, separados por columna de agrupación. Lost es un filtro de Top leads.

Reducción propuesta: **cuatro pestañas**.

| Pestaña | Qué responde | Sustituye a |
|---|---|---|
| Adquisición | De dónde vienen los leads y qué cuestan | Campaigns + Channels + Ads, con un desplegable de agrupación |
| Conversión | Cuántos avanzan, cuántos se pierden y por qué | Top leads + Lost |
| Canales | Volumen y resultado por WhatsApp, SMS, correo y llamada | Email + Calls |
| — | Overview desaparece: su sitio es `/dashboard` | Overview |

Tres consultas menos, la misma información, y ninguna pestaña que el dueño tenga que explicar.

### 2.7 La telefonía entrante nunca se implementó

`src/app/api/telnyx/call/route.ts:12` lo dice sin rodeos: *"Fase 1: inbound = forwarding nativo Telnyx (sin bridge por código)"*.

El webhook (`api/telnyx/webhook/route.ts:92-96`) atiende `call.initiated`, `call.answered`, `call.hangup`, `message.received` y `call.recording.saved`, y en los tres primeros **solo escribe en la tabla `calls`**. No hay `answer`, no hay creación de una segunda pata, no hay `bridge`. Es contabilidad, no control de llamada.

Por eso el softphone del navegador no recibe llamadas: nadie las lleva hasta él. Ver §7 para la solución completa.

---

## 3. Las 10 tablas nuevas: qué sobrevive

| Tabla | Veredicto | Razón |
|---|---|---|
| `telnyx_config` | **Se queda** | Espeja `whatsapp_config`. Es el patrón del autor: una config por proveedor |
| `calls` | **Se queda** | Una llamada no es un mensaje. Duración, grabación, causa de colgado no caben en `messages` |
| `email_config` | **Se queda** | Espeja `whatsapp_config` |
| `tracking_events` | **Se queda** | Atribución de visitante anónimo. No existe nada equivalente en el original |
| `email_templates` | **Se queda y crece** | Ver 3.1 y 3.3 — se generaliza a las plantillas que gobiernas tú: correo y SMS |
| `email_campaigns` | **Se colapsa** | Ver 3.2 |
| `email_campaign_recipients` | **Se colapsa** | Ver 3.2 |
| `email_sends` | **Se colapsa** | Ver 3.2 |
| `message_queue` | **Se colapsa** | Ver 3.5 |
| `frequency_rules` | **Se colapsa** | Ver 3.5 |

De 10 tablas nuevas quedan **5**. Las otras cinco se convierten en columnas sobre tablas que ya existen.

### 3.1 `email_templates` se queda separada — el criterio es quién manda

La tentación es evidente: `message_templates` ya tiene `header_type`, `header_content`, `body_text`, `footer_text`, `buttons`, `status`. Es el mismo formulario. Pero **que el formulario sea el mismo no significa que la entidad sea la misma**, y aquí la diferencia no es cosmética: las dos tablas tienen dueños distintos.

Una plantilla de WhatsApp la aprueba Meta. Una plantilla de correo la apruebas tú. Eso cambia todo el ciclo de vida:

| | `message_templates` | plantillas de email |
|---|---|---|
| Quién aprueba | Meta | El dueño de la cuenta |
| Ciclo de estado | `Draft → Pending → Approved / Rejected` | No hay ciclo |
| Se envía a un tercero | Sí, el contenido viaja a la Graph API | Nunca |
| Quién escribe la fila | La app **y** Meta, vía sync y webhook | Solo la app |
| Se puede editar tras aprobar | No sin `hsm_id` | Siempre |

Y sobre todo: **Meta escribe en esa tabla.** Tres rutas del repo la modifican desde fuera:

- `api/whatsapp/templates/submit/route.ts` manda el contenido de la fila a la Graph API.
- `api/whatsapp/templates/sync/route.ts:242` trae la lista de Meta y localiza cada fila con `.eq('account_id').eq('name').eq('language')`, sin más criterio. Una plantilla de correo llamada igual que una de WhatsApp **queda sobrescrita con el contenido de Meta**. No hay aviso: es un `update` normal.
- `lib/whatsapp/template-webhook.ts:134` actualiza estado y `quality_score` por `meta_template_id`.

El índice único de la migración 051 es `(account_id, name, language)`. No tiene dimensión de canal, así que dos plantillas con el mismo nombre —una de correo, una de WhatsApp— ni siquiera pueden coexistir sin rehacer el índice.

Además, `message_templates` arrastra ocho columnas que solo existen para Meta: `meta_template_id`, `sample_values`, `rejection_reason`, `quality_score`, `header_handle`, `header_media_url`, `submission_error`, `last_submitted_at`. En una fila de correo todas quedan nulas para siempre.

Y el coste operativo de mezclarlas: **veinte** puntos del repo consultan `message_templates` sin filtro alguno —el selector del inbox, el paso 1 de broadcast, el constructor de automatizaciones, `send-message.ts`, `broadcast-core.ts`, el resumen de ajustes—. Cada uno necesitaría `.eq('channel','whatsapp')`. Olvidar uno significa, en el mejor caso, ofrecer una plantilla de correo en un envío de WhatsApp; en el peor, mandar HTML de email a la API de Meta. Eso último no es un bug de la app: es actividad anómala contra una cuenta de WhatsApp Business.

**Lo que sí se comparte es el editor, no la tabla.** El formulario de header/cuerpo/pie se extrae a un componente común que ambos gestores usan con props distintas: el de WhatsApp muestra categoría, idioma y estado de aprobación; el de correo muestra asunto y no muestra nada de Meta. Se reutiliza la interfaz, que es de donde venía tu observación, sin cruzar dos ciclos de vida incompatibles.

Las dos siguen viviendo en Ajustes, como ya están hoy. Eso no cambia.

### 3.2 `email_campaigns` + `email_campaign_recipients` + `email_sends` → columnas en `broadcasts` + `broadcast_recipients`

Aquí el criterio de 3.1 se aplica igual, y da el resultado contrario: **una campaña no tiene dueño externo.** Verificado en el código:

- `broadcast-core.ts` nunca envía la campaña a Meta. Al enviar manda `template_name` y la lista de destinatarios al endpoint de mensajes; la fila de `broadcasts` no sale del sistema.
- El webhook de Meta solo escribe de vuelta, y localiza la fila por `whatsapp_message_id` (`api/whatsapp/webhook/route.ts:404`), que es un identificador opaco por mensaje. Un id de Resend no puede colisionar con un `wamid`: no comparten espacio de nombres.
- La escalera `draft/scheduled/sending/sent/failed` la escribe la app, nadie más.

Nadie externo aprueba una campaña, nadie externo la reescribe y su contenido no viaja a ninguna API ajena. Por eso aquí colapsar sí es correcto.

Compara los dos esquemas. `email_campaigns` es `broadcasts` con dos conteos renombrados:


| `broadcasts` | `email_campaigns` |
|---|---|
| `name`, `audience_filter`, `template_variables` | idénticos |
| `scheduled_at`, `status` (mismos 5 estados) | idénticos |
| `total_recipients`, `sent_count`, `delivered_count`, `failed_count` | idénticos |
| `read_count`, `replied_count` | `opened_count`, `clicked_count` |

Es la misma tabla. El propio archivo 052 lo admite en su cabecera: *"Replica el modelo de `broadcasts` … pero para email"*. Replicar un modelo es la señal de que faltaba una columna.

```sql
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','email')),
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS body_snapshot text;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz;
```

`read_count` cuenta aperturas en email y lecturas en WhatsApp: es el mismo peldaño de la escalera con distinto nombre en cada proveedor. `replied_count` cuenta clics. `provider_message_id` sustituye a `wamid` y a `resend_message_id` con un solo nombre.

Ganancia: una sola lista de campañas con un filtro por canal, un solo detalle de campaña, un solo motor de agregación de conteos, un solo `broadcast-status.ts`. Desaparecen `email-campaign-status.ts`, `email-campaigns-list.tsx` y el hook `use-email-campaign-sending.ts`.

Sobre `email_sends`: un envío individual desde la ficha del contacto es una campaña de un destinatario. Si esa unificación resulta forzada al implementarla, la alternativa correcta **no** es una tabla: es `messages` con `channel = 'email'`, que es donde ya vive todo lo demás que se le manda a un contacto.

### 3.3 SMS: mismo criterio, y cae del lado tuyo

El SMS es como el broadcast de WhatsApp en forma, pero **Telnyx no aprueba nada**. No hay revisión, no hay estado `Pending`, no hay webhook que reescriba tu contenido. El dueño eres tú, igual que en el correo.

Aplicando el criterio de §3.1, la frontera no queda entre canales sino entre autoridades:

| Tabla | Contenido | Quién aprueba | Quién escribe |
|---|---|---|---|
| `message_templates` | Plantillas de WhatsApp | Meta | La app y Meta |
| `owned_templates` | Plantillas de correo y SMS | Tú | Solo la app |

Así que `email_templates` no se queda tal cual: **se generaliza a las dos que gobiernas tú**, sin crear ninguna tabla nueva.

```sql
ALTER TABLE email_templates RENAME TO owned_templates;

ALTER TABLE owned_templates
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','sms'));

ALTER TABLE owned_templates ALTER COLUMN subject DROP NOT NULL;
```

`subject` pasa a ser opcional porque un SMS no lo tiene. `body_html` guarda HTML en correo y texto plano en SMS. El índice único `(account_id, name)` se amplía a `(account_id, channel, name)`.

Nada de esto puede colisionar con Meta: la sincronización y el webhook de Meta solo tocan `message_templates` y no conocen esta tabla.

### 3.4 Broadcast de SMS: una entrada más en el `CHECK`

Con `broadcasts` ya colapsado (§3.2), añadir SMS no cuesta una tabla ni un asistente: cuesta una palabra.

```sql
-- en lugar de CHECK (channel IN ('whatsapp','email'))
CHECK (channel IN ('whatsapp','email','sms'))
```

Todo lo demás ya sirve: la resolución de audiencia, el troceado, los estados, la agregación incremental de conteos. Solo cambia la rama de envío dentro de `broadcast-core.ts`, que ya tendrá dos.

Sobre los conteos por canal: Telnyx entrega acuses de recibo, así que `delivered_count` funciona igual que en WhatsApp. Un SMS no tiene apertura ni clic, así que `read_count` y `replied_count` se quedan en cero y la interfaz de detalle oculta esas columnas cuando el canal es `sms`. Es la misma tabla contando lo que cada canal sabe reportar.

**Resultado:** un asistente de campañas, tres canales. Eliges canal en el paso cero y el resto del flujo es idéntico. Es justo lo que pediste para email, extendido a SMS sin coste adicional.

### 3.5 `message_queue` y `frequency_rules` → lo que ya existe

`automation_pending_executions` (migración 006 del original) ya es una cola de trabajo diferido, con `run_at`, `status`, `context` JSONB, índice parcial sobre pendientes y RLS cerrada a service-role. Es exactamente lo mismo que `message_queue`, escrito por el autor tres migraciones después del esquema inicial.

`frequency_rules` tiene cinco campos de configuración por cuenta: máximo diario y ventana horaria. Eso es una fila de ajustes, no una entidad. Va en `accounts` como columna `messaging_rules jsonb`, junto a `default_currency` que ya vive ahí.

---

## 4. Vocabulario: cómo se llama cada cosa

El riesgo real de meter SMS en `messages` no es técnico, es de lenguaje: en wacrm "mensaje" significa WhatsApp, y en cuanto deja de significarlo sin avisar, todo el mundo —tú, un colaborador, un agente de IA— empieza a equivocarse.

La solución no es partir la tabla. Es fijar el vocabulario y no salirse de él.

### Dónde va cada cosa y por qué

| Concepto | Dónde vive | Criterio |
|---|---|---|
| Conversación con un contacto | `conversations` | Hilo continuo, en tiempo real |
| WhatsApp | `messages`, `channel = 'whatsapp'` | Texto en un hilo |
| SMS | `messages`, `channel = 'sms'` | Texto en un hilo — misma forma exacta |
| Correo | Fuera de `messages` | Tiene asunto, cuerpo HTML e hilo propio por cabeceras. No es lo mismo |
| Llamada | `calls` | Tiene duración, grabación y causa de colgado |

WhatsApp y SMS comparten tabla porque **son la misma cosa**: un texto dirigido a un contacto dentro de un hilo, con acuse de entrega y lectura. Lo que cambia es el transporte. El correo no comparte tabla porque no comparte forma.

### Reglas de nombres

1. **"Mensaje" nunca se usa a secas cuando se quiere decir WhatsApp.** Se dice "mensaje de WhatsApp" o se nombra el canal explícito. En código, cualquier función que reciba mensajes de más de un canal lleva `channel` como parámetro obligatorio, no opcional con valor por defecto.

2. **Todo lo exclusivo de WhatsApp vive bajo `lib/whatsapp/` y `api/whatsapp/`.** Es la convención que el autor original ya sigue. Si un archivo fuera de esas carpetas importa algo de Meta, está mal colocado.

3. **`message_templates` significa "plantilla de WhatsApp".** El nombre es engañoso ahora que hay tres canales, pero **no se renombra**: veinte puntos del repo la referencian y renombrarla convierte cada actualización futura del upstream en un conflicto. En su lugar, la regla de §3.1 la mantiene encerrada: fuera de `lib/whatsapp/` y `api/whatsapp/` nadie la consulta. Las plantillas de correo y SMS viven en `owned_templates`, cuyo nombre sí dice la verdad.

4. **"Campaña" siempre lleva canal.** Campaña de WhatsApp, de correo, de SMS. La palabra "broadcast" queda reservada para el nombre de la tabla y de la ruta, que no cambian.

5. **En la interfaz, el canal siempre se ve.** En el hilo del inbox, cada burbuja lleva su marca de canal. En la lista de campañas, una columna de canal. Nunca se deduce por contexto.

Este apartado no cuesta trabajo de implementación: cuesta disciplina. Es lo que evita que dentro de seis meses haya una tabla `sms_messages` porque alguien no supo dónde poner algo.

---

## 5. Plan de ejecución

Cinco fases. Cada una deja el repo funcionando: si paras después de cualquiera, nada queda a medias.

### Fase 0 — Verificar el estado real de la base de datos

Antes de escribir una línea. La 052 falló a mitad, así que el esquema real y las migraciones no coinciden y no se puede planear a ciegas.

```sql
-- ¿Qué tablas existen de verdad?
select table_name from information_schema.tables
where table_schema = 'public' order by 1;

-- ¿Qué políticas tiene email_campaigns? (esperado: solo select)
select policyname, cmd from pg_policies
where tablename = 'email_campaigns';

-- ¿Existe email_campaign_recipients? (esperado: no)
select to_regclass('public.email_campaign_recipients');

-- ¿Cuántas filas hay que migrar en cada tabla que se va a colapsar?
select 'email_templates', count(*) from email_templates
union all select 'email_campaigns', count(*) from email_campaigns
union all select 'email_sends', count(*) from email_sends
union all select 'message_queue', count(*) from message_queue;
```

El resultado decide si las fases 2 y 3 necesitan migrar datos o pueden limitarse a borrar tablas vacías. **No sigas sin esto.**

### Fase 1 — Que funcione lo que ya está escrito

Dos correcciones. Ninguna toca arquitectura y las dos desbloquean módulos completos.

1. **Reescribir 052.** Si la fase 0 confirma que está vacía: borrar el archivo entero y las tablas que dejó a medias, porque la fase 3 las va a sustituir por columnas. Si tiene datos: emitir `057_fix_email_campaign_policies.sql` con los tres `CREATE POLICY` que faltan más las tablas y triggers que nunca se crearon.

2. **Arreglar el formulario de la landing.** Quitar los tipos del script inline, o mejor: sacar el script a `landing/src/scripts/lead-form.ts` e importarlo con un `<script>` normal —que Astro sí compila— pasando `landingBase` por un `data-` en el formulario en lugar de `define:vars`. Y cambiar `input[name=...]` por `[name=...]` para que lea el `<textarea>`.

3. **Cerrar las acciones de automatización** (§2.5). Es la corrección con mejor relación valor/esfuerzo del plan, porque el motor ya está escrito:

   - Añadir `send_sms` y `send_email` a `Automations.builder.steps` en `en.json`, `es.json` y `ko.json`.
   - Añadir `missed_call` y `message_read` a `Automations.builder.triggers`, con etiqueta y pista, en los tres idiomas.
   - Añadir `message_read` a `TRIGGER_OPTIONS`. El disparador ya funciona; solo falta poder elegirlo.
   - Añadir los dos `case` que faltan en `blankConfig()`: `send_sms → { text: "" }`, `send_email → { template: "" }`.
   - Sustituir el input libre de `send_email` por un selector de plantillas, con el mismo patrón que `TagSelect` y `AgentSelect`.
   - Pasar por `t(...)` las etiquetas y los resúmenes que quedaron en inglés fijo.

**Comprobación de la fase:** enviar el formulario en producción y ver la fila en `contacts` y en `tracking_events`. Crear una automatización con un paso de SMS y otro de correo, guardarla, activarla y verla ejecutarse en los registros.

### Fase 2 — Plantillas propias: correo y SMS en una tabla

`message_templates` **no se toca en absoluto**, por lo de §3.1.

1. Migración: renombrar `email_templates` a `owned_templates`, añadir `channel`, hacer `subject` opcional y ampliar el índice único a `(account_id, channel, name)` (§3.3).
2. El gestor de plantillas de Ajustes gana un selector de canal con dos opciones. Cuando es SMS, oculta el asunto y el cuerpo pasa a texto plano con contador de caracteres.
3. Extraer de `template-manager.tsx` el formulario de encabezado/cuerpo/pie a un componente común, sin lógica de canal dentro. El editor de WhatsApp lo usa mostrando categoría, idioma y estado de aprobación; el de plantillas propias lo usa sin nada de eso.
4. El paso `send_sms` de las automatizaciones gana la opción de elegir una plantilla además de escribir el texto directo.

**Regla que queda escrita para el futuro:** ninguna consulta a `message_templates` fuera de `lib/whatsapp/` y `api/whatsapp/`. Un canal cuyo contenido no aprueba Meta usa `owned_templates`.

### Fase 3 — Campañas en una sola tabla

Es la fase grande. Independiente de la 2: se pueden hacer en cualquier orden o en paralelo.

1. Migración: las columnas de §3.2 sobre `broadcasts` y `broadcast_recipients`.
2. Extender el trigger de agregación existente (migración 005) para que entienda `opened`/`clicked`. No escribir un `_ec_bump` paralelo: el original ya hace lo mismo en O(1).
3. `broadcast-core.ts` gana una rama por canal en el punto de envío. El resto —resolución de audiencia, troceado, conteo, estados— es idéntico y no se duplica.
4. `/email/new` se elimina; `/broadcasts/new` gana el paso cero: elegir canal entre WhatsApp, correo y SMS. Los pasos 2 (audiencia) y 4 (programar y enviar) ya son compartibles tal cual. Solo el paso 1 (plantilla) y el 3 (previsualización) se bifurcan.
5. La lista de `/broadcasts` gana un filtro por canal. `/email` pasa a ser un enlace a `/broadcasts?channel=email`.
6. El detalle de campaña oculta las columnas que el canal no reporta: sin aperturas ni clics cuando es SMS (§3.4).
7. Borrar `email_campaigns`, `email_campaign_recipients`, `email-campaign-status.ts`, `use-email-campaign-sending.ts`, `email-campaigns-list.tsx`.

**Lo que pediste sobre secuencias** entra aquí y no necesita motor nuevo: una secuencia de correos es una automatización cuyos pasos son `send_email` con `delay` entre ellos. El engine ya soporta ambos y `automation_pending_executions` ya programa el diferido.

### Fase 4 — Cerrar el ecosistema

Lo que hace que se sienta un solo producto en vez de módulos vecinos.

1. **`channel` en el inbox.** Añadir el campo a `Message` en `types/index.ts` y una marca visual en la burbuja de `message-thread.tsx`. Es lo que la migración 041 prometía y dejó a medias.
2. **Cola y frecuencia sobre lo existente.** Mover los diferidos a `automation_pending_executions`, las reglas a `accounts.messaging_rules`, borrar `message_queue` y `frequency_rules`.
3. **Historial unificado en la ficha del contacto.** Una sola línea de tiempo que mezcle `messages` (los tres canales), `calls` y `tracking_events` ordenados por fecha. Hoy el email tiene botón pero no deja rastro visible.
4. **Logs.** Todo envío por cualquier canal escribe en `automation_logs` cuando lo dispara una automatización, y en `tracking_events` cuando es una acción de negocio. Sin tabla de logs nueva.
5. **Dashboard e informes.** Las tarjetas nuevas se añaden a `lib/dashboard/queries.ts`, que ya consulta `tracking_events`. `/reports` baja de ocho pestañas a cuatro (§2.6), Overview desaparece porque su sitio es `/dashboard`, y **los ocho cargadores reciben `.eq('account_id', …)`**, que hoy no tienen.
6. **Vocabulario.** Aplicar §4: marca de canal en cada burbuja del inbox, columna de canal en la lista de campañas, y ningún texto de interfaz que diga "mensaje" cuando quiere decir WhatsApp.

### Fase 5 — Telefonía entrante

Independiente de todo lo demás. Se puede hacer en cualquier momento, incluso antes que la 3.

1. Migración: `credential_connection_id` y `agent_sip_uri` en `telnyx_config`, más los campos correspondientes en Ajustes › Telnyx.
2. Convertir los tres manejadores del webhook de contabilidad a control de llamada: contestar, crear la segunda pata, unirlas (§7).
3. Emparejar las patas por `client_state`, nunca por un `Map` en memoria.
4. Completar la limpieza en el navegador: cerrar la pista de audio remota y comprobar que la pasarela vuelve a *registrado* antes de aceptar otra llamada.

**Comprobación de la fase:** tres llamadas entrantes seguidas al mismo número, contestadas y colgadas desde el navegador. Si la tercera entra igual que la primera, el 486 está resuelto.

---

## 6. Reglas para quien ejecute esto

Válidas tanto si lo haces tú como si lo delegas a un agente.

**Sobre el stack.** `AGENTS.md` ya avisa de que este Next.js no es el que el modelo conoce: Next 16.2.12, React 19.2.4, Tailwind 4, TypeScript 6. Antes de escribir código que toque rutas, middleware, `params` o caché, hay que leer `node_modules/next/dist/docs/`. Este es el fallo que ya te costó el middleware una vez.

**Node.** `package.json` declara `>=20.0.0`, el Dockerfile del fork usa `node:24-alpine` y el del original `node:20-alpine`. Elige uno, fíjalo en un `.nvmrc` en la raíz y que el Dockerfile lo lea de ahí. Un agente que no puede ver tu versión local va a asumir la suya.

**pnpm siempre.** Nunca `npm install` ni `npx`. Si un comando necesita un binario suelto: `pnpm dlx`. El `package-lock.json` del original no se copia al fork.

**Convenciones de migración**, tomadas de las 36 originales: numeración correlativa de tres dígitos, `IF NOT EXISTS` en todo, `DROP POLICY` en su propia sentencia antes de `CREATE POLICY`, RLS con `is_account_member(account_id, rol)`, y la migración tiene que poder correrse dos veces sin romperse.

**Verificar el SQL antes de aplicarlo.** El fallo de la 052 lo detecta cualquier parser. Antes de dar por buena una migración, pásala por una base de datos desechable. Nunca directo a producción.

**Una sola pregunta antes de crear cualquier cosa:** ¿el wacrm original ya lo resuelve? Tablas nuevas solo cuando la entidad no existe —`calls` lo pasó, `email_campaigns` no—. Componentes nuevos solo cuando ninguno existente sirve con otra prop.

**Cierre.** Cuando termine la fase 4 hay que borrar de `docs/` los archivos de traspaso entre agentes: `NOTAS-INTER-AI.md` y `TRASPASO-SESION-AUDITORIA.md`. Documentan quién hizo qué en qué rama, no cómo funciona el producto. Es el mismo ruido que quieres eliminar del código.

---

## 7. Telefonía entrante: el patrón de dos patas

El síntoma que recuerdas —siempre ocupado, las llamadas no entran— tiene nombre en el protocolo: **SIP 486 `user_busy`**. Y tiene dos causas, ninguna misteriosa.

### Cómo debe funcionar

Telnyx lo llama Patrón 2: la llamada del exterior no se puede "mandar al navegador". Hay que crear una **segunda llamada** hacia el cliente WebRTC y unir las dos.

```
Llamada PSTN → tu número (en la Call Control App) → webhook a tu servidor
                                                          ↓
                                             answer sobre la pata A
                                                          ↓
                                    POST /v2/calls → pata B hacia sip:<agente>@sip.telnyx.com
                                    connection_id = CONEXIÓN DE CREDENCIALES
                                                          ↓
                                             el navegador contesta
                                                          ↓
                                             bridge  pata A ↔ pata B
```

Secuencia exacta de eventos:

| Evento | Qué hace el servidor |
|---|---|
| `call.initiated` con `direction: incoming` | `answer` sobre la pata A, con `client_state` marcado como entrante |
| `call.answered` con estado *entrante* | Crea la pata B hacia el SIP del agente y guarda la pareja |
| `call.answered` con estado *WebRTC* | `bridge` de la pata B contra la pata A |
| `call.hangup` | Cuelga la otra pata y borra la pareja |

El `client_state` es un JSON en base64 que viaja con cada pata: es lo que permite saber, al recibir `call.answered`, cuál de las dos contestó. Sin él no se puede distinguir y el puente se hace al revés o no se hace.

### Las dos causas del "ocupado"

**1. El `connection_id` equivocado.** Al crear la pata B hacia el navegador hay que usar el `connection_id` de la **conexión de credenciales** (la que autentica al softphone), no el de la Call Control App. La CCA es para recibir del exterior; la conexión de credenciales es para hablar con clientes WebRTC. Si mandas la pata B a la CCA, el SIP no encuentra a nadie registrado y responde ocupado.

Hoy el fork solo conoce un identificador: `telnyx_config.call_control_app_id`. **Falta la columna de la conexión de credenciales**, y sin ella el puente no se puede construir aunque se escriba el código.

**2. La sesión anterior no se destruye en el navegador.** Si el SDK conserva una `RTCPeerConnection` fantasma de la llamada previa, el registro SIP contesta 486 a la siguiente. El fork ya tiene la mitad de esto: `use-telnyx.ts:323` llama a `call.hangup()` y desreferencia, con un comentario explícito de anti-486. Falta cerrar también la pista de audio remota y verificar que el estado de la pasarela vuelve a *registrado* antes de aceptar otra llamada.

### Qué hay que añadir

```sql
ALTER TABLE telnyx_config
  ADD COLUMN IF NOT EXISTS credential_connection_id text,
  ADD COLUMN IF NOT EXISTS agent_sip_uri text;
```

Y en `api/telnyx/webhook/route.ts`, los tres manejadores existentes pasan de contabilidad a control: `onCallInitiated` contesta, `onCallAnswered` bifurca según `client_state` y hace el puente, `onCallHangup` cuelga la pata huérfana. La escritura en `calls` que ya hacen se conserva tal cual.

**Una advertencia sobre el emparejamiento.** La referencia guarda las parejas de patas en un `Map` en memoria. Eso funciona en un servidor único y se rompe en cuanto haya más de una instancia o el proceso se reinicie: el webhook puede llegar a un proceso que no tiene el `Map`. La pareja va en la base de datos —dos columnas en `calls`, `bridge_peer_control_id` y `leg_role`— o directamente dentro del `client_state`, que Telnyx devuelve íntegro en cada evento y no necesita almacenamiento. La segunda opción es la más limpia y no cuesta ninguna columna.

### Sobre conectar el número de Telnyx a WhatsApp

Tu instinto es correcto y conviene dejarlo por escrito para no revisitarlo.

Un número puede estar en Telnyx para voz y SMS **y** registrado en la API de WhatsApp Business de Meta al mismo tiempo. No compiten: una vez registrado, el tráfico de WhatsApp viaja por la API de Meta, no por el operador. Lo único que se cruza es el alta, que exige recibir un código de verificación una sola vez.

Dos cautelas para ese momento:

- **Verifica por llamada de voz, no por SMS.** Si el código llega por SMS, lo intercepta tu webhook de Telnyx y acaba en el inbox en vez de a la vista. Por voz lo escuchas y ya.
- **El número no puede estar dado de alta en la app de WhatsApp normal.** Si lo estuvo, hay que borrar esa cuenta antes.

Y lo que **no** conviene hacer: usar Telnyx como proveedor de WhatsApp. Se puede, pero significaría reescribir toda la capa de WhatsApp contra la abstracción de Telnyx y perder lo que ya funciona contra Meta —el envío de plantillas, la sincronización, el estado de aprobación, la puntuación de calidad, los webhooks de estado—. Es el módulo mejor resuelto del CRM. Mantener Meta directo para WhatsApp y Telnyx solo para voz y SMS es la separación correcta: cada proveedor hace aquello para lo que tienes ya el código escrito.

Antes de comprar el número, confirma en la documentación vigente de Telnyx y de Meta que el procedimiento de alta sigue igual; esa parte cambia con más frecuencia que el resto.

---

## 8. Orden sugerido de trabajo

| Fase | Bloquea a | Riesgo | Entrega |
|---|---|---|---|
| 0 · Verificar BD | Todas | Ninguno | Saber qué existe de verdad |
| 1 · Correcciones | — | Bajo | Email, landing y automatizaciones funcionando |
| 2 · Plantillas propias | Fase 3 (SMS) | Bajo | Correo y SMS en una tabla, un editor |
| 3 · Campañas | — | **Alto** | Un asistente, tres canales |
| 4 · Ecosistema | — | Medio | Se siente un solo producto |
| 5 · Telefonía entrante | — | Medio | El softphone recibe llamadas |

Las fases 0 y 1 son de una sesión y arreglan lo que hoy está roto. Dentro de la 1, lo de automatizaciones es lo más barato de todo el plan: el motor ya está escrito, falta conectarle la interfaz.

La 3 es la que de verdad elimina la duplicación y conviene hacerla de una vez, con el repo limpio y en una rama propia.

---

## 9. El criterio, en una frase

Antes de fusionar dos cosas que se parecen, la pregunta no es *¿tienen los mismos campos?* sino **¿quién manda sobre cada una?**

Si las dos las gobierna tu aplicación, fusiónalas: es duplicación. Si una la gobierna un tercero —Meta aprueba, sincroniza y reescribe—, mantenlas separadas aunque el formulario se vea idéntico. Comparte la interfaz, nunca la tabla.

Es el mismo criterio que aplicó el autor original: `whatsapp_config` separada de `accounts` porque Meta manda sobre una y no sobre la otra.

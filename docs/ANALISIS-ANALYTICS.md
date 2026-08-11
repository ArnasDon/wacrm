# Analytics: qué mide hoy, qué no, y cómo debería verse

Análisis del módulo de analítica del fork contra `docs/analytics.md`, y propuesta de rediseño de `/reports`.

---

## 1. Por qué las pestañas no cuadran

No es un problema de diseño. Es que `/reports` **no se diseñó**: se transcribió.

`docs/analytics.md` §7.6 contiene una tabla de ocho filas —Overview, Campañas, Canales, Ads, Email, Llamadas, Top leads, Perdidos— pensada como inventario de consultas para un documento de arquitectura. La vista tiene exactamente esas ocho pestañas, en ese orden, con esos nombres.

Una tabla de especificación agrupa por criterio técnico: *"esta consulta agrupa por `utm_campaign`, esta por `channel`, esta por `click_id`"*. Son tres cortes de la misma consulta. En un documento tiene sentido enumerarlos; en una interfaz son tres pestañas que obligan al usuario a saber qué es un `click_id` para elegir dónde mirar.

Ese es todo el diagnóstico. Lo demás son consecuencias.

---

## 2. El eslabón roto: la atribución nunca llega al contacto

Este es el hallazgo que hay que arreglar antes que cualquier rediseño, porque hoy **tres de las ocho pestañas no pueden mostrar nada**.

### La cadena, paso a paso

| Paso | Dónde | Estado |
|---|---|---|
| 1. El navegador captura UTMs y click ids | `lib/analytics/god.ts` | ✅ Funciona |
| 2. Se guardan con TTL de 90 días y espejo en cookie | `god.ts:20-58` | ✅ Funciona |
| 3. Se rellenan los campos ocultos del formulario | `god.ts:81` | ✅ Funciona |
| 4. El formulario los manda a `/api/events` | `LeadForm.astro` | ✅ Funciona |
| 5. Se escriben en `tracking_events.attribution` | `api/events/route.ts:110` | ✅ Funciona |
| 6. **Se escriben en `contacts.attribution`** | `lib/api/v1/contacts.ts:127` | ❌ **No ocurre** |

`findOrCreateContact` inserta exactamente seis campos:

```ts
.insert({
  account_id: accountId,
  user_id: auditUserId,
  phone: sanitized,
  name: input.name ?? sanitized,
  email: input.email ?? null,
  company: input.company ?? null,
})
```

No hay `attribution`, y `ContactInput` (`contacts.ts:97`) ni siquiera declara el campo. `/api/events` tiene el objeto de atribución en la mano, lo escribe en `tracking_events` y luego llama a esta función sin él.

### Por qué eso vacía tres pestañas

Los tres informes de origen leen de `contacts`, no de `tracking_events`:

```
loadCampaigns  queries.ts:169   .from('contacts').select('attribution, id, deals!inner(id)')
loadChannels   queries.ts:194   .from('contacts').select('attribution, id')
loadAds        queries.ts:216   .from('contacts').select('attribution, id')
```

Con `contacts.attribution` en NULL para todo lead que entra por la landing:

- **Campañas** — todo cae en `(sin campaña)`.
- **Canales** — todo cae en `direct`, porque `?? 'direct'` es el valor por defecto.
- **Ads** — **vacía**, porque el bucle hace `continue` cuando no hay click ids.

La única excepción es el lead que entra por *click-to-WhatsApp*: el webhook de Meta sí escribe `contacts.attribution` (`whatsapp/webhook/route.ts:620`). Es decir, hoy solo verías datos de un canal, y por accidente.

### Por qué no basta con leer de `tracking_events`

Es tentador reapuntar las consultas a `tracking_events`, que sí tiene la atribución. No sirve: el ingreso vive en `deals`, y `deals` se une a `contacts`, no a `tracking_events`. Sin atribución en el contacto, la pregunta *"¿cuánto dinero me trajo esta campaña?"* no tiene respuesta posible por ningún camino.

### El arreglo

Añadir `attribution` a `ContactInput`, escribirlo en el `insert`, y **solo en el insert**: si el contacto ya existe, la atribución no se toca. Es la regla de primer contacto, la misma que ya aplica `god.ts` en el navegador — el canal que trajo a la persona es el que se lleva el mérito, no el último por el que volvió.

Son unas quince líneas y desbloquean todo el resto de este documento.

---

## 3. El seguimiento por DOM: lo que sí tienes

Tu sistema de atribución **sí está portado**, y está mejor construido que el original: `attribution.ts` es un módulo puro y testeable, y `god.ts` es solo la capa de navegador que lo usa. 258 líneas entre los dos.

| Capacidad | Dónde | Notas |
|---|---|---|
| UTMs completos | `attribution.ts:34` | source, medium, campaign, term, content |
| Click ids | `attribution.ts:9` | gclid, gbraid, wbraid, fbclid, msclkid, ttclid, li_fat_id, gad_source |
| Inferencia de canal | `attribution.ts:79-82` | click id → utm_source → referrer → direct, en ese orden de prioridad |
| Persistencia 90 días | `god.ts:20` | localStorage con TTL propio, más espejo en cookie primaria |
| `visitor_id` a un año | `god.ts:62` | localStorage + cookie, permite unir visitas anónimas |
| Relleno de campos ocultos | `god.ts:81` | Sobre `form:not([data-no-track])` — cualquier formulario del sitio |
| Beacons de clic | `god.ts:121` | Escuchador delegado sobre `wa.me` y `tel:`, con `sendBeacon` |
| `ref_code` | `god.ts:102` | Código corto que viaja **dentro del texto prellenado de WhatsApp** |

El `ref_code` merece un párrafo. Es la pieza que resuelve el agujero clásico: cuando alguien salta de tu web a WhatsApp, las cookies no lo siguen y pierdes el origen. Al meter un código corto en el mensaje prellenado, el origen viaja dentro del propio texto que la persona te envía. Eso no lo tiene casi nadie y es lo que hace que la atribución sobreviva al salto de canal.

### Lo que le falta

**1. `page_view` no se persiste.** `god.ts:117` lo empuja a `dataLayer` para GTM, pero nunca llama a `/api/events`. Resultado: `tracking_events` no tiene una sola fila de visita. Sin eso no puedes calcular la tasa de conversión de la landing, que es la primera cifra de cualquier embudo. Y ya tienes el tipo `page_view` declarado en el CHECK de la tabla, esperando.

**2. El `ref_code` de la landing no se inyecta.** `landing/src/pages/index.astro:15` importa `wa-ref` en el frontmatter, así que se ejecuta en build y nunca llega al navegador. Los enlaces de WhatsApp de la landing salen sin código: justo la pieza del punto anterior, inutilizada.

**3. `fillHiddenInputs` busca con `input[name="..."]`** (`god.ts:83`). Si un campo del formulario es un `<textarea>` o un `<select>`, no lo encuentra. Es la misma familia de bug que ya apareció en `LeadForm.astro`.

**4. El consentimiento es permisivo por defecto.** `god.ts:105`: `W.getConsent?.("ad_storage") ?? "granted"`. Si nadie define `getConsent`, se asume concedido. Para México está bien; si algún cliente opera en la UE, hay que invertir el valor por defecto.

---

## 4. La taxonomía de eventos es aspiracional en un 74 %

`tracking_events.event_type` (migración 047, línea 90) declara **23 tipos**. Se escriben **seis**:

| Se escriben | Dónde |
|---|---|
| `form_submit` | `/api/events` |
| `ctwa_lead` | webhook de WhatsApp |
| `whatsapp_click` | `/api/track` |
| `phone_click` | `/api/track` |
| `scroll_depth` | `/api/track` |
| `state_changed` | RPC `transition_deal` |

Nunca se escriben: `conversion`, `purchase`, `lead_value`, `good_lead`, `better_lead`, `appointment_booked`, `service_started`, `closed_won`, `page_view`, `email_click`, `outbound_click`, `message_sent`, `message_received`, `call_logged`, `utm_recorded`, `score_changed`, `identity_merged`.

Hay dos formas de leerlo. La mala: el esquema promete un embudo de ingresos que nada alimenta. La buena: **`state_changed` ya cubre casi todo eso**. Cuando un trato pasa a *cita agendada*, eso ya queda registrado con su marca de tiempo. No hacen falta ocho tipos de evento nuevos: hace falta leer bien el que ya existe.

Recomendación: recortar el CHECK a los seis reales más `page_view`, y derivar el embudo de `state_changed`. Un tipo de evento que nadie escribe es una promesa incumplida en la interfaz.

---

## 5. Qué del documento se construyó y qué no

`docs/analytics.md` son 850 líneas. El balance es mejor de lo que parece:

**Se construyó, y bien:**

- La máquina de estados de §7.1 es real y es el corazón del CRM. `transition_deal` es la única vía de movimiento, con `guard_rules`, bloqueo optimista por `version` y emisión de `state_changed`. La usan el kanban (`pipelines/page.tsx:229`), el formulario de trato y la Cola de Hoy.
- El scoring de §7.2 existe: `set_deal_tags`, `_sum_score`, `_compute_priority`.
- `won_at` / `lost_at` reales, sin el proxy de `updated_at`.
- La atribución por DOM de §2, íntegra.
- La landing de §3 con la fachada de YouTube y las métricas de velocidad.

**Se quedó en filosofía, y está bien que así fuera:**

- Segmentos dinámicos, líneas de tiempo por contacto y constructor visual de campañas al estilo Mautic. El propio documento los descarta en §8.4. Fueron la decisión correcta: son meses de trabajo para un CRM que ya resuelve el 90 % con automatizaciones y etiquetas.

**Lo que el documento causó:** las ocho pestañas. Una tabla de inventario técnico convertida en interfaz sin pasar por diseño.

**Qué hacer con el archivo.** Cumplió su función. Hoy son 65 KB que describen un estado del repo que ya no es cierto —dice, por ejemplo, que `/reports` no existe— y cualquier agente que lo lea trabaja con una foto vieja. Muévelo a `docs/archivo/` o recórtalo a las decisiones vigentes. No lo borres: la máquina de estados de §7.1 sigue siendo la mejor explicación de por qué el pipeline funciona como funciona.

---

## 6. Rediseño de la vista

### El criterio

Una vista de analítica para un negocio de servicios contesta cuatro preguntas, en este orden:

1. ¿Estoy generando suficientes oportunidades?
2. ¿Dónde se me están cayendo?
3. ¿De dónde vienen las que **valen**?
4. ¿Qué hago hoy con esto?

Las ocho pestañas actuales no contestan ninguna: contestan *"¿cómo se ve esta tabla agrupada por X?"*.

### La propuesta: una página, cinco bloques, sin pestañas

Todo bajo un único selector de rango que afecta a **todo** —hoy `loadTopLeads` lo ignora—, con comparativa contra el periodo anterior.

---

**Bloque 1 · Cifras (cabecera)**

Cuatro números, cada uno con su variación frente al periodo anterior:

```
Leads          Citas          Ganados        Ingreso
   47             18              6          $84,200
  ▲ 12%          ▲ 5%           ▼ 2%          ▲ 18%
```

El Overview actual muestra siete cifras sin comparativa. Un número sin referencia no informa: 47 leads no es bueno ni malo hasta que sabes que el mes pasado fueron 40.

Sustituye a: **Overview**. Y el Overview desaparece como pestaña, porque su sitio natural es `/dashboard`.

---

**Bloque 2 · Embudo**

Una fila de barras con la caída entre cada paso:

```
Visitas ──▶ Leads ──▶ Contactados ──▶ Citas ──▶ Ganados
  1,240      47          41             18         6
           3.8%        87%            44%        33%
```

**Esto es lo que hoy no existe y es lo que más falta.** Es lo único que contesta "dónde se me cae la gente", que es la pregunta que de verdad mueve dinero. El paso más flojo te dice exactamente dónde trabajar: si de contactado a cita pierdes el 60 %, tu problema no es el tráfico, es el guion de la llamada.

Se construye con `state_changed`, que ya se emite. Requiere que se persista `page_view` para la primera columna.

---

**Bloque 3 · Origen**

Una tabla, con un selector de agrupación en la cabecera: **Campaña · Canal · Anuncio · Landing**.

| Origen | Leads | → Cita | Ganados | Ingreso | **Por lead** |
|---|---:|---:|---:|---:|---:|
| brand-cdmx | 18 | 44 % | 3 | $42,000 | **$2,333** |
| implantes-generico | 22 | 18 % | 1 | $12,000 | **$545** |
| orgánico | 7 | 57 % | 2 | $30,200 | **$4,314** |

Sustituye a tres pestañas: **Campañas, Canales y Ads**. Son el mismo informe con distinto `GROUP BY`; eso es un desplegable, no tres pestañas.

La columna que importa es la última. "Leads" premia al canal barato que trae volumen malo; **ingreso por lead** te dice dónde subir el presupuesto. En el ejemplo, la campaña con más leads es la que menos vale.

---

**Bloque 4 · Canales de contacto**

Tabla corta: WhatsApp, llamada, correo, SMS. Volumen enviado, respuesta, y leads que acabaron en ganado.

Sustituye a: **Email** y **Llamadas**. Hoy son dos pestañas que muestran contadores sueltos —enviados, entregados, rebotados por un lado; llamadas por día por otro— sin conectarlos con el resultado. Un contador de correos entregados no es analítica: es un recibo.

---

**Bloque 5 · Pendientes**

Dos listas cortas, lado a lado, con acción directa:

- **Prioritarios** — mayor score, sin contactar. Botón para abrir la conversación.
- **Recuperables** — perdidos por *no contestó* o *largo plazo*, con más de N días. Botón de reactivar.

Sustituye a: **Top leads** y **Perdidos**. Y conecta con la Cola de Hoy que ya existe en el panel, en lugar de duplicarla.

Lo que no debe hacer: la lista de perdidos por *desistió* no lleva botón de reactivar. Quien dijo que no, dijo que no; insistir quema la lista.

---

### El resultado

| Antes | Después |
|---|---|
| 8 pestañas | 1 página, 5 bloques |
| 3 estructuralmente vacías | 0 |
| 8 consultas | 5 |
| Agrupadas por criterio técnico | Agrupadas por pregunta de negocio |
| Sin comparativa | Todo comparado con el periodo anterior |
| El rango de fechas se ignora en una | Aplica a todo |

Si prefieres conservar pestañas por costumbre, la reducción mínima defendible es tres: **Resumen** (bloques 1 y 2), **Origen** (bloque 3), **Acción** (bloques 4 y 5).

---

## 7. Orden de trabajo

| Paso | Qué | Esfuerzo | Desbloquea |
|---|---|---|---|
| 1 | `attribution` en `findOrCreateContact`, solo al crear | ~15 líneas | Todo el bloque 3. Sin esto, nada más importa |
| 2 | `.eq('account_id', …)` en los ocho cargadores | Trivial | Cierra la fuga de tenencia |
| 3 | `loadTopLeads` respeta el rango | Trivial | Coherencia del selector de fechas |
| 4 | Persistir `page_view` en `/api/events` | Pequeño | La primera columna del embudo |
| 5 | Arreglar `wa-ref` en `index.astro` | Una línea | El `ref_code` en los enlaces de WhatsApp |
| 6 | Consulta del embudo sobre `state_changed` | Medio | Bloque 2 |
| 7 | Rediseño de la vista | Medio | Bloques 1 a 5 |
| 8 | Recortar el CHECK de `event_type` a lo real | Pequeño | Deja de prometer lo que no hay |

Los pasos 1 a 5 son de una sesión corta y transforman una vista que hoy miente en una que dice la verdad, aunque todavía tenga ocho pestañas. El rediseño puede esperar; **la atribución rota, no**: cada día que pasa se pierden leads sin origen que ya no se puede reconstruir.

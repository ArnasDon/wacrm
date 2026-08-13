# Prompt — reconstruir el módulo de analítica y los estados

Trabajas sobre mi fork de wacrm. Este documento es la especificación completa: no hace falta que redescubras nada, ya está verificado con archivo y línea.

Lee antes de escribir código: `docs/archive/ANALISIS-ANALYTICS.md` (el diagnóstico) y `AGENTS.md`.

---

## Restricciones duras

- **Next.js 16.2.12, React 19.2.4, Tailwind 4, TypeScript 6.** No es la versión que conoces. Antes de tocar rutas, middleware, `params`, caché o Server Actions, lee `node_modules/next/dist/docs/`. Ya me costó el middleware una vez.
- **pnpm siempre.** Nunca `npm`, nunca `npx`. Si necesitas un binario suelto: `pnpm dlx`.
- **No renombres tablas ni archivos existentes.** Divergir del upstream hace conflictivo cada merge futuro.
- **No crees tablas nuevas.** Si crees que necesitas una, para y explícame por qué.
- **No toques `message_templates` ni nada bajo `lib/whatsapp/` ni `api/whatsapp/`.** Meta escribe en esa tabla.
- **Diffs quirúrgicos.** No reescribas archivos completos para cambiar diez líneas.
- **`git commit` al terminar cada bloque**, con mensaje descriptivo.

**Y la regla que gobierna todo lo demás:** si wacrm ya lo resuelve, se usa lo de wacrm. Este documento se apoya en tres sistemas que ya existen y funcionan —campos personalizados, `transition_deal` y el filtro de audiencias— precisamente para no construir nada nuevo.

---

## Hallazgos verificados (no los vuelvas a investigar)

| # | Hallazgo | Evidencia |
|---|---|---|
| 1 | `findOrCreateContact` no escribe `attribution`; `ContactInput` ni lo declara | `lib/api/v1/contacts.ts:97` y `:127` |
| 2 | `/api/events` tiene la atribución y la escribe solo en `tracking_events` | `api/events/route.ts:110` |
| 3 | Los tres informes de origen leen `contacts.attribution` | `lib/reporting/queries.ts:169`, `:194`, `:216` |
| 4 | Resultado: Campañas → `(sin campaña)`, Canales → `direct`, Ads → vacía | Confirmado en pantalla |
| 5 | Ningún cargador de informes filtra por `account_id`; los ocho usan `supabaseAdmin()` | `lib/reporting/queries.ts` completo |
| 6 | `loadTopLeads` ignora el rango de fechas | `queries.ts:279`, parámetro `_range` |
| 7 | El seed de etapas son 4 nombres genéricos, en un componente de cliente | `app/(dashboard)/pipelines/page.tsx:41-44` |
| 8 | **Nada escribe nunca `guard_rules`**: siempre NULL → toda transición pasa | grep en `src/`: solo lecturas y tests |
| 9 | `call_logged` y `message_received` no se escriben en `tracking_events` | Por diseño: viven en `calls` y `messages` |
| 10 | Los campos personalizados ya se muestran, filtran, segmentan y automatizan | `contact-detail-view.tsx:672`, `step2-select-audience.tsx:113-159`, `engine.ts:670` |

---

## Bloque 1 — La atribución tiene que llegar al contacto

Sin esto, nada de lo demás sirve. Hoy entra un lead, su origen se guarda en `tracking_events`, y el contacto queda sin origen. Como el ingreso vive en `deals` → `contacts`, la pregunta "cuánto me trajo esta campaña" no tiene respuesta.

### 1.1 Escribirla en el contacto

Añade `attribution?: Attribution | null` a `ContactInput` y escríbela en el `insert` de `findOrCreateContact`.

**Solo al crear.** Si el contacto ya existía, no se toca: primer contacto gana. Es la misma regla que ya aplica `god.ts` en el navegador y la razón es de negocio — el canal que trajo a la persona es el que merece el crédito, no aquel por el que volvió.

Después, pásala desde `/api/events` en la llamada que ya existe.

### 1.2 Proyectarla a campos personalizados

Aquí está el punto: **wacrm ya sabe mostrar, filtrar, segmentar y automatizar campos personalizados.** Si la atribución vive ahí, todo eso sale gratis.

Siembra estos ocho campos (`custom_fields`) la primera vez que hagan falta, de forma idempotente:

| `field_name` | Contenido |
|---|---|
| Canal | `attribution.channel` — google, meta, orgánico, directo… |
| Campaña | `utm_campaign` |
| Origen | `utm_source` |
| Medio | `utm_medium` |
| Anuncio | `utm_content` |
| Término | `utm_term` |
| Landing | `landing_slug` |
| Click ID | El identificador que trajo al lead, como `gclid:Cj0KC…` |

Al crear el contacto, inserta también sus `contact_custom_values`. Usa el `UNIQUE(contact_id, custom_field_id)` que ya existe con `onConflict`, igual que hace `engine.ts:701`.

Ojo con una cosa: `custom_fields` está acotada por `user_id`, no por `account_id` (migración 001). Al sembrar desde el servidor con rol de servicio, usa `resolveAuditUserId`, que `/api/events` ya importa.

**Lo que ganas sin escribir interfaz:**

- La ficha del contacto muestra el origen — hoy no se ve por ningún lado.
- La vista de contactos filtra por él.
- **El selector de audiencias de campañas segmenta por él.** Puedes mandar un correo solo a quien vino de Google Ads. Eso ya funciona hoy: `step2-select-audience.tsx` filtra por campo personalizado con *es / no es / contiene*.
- Las automatizaciones pueden condicionar por él.

### 1.3 Por qué se escribe en dos sitios

Esta es la única duplicación que autorizo, y quiero el motivo escrito en un comentario:

- **`contacts.attribution` (jsonb)** es el registro canónico. Los informes agregan sobre él sin joins.
- **Los campos personalizados** son la proyección para humanos: ver, filtrar, segmentar.

Misma información, dos formas, porque los dos subsistemas del CRM necesitan formas distintas. Se escriben en la misma función, en el mismo momento, una sola vez.

### 1.4 Persistir `page_view`

`god.ts:117` empuja `page_view` a `dataLayer` pero nunca lo manda a `/api/events`. Sin esas filas no hay primera columna de embudo ni tasa de conversión de landing. El tipo ya está declarado en el CHECK de `tracking_events`.

Mándalo con `sendBeacon`, no con `fetch`: no debe retrasar la carga.

### 1.5 Dos bugs de la misma familia

- `god.ts:83` — `fillHiddenInputs` busca con `input[name="..."]`. No encuentra `<textarea>` ni `<select>`. Cámbialo a `[name="..."]`.
- `landing/src/pages/index.astro:15` — importa `wa-ref` en el frontmatter, así que corre en build y nunca llega al navegador. El `ref_code` no se inyecta en los enlaces de WhatsApp.

---

## Bloque 2 — Los estados por defecto, de verdad

El documento de diseño habla de un motor de estados. En la práctica hoy son cuatro nombres genéricos —New Lead, Qualified, Proposal Sent, Negotiation— que cualquiera puede renombrar, y un sistema de guardas que **nunca tiene reglas**: `guard_rules` es siempre NULL, así que `evaluateTransition` deja pasar todo.

Lo que sí es real y hay que conservar intacto: `transition_deal` da atomicidad, bloqueo optimista por `version` y emisión de `state_changed`. Eso funciona.

### 2.1 El seed por defecto

Saca el seed de `pipelines/page.tsx:41-44` —un componente de cliente no es sitio para esto— y ponlo en `lib/pipelines/default-stages.ts`, consumido al crear un pipeline.

Doce etapas: nueve de avance y tres ramas terminales.

| # | Etapa | Estado | Guarda | Anular |
|---|---|---|---|---|
| 1 | Lead creado | abierto | — | — |
| 2 | Contacto intentado | abierto | — | — |
| 3 | Contactado | abierto | `message_received` | sí |
| 4 | Interés confirmado | abierto | `call_logged` | sí |
| 5 | Calificado | abierto | `call_logged` | sí |
| 6 | Propuesta aceptada | abierto | — | — |
| 7 | Reserva confirmada | abierto | — | — |
| 8 | Servicio iniciado | abierto | — | — |
| 9 | Servicio completado | **ganado** | — | — |
| 10 | No contestó | **perdido** | — | — |
| 11 | Largo plazo | **perdido** | — | — |
| 12 | Desistió | **perdido** | — | — |

`allow_override: true` en todas: la guarda es una lista de verificación, no un muro. El agente avanza igual y el motivo queda auditado en `state_changed`. Un CRM que bloquea al vendedor se deja de usar en una semana.

Las tres ramas terminales son distintas a propósito y hay que respetarlo más abajo: *no contestó* y *largo plazo* son recuperables; *desistió* no.

Las etapas siguen siendo editables por el usuario. Esto es el punto de partida, no una jaula.

### 2.2 Que las guardas puedan cumplirse

Ahora mismo `required_evidence` se resuelve contra `tracking_events`, y `call_logged` y `message_received` **nunca se escriben ahí** — viven en `calls` y en `messages`, que es donde deben vivir.

No los dupliques como eventos. Extiende el resolutor de evidencia para que entienda esos dos como consultas a las tablas nativas:

- `call_logged` → existe una fila en `calls` del contacto del trato, con `disposition = 'completed'`
- `message_received` → existe una fila en `messages` del contacto del trato, con `sender_type = 'contact'`

Hay que hacerlo en dos sitios, y los dos tienen que dar el mismo veredicto: la comprobación SQL dentro de `transition_deal` (es la autoridad) y `evaluateTransition` en `state-machine.ts` (es el reflejo para la interfaz).

### 2.3 Lo que la etapa debe mostrar

Cuando falta evidencia, la interfaz enseña la lista antes de mover, con el texto de `hint`. Eso ya está previsto en `TransitionVerdict.missing`; hoy nunca se llena porque no hay reglas.

---

## Bloque 3 — Informes: una sola vista, sin pestañas

Las ocho pestañas se eliminan. Estas son las decisiones, ya tomadas:

| Pestaña actual | Destino |
|---|---|
| Overview | Desaparece — sus cifras son la cabecera de esta vista |
| **Campañas** | Se funde en Adquisición. "Campañas" a secas es ambiguo: ¿de correo, de WhatsApp, de anuncios? Aquí siempre significa `utm_campaign` |
| **Canales** | Se funde en Adquisición: el canal es una columna y un nivel de agrupación, no una vista |
| **Ads** | Es la vista que sobrevive, renombrada a **Adquisición** |
| Email | Se va al panel de inicio |
| Llamadas | Se va al panel de inicio |
| Top leads | Sale de informes — su sitio es la Cola de Hoy, que ya existe |
| Perdidos | Sale de informes — su sitio es el pipeline, filtrado por las tres ramas terminales |

Queda **una página**: `/reports` = Adquisición.

### 3.1 La cabecera

Cuatro cifras con su variación frente al periodo anterior. Un número sin referencia no informa.

```
Leads          Ganados        Perdidos       Ingreso
   47              6             12          $84,200
  ▲ 12%          ▼ 2%          ▲ 8%          ▲ 18%
```

### 3.2 La tabla

Un selector de agrupación en la cabecera: **Canal · Campaña · Origen · Medio · Anuncio · Landing · Click ID**. Todos son cortes del mismo `contacts.attribution`; eso es un desplegable, no siete pestañas.

Columnas, en este orden y en todos los niveles de agrupación:

| Columna | Qué es |
|---|---|
| Agrupación | El valor del corte elegido |
| **Leads creados** | Contactos creados en el rango con ese origen |
| **Ganados** | De esos, cuántos tienen un trato en estado ganado |
| **Perdidos / basura** | De esos, cuántos acabaron en una de las tres ramas terminales |
| En curso | Los que siguen abiertos |
| Ingreso | Suma del valor de los tratos ganados |
| **Por lead** | Ingreso ÷ leads creados |

Las tres columnas de resultado son obligatorias en todas las filas: es lo que convierte una tabla de volumen en una de rentabilidad.

**"Por lead" es la columna que decide el presupuesto.** Ordenar por "leads creados" premia al canal barato que trae basura. Ordénala por defecto de mayor a menor ingreso por lead.

En **Perdidos / basura**, separa visualmente *desistió* de *no contestó* y *largo plazo* — al pasar el cursor, el desglose. No es lo mismo un lead que dijo que no que uno que nunca contestó: el segundo puede ser un problema de tu tiempo de respuesta, no del canal.

### 3.3 Al desplegar una fila

Una fila expandida muestra el desglose completo de la atribución de ese grupo: todos los UTM presentes, los click ids, y las landings por las que entró. Es lo que hoy pretendía ser la pestaña Ads.

### 3.4 Y lo que hay que arreglar de paso

- `.eq('account_id', …)` en todos los cargadores. Hoy ninguno lo tiene y todos saltan RLS con `supabaseAdmin()`. Con dos cuentas, esta vista enseña los datos de ambas.
- El rango de fechas aplica a todo, sin excepciones.

---

## Bloque 4 — Correo y llamadas al panel de inicio

Los contadores de correo y de llamadas son actividad, no analítica de adquisición. Su sitio es `/dashboard`, junto a las tarjetas que ya existen.

Añade a `lib/dashboard/queries.ts` —que ya consulta `tracking_events`— dos tarjetas:

- **Correo**: enviados, entregados y rebotados en el rango, desde `email_sends`.
- **Llamadas**: total, contestadas y perdidas, desde `calls`.

Y borra `loadEmail` y `loadCalls` de `lib/reporting/queries.ts`.

---

## Criterios de aceptación

| Bloque | Terminado cuando |
|---|---|
| 1 | Un lead nuevo desde la landing con `?utm_source=google&utm_campaign=prueba` aparece con Canal y Campaña rellenos en su ficha, se puede filtrar por ellos en Contactos y seleccionar por ellos en el paso de audiencia de una campaña |
| 2 | Un pipeline nuevo nace con las doce etapas · mover un trato a *Contactado* sin mensajes recibidos muestra la lista de evidencia faltante y deja avanzar con motivo · el motivo queda en `state_changed` |
| 3 | `/reports` es una sola página sin pestañas · el desplegable cambia la agrupación · las tres columnas de resultado aparecen en todas las filas · todos los cargadores filtran por cuenta |
| 4 | El panel de inicio muestra correo y llamadas · las dos pestañas ya no existen |

Al final: `pnpm build`, `pnpm typecheck` y `pnpm test` en verde. Si algo no pasa, dímelo en vez de silenciarlo.

---

## Cómo quiero que trabajes

- **Nunca inventes.** Si no sabes cómo se comporta una API de esta versión, léela en `node_modules` o dime que no lo puedes verificar.
- **Cita archivo y línea** en cada hallazgo.
- **Verifica el SQL antes de aplicarlo**, contra una base desechable. Nunca directo a producción.
- **Si algo te bloquea, para y pregunta.** No improvises una vía paralela ni crees una tabla para esquivar el problema.
- **Si una decisión de este documento te parece equivocada al ver el código, dímelo antes de ejecutarla.**

Al terminar: qué quedó funcionando y cómo lo comprobaste, qué no llegaste a hacer, y qué pasos dependen de mí.

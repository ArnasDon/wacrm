# Prompt — módulo de agenda, citas y traslados

Construir en wacrm la agenda que hoy cubre GoHighLevel, más los traslados que GHL no cubre: turismo médico con paciente que llega en avión, se hospeda, va y vuelve de la clínica varios días, y regresa al aeropuerto.

---

## 1. Cómo se programa aquí

Estos principios están por encima de cualquier instrucción concreta de este documento. Si una tarea de más abajo los contradice, gana el principio y me avisas.

**1. Si wacrm ya lo resuelve, se usa lo de wacrm.** Ya existen contactos, etiquetas, campos personalizados, tratos con máquina de estados, automatizaciones con espera y reanudación por cron, colas con ventana horaria, y envío por WhatsApp, SMS y correo. Este módulo **conecta** todo eso; no construye un motor paralelo.

**2. Una sola tabla nueva, y va justificada abajo.** Todo lo demás son columnas aditivas. Si crees que necesitas otra, paras y me lo explicas.

**3. Ningún componente nuevo si uno existente sirve con otra prop.**

**4. Que parezca escrito por el autor original.** Migraciones correlativas de tres dígitos, `IF NOT EXISTS` en todo, `DROP POLICY` antes de `CREATE POLICY`, RLS con `is_account_member(account_id, rol)`, idempotente para poder correr dos veces.

**5. Nombrar bien.** Una cita es una cita, un traslado es un traslado, y el canal siempre explícito.

**6. Simple y atómico.** Una función, una cosa. Sin abstracciones "por si acaso".

**7. Diffs quirúrgicos.** Si un cambio te obliga a tocar más de cinco archivos, para y explícame por qué.

**8. pnpm siempre.** Nunca `npm`, nunca `npx`. Binario suelto: `pnpm dlx`.

**9. Verificar antes de afirmar.** Next.js 16.2.12, React 19.2.4, Tailwind 4, TypeScript 6 — no es la versión que conoces. Antes de tocar rutas, middleware, `params` o caché, lee `node_modules/next/dist/docs/`. Si no puedes verificar algo, dilo. Todo hallazgo con archivo y línea.

**10. `git commit` al cerrar cada bloque**, en una rama propia.

---

## 2. El negocio, para que el modelo tenga sentido

Un paciente de turismo médico genera esto en un solo viaje:

```
Vuelo llega  →  traslado aeropuerto → hotel
Día 1        →  traslado hotel → clínica  ·  CITA  ·  traslado clínica → hotel
Día 3        →  traslado hotel → clínica  ·  CITA  ·  traslado clínica → hotel
Día 6        →  traslado hotel → clínica  ·  CITA  ·  traslado clínica → hotel
Vuelo sale   →  traslado hotel → aeropuerto
```

Un tratamiento de seis días son **tres citas y ocho traslados**. Por eso el tipo de traslado no puede ser un enum cerrado de cuatro valores: se modela con origen y destino, que además deja abierto cualquier trayecto futuro —clínica a laboratorio, hotel a farmacia— sin migración.

Y el chofer no es el paciente: es un tercero que necesita saber a quién recoge, dónde, a qué hora y a dónde lo lleva.

---

## 3. Modelo de datos

### 3.1 La única tabla nueva: `appointments`

Se justifica porque la entidad no existe: un trato no tiene inicio, fin ni tipo, y un paciente tiene varias citas y varios traslados por trato. Es el mismo criterio con el que se creó `calls`.

```
appointments
  id                    uuid
  account_id            uuid  → accounts
  contact_id            uuid  → contacts        (el paciente)
  deal_id               uuid  → deals, nullable (el tratamiento / viaje)

  kind                  'cita' | 'traslado'
  origin                'aeropuerto' | 'hotel' | 'clinica' | 'otro'   -- solo traslados
  destination           'aeropuerto' | 'hotel' | 'clinica' | 'otro'   -- solo traslados

  starts_at             timestamptz   -- SIEMPRE en UTC
  ends_at               timestamptz

  assigned_to           uuid  → profiles, nullable   -- el doctor o el sillón (citas)
  provider_contact_id   uuid  → contacts, nullable   -- el transporte (traslados)

  location              text          -- dirección concreta: hotel, terminal, consultorio
  notes                 text          -- número de vuelo, terminal, indicaciones al chofer
  status                'programada' | 'confirmada' | 'completada' | 'cancelada' | 'no_asistio'
  created_at / updated_at
```

Reglas de integridad, con `CHECK`:

- Si `kind = 'traslado'`, `origin` y `destination` son obligatorios y distintos entre sí.
- Si `kind = 'cita'`, `origin` y `destination` van nulos.
- `ends_at > starts_at`.

RLS igual que `calls`: lectura para `viewer`, escritura para `agent`, siempre con `is_account_member(account_id, rol)`.

### 3.2 El transporte NO lleva tabla

El chofer o la empresa de transporte es **un contacto con la etiqueta `transporte`**. Con eso ya tienes: ficha, teléfono, historial de conversación, y sobre todo la capacidad de mandarle plantillas por WhatsApp desde el mismo motor que ya usas con los pacientes.

`provider_contact_id` apunta ahí. Cero infraestructura nueva.

### 3.3 Dos columnas en `accounts`

`accounts` hoy no tiene zona horaria — lo verifiqué, no existe en ninguna migración.

```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Cancun',
  ADD COLUMN IF NOT EXISTS booking_rules jsonb;
```

`booking_rules` guarda horario laboral, duración por servicio, colchón entre citas, aviso mínimo y tope diario. Es configuración de una cuenta, no una entidad: va como columna, igual que `default_currency` de la migración 021.

### 3.4 Doble reserva: se resuelve en la base, no en la aplicación

Es la única parte técnicamente difícil y donde casi todo el mundo falla. Si compruebas el solapamiento en la aplicación, dos personas reservando a la vez pasan las dos.

Se resuelve con restricciones de exclusión de Postgres. Requiere la extensión `btree_gist`, que **no está habilitada** en este proyecto: hay que añadirla en la migración.

Dos restricciones parciales, una por cada recurso que se puede doblar:

- Por doctor: mismo `assigned_to` con rangos `[starts_at, ends_at)` que se solapen, ignorando las canceladas.
- Por transporte: mismo `provider_contact_id`, misma lógica.

Verifícalo con dos inserciones simultáneas: la base debe rechazar la segunda. Un `SELECT` previo seguido de `INSERT` **no** es una solución.

### 3.5 Zonas horarias

El paciente reserva desde Ohio y la clínica opera en Cancún. Todo se guarda en UTC. Se muestra en dos zonas: la de la cuenta en el panel, la del navegador en la página pública de reserva. Nunca se guarda una hora local sin zona.

---

## 4. Disponibilidad y reserva pública

**Cálculo de huecos**: a partir de `booking_rules`, menos las citas existentes del recurso, menos los bloqueos. Un bloqueo es una fila de `appointments` sin `contact_id` y con `status = 'confirmada'` — vacaciones, festivo, quirófano ocupado. No hace falta tabla de bloqueos.

**La página pública de reserva vive en la landing de Astro**, siguiendo `docs/SKILL-LANDING-ASTRO.md`: sección del catálogo, formulario con acción de servidor, cero JavaScript de más. Escribe contra un endpoint del CRM que valida disponibilidad en el servidor antes de insertar.

**Confirmación y gestión**: al reservar se manda confirmación con enlaces de reprogramar y cancelar, con un identificador no adivinable en la URL. Nunca el id de la cita en claro.

---

## 5. Google Business Profile

**No intentes integrar Reserve with Google.** Exige ser socio aprobado del Actions Center con relación contractual directa con los comercios; está hecho para plataformas que sirven a muchas clínicas, no para una sola. Y aunque se pudiera, el paciente reservaría dentro de Google sin pisar la landing, así que `god.js` no capturaría nada y se perdería toda la atribución.

Lo que sí se hace:

1. La URL de la página pública de reserva se pega en el perfil de empresa, en *Reservas → Enlaces a tus herramientas de reserva*. Es autoservicio, sin aprobación. **Nunca un acortador.**
2. Añadir `potentialAction` de tipo `ReserveAction` al nodo del negocio en el grafo JSON-LD que la landing ya genera, apuntando a esa misma URL.

Así el tráfico entra por la landing, pasa por la atribución completa, y Google entiende que esa página es para reservar.

---

## 6. Automatizaciones: reutilizar el motor, no duplicarlo

### 6.1 Disparadores nuevos

Se añaden como casos del `switch` existente, igual que se hizo con `send_sms` y `send_email`. No se crea un motor de recordatorios.

| Disparador | Cuándo |
|---|---|
| `appointment_booked` | Al crear la cita o el traslado |
| `appointment_reminder` | A X horas de `starts_at`, configurable |
| `appointment_cancelled` | Al pasar a cancelada |
| `appointment_no_show` | Al pasar a no asistió |

**El recordatorio se resuelve con el cron que ya existe**: recorre las citas cuya hora de aviso llegó y despacha el disparador por la vía normal. No inventes una cola de recordatorios: `automation_pending_executions` y `message_queue` ya están ahí.

### 6.2 El destinatario es una prop, no un paso nuevo

Los pasos `send_message`, `send_sms` y `send_email` ya existen. Lo único que les falta es a quién van dirigidos. Se añade a su configuración:

```
destinatario: 'paciente' | 'transporte' | 'asignado'
```

- `paciente` → `contact_id`
- `transporte` → `provider_contact_id`
- `asignado` → el perfil de `assigned_to`

Con eso, la misma automatización de recordatorio manda una plantilla al paciente y otra al chofer. **Un motor, tres destinatarios.**

### 6.3 Variables de plantilla del traslado

Para que el mensaje al chofer sirva, las plantillas necesitan resolver: nombre del paciente, teléfono del paciente, hora, origen, destino, dirección y notas —donde va el número de vuelo y la terminal—. Se añaden al resolutor de variables que ya usa `contactText`.

**Escapa el HTML** de todos esos valores antes de inyectarlos en un correo: el nombre del paciente es texto que no controlas.

---

## 7. Vistas en el CRM

**Agenda** — nueva entrada en el menú lateral, con el mismo patrón mínimo del resto: un icono y una línea. Vistas día, semana y agenda. Las citas y los traslados se distinguen visualmente; los traslados muestran `Origen → Destino`.

**Filtro por recurso** — por doctor y por transporte.

**Arrastrar para reprogramar** — el cambio pasa por el endpoint que valida disponibilidad, nunca por un update directo desde el cliente.

**En la ficha del contacto** — sus citas y traslados en la línea de tiempo que ya existe, junto a mensajes y llamadas.

**En el trato** — el itinerario completo del viaje, en orden cronológico. Es la vista que de verdad usa quien coordina.

---

## 8. Criterios de aceptación

| # | Terminado cuando |
|---|---|
| 1 | Dos reservas simultáneas del mismo doctor a la misma hora: la base rechaza la segunda |
| 2 | Un paciente reserva desde la página pública en otra zona horaria y ve su hora local; el panel la ve en la de la clínica |
| 3 | Un tratamiento de tres días genera tres citas y ocho traslados, y el itinerario del trato los muestra en orden |
| 4 | El recordatorio llega al paciente **y** al chofer, con plantillas distintas, desde una sola automatización |
| 5 | El mensaje al chofer trae nombre, teléfono, hora, origen, destino, dirección y número de vuelo |
| 6 | Cancelar una cita libera el hueco y dispara su automatización |
| 7 | La URL pública de reserva funciona pegada en el perfil de empresa, y el grafo JSON-LD valida con la acción de reserva |
| 8 | Un lead que llega desde Google Business Profile conserva su atribución hasta el contacto |
| 9 | `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build` en verde |

---

## 9. Cómo quiero que trabajes

- **Nunca inventes.** Si no sabes cómo se comporta una API de esta versión, léela en `node_modules` o dime que no lo puedes verificar. Prefiero un "no lo sé" a una afirmación falsa.
- **Cita archivo y línea** en cada hallazgo.
- **Verifica el SQL con un parser antes de aplicarlo**, y contra una base desechable. Ya hubo una migración que abortó a mitad por un error de sintaxis.
- **Ningún DDL sin respaldo restaurable.**
- **Si algo te bloquea, para y pregunta.** No improvises una vía paralela ni crees una tabla para esquivar el problema.
- **Si una decisión de este documento te parece equivocada al ver el código, dímelo antes de ejecutarla.**

Al cerrar cada bloque: qué quedó funcionando y **cómo lo comprobaste**, qué no, y qué depende de mí.

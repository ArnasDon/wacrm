# Prompt maestro — wacrm reemplaza a GoHighLevel

Objetivo: que wacrm opere la empresa completa, sin pérdida de datos, sin gasto inesperado y con paridad de flujos, para cortar GHL este mes.

Contexto: VPS propio, poca data que migrar, se usan todos los módulos. Esto es producción real: la operación de la empresa depende de este repositorio.

---

## 1. Cómo se programa aquí

Estos principios están por encima de cualquier instrucción concreta de este documento. Si una tarea de más abajo los contradice, gana el principio y me avisas.

**1. Si wacrm ya lo resuelve, se usa lo de wacrm.** Antes de escribir cualquier cosa nueva, la pregunta es si ya existe. Este repositorio tiene campos personalizados, etiquetas, audiencias, automatizaciones con espera y reanudación, colas con ventana horaria, plantillas y una máquina de estados. Casi todo lo que parece faltar ya está y solo hay que conectarlo.

**2. Ninguna tabla nueva.** Una columna aditiva con valor por defecto resuelve el 90 % de los casos. Si de verdad hace falta una tabla, paras y me lo explicas antes de escribirla. Precedente correcto en este repo: la migración 041 añadió `channel` a `messages` en lugar de crear `sms_messages`.

**3. Ningún componente nuevo si uno existente sirve con otra prop.** Reutilizar sin arrastrar deuda: si el componente necesita una rama interna fea para servir a dos casos, extrae la parte común y deja dos envoltorios finos. No copies y pegues.

**4. Que parezca escrito por el autor original.** Mismas convenciones: migraciones correlativas de tres dígitos, `IF NOT EXISTS` en todo, `DROP POLICY` en su propia sentencia antes de `CREATE POLICY`, RLS con `is_account_member(account_id, rol)`, idempotencia para poder correr dos veces. Un revisor no debería distinguir tu código del suyo.

**5. Nombrar bien y distinguir.** "Mensaje" nunca significa WhatsApp a secas: el canal va explícito. Correo es correo, SMS es SMS. Nada de nombres genéricos que obliguen a adivinar por contexto.

**6. Simple y atómico.** Una función hace una cosa. Sin capas de indirección para un solo caso de uso. Sin abstracciones "por si acaso".

**7. Diffs quirúrgicos.** No reescribas un archivo para cambiar diez líneas. Si un cambio te obliga a tocar más de cinco archivos, para y explícame por qué antes de seguir.

**8. No divergir del upstream sin motivo.** Renombrar tablas o archivos existentes convierte cada actualización futura en un conflicto. Las migraciones propias del fork sí se pueden corregir.

**9. pnpm siempre.** Nunca `npm`, nunca `npx`. Binario suelto: `pnpm dlx`. Es una decisión de cadena de suministro, no de gusto.

**10. Verificar antes de afirmar.** Next.js 16.2.12, React 19.2.4, Tailwind 4, TypeScript 6 — no es la versión que conoces. Antes de tocar rutas, middleware, `params`, caché o Server Actions, lee `node_modules/next/dist/docs/`. Si no puedes verificar algo, dilo. Prefiero un "no lo sé" a una afirmación falsa. Todo hallazgo va con archivo y línea.

---

## 2. Qué NO se toca

Estas partes funcionan y son las que sostienen la operación. No se refactorizan, no se "mejoran de paso", no se tocan salvo que este documento lo pida de forma explícita.

| Zona | Por qué |
|---|---|
| `message_templates` y todo bajo `lib/whatsapp/` y `api/whatsapp/` | Meta escribe en esa tabla por sincronización y webhook. Es el módulo mejor resuelto del CRM |
| `transition_deal` y su bloqueo optimista | Da atomicidad y auditoría. Funciona |
| El paso `wait` con reanudación por cron | Ya implementa el diferido de automatizaciones |
| Las ventanas de entrega de `frequency_rules` | Ya difieren por franja horaria |
| El middleware | Se amplía su lista de rutas y nada más |
| El motor de flujos y su cron de caducidad | Fuera de alcance |

Y una regla general: **si algo funciona y no está en la lista de tareas, no lo toques.** Esta sesión no es para mejorar el estilo del código.

---

## 3. Tres cosas que hay que verificar antes de ejecutarlas

Vienen de una auditoría externa que es buena y está bien fundamentada. Pero en estas tres, la solución que propone es peligrosa o incompleta.

**3.1 · El índice único sobre `messages.message_id`.** La auditoría propone un `UNIQUE` parcial para la idempotencia del inbox. **Lee antes `migrations/009_message_actions.sql:8` y `036_conversation_contact_dedup.sql:69`**: las dos afirman de forma explícita que los identificadores de Meta **no son únicos** y que esa no-unicidad es intencionada. Un índice demasiado amplio hace que el webhook rechace mensajes legítimos y te quedas sin inbox, que es lo que más uso. Si tras leer esos comentarios crees que existe una clave segura, propónmela con su justificación **antes** de escribir la migración.

**3.2 · No apliques las migraciones pendientes a ciegas.** La auditoría dice que faltan cinco. Puede ser, pero el repositorio y el remoto ya discreparon antes de forma sorprendente: la migración 052 tiene un error de sintaxis en el archivo y sin embargo sus políticas **sí existen** en la base, reparadas a mano en su día. **Primero inventario contra la base real, después aplicar solo lo que falte.** Una migración que se da por pendiente y ya está aplicada puede fallar o, peor, deshacer algo.

**3.3 · El arreglo del rastreo de clics va en el servidor.** Confirmado: `api/track/route.ts:37` solo exporta `GET` y `god.ts:182` usa `sendBeacon`, que siempre es POST — cada clic devuelve 405. **Añade `POST` a la ruta reutilizando el manejador del `GET`. No cambies `god.ts`**: ese script ya está compilado dentro de las landings publicadas y en caché de los navegadores; cambiar el cliente deja fuera a todo el tráfico que ya lo tiene cargado.

---

## 4. Reglas de seguridad de la sesión

Esto es lo que impide que algo se rompa.

**Una rama por bloque.** `fix/bloque-1-integridad`, `fix/bloque-2-flujos`, y así. Commit al terminar cada paso, no al terminar el bloque. Si algo sale mal, se revierte un paso, no una sesión entera.

**Puerta de verificación al cerrar cada bloque.** No se pasa al siguiente sin las cuatro cosas en verde: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Si algo se pone rojo, se arregla antes de avanzar. Nunca se silencia un test para que pase.

**Ningún DDL sin respaldo restaurable.** El bloque 0 es bloqueante de verdad: si no hay una restauración de prueba que haya funcionado, no se aplica una sola migración.

**Todo SQL pasa por un parser antes de tocar la base**, y se prueba contra una base desechable. Ya hubo una migración que abortó a mitad por un error de sintaxis y dejó el esquema inconsistente durante semanas.

**Si algo bloquea, paras y preguntas.** No improvises una vía paralela, no crees una tabla para esquivar el problema, no dejes un `TODO` y sigas.

**Si una decisión de este documento te parece equivocada al ver el código, dímelo antes de ejecutarla.** Está escrito leyendo el repositorio, pero tú lo tienes delante.

---

## 5. Bloque 0 — Base (no se toca código)

| # | Paso | Verificación |
|---|---|---|
| 0.1 | Respaldos: PITR en Supabase más un volcado diario al VPS | **Una restauración de prueba real.** Un respaldo que nunca se restauró no es un respaldo |
| 0.2 | Inventario del remoto: qué migraciones están aplicadas **según la base**, no según el repositorio | Lista de las que faltan de verdad (ver 3.2) |
| 0.3 | Aplicar solo las que falten, en orden, verificando columnas y políticas tras cada una | Comprobación una a una |
| 0.4 | Variables de entorno completas contra `.env.local.example` | Campo por campo |
| 0.5 | Línea base verde: typecheck, lint, test, build, Docker sano | Todo verde antes de tocar una línea |

---

## 6. Bloque 1 — Pérdida de datos y de dinero

| # | Paso | Dónde |
|---|---|---|
| 1.1 | Escapar HTML en los valores que interpola `contactText` antes de inyectarlos en el cuerpo del correo | `lib/automations/engine.ts`, el `text.replace` final y su uso en `send_email` |
| 1.2 | Tope de destinatarios en campañas de correo, con el mismo criterio que el de WhatsApp | `api/email/campaign/send/route.ts` |
| 1.3 | Verificar el número de filas afectadas al pasar de borrador a enviando; si no era borrador, 409 | mismo archivo |
| 1.4 | `saveCustomFields` como diff más upsert, sin borrar y reinsertar | `components/contacts/contact-detail-view.tsx` |
| 1.5 | `WITH CHECK` en la política `deals_update`, para que `transition_deal` sea la única vía de cambiar etapa, estado, fechas de cierre, versión y prioridad | `migrations/017_account_sharing.sql:444` + migración nueva |
| 1.6 | Revocar la ejecución a `anon` y `authenticated` de las funciones `SECURITY DEFINER` que no la necesitan, y fijarles `search_path`, replicando el patrón de la migración 037 | migraciones 045, 052, 053 |
| 1.7 | Idempotencia del inbox — **solo después de resolver el punto 3.1** | webhook de WhatsApp + migración |
| 1.8 | Espejo de estado con escalera de transición y ámbito de cuenta; nunca `maybeSingle()` para resolver la cuenta | webhook de WhatsApp |

El 1.1 no es teórico: los contactos entran por CSV, así que el nombre es texto que no controlas y viaja a todos los destinatarios de la campaña.

---

## 7. Bloque 2 — Flujos que hoy producen cero

No fallan con un error. Simplemente no pasa nada. Por eso llevan meses rotos sin que se note.

| # | Paso | Dónde |
|---|---|---|
| 2.1 | Llamada perdida: normalizar `direction` **en el punto de entrada del webhook**, de forma que el resto del archivo hable un solo vocabulario. Y corregir los tests, que hoy usan valores que Telnyx nunca manda y enmascaran el fallo | `api/telnyx/webhook/route.ts` y su test |
| 2.2 | Rastreo de clics: exponer `POST` en `/api/track` reutilizando el manejador del `GET` (ver 3.3) | `api/track/route.ts` |
| 2.3 | Recuperación de contraseña: crear `/auth/callback` con el intercambio de código por sesión, la página `/reset-password`, y apuntar ahí el `redirectTo` | `app/(auth)/forgot-password/page.tsx` + rutas nuevas |
| 2.4 | Embudo de correo: que el webhook de Resend actualice también `email_campaign_recipients` por su identificador de mensaje, con escalera de solo avance | `api/email/webhook/route.ts` + migración |
| 2.5 | Antispam: excluir `sender_type = 'agent'` del conteo diario; que solo cuenten los envíos automáticos | `lib/automations/queue.ts` |
| 2.6 | Config de Telnyx re-guardable: si no llega clave nueva y ya existe una cifrada, conservarla | `api/telnyx/config/route.ts` |

En 2.1, parchear comparación por comparación es exactamente cómo vuelve el bug. Una normalización, un vocabulario.

El 2.5 es el más traicionero: hoy, cuanto más atiendes tú a un cliente por WhatsApp, más silencias tus propias automatizaciones sobre él.

---

## 8. Bloque 3 — Paridad con GoHighLevel

Sin el 3.1 no hay reemplazo posible: es la pieza con la que GHL hace los seguimientos programados.

| # | Paso | Dónde |
|---|---|---|
| 3.1 | Disparador por reloj: que el cron de automatizaciones seleccione también las de tipo `time_based` cuya hora llegó y las despache por la vía que ya existe. Añadir el campo de horario en el constructor | `api/automations/cron/route.ts`, `lib/automations/engine.ts`, `automation-builder.tsx` + migración de configuración del disparador |
| 3.2 | Disparador `conversation_assigned`: enganchar el despacho donde hoy se asigna la conversación | engine + ruta de asignación |
| 3.3 | Campañas programadas: drenador sobre `scheduled_at` y selector de fecha y hora en el último paso del asistente | migración + `campaign/send/route.ts` + paso 4 |
| 3.4 | Disparador manual de flujos: endpoint para iniciar una ejecución, más su botón | `api/flows/[id]/runs/route.ts` + interfaz |
| 3.5 | Vista de cola: panel de solo lectura con lo encolado en `message_queue` y en `automation_pending_executions`, con su hora de salida | ruta + componente en Ajustes |

**Antes de escribir nada de este bloque, comprueba lo que ya existe** —el paso `wait` con reanudación, las ventanas de entrega, la condición de franja horaria y la caducidad de flujos— y reutilízalo. Lo único que falta de verdad es disparar por reloj sin evento previo.

Si al cerrar el bloque algún disparador sigue sin despacho, **quítalo del constructor**. Una opción seleccionable que nunca corre es peor que no tenerla.

---

## 9. Bloque 4 — Robustez en ejecución

| # | Paso |
|---|---|
| 4.1 | Envío de campañas en cola durable con drenador; como mínimo, duración máxima ampliada más un trabajo que recupere las que quedan colgadas en *enviando* |
| 4.2 | Recuperador de filas reclamadas: marca temporal más cron que recicle reclamos viejos, con el patrón de caducidad que ya usan los flujos |
| 4.3 | Topes anti-bucle: máximo de pasos por ejecución y de ejecuciones pendientes por contacto |
| 4.4 | Límite de frecuencia en la ruta del motor de automatizaciones |
| 4.5 | Deduplicar el webhook de Resend por identificador de evento |
| 4.6 | Telnyx: no registrar la pata interna como llamada entrante; impedir que una reentrega retroceda el estado; resolver la carrera de llamada perdida con actualización condicional; deduplicar SMS |
| 4.7 | Validación de entrada: identificadores canónicos y clave de idempotencia en la compra de números; rangos de fecha validados en informes con 400 y no 500; no devolver el cuerpo HTML en el listado de plantillas |
| 4.8 | Paginación por cursor en destinatarios, historial de mensajes, lista de conversaciones, registros, importación y selectores de contacto |
| 4.9 | Índices de búsqueda con `pg_trgm` sobre nombre, teléfono y correo; comodín solo al final; retención de `tracking_events` por encima de 90 días |
| 4.10 | No memoizar el resultado nulo en la resolución de la cuenta de la landing |
| 4.11 | Normalizar la moneda en el informe de adquisición, o excluir lo que no esté en la moneda de la cuenta |
| 4.12 | Consolidar los cargadores huérfanos: una sola implementación de "ingreso ganado" |

El 4.11 no es cosmético: hoy la cifra con la que decidirías presupuesto de anuncios mezcla monedas.

---

## 10. Bloque 5 — Uso diario

| # | Paso |
|---|---|
| 5.1 | Desplazamiento automático solo si ya estabas al final del hilo |
| 5.2 | Quitar el parpadeo de los mensajes temporales: sustituir por coincidencia, no limpiar todos |
| 5.3 | Indicador de escritura |
| 5.4 | Búsqueda por cuerpo del mensaje, en servidor y con retardo |
| 5.5 | Aviso de conexión de WhatsApp que se revalide al volver a la pestaña |
| 5.6 | Bloqueo real del compositor: liberar el candado después del envío, con clave de idempotencia |
| 5.7 | Sustituir `window.prompt` por una hoja lateral con la lista de evidencia que `evaluateTransition` ya calcula y hoy nadie muestra |
| 5.8 | Telnyx: estado de error de configuración real, permiso de micrófono denegado, botón de reconectar |
| 5.9 | Errores de autenticación traducidos y anunciados; política de contraseña unificada con validación de servidor; autocompletado en el acceso |
| 5.10 | Indicador de carga al recargar informes; no abrir la hoja de trato antes de tener sus datos |
| 5.11 | Accesibilidad: etiquetas en los indicadores de estado, objetivos táctiles suficientes con devolución de foco, textos alternativos |
| 5.12 | Voz: referencia de audio por instancia y no por identificador global, impedir dos softphones a la vez, reproducción en línea, manejo de error con reintento |
| 5.13 | Registrar las llamadas fallidas en el historial |
| 5.14 | Uniformar i18n donde quedó texto fijo: informes, alta, recuperación y pasos del asistente |

---

## 11. Bloque 6 — Operación

| # | Paso |
|---|---|
| 6.1 | Fijar la versión de Node con un `.nvmrc` y alinear CI, Docker y desarrollo |
| 6.2 | Completar la lista de rutas protegidas del middleware con las que hoy dependen de una redirección de cliente |
| 6.3 | Decidir si la política de seguridad de contenido pasa a modo estricto, o documentar por qué sigue en observación |
| 6.4 | Manual de operación: despliegue, respaldo y restauración, monitoreo |
| 6.5 | Revisar actualizaciones de seguridad pendientes |

---

## 12. Bloque 7 — Migración y corte

| # | Paso | Verificación |
|---|---|---|
| 7.1 | Exportar contactos de GHL con sus campos personalizados | Conteo en origen |
| 7.2 | Importar con el importador CSV que ya existe, con deduplicación por teléfono | Los conteos coinciden |
| 7.3 | Recrear pipelines y tratos activos | Etapas y valores correctos |
| 7.4 | Copiar las plantillas que se usan de verdad | Vista previa correcta |
| 7.5 | Configuración de producción: Telnyx, Resend con dominio verificado, WhatsApp Business | Una llamada, un correo y un envío reales |
| 7.6 | Solape: GHL activo mientras wacrm ya opera. Primera semana inbox, contactos y CRM; segunda, llamadas, campañas y automatizaciones | Dos semanas mínimo |
| 7.7 | Corte en el siguiente ciclo de facturación | Lista de comprobación completa |

---

## 13. Lista de comprobación antes de cancelar GHL

- [ ] Respaldo restaurado con éxito en una prueba real
- [ ] Migraciones verificadas contra la base, no contra el repositorio
- [ ] Una llamada perdida dispara su automatización de seguimiento
- [ ] Un clic desde la landing queda registrado y se ve en informes
- [ ] La recuperación de contraseña funciona de principio a fin
- [ ] El embudo de una campaña muestra entregados, abiertos y clics
- [ ] Una automatización programada corre a su hora, sin evento previo
- [ ] Una campaña programada se envía sola
- [ ] Responder como agente no silencia las automatizaciones
- [ ] El inbox no duplica mensajes y el contador de no leídos es correcto
- [ ] Arrastrar un trato respeta las guardas y los campos personalizados no se pierden
- [ ] La configuración de Telnyx se edita sin volver a pegar la clave
- [ ] Ningún disparador seleccionable carece de despacho
- [ ] Typecheck, lint, tests y build en verde

---

## 14. Lo que quiero al cerrar cada bloque

Cuatro cosas, cortas:

1. Qué quedó funcionando y **cómo lo comprobaste** — no "debería funcionar".
2. Qué no llegaste a hacer.
3. Qué decisiones tomaste que se desvían de este documento, y por qué.
4. Qué depende de mí: claves, consola, dominio.

Nada de credenciales de la base de datos me las pides: los respaldos y los accesos los hago yo.

# Prompt maestro — wacrm reemplaza a GoHighLevel

Objetivo: que wacrm opere la empresa completa, sin pérdida de datos, sin gasto inesperado y con paridad de flujos, para cortar GHL este mes.

Contexto confirmado: VPS propio, poca data que migrar desde GHL, se usan todos los módulos.

---

## Restricciones duras

- **Next.js 16.2.12, React 19.2.4, Tailwind 4, TypeScript 6.** No es la versión que conoces. Antes de tocar rutas, middleware, `params`, caché o Server Actions, lee `node_modules/next/dist/docs/`. Ya me costó el middleware una vez.
- **pnpm siempre.** Nunca `npm`, nunca `npx`. Si necesitas un binario suelto: `pnpm dlx`.
- **No renombres tablas ni archivos existentes.** Divergir del upstream hace conflictivo cada merge futuro.
- **No crees tablas nuevas.** Si crees que necesitas una, para y explícame por qué.
- **No toques `message_templates` ni nada bajo `lib/whatsapp/` ni `api/whatsapp/`** salvo donde este documento lo pide de forma explícita. Meta escribe en esa tabla.
- **Diffs quirúrgicos.** No reescribas archivos completos para cambiar diez líneas.
- **`git commit` al terminar cada bloque**, con mensaje descriptivo. Si la sesión se corta, lo anterior queda guardado.
- **Si wacrm ya lo resuelve, se usa lo de wacrm.** No se añade un componente, endpoint ni tabla cuando basta una columna, una prop o un parámetro.

---

## Tres cosas que hay que verificar antes de ejecutarlas

Vienen de una auditoría externa. Dos de sus hallazgos son correctos pero su solución propuesta es peligrosa, y hay que comprobarlos antes de tocar nada.

**1. El índice único sobre `messages.message_id`.** La auditoría propone `UNIQUE (message_id)` parcial para la idempotencia. **Lee antes `migrations/009_message_actions.sql:8` y `036_conversation_contact_dedup.sql:69`**: las dos dicen explícitamente que los identificadores de Meta **no son únicos** y que la no-unicidad es intencionada. Si añades un índice único demasiado amplio, el webhook empieza a rechazar mensajes legítimos y rompes el inbox, que es lo que más usas. Si tras leer esos comentarios sigues creyendo que hay una clave segura, propónmela con su justificación antes de escribirla.

**2. La normalización de `direction` en Telnyx.** El bug es real y está confirmado: en el mismo archivo, `telnyx/webhook/route.ts:254` compara contra `'incoming'` y `:441` contra `'inbound'`. Telnyx envía `'incoming'`, así que la comprobación de llamada perdida siempre devuelve falso. **Normaliza una sola vez, en el punto de entrada del webhook**, y que el resto del archivo hable un único vocabulario. No parchees comparación por comparación: así es como el bug vuelve. Y corrige los tests, que hoy usan valores que Telnyx nunca manda y por eso enmascaran el fallo.

**3. El arreglo del rastreo de clics.** Confirmado: `api/track/route.ts:37` solo exporta `GET`, y `god.ts:182` usa `sendBeacon`, que siempre es POST. Cada clic devuelve 405. **Arréglalo añadiendo `POST` a la ruta, no cambiando `god.ts`**: el script ya está compilado dentro de las landings publicadas y en caché de los navegadores. Cambiar el cliente deja fuera a todo el tráfico que ya lo tiene cargado.

---

## Bloque 0 — Base (no se toca código)

| # | Paso | Verificación |
|---|---|---|
| 0.1 | Respaldos: activar PITR en Supabase y un `pg_dump` diario al VPS | **Una restauración de prueba real.** Un respaldo que nunca se restauró no es un respaldo |
| 0.2 | Inventario del remoto: qué migraciones están aplicadas de verdad, no cuáles hay en el repo | Lista de las pendientes, confirmada contra la base |
| 0.3 | Aplicar las pendientes en orden estricto | Comprobar columnas y políticas una a una tras aplicar |
| 0.4 | Variables de entorno completas contra `.env.local.example` | Lista campo por campo |
| 0.5 | Línea base verde: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, Docker sano | Todo en verde antes de tocar una línea |

**0.1 va antes que 0.3.** Aplicar DDL sobre una base sin respaldo restaurable es el único error de este plan que no tiene vuelta atrás.

En 0.2, no te fíes del repo: la auditoría detectó desfase entre los archivos y el remoto. Consulta la base.

---

## Bloque 1 — Pérdida de datos y de dinero

| # | Paso | Dónde | Verificación |
|---|---|---|---|
| 1.1 | Escapar HTML en los valores que interpola `contactText` antes de inyectarlos en el cuerpo del correo | `lib/automations/engine.ts` — el `text.replace` final, y el uso en `send_email` | Un contacto llamado `"><img onerror=alert(1)>` sale como texto plano |
| 1.2 | Tope de destinatarios en campañas de correo, con el mismo criterio que `MAX_RECIPIENTS` de WhatsApp | `api/email/campaign/send/route.ts` | Campaña por encima del tope → rechazada |
| 1.3 | Verificar `rowCount` al pasar la campaña de borrador a enviando; si no era borrador, 409 | mismo archivo | Un reintento no reenvía a nadie |
| 1.4 | `saveCustomFields` como diff + upsert, no borrar y reinsertar | `components/contacts/contact-detail-view.tsx` | Un fallo a mitad no deja al contacto sin campos |
| 1.5 | `WITH CHECK` en la política `deals_update` para que `transition_deal` sea la única vía de cambiar etapa, estado, fechas de cierre, versión y prioridad | `migrations/017_account_sharing.sql:444` + migración nueva | Un update directo desde el cliente es rechazado por la base |
| 1.6 | Revocar la ejecución a `anon` y `authenticated` de las funciones `SECURITY DEFINER` que no la necesitan, y fijarles `search_path` | migraciones 045, 052, 053 — replicar el patrón de la 037 | Sin avisos en el panel de seguridad |
| 1.7 | Idempotencia de `messages` — **solo tras el punto 1 de la sección de verificación** | webhook de WhatsApp + migración | Una reentrega de Meta no duplica fila ni contador |
| 1.8 | Espejo de estado con escalera de transición y ámbito de cuenta; nunca `maybeSingle()` para resolver a qué cuenta pertenece | webhook de WhatsApp | Un estado tardío no retrocede la escalera |

El 1.1 importa más de lo que parece: los contactos entran por CSV, así que el nombre es texto que tú no controlas y viaja a todos los destinatarios de la campaña.

---

## Bloque 2 — Flujos que hoy producen cero

Estos no fallan con un error: simplemente no pasa nada. Por eso llevan meses rotos sin que se note.

| # | Paso | Dónde |
|---|---|---|
| 2.1 | Llamada perdida: normalizar `direction` en el punto de entrada y corregir los tests con los valores reales de Telnyx | `api/telnyx/webhook/route.ts` + su test |
| 2.2 | Rastreo de clics: exponer `POST` en `/api/track` reutilizando el manejador del `GET` | `api/track/route.ts` |
| 2.3 | Recuperación de contraseña: crear `/auth/callback` con el intercambio de código por sesión y la página `/reset-password`; apuntar ahí el `redirectTo` | `app/(auth)/forgot-password/page.tsx` + rutas nuevas |
| 2.4 | Embudo de correo: que el webhook de Resend actualice también `email_campaign_recipients` por `resend_message_id`, con escalera de solo avance | `api/email/webhook/route.ts` + migración |
| 2.5 | Antispam: excluir `sender_type = 'agent'` del conteo diario; que solo cuenten los envíos automáticos | `lib/automations/queue.ts` |
| 2.6 | Config de Telnyx re-guardable: si no llega clave nueva y ya existe una cifrada, conservarla | `api/telnyx/config/route.ts` |

El 2.5 es el más traicionero: hoy, cuanto más atiendes tú a un cliente por WhatsApp, más silencias tus propias automatizaciones sobre él.

---

## Bloque 3 — Paridad con GoHighLevel

Esto es lo que falta para poder cortar. Sin el 3.1 no hay reemplazo.

| # | Paso | Dónde |
|---|---|---|
| 3.1 | **Disparador por reloj (`time_based`)**: que el cron de automatizaciones seleccione también las de este tipo cuya hora programada llegó, y las despache. Añadir el campo de horario en el constructor | `api/automations/cron/route.ts`, `lib/automations/engine.ts`, `automation-builder.tsx` + migración de `trigger_config` |
| 3.2 | Disparador `conversation_assigned`: enganchar el despacho en el punto donde hoy se asigna la conversación | engine + ruta de asignación |
| 3.3 | Campañas programadas: drenador sobre `scheduled_at`, más el selector de fecha y hora en el último paso del asistente | migración + `campaign/send/route.ts` + paso 4 del asistente |
| 3.4 | Disparador `manual` de flujos: endpoint para iniciar una ejecución a mano, más su botón | `api/flows/[id]/runs/route.ts` + interfaz |
| 3.5 | Vista de cola: panel de solo lectura con lo que hay en `message_queue` y en `automation_pending_executions`, con su hora de salida | ruta + componente en Ajustes |

**Lo que ya funciona y no hay que reconstruir** —compruébalo antes de escribir nada: el paso `wait` con reanudación por cron, las ventanas de entrega por `frequency_rules`, la condición de franja horaria, y el cron de flujos que caduca ejecuciones. Lo único que falta es disparar por reloj sin evento previo.

Si al terminar el bloque algún disparador sigue sin despacho, **quítalo del constructor**. Una opción que se puede elegir y nunca corre es peor que no tenerla.

---

## Bloque 4 — Robustez en ejecución

| # | Paso |
|---|---|
| 4.1 | Envío de campañas en cola durable con drenador, o como mínimo `maxDuration` más un trabajo que recupere las que quedan colgadas en *enviando* |
| 4.2 | Recuperador de filas reclamadas: columna de marca temporal más cron que recicle reclamos viejos, con el patrón de caducidad que ya usan los flujos |
| 4.3 | Topes anti-bucle: máximo de pasos por ejecución y de ejecuciones pendientes por contacto |
| 4.4 | Límite de frecuencia en la ruta del motor de automatizaciones |
| 4.5 | Deduplicar el webhook de Resend por identificador de evento |
| 4.6 | Telnyx: no registrar la pata interna como llamada entrante; impedir que una reentrega retroceda el estado; carrera de llamada perdida resuelta con actualización condicional; deduplicar SMS |
| 4.7 | Validación de entrada: identificadores canónicos en la compra de números, rangos de fecha validados en informes (400, no 500), y no devolver el cuerpo HTML en el listado de plantillas |
| 4.8 | Paginación por cursor en destinatarios, historial de mensajes, lista de conversaciones, registros, importación y selectores de contacto |
| 4.9 | Índices de búsqueda con `pg_trgm` sobre nombre, teléfono y correo; comodín solo al final; retención de `tracking_events` por encima de 90 días |
| 4.10 | No memoizar el resultado nulo en la resolución de la cuenta de la landing |
| 4.11 | Normalizar la moneda en el informe de adquisición, o excluir lo que no esté en la moneda de la cuenta |
| 4.12 | Consolidar los cargadores huérfanos: una sola implementación de "ingreso ganado" |

El 4.11 no es cosmético: hoy la cifra que usarías para decidir presupuesto de anuncios mezcla monedas.

---

## Bloque 5 — Uso diario

| # | Paso |
|---|---|
| 5.1 | Desplazamiento automático solo si ya estabas al final del hilo |
| 5.2 | Quitar el parpadeo de los mensajes temporales: sustituir por coincidencia, no limpiar todos |
| 5.3 | Indicador de escritura |
| 5.4 | Búsqueda por cuerpo del mensaje, en servidor y con retardo |
| 5.5 | Aviso de conexión de WhatsApp que se revalide al volver a la pestaña |
| 5.6 | Bloqueo real del compositor: liberar el candado después del envío, con clave de idempotencia |
| 5.7 | Sustituir `window.prompt` por una hoja lateral con la lista de evidencia de `evaluateTransition` |
| 5.8 | Telnyx: estado de error de configuración real, permiso de micrófono denegado, botón de reconectar |
| 5.9 | Errores de autenticación traducidos y anunciados; unificar la política de contraseña; autocompletado en el acceso |
| 5.10 | Indicador de carga al recargar informes; evitar abrir la hoja de trato antes de tener sus datos |
| 5.11 | Accesibilidad: etiquetas en los indicadores de estado, objetivos táctiles suficientes con devolución de foco, textos alternativos |
| 5.12 | Voz: referencia de audio por instancia y no por identificador global, impedir dos softphones a la vez, reproducción en línea, manejo de error con reintento |
| 5.13 | Registrar las llamadas fallidas en el historial |
| 5.14 | Uniformar i18n donde quedó texto fijo: informes, alta de cuenta, recuperación y pasos del asistente |

El 5.7 reactiva algo que ya existe: `evaluateTransition` calcula la lista de evidencia faltante y hoy nadie la muestra.

---

## Bloque 6 — Operación

| # | Paso |
|---|---|
| 6.1 | Fijar la versión de Node con un `.nvmrc` y alinear CI, Docker y desarrollo |
| 6.2 | Completar la lista de rutas protegidas en el middleware con las que hoy dependen de una redirección de cliente |
| 6.3 | Decidir si la política de seguridad de contenido pasa a modo estricto o se documenta por qué sigue en observación |
| 6.4 | Manual de operación: despliegue, respaldo y restauración, monitoreo |
| 6.5 | Revisar actualizaciones de seguridad pendientes |

---

## Bloque 7 — Migración y corte

| # | Paso | Verificación |
|---|---|---|
| 7.1 | Exportar contactos de GHL con sus campos personalizados | Conteo en origen |
| 7.2 | Importar con el importador CSV que ya existe, con deduplicación por teléfono | Los conteos coinciden |
| 7.3 | Recrear pipelines y tratos activos | Etapas y valores correctos |
| 7.4 | Copiar las plantillas que se usan de verdad | Vista previa correcta |
| 7.5 | Configuración de producción: Telnyx, Resend con dominio verificado, WhatsApp Business | Una llamada, un correo y un envío de prueba reales |
| 7.6 | Solape: GHL activo mientras wacrm ya opera | Dos semanas mínimo |
| 7.7 | Corte en el siguiente ciclo de facturación | Lista de comprobación completa |

---

## Lista de comprobación antes de cancelar GHL

- [ ] Respaldo restaurado con éxito en una prueba real
- [ ] Todas las migraciones aplicadas y verificadas contra la base
- [ ] Una llamada perdida dispara su automatización de seguimiento
- [ ] Un clic desde la landing queda registrado y se ve en informes
- [ ] La recuperación de contraseña funciona de principio a fin
- [ ] El embudo de una campaña de correo muestra entregados, abiertos y clics
- [ ] Una automatización programada corre a su hora, sin evento previo
- [ ] Una campaña programada se envía sola
- [ ] Responder como agente no silencia las automatizaciones
- [ ] El inbox no duplica mensajes y el contador de no leídos es correcto
- [ ] Arrastrar un trato respeta las guardas y los campos personalizados no se pierden
- [ ] La configuración de Telnyx se puede editar sin volver a pegar la clave
- [ ] Ningún disparador seleccionable carece de despacho
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build` en verde

---

## Cómo quiero que trabajes

- **Ejecuta en orden: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7.** Está ordenado para que, si la sesión se corta en cualquier punto, lo entregado siga siendo coherente y la empresa pueda operar.
- **Commit al cerrar cada bloque.**
- **Nunca inventes.** Si no sabes cómo se comporta una API de esta versión, léela en `node_modules` o dime que no lo puedes verificar. Prefiero un "no lo sé" a una afirmación falsa.
- **Cita archivo y línea** en cada hallazgo.
- **Verifica el SQL con un parser antes de aplicarlo**, y contra una base desechable. Ya hubo una migración que abortó a mitad por un error de sintaxis.
- **Si algo te bloquea, para y pregunta.** No improvises una vía paralela ni crees una tabla para esquivar el problema.
- **Si una decisión de este documento te parece equivocada al ver el código, dímelo antes de ejecutarla.** Está escrito leyendo el repositorio, pero tú lo tienes delante.

Al terminar cada bloque, dime: qué quedó funcionando y cómo lo comprobaste, qué no, y qué depende de mí.

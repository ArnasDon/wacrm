# Builder de automatizaciones: condiciones por hora

Criterio `manual:` de BASE.2: queda registrado si el builder permite condiciones por hora.

## Respuesta

**Sí.** El builder tiene una condición con sujeto `time_of_day` (hora del día).

## Evidencia (revisión del código del fork)

- UI: `src/components/automations/automation-builder.tsx` (selector de sujeto con la opción
  `time_of_day` y un selector de zona horaria).
- Evaluación: `src/lib/automations/engine.ts` (`case 'time_of_day'`) llama a
  `isWithinTimeWindow` de `src/lib/automations/time-of-day.ts`.
- Configuración: `operand` con la franja `"HH:MM-HH:MM"`; admite franjas que cruzan la
  medianoche (p. ej. `18:00-09:00`). `timezone` es una zona IANA (p. ej. `America/Bogota`);
  si falta, la condición usa UTC (`LEGACY_CONDITION_TIMEZONE`).
- Validación: `src/lib/automations/validate.ts` rechaza zonas inválidas.
- Plantilla de ejemplo: `src/lib/automations/templates.ts`.
- Pruebas: `time-of-day.test.ts`, `engine.test.ts`, `validate.test.ts`.

Ejemplo de condición:

```json
{ "subject": "time_of_day", "operand": "18:00-09:00", "timezone": "America/Bogota" }
```

## Impacto en el PRD

La política "respuesta fuera de horario" puede configurarse con automatizaciones nativas
(CFG.2), sin módulo propio.

## Pendiente de Juan

Confirmar visualmente en la UI (`/automations`, bloque de condición "Hora del día") que el
comportamiento coincide con lo anterior.

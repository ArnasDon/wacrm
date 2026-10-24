# Módulo `visibilidad` (VIS.1)

Cada asesor ve solo las conversaciones asignadas a él en la bandeja, el contador de no leídos, la búsqueda y la URL directa de un chat.

> Con la Parte 2 (interfaz) la bandeja, el contador, la búsqueda y el enlace directo ya usan `visibleConversations`. Se aplica al reiniciar la app con el módulo encendido.

## Cómo se enciende

En `config/modules.yaml`:

```yaml
modulos:
  visibilidad:
    activo: true
    config: {}
```

La config va vacía: los roles que ven todo los fija la regla R26, no la empresa. Cualquier llave extra falla al arrancar (R18). Apagado o sin declarar, la interfaz se comporta como wacrm (R16).

## Qué ve cada rol

| Rol | Ve |
|---|---|
| owner, admin | Todas, con filtro por asesor y por "sin asignar" |
| agent, viewer | Solo las asignadas a su usuario (las sin asignar no) |

## Qué no cubre

- Es solo interfaz (R27): no hay reglas RLS y la API pública `v1` no filtra.
- Embudo y notificaciones: ver VIS.2 (Parte 2) abajo.

## VIS.2 (Parte 1): dashboard y feed

Con el módulo encendido, el asesor (agent, viewer) ve en el dashboard:

- **Cola de respuesta, atención y mensajes fallidos:** se recalculan en el cliente solo con sus conversaciones (`src/lib/dashboard/atencion-visible.ts`, mismas reglas que la RPC `dashboard_overview`). "Sin asignar" es 0 (R29).
- **Feed de actividad:** los mensajes entrantes se acotan en la consulta (antes del `limit`) y se filtran con la visibilidad.

Lo que **no** se oculta: los agregados sin conversaciones identificables (KPIs, volumen, equipo, embudo, campañas, configuración) siguen siendo de toda la cuenta, igual que wacrm; recalcularlos exigiría tocar la RPC (servidor), contra R27. La RPC sigue devolviendo la atención de toda la cuenta al cliente (solo interfaz, sin RLS).

Owner y admin ven todo; apagado, todo es idéntico a wacrm (R16).

## VIS.2 (Parte 2): embudo, notificaciones y ficha

- **Embudo:** los negocios se ven como en wacrm; la conversación vinculada del formulario del negocio se acota al asesor y solo aparece el enlace "Vincular a una conversación" si es visible.
- **Notificaciones:** una notificación con conversación se muestra (página y contador) solo si esa conversación es visible hoy; las sin conversación se muestran siempre. "Marcar todas como leídas" sigue marcando también las ocultas.
- **Avisos del navegador:** sin conversación visible no hay aviso.
- **Ficha de contacto:** no consulta conversaciones; la prueba de cobertura falla si alguien se las agrega sin visibilidad.

## Prueba de cobertura

`src/modulos/visibilidad/cobertura.test.ts` recorre el código de interfaz (`src/app/(dashboard)`, `src/components`, `src/hooks`, `src/lib/{dashboard,notifications,inbox,contacts}`) y falla, con la ruta, si un archivo consulta `conversations` sin importar de `@/modulos/visibilidad/` y llamarla al menos tantas veces como consultas hace.

Límite conocido: es una prueba estática por texto. No prueba que cada consulta concreta use el resultado de la visibilidad, solo que el archivo la importa y la llama. La garantía fuerte sigue siendo R27 (servidor) y las pruebas de cada función.

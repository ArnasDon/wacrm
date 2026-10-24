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
- Ficha, embudo, dashboard, feed y notificaciones quedan para VIS.2.

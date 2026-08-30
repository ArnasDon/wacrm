# Política de retención de datos

La limpieza diaria elimina únicamente datos técnicos vencidos. No elimina
contactos, conversaciones, mensajes, negocios, difusiones, cotizaciones,
productos, configuraciones ni auditorías críticas (`ai_action_log`).

| Datos                                      |   Retención |
| ------------------------------------------ | ----------: |
| Notificaciones leídas                      |     30 días |
| Notificaciones no leídas                   |     90 días |
| Webhooks entregados                        |     30 días |
| Webhooks fallidos                          |     90 días |
| Ejecuciones pendientes terminadas/fallidas |  30/90 días |
| Logs de automatización correctos/fallidos  | 90/180 días |
| Flujos terminados/fallidos                 | 90/180 días |
| Detalle de uso de IA                       |     90 días |
| Invitaciones aceptadas/vencidas            |     30 días |
| Rate limits vencidos                       |      2 días |
| Archivos huérfanos de chat                 |     15 días |
| Bitácora de limpiezas                      |    180 días |

Antes de borrar el detalle de IA, los totales se acumulan en
`ai_usage_monthly`. Los archivos de `chat-media` solo se eliminan cuando son
antiguos y ningún mensaje conserva su URL. `flow-media` queda excluido.

## Operación

La migración `080_data_retention.sql` instala `run_data_retention`, que por
defecto funciona en simulación y limita cada categoría a 1,000 filas.

El endpoint protegido es:

```text
GET /api/maintenance/retention/cron
x-cron-secret: <RETENTION_CRON_SECRET>
```

Sin `?execute=true` solo simula. El job diario debe llamar:

```text
/api/maintenance/retention/cron?execute=true
```

`RETENTION_CRON_SECRET` es preferido; durante la transición se acepta
`WEBHOOK_CRON_SECRET` como respaldo. La primera ejecución debe hacerse sin
`execute=true`, revisar los conteos y luego activar el job diario.

## Job programado

`092_schedule_data_retention_cron.sql` registra el job pg_cron
`data-retention-sweep` (diario 09:20 UTC, ~03:20 en América/Guatemala) que
llama al endpoint con `?execute=true`. Se aplica en el SQL editor de
Supabase reemplazando `:'base_url'` y `:'retention_secret'` por literales —
lo más simple es usar el valor de `WEBHOOK_CRON_SECRET` para no tener que
tocar el env de EasyPanel. Por lotes de 1,000 filas/tabla, así que un
backlog inicial se drena en varios días. Ver `docs/OPS_SETUP.md` §2c.

# Módulo asignacion

Asigna un asesor a cada conversación sin asesor cuando entra un mensaje (contrato I3). Código en
`src/modulos/asignacion/`; el motor es la función SQL `mod_asignacion_asignar`
(`supabase/migrations/mod_asignacion_001_motor.sql`), atómica: bloquea la conversación, así dos mensajes
simultáneos no asignan dos veces. La llamada desde el flujo de entrada tiene tope de 5 s.

## Encenderlo

En `config/modules.yaml`:

```yaml
modulos:
  asignacion:
    activo: true
    config:
      reglas: [asesor-previo, etiqueta, palabra-clave, campo, reparto-equitativo] # valor por defecto
```

`reparto-equitativo`, si está, va al final y las reglas no se repiten.

## Reglas

1. `asesor-previo`: el último asesor que el módulo asignó a ese contacto, si sigue activo.
2. `reparto-equitativo`: rueda por `user_id` ascendente con un cursor por cuenta; alterna entre los activos
   aunque entren o salgan asesores.

Sin asesores activos la conversación queda sin asignar (la ven admin y owner, R29) y el siguiente mensaje
vuelve a evaluar. Una conversación que ya tiene asesor no se toca.

## Asesor y asesor activo

- Asesor: miembro de la cuenta con rol `agent` (owner y admin no entran al reparto).
- Activo: no tiene fila con `activo = false` en `mod_asignacion_asesores`. Sin fila = activo.

Desactivar o reactivar (por ahora solo por SQL, sin UI):

```sql
insert into mod_asignacion_asesores (user_id, account_id, activo)
values ('<user_id>', '<account_id>', false)
on conflict (user_id) do update set activo = excluded.activo, actualizado_en = now();
```

## Registro

Cada asignación queda en `mod_asignacion_registro` con regla, asesor y fecha:

```sql
select asignado_en, regla, asesor_id, contacto_id from mod_asignacion_registro order by asignado_en desc;
```

`conversations.assigned_agent_id` guarda el `user_id` del asesor (el de `auth.users`).

## Con la asignación encendida la IA deja de responder sola

Mientras el módulo está encendido, cada conversación nueva queda asignada a un asesor humano y la IA ya no responde sola en ella: la atiende el asesor asignado. Apaga el módulo si quieres que la IA vuelva a contestar de forma automática.

## Reglas de la empresa (ASG.2)

Además de `asesor-previo` y `reparto-equitativo`, `config.reglas` acepta `etiqueta`, `palabra-clave` y
`campo`. El orden por defecto es `[asesor-previo, etiqueta, palabra-clave, campo, reparto-equitativo]`.
Las reglas en sí son filas de `mod_asignacion_reglas` en la base de la empresa
(`supabase/migrations/mod_asignacion_002_reglas.sql`); la config solo dice qué tipos se evalúan y en qué orden.

Gana la primera en orden: primero el orden de tipos de `config.reglas`, luego `orden` ascendente dentro del
tipo (`orden` es único por cuenta). Una regla desactivada (`activa = false`), de otra cuenta, o cuyo asesor
está inactivo o ya no es `agent` se salta y se sigue con la siguiente.

- `etiqueta`: se cumple si el contacto tiene la etiqueta `tag_id`.
- `palabra-clave`: se cumple si el texto del mensaje que disparó la asignación contiene `valor` como palabra
  o frase completa, sin distinguir mayúsculas ni tildes ("CRÉDITO" casa con `credito`; "acreditado" no).
  `valor` solo admite letras, dígitos y espacios simples. Mensajes sin texto no la cumplen.
- `campo`: se cumple si el campo personalizado `custom_field_id` del contacto es igual a `valor`
  (sin mayúsculas, tildes ni espacios en los extremos). Solo campos personalizados, igualdad exacta.

Sin UI: se cargan por SQL (o por PostgREST como admin/owner; los asesores no pueden escribir).

```sql
-- etiqueta
insert into mod_asignacion_reglas (account_id, orden, tipo, tag_id, asesor_id)
values ('<account_id>', 10, 'etiqueta', (select id from tags where account_id = '<account_id>' and name = 'VIP'), '<user_id>');
-- palabra clave
insert into mod_asignacion_reglas (account_id, orden, tipo, valor, asesor_id)
values ('<account_id>', 20, 'palabra-clave', 'credito', '<user_id>');
-- campo
insert into mod_asignacion_reglas (account_id, orden, tipo, custom_field_id, valor, asesor_id)
values ('<account_id>', 30, 'campo', (select id from custom_fields where account_id = '<account_id>' and field_name = 'Ciudad'), 'Medellin', '<user_id>');

-- cambiar el orden o desactivar
update mod_asignacion_reglas set orden = 5 where id = '<regla_id>';
update mod_asignacion_reglas set activa = false where id = '<regla_id>';

-- consultar
select orden, tipo, valor, asesor_id, activa from mod_asignacion_reglas where account_id = '<account_id>' order by orden;
```

El registro guarda el tipo en `regla` y la fila en `regla_id` (queda en `null` si luego se borra la regla):

```sql
select asignado_en, regla, regla_id, asesor_id from mod_asignacion_registro order by asignado_en desc;
```

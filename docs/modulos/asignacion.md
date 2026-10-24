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
      reglas: [asesor-previo, reparto-equitativo] # es el valor por defecto
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

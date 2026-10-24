# Registro cerrado y alta de usuarios

Supabase Auth corre con `GOTRUE_DISABLE_SIGNUP=true`: `/auth/v1/signup`, OTP
y OAuth no crean usuarios. Si tu `.env` viene de una versión anterior con
`GOTRUE_DISABLE_SIGNUP=false`, cámbialo a `true` y reinicia `auth`.

## Invitados

`POST /api/invitations/<token>/signup` (service role, solo servidor) crea el
usuario y canjea la invitación en una sola transacción
(`redeem_invitation_for_new_user`, migración 060, con la fila bloqueada). Un
token da como máximo un alta; si el canje falla se borra el usuario creado.
El email se da por confirmado (`email_confirm: true`) porque el enlace de
invitación es de un solo uso; quien tenga el enlace puede elegir el email.

## Primer usuario (operador)

No hay invitación todavía, así que el operador lo crea con la API admin de Auth:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@empresa.com","password":"<contraseña>","email_confirm":true,"user_metadata":{"full_name":"Tu nombre"}}'
```

El trigger `handle_new_user` le crea su cuenta como `owner`. Desde ahí invita
al resto desde la app.

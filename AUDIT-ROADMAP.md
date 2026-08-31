# AUDIT-ROADMAP.md

## REGLA PRINCIPAL

Este archivo es la fuente única de verdad para el orden de auditoría,
implementación y cierre del engagement de seguridad de WACRM.

No se debe saltar un hallazgo.
No se debe inventar el siguiente hallazgo.
Al cerrar uno, se continúa con el siguiente pendiente de esta lista.

Cada entrada de este archivo solo se marca CERRADO END-TO-END cuando
el commit citado existe realmente en el historial de `main` y coincide
con el mensaje descrito — nunca por inferencia.

---

# FASE 1 — AUDITORÍA DE INFRAESTRUCTURA

## Módulos ya auditados y cerrados (orden cronológico, previos a la numeración AUTH-N)

- Automations A1/A2 — CERRADO
- WhatsApp A1/A2/A3/B1 — CERRADO
- Flows — CERRADO
- API Pública v1 (auditoría inicial) — CERRADO
- Broadcasts/Templates — CERRADO
- Contactos/Pipelines/Deals — CERRADO
- Cuentas/Miembros/Invitaciones — CERRADO
- Integraciones/Configuración Externa — CERRADO
  - IC-A1 (SSRF en `catalog_integrations.base_url` / Budun ERP, ALTA)
  - IC-M1 (RPC `record_webhook_failure` sin REVOKE/GRANT, MEDIA)
  - COMMIT: `f2bef8ef8b612421a11189f5f3faead6faa64665` — migración 054
- Storage/Archivos/Subidas — CERRADO
  - ST-N1 (RLS de Storage en `chat-media`/`flow-media` sin mínimo de rol, MEDIA)
  - ST-N2 (sin límite de tamaño de subida en endpoints de IA, MEDIA)
  - COMMIT: `02b67103c0e11b74f1567ab401fd69f80d6e1baf` — migración 055
- API Pública v1 (re-auditoría profunda) — CERRADO
  - API-N1 (sin idempotencia en `POST /api/v1/messages`/`broadcasts`, BAJA)
  - API-N2 (sin registro de auditoría por API key, MUY BAJA)
  - COMMIT: `4b07fe3c5eb710132131b3c8e43e78a382bfccc8` — migración 056

## AUTH-N1 — Recuperación/restablecimiento de contraseña
ESTADO: CERRADO END-TO-END
COMMIT: `d2a45d12b86045a5ec321564bfd1bb212867bb43`

## AUTH-N2 — Desincronización de profiles.email
ESTADO: CERRADO END-TO-END
COMMIT: `705f4d4196d1ddf9fb22c2e9da8aaf082f2f104d`

## AUTH-N3 — Seguridad del cambio de email (Secure Email Change)
ESTADO: DESCARTADO COMO VULNERABILIDAD — verificado operativamente
VERIFICACIÓN: el usuario confirmó manualmente en el Dashboard de
Supabase (Authentication → Providers → Email, proyecto de producción)
que "Secure email change" está ENABLED. Esto coincide con la promesa
del código/UI (`profile-form.tsx`, string `emailChangeHint`: ambas
direcciones deben confirmar). No se encontró ningún defecto de código.
No se modificó nada.

## AUTH-N4 — Seguridad del cambio y recuperación de contraseña
ESTADO: VALIDADO — PENDIENTE DE COMMIT/PUSH. NO cerrado END-TO-END
todavía (falta commit + push, que requieren autorización separada).

**Controles de Supabase — ambos ON.** Activados manualmente por el
usuario en el Dashboard de producción:
- "Require current password when updating" → ON.
- "Secure password change" → ON.
**CONFIRMADO POR EL USUARIO** — no verificable de forma independiente
por esta sesión (sigue sin existir una herramienta de lectura del
Dashboard de Auth, la misma limitación de todo este engagement).
Ninguna otra configuración de Supabase (Secure email change, Sessions,
MFA, Password requirements, Minimum password length, Prevent leaked
passwords) fue tocada.

**Validación de código completada esta fase:** `vitest run` →
135/135 archivos, 1617/1617 tests; `tsc --noEmit` → 0 errores;
`eslint .` → 0 errores, 37 warnings preexistentes sin cambios;
`git diff --check` → limpio. `git status` confirma exactamente
`password-form.tsx`, `password-form.test.tsx` (código) y
`AUDIT-ROADMAP.md` (documentación) — ningún otro archivo tocado.
`reset-password/page.tsx` confirmado sin `current_password` ni
`reauthenticate` (grep sin resultados) — intacto.

**Prueba operativa real de recovery con el toggle ya activo en
producción: NO EJECUTADA, explícitamente.** No se intentó un flujo
real de `resetPasswordForEmail` contra producción (fuera de alcance
de esta fase, que es de validación de código). La compatibilidad de
recovery sigue respaldada únicamente por la lectura del código fuente
oficial de GoTrue (`session.IsRecovery()`, fase anterior) — no por
una ejecución real observada en este proyecto. Esto se declara
explícitamente para no inventar una verificación que no ocurrió.

**Cambio de código aplicado:** [`password-form.tsx`](src/components/settings/password-form.tsx)
— se añadió `current_password: current` a la llamada `updateUser`
existente (junto a `password: next`), con comentario explicando el
motivo y citando la fuente (GoTrue `internal/api/user.go`,
`session.IsRecovery()`). `signInWithPassword` y la obtención de
`user.email` vía `getUser()` (AUTH-N2) quedaron intactos, sin
reestructurar el flujo. **`reset-password/page.tsx` NO fue tocado.**

**Tests:** [`password-form.test.tsx`](src/components/settings/password-form.test.tsx)
— test existente de "no regression" actualizado para esperar también
`current_password` en el `updateUser`; test nuevo dedicado
(`AUTH-N4: current_password sent to updateUser matches exactly...`)
que usa valores de contraseña actual/nueva distintos entre sí para
probar que `current_password` corresponde exactamente a lo tecleado
como contraseña actual (no a la nueva, no a ningún otro valor). El
test ya existente que prueba "si `signInWithPassword` falla,
`updateUser` nunca se llama" se mantuvo sin modificar. 9/9 tests del
archivo pasan; suite completa 135 archivos/1617 tests, sin
regresiones.

**Por qué recovery sigue siendo compatible:** confirmado por código
fuente oficial en la fase anterior — `session.IsRecovery()` exime por
completo el chequeo de `current_password` en el servidor.
`reset-password/page.tsx` nunca envía ese campo y no necesita
hacerlo.

**Confirmado por código:** `password-form.tsx` re-autentica solo en
el cliente (`signInWithPassword`); nunca envía la contraseña actual
dentro del propio `updateUser({password})`. `reset-password/page.tsx`
no tiene ni puede tener una "contraseña actual" que enviar.

**Confirmado por documentación oficial (cita verbatim,
`supabase.com/docs/guides/auth/password-security` y `.../passwords`):**
- "Secure password change" (Dashboard) = "Require reauthentication
  when changing password": exige sesión reciente o un `nonce` vía
  `reauthenticate()`.
- "Require current password when updating" (Dashboard) = "Require
  current password when changing password": exige pasar un campo
  literal `current_password` junto al nuevo `password` en la MISMA
  llamada `updateUser({password, current_password})` (disponible
  desde `supabase-js` v2.102.0+). Ambos están OFF en producción.

**Causa raíz:** el servidor de Auth no aplica ningún control de
sesión reciente ni de conocimiento de la contraseña actual sobre
`updateUser({password})`; la única barrera existente hoy es
client-side y evitable por cualquiera que ya posea un token de sesión
válido de la víctima.

**Cambio de código necesario (mínimo):** añadir
`current_password: current` a la llamada `updateUser` existente en
`password-form.tsx` — el valor ya está en el state del componente.
`reset-password/page.tsx` NO debe tocarse.

**INCÓGNITA — RESUELTA (fuente primaria: código fuente oficial de
GoTrue/Supabase Auth).**

Intentos previos contra documentación (7 búsquedas) y verificación
operativa (proyecto de staging inexistente, Docker no disponible en
esta sesión) no lo resolvieron — ver histórico más abajo. Esta fase
fue directamente al código fuente oficial del servidor de Auth:
`github.com/supabase/auth` (repo oficial de GoTrue), archivo
`internal/api/user.go`, obtenido vía
`raw.githubusercontent.com/supabase/auth/master/internal/api/user.go`.

Cita verbatim del código real (verificada en dos pasadas
independientes, la segunda pidiendo el bloque completo con más
contexto — ambas coincidieron exactamente):

```go
if user.HasPassword() {
    // current password required when updating password
    if config.Security.UpdatePasswordRequireCurrentPassword {
        // ensure user is not in a password recovery flow
        if !session.IsRecovery() {
            if params.CurrentPassword == nil || *params.CurrentPassword == "" {
                return apierrors.NewBadRequestError(apierrors.ErrorCodeCurrentPasswordRequired, "Current password required when setting new password.")
            }
            ...
```

**Interpretación exacta:** el chequeo de `current_password` está
envuelto en `if !session.IsRecovery()` — es decir, **se salta por
completo cuando la sesión es de tipo recovery**. Una sesión de
recuperación queda estructuralmente exenta de este requisito, sin
importar el valor de `config.Security.UpdatePasswordRequireCurrentPassword`.
**CONFIRMADO POR CÓDIGO FUENTE OFICIAL.**

**Impacto sobre `reset-password/page.tsx`:** su `updateUser({password})`
actual (sin `current_password`) seguirá funcionando sin cambios
cuando se active "Require current password when updating" en
producción — **no rompe recovery**.

**Hallazgo adicional del mismo bloque, relevante para el punto 7 del
análisis previo (¿es necesario activar también "Secure password
change"?):** el chequeo de reautenticación es independiente y usa su
propia condición — `session == nil || now.After(session.CreatedAt.Add(24*time.Hour))` —
sin ninguna excepción para recovery. Como una sesión de recovery
siempre se acaba de crear (segundos antes, vía `/auth/callback`),
pasa esta ventana de 24h de forma natural. **CONFIRMADO POR CÓDIGO
FUENTE**, con una inferencia mínima adicional (que la sesión sea
efectivamente "reciente" en el momento del `updateUser`, lo cual es
inherente al propio flujo, segundos de diferencia).

**Único residual no verificado, explícito, no oculto:** que la
sesión que este proyecto establece en `/auth/callback`
(`exchangeCodeForSession`, genérico para cualquier código) sea
efectivamente reconocida internamente por GoTrue como
`session.IsRecovery() == true` cuando el código proviene de
`resetPasswordForEmail`. Esto no se confirmó con una prueba operativa
propia (sigue sin existir un entorno para ello), pero es exactamente
el uso estándar y documentado del flujo de recuperación de Supabase
(el mismo que AUTH-N1 ya validó funcionalmente end-to-end), y es la
razón de ser de que este chequeo `IsRecovery()` exista en el código
del servidor. Se clasifica como **EVIDENCIA INDIRECTA muy sólida**,
no como confirmación operativa directa.

**Histórico de intentos previos (documentación oficial, 7 búsquedas;
verificación operativa con staging/Docker) que no encontraron esta
respuesta — mantenido por trazabilidad:** ninguna página de guía
(`password-security`, `auth-updateuser`, `passwords`, `sessions`,
`config.toml` reference, changelog, GitHub releases) menciona esta
interacción explícitamente; solo el código fuente la contiene.

Severidad: MEDIA-ALTA (sin cambios).

### Propuesta AUTH-N5 — Política de fortaleza de contraseña débil e inconsistente
Minimum password length = 6 en Supabase (aplica a TODOS los flujos,
es un único ajuste global). `signup/page.tsx` exige 6 (coincide);
`password-form.tsx` y `reset-password/page.tsx` declaran
`MIN_PASSWORD = 8` pero solo lo validan en el cliente — el servidor
seguiría aceptando 6-7 caracteres pese a la promesa de la UI.
"Password requirements" no exige ninguna clase de carácter. Severidad
propuesta: MEDIA.

### Propuesta AUTH-N6 — Prevent use of leaked passwords desactivado
Comprobación contra HaveIBeenPwned desactivada (requiere plan Pro+).
No depende del código del proyecto. Higiene general, no una brecha
activa. Severidad propuesta: BAJA.

### Investigado y DESCARTADO como brecha — sesiones tras cambio de contraseña/email
Documentación oficial de Supabase (`guides/auth/sessions`) confirma
que un session termina cuando "the user changes their password or
performs a security sensitive action", listado sin asociarlo a
ninguno de los 4 toggles nombrados de la pestaña Sessions (time-box,
inactivity timeout, single-session-per-user, JWT expiry) — indica
comportamiento nativo de Supabase Auth, no algo que dependa de
configuración adicional. No se encontró evidencia de una brecha real;
no se pudo probar operativamente en este proyecto específico (matiz
explícito). `signOut({scope:'others'})` en código NO se recomienda
como fix — no hay brecha demostrada que lo justifique.

### Nota de roadmap — ausencia de MFA/2FA
No hay MFA/TOTP en `src/` (confirmado por búsqueda exhaustiva). Es
una ausencia de funcionalidad, no una regresión — posible módulo
independiente a futuro, no una vulnerabilidad de este engagement.

---

# FASE 2 — AUDITORÍA DEL AGENTE IA

Esta fase comienza SOLO después de completar la auditoría estructural
previa (Fase 1, incluyendo AUTH-N3 y cualquier hallazgo posterior que
surja de ella).

## 2.1 Instrucción base / sistema
PENDIENTE

## 2.2 Instrucciones del negocio
PENDIENTE

## 2.3 Instrucciones CRM
PENDIENTE

## 2.4 Instrucciones WhatsApp
PENDIENTE

## 2.5 Reglas de ventas y atención
PENDIENTE

## 2.6 Prioridades y conflictos entre instrucciones
PENDIENTE

## 2.7 Herramientas, datos y contexto disponible
PENDIENTE

## 2.8 Pruebas integrales del agente
PENDIENTE

---

# REGLA DE CIERRE

Cada hallazgo debe pasar por:

1. Auditoría read-only
2. Confirmación del hallazgo
3. Clasificación de severidad
4. Propuesta de fix
5. Autorización de implementación
6. Implementación
7. Tests
8. Migración, si aplica
9. Validación
10. Commit
11. Push
12. Cierre END-TO-END
13. Actualización de este archivo

Los módulos cerrados no deben tocarse sin autorización explícita.

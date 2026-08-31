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

## AUTH-N5 — Política de fortaleza de contraseña débil e inconsistente
ESTADO: CERRADO END-TO-END (ver "CIERRE END-TO-END DE AUTH-N5" más
abajo para el commit final — el resto de esta sección es el historial
completo de auditoría, implementación y validación, conservado tal
cual se produjo)

**Alcance auditado:** barrido exhaustivo de todo `src/` (no solo los
3 archivos conocidos) buscando `signUp|updateUser|admin.createUser|
admin.updateUserById|admin.generateLink|MIN_PASSWORD|minLength|
password.length|confirmPassword` y cualquier esquema Zod/Yup/Valibot
de contraseña. **CONFIRMADO POR CÓDIGO**: existen exactamente 3
puntos de escritura de contraseña en todo el repositorio —
`signup/page.tsx` (`signUp`), `password-form.tsx` (`updateUser`),
`reset-password/page.tsx` (`updateUser`) — sin ningún endpoint propio,
función admin, ni esquema de validación compartido (no se usa
Zod/Yup/Valibot para contraseñas en ningún lugar). Tres falsos
positivos descartados tras inspección: `security-panel.tsx` (solo
renderiza `<PasswordForm/>`), `lib/api-keys/keys.ts` (comentario sobre
API keys, no contraseñas de usuario), `lib/auth/roles.ts` (mención de
paso, sin lógica).

**Evidencia — tabla de longitud (re-confirmada, sin cambios respecto
a lo ya reportado en AUTH-N4):**

| Flujo | Frontend | Mensaje si falla | Servidor (Supabase, global) |
|---|---|---|---|
| Signup | `password.length < 6` (hardcodeado, sin constante ni i18n) | `"Password must be at least 6 characters"` (string literal en inglés, no traducido) | Minimum password length = 6 |
| Cambio (Settings) | `MIN_PASSWORD = 8` | `t('passwordTooShort', {min: 8})` | Minimum password length = 6 |
| Recovery | `MIN_PASSWORD = 8` | `Password must be at least ${MIN_PASSWORD} characters` | Minimum password length = 6 |

**CONFIRMADO POR CÓDIGO.** El servidor es un único ajuste global — no
existe forma de tener un mínimo distinto por flujo en Supabase Auth.

**Causa raíz:** cada uno de los 3 archivos define su propia constante
de longitud de forma independiente (dos de ellos coinciden en 8, uno
diverge en 6 y además ni siquiera usa una constante con nombre), y
ninguno está respaldado por el servidor, cuyo mínimo real (6) es
menor que lo que dos de las tres pantallas prometen.

**Impacto real (sin exagerar):** esto NO es un bypass de autenticación
ni una escalada de privilegios — una contraseña de 6-7 caracteres solo
afecta la resistencia de la CUENTA PROPIA del usuario que la eligió
frente a fuerza bruta/diccionario; no permite a un atacante actuar
sobre una cuenta ajena por sí solo. Es un gap de "defensa en
profundidad", no una vulnerabilidad de lógica.

**Explotabilidad:** ninguna directa. El único "bypass" real y
demostrado es que la promesa de la UI (8 caracteres en 2 de 3
pantallas) no está garantizada por el servidor — alguien podría, en
teoría, llamar directamente a la API de Supabase Auth y fijar una
contraseña de 6-7 caracteres para su PROPIA cuenta pese a que la UI
dice que exige 8. No hay ningún escenario donde esto afecte a otro
usuario.

**Clasificación (evitando una sola etiqueta de severidad para cosas
distintas, tal como se pidió):**
- Mínimo global de 6 caracteres: **HARDENING RECOMENDADO**, no
  vulnerabilidad. Severidad propuesta si se quiere trackear: BAJA.
- Discrepancia UI (8) vs servidor (6) en 2 de 3 pantallas:
  **INCONSISTENCIA DE POLÍTICA/UX**, no vulnerabilidad — la promesa
  de la interfaz no es 100% garantizada, pero no habilita ningún daño
  a terceros.
- Ausencia de requisitos de complejidad ("Password requirements" =
  ninguno): **HARDENING RECOMENDADO**, mismo razonamiento que el
  mínimo de longitud.
- Mensaje de error de signup hardcodeado en inglés, sin i18n ni
  constante compartida: **INCONSISTENCIA DE CÓDIGO** (deuda técnica),
  no un hallazgo de seguridad.

**Configuración Supabase — estado:**
- "Minimum password length" = 6 y "Password requirements" = ninguno:
  **NO VERIFICABLE DESDE ESTA SESIÓN, y adicionalmente basado en una
  confirmación manual ANTERIOR** (la captura de pantalla del usuario
  de la fase de auditoría de AUTH-N3, antes de que se activaran los
  dos toggles de AUTH-N4 en ese mismo panel). No se puede asumir que
  sigue igual solo por no haber sido tocado explícitamente — el
  usuario debe reconfirmar el valor actual de ambos ajustes
  (Authentication → Providers → Email) antes de que esto se considere
  vigente.
- Ambos son ajustes **globales**, afectan por igual a signup,
  `updateUser` (cambio) y recovery/reset — mismo mecanismo confirmado
  en la investigación de AUTH-N4 (un único punto de configuración sin
  granularidad por flujo). **CONFIRMADO POR CÓDIGO FUENTE** (mismo
  archivo GoTrue `internal/api/user.go` revisado en AUTH-N4 aplica el
  mínimo de longitud sin distinguir el tipo de sesión).
- **Contraseñas existentes NO se ven afectadas retroactivamente** por
  subir el mínimo o activar requisitos: estos ajustes solo se evalúan
  en el momento de ESCRIBIR una contraseña nueva (`signUp`/
  `updateUser`), nunca contra hashes ya almacenados. **INFERENCIA de
  alta confianza** (es como funciona estructuralmente cualquier
  validación de entrada en un sistema de auth — no se encontró/buscó
  una cita documental específica para este punto, dado que es una
  propiedad estructural más que una decisión de producto).
- Subir el mínimo a 8 en el Dashboard, por sí solo, **no rompe
  ningún flujo existente**, pero sí requiere un cambio de código
  adicional (ver abajo) para que `signup/page.tsx` deje de prometer
  6 y quedar inconsistente con el resto.
- Activar "Password requirements" (letras+dígitos, por ejemplo) solo
  afectaría contraseñas nuevas/cambiadas — ninguno de los 3 flujos
  tiene hoy una validación de complejidad que pudiera entrar en
  conflicto; un rechazo del servidor se propagaría como un
  `error.message` genérico en los 3 flujos (ya manejado, aunque sin
  test específico para ese mensaje exacto).

**Tests existentes:**
- `password-form.test.tsx`: sí cubre el rechazo client-side de una
  contraseña corta (test "a too-short new password is rejected
  client-side").
- `reset-password/page.test.tsx`: sí cubre el mismo caso
  (AUTH-N1.11, "a too-short password is rejected client-side").
- `signup/page.tsx`: **CERO tests** — confirmado, no existe ningún
  archivo `*.test.*` para signup en todo el repo.
- Ninguno de los 3 flujos tiene un test que simule un RECHAZO
  server-side por longitud/complejidad (todas las pruebas actuales
  cortan en la validación del cliente, antes de llamar a Supabase) —
  gap de cobertura si se decide subir el mínimo real.

**Preguntas aún no resueltas:**
1. Estado real y actual de "Minimum password length" y "Password
   requirements" — pendiente de reconfirmación manual.
2. Si se decide implementar, falta decidir el valor exacto de
   "Password requirements" (ninguno / letras+dígitos / + mayúsculas /
   + símbolos) — no hay instrucción previa que fije esto.

Severidad global propuesta para AUTH-N5 (como conjunto): **BAJA-MEDIA**
— ajustada a la baja respecto a la propuesta original (MEDIA) tras
esta auditoría más detallada: es hardening + inconsistencia, no una
vulnerabilidad de lógica explotable.

### CIERRE END-TO-END DE AUTH-N5
ESTADO: CERRADO END-TO-END

**Política final aplicada:** mínimo global 8 caracteres + "letras y
dígitos" como requisito de complejidad, coherente en signup, cambio
de contraseña y recovery/reset.

**Configuración de Supabase — confirmada por el usuario (Dashboard de
producción):**
- "Minimum password length": 6 → **8** ✅ activado.
- "Password requirements": ninguno → **letras y dígitos** ✅ activado.
- Sin tocar (confirmado que permanecen igual): "Secure password
  change" ON, "Require current password when updating" ON, "Prevent
  use of leaked passwords" OFF (AUTH-N6, NO iniciado).

**Archivos nuevos:**
- `src/lib/auth/password-policy.ts` — única constante compartida
  `MIN_PASSWORD = 8`, sin lógica de complejidad de caracteres (esa
  parte es 100% responsabilidad del servidor, igual que
  `current_password` en AUTH-N4 — no hay validación de mayúsculas/
  dígitos/símbolos en ningún cliente de este proyecto).
- `src/app/(auth)/signup/page.test.tsx` — signup no tenía ningún test
  antes de esta fase.

**Archivos modificados:**
- `signup/page.tsx`: `password.length < 6` → `< MIN_PASSWORD`
  (import del módulo compartido); mensaje de error y placeholder
  ahora usan el valor dinámico en vez de "6" hardcodeado; se agregó
  `minLength={MIN_PASSWORD}` al input (los otros dos flujos ya lo
  tenían). **No se introdujo i18n en este archivo**: `signup/page.tsx`
  no usa `next-intl` en ningún string (a diferencia de `login/page.tsx`
  que sí), no existe un namespace `SignupPage` en `messages/*.json`, y
  reutilizar la clave `Settings.profile.passwordTooShort` habría sido
  semánticamente incorrecto (esa clave vive bajo el namespace de
  ajustes de cuenta, no el de una página pública de registro).
  Introducir `useTranslations` para un solo string en un archivo que
  no lo usa en ningún otro lugar habría sido menos consistente, no
  más — se mantuvo el mismo patrón de string dinámico ya usado por
  `reset-password/page.tsx` para el mismo mensaje. Ningún otro texto
  del archivo fue tocado.
- `password-form.tsx`: `const MIN_PASSWORD = 8` local reemplazada por
  el import del módulo compartido — mismo valor, cero cambio de
  comportamiento. **`current_password` (AUTH-N4) intacto, sin tocar.**
- `reset-password/page.tsx`: mismo cambio de import que arriba. **Sin
  `current_password`, sin `reauthenticate()`, sin tocar
  `/auth/callback` ni `sanitizeNextPath`** — confirmado por grep
  (`current_password` → sin resultados en este archivo) y por diff
  (solo el bloque de import/comentario cambia).

**Tests añadidos:**
- `signup/page.test.tsx` (nuevo, 5 tests): 7 caracteres rechazado,
  8 caracteres pasa la validación y llama a `signUp`, sin regresión en
  el éxito completo, confirmación no coincidente sigue rechazada, y un
  rechazo de política por parte de Supabase se muestra al usuario.
- `password-form.test.tsx`: +1 test — rechazo de política server-side
  en `updateUser` se muestra vía `passwordUpdateFailed`. Los 10 tests
  previos (incluidos los de AUTH-N4) quedaron intactos, sin modificar.
- `reset-password/page.test.tsx`: +2 tests — límite exacto 7
  (rechazado) vs 8 (acepta y llama `updateUser`), y rechazo de
  política server-side mostrado al usuario. Los tests previos de
  AUTH-N1 quedaron intactos.

**Validación:** `vitest run` → 136/136 archivos, 1625/1625 tests (1617
previos + 8 nuevos); `tsc --noEmit` → 0 errores; `eslint .` → 0
errores, 37 warnings preexistentes sin cambios; `git diff --check` →
limpio.

**Limitación explícita:** no se agregó un test de límite 7-vs-8
dedicado para `password-form.tsx` porque su `MIN_PASSWORD` ya era 8
antes de esta fase y no cambió de valor — el comportamiento en el
límite es idéntico al de los otros dos flujos (misma expresión
`length < MIN_PASSWORD`) pero no fue pedido explícitamente para este
archivo en el alcance de tests de esta fase (sí lo fue para signup y
reset-password).

**Integridad de módulos cerrados, confirmada antes del commit:**
AUTH-N1 (`/auth/callback`, `sanitizeNextPath`) intacto — no aparece en
el diff. AUTH-N2 (`user.email` real vía `getUser()`) intacto. AUTH-N3
(Secure email change) sin archivos relacionados tocados. AUTH-N4
(`current_password: current` en `password-form.tsx`) intacto,
confirmado por grep — sigue presente sin modificar; sus 10 tests
originales pasan sin cambios. **AUTH-N6 — NO INICIADO.**

**Commit/push:** este mismo archivo se publica como parte del commit
`fix(auth): unify password policy` a `origin/main` — el hash exacto
no puede auto-referenciarse dentro del propio commit que lo contiene;
queda confirmado en el reporte de la fase de cierre de esta misma
conversación (mismo patrón ya usado para las entradas de AUTH-N1/N2/N3
de este archivo, escritas después del hecho).

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

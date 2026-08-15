# SANDÍA — Plan de desarrollo y bitácora compartida

Este archivo es el punto de partida para **cualquier IA** que trabaje en este
repo (Claude Code, Codex, Cursor, Claude vía Cowork, etc.) y para Angel. Léelo
completo antes de tocar código.

## Cómo usar este archivo

1. Antes de empezar a trabajar: lee la sección **"Estado actual"** — te dice
   qué ya existe y qué no, para no reconstruir ni asumir de más.
2. Antes de diseñar algo nuevo: lee el **"Plan técnico"** — ya está pensado y
   validado en un intento previo (ver bitácora). No lo rediseñes desde cero
   salvo que encuentres un problema real con el enfoque.
3. Cuando termines una sesión de trabajo (hayas avanzado poco o mucho):
   **agrega una entrada nueva al final de la Bitácora**, con fecha, qué IA
   eres, qué hiciste, qué probaste, y qué le toca a quien siga. No borres
   entradas anteriores.
4. Si cambias el estado real del proyecto (implementas algo, lo reviertes,
   cambias el diseño), **actualiza la sección "Estado actual"** para que
   quien lea el archivo de arriba hacia abajo no tenga que leer toda la
   bitácora para saber dónde estamos hoy.
5. Otros documentos de contexto en este repo:
   - `docs/SANDIA_vision_producto.md` — visión de producto de largo plazo
     (de Angel, tal cual). El "por qué" de todo esto.
   - `docs/SANDIA_diagnostico_tecnico.md` — diagnóstico técnico del código
     base original (wacrm). El "qué hay hoy" en detalle, archivo por
     archivo. Sigue vigente salvo lo que esta bitácora indique que cambió.
   - `AGENTS.md` — reglas específicas de Next.js 16 para agentes (leer
     `node_modules/next/dist/docs/` antes de escribir código que use APIs
     de Next.js, porque esta versión tiene cambios respecto a lo que la
     mayoría de modelos tienen en su entrenamiento).

---

## Estado actual

**(actualizado 2026-08-15, última sesión: Codex)**

El rebranding visible inicial de la sección 1 ya está implementado: metadata,
sidebar, alta de usuarios, invitaciones, mensajes de conexión, README y
descripción del paquete muestran **Chat Sandía**. Se conservaron `wacrm` como
identificador técnico del paquete, claves internas, rutas y atribución MIT.
El locale activo sigue siendo inglés; el paquete español completo queda
pendiente porque el catálogo exige traducir y validar más de 1,800 mensajes,
sin fallback por clave.

El panel de plataforma, las invitaciones de empresas y la suspensión/reactivación
están implementados y desplegados en producción. Las migraciones 043, 044 y 045
están aplicadas al proyecto Supabase real. Angel tiene el permiso de plataforma
ligado a su `user_id`; los cambios confirmados de correo se sincronizan desde
Supabase Auth sin perder ese permiso. La ruta `/admin` fue validada en producción
y muestra correctamente la empresa activa, su propietario y sus miembros.

El proyecto sigue siendo un fork MIT de `wacrm` (Next.js 16 + Supabase), con
multi-tenancy vía `accounts` + RLS. Continúa pendiente el dominio de comercio
(productos, inventario y cotizaciones) y el paquete completo de español.

### Encargos de Angel (estado al 2026-08-15)

1. **Completado:** renombrar la marca del CRM a **"Chat Sandía"**.
2. **Completado:** panel de administración de plataforma para agregar empresas.
3. **Completado:** suspender/reactivar la suscripción de una empresa.
4. **Completado estructuralmente:** garantizar que las empresas nuevas tengan las mismas funciones que la
   cuenta de Angel (esto ya es cierto estructuralmente — ver más abajo).
5. **Completado para esta iteración:** deploy en **EasyPanel** sobre **Contabo**.
   Repo: `github.com/angelsandia-rgb/wacrm`
   (fork de `github.com/ArnasDon/wacrm`, licencia MIT — mantener el aviso
   de licencia, no hace falta ocultar el origen).
6. Supabase del proyecto real: proyecto **"Sandia"**,
   `project_id = puvbwzwmojpjplhdfnmk`, región `us-west-2`, Postgres 17.

---

## Plan técnico

### 0. Antes de tocar nada

- **Si vas a editar varios archivos relacionados y hay un `npm run dev`
  corriendo sobre esta misma carpeta (típico si Angel está trabajando desde
  Cowork/VS Code a la vez), pide que lo detengan primero.** El hot-reload de
  Next.js con cambios simultáneos en `middleware.ts` + varios componentes a
  la vez dejó la página rota una vez en esta sesión. Escribe archivos
  completos de una sola vez en vez de muchas ediciones pequeñas secuenciales
  cuando varios archivos están acoplados (auth context, middleware, sidebar).
- **Los archivos numerados en `supabase/migrations/` NO se aplican solos al
  proyecto real.** Hay que aplicarlos explícitamente contra
  `puvbwzwmojpjplhdfnmk` (vía MCP de Supabase `apply_migration`, la CLI de
  Supabase, o el SQL Editor del dashboard) además de dejar el archivo en el
  repo. Verificar con `list_migrations` si ya se aplicó algo antes de asumir
  el estado del schema remoto — no confíes solo en lo que hay en el folder.
- **Para cambios de schema riesgosos** (sobre todo cualquier cosa que toque
  `is_account_member()`, que es la función de la que dependen *todas* las
  políticas RLS del sistema), considera crear una rama de Supabase primero
  (`create_branch` vía MCP) y probar ahí antes de aplicar a producción.
- Angel puede pedirte cosas que impliquen privilegios elevados (ej.
  otorgarte `is_platform_admin` a ti mismo vía SQL). Si tu entorno bloquea
  ese tipo de acción por seguridad, no busques rodeos — pídele a Angel que
  lo confirme explícitamente o lo corra él mismo.

### 1. Rebrand a "Chat Sandía"

Alcance recomendado: strings visibles para el usuario, no el identificador
técnico del paquete/repo (evita romper tooling sin necesidad).

Archivos candidatos a revisar:
- `src/app/layout.tsx` — metadata/título del sitio.
- `src/app/icon.tsx` — ícono/favicon (solo si también se quiere cambiar el
  logo, no solo el texto).
- `messages/en.json`, `messages/ko.json` — clave `Sidebar.title` y cualquier
  copy que mencione el nombre del producto. **Falta el paquete de español**
  (`messages/es.json`) — el diagnóstico ya lo señalaba como pendiente; buen
  momento para agregarlo ya que se está tocando el branding, ya que Sandía
  es para Guatemala.
- `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx` — texto
  de bienvenida.
- `README.md` — encabezado (mantener una línea de atribución al proyecto
  original MIT `wacrm`/ArnasDon, no hace falta ocultarlo, la licencia lo
  permite explícitamente).
- `package.json` — campo `description` (el campo `name` interno puede
  quedarse como `wacrm`, es solo un identificador de paquete npm, no se
  muestra a usuarios; renombrarlo es opcional y de menor prioridad).

No renombrar: el repositorio de GitHub, el proyecto de Supabase (ya se
llama "Sandia"), ni rutas/identificadores internos — bajo valor, alto riesgo
de romper referencias (CI, docker-compose, mcp-server) sin necesidad.

### 2. Panel de administración de plataforma

Este diseño ya se implementó una vez en esta sesión y funcionó (typecheck
limpio, sin nuevos hallazgos de seguridad) antes de revertirse por el
problema de hot-reload — no por un defecto del diseño. Se puede reimplementar
tal cual.

**Migración SQL** (agregar como `supabase/migrations/043_platform_admin.sql`,
combinar con el punto 3 de suspensión en la misma migración si se hacen
juntos):

- `ALTER TABLE profiles ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;`
  — flag independiente del `account_role`. Angel sigue siendo `owner` de su
  propia cuenta/empresa; esto es una capacidad extra encima, no un
  reemplazo del rol de cuenta.
- Función `is_platform_admin()` — `SECURITY DEFINER`, mismo patrón que
  `is_account_member()` de la migración 017 (revisar esa migración como
  referencia exacta de estilo).
- Dos políticas RLS **aditivas** (no reemplazan nada existente — Postgres
  aplica OR entre políticas permisivas del mismo comando): platform admin
  puede `SELECT` sobre **todas** las filas de `accounts` y `profiles`.
  Ninguna otra tabla se toca — sin acceso a datos de negocio (conversaciones,
  contactos, etc.) de otras empresas.
- Tabla `platform_company_invitations` (`company_name`, `invited_email`,
  `invited_by`, `created_at`, `expires_at`, `accepted_at`, `account_id`),
  RLS restringida a `is_platform_admin()`, índice único parcial en
  `lower(invited_email)` para invitaciones pendientes (evita ambigüedad).
- Modificar `handle_new_user()` (el trigger de registro): si el correo que
  se registra tiene una invitación de plataforma pendiente y vigente, usar
  `company_name` de la invitación como nombre de la cuenta nueva en vez del
  nombre/correo de la persona, y marcar la invitación como aceptada. El
  resto del flujo de registro **no cambia**: sigue creando una cuenta
  (`accounts`) aislada nueva con el usuario como `owner` — es decir, la
  paridad de funciones (punto 4 de los encargos) ya queda resuelta gratis
  por el modelo existente, no requiere trabajo aparte.

**Backend:**
- `src/lib/auth/account.ts` — agregar `requirePlatformAdmin()`, mismo
  patrón que `requireRole()` pero verificando `is_platform_admin` en vez de
  un rol de cuenta.
- `src/lib/platform/admin-client.ts` — cliente Supabase con
  `SERVICE_ROLE_KEY` (mismo patrón que `src/lib/ai/admin-client.ts`), hace
  falta porque `auth.admin.inviteUserByEmail()` no está disponible con el
  cliente normal (RLS-scoped).
- `src/app/api/admin/companies/route.ts`:
  - `GET` — lista de empresas (nombre, dueño, cantidad de usuarios, fecha
    de alta, y con el punto 3: estado de suscripción) + invitaciones
    pendientes.
  - `POST` — recibe `{ companyName, email }`: guarda la invitación
    pendiente primero (antes de invitar, porque `inviteUserByEmail` crea el
    `auth.users` casi de inmediato y dispara el trigger), luego llama a
    `auth.admin.inviteUserByEmail`. Si el correo ya tiene cuenta, revertir
    la invitación insertada y devolver un error claro (409).

**UI:**
- `src/middleware.ts` — agregar `/admin` a `protectedPaths`. (De paso:
  `/flows` también falta ahí — es un hueco preexistente ya señalado en el
  diagnóstico, sección K, de bajo riesgo agregarlo.)
- `src/hooks/use-auth.tsx` — exponer `isPlatformAdmin` (leer
  `profiles.is_platform_admin` junto con el resto del perfil).
- `src/components/layout/sidebar.tsx` — ítem de navegación "Plataforma"
  visible solo si `isPlatformAdmin`.
- `src/app/(dashboard)/admin/page.tsx` — tabla de empresas + diálogo "Nueva
  empresa afiliada" (nombre + correo del dueño) + tabla de invitaciones
  pendientes. Usar los componentes ya existentes en `src/components/ui/`
  (`Table`, `Dialog`, `Card`, etc.) para mantener consistencia visual — no
  hace falta i18n completo vía `next-intl` para esta pantalla porque es
  interna, solo para Angel; strings en español directo están bien.

### 3. Suspensión de suscripción

**No implementado todavía en ningún intento previo — diseñar con cuidado,
es el cambio de mayor riesgo de todo este plan porque toca la función de la
que dependen todas las políticas RLS del sistema.**

Enfoque recomendado:
- `ALTER TABLE accounts ADD COLUMN suspended_at TIMESTAMPTZ;` (NULL = activa).
  Considerar también `suspended_reason TEXT` para que el panel muestre por
  qué (falta de pago, abuso, etc.).
- **Antes de modificar `is_account_member()`**, revisar exactamente qué
  políticas existen hoy sobre `accounts` (`grep -n "ON accounts"
  supabase/migrations/*.sql`) — la tabla `accounts` en sí probablemente
  necesita seguir siendo legible por sus propios miembros aunque la cuenta
  esté suspendida (para poder mostrarles "tu suscripción está pausada" en
  vez de una pantalla en blanco), mientras que las tablas de datos de
  negocio (`contacts`, `conversations`, `deals`, etc.) sí deben bloquearse
  por completo.
- Opción concreta: añadir el chequeo de `suspended_at IS NULL` dentro de
  `is_account_member()` (con un `SELECT ... FROM accounts a WHERE a.id =
  target_account_id AND a.suspended_at IS NULL` adicional), de forma que
  automáticamente el `owner`/`admin`/`agent`/`viewer` de una cuenta
  suspendida deja de poder leer o escribir en cualquier tabla que dependa de
  esa función — que es prácticamente toda la app. Mantener la política de
  `SELECT` sobre `accounts` en sí **fuera** de `is_account_member` (o con una
  variante que no chequee suspensión) para que el dueño todavía pueda leer
  el estado de su propia cuenta y mostrar el aviso.
- En el cliente: extender `AccountStatus` en `src/hooks/use-auth.tsx` (hoy
  es `"loading" | "ready" | "unlinked" | "error"`) con un estado
  `"suspended"`, derivado de leer `account.suspended_at` en el fetch de
  perfil, y mostrarlo en `src/components/layout/account-access-alert.tsx`
  (ya existe y ya se usa para el caso "unlinked"/"error" — extenderlo en vez
  de crear un componente nuevo).
- En el panel de plataforma (`/admin`): botón "Suspender" / "Reactivar" por
  empresa, que haga `PATCH` a algo como `/api/admin/companies/[id]` seteando
  o limpiando `suspended_at`. Requiere `requirePlatformAdmin()` igual que el
  resto del panel.
- **Probar en una rama de Supabase antes de aplicar a producción** (ver
  sección 0) — un error en `is_account_member()` bloquearía a *todas* las
  empresas activas, no solo a la que se quería suspender.

### 4. Paridad de funciones para empresas nuevas

Ya está garantizado por el diseño actual — no requiere código nuevo. Cada
empresa (fila de `accounts`) tiene exactamente el mismo conjunto de
funciones porque ninguna pantalla ni política RLS está hardcodeada a una
cuenta específica; todo se scoped por `account_id`. Mientras el flujo de
alta (self-serve o vía invitación de plataforma) siga pasando por
`handle_new_user()` sin atajos, esto se mantiene solo. Si en el futuro se
quiere diferenciar planes (ej. una empresa con menos funciones que otra),
eso sí sería trabajo nuevo — no está pedido todavía, no construirlo
preventivamente (ver `SANDIA_vision_producto.md` sección 15, principio 1:
NO sobreingeniería).

---

## Bitácora

Agrega tu entrada al final. Formato sugerido:

```
### YYYY-MM-DD — <quién> (<herramienta: Claude Code / Codex / Cowork / ...>)
**Hecho:** ...
**Probado:** ...
**Pendiente / siguiente paso:** ...
**Notas:** ...
```

### 2026-08-15 — Claude (Cowork)

**Hecho:** Diagnóstico técnico ya existía (`SANDIA_diagnostico_tecnico.md`,
hecho antes de esta sesión). En esta sesión: diseñé e implementé un
prototipo completo del panel de platform admin (schema + RLS + backend + UI,
ver sección 2 de este documento) contra el proyecto Supabase real
(`puvbwzwmojpjplhdfnmk`). Verifiqué con `npm run typecheck` (limpio) y con
`get_advisors` de Supabase (sin hallazgos de seguridad nuevos más allá de
los que ya existían en el proyecto).

**Revertido:** Angel reportó que la página dejó de cargar en su `npm run
dev` local mientras yo hacía las ediciones (la carpeta conectada es la misma
que usa su servidor de desarrollo en Windows, así que el hot-reload de
Next.js estaba recargando en caliente cambios a medio hacer — sobre todo
`middleware.ts`, que no siempre recarga bien en caliente). A pedido de
Angel, revertí *todo*: la migración SQL en Supabase (dropeé la tabla, la
función, las políticas, la columna, y restauré `handle_new_user()` exacto a
como estaba en la migración 017), y el código local (archivos editados
restaurados línea por línea al original, archivos nuevos borrados). Verifiqué
el estado final con `git diff` (sin diferencias de contenido, solo ruido de
fin de línea CRLF/LF preexistente en el repo) y `npm run typecheck` (limpio).

**Pendiente / siguiente paso:** Nada de la sección "Plan técnico" está
implementado. El siguiente agente que retome esto debería, en este orden:
(1) confirmar con Angel que el `npm run dev` local está detenido si va a
tocar varios archivos relacionados a la vez, (2) hacer el rebrand (sección
1), (3) implementar la migración combinada de platform admin + suspensión
de suscripción (secciones 2 y 3) en un solo archivo, aplicándola contra
`puvbwzwmojpjplhdfnmk` vía MCP de Supabase o la CLI, idealmente probando
primero en una rama de Supabase dado que la sección 3 modifica
`is_account_member()`, (4) el backend y la UI (escribir los archivos
completos de una vez, no en muchas ediciones pequeñas secuenciales), (5)
verificar (`npm run typecheck`, `npm test` si el entorno lo permite,
`get_advisors`), (6) avisar a Angel para que reinicie su dev server y
verifique en Chrome antes de dar por hecho el trabajo.

**Notas:** El proyecto no tiene tests corriendo en el sandbox de Cowork por
un problema de binarios nativos de `rolldown`/vitest ajeno a este código
(`Cannot find native binding` — parece un `node_modules` instalado en
Windows corriendo desde un sandbox Linux). Si Claude Code o Codex corren
nativamente en Windows o en un entorno con los binarios correctos, `npm
test` debería funcionar normalmente ahí — no asumir que el problema es del
código. El repo tiene mucho ruido de diff por finales de línea CRLF/LF en
archivos no relacionados a este trabajo (preexistente, no introducido por
mí) — no lo interpretes como cambios reales al comparar con `git diff`.

### 2026-08-15 — Codex

**Hecho:** Confirmé que no había un servidor Next.js activo antes de editar.
Implementé la primera iteración del rebranding visible a **Chat Sandía** en
metadata, sidebar, registro, invitaciones, mensajes visibles de configuración,
README y descripción del paquete. Mantuve los identificadores técnicos `wacrm`
y la atribución al proyecto original MIT, conforme al plan.

**Probado:** `npm.cmd run typecheck` limpio. Pruebas de paridad y seguridad ICU
de i18n: 2 archivos, 3 pruebas, todas aprobadas.

**Pendiente / siguiente paso:** Completar el paquete español como una
iteración independiente; después implementar panel de platform admin y
suspensión, probando primero el cambio de RLS en un entorno Supabase seguro.

**Notas:** No se cerraron procesos Node ajenos: `netstat` y la ausencia de
`.next/dev/lock` confirmaron que `npm run dev` no estaba ejecutándose.

### 2026-08-15 — Codex (panel de plataforma)

**Hecho:** Implementé localmente `043_platform_admin.sql` con el flag y helper
de platform admin, RLS aditiva limitada a `accounts`/`profiles`, invitaciones de
empresas y adaptación de `handle_new_user()`. Agregué verificación server-side,
cliente service-role, API para listar/invitar empresas, indicador en auth,
protección de `/admin` y `/flows`, acceso condicional en sidebar y pantalla de
plataforma en español.

**Probado:** `npm.cmd run typecheck`, pruebas i18n (3/3) y `git diff --check`,
todos correctos.

**Pendiente / siguiente paso:** Aplicar 043 primero en una rama/entorno seguro
de Supabase, otorgar `is_platform_admin = true` al perfil de Angel con su
confirmación, validar alta real de una empresa y revisar advisors. Después
implementar suspensión en una migración separada.

**Notas:** La CLI de Supabase no está instalada ni hay un conector Supabase
disponible en este entorno, por lo que no se modificó el proyecto remoto.

### 2026-08-15 — Codex (suspensión de empresas)

**Hecho:** Audité las políticas que dependen de `is_account_member()` e
implementé `044_account_suspension.sql`. La migración mantiene una lectura
separada de identidad para que los miembros puedan ver el estado de su empresa,
pero bloquea mediante el helper central todo acceso operativo cuando
`suspended_at` no es NULL. Agregué endpoint platform-admin, controles de
suspender/reactivar, motivo y aviso visible para la empresa pausada. El endpoint
impide que el operador suspenda su propia empresa administrativa.

**Probado:** Typecheck limpio, pruebas i18n 3/3 y `git diff --check` correcto.

**Pendiente / siguiente paso:** Aplicar 043 y 044, en ese orden, primero en una
rama/entorno de prueba de Supabase. Validar una empresa activa, suspenderla,
confirmar que `accounts` siga visible y que los datos comerciales queden
bloqueados, reactivarla y confirmar recuperación completa. Solo después aplicar
a producción y ejecutar advisors.

**Notas:** Se revisó la posibilidad de conectar el plugin de Supabase mediante
la habilidad de gestión de plugins, pero esta sesión no expone búsqueda/conexión
de plugins ni herramientas Supabase. El proyecto remoto permaneció intacto.

### 2026-08-15 — Codex (preparación para aplicación remota)

**Hecho:** Retomé las migraciones 043 y 044 sin revertir cambios existentes.
Actualicé 043 para conceder explícitamente acceso de Data API al `service_role`
sobre `platform_company_invitations`, necesario con el nuevo comportamiento de
Supabase para tablas públicas. Endurecí los helpers `SECURITY DEFINER` de ambas
migraciones revocando el permiso implícito de `PUBLIC` antes de concederlo solo
a `authenticated` y `service_role`.

**Probado:** `npm.cmd run typecheck` limpio. Vitest ejecutó 835 pruebas: 833
pasaron y fallaron 2 pruebas preexistentes de `mondayIndex`, sensibles a la zona
horaria (`new Date("2026-05-18")` se interpreta como UTC y en Guatemala cae en
domingo local). Los fallos no corresponden a estas migraciones.

**Pendiente / siguiente paso:** Aplicar 043 y 044, en orden, al proyecto remoto
de Supabase y ejecutar las validaciones funcionales y advisors ya descritos.
Chrome no estuvo disponible para automatización: el diagnóstico encontró que
la extensión de navegador y su host nativo no están instalados en el perfil
seleccionado, por lo que no se pudo abrir el SQL Editor en esta sesión.

**Notas:** No se eliminó ni revirtió código existente y el proyecto remoto no
fue modificado.

### 2026-08-15 — Codex (aplicación remota y correo de administrador)

**Hecho:** Apliqué las migraciones 043 y 044 al proyecto Supabase `Sandia` y
activé `is_platform_admin` para `angelduran.management@gmail.com`. Durante la
verificación detecté y cerré permisos `EXECUTE` residuales del rol `anon` en
los helpers `SECURITY DEFINER`; la revocación explícita también quedó guardada
en las migraciones locales. Agregué y apliqué `045_profile_email_sync.sql`, que
sincroniza a `profiles.email` cualquier cambio de correo ya confirmado en
Supabase Auth. El permiso de plataforma permanece ligado al `user_id`, por lo
que un cambio futuro de correo no lo elimina.

**Probado:** 043 y 044 se ejecutaron correctamente. RLS, políticas, grants y
ACL de funciones verificados con consultas remotas. La suspensión se probó en
una transacción real: mantuvo la lectura de identidad, bloqueó
`is_account_member()` y terminó con `ROLLBACK`, sin dejar cuentas suspendidas.
El trigger de correo existe, no es ejecutable por `anon` ni `authenticated`, y
el perfil de Angel conserva `is_platform_admin = true`. Security Advisor fue
recalculado y reporta 0 errores; conserva 42 advertencias preexistentes.

**Pendiente / siguiente paso:** Desplegar el código local actualizado para que
la navegación y las APIs del panel `/admin` estén disponibles en producción, y
probar desde la aplicación la invitación de una empresa. El SQL remoto ya está
listo.

**Notas:** La CLI de Supabase sigue sin estar instalada; se respetó la
numeración existente del repositorio y las migraciones se ejecutaron desde el
SQL Editor autenticado. No se borraron datos.

### 2026-08-15 — Codex (deploy de plataforma)

**Hecho:** Ejecuté el build de producción, publiqué el commit `fe929ec` en
`origin/main` y confirmé la implementación automática en EasyPanel. El build
Docker terminó con `Success` y la nueva imagen reemplazó el servicio.

**Probado:** `next build` completó las 59 rutas, incluyendo `/admin` y los
endpoints `/api/admin/companies`. En producción, `/admin` cargó con la sesión de
Angel, mostró el acceso “Plataforma” y listó 1 empresa activa con su propietario
y 1 usuario. No se envió una invitación de prueba porque eso habría enviado un
correo real a un tercero no especificado.

**Pendiente / siguiente paso:** Probar una invitación cuando Angel proporcione
un correo real autorizado para recibirla. El dominio de comercio y el paquete
completo de español siguen como fases posteriores.

**Notas:** El archivo local no relacionado `src/lib/probe_delete_test.txt` se
mantuvo intacto y fuera del commit.

### 2026-08-15 — Codex (prueba de invitación real)

**Hecho:** Desde `/admin` envié una invitación autorizada para la empresa
`David Emanuel Duran Simon` al correo `durandavidinma1@gmail.com`.

**Probado:** La API de producción completó la solicitud sin error. Supabase
creó el usuario invitado y el trigger generó inmediatamente su cuenta aislada;
el panel pasó de 1 a 2 empresas y muestra a David como propietario, con 1
usuario y estado activo. La invitación ya no aparece como pendiente porque
`inviteUserByEmail()` crea la fila de `auth.users` al enviar el correo y el
trigger consume la invitación en ese momento.

**Pendiente / siguiente paso:** David debe abrir el correo de Supabase, aceptar
la invitación y establecer su acceso. Después conviene iniciar sesión con esa
cuenta y verificar que solo pueda ver los datos de su propia empresa.

**Notas:** No se abrió ni inspeccionó el buzón del destinatario. La confirmación
actual es la respuesta exitosa de Supabase y la creación de la empresa en el
panel de producción.

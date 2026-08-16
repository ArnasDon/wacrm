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

**(actualizado 2026-08-15, última sesión: Claude Code)**

**Bloque 1 (múltiples números de WhatsApp por empresa) está completo en
código pero SIN APLICAR a producción.** La migración
`050_multiple_whatsapp_numbers.sql` sigue sin ejecutarse contra
`puvbwzwmojpjplhdfnmk` — el código ya es compatible (API de configuración,
envío, webhooks, plantillas, difusiones, flows/automations y UI adaptados),
`npm run typecheck`, `npm test` (846 pruebas, 844 pasan; las 2 que fallan son
las preexistentes de `mondayIndex` sensibles a zona horaria, documentadas en
sesiones anteriores, no relacionadas con este trabajo) y `npm run build`
(61 rutas) quedan limpios, pero falta el paso de aplicar la migración,
desplegar y validar en producción antes de darlo por terminado. Ver la
entrada de bitácora de hoy para el detalle completo y los próximos pasos.

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
El siguiente alcance confirmado incluye rate limiting compartido, medición de
consumo por empresa, CSP estricta, múltiples números de WhatsApp, ampliación de
webhooks y agentes IA por empresa capaces de consultar métricas y, con permisos
y auditoría, cerrar chats, marcar ventas y mover leads en el pipeline.
La ruta `/flows` ya está protegida, el registro exige contraseñas de al menos
8 caracteres tanto en la aplicación como en Supabase Auth, y las funciones
operativas privilegiadas identificadas en el diagnóstico ya no son ejecutables
por los roles de navegador. Las actualizaciones de estado de WhatsApp y el
proxy de medios también verifican explícitamente la empresa propietaria.
La Fase 2 ya comenzó con temperatura manual de clientes (`cold`, `warm`,
`hot` o sin clasificar), disponible en el modelo, la API pública y la interfaz
de Contactos.

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

### 2026-08-15 — Codex (corrección de enlace de invitación)

**Hecho:** Corregí en Supabase Auth la `Site URL` de `localhost:3000` al dominio
productivo de Sandia y agregué el mismo dominio a la lista permitida de URLs de
redirección. También configuré `NEXT_PUBLIC_SITE_URL` en EasyPanel y reforcé la
API de administración para enviar explícitamente las futuras invitaciones a
`/login` del sitio configurado.

**Probado:** `npm.cmd run build` completó correctamente las 59 rutas y la
comprobación de TypeScript incluida en el build. La configuración de Supabase
quedó guardada con el dominio productivo y la variable fue guardada en el
servicio de EasyPanel sin alterar las demás variables.

**Despliegue y acceso:** Publiqué el commit `599d747` en `origin/main` y
EasyPanel completó la implementación automática. La URL productiva respondió y
redirigió correctamente de `/login` a `/dashboard` con una sesión válida.
David ya figura confirmado y con un inicio de sesión registrado; además se
solicitó desde Supabase un enlace mágico nuevo después de corregir la URL.

**Pendiente / siguiente paso:** David debe usar el correo más reciente y
confirmar que entra al dominio productivo. Después conviene validar con su
sesión que solo vea la empresa `David Emanuel Duran Simon`.

**Notas:** No se eliminó la cuenta, empresa ni invitación existente de David.
El archivo local no relacionado `src/lib/probe_delete_test.txt` permanece
intacto y fuera de los cambios.

### 2026-08-15 — Codex (retorno seguro al cambiar correo)

**Hecho:** Reforcé la opción existente de cambio de correo en Configuración >
Perfil. La llamada a Supabase Auth ahora envía explícitamente como retorno la
sección de perfil del mismo origen donde el usuario está conectado
(`/settings?tab=profile`), evitando depender de una URL predeterminada.

**Comportamiento:** El cambio continúa requiriendo la confirmación configurada
por Supabase. Cuando Auth confirma el nuevo correo, el trigger remoto
`on_auth_user_email_updated` sincroniza `profiles.email`; la empresa, el rol y
el permiso de plataforma permanecen ligados al `user_id` y no se recrean.

**Probado:** `npm.cmd run typecheck` y `npm.cmd run build` completaron sin
errores; el build generó las 59 rutas. Publiqué `120ce6d` en `origin/main`,
EasyPanel completó el despliegue y producción mostró el campo Email y el botón
de guardar en `/settings?tab=profile`. No se ejecutó un cambio real porque el
propietario no ha indicado una nueva dirección.

### 2026-08-15 — Codex (cierre parcial de seguridad Fase 0)

**Hecho:** Agregué la migración aditiva
`046_harden_privileged_function_acl.sql` y la apliqué al proyecto real. Revoca
la ejecución de `_bcast_bump`, `recompute_broadcast_counts`,
`record_webhook_failure` y `claim_ai_reply_slot` a `PUBLIC`, `anon` y
`authenticated`, conservando el acceso operativo de `service_role`. También
subí el mínimo de registro de 6 a 8 caracteres y configuré el mismo mínimo en
Supabase Auth.

**Probado:** La consulta remota de ACL devolvió `false` para `anon` y
`authenticated` en las cuatro funciones, y `true` para `service_role`.
Supabase confirmó el guardado de la política de 8 caracteres.
`npm.cmd run typecheck` y `npm.cmd run build` finalizaron correctamente; el
build generó las 59 rutas.

**Despliegue:** Publiqué `9dc5628` en `origin/main` y EasyPanel completó la
implementación automática. La sesión autenticada redirige correctamente
`/signup` al dashboard, por lo que no se creó un usuario artificial para una
prueba visual; el mínimo queda cubierto por el build y por la validación remota
de Supabase Auth.

**Pendiente / siguiente paso:** Continuar la Fase 0 con el aislamiento por
cuenta de las actualizaciones de estado de mensajes y la autorización explícita
del proxy de medios, que requieren cambios acompañados de pruebas específicas.

**Notas:** No se modificaron filas de negocio ni cuentas. El archivo local no
relacionado `src/lib/probe_delete_test.txt` permanece intacto y fuera de los
cambios.

### 2026-08-15 — Codex (aislamiento de estados y medios)

**Hecho:** Cerré los dos pendientes multi-tenant restantes de la Fase 0. Los
eventos de estado de Meta resuelven ahora la empresa mediante
`metadata.phone_number_id`, y Zernio transmite la empresa ya autenticada; las
búsquedas y actualizaciones de `messages` y `broadcast_recipients` se filtran
por esa cuenta. El proxy `/api/whatsapp/media/[mediaId]` comprueba que exista
un mensaje con esa URL dentro de una conversación de la empresa del usuario
antes de leer configuración, descifrar credenciales o descargar contenido.

**Probado:** Agregué regresiones para una colisión de identificador entre
empresas y para un medio ajeno. Las 9 pruebas dirigidas pasaron, junto con
`npm.cmd run typecheck` y `npm.cmd run build`; el build generó las 59 rutas.

**Despliegue:** Publiqué `a74ca40` en `origin/main`. El webhook automático se
demoró y el panel tuvo una interrupción breve; se inició también un despliegue
manual, y EasyPanel terminó correctamente la implementación identificada con
el commit de aislamiento.

**Pendiente / siguiente paso:** Se puede cerrar el resto de housekeeping de
Fase 0 o comenzar el núcleo de Fase 2 (temperatura manual de clientes), según
la prioridad de producto.

**Notas:** No se alteró el esquema ni se modificaron mensajes o medios reales.
El archivo no relacionado `src/lib/probe_delete_test.txt` permanece intacto.

### 2026-08-15 — Codex (temperatura manual de clientes)

**Hecho:** Inicié la Fase 2 con la migración aditiva
`047_contact_lead_temperature.sql`. Los contactos admiten `cold`, `warm`,
`hot` o `NULL` (sin clasificar). La temperatura se puede escoger al crear o
editar, modificar desde el detalle y ver como distintivo en la tabla. La API
pública v1 serializa el campo, lo admite al crear y valida actualizaciones.
Los catálogos inglés y coreano mantienen las mismas claves.

**Probado:** Apliqué 047 al proyecto real; la verificación devolvió columna
nullable existente y 0 filas inválidas. Las pruebas de contactos e i18n
pasaron (4/4), `npm.cmd run typecheck` quedó limpio y `npm.cmd run build`
generó correctamente las 59 rutas.

**Despliegue:** Publiqué `1376cce` en `origin/main`. Los dos primeros intentos
de EasyPanel fallaron durante el build porque el servicio conservaba solamente
`NEXT_PUBLIC_SITE_URL`; faltaban los argumentos públicos de Supabase que Next.js
necesita al prerenderizar. Restauré en EasyPanel el conjunto de variables desde
el entorno local, manteniendo la URL productiva, y lancé nuevamente el deploy.

**Validación productiva:** EasyPanel terminó correctamente tanto el deploy de
la funcionalidad como el deploy posterior de documentación. En producción,
Contactos muestra la columna de temperatura, los contactos existentes aparecen
sin clasificar y el detalle expone el selector manual. El panel de plataforma
carga dos empresas activas y aisladas, Angel y David, cada una con un único
propietario; no quedaron invitaciones pendientes. La consola del navegador no
registró errores durante estas comprobaciones.

**Pendiente / siguiente paso:** La solicitud inmediata queda cerrada y la app
está lista para validación con otras empresas. La clasificación automática por
IA queda fuera de este primer corte manual y corresponde a una fase posterior.

**Notas:** La migración no clasificó ni reescribió contactos existentes. El
archivo local `src/lib/probe_delete_test.txt` sigue intacto y excluido.

### 2026-08-15 — Codex (inicio de ampliación SaaS e IA operativa)

**Hecho:** Incorporé al plan el nuevo alcance solicitado. Agregué la migración
`048_shared_rate_limits_and_usage.sql`, con contadores atómicos compartidos en
Supabase accesibles solo por `service_role`, y un cliente con fallback local
para contingencias. Las rutas de IA, auto-respuesta y API pública ya usan el
limitador compartido. El panel de Plataforma ahora calcula por empresa el
consumo de conversaciones, mensajes y tokens IA de los últimos 30 días.

**Probado:** `npm.cmd run typecheck` quedó limpio. Las pruebas de rate limiting
y registro de consumo IA pasaron (11/11).

**Pendiente / siguiente paso:** Aplicar 048 en Supabase y desplegar este corte;
después migrar los límites administrativos y de envío restantes al almacén
compartido. Continuar con CSP con nonces, múltiples números, webhooks, español
y las herramientas IA empresariales con permisos y bitácora de acciones.

**Notas:** No se modificaron datos reales ni configuraciones de canales. El
archivo `src/lib/probe_delete_test.txt` permanece intacto y excluido.

### 2026-08-15 — Codex (rate limit remoto y métricas para IA empresarial)

**Hecho:** Apliqué `048_shared_rate_limits_and_usage.sql` en Supabase productivo
y verifiqué que `authenticated` no puede ejecutar el RPC, mientras
`service_role` sí. Agregué un snapshot de métricas aislado por `account_id`
(contactos por temperatura, conversaciones por estado y negocios por estado y
valor ganado). El playground de cada empresa recibe estas métricas como
contexto y también existe `GET /api/ai/business-metrics` para la futura UI.

**Probado:** La migración respondió correctamente, la tabla compartida existe,
los privilegios son los esperados y `npm.cmd run typecheck` quedó limpio.

**Pendiente / siguiente paso:** Incorporar confirmación y auditoría para las
acciones IA de cerrar chat, marcar venta y mover negocio; luego continuar con
CSP, múltiples números, webhooks y español completo.

**Notas:** La prueba solo creó un bucket técnico temporal de rate limit; no se
modificaron contactos, conversaciones, negocios ni configuraciones reales.

### 2026-08-15 — Codex (acciones empresariales de IA con confirmación)

**Hecho:** Preparé `049_ai_action_audit.sql` y `POST /api/ai/actions`. La capa
permite cerrar conversaciones, marcar negocios como ganados y moverlos de etapa,
siempre filtrando objetivo, pipeline y etapa por la empresa activa. Toda acción
exige reenviar una frase de confirmación exacta y se registra en
`ai_action_log`; solo administradores de la empresa pueden consultar la bitácora.

**Probado:** `npm.cmd run typecheck` quedó limpio. No se ejecutó ninguna acción
sobre datos reales.

**Pendiente / siguiente paso:** Aplicar 049, agregar pruebas unitarias de los
tres comandos, conectar la confirmación a la interfaz conversacional y validar
el flujo en una empresa de prueba antes de habilitarlo en conversaciones reales.

**Notas:** `src/lib/probe_delete_test.txt` permanece intacto y excluido.

### 2026-08-15 — Codex (CSP obligatoria y diseño n8n)

**Hecho:** Cambié la CSP de modo reporte a modo obligatorio, eliminé
`unsafe-eval` en producción y bloqueé objetos; workers quedan limitados al mismo
origen y `blob:`. Definí n8n como orquestador externo por empresa para Calendar,
Meet, cotizaciones, correo y recordatorios, mientras el CRM conserva permisos,
confirmaciones, datos y auditoría de las acciones críticas.

**Probado:** `npm.cmd run typecheck` quedó limpio.

**Pendiente / siguiente paso:** Validar CSP en build/navegador antes de publicar.
La tabla `ai_action_log` aún no existe en Supabase; Chrome no logró completar
el editor SQL, por lo que 049 y las acciones IA siguen sin desplegarse.

### 2026-08-15 — Codex (base para múltiples números)

**Hecho:** Preparé la migración aditiva `050_multiple_whatsapp_numbers.sql`.
Elimina el límite de una configuración por cuenta, conserva la conexión actual
como predeterminada y vincula cada conversación con el número que la atiende.
Incluye unicidad del número Meta y un único número predeterminado por empresa.

**Pendiente / siguiente paso:** No aplicar 050 hasta adaptar GET/POST de
configuración, envío, webhooks y UI para seleccionar la conexión correcta.
049 continúa bloqueando la publicación acumulada porque Chrome no responde al
enumerar o controlar la pestaña autenticada de Supabase.

### 2026-08-15 — Codex (migración 049 confirmada y build de producción)

**Hecho:** Apliqué `049_ai_action_audit.sql` en el proyecto Sandia de Supabase.
La bitácora `ai_action_log`, sus políticas RLS y sus permisos ya están activos.
Las acciones empresariales de IA y la CSP obligatoria quedan listas para
publicarse junto con la base aditiva de múltiples números.

**Probado:** El editor SQL devolvió `Success. No rows returned`, la API REST de
Supabase confirmó `ai_action_log` con HTTP 200 y `npm.cmd run build` completó
las 61 páginas/rutas sin errores de compilación ni de TypeScript.

**Pendiente / siguiente paso:** Publicar y validar en producción las acciones
IA y la CSP. Después adaptar API, envío, recepción y UI antes de aplicar 050.

**Notas:** No se ejecutaron acciones IA sobre datos reales y
`src/lib/probe_delete_test.txt` permanece intacto y excluido.

### 2026-08-15 — Codex (corrección de métricas del panel)

**Hecho:** Corregí el conteo de mensajes de `/api/admin/companies`. La tabla
`messages` no contiene `account_id`; ahora el conteo se limita por empresa a
través de la relación interna con `conversations.account_id`.

**Probado:** La consulta anterior reprodujo PostgreSQL `42703`; la consulta
relacional corregida respondió HTTP 200 contra producción y el typecheck quedó
limpio.

**Validado en producción:** EasyPanel completó el despliegue y `/admin` volvió
a mostrar las dos empresas con sus conversaciones, mensajes y tokens IA. No se
observaron errores en la consola del navegador.

### 2026-08-15 — Claude Code (Bloque 1: múltiples números de WhatsApp, código completo)

**Hecho:** Leí `AGENTS.md`, `docs/SANDIA_plan_de_desarrollo.md`,
`docs/SANDIA_vision_producto.md` y `docs/SANDIA_diagnostico_tecnico.md`
completos, confirmé que no había `npm run dev` corriendo localmente, y
mapé con tres agentes de exploración el estado exacto de multi-número,
webhooks/acciones IA y i18n/CSP/rate-limit. Con dos decisiones de producto
confirmadas por Angel (una conversación por número; soporte completo de
plantillas y difusiones por número desde este bloque), implementé de punta
a punta el Bloque 1:

- Revisé `050_multiple_whatsapp_numbers.sql` (todavía sin aplicar): agrega
  `display_name`/`is_default` a `whatsapp_config`; agrega
  `whatsapp_config_id` a `conversations` (con `UNIQUE(account_id,
  contact_id, whatsapp_config_id)` reemplazando el índice de la migración
  036 — una conversación por número, no por cuenta) y a `message_templates`
  (con `UNIQUE(whatsapp_config_id, name, language)`, resolviendo de paso el
  TODO de account-sharing que quedaba en `user_id`) y a `broadcasts`
  (congelado en creación); y redefine `create_broadcast_with_recipients`
  (migraciones 037/038) para fijar `whatsapp_config_id` de forma atómica
  con la fila padre, sin una escritura de seguimiento separada.
- Nuevo helper `src/lib/whatsapp/resolve-config.ts`
  (`resolveWhatsAppConfig`): resuelve el número correcto — explícito →
  predeterminado de la cuenta → más reciente conectado — reutilizado por
  todos los puntos de envío.
- API de configuración reescrita como colección:
  `GET/POST /api/whatsapp/config` (listar/crear) y nuevos
  `GET/PATCH/DELETE /api/whatsapp/config/[id]` +
  `GET /api/whatsapp/config/[id]/verify-registration` (reemplaza la ruta
  antigua de una sola fila). Lógica de conexión compartida en
  `src/lib/whatsapp/config-connect.ts` para no duplicar el flujo de
  verificación/registro entre crear y editar.
- Adaptados: envío (`send-message.ts`, `react/route.ts`), webhooks entrantes
  (Meta y Zernio — la resolución por `phone_number_id`/`zernio_account_id`
  ya era correcta; solo faltaba fijar `whatsapp_config_id` en la
  conversación nueva), `resolve-conversation.ts` (API pública),
  `flows/meta-send.ts` y `automations/meta-send.ts`, plantillas
  (`sync`/`submit`/`[id]`), difusiones (`broadcast-core.ts`,
  `broadcast-resume.ts`, `broadcast/route.ts`) y los dos widgets del
  dashboard que usaban `.maybeSingle()` sobre `whatsapp_config`
  (`settings-overview.tsx`, `inbox/page.tsx`).
- UI: `whatsapp-config.tsx` pasó de formulario de una sola conexión a lista
  con agregar/editar/eliminar/marcar predeterminado; selector de número en
  el paso final del asistente de difusión (`step4-schedule-send.tsx`,
  oculto si solo hay un número). Claves nuevas en `messages/en.json` y
  `messages/ko.json` (español todavía no existe — Bloque 4).

**Probado:** `npm run typecheck` limpio. `npm test`: 846 pruebas, 844 pasan
(las 2 fallas restantes son las de `mondayIndex` ya documentadas como
preexistentes y no relacionadas). Actualicé los mocks de Supabase en
`webhook/route.test.ts`, `send/route.test.ts`, `broadcast-core.test.ts`,
`broadcast-resume.test.ts`, `send-message.test.ts` y
`resolve-conversation.test.ts` para las nuevas formas de consulta, y agregué
`resolve-config.test.ts` (unitario del helper de resolución) y
`config/route.test.ts` (aislamiento multiempresa del listado — una cuenta
nunca consulta `whatsapp_config` de otra — y la regla de "el primer número
de una cuenta siempre es predeterminado, los siguientes respetan lo que pida
quien llama"). `npm run build` generó 61 rutas sin errores, incluyendo
`/api/whatsapp/config/[id]` y `/api/whatsapp/config/[id]/verify-registration`.

**Pendiente / siguiente paso:** Nada de esto se aplicó ni se desplegó a
producción — falta, en orden: (1) aplicar `050_multiple_whatsapp_numbers.sql`
contra `puvbwzwmojpjplhdfnmk` (revisar con `list_migrations` el estado
remoto primero; considerar una rama de Supabase dado que cambia el índice
único de `conversations`, aunque el riesgo es bajo con las 2 empresas reales
actuales), (2) `get_advisors` después de aplicar, (3) publicar el código y
validar en producción agregando un segundo número de prueba en una cuenta,
confirmando que ambas conexiones aparecen, marcando una como predeterminada,
y (si es posible sin usar un número de un tercero) confirmando que mensajes
entrantes a cada número caen en conversaciones separadas. Después de validar,
abrir la planificación del Bloque 2 (webhooks firmados por empresa + eventos
comerciales ampliados + reintentos/log/desactivación + diseño n8n para
Calendar/Meet/cotizaciones/correo/recordatorios).

**Notas:** No se borró ni revirtió código existente.
`src/lib/probe_delete_test.txt` permanece intacto y fuera de los cambios. No
se modificaron datos reales ni configuraciones de canales — todo el trabajo
de esta sesión es local, sin tocar el proyecto Supabase real.

### 2026-08-15 — Claude Code (Bloque 1: migración aplicada y código publicado)

**Hecho:** Con confirmación explícita de Angel, verifiqué el estado remoto
real antes de tocar nada (`list_migrations` no es confiable para este
proyecto — varias migraciones de sesiones anteriores se aplicaron por SQL
Editor y no quedaron registradas ahí; verifiqué directamente por
`information_schema` que 043–049 sí están aplicadas). Confirmé que la cuenta
real tenía solo 1 fila de `whatsapp_config`, 2 `accounts`, 6 `conversations`,
0 `message_templates` y 0 `broadcasts` — volumen mínimo, riesgo bajo, no
hizo falta una rama de Supabase. Apliqué
`050_multiple_whatsapp_numbers.sql` contra `puvbwzwmojpjplhdfnmk` vía MCP de
Supabase. Publiqué el commit `b2c10b1` en `origin/main`.

**Probado:** Tras aplicar, verifiqué por SQL que la fila existente de
`whatsapp_config` quedó marcada `is_default = true`; que el índice nuevo
`idx_conversations_account_contact_config` reemplazó al de la migración 036;
que el índice nuevo de plantillas `message_templates_config_name_language_key`
existe; que el `UNIQUE(account_id)` viejo de `whatsapp_config` ya no existe;
y que solo las 2 conversaciones de canal `whatsapp` recibieron
`whatsapp_config_id` (las de Instagram/Facebook quedaron sin tocar, como
correspondía). `get_advisors` (seguridad) no reportó ningún hallazgo nuevo —
todo lo listado ya existía antes de este bloque, y `create_broadcast_with_recipients`
no aparece entre las funciones ejecutables por `anon`/`authenticated`,
confirmando que el `REVOKE`/`GRANT` de la migración quedó correcto.

**Pendiente / siguiente paso:** No tengo forma de verificar por mi cuenta
que el despliegue automático de EasyPanel terminó ni de navegar a la URL
productiva (no hay herramienta de navegador ni acceso a EasyPanel en esta
sesión) — Angel debe confirmar que el deploy terminó y, si quiere, validar
agregando un segundo número de WhatsApp de prueba a una cuenta real:
confirmar que ambas conexiones aparecen en Configuración, marcar una como
predeterminada, y (sin usar un número de un tercero sin autorización)
confirmar que un mensaje entrante a cada número cae en una conversación
separada. Después de esa validación, este bloque queda cerrado y se abre la
planificación del Bloque 2 (webhooks firmados por empresa + eventos
comerciales ampliados + reintentos/log/desactivación + diseño n8n para
Calendar/Meet/cotizaciones/correo/recordatorios).

**Notas:** No se modificaron filas de negocio reales más allá del backfill
propio de la migración (marcar la conexión existente como predeterminada y
vincular las 2 conversaciones de WhatsApp existentes a ella — reversible,
documentado en el archivo de migración). `src/lib/probe_delete_test.txt`
permanece intacto y fuera del commit.

### 2026-08-16 — Claude Code (Bloque 1: deploy confirmado)

**Hecho:** El primer intento de deploy en EasyPanel para `b2c10b1` quedó
`CANCELED` a los 60s ("context canceled") — causado por haber publicado dos
commits seguidos (`b2c10b1` y el de bitácora `721a604`), cuyo segundo push
disparó un nuevo deploy que canceló al primero a medio construir. Angel
confirmó por el log que no fue un fallo de código (el build local ya había
terminado limpio), y disparó manualmente un redeploy del commit más
reciente sin más pushes de por medio.

**Probado:** Angel confirmó que ese redeploy terminó en verde (éxito) en el
historial de EasyPanel.

**Estado del Bloque 1:** Migración `050` aplicada y verificada en Supabase,
código en `origin/main`, deploy en producción confirmado en verde. Falta
solo la validación funcional en la app en vivo (agregar un segundo número,
confirmarlo en la lista, marcarlo predeterminado) — pendiente de que Angel
la haga cuando le convenga, no bloquea dar el bloque por desplegado.

**Pendiente / siguiente paso:** Abrir la planificación del Bloque 2
(webhooks firmados por empresa + eventos comerciales ampliados +
reintentos/log/desactivación + diseño n8n para
Calendar/Meet/cotizaciones/correo/recordatorios) cuando Angel confirme que
quiere continuar.

**Notas:** No se modificaron datos reales en esta sesión. Ninguna acción
destructiva — el "cancelado" del primer intento fue responsabilidad de
EasyPanel al recibir un segundo push, no de un `git push --force` ni de
ningún comando destructivo.

### 2026-08-16 — Claude Code (Bloque 2: webhooks empresariales + n8n, código completo)

**Hecho:** Investigué el sistema de webhooks existente
(`src/lib/webhooks/{endpoints,deliver,events,sign,ssrf}.ts`, migración 028)
y confirmé que ya era sólido (secreto HMAC cifrado por endpoint — ya
"independiente por empresa" —, guarda SSRF, auto-desactivación) pero sin
tabla de log de entregas, sin reintentos, y sin UI de Settings. También
encontré un hallazgo clave: casi todas las mutaciones humanas relevantes
(mover un negocio en el Kanban, cerrar conversación desde el inbox,
crear/editar contacto, cambiar temperatura) se hacían con escritura directa
del navegador a Supabase — imposible disparar un webhook desde ahí. Con
confirmación explícita de Angel, moví esas 4 mutaciones a rutas de servidor
y agregué `pipeline_stages.is_won` ("Venta cerrada", no "Ganado") con una
plantilla de pipeline por defecto nueva (Cliente reciente → Cotización →
Convencimiento → Venta cerrada) para las cuentas nuevas.

- Migración `051_webhook_deliveries_and_deal_won.sql` (todavía sin
  aplicar): `pipeline_stages.is_won`; tabla nueva `webhook_deliveries` con
  RLS de solo lectura para miembros de la cuenta, escritura solo por
  `service_role`.
- `src/lib/webhooks/deliver.ts` reescrito: cada intento se registra en
  `webhook_deliveries`; un fallo agenda reintento con backoff exponencial
  (1 min → 5 min → 30 min, tope 3 reintentos) vía `next_retry_at`, y al
  agotarse se marca `failed`. El `failure_count` del endpoint (y su
  auto-desactivación) se sigue incrementando en cada intento fallido, sin
  cambios de comportamiento ahí. Nuevo `GET /api/webhooks/cron` (mismo
  patrón que `automations/cron`, secreto compartido `WEBHOOK_CRON_SECRET`)
  drena los reintentos vencidos.
- Catálogo de eventos ampliado (`src/lib/webhooks/events.ts`):
  `deal.won`, `deal.stage_changed`, `contact.created`,
  `contact.lead_temperature_changed`, `conversation.closed`,
  `broadcast.completed`, agregados a los 3 que ya existían.
- Nuevo helper compartido `src/lib/pipelines/move-deal.ts` (`moveDeal`),
  usado tanto por la acción de IA (`business-actions.ts`) como por la
  ruta nueva `PATCH /api/deals/[id]/stage` — valida pertenencia de la
  etapa a la cuenta y pone `status='won'` cuando la etapa es `is_won`.
- Rutas nuevas: `PATCH /api/deals/[id]/stage`,
  `PATCH /api/conversations/[id]/status`, `POST /api/contacts`,
  `PATCH /api/contacts/[id]` — reemplazan las escrituras directas del
  cliente en `pipelines/page.tsx`, `message-thread.tsx`, `contact-form.tsx`
  y `contact-detail-view.tsx`, conservando la actualización optimista de
  la UI.
- Gestión de webhooks en Settings: `src/app/api/account/webhooks/**`
  (lista/crear/editar/eliminar/log de entregas/reintentar ahora, mismo
  patrón de sesión que `account/api-keys`, reutilizando los helpers de
  `src/lib/webhooks/{endpoints,events}.ts`) + nuevo
  `src/components/settings/webhooks-settings.tsx` (nueva pestaña
  "Webhooks" en Configuración).
- Diseño de integración con n8n: sin código nuevo — n8n consume el
  sistema de webhooks ya reforzado con su propio nodo Webhook, verificando
  `X-Wacrm-Signature`. Calendar/Meet/cotizaciones/correo/recordatorios se
  resuelven dentro de los workflows de n8n, no dentro de Chat Sandía; el
  CRM sigue siendo la fuente de datos, permisos, confirmaciones y
  auditoría.

**Probado:** `npm run typecheck` limpio. `npm test`: 860 pruebas, 858
pasan (las 2 fallas restantes son las de `mondayIndex` ya documentadas
como preexistentes, sin relación). Pruebas nuevas:
`src/lib/webhooks/deliver.test.ts` (extendido con reintentos/backoff/log),
`src/lib/pipelines/move-deal.test.ts`,
`src/app/api/account/webhooks/route.test.ts` (aislamiento multiempresa +
control de admin, mismo patrón que el Bloque 1). `npm run build` generó 63
rutas sin errores, incluyendo todas las rutas nuevas.

**Pendiente / siguiente paso:** Nada de esto se aplicó ni se desplegó a
producción — falta, en el mismo orden que el Bloque 1: (1) aplicar
`051_webhook_deliveries_and_deal_won.sql` contra `puvbwzwmojpjplhdfnmk`
(volumen de datos real es mínimo, riesgo bajo), (2) `get_advisors`
después de aplicar, (3) configurar `WEBHOOK_CRON_SECRET` en el entorno de
producción (EasyPanel) y un disparador periódico (cron externo o Vercel
Cron) apuntando a `GET /api/webhooks/cron` con el header
`x-cron-secret` — sin esto los reintentos nunca se procesan, solo el
primer intento inline sigue funcionando, (4) publicar el código en un solo
push (evitar el problema de builds cancelados del Bloque 1) y validar en
producción: crear un webhook de prueba, mover un negocio a "Venta
cerrada", cerrar una conversación, confirmar que las entregas aparecen en
el log con firma válida. Después de validar, abrir la planificación del
Bloque 3 (acciones de IA en interfaz conversacional).

**Notas:** No se borró ni revirtió código existente.
`src/lib/probe_delete_test.txt` permanece intacto y fuera de los cambios.

### 2026-08-16 — Claude Code (Bloque 2: migración, cron y código publicados)

**Hecho:** Con confirmación de Angel, apliqué `051_webhook_deliveries_and_deal_won.sql`
contra `puvbwzwmojpjplhdfnmk` (volumen real mínimo: 5 etapas de pipeline, 0
webhooks, 0 negocios — riesgo bajo). Habilité las extensiones `pg_cron` y
`pg_net` en el proyecto y programé el job `webhook-retry-sweep` (cada 5
minutos) que llama `GET https://sandia-sandia-crm.kmencc.easypanel.host/api/webhooks/cron`
con el header `x-cron-secret` — usando la URL pública de EasyPanel, no la
dirección interna de Docker (`http://sandia_sandia_crm:80/`, que Supabase no
puede alcanzar). El secreto se generó con `crypto.randomBytes(32)` y se
programó vía `execute_sql` (no `apply_migration`) para no dejarlo persistido
en el historial de migraciones ni en ningún archivo del repo. Publiqué el
commit `0213ece` en `origin/main` en un solo push (evitando el problema de
builds cancelados del Bloque 1).

**Probado:** Verifiqué por SQL que `pipeline_stages.is_won` y
`webhook_deliveries` existen tras la migración. `get_advisors` no reportó
hallazgos nuevos. El job de `cron.schedule` se registró (`schedule: 1`).

**Pendiente / siguiente paso — requiere que Angel lo haga manualmente:**
1. Agregar la variable de entorno `WEBHOOK_CRON_SECRET` en EasyPanel (servicio
   `sandia_sandia_crm`) con el mismo valor generado en esta sesión, y
   reiniciar/redeploy el servicio para que la tome.
2. Confirmar que el deploy de `0213ece` terminó en verde en EasyPanel.
3. Validar en producción: en Configuración → Webhooks, crear un endpoint de
   prueba; mover un negocio a la etapa "Venta cerrada" y confirmar que llega
   `deal.won`; cerrar una conversación desde el inbox y confirmar
   `conversation.closed`; revisar que el log de entregas muestre las firmas
   correctas. Después de validar, este bloque queda cerrado y se abre la
   planificación del Bloque 3 (acciones de IA en interfaz conversacional).

**Notas:** No se modificaron filas de negocio reales — el único cambio de
datos fue el backfill aditivo propio de la migración
(`pipeline_stages.is_won` default `false`, sin afectar etapas existentes).
`src/lib/probe_delete_test.txt` permanece intacto y fuera del commit.

### 2026-08-16 — Claude Code (Bloque 2: cron confirmado extremo a extremo)

**Hecho:** Angel agregó `WEBHOOK_CRON_SECRET` en EasyPanel y confirmó el
deploy terminado. Verifiqué el pipeline completo por SQL contra el proyecto
real: `GET /api/webhooks/cron` sin encabezado devolvió `401 Unauthorized`
(confirma que la variable ya está configurada — `503` habría significado que
faltaba), y las últimas 5 ejecuciones de `cron.job_run_details` más
`net._http_response` muestran `status_code 200` con `{"processed":0}` cada 5
minutos — el cron de Supabase le pega correctamente a producción con el
secreto correcto; "0" es esperado porque todavía no hay ninguna entrega
pendiente de reintento.

**Pendiente / siguiente paso:** Falta únicamente la validación funcional
manual en la app (crear un webhook de prueba en Configuración → Webhooks,
mover un negocio a "Venta cerrada", cerrar una conversación, revisar el log
de entregas) — pendiente de que Angel la haga cuando le convenga; no bloquea
dar el bloque por desplegado, ya que la infraestructura de entrega y
reintentos quedó confirmada extremo a extremo. Después de esa validación,
abrir la planificación del Bloque 3 (acciones de IA en interfaz
conversacional).

### 2026-08-16 — Claude Code (corrección de seguridad: fuga de perfiles entre empresas)

**Hecho:** Angel reportó en producción que la empresa de David Emanuel
aparecía en el menú "Assign" (asignar chat a un miembro) de su propia
cuenta, pese a que David es dueño de una empresa afiliada totalmente
separada, no miembro de la organización de Angel. Investigué y confirmé la
causa raíz: la migración 043 (panel de plataforma) agregó una política RLS
aditiva `platform_admin_profiles_select` que permite a cualquier
`is_platform_admin` leer **todas** las filas de `profiles` sin importar
`account_id` — correcta y necesaria para el panel `/admin`, pero dos
consultas de UI (`src/components/inbox/message-thread.tsx`, el selector
"Assign"; `src/components/pipelines/deal-form.tsx`, el selector de
responsable de un negocio) hacían `supabase.from("profiles").select("*")`
**sin filtrar explícitamente por `account_id`**, confiando únicamente en
RLS para acotar el resultado — válido para un miembro normal (cuya política
RLS sí es por cuenta) pero no para Angel, cuya sesión de platform admin ve
todas las filas por la política aditiva. Agregué `.eq("account_id",
accountId)` explícito en ambos lugares (defensa en profundidad, mismo
principio que ya usa el resto del proyecto de no confiar solo en RLS).
Barrí el resto de `src/components` y `src/app/api` buscando el mismo patrón
— ningún otro selector de miembros tenía el problema (el resto ya filtraba
por `account_id`/`user_id`, o usa la ruta ya segura `/api/account/members`).

**Probado:** `npm run typecheck`, `npm test` (858/860, mismas 2 fallas
preexistentes de zona horaria) y `npm run build` limpios.

**Pendiente / siguiente paso:** Publicar este fix cuanto antes dado que es
una corrección de seguridad activa en producción (aunque de severidad baja
— solo expone qué usuarios existen en otras empresas dentro de un dropdown,
no conversaciones ni datos de negocio — vale la pena cerrarla ya). Después,
retomar la validación pendiente del Bloque 2 y abrir el Bloque 3.

**Notas:** No se modificaron datos reales. `src/lib/probe_delete_test.txt`
permanece intacto y fuera del commit.

**Deploy confirmado:** Angel confirmó el build en verde para `57352d9` en
EasyPanel (build completo, 63 rutas, `Success`) y confirmó en la app que el
menú "Assign" ya no muestra la empresa de David Emanuel. Corrección cerrada
y verificada de punta a punta.

### 2026-08-16 — Claude Code (Bloque 3: acciones de IA — código completo, migración 052 aplicada)

**Hecho:** Implementé el Bloque 3 completo según la planificación aprobada
(botones manuales, sugerencia a pedido, cierre autónomo de venta, y
reasignación por tiempo):

1. **Consistencia de "marcar venta ganada":** `mark_deal_won` en
   `src/lib/ai/business-actions.ts` ahora resuelve la etapa `is_won` de la
   pipeline del negocio y usa `moveDeal()` (mismo camino que el Kanban),
   con respaldo al status directo si la pipeline no tiene ninguna etapa
   marcada `is_won`.
2. **Nueva acción `set_lead_temperature`:** cuarta acción de IA, escribe
   `contacts.lead_temperature`, auditada en `ai_action_log` como las demás
   (con confirmación, no autónoma).
3. **Panel de acciones manuales en el Inbox:** `src/components/inbox/contact-sidebar.tsx`
   ahora permite, por cada negocio del contacto: marcar "Venta cerrada" (con
   diálogo de confirmación), mover a otra etapa (`Select`), y cambiar la
   temperatura del lead (`Select` + `LeadTemperatureBadge`) — todo sobre
   las rutas `PATCH /api/deals/[id]/stage` y `PATCH /api/contacts/[id]` ya
   existentes del Bloque 2.
4. **Botón "¿Qué sugieres?"** junto al de redactar con IA
   (`src/components/inbox/message-composer.tsx`): llama a la nueva
   `POST /api/ai/suggest-action`, que analiza la conversación + negocios
   abiertos del contacto y devuelve una de las 4 acciones (o ninguna) en
   JSON estricto. La tarjeta de sugerencia encadena las dos llamadas de
   confirmación de `POST /api/ai/actions` de forma transparente.
5. **Cierre autónomo de venta (sin confirmación):** nuevo sentinel
   `[[ACTION:mark_deal_won]]` que el modo `auto_reply` puede emitir cuando
   el cliente confirma expresamente la compra (`src/lib/ai/defaults.ts`,
   `src/lib/ai/generate.ts`). `src/lib/ai/auto-reply.ts` lo detecta después
   de enviar la respuesta al cliente, resuelve el negocio abierto más
   reciente del contacto, mueve la etapa vía `moveDeal()` y registra en
   `ai_action_log` con `input.source: "auto_reply_autonomous"` — sin pasar
   por el flujo de confirmación humana, decisión explícita de Angel. Un
   fallo aquí nunca afecta el envío del mensaje (corre después, con su
   propio try/catch).
6. **Reasignación automática por tiempo:** nueva columna
   `ai_configs.unclaimed_conversation_timeout_minutes` (default 10,
   configurable 1-1440 en Configuración → Agentes IA). Nuevo
   `GET /api/conversations/cron` (`src/lib/conversations/reassign.ts` +
   `src/lib/conversations/admin-client.ts`), mismo patrón de secreto
   (`CONVERSATIONS_CRON_SECRET` vía `x-cron-secret`) que los otros 3 cron.
   Asigna conversaciones abiertas sin asesor que superaron el timeout de su
   cuenta al asesor disponible (`member_presence` online, no obsoleto) con
   menos conversaciones abiertas asignadas; si nadie está en línea, no
   asigna y lo deja para el siguiente barrido.
7. **Migración `052_ai_action_temperature_and_conversation_sla.sql`** —
   aplicada contra `puvbwzwmojpjplhdfnmk`: extiende el CHECK de
   `ai_action_log.action`, agrega la columna de timeout con su rango, e
   índice parcial en `conversations` para el barrido.
8. **`.env.local.example`** documentado con `CONVERSATIONS_CRON_SECRET` y,
   retroactivamente, `WEBHOOK_CRON_SECRET` (nunca se había documentado ahí).

**Probado:** `npm run typecheck`, `npx eslint .` (0 errores, mismos
warnings preexistentes) y `npm run build` limpios (67 rutas, incluye
`/api/ai/suggest-action` y `/api/conversations/cron`). `npx vitest run`:
888/890 (mismas 2 fallas preexistentes de zona horaria en
`date-utils.test.ts`, ajenas a este bloque). Tests nuevos: 14 en
`business-actions.test.ts`, 9 en `reassign.test.ts`, 5 nuevos en
`auto-reply.test.ts` (camino autónomo), extensiones en `generate.test.ts`
para el nuevo sentinel — todos verifican explícitamente el filtro
`account_id` en las consultas (mismo principio que la corrección de
seguridad anterior). `get_advisors` tras aplicar la migración 052 no
reportó hallazgos nuevos.

**Pendiente / siguiente paso — requiere que Angel lo haga manualmente:**
1. Agregar la variable `CONVERSATIONS_CRON_SECRET` en EasyPanel (mismo
   procedimiento que `WEBHOOK_CRON_SECRET` en el Bloque 2).
2. Decidir si programar ahora un job `pg_cron` adicional apuntando a
   `GET /api/conversations/cron` (sugerido: cada 5 minutos, igual que el
   de webhooks) o dejarlo para después — no se activó automáticamente.
3. Confirmar el deploy en EasyPanel una vez publicado (un solo push).
4. Validación funcional en producción: probar el panel de acciones
   manuales en un chat real, el botón "¿Qué sugieres?", y —
   opcionalmente, con cautela dado que es la pieza de mayor riesgo del
   bloque — una conversación de prueba donde el cliente confirme una
   compra, para revisar que `ai_action_log` registre la entrada con
   `input.source: "auto_reply_autonomous"` correctamente.
5. Después de validar, retomar: la validación manual pendiente del
   Bloque 2 (webhook.site), y abrir la planificación de Catálogo +
   Cotizaciones (propuesta por Claude, aceptada por Angel, aún sin
   iniciar) y los Bloques 4 (i18n español) y 5 (CSP + rate limits).

**Notas:** No se modificaron datos reales — la migración 052 es puramente
aditiva. `src/lib/probe_delete_test.txt` permanece intacto y fuera de los
cambios.

### 2026-08-16 — Claude Code (Catálogo de productos + Cotizaciones)

**Hecho:** Angel pidió adelantar el Catálogo + Cotizaciones (pospuesto desde
el inicio de la sesión) antes de retomar lo pendiente del Bloque 3. Aclaré
alcance con Angel en dos rondas de preguntas y construí el dominio "commerce"
completo:

1. **Prerrequisitos cross-canal:** `Conversation.channel` y la prop
   `channel` del composer estaban tipadas solo `whatsapp|instagram` pese a
   que la base de datos acepta `facebook` desde la migración 041 — se
   amplió el tipo y se corrigió el gating de plantillas/mensaje interactivo
   para Facebook también. Los envíos de documento por Instagram y Facebook
   perdían el caption/filename (Instagram vía Meta directo no lo soporta a
   nivel de plataforma — se documentó, no se puede arreglar; vía Zernio sí
   se corrigió, igual que Facebook, que siempre pasa por Zernio).
2. **Esquema (migración `053_product_catalog_and_quotes.sql`):**
   `products`, `quotes`, `quote_items` (mismo patrón de RLS que
   `quick_replies`: lectura para cualquier miembro, escritura `agent+`),
   más el CHECK de `ai_action_log.action` extendido con `create_quote`, y
   dos buckets de Storage nuevos (`product-media` para imágenes de
   producto, `catalog-documents` para PDFs generados server-side).
3. **Generación de PDF:** se agregó `@react-pdf/renderer` (no había
   ninguna librería de PDF en el proyecto) — plantillas para el PDF de una
   cotización y del catálogo completo.
4. **Núcleo compartido `src/lib/quotes/create-quote.ts`:** valida los 4
   datos del cliente (NIT/correo/celular/dirección), relee siempre el
   precio de `products` para un ítem de catálogo (nunca confía en un
   precio que mande el llamador), acepta ítems libres solo cuando
   `allowFreeItems` es `true`, y crea automáticamente un negocio (deal)
   vinculado en la pipeline de la cuenta.
5. **Dos formas de crear una cotización:** un humano vía
   `POST /api/quotes` (permite ítems libres) y la IA vía la nueva acción
   `create_quote` en `business-actions.ts` (`allowFreeItems: false` —
   la IA solo puede cotizar productos que existen en el catálogo,
   reforzado server-side, no solo en el prompt; con confirmación
   obligatoria como `set_lead_temperature`, no autónoma).
6. **Rutas nuevas:** `/api/products` (+ `[id]`), `/api/quotes` (+ `[id]`,
   `[id]/pdf`, `[id]/send`), `/api/products/send-catalog` — el envío de
   cotización/catálogo reutiliza el envío channel-agnóstico ya existente
   (`sendMessageToConversation`), sin escribir despacho por canal nuevo.
7. **Permisos:** nueva capacidad `manage-products` (`useCan`/`roles.ts`)
   en `agent+` — Administradores y Asesores, por decisión de Angel.
8. **Moneda:** se agregó GTQ (Quetzal) a `CURRENCIES`
   (`src/lib/currency.ts`) — no estaba, pese a que Sandía es para
   Guatemala.
9. **Interfaz:** nueva página `/products` ("Productos") en el menú
   principal con pestañas Productos/Cotizaciones; armador de cotización
   (`quote-builder.tsx`) reutilizable desde ahí y desde
   `contact-sidebar.tsx` (nueva sección "Cotizaciones" por contacto, igual
   que la de "Active Deals" del Bloque 3); opción "Enviar catálogo" en el
   menú `+` del composer del inbox.
10. **Evento de webhook nuevo:** `quote.created`, agregado al catálogo ya
    existente (Bloque 2).

**Probado:** `npm run typecheck`, `npx eslint .` (0 errores, mismos
warnings preexistentes) y `npm run build` limpios (73 rutas, incluye
`/products` y todas las rutas de `/api/products`/`/api/quotes`).
`npx vitest run`: 907/909 (mismas 2 fallas preexistentes de zona horaria en
`date-utils.test.ts`, ajenas a este trabajo). Pruebas nuevas: 13 en
`create-quote.test.ts` (incluye la garantía de que la IA nunca puede crear
un ítem libre ni alterar el precio de un producto del catálogo), 4 en
`quote-pdf.test.ts`/`catalog-pdf.test.ts` (humo — el PDF generado empieza
con la cabecera `%PDF-`), 2 nuevas en `business-actions.test.ts` para
`create_quote`. Migración 053 aplicada contra `puvbwzwmojpjplhdfnmk`;
`get_advisors` no reportó hallazgos nuevos.

**Pendiente / siguiente paso:** Publicar (un solo push) y confirmar el
deploy en EasyPanel. Después, retomar lo que quedó pausado del Bloque 3
(programar el `pg_cron` de `/api/conversations/cron` y la validación
manual), la validación pendiente del Bloque 2, y los Bloques 4 (i18n
español) y 5 (CSP + rate limits).

**Notas:** No se modificaron datos reales — la migración 053 es puramente
aditiva. `src/lib/probe_delete_test.txt` permanece intacto y fuera de los
cambios.

**Deploy confirmado (con un bache en el camino):** El primer intento de
deploy (`73b042a`) falló en `npm ci` dentro de Docker con
`Missing: @swc/helpers@0.5.23 from lock file` — una inconsistencia
preexistente en `package-lock.json` (una dependencia anidada opcional de
`next-intl` nunca quedó registrada), que solo la versión de npm que usa la
imagen `node:20-alpine` de EasyPanel (10.8.2) detecta; mi npm local (11.x)
la toleraba en silencio. Reproduje el build exacto con Docker localmente
(`node:20-alpine`), regeneré `package-lock.json` dentro de ese mismo
contenedor, y confirmé `npm ci` limpio antes de publicar el fix
(`692d30c`). Angel confirmó el segundo deploy en verde (~22 minutos).
Verifiqué `GET /api/products` en producción → `401` (requiere sesión, no
error de servidor), confirmando que el deploy quedó sano.

**Lección para próximas sesiones:** antes de dar un `npm install` por
bueno para producción, vale la pena correr `npm ci` dentro de
`node:20-alpine` (Docker) para adelantarse a este tipo de discrepancia
entre versiones de npm — no solo confiar en que pasó localmente.

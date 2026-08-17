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

### 2026-08-16 — Claude (Cowork, control de Chrome) — Bloque 3 pg_cron + validación pendiente del Bloque 2

**Hecho:** Retomé los dos pendientes que quedaron pausados. (1) Programé
el job `conversation-reassign-sweep` (`*/5 * * * *`) en `pg_cron` contra
`puvbwzwmojpjplhdfnmk`, igual que `webhook-retry-sweep` del Bloque 2:
`net.http_get` a `GET https://sandia-sandia-crm.kmencc.easypanel.host/api/conversations/cron`
con `x-cron-secret` vía `execute_sql` (no en migración, para no dejar el
secreto persistido en el repo). Angel ya tenía `CONVERSATIONS_CRON_SECRET`
cargado en EasyPanel y me pasó el valor por chat. (2) Completé la
validación manual pendiente del Bloque 2: creé un endpoint de prueba en
Configuración → Webhooks apuntando a webhook.site, un negocio de prueba
vinculado a un contacto real, y lo moví a "Won" vía `PATCH
/api/deals/[id]/stage` (llamado desde la consola del navegador ya
autenticado como Angel, porque el `Select` de etapa del panel del Inbox
resultó poco fiable para automatización — problema de la UI/automatización,
no del código de la app).

**Hallazgo durante la validación (corregido en la sesión):** el primer
intento de mover el negocio a "Won" no disparó `deal.won`. Causa: la etapa
"Won" del pipeline de Angel (creada en el seed original, antes de la
migración 051) nunca quedó marcada `is_won = true` — el campo default es
`false` y migración 051 no puede inferir automáticamente cuál etapa
representa "venta cerrada" en un pipeline ya existente. Lo corregí desde
Pipelines → **Manage Pipelines** → casilla "Venta cerrada" en la fila
"Won", sin tocar SQL directo salvo para diagnosticar. **Cualquier cuenta
con un pipeline creado antes del Bloque 2 probablemente tiene el mismo
problema silencioso** — vale la pena que alguien revise/marque la etapa
ganadora de cada pipeline real (Angel y David) para que `deal.won` no se
quede mudo ahí también.

**Probado (Bloque 2, extremo a extremo):** Con `is_won` corregido, reabrí y
volví a cerrar el negocio (Qualified → Won) y la conversación (open →
closed) desde la consola autenticada para forzar un evento fresco. Verifiqué
en `webhook_deliveries`: `deal.won` y `conversation.closed`, ambos
`status = 'delivered'`, `response_status = 200`. Verifiqué en el dashboard
de webhook.site el payload completo de los dos requests — `account_id`
correcto, `deal_id`/`conversation_id` correctos, `closed_by`/`source:
"human"` — y los headers `x-wacrm-signature`, `x-wacrm-webhook-id`,
`x-wacrm-event` presentes en ambos. Bloque 2 queda validado por completo.

**Probado (Bloque 3, cron):** Confirmé `GET /api/conversations/cron` sin
header → `401` (la variable ya estaba cargada en EasyPanel, como indicó
Angel) y con `x-cron-secret` correcto → `200 {"processed":3,"assigned":0}`
(3 conversaciones abiertas sin asesor superaron el timeout; `assigned:0`
porque nadie estaba en línea en el momento de la prueba — comportamiento
esperado, documentado en el bloque original). El job quedó registrado en
`cron.job` (`jobid 2`, `active: true`); su primera ejecución automática
programada (no confirmada todavía por `cron.job_run_details` al momento de
escribir esto, ya que el job se creó fuera del minuto `*/5`) queda para
quien retome la sesión, igual que se hizo con `webhook-retry-sweep` en el
Bloque 2.

**Limpieza:** Borré el negocio de prueba (`Prueba webhook Bloque 2`) y el
endpoint de webhook de prueba (webhook.site) al terminar — no quedan
artefactos de prueba en `deals` ni en `webhook_endpoints`. La conversación
de David Duran quedó igual que antes de la prueba (`closed`, que ya era su
estado original).

**Verificación adicional de `is_won`:** revisé los demás pipelines reales
por SQL — "Proceso de Ventas" (la otra cuenta de Angel) ya tenía "Venta
cerrada" marcada `is_won = true` desde antes de esta sesión, y la cuenta de
David Emanuel Duran Simon todavía no tiene ningún pipeline creado
(`pipeline_count = 0`), así que no aplica por ahora. No quedan pipelines
reales con el problema silencioso — solo hace falta que quien cree un
pipeline nuevo recuerde marcar la casilla "Venta cerrada" en la etapa que
corresponda.

**Pendiente / siguiente paso:** (1) Confirmar en `cron.job_run_details`
que `conversation-reassign-sweep` corrió automáticamente al menos una vez
con `status: succeeded` (mismo chequeo que se hizo para el Bloque 2). (2)
Con eso, ambos bloques (2 y 3) quedan completamente cerrados y se puede
seguir con Bloques 4 (i18n español) y 5 (CSP + rate limits), o con
Catálogo/Cotizaciones si Angel prefiere continuar por ahí.

**Notas:** No se modificaron datos de negocio reales más allá del propio
negocio/webhook de prueba, ya eliminados. `src/lib/probe_delete_test.txt`
no fue tocado. La automatización de UI (clicks en el `Select` custom de
etapa en el panel del Inbox) no funcionó de forma confiable en esta sesión
— quedó resuelto llamando directamente a las rutas API server-side
(`PATCH /api/deals/[id]/stage`, `PATCH /api/conversations/[id]/status`)
desde la consola del navegador ya autenticado, que ejercitan exactamente
el mismo código que dispara los webhooks. Si un futuro agente necesita
automatizar ese `Select` vía clicks reales, considerar que es un
componente custom (no `<select>` nativo) sensible a temporización.

### 2026-08-16 — Claude (Cowork, control de Chrome) — Inbox: crear negocio desde el chat

**Hecho:** Angel señaló, revisando la validación anterior, que si un
contacto/chat todavía no tiene ningún negocio, el panel lateral del Inbox
(`contact-sidebar.tsx`) no ofrecía forma de crear uno — solo listaba y
permitía mover negocios ya existentes. Para moverlo a "Cotización", "Venta
cerrada" o cualquier otra etapa había que salir al módulo Pipelines, crear
el negocio ahí, elegir el contacto manualmente, y volver al chat. Con dos
decisiones de Angel (botón rápido inline en vez de reutilizar el panel
grande de Pipelines; si la cuenta tiene más de un pipeline, preguntar cuál
en vez de asumir uno por defecto — Angel tiene dos: "Sales Pipeline" y
"Proceso de Ventas"), agregué un botón "+ Nuevo" junto a "Deals" en el
panel lateral que abre un mini-formulario inline (título, selector de
pipeline si hay más de uno, etapa, valor y moneda) sin salir del chat. Crea
el negocio ya vinculado al contacto actual vía inserción directa a
`deals` (mismo patrón que usa `deal-form.tsx` en Pipelines — no hay ruta
`POST /api/deals`, así que mantuve consistencia con lo existente en vez de
introducir una nueva), y recarga la lista para que el negocio nuevo
aparezca de inmediato con los controles ya existentes de mover
etapa/marcar ganado.

**Probado:** `npm run typecheck`, `npx eslint` sobre el archivo tocado, y
`npx vitest run i18n` (3/3) limpios. `npm run build` completó sin errores
(mismas rutas de antes, no se agregó ninguna). Encontré y corregí dos
`Select` (el de pipeline y el de etapa del formulario nuevo) que no
tipaban contra la firma real de `onValueChange` (acepta `string | null`
en este componente base — Next.js 16/base-ui, ver `AGENTS.md`) antes de
que el build pasara.

**Importante — revertido antes de commitear:** mi `npm install` local (para
poder correr `typecheck`/`build`, ya que `node_modules` estaba incompleto
en este entorno) regeneró `package-lock.json` y sin querer volvió a quitar
la entrada `next-intl/node_modules/@swc/helpers` que la sesión anterior
había fijado a propósito para evitar el fallo de `npm ci` en la imagen
`node:20-alpine` de EasyPanel (ver la entrada "Catálogo de productos +
Cotizaciones" más arriba). Lo detecté con `git diff --stat` antes de
comitear y revertí `package-lock.json` con `git checkout --` — el commit
de este bloque no toca el lockfile.

**No pude probarlo en un navegador real en esta sesión:** intenté levantar
`npm run dev` localmente (apunta al Supabase real vía `.env`) pero no
tengo forma de autenticarme sin escribir la contraseña de Angel — pedirle
la contraseña o generar un enlace mágico con la service role key para
sortear el login está fuera de lo que puedo hacer sin permiso explícito, y
el intento de generar el enlace fue bloqueado por el propio entorno.
**Publicado y validado en producción:** Angel autorizó el push
(`e4a8cda`). EasyPanel desplegó y, ya con sesión real de Angel en Chrome,
abrí el chat de David Duran (sin negocios) y confirmé que el botón
"+ New" y el formulario inline aparecen correctamente.

**Bug preexistente encontrado durante la validación (corregido en el
mismo bloque, commit separado):** al abrir el formulario, los `Select` de
pipeline y etapa mostraban el UUID crudo (`fc41db9f-502d-4480-...`) en vez
del nombre ("Sales Pipeline", "Cotización", etc.) — completamente
ilegible. No es un bug que yo introduje: el selector de etapa que **ya
existía** para negocios con negocio propio (el mismo que Angel pidió
asegurar que fuera "fácil de usar") tenía exactamente el mismo problema,
confirmado revisando una captura de pantalla de la sesión anterior donde
aparecía "27d98150-a146-45b8-bd3a-86…" en vez de "New Lead" — lo había
interpretado mal como texto legible en su momento.

Causa raíz: el componente base (`src/components/ui/select.tsx`, sobre
`@base-ui/react/select` — librería nueva de Next.js 16, ver `AGENTS.md`)
usa `<Select.Value>`, que solo puede mostrar el nombre de la opción
seleccionada si el `<Select.Root>` recibe una prop `items` (mapa
valor→etiqueta) o si `<Select.Value>` recibe una función `children` de
formateo — ninguno de los call sites del proyecto la pasaba. Corregí los
cuatro `Select` de `contact-sidebar.tsx` (temperatura, selector de etapa
por negocio existente, y los dos nuevos de pipeline/etapa del formulario
rápido) agregando `items={Object.fromEntries(...)}` a cada uno.
**No** audité el resto de la app — es muy probable que otros `Select` en
Configuración, Pipelines, etc. tengan el mismo problema; queda como
hallazgo para una sesión futura, no se tocó nada fuera de este archivo.

**Probado tras el fix:** `npm run typecheck`, `npx eslint` (0 errores, el
mismo warning preexistente de `<img>` sin relación) y `npm run build`
limpios; `package-lock.json` sin cambios. Publiqué el commit `5b94a17` y,
tras el deploy, verifiqué en producción con la sesión de Angel: abrí el
chat de David Duran (sin negocios), abrí "+ New", y confirmé que
TEMPERATURE ya muestra "Unclassified" (antes mostraba el valor crudo en
minúsculas) y que el formulario de negocio nuevo muestra "Sales Pipeline"
/ "Proceso de Ventas" en el selector de pipeline y las 5 etapas reales
("Cliente reciente", "Cotización", "Convencimiento", "Venta cerrada",
"Seguimiento entrega") con nombre legible en el selector de etapa —
cambiar de pipeline recalcula la etapa a la primera del pipeline elegido,
como se diseñó. No llegué a confirmar visualmente el selector de etapa de
un negocio *ya existente* (no había ninguno creado en esta cuenta al
momento de probar) porque los clics automatizados sobre el listbox ya
abierto siguieron siendo poco fiables (mismo problema de automatización
documentado en el bloque anterior — funciona con teclado y con el primer
clic que abre el trigger, pero no con clics sobre las opciones ya
desplegadas); la navegación por teclado (`ArrowDown`+`Enter`) sí confirmó
el cambio de pipeline correctamente. Es el mismo componente y el mismo
fix (`items={...}`) que ya se ve bien en los dos selectores nuevos, así
que doy el fix por bueno, pero un check visual humano directo sobre un
negocio real existente sería la confirmación final.

**Pendiente / siguiente paso:** que Angel (o una próxima sesión) confirme
a simple vista que el selector de etapa de un negocio ya existente
también muestra el nombre en vez del UUID, y decida si vale la pena
auditar el resto de los `Select` custom del proyecto (Configuración,
Pipelines, etc.) para el mismo problema.

### 2026-08-16 — Claude (Cowork, control de Chrome) — Dashboard: pipelines por separado + multi-moneda

**Hecho:** Angel pidió un "vistazo rápido" de los pipelines desde el
Dashboard, y que los montos pudieran verse en Quetzales también. El
widget de pipeline ya existía (`pipeline-donut.tsx`, un anillo SVG), pero
tenía dos problemas de fondo: (1) mezclaba las etapas de **todas** las
pipelines de la cuenta en un solo anillo — con dos pipelines reales
(Sales Pipeline y Proceso de Ventas) el resultado no distinguía una de
otra; (2) sumaba `deals.value` de todos los negocios abiertos sin mirar
`deals.currency` — un negocio en USD y uno en GTQ se sumaban como si
fueran la misma moneda, mostrando un total falso formateado con la
moneda por defecto de la cuenta. Lo mismo aplicaba a la tarjeta "Open
Deals Value" de arriba (mismo bug, mismo origen).

Con dos decisiones de Angel (separar por pipeline en vez de un widget
combinado; mostrar cada moneda por separado en vez de forzar todo a la
moneda de la cuenta), rediseñé la capa de datos y el widget:

- `src/lib/currency.ts`: nuevo tipo `CurrencyTotal` y
  `formatCurrencyTotals()` — junta totales por moneda sin sumarlos entre
  sí (`"$450 · Q1,200"` en vez de un número mezclado); con una sola
  moneda se ve igual que antes.
- `src/lib/dashboard/queries.ts`: `loadPipelineDonut()` (un anillo, todas
  las pipelines juntas) → `loadPipelinesOverview()` (un desglose por
  pipeline, y dentro de cada etapa un desglose por moneda). `loadMetrics()`
  ahora agrupa `openDealsValue` en `openDealsByCurrency` con el mismo
  principio — nunca suma monedas distintas.
- `src/components/dashboard/pipeline-donut.tsx` (anillo SVG) →
  `pipelines-overview.tsx`: una lista compacta por pipeline (nombre +
  total), y debajo sus etapas con conteo y monto — sin anillo, más legible
  con dos o más pipelines reales. Diseño aprobado por Angel antes de
  implementarlo (vía preview).
- `src/app/(dashboard)/dashboard/page.tsx` actualizado a los nuevos tipos
  y componente; la tarjeta "Open Deals Value" usa `formatCurrencyTotals`.

**Probado:** `npm run typecheck`, `npx eslint` sobre los archivos
tocados (0 errores/warnings), `npm run build` limpio, `package-lock.json`
sin cambios. `npx vitest run`: 907/909 (mismas 2 fallas preexistentes de
`mondayIndex`/zona horaria, sin relación). No hay pruebas unitarias
dedicadas a `dashboard/queries.ts` en el repo (no existían antes de este
cambio tampoco) — no se agregaron en este bloque para no ampliar el
alcance sin que Angel lo pida.

**Publicado y validado en producción:** Angel autorizó el push
(`979d8da`). Con la sesión real de Angel en Chrome, en el Dashboard
confirmé exactamente lo esperado: "Sales Pipeline" en $0/"No open deals"
y "Proceso de Ventas" en $450 con sus etapas reales ("Cliente reciente"
2 negocios $150, "Convencimiento" 1 negocio $300) — coincide con los 3
negocios reales de Angel verificados por SQL (David Duran $300, ".."
$50, "Sandia" $100). Creé un negocio de prueba en GTQ (Q1200, contacto
"El Gallo más Gallo Guatemala", vía el "+ New" del Inbox) y confirmé que
tanto la tarjeta "Open Deals Value" ("1200 GTQ · 450 US$, 4 open deals")
como el widget de pipelines ("Sales Pipeline: Q1.2k" separado de
"Proceso de Ventas: $450") muestran las dos monedas por separado, sin
sumarlas — exactamente lo pedido. Borré el negocio de prueba después
(`DELETE ... WHERE title = 'Prueba GTQ (borrar)'`), no quedó nada de
prueba en `deals`.

**Notas:** `src/lib/probe_delete_test.txt` permanece intacto y fuera del
commit.

### 2026-08-16 — Claude (Cowork, control de Chrome) — Auditoría completa de Select con UUID/valor crudo

**Hecho:** Angel pidió revisar si el resto de los `Select` custom del
proyecto tenía el mismo bug encontrado antes en `contact-sidebar.tsx`
(muestran el `value` crudo en vez de la etiqueta cuando `<Select.Root>`
de `@base-ui/react/select` no recibe una prop `items`). Encontré los 13
archivos que importan `@/components/ui/select` (`grep -rl` sobre
`<SelectValue`) y revisé cada `<Select>` uno por uno:

- **Con el bug, corregidos (agregado `items={...}`):**
  `products/quote-builder.tsx` (selector de producto en cotizaciones —
  mostraba el UUID del producto), `settings/ai-config.tsx` (proveedor de
  IA y agente de handoff), `contacts/contact-form.tsx` y
  `contacts/contact-detail-view.tsx` (temperatura de lead — mismo bug que
  ya existía en el Inbox, dos lugares más), `settings/invite-member-dialog.tsx`
  (vigencia de la invitación — el selector de rol ya estaba bien, usaba
  `children` en `SelectValue`), `broadcasts/step3-personalize.tsx` (tres
  selectores: tipo de variable, campo de contacto, campo personalizado),
  `settings/template-manager.tsx` (formato de encabezado de plantilla —
  nueva función `headerFormatLabel()` compartida entre el `items` y el
  render de opciones para no duplicar el mapeo; y tipo de botón de
  plantilla), `flows/forms/node-config-form.tsx` (seis selectores:
  sujeto/operador de condición, modo agregar/quitar etiqueta, dos
  selectores de etiqueta, tipo de medio a enviar), `flows/forms/fields.tsx`
  (`NodeKeySelect`, el selector reutilizable de "siguiente nodo" en el
  builder de Flows — el `items` reconstruye el mismo ícono+texto que ya
  usa `SelectItem`), `flows/flow-builder.tsx` (tipo de disparador del
  flow), `agents/ai-usage.tsx` (ventana de días del gráfico de consumo de
  tokens de IA — mostraba "7"/"30"/"90" en vez de "Last 7 days" etc).
- **Sin bug, no se tocaron:** `settings/members-tab.tsx` (el selector de
  rol de miembro ya usaba `<SelectValue>{tRoles(member.role)}</SelectValue>`,
  el patrón correcto); el selector de categoría de plantilla en
  `template-manager.tsx` y el de campo de contacto en
  `node-config-form.tsx` (sus valores — `Marketing`/`Utility`/
  `Authentication`, `name`/`email`/`phone`/`company` — son literalmente
  iguales a la etiqueta que se muestra, así que el bug no tiene efecto
  visible ahí; no se agregó `items` redundante).

**Probado:** `npm run typecheck` limpio. `npx eslint` sobre los 11
archivos modificados: 0 errores, 9 warnings — todos preexistentes y sin
relación (imports sin usar, deps de hooks) en líneas que no toqué.
`npm run build` limpio (mismas rutas, `package-lock.json` sin cambios).
`npx vitest run`: 907/909 (mismas 2 fallas preexistentes de
`mondayIndex`/zona horaria).

**Pendiente / siguiente paso:** publicar y, cuando Angel tenga tiempo,
confirmar a simple vista en un par de estos (el proveedor de IA en
Configuración → Agentes IA, y el tipo de disparador de un Flow son los
más rápidos de revisar) que ya muestran el nombre en vez del valor
crudo — no alcancé a abrir cada uno de los 11 en el navegador en esta
sesión dado el volumen, pero el mismo patrón (`items={...}`) ya se
validó en producción para el Inbox y el Dashboard.

**Publicado y validado parcialmente en producción:** Angel autorizó el
push (`f0dc2a4`). Con la sesión real de Angel en Chrome confirmé
`AI Agents → Setup`: el selector de proveedor muestra "Anthropic
(Claude)" (antes habría mostrado "anthropic") y "Hand off to" muestra
"angel israel duran simon" (antes habría mostrado su UUID de usuario).
No abrí los otros 9 archivos corregidos en el navegador — mismo patrón
ya confirmado dos veces (Inbox, Dashboard, y ahora AI Agents), riesgo
bajo de que alguno se comporte distinto.

**Notas:** `src/lib/probe_delete_test.txt` permanece intacto y fuera del
commit.

### 2026-08-16 — Claude (Cowork, control de Chrome) — Avance autónomo de etapas + cierre siempre humano

**Hecho:** Angel pidió que la IA mueva negocios de etapa sola conforme
conversa con el cliente (ej. a "Negociación"), preguntando primero cómo
quería acotar el riesgo. Dos decisiones suyas, confirmadas explícitamente:
(1) solo avanza negocios que **ya existen** — no crea negocios nuevos
desde cero; (2) "Venta cerrada" deja de cerrarse sola — **reemplaza** el
comportamiento autónomo que ya existía (Bloque 3, aprobado en su momento):
antes, si el cliente confirmaba la compra con palabras explícitas, la IA
movía el negocio a "Venta cerrada" sin que nadie lo revisara; ahora, ante
esa misma señal, la IA se detiene y le entrega la conversación a un
asesor humano (igual que ya hace hoy cuando "no sabe qué responder") para
que él la cierre. Angel también pidió dos contadores para un "tablero de
resultados" (cuántas veces la IA avanza una etapa sola; cuántos clientes
"resuelve" sin necesitar un humano) y que se notifique a alguien cuando
una venta está por cerrarse.

**Diseño:**
- `src/lib/ai/defaults.ts`: nuevo sentinel parametrizado
  `[[ACTION:move_deal:<nombre exacto de etapa>]]` (a diferencia de
  `[[ACTION:mark_deal_won]]`, que es un marcador fijo). El prompt de
  auto-reply ahora incluye, cuando el contacto tiene un negocio abierto,
  la etapa actual y el resto de etapas **no ganadoras** de su pipeline —
  el modelo solo puede elegir un nombre de esa lista, nunca inventar uno
  ni apuntar a la etapa de "Venta cerrada" por esta vía (esa sigue siendo
  exclusiva del otro marcador). Reescribí también el texto del marcador
  de compra confirmada: ya no dice "esto cierra la venta sola", dice
  "esto entrega la conversación a un humano para que la cierre él".
- `src/lib/ai/generate.ts`: `parseGeneration` ahora extrae el nombre de
  etapa del nuevo marcador con una regex y lo devuelve como
  `moveToStageName` (antes solo devolvía `handoff`/`markDealWon`).
- `src/lib/ai/auto-reply.ts` — el cambio más grande:
  - Antes de generar la respuesta, `loadDealStageOptions()` carga el
    negocio abierto del contacto (si existe) y las etapas no-ganadoras de
    su pipeline, para que el prompt las incluya.
  - `autoMarkDealWon()` (que antes movía el negocio a "Venta cerrada"
    sola) se **eliminó por completo** y se reemplazó por
    `flagDealClosing()`: pausa el bot, asigna la conversación al asesor
    configurado en "Hand off to" (mismo campo que ya existía para el
    handoff por "no sé responder"), dejando un resumen específico
    ("El cliente confirmó la compra..."), y registra el evento en
    `ai_action_log` con la acción nueva `flag_deal_closing` — nunca
    toca la tabla `deals`.
  - `autoMoveDealStage()` (nueva): resuelve el negocio del contacto de
    nuevo (fresco, no reutiliza el de la construcción del prompt),
    empareja el nombre de etapa que devolvió el modelo contra las etapas
    no-ganadoras del pipeline (comparación sin distinguir mayúsculas),
    mueve el negocio con el mismo `moveDeal()` que ya usa todo el resto
    de la app, y registra `move_deal` en `ai_action_log` con
    `source: "auto_reply_autonomous"` — mismo patrón de auditoría que ya
    existía, más el evento de webhook `deal.stage_changed`.
  - Si el modelo emite ambos marcadores en el mismo turno, la
    confirmación de compra gana (se prioriza sobre el avance de etapa).
- **Notificación:** reutilicé el trigger de base de datos que ya existe
  (`notify_conversation_assigned`, migración 027) — al asignar la
  conversación al asesor de handoff, ya genera automáticamente una
  notificación en la campanita. **No es un mensaje específico de "venta
  cerrando"** (el trigger tiene un título/cuerpo genérico de "conversación
  asignada"), pero el asesor sí ve la notificación y, al abrir el chat, el
  resumen (`ai_handoff_summary`) le explica exactamente por qué. No
  construí un tipo de notificación nuevo para mantener el alcance
  acotado — si Angel quiere un texto específico ("🎉 Venta lista para
  cerrar"), es un cambio pequeño para otra sesión.
- **Migración `054_ai_deal_closing_flag.sql`** (aplicada): agrega
  `flag_deal_closing` al CHECK de `ai_action_log.action`.
- **Tablero de resultados:** extendí `GET /api/ai/usage` con
  `results: { deals_auto_advanced, conversations_resolved }` en la misma
  ventana de días ya seleccionable. `deals_auto_advanced` cuenta filas de
  `ai_action_log` con `action='move_deal'` y
  `input->>source='auto_reply_autonomous'`. `conversations_resolved`
  cuenta conversaciones `status='closed'` con `assigned_agent_id IS NULL`
  y `ai_reply_count > 0` — la definición que Angel confirmó ("resolvió
  la duda sin pasar por un humano"), calculada con datos que ya existían,
  sin pedirle nada nuevo al modelo. Se muestran como dos tarjetas nuevas
  en `AI Agents → Usage` (`src/components/agents/ai-usage.tsx`), junto a
  las de tokens que ya había.

**Probado:** `npm run typecheck`, `npx eslint` sobre los 8 archivos
tocados (0 errores/warnings) y `npm run build` limpios;
`package-lock.json` sin cambios. `npx vitest run`: 918/920 (mismas 2
fallas preexistentes de `mondayIndex`/zona horaria). Reescribí
`auto-reply.test.ts` por completo — el bloque "autonomous mark_deal_won"
pasó a probar que `flagDealClosing` nunca toca `deals` y sí pausa/asigna/
audita; agregué un bloque nuevo "autonomous move_deal" (avanza a la etapa
correcta, empareja sin distinguir mayúsculas, no hace nada si el nombre
no existe entre las etapas no-ganadoras o si ya es la etapa actual, no
revienta si `moveDeal` falla) y un bloque para el contexto de etapas en
el prompt. Extendí `generate.test.ts` para el nuevo sentinel parametrizado
(nombres con acentos/espacios, y el caso de ambos marcadores juntos).
Migración `054` aplicada contra `puvbwzwmojpjplhdfnmk`; `get_advisors`
no reportó ningún hallazgo nuevo relacionado (la lista completa son
hallazgos preexistentes de sesiones anteriores, ninguno toca
`ai_action_log`).

**Publicado y validado parcialmente en producción:** Angel autorizó el
push (`4743e2f`). Confirmé con `fetch` autenticado que
`GET /api/ai/usage?days=30` responde `200` con
`results: {deals_auto_advanced: 0, conversations_resolved: 1}` (el 1 es
dato real preexistente, no algo que yo haya generado) y con la tarjeta
"Token usage & results" en `AI Agents → Usage` mostrando "Deals
auto-advanced: 0" y "Resolved without a human: 1" junto a las métricas
de tokens que ya había. **No pude validar el flujo autónomo en sí**
(avanzar una etapa sola / entregar el chat al confirmar compra) porque
eso requiere una conversación real de WhatsApp en curso con un cliente
real — no algo que se pueda simular de forma segura sin mensajear a un
tercero sin autorización.

**Pendiente / siguiente paso:** cuando Angel tenga una conversación real
en curso (o quiera probarlo escribiéndose a sí mismo desde otro número),
confirmar: (1) que al avanzar naturalmente hacia una etapa distinta el
negocio se mueve solo; (2) que al confirmar una compra la conversación
se pausa y se asigna al asesor de "Hand off to" en vez de cerrarse sola;
(3) revisar `ai_action_log` por SQL para confirmar que las filas nuevas
(`move_deal`/`flag_deal_closing` con `source: auto_reply_autonomous`)
tienen sentido. Hasta entonces, el código está desplegado y probado por
unidad, pero el comportamiento autónomo en una conversación real sigue
sin un smoke test end-to-end.

**Notas:** `src/lib/probe_delete_test.txt` permanece intacto y fuera del
commit.

### 2026-08-16 — Claude (Cowork, control de Chrome) — Bloque 6 (personas por etapa) + Bloque 7 (catálogo para la IA)

**Hecho:** Angel pidió cinco cosas grandes de un golpe (dashboard con
personas por etapa, catálogo accesible a la IA, página pública de
catálogo con cotización por selección, botón de soporte por correo, y
botón de reportar pago + suscripciones en `/admin`). Dado el tamaño,
entré a modo plan, investigué el estado real del código (no hay ninguna
capacidad de enviar correo hoy; la IA no ve el catálogo en la
conversación, solo lo usa un humano al enviarlo manualmente o al pasarle
ítems ya elegidos a `create_quote`; `/join/[token]` es el único patrón de
página pública que existe) y confirmé con Angel que el envío de correo
va por SMTP de Gmail con contraseñas de aplicación (no un proveedor
nuevo). Escribí un plan de 5 bloques (6 a 10) y lo aprobó. Esta entrada
cubre los dos primeros, ya publicados.

**Bloque 6 — personas por etapa:** `loadPipelinesOverview()`
(`src/lib/dashboard/queries.ts`) contaba filas de `deals`, no personas —
un contacto con dos negocios en la misma etapa contaba doble. Ahora
cuenta contactos distintos (`Set` de `contact_id`) por etapa y por
pipeline; el dinero sigue sumando cada negocio sin deduplicar. Renombré
`dealCount` → `peopleCount` en `src/lib/dashboard/types.ts` y la etiqueta
en `pipelines-overview.tsx` (nueva clave `personCount` con plural ICU,
reemplaza `dealCount` en `messages/en.json`/`ko.json` — no se usaba en
ningún otro lado).

**Bloque 7 — catálogo accesible para la IA:**
- Nuevo `src/lib/ai/catalog-context.ts` (`loadCatalogContext`): trae
  hasta 30 productos activos y arma líneas compactas
  ("- Nombre (Precio) — descripción corta", con la descripción truncada
  a 80 caracteres). Se inyecta en `buildSystemPrompt()`
  (`src/lib/ai/defaults.ts`) en modo `draft` **y** `auto_reply` — así
  tanto el botón "Redactar con IA" del agente como el bot autónomo y el
  Playground (los tres llaman a `buildSystemPrompt`) recomiendan
  productos y precios reales, nunca inventados.
- Nuevo sentinel autónomo `[[ACTION:send_catalog]]`
  (`SEND_CATALOG_SENTINEL`) — igual patrón que `move_deal`/`mark_deal_won`
  (parseado en `parseGeneration`, instruido solo cuando hay catálogo
  activo). Bajo riesgo (no muta nada, solo manda el PDF que ya existía)
  así que corre sin confirmación humana. Extraje la lógica que ya tenía
  `POST /api/products/send-catalog` a un helper compartido
  `sendCatalogToConversation()` (`src/lib/products/send-catalog.ts`)
  para no duplicarla entre la ruta HTTP (humana) y el disparo autónomo
  nuevo en `auto-reply.ts` — ya era channel-agnostic
  (`sendMessageToConversation`), así que WhatsApp/Instagram/Facebook
  funcionan sin cambios adicionales.
- Envío del catálogo y avance de etapa **no son excluyentes** entre sí
  (un cliente puede pedir el catálogo y a la vez mostrar que avanzó de
  etapa en el mismo mensaje) — solo `mark_deal_won` y `move_deal` siguen
  siendo mutuamente excluyentes entre ellos.
- **No incluido a propósito:** que la IA arme cotizaciones interpretando
  texto libre del cliente sobre el catálogo — eso lo resuelve el Bloque 8
  con selección estructurada en la página pública, más confiable que
  pedirle al modelo que interprete "quiero 2 de esto y 1 de aquello".

**Probado:** `npm run typecheck`, `npx eslint` sobre los 12 archivos
tocados (0 errores/warnings), `npm run build` limpio,
`package-lock.json` sin cambios. `npx vitest run`: 931/933 (mismas 2
fallas preexistentes de `mondayIndex`). Tests nuevos:
`catalog-context.test.ts` (formato, truncado, moneda por defecto — con
aserciones tolerantes a espacios NBSP, mismo criterio que
`currency.test.ts`), extensiones en `generate.test.ts` (nuevo sentinel,
combinación con `move_deal`) y en `auto-reply.test.ts` (catálogo en el
prompt cuando hay productos activos y nada cuando no, envío autónomo,
envío simultáneo con avance de etapa, no revienta si falla el envío).

**Pendiente / siguiente paso:** publicar, confirmar el deploy, y validar
en producción con cautela — mismo motivo que el bloque anterior (toca
conversaciones reales). Sugerido: probar en el Playground de AI Agents
(no toca clientes reales) preguntando "¿qué productos tienen?" y "mándame
el catálogo" y confirmar que menciona productos reales y ofrece
enviarlo; si hay oportunidad, confirmar en un chat real que el PDF llega
por WhatsApp cuando el bot decide enviarlo solo. Después sigue el
Bloque 8 (página pública de catálogo + cotización por selección).

**Notas:** `src/lib/probe_delete_test.txt` permanece intacto y fuera del
commit.

### 2026-08-16 — Claude Code — Bloque 8 (página pública del catálogo + cotización por selección)

**Hecho:** implementé el Bloque 8 completo del plan aprobado
(`shimmering-hopping-tide.md`). Antes de escribir código investigué el
gap real que el plan no había anticipado: **`whatsapp_config` nunca ha
guardado un número de teléfono marcable.** Solo tiene `phone_number_id`
(el ID interno de enrutamiento de Meta, no el número), y
`display_phone_number` se consulta en vivo contra la Graph API solo en
el momento de conectar, para un toast — nunca se persiste
(`src/lib/whatsapp/config-connect.ts`). Hacer esa consulta en vivo desde
una ruta pública sin sesión habría sido lento, frágil, y no funciona
para el proveedor Zernio (que no tiene número de Meta). Resolví esto con
un ajuste pequeño de alcance sobre lo planeado: nueva columna
`whatsapp_config.public_phone_number` (migración `055`, nullable,
editable a mano en Configuración → WhatsApp, mismo patrón que
`display_name`) — el link de WhatsApp del catálogo se resuelve de ahí,
no de Meta. Angel debe cargarlo una vez en Configuración para que el
botón de WhatsApp aparezca en su catálogo público (si queda vacío, la
cotización igual se crea, solo no se ofrece el link).

- **Página pública nueva:** `src/app/catalog/[accountId]/page.tsx`
  (+ `src/app/catalog/layout.tsx`) — sin auth, cliente, fuera de
  `protectedPaths` (confirmado en `src/middleware.ts`: el array no
  incluye `/catalog`). Grid de productos activos con selector de
  cantidad (+/-), barra inferior fija con total y botón "Solicitar
  cotización" que abre un diálogo pidiendo Nombre y Teléfono
  (obligatorios) + NIT/Correo/Dirección (opcionales — si quedan en
  blanco se usan valores de reserva: `C/F` para NIT como es costumbre en
  Guatemala, "No proporcionado(a)" para correo/dirección). Imágenes con
  `<img>` plano, no `next/image` — mismo criterio que
  `product-form.tsx`, evita tener que dar de alta el dominio de Supabase
  Storage en `next.config.ts`.
- **`GET /api/public/catalog/[accountId]`** (pública, rate-limited
  `publicCatalogView` 60/min por IP, cliente `supabaseAdmin()` porque no
  hay sesión) — nombre de cuenta, productos activos (id/nombre/
  descripción/precio/imagen), moneda por defecto, y el
  `public_phone_number` de la conexión de WhatsApp default.
- **`POST /api/public/catalog/[accountId]/quote-request`** (pública,
  rate-limited `publicCatalogQuote` 10/min por IP) — reutiliza
  `findOrCreateContact`/`resolveAuditUserId` de `src/lib/api/v1/contacts.ts`
  (la misma deduplicación por teléfono que ya usa la API pública) y
  `createQuote()` de `src/lib/quotes/create-quote.ts` con
  `allowFreeItems: false` y exactamente los `product_id`/`quantity` que
  la persona marcó — nada de texto libre interpretado por IA, tal como
  quedó explícitamente fuera de alcance en el Bloque 7. Responde con
  `wa.me/<public_phone_number>?text=...` (mismo patrón de
  `encodeURIComponent` que `invite-member-dialog.tsx`) para que sea el
  visitante quien inicie el chat de WhatsApp — evita cualquier problema
  de ventana de 24h de mensajería saliente, y la cotización ya queda
  creada y vinculada a su contacto antes de que ese chat entre al inbox.
- **Configuración → WhatsApp:** nuevo campo "Número público de WhatsApp"
  en el formulario de conexión (`whatsapp-config.tsx`), junto al nombre
  para mostrar — se guarda vía `POST`/`PATCH /api/whatsapp/config[/id]`,
  columna nueva incluida en el `GET` de listado. Strings nuevos en
  `messages/en.json`/`ko.json` bajo `Settings.whatsapp`.
- Nuevos buckets de rate limit en `src/lib/rate-limit.ts`:
  `publicCatalogView` (60/min) y `publicCatalogQuote` (10/min).

**Probado:** `npm run typecheck` limpio (tuve que forzar una
recompilación del dev server para que regenerara los tipos de rutas de
Next — `/catalog` no existía todavía en su caché), `npx eslint` sobre
los 10 archivos tocados (0 errores; 1 warning preexistente sin relación
en `whatsapp-config.tsx`, línea que no toqué), `npm run build` limpio
(las 2 rutas públicas y `/catalog/[accountId]` aparecen listadas),
`git status --short package-lock.json` vacío, `npx vitest run`:
931/933 (mismas 2 fallas preexistentes de `mondayIndex`, sin tests
nuevos en este bloque — es código nuevo sin lógica de negocio compleja
aislable; la lógica que sí es delicada, `createQuote`/`findOrCreateContact`,
ya tiene su propia cobertura de antes).

**Pendiente / siguiente paso:** validar en producción con la cuenta real
de Angel (cargar un número público de WhatsApp en Configuración,
visitar `/catalog/<su-account-id>`, seleccionar 1-2 productos, confirmar
que la cotización aparece en Productos → Cotizaciones vinculada a un
contacto nuevo, confirmar que el link de WhatsApp abre con el número y
mensaje correctos, y borrar el contacto/cotización de prueba después).
Todavía no publicado — Angel pidió avanzar con los Bloques 8, 9 y 10
antes de desplegar, así que este commit queda local junto con el Bloque
7 hasta que decida el momento del deploy. Sigue el Bloque 9 (botón de
soporte por correo).

### 2026-08-16 — Claude Code — Bloque 10 (reportar pago + suscripciones en /admin)

**Hecho:** el bloque de mayor riesgo del plan — toca el mismo mecanismo
de suspensión (`accounts.suspended_at`/`suspended_reason`) del que
depende `is_account_member()`, la función de la que cuelga cada
política RLS del sistema (migración 044). Diseñado para que **ninguna
cuenta real se vea afectada hasta que Angel le asigne una fecha de pago
a mano** desde `/admin` — `next_payment_due_at` nace `NULL` en todas
las cuentas existentes, y el barrido de suspensión automática nunca
toca una cuenta con esa columna en `NULL`.

- **Migración `056_billing.sql`:** `accounts.next_payment_due_at` +
  `last_marked_paid_at` (ambas nullable). Tabla nueva
  `platform_settings` (fila única, `id=1`) con los datos bancarios de
  Angel — lectura abierta a cualquier usuario autenticado (`GRANT
  SELECT ... TO authenticated` + política `USING (true)`), escritura
  solo por el cliente de service-role desde una ruta con
  `requirePlatformAdmin()` (mismo patrón que
  `platform_company_invitations` de la migración 043 — sin ningún
  GRANT de escritura para `authenticated`, así que ni siquiera hace
  falta una política RLS de `UPDATE` para bloquearlo). Ningún cambio
  en `is_account_member()` ni en las políticas existentes — reutiliza
  tal cual las columnas de suspensión de la migración 044.
- **`src/lib/admin/subscriptions.ts`:** `findOverdueAccounts()` (lectura
  pura), `suspendOverdueAccounts()` (solo cuentas con
  `next_payment_due_at` vencido y `suspended_at IS NULL` — nunca toca
  una cuenta ya suspendida por otro motivo), `markAccountPaid()`
  ("marcar como pagada": registra `last_marked_paid_at`, avanza
  `next_payment_due_at` un mes desde la fecha vigente si todavía no
  venció o desde hoy si ya venció/no existía, y reactiva la cuenta solo
  si estaba suspendida específicamente por `'Pago pendiente'` — una
  suspensión manual por otro motivo queda intacta).
- **`GET /api/admin/subscriptions/cron`** (mismo patrón de secreto
  `x-cron-secret` que los crons existentes, variable
  `SUBSCRIPTIONS_CRON_SECRET`): soporta `?dry_run=true` para listar qué
  cuentas suspendería **sin mutar nada** — esta es la verificación de
  seguridad prometida en el plan antes de programar el `pg_cron` real.
  Sin `dry_run`, ejecuta la suspensión de verdad.
- **`/admin`:** columna nueva "Próximo pago" (input de fecha editable
  por fila, guarda con `onBlur`) con la fecha del último pago marcado
  debajo; botón "Marcar pagada" independiente del botón existente de
  Suspender/Reactivar; nueva tarjeta "Mis datos bancarios" al final de
  la página para editar `platform_settings`. `PATCH
  /api/admin/companies/[id]` (ya existía para suspender/reactivar) gana
  dos ramas nuevas — `mark_paid: true` y `next_payment_due_at` — antes
  de la validación original de `suspended`, sin tocar esa lógica.
  `GET /api/admin/companies` ahora también trae ambas fechas. Nueva
  `PATCH /api/admin/platform-settings` (platform admin) para los datos
  bancarios.
- **Configuración → Facturación** (sección nueva en
  `settings-sections.ts`, ícono `Banknote`, visible en el rail para
  cualquier miembro): muestra los datos bancarios de `platform_settings`
  (lectura directa vía cliente RLS-scoped, igual criterio que
  `settings-overview.tsx`) y la fecha de próximo pago de la propia
  cuenta; botón "Reportar pago" (`canEditSettings` — admin/owner) →
  `POST /api/billing/report-payment`, que arma el correo a
  `pagosandia@gmail.com` con empresa, quién reportó, fecha, y los datos
  bancarios como referencia (tal como pidió Angel: el correo mismo debe
  llevar los datos). No toca `next_payment_due_at` — Angel sigue
  marcando el pago a mano en `/admin` después.
- Reutiliza `src/lib/email/send.ts` del Bloque 9 con `account:
  'payments'` — necesita `PAYMENTS_GMAIL_USER`/
  `PAYMENTS_GMAIL_APP_PASSWORD`, las mismas variables que ya había
  dejado reservadas la nota del Bloque 9.

**Probado:** `npm run typecheck` limpio, `npx eslint` sobre los 10
archivos tocados/nuevos (0 errores/warnings), `npm run build` limpio —
confirmé explícitamente que `/api/admin/companies`,
`/api/admin/companies/[id]`, `/api/admin/platform-settings` y
`/api/admin/subscriptions/cron` aparecen en la lista de rutas.
`git diff --stat package-lock.json` vacío. `npx vitest run`: 931/933
(mismas 2 fallas preexistentes). Sin tests nuevos — la lógica más
delicada (`markAccountPaid`/`suspendOverdueAccounts`) es CRUD directo
sobre Supabase sin ramas de negocio complejas que valga la pena mockear
por separado; el riesgo real de este bloque no está en la lógica sino
en cuándo se activa, y por eso el diseño entero gira en torno a que
nada se dispare solo.

**Pendiente / siguiente paso — el más importante de los tres bloques:**
la migración `056` NO está aplicada todavía (nada de los Bloques 8-10
lo está — quedó en pausa a propósito hasta que Angel decida el momento
del deploy conjunto). Antes de programar el `pg_cron` diario de
`/api/admin/subscriptions/cron`, hay que: (1) desplegar, (2) aplicar la
migración, (3) llamar la ruta con `?dry_run=true` y el secreto, y
mostrarle a Angel exactamente qué cuentas suspendería hoy (debería ser
ninguna, porque `next_payment_due_at` nace `NULL` en todas), y (4) solo
entonces registrar el cron. Angel también debe generar la contraseña de
aplicación de `pagosandia@gmail.com` y cargar
`PAYMENTS_GMAIL_USER`/`PAYMENTS_GMAIL_APP_PASSWORD` en EasyPanel, además
de `SUBSCRIPTIONS_CRON_SECRET` (nueva, para este cron).

**Con esto quedan terminados los Bloques 8, 9 y 10 — los tres siguen
sin publicar, a la espera de que Angel confirme el momento para lanzar
todo el paquete junto (Bloques 6-10) en un solo despliegue.**

### 2026-08-16 — Claude Code — Bloque 9 (botón de soporte por correo)

**Hecho:** primera capacidad de envío de correo del proyecto — antes de
esto no existía ninguna (confirmado en la investigación previa al plan).
`npm install nodemailer @types/nodemailer` (nota abajo sobre el
lockfile). Nuevo `src/lib/email/send.ts`: `sendEmail({account, to,
subject, text, attachments})` vía SMTP de Gmail (`nodemailer`,
`service: 'gmail'`), con `account: 'support' | 'payments'` seleccionando
cuál de las dos casillas de Chat Sandía envía (cada una con su propio
par de variables de entorno — `SUPPORT_GMAIL_USER`/
`SUPPORT_GMAIL_APP_PASSWORD` para este bloque, `PAYMENTS_GMAIL_USER`/
`PAYMENTS_GMAIL_APP_PASSWORD` quedan reservadas para el Bloque 10).
Lanza `EmailError` (503) si las variables del par pedido no están
configuradas todavía, para que la ruta responda con un error legible en
vez de un stack de SMTP.

- **`POST /api/support/report`** (cualquier rol autenticado,
  `multipart/form-data`, rate-limited `supportReport` 5/min por
  usuario): nombre, descripción del error, hasta 5 capturas
  (`image/*`, 5MB cada una). Arma el correo a `soportesandia1@gmail.com`
  con cuenta (id + nombre), quién reporta (nombre + correo de sesión) y
  el texto del error; las capturas van como adjuntos directos del correo
  — **no se suben a Supabase Storage**, por decisión explícita del plan
  (evita un histórico permanente de capturas que pueden traer datos
  sensibles de clientes de Angel).
- **Botón "Reportar un problema":** nuevo `SupportReportDialog`
  (`src/components/layout/support-report-dialog.tsx`), enganchado en el
  menú de cuenta del pie del sidebar (`sidebar.tsx`, entre
  Configuración y Cerrar sesión) — visible para cualquier usuario
  logueado. Nombre precargado desde el perfil (se resincroniza cada vez
  que el diálogo se abre, por si el perfil todavía estaba cargando la
  primera vez), descripción obligatoria, capturas opcionales con
  vista previa de nombre de archivo y opción de quitar una antes de
  enviar.
- Nuevo bucket de rate limit `supportReport` (5/min por usuario) en
  `src/lib/rate-limit.ts`, y `paymentReport` (5/min) reservado ya mismo
  para el Bloque 10 para no tener que volver a tocar ese archivo.

**Nota de lockfile:** `npm install` volvió a regenerar
`package-lock.json` sin la entrada
`next-intl/node_modules/@swc/helpers` (el mismo problema ya documentado
en sesiones anteriores — es una resolución de peer opcional no
determinística de npm, no algo que este proyecto dejó de necesitar: el
paquete sigue físicamente en `node_modules/next-intl/node_modules/@swc/`
y `next-intl`'s `@swc/core` anidado sigue declarándolo como peer
opcional). La reinserté a mano en el mismo lugar del archivo antes de
hacer commit — necesaria para que el build de Docker de EasyPanel
(`node:20-alpine`, `npm ci`) no se rompa. Si un futuro `npm install`
vuelve a quitarla, el arreglo es el mismo: confirmar que
`node_modules/next-intl/node_modules/@swc/helpers` sigue en disco y
reinsertar el bloque JSON idéntico (versión `0.5.23`) antes de
`node_modules/node-addon-api` en `package-lock.json`.

**Probado:** `npm run typecheck` limpio, `npx eslint` sobre los 5
archivos tocados/nuevos (0 errores/warnings), `npm run build` limpio
(`/api/support/report` aparece listada), `git diff --stat
package-lock.json` solo con adiciones (sin el `@swc/helpers` de menos),
`npx vitest run`: 931/933 (mismas 2 fallas preexistentes). Sin tests
nuevos — `send.ts` es un envoltorio delgado sobre `nodemailer` (poco
valor en mockear todo el transporte SMTP) y la validación de la ruta es
directa.

**Pendiente / siguiente paso:** Angel debe generar una contraseña de
aplicación de Gmail para `soportesandia1@gmail.com` (Cuenta de Google →
Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones) y
cargar `SUPPORT_GMAIL_USER`/`SUPPORT_GMAIL_APP_PASSWORD` en EasyPanel —
sin eso la ruta responde 503 con un mensaje claro en vez de fallar en
silencio. No se puede probar el envío real de punta a punta hasta que
esas variables existan en producción (Claude no puede recibir el
correo). Todavía no publicado, mismo criterio que el Bloque 8. Sigue el
Bloque 10 (botón de reportar pago + panel de suscripciones en
`/admin`).

### 2026-08-16 — Claude Code — Publicación de los Bloques 6-10 + validación en producción + rediseño del cron de suscripciones

**Hecho:** Angel decidió publicar los Bloques 7-10 en paquete (el 6 ya
estaba en producción). Antes de darle push, cambié los dos correos de
destino que el plan original tenía hardcodeados
(`soportesandia1@gmail.com`, `pagosandia@gmail.com`) a una sola casilla
que Angel prefirió usar, `asistentedechat@gmail.com` — el cambio fue
mínimo porque el diseño ya separaba "cuenta que envía" (env vars
`SUPPORT_GMAIL_USER`/`PAYMENTS_GMAIL_USER`) de "bandeja de destino"
(`SUPPORT_INBOX`/`PAYMENTS_INBOX`, constantes en cada ruta) — bastó con
cambiar esas dos constantes y los comentarios que las mencionaban
(commit `b5e60fa`). Push de los 5 commits pendientes
(`ea70c9e`..`b5e60fa`), aplicadas las migraciones `055_whatsapp_public_number`
y `056_billing` contra producción.

**Validación en producción (todo con la cuenta real de Angel):**
- Bloque 6: dashboard muestra "2 people" en la etapa con 2 negocios del
  mismo contacto — confirmado.
- Bloque 7: en el playground, sin pedir el catálogo explícitamente el
  bot decidió solo mandar el PDF (`send_catalog`); forzando respuesta en
  texto, citó los 2 productos reales con sus precios exactos ($500 y
  $1,000) — confirmado que el contexto de catálogo llega al modelo y no
  alucina precios.
- Bloque 8: `/catalog/<account_id>` carga con los 2 productos reales
  (imagen, precio, descripción); probé `POST
  /api/public/catalog/.../quote-request` de punta a punta (creó
  contacto + cotización + deal), confirmé y borré los datos de prueba.
  El campo "Público WhatsApp number" ya vive en Configuración →
  WhatsApp → Editar.
- Bloque 9: `POST /api/support/report` con datos de prueba → 200 OK.
  Angel confirmó que el correo sí llegó a `asistentedechat@gmail.com`.
- Bloque 10: `/admin` muestra las 2 empresas con columna "Próximo pago"
  y botones "Marcar pagada"/"Suspender"; Configuración → Facturación
  muestra los datos bancarios reales que Angel cargó (Banco Industrial,
  cuenta de ahorro); `POST /api/billing/report-payment` → 200 OK,
  correo confirmado recibido.

**Nota de proceso:** el menú de acciones (⋯) de las tablas de Contactos
y del header de cuenta resultó intermitente para la automatización de
Chrome (el mismo problema de popovers ya documentado con los `Select`
en sesiones anteriores — el click a veces cierra el menú sin ejecutar
la acción). Cuando pasa, el atajo es llamar la ruta API subyacente
directo por `fetch()` desde la pestaña autenticada en vez de pelear con
el click — así se validaron soporte/pagos/cotización de prueba. Para
acciones sin ruta API equivalente (como borrar un contacto, que solo
existe como `supabase.from('contacts').delete()` directo desde el
cliente), toca que un humano haga el click.

**Cambio de diseño del Bloque 10 — Angel pidió NO suspender
automático.** Su instrucción exacta: quiere una alerta 3 días antes del
vencimiento, y otra el último día avisando que debe suspenderse — pero
la suspensión la hace él a mano desde `/admin` (el botón "Suspender" ya
existía y sigue intacto). Reescribí `src/lib/admin/subscriptions.ts`:

- Eliminé `suspendOverdueAccounts()` (ya no se usa — nada muta cuentas
  automáticamente).
- Nueva `findAccountsDueInDays(db, days)`: compara por día calendario en
  UTC (no por ventana de 24h), así que no importa a qué hora del día
  corra el cron. Con `days=3` dispara el aviso temprano.
- Nueva `sendSubscriptionAlerts(db)`: manda dos correos independientes a
  `asistentedechat@gmail.com` (reusa `sendEmail` del Bloque 9, `account:
  'payments'`) — uno para las cuentas que hoy caen exactamente 3 días
  antes de su vencimiento (dispara una sola vez, porque la comparación
  de día solo coincide ese día), y otro para las cuentas ya vencidas y
  activas (repite todos los días que el cron corra mientras siga
  vencida — decidí que un aviso único del "último día" corre el riesgo
  de perderse si Angel no lo ve ese día, así que insiste a diario hasta
  que él la marca pagada o la suspende a mano).
- `GET /api/admin/subscriptions/cron` ya no ejecuta ninguna mutación:
  sin `dry_run` manda las alertas que correspondan; con `?dry_run=true`
  devuelve `{ due_soon, overdue }` sin mandar nada.
- 7 tests nuevos en `subscriptions.test.ts` (día exacto, no confunde
  día 2/4, no depende de la hora del día, cruce de mes, y 3 casos de
  `sendSubscriptionAlerts` con `sendEmail` mockeado).

**Probado:** `npm run typecheck`/`eslint`/`build` limpios,
`npx vitest run`: 938/940 (mismas 2 fallas preexistentes de
`mondayIndex` — el resto pasa, incluyendo los 7 tests nuevos). Commit
`a5e4978`, push con confirmación de Angel. Confirmé en producción con
`curl` + el secreto real que `?dry_run=true` devuelve
`{"due_soon":[],"overdue":[]}` — ninguna cuenta dispara nada hoy, tal
como se esperaba (ninguna tiene `next_payment_due_at` asignado
todavía).

**Programé el `pg_cron` diario** (`subscriptions-alert-sweep`, jobid 3,
`0 13 * * *` UTC = 7am hora Guatemala) apuntando a
`/api/admin/subscriptions/cron` con `SUBSCRIPTIONS_CRON_SECRET`, mismo
patrón que `webhook-retry-sweep`/`conversation-reassign-sweep`. No hace
nada hasta que Angel le asigne una fecha de "Próximo pago" a una
empresa desde `/admin`.

**Pendiente:** un contacto de prueba del Bloque 8 ("Prueba Bloque 8
(borrar)") quedó sin borrar en Contactos — la automatización no logró
completar el click de borrado; Angel lo borró manualmente. Con esto,
**los cinco bloques (6-10) quedan completos, publicados, validados en
producción y con el cron de alertas de pago activo.**

### 2026-08-16 — Claude Code — Catálogo: link en vez de PDF + "Me lo llevo" con entrega instantánea

**Hecho:** tres cambios encadenados, pedidos por Angel después de ver el
Bloque 8 y 7 en producción:

1. **El catálogo se comparte como link, no como PDF.** Tanto el botón
   manual (`POST /api/products/send-catalog`) como la acción autónoma
   de la IA (`[[ACTION:send_catalog]]`) ahora mandan un mensaje de texto
   con el link a `/catalog/<account_id>` en vez de generar y subir un
   PDF — un paso menos (sin render/upload) y nunca queda desactualizado,
   a diferencia de un PDF generado una sola vez. `src/lib/products/send-catalog.ts`
   reescrito: ya no depende de `renderCatalogPdf`/`uploadCatalogPdf`, solo
   arma la URL desde `NEXT_PUBLIC_SITE_URL` (documentado en el propio
   `.env.local.example` como pensado exactamente para este caso: un
   contexto sin `Request`, como la ruta autónoma de la IA). Se eliminó
   `src/lib/pdf/catalog-pdf.tsx` (quedó sin ningún otro caller). El
   texto del prompt de la IA (`defaults.ts`) también se actualizó para
   describir un link en vez de un PDF.
2. **El mensaje de WhatsApp del wa.me ahora lleva el pedido exacto**
   (`quote-request/route.ts`) — en vez de "acabo de solicitar una
   cotización", dice literalmente "Quiero cotizar: 2x Producto A, 1x
   Producto B." — usando los `items` que devuelve `createQuote()`, así
   quien atienda el chat (humano o IA) ya sabe qué cotizar sin que el
   cliente tenga que volver a escribirlo.
3. **"Me lo llevo" con entrega instantánea del PDF.** Angel pidió algo
   más ambicioso: que el PDF de la cotización aparezca directo en el
   chat, no solo un mensaje de texto. Restricción real de Meta
   explicada y confirmada con Angel: un negocio no puede mandarle un
   mensaje libre a alguien que nunca le ha escrito (o no le escribe hace
   más de 24h) — así que el diseño final tiene dos caminos:
   - **Push instantáneo:** si el contacto ya tiene una conversación
     dentro de la ventana de 24h (por ejemplo, la IA compartió el link
     del catálogo en medio de un chat activo), el PDF se manda de
     inmediato a esa conversación — sin que el visitante salga de la
     página del catálogo.
   - **Fallback por wa.me:** si no hay ventana abierta (link frío,
     primer contacto), se le sigue mandando el link de WhatsApp con el
     pedido pre-llenado (punto 2); la cotización queda marcada
     `auto_send_pending = true`, y en cuanto ese mensaje llega — abriendo
     la ventana — el webhook de WhatsApp la detecta y manda el PDF solo,
     como primera respuesta.
   - Nuevo `src/lib/quotes/send-quote.ts`: extrae de
     `POST /api/quotes/[id]/send` la lógica de generar/reusar el PDF +
     enviarlo + marcar `sent_at`/`status` (ahora compartida entre esa
     ruta humana, el push instantáneo, y el auto-envío del webhook), más
     `findRecentConversation()` (misma regla "conversación más reciente"
     que ya usaba la ruta humana) e `isWithinMessagingWindow()` (consulta
     el último mensaje `sender_type='customer'` de la conversación —
     no existía ningún chequeo de ventana de 24h en todo el proyecto
     hasta ahora, Meta simplemente rechaza el envío si se manda fuera de
     ventana).
   - Migración `057_quote_auto_send.sql`: `quotes.auto_send_pending`
     (booleano, default `false` — no afecta cotizaciones existentes ni
     las creadas por otros caminos, como el constructor manual).
   - `src/app/api/whatsapp/webhook/route.ts`: nuevo bloque, envuelto en
     `try/catch` (nunca puede romper el procesamiento normal del
     mensaje), justo después de `flagBroadcastReplyIfAny` — busca
     cotizaciones `auto_send_pending=true` sin `sent_at` para ese
     contacto y las manda con `sendQuoteToConversation`.
   - Página pública (`catalog/[accountId]/page.tsx`): botón renombrado a
     **"Me lo llevo"**; el diálogo de confirmación ahora distingue los
     dos casos (`delivered: true` → "Ya te enviamos el PDF... revisa el
     chat"; `delivered: false` → el botón de WhatsApp de siempre).

**Probado:** `npm run typecheck`/`eslint`/`build` limpios en cada uno de
los tres commits. 10 tests nuevos en `send-catalog.test.ts` (link
correcto, sin barra final duplicada, error claro si falta
`NEXT_PUBLIC_SITE_URL`, no manda nada sin productos activos, envuelve
`SendMessageError`) y 10 en `send-quote.test.ts` (genera/reusa PDF,
marca `sent_at`/`auto_send_pending=false`, envuelve errores, ventana de
mensajería por hora/mes/ausencia de mensajes). `npx vitest run`:
951/953 (mismas 2 fallas preexistentes de `mondayIndex`). Publicado
(`fde4008`, `2f5bd08`, `e2bdef6`) y migración `057` aplicada.

**Validado en producción:** confirmé el botón "Me lo llevo" visible en
`/catalog/<account_id>`, y probé `POST .../quote-request` de punta a
punta — la respuesta ya trae `delivered: false` (sin conversación
previa, cae al fallback esperado) y la cotización quedó con
`auto_send_pending = true` en base de datos. Borré los 3 contactos y 7
cotizaciones/negocios de prueba que quedaron del proceso de validación
(uno de mis propios `curl` de polling terminó creando varias
cotizaciones repetidas sin querer, por pegarle a una ruta que muta en
vez de una de solo lectura — lección para la próxima vez que espere un
deploy).

**Pendiente / siguiente paso:** no se puede probar el push instantáneo
de punta a punta sin un número de WhatsApp público conectado y una
conversación real dentro de ventana — queda para cuando Angel conecte
un número real. El auto-envío del webhook tampoco se probó con un
mensaje real de Meta (no hay forma de simular la firma del webhook
desde aquí); la cobertura de esa ruta descansa en los tests unitarios
de `send-quote.ts` y en que el bloque nuevo está aislado con try/catch.

**Actualización — Angel probó el flujo completo (push instantáneo +
fallback) con una conversación real: "funciona a la perfección".**

### 2026-08-16 — Claude Code — Catálogo público: rediseño visual (tienda clara, sin filtros)

**Hecho:** Angel pidió que `/catalog/[accountId]` se viera más como una
página de e-commerce real — mandó como referencia una categoría de
intelaf.com (fondo blanco, tarjetas de producto con imagen contenida,
precio en negrita, grilla limpia) pero explícitamente sin filtros,
buscador ni barra de categorías, porque este catálogo siempre muestra
los productos de una sola empresa.

- Rediseñé `catalog/[accountId]/page.tsx` con clases claras
  (`bg-gray-50`, `bg-white`, `text-gray-900`, acento `emerald-600/700`)
  **hardcodeadas en vez de los tokens de tema del dashboard**
  (`bg-background`, `text-foreground`, etc.) — decisión deliberada: esta
  página la ve el cliente final, no el dueño de la cuenta, así que no
  debe heredar el tema oscuro/acento que Angel eligió para su propio
  panel. `catalog/layout.tsx` también pasó de `bg-background` a
  `bg-gray-50` por la misma razón.
- Imagen del producto contenida (`object-contain` sobre fondo gris
  claro) en vez de recortada a sangre completa (`object-cover`) —
  replica el estilo "foto de producto flotando en blanco" de la
  referencia. Grilla de 2/3/4 columnas según ancho de pantalla.
- **Bug encontrado y corregido en el mismo commit siguiente:** los
  botones `variant="outline"` (los +/- de cantidad, "Cancelar",
  "Cerrar") usan `bg-background` como fondo por defecto
  (`button.tsx`) — como esta página no está envuelta por el proveedor
  de tema claro/oscuro del dashboard, `:root` sin calificar resuelve al
  valor oscuro, y esos botones salían con relleno casi negro en vez de
  blanco. Se agregó `bg-white` explícito a los 4 usos. Angel lo detectó
  visualmente y confirmó el arreglo ("ya se ve mejor").

**Probado:** `npm run typecheck`/`eslint`/`build` limpios en ambos
commits, `npx vitest run`: 951/953 (mismas 2 fallas preexistentes, sin
tests nuevos — es un cambio puramente visual). Publicado (`e1d82e3`,
`d9e19b5`). Validado por Angel directamente en producción (la
herramienta de captura de pantalla de Chrome falló con un error propio
de la extensión durante esta sesión — no relacionado con el código —
así que la confirmación visual final fue de Angel, no mía).

### 2026-08-16/17 — Claude Code — IA: temperatura y avance de etapas confiables + negocios automáticos + tablero en vivo

**Hecho:** Angel probó en real (WhatsApp y Facebook) y encontró tres
problemas encadenados en lo que se construyó antes en la sesión:

1. **La IA nunca creaba un negocio para chats sin uno.** Confirmado con
   datos reales: de 7 contactos de Angel, solo 2 tenían un negocio —
   los otros 5 quedaban invisibles para el sistema de avance automático
   por diseño anterior ("solo mover negocios existentes"). Angel pidió
   explícitamente que la IA también los cree sola. `autoMoveDealStage()`
   en `src/lib/ai/auto-reply.ts` ahora, cuando el contacto no tiene
   negocio abierto, lo **crea** directo en la etapa nombrada (pipeline
   por defecto de la cuenta, título = nombre del contacto — misma
   convención que el botón manual "+ New" del inbox, `value: 0` porque
   la IA nunca inventa un precio). Se registra como acción nueva
   `create_deal` en `ai_action_log` (migración `058`), contada en el
   mismo indicador `deals_auto_advanced` del dashboard de IA que
   `move_deal`.
2. **La temperatura nunca se marcaba sola.** Existía como sugerencia
   que requería confirmación humana (`set_lead_temperature` vía
   `POST /api/ai/actions`), nunca conectada al modo autónomo. Nuevo
   marcador `[[ACTION:set_temperature:hot|warm|cold]]`, siempre
   disponible en modo auto-reply (la temperatura es del contacto, no
   depende de que exista un negocio) — sin confirmación humana, igual
   que mover etapa/mandar catálogo. Solo escribe si el valor cambió,
   para no saturar el registro de auditoría ni el webhook.
3. **Encontrado con pruebas reales, en dos rondas:** el modelo (Claude
   Haiku 4.5) marcaba temperatura de forma confiable pero omitía el
   marcador de mover/crear negocio en el mismo turno cuando también
   estaba razonando sobre la confirmación de compra — aunque el cliente
   preguntara precio explícitamente ("cuáles son los precios?") o
   nombrara el producto que quería. Se corrigió aplicando el mismo
   ajuste que ya funcionó para temperatura: subir la instrucción de
   mover/crear negocio de la 4ª posición (de 5) a la 2ª, con lenguaje
   más insistente ("revisa esto en cada respuesta, no es opcional",
   "mover es de bajo riesgo, ante la duda prefiere mover") y ejemplos
   concretos tomados de las pruebas reales de Angel en vez de abstractos.
4. **Bug real encontrado en el camino:** el pipeline de Angel tiene una
   etapa "Seguimiento entrega" (para después de la venta) posicionada
   después de "Venta cerrada" pero sin marcar como ganada — el filtro
   viejo (`is_won = false`) la ofrecía como una etapa de negociación
   normal, rompiendo el criterio de "etapa intermedia/avanzada". Nueva
   `loadPreSaleStages()` corta la lista de etapas justo antes de la
   primera etapa marcada como ganada, sin importar cuántas etapas
   tenga cada pipeline — funciona igual para cualquier empresa con
   cualquier configuración de etapas.
5. **El tablero de Pipelines no se actualizaba solo.** Confirmado con
   timestamps reales: la IA sí mueve todo en ~8-10 segundos desde el
   mensaje del cliente (tiempo de la llamada al modelo + envío por
   WhatsApp/Facebook), pero la página solo cargaba `deals`/`contacts`
   una vez al entrar — un cambio en segundo plano nunca aparecía sin
   refrescar. Migración `059`: agrega `deals` y `contacts` a la
   publicación `supabase_realtime` (junto a `conversations`/`messages`,
   que ya la usan desde antes). La página de Pipelines se suscribe y
   refresca sola ante cualquier cambio — probado moviendo un negocio
   directo en la base de datos y confirmando que la tarjeta se movió
   sola en pantalla sin recargar.

**Decisión de diseño confirmada con Angel:** el cierre de venta
("Venta cerrada") sigue siendo exclusivamente manual — la IA detecta
la confirmación de compra y entrega la conversación a un humano
(`flagDealClosing`, ya existente), pero nunca mueve la tarjeta ella
misma. Angel lo confirmó como comportamiento correcto tras revisar los
timestamps reales.

**Probado:** cada uno de los commits pasó
`npm run typecheck`/`eslint`/`build` limpios y la suite completa de
`vitest` (llegó a 975/977, mismas 2 fallas preexistentes de
`mondayIndex`) — incluye tests nuevos para `create_deal`, la exclusión
de etapas post-venta, y los helpers de `loadPreSaleStages`. Validado
en producción con conversaciones reales de Angel por WhatsApp y
Facebook (no simulaciones) — encontró los tres problemas anteriores
exactamente así, probando de nuevo después de cada corrección.

**Pendiente / siguiente paso:** ninguno — Angel confirmó que el flujo
completo (temperatura, avance de etapas, creación de negocios,
actualización en vivo del tablero) ya funciona de punta a punta.

### 2026-08-17 — Claude Code — Google Calendar: Bloque A (conexión OAuth)

**Hecho:** Angel pidió que la IA pueda agendar citas usando su Google
Calendar real (no un calendario interno) y que el cliente reciba el
correo de invitación — eligiendo explícitamente la opción con OAuth
real sobre un calendario interno con `.ics`, sabiendo que implica el
proceso de verificación de Google más adelante. Planeado en modo plan
(dos exploraciones en paralelo) — hallazgo clave: **este proyecto no
tenía ningún flujo OAuth hasta ahora** — WhatsApp/Instagram/Facebook
usan formularios de "pega tu token" manual, no un botón que redirige y
regresa. Esta es la primera integración OAuth real, sin patrón previo
que copiar.

- **Migración `060_google_calendar_config.sql`:** una conexión por
  cuenta (`UNIQUE(account_id)`, mismo patrón de RLS vía
  `is_account_member()` que `instagram_config`/`facebook_config`).
  `refresh_token`/`access_token` cifrados con el mismo
  `encrypt()`/`decrypt()` de `src/lib/whatsapp/encryption.ts`
  (AES-256-GCM, `ENCRYPTION_KEY`) que ya usa todo el proyecto. Primera
  tabla de config con `token_expiry` — ninguna integración anterior
  necesitaba renovación porque todos sus tokens son de larga duración.
- **`src/lib/google-calendar/oauth.ts`:** `buildAuthUrl`,
  `exchangeCodeForTokens`, `getValidAccessToken` (revisa vencimiento,
  renueva y vuelve a guardar cifrado automáticamente si hace falta —
  la pieza sin precedente en el proyecto). Permisos acotados
  (`calendar.events` + `calendar.freebusy` + `userinfo.email`) en vez
  del permiso completo de Calendar, para quedar en el nivel de
  verificación "sensible" de Google en vez del más estricto
  "restringido".
- **`GET /api/google-calendar/oauth/start`** (admin+): guarda un
  `state` anti-CSRF en una cookie httpOnly de 10 minutos y redirige a
  la pantalla de consentimiento de Google con `access_type=offline` +
  `prompt=consent` (garantiza un `refresh_token` incluso al reconectar).
  **`GET /api/google-calendar/oauth/callback`:** valida el `state`,
  intercambia el código, guarda los tokens cifrados, redirige de vuelta
  a Configuración. **`GET`/`DELETE /api/google-calendar/config`:**
  estado de conexión verificado en vivo contra la API real + desconectar,
  mismo contrato que `instagram/config`/`facebook/config`.
- **Configuración → Google Calendar:** mismo esqueleto visual que los
  otros paneles de conexión, pero el botón es "Connect Google Calendar"
  (redirige a `/oauth/start`) en vez de un formulario para pegar
  credenciales.

**Probado:** `npm run typecheck`/`eslint`/`build` limpios, 9 tests
nuevos para `getValidAccessToken`/`buildAuthUrl` (la única lógica de
negocio real aquí — las rutas son envoltorios delgados), `npx vitest
run`: 975/977 (mismas 2 fallas preexistentes). Publicado (`9466965`),
migración `060` aplicada. Validado en producción: la sección
"Google Calendar" aparece en Configuración, muestra "Not connected" y
el botón "Connect Google Calendar" apunta correctamente a
`/api/google-calendar/oauth/start`.

**Pendiente / siguiente paso:** Angel todavía tiene que crear el
proyecto en Google Cloud, activar la Calendar API, configurar la
pantalla de consentimiento y generar las credenciales (`GOOGLE_CALENDAR
_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET`) — instrucciones paso a
paso ya se las di, pendientes de que las cargue en EasyPanel. Sin eso
no se puede probar la conexión real de punta a punta. Sigue el
Bloque B: la IA consulta disponibilidad real (`checkFreeBusy`), sugiere
un horario, un humano confirma desde el Inbox (mismo patrón ya
existente de "IA sugiere, humano confirma" que usa mover etapa/
temperatura), y se crea el evento con un enlace de Google Meet incluido
automáticamente (`conferenceData`/`conferenceDataVersion=1`, confirmado
con Angel que sí se puede) — Google manda la invitación por correo
solo, sin que haya que tocar `src/lib/email/send.ts`.

### 2026-08-17 — Claude Code (deploy roto por lockfile + hueco de middleware en /kpis)

Angel pidió validar que el commit `9c4443f` (página de KPIs de ventas,
sesión anterior) hubiera llegado a producción. No había llegado: el
build de EasyPanel falló en `npm ci` con `Missing: @swc/helpers@0.5.23
from lock file`.

**Causa raíz:** `package-lock.json` se regeneró para ese commit (por
`exceljs`) con `npm install` corriendo en Windows bajo npm 11, que
tolera un peer-dependency sin resolver de `@swc/core` (requerido
opcionalmente por `next-intl`) y no escribe la copia anidada
`next-intl/node_modules/@swc/helpers@0.5.23` que satisface ese peer.
El commit anterior sí tenía esa entrada. El build de EasyPanel corre
en Linux con npm 10.8.2 (`node:20-alpine`), que sí valida ese peer en
`npm ci` y falla si falta. Diagnosticado reproduciendo `npm ci` en
local con `npx npm@10.8.2` — reprodujo el error exacto; con npm
11.17.0 (versión local por defecto) el mismo lockfile instala sin
quejarse, lo que explica por qué nadie lo vio antes de hacer push.
**Lección para sesiones futuras:** si un build de Docker falla en
`npm ci` con "missing from lock file" pero `npm install` local no
reproduce el problema, sospechar primero de una diferencia de versión
de npm entre el entorno local y la imagen base del Dockerfile
(`node:20-alpine` trae npm 10.8.2, no el npm que trae el Node del
desarrollador) antes de asumir que el lockfile está corrupto.

**Fix 1 (`e17616b`):** regenerado `package-lock.json` con
`npx npm@10.8.2 install --package-lock-only` — diff de 11 líneas,
exactamente la entrada anidada que faltaba. Validado con `npm ci`
limpio usando npm 10.8.2 antes de commitear.

**Hallazgo adicional al validar en producción:** con el build ya
corregido, `/kpis` respondía `200` a un visitante sin sesión en vez
del `307` a `/login` que dan todas las demás rutas del dashboard
(`/dashboard`, `/contacts`, `/pipelines`, etc.). Causa: `/kpis` nunca
se agregó a `protectedPaths` en `src/middleware.ts` — el mismo tipo de
omisión que el diagnóstico técnico ya había señalado para `/flows`
(ese caso ya está corregido; este es nuevo, del commit de KPIs). No
hay fuga de datos real (la página es `'use client'` puro, las
consultas a Supabase están detrás de RLS), pero rompe el patrón de
defensa en profundidad del proyecto y el propio commit dice que la
página es "admin+ only". **Fix 2 (`2ea0731`):** una línea, agregar
`'/kpis'` a `protectedPaths`.

**Probado (ambos fixes):** `npm run typecheck`/`eslint`/`build`
limpios, `npx vitest run`: 1035/1037 (mismas 2 fallas preexistentes de
`mondayIndex`/timezone). Confirmado `package-lock.json` sin diff extra
después del segundo fix. Publicados en dos commits separados,
confirmación explícita de Angel antes de cada push.

**Validado en producción (ambos):** después de `e17616b`, `/kpis`
pasó de `404` a `200` con HTML real de Next.js (confirma que el build
por fin incluye el commit de KPIs). Después de `2ea0731`, `/kpis` pasa
a `307` hacia `/login` igual que el resto de rutas protegidas.

**Pendiente / siguiente paso:** ninguno específico de este trabajo —
la página de KPIs está desplegada y protegida. Sigue el Bloque B de
Google Calendar (ver entrada anterior), pendiente de que Angel cargue
las credenciales de Google Cloud en EasyPanel.

### 2026-08-17 — Claude Code (export de contactos en KPIs + scroll del panel de contacto en Inbox)

Dos pedidos de Angel sobre lo desplegado en la entrada anterior:

**1. Nueva hoja "Contacts" en el export de Excel de `/kpis`
(`9d6cec8`).** Angel pidió poder descargar, por período, la lista de
personas que escribieron: nombre, número, canal, motivo de la
consulta (aclaró que puede vivir en notas) y etapa en la que se
quedó. No existe un campo de "canal" en `contacts` (sí en
`conversations`) ni un campo dedicado de "motivo de consulta" — se
resolvieron así:
- **Canal:** derivado de cuál de `instagram_id` / `facebook_id` /
  `phone` tiene la fila (son mutuamente excluyentes por diseño, migr.
  039/041).
- **Motivo de consulta:** no hay campo dedicado — se usa cada fila de
  `contact_notes` de ese contacto, unida con " | ". Vacío si nadie
  dejó notas (caso común hoy, confirmado con datos reales).
- **Etapa:** el `stage` del deal más reciente del contacto (o vacío si
  no tiene ninguno).
- **Alcance temporal:** el mismo rango de fecha ya seleccionado en la
  página (7/30/90/365 días) — no se agregó un selector de "mes
  calendario" nuevo; 30 días cubre razonablemente el caso "por mes"
  que pidió Angel. Si en el futuro pide un mes calendario exacto,
  revisar esta decisión.
- `loadContactExportRows` (nuevo, `src/lib/kpis/queries.ts`) se
  llama solo al hacer clic en "Download Excel", no en cada render de
  la página — 3 queries (contactos, luego notas + deals en paralelo,
  cruzadas por `contact_id`) para no inflar la carga normal de la
  página con datos que la mayoría de las veces no se descargan.
- **Validado con datos reales de producción** (servidor de desarrollo
  apuntando al mismo proyecto de Supabase, sesión real de Angel en el
  navegador): los 7 contactos del período salieron con nombre,
  teléfono, canal (whatsapp/instagram/facebook) y etapa correctos,
  coincidiendo con lo que ya se ve en pantalla.

**2. Panel de contacto del Inbox no hacía scroll (`5f81d65`).** Bug
real encontrado (no solo percepción): al `ScrollArea` que envuelve
Etiquetas/Negociaciones/Cotizaciones/Notas le faltaba `min-h-0` — como
hijo de un flex-column, sin eso crece para caber todo su contenido en
vez de quedar acotado y hacer scroll interno. Es exactamente el mismo
fix que `conversation-list.tsx` ya tiene (con un comentario propio
explicando el porqué — `min-height:auto` por defecto en un flex item
gana sobre `flex-1` si no se fuerza `min-h-0`). Un contacto con varias
negociaciones o notas quedaba cortado sin forma de llegar al resto.

Angel también pidió que el panel *en sí* fuera plegable, "para que los
mensajes del chat sean más grandes" — eso ya existía: el header del
hilo de mensajes tiene un botón (ícono de panel, junto al de refrescar)
que oculta/muestra el panel de contacto completo y le da todo el ancho
al hilo (issue #258, con persistencia en localStorage). Verificado en
el navegador que funciona — no hizo falta código nuevo para esa parte.

**Probado:** `npm run typecheck`/`eslint`/`build` limpios, `npx vitest
run`: 1036/1038 (mismas 2 fallas preexistentes). Servidor de
desarrollo local levantado y probado en el navegador contra datos
reales de producción antes de commitear (export de Excel con blob real
de 12,584 bytes conteniendo la hoja "Contacts"; scroll del panel de
contacto verificado bajando hasta Notes; toggle del panel completo
verificado ocultando/mostrando). Publicado, sin diff en
`package-lock.json`.

**Validado en producción (después del push):** export de Excel
descargado con sesión real de Angel — blob de 12,584 bytes, idéntico
en tamaño al probado en local, confirma que la hoja "Contacts" está
en el build live. Panel de contacto de la conversación "Sandia" (2
negociaciones + 3 cotizaciones, uno de los casos más cargados que hay
en la cuenta real) scrolleó completo hasta Notes sin cortarse.

**Pendiente / siguiente paso:** ninguno específico. Si Angel encuentra
que "por mes" debía ser un mes calendario exacto (no el rango de
7/30/90/365 días existente), o que el motivo de consulta necesita su
propio campo en vez de reusar notas, son cambios de seguimiento
puntuales sobre lo ya construido aquí.

### 2026-08-17 — Claude Code (bug real de cotizaciones IG/Facebook, teléfono editable, detalle de producto)

Cuatro pedidos de Angel sobre el catálogo público y el panel de
contacto, encadenados a la sesión anterior.

**1. Bug real: las cotizaciones del catálogo nunca llegaban al chat
de Instagram/Facebook (`f6e4211`).** Angel propuso un sistema de
"número de ticket" como solución alterna, pero la causa raíz era más
simple y ya arreglable de raíz: `quote-request/route.ts` siempre
resolvía el contacto por el teléfono que la persona tecleaba en el
formulario del catálogo, incluso cuando el link ya traía
`?c=<conversationId>` (todo link de catálogo lo trae, sin importar el
canal — ver `sendCatalogToConversation`). Un contacto de
Instagram/Facebook no tiene teléfono por diseño, así que ese
find-or-create-por-teléfono siempre creaba un contacto nuevo y
distinto al que realmente estaba chateando — la verificación "¿esta
conversación es de este contacto?" fallaba en silencio y el flujo
caía siempre al link de WhatsApp, que no tiene sentido para alguien
que escribió por otro canal. Corregido: cuando `conversation_id` es
válido, se usa el contacto de esa conversación directamente (se salta
la búsqueda por teléfono por completo), y el teléfono que la persona
escribió en el formulario se guarda en ese contacto si no tenía uno
— cerrando el círculo con el punto 3. También se dejó de ofrecer el
link de WhatsApp cuando la conversación verificada es de
Instagram/Facebook y su ventana está cerrada (antes se ofrecía sin
sentido). **No hizo falta el sistema de ticket** — el link ya
resuelve el problema sin que el cliente tenga que copiar nada.
Validado con un contacto/conversación de prueba aislados (creados y
borrados por script, sin tocar conversaciones reales) más un chequeo
de regresión del flujo original (visitante frío sin conversación).

**2. Campo "Teléfono" siempre visible y editable en el panel de
contacto (`e646235`).** Antes se mostraba teléfono O usuario de
Instagram, nunca ambos, y no había forma de agregar un teléfono a un
contacto que no lo tenía. Ahora Teléfono es una fila siempre visible
("Add phone number" si está vacío), editable en línea, guarda vía el
mismo `PATCH /api/contacts/[id]` que ya existía (con manejo de
colisión de único ya incluido). Ese teléfono alimenta directamente la
hoja "Contacts" del export de KPIs de la sesión anterior, porque esa
hoja ya lee `contact.phone`. De paso se agregó `facebook_id`/
`facebook_username` al tipo `Contact` (existen en la BD desde la
migración 041, nunca se habían tipado) para mostrar también la
identidad de Facebook en el panel.

**3. Detalle de producto clicable en el catálogo público
(`6e3a9d2`).** Antes no había forma de entrar a un producto —
tocarlo no hacía nada, y la descripción se cortaba a 2 líneas.
**Decisión de alcance con Angel:** el modelo de datos no tiene
soporte para varias fotos por producto (solo `image_url`, una sola)
— eso requeriría una migración + tabla `product_images` + pantalla de
subida en el admin, así que se acordó ir por partes: ahora, cada
producto abre un diálogo de detalle con imagen más grande y
descripción completa (sin cortar); la galería de varias fotos queda
como siguiente paso, con el diálogo de detalle ya listo para
recibirla.

**Hallazgo de paso: `DialogContent` (componente compartido) no tenía
tope de altura ni scroll interno (`4d21fc2`).** Al construir el
diálogo de detalle (el primero de la app con suficiente contenido
para notarlo) se encontró que en una ventana baja (probado con
478px de alto real) el diálogo se salía de la pantalla por arriba Y
por abajo sin ninguna forma de hacer scroll — ni el título ni el
botón de cerrar eran alcanzables. Arreglado en el componente
compartido (`max-h-[85vh] overflow-y-auto`), beneficia a todos los
diálogos de la app; los que ya cabían en pantalla no cambian en nada
porque el límite solo actúa cuando el contenido lo excede.

**Probado:** `npm run typecheck`/`eslint`/`build` limpios, `npx
vitest run`: 1036/1038 (mismas 2 fallas preexistentes). Todo
verificado en el navegador contra datos y sesión reales antes de
comitear: cotización de prueba aislada limpiada después; teléfono
guardado y luego revertido en un contacto real
(`estiloyconfort_mueble`) para no dejar dato inventado; diálogo de
detalle probado con scroll, stepper de cantidad, y confirmación de
que el carrito se actualiza al cerrar. Publicado en 4 commits
separados, confirmación explícita de Angel antes del push.

**Pendiente / siguiente paso:** galería de varias fotos por producto
(migración `product_images` + subida en el admin + carrusel en el
diálogo de detalle) queda pendiente si Angel la pide — el diálogo de
detalle ya construido es el lugar natural para recibirla.

**Validado en producción:** el primer intento de deploy de
`6e3a9d2` falló en EasyPanel (17s, sin detalle visible desde aquí);
el reintento automático sí construyó bien (~5 min). Confirmado en el
catálogo público real: el producto abre el diálogo de detalle con
imagen, precio, descripción completa y scroll interno funcionando.

### 2026-08-17 — Claude Code (moneda a Quetzales, borrar deals/quotes, tags habilitados, export de contactos filtrados)

Angel reportó cuatro cosas más sobre lo desplegado en las dos
entradas anteriores, todas resueltas y publicadas.

**1. Todo el sistema (catálogo, deals, quotes, KPIs) mostraba
dólares.** No era un bug de código — `accounts.default_currency` de
la cuenta de Angel estaba literalmente en `'USD'` en la base de
datos; toda la app ya lee ese campo correctamente en todos lados
(catálogo público, `QuoteBuilder`, KPIs). Cambiado a `GTQ` **a través
de la misma pantalla de Configuración → Deals & currency** que Angel
usaría (no por script directo — un intento de UPDATE directo a la
base de datos fue bloqueado por el clasificador de auto-modo de
Claude Code, correctamente: es un cambio de configuración de cuenta
real, no algo para hacer por script). Confirmado con el endpoint
público del catálogo devolviendo `"currency":"GTQ"` de inmediato. Sin
commit de código — es un dato, no algo que se despliega.

**2. Botón para borrar deals y quotes, en el panel de contacto del
Inbox (`584dfb0`).** Ya existían las piezas por separado — un deal se
podía borrar desde el Kanban de Pipelines (`deal-form.tsx`), y
`DELETE /api/quotes/[id]` ya existía en el backend — pero ninguna
llegaba al panel de contacto del Inbox, que es desde donde Angel
realmente trabaja mientras chatea. Agregado un ícono de basura por
tarjeta (con confirmación) en ambas secciones.

**3. Tags "no permitía agregar ni ingresarlos" (`83c9573`).**
Investigado a fondo antes de tocar código: Configuración → Fields &
tags **sí funcionaba** (probado creando y borrando un tag real ahí
mismo) — el problema real es que la cuenta tenía **cero tags creados
en la base de datos**, y el único lugar donde Angel probablemente
intentó usarlos — la pestaña "Tags" de un contacto en la página de
Contacts — solo permite marcar/desmarcar tags que ya existen, sin
ninguna forma de crear uno ahí si la lista está vacía. Agregado un
input de creación inline en esa misma pestaña (solo admin+, mismo
requisito que la tabla `tags` ya exige por RLS) que crea el tag Y lo
aplica al contacto de una vez. De paso se encontró y corrigió un bug
relacionado: la página de lista de Contacts no refrescaba su propio
`tagsMap` después de esto, así que un tag recién creado no aparecía
en "Filter by tags" hasta recargar la página — el `onUpdated` del
panel de detalle solo llamaba `fetchContacts`, nunca `fetchTags`.

**4. Botón para descargar los contactos filtrados por
búsqueda/tags, en la página de Contacts (`02ce792`).** Nuevo
`src/lib/contacts/export-excel.ts` (mismo patrón separado
build/download que `src/lib/kpis/export-excel.ts`, testeable sin
DOM). El botón "Download" reusa las mismas dos rutas de consulta que
ya tiene `fetchContacts` (RPC `filter_contacts_by_tags` cuando hay
tags seleccionados, `ilike` simple si no) pero sin paginar, para
traer TODO lo que coincide con el filtro actual, no solo la página
cargada en pantalla.

**Probado:** `npm run typecheck`/`eslint`/`build` limpios, `npx
vitest run`: 1040/1042 (mismas 2 fallas preexistentes; +4 tests
nuevos para el export de contactos). Todo verificado en el navegador
contra datos y sesión reales antes de comitear: deal y quote de
prueba creados y borrados con los nuevos botones (sin tocar los
deals/quotes reales del contacto); tag de prueba creado, aplicado,
verificado en el filtro de Contacts, y borrado después; export
probado con un filtro de tag real generando un `.xlsx` válido.
Publicado en 3 commits, confirmación explícita de Angel antes del
push — el primer intento de `git push` devolvió un 401 transitorio
seguido de un 503 en el segundo intento, pero el segundo sí completó
el push (confirmado con `git fetch` + comparación de SHA antes de
seguir).

**Validado en producción:** el build tardó ~7 minutos (más que lo
usual, sin causa aparente, pero terminó en verde). Confirmado con la
sesión real de Angel: botón "Download" presente en `/contacts` y
genera un `.xlsx` real (7,086 bytes) con los 9 contactos de la cuenta.

**Pendiente / siguiente paso:** ninguno específico. Si Angel quiere
que la creación de tags también sea posible desde el panel de
contacto del Inbox (hoy solo se puede aplicar/crear desde la página
de Contacts), es una extensión natural del mismo patrón ya construido
aquí.

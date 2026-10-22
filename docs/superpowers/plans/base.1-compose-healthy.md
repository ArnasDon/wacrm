# BASE.1 · Compose en healthy con Supabase, fork de wacrm y cron — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el `docker-compose.yml` del template con Supabase autoalojado, el fork de wacrm y el
cron de tareas programadas, todos con healthcheck, imágenes pineadas y sin publicar puertos de
Postgres, de modo que en una máquina limpia `docker compose up` termine con todos los servicios en
*healthy* y la verificación del publicador de CT.2 pase.

**Architecture:** El compose pasa de un solo servicio `app` con Supabase externo a los nueve
servicios que CT.2 fija como obligatorios (`supabase-db`, `supabase-kong`, `supabase-auth`,
`supabase-rest`, `supabase-realtime`, `supabase-storage`, `supabase-meta`, `app`, `cron`) y los dos
volúmenes nombrados `supabase-db-data` y `supabase-storage-data`. Lo que el compose declara se
verifica como dato: un lector (`scripts/compose/topology.ts`) convierte el YAML en el
`ComposeTopologyInput` de CT.2 y la verificación del publicador —los `it.todo` que CT.2 dejó— lo
pasa por `parseTopology`, así los tres criterios estáticos (nombres, pines, puertos de Postgres) son
pruebas de `npm test` y no una revisión a ojo. El criterio de *healthy* en máquina limpia es una
prueba de integración aparte, encendida con `COMPOSE_IT=1`, que corre `docker compose up -d --wait`
sobre un *runner* nuevo de GitHub Actions.

**Tech Stack:** Docker Compose v2, Supabase autoalojado (postgres, kong, gotrue, postgrest,
realtime, storage-api, postgres-meta), Next.js 16 (el fork), BusyBox `crond`, TypeScript, vitest,
js-yaml, Node 22.

**Spec:** `prd-hub` → `prds/wacrm-tenant-repo-template/slices/BASE.1-compose-healthy.md`
(orígenes: `03-alcance.md#compose-probado`, `05-reglas.md#r1`, `#r2`, `#r3`; contrato que publica:
`slices/CT.2-contrato-servicios-compose.md` → `contracts/base/compose-services.ts`).

## Está hecho cuando (copiado del slice)

- IT: en una máquina limpia, `docker compose up` deja todos los servicios en *healthy*
- IT: ningún puerto de Postgres queda publicado en el host
- IT: ninguna imagen del compose usa `:latest`
- CDC: la prueba de verificación de CT.2 pasa

## No entra (copiado del slice)

- Túnel y webhook de Meta (BASE.2) → no se agrega `cloudflared`, ni dominios, ni verificación de
  webhook. `tunnel` está en `OPTIONAL_SERVICE_NAMES` de CT.2 justamente para que BASE.2 lo agregue
  sin tocar el contrato.
- Backup en el cron (BAK.1) → el `crontab` del servicio `cron` solo lleva las tareas programadas de
  wacrm (`/api/automations/cron` y `/api/flows/cron`). Ninguna línea de backup, ningún `pg_dump`.
- Configuración por empresa (CFG.1) → `.env.example` es el del template, con marcadores; no se crea
  `policies.yaml`, ni interruptores de módulos, ni instrucciones de repo hijo.
- Cerrar el registro de usuarios es de **BASE.3**: este plan declara la variable
  `GOTRUE_DISABLE_SIGNUP` con el valor permisivo y un comentario que apunta a BASE.3; no cambia la
  política.

## Global Constraints

- **Precondición dura:** el código de CT.2 (`contracts/base/compose-services.ts` y
  `contracts/base/compose-services.stub.ts`) debe estar en `main` antes de empezar. Hoy solo está
  mergeado su *plan*. Antes de la Tarea 1: `git fetch origin && git log origin/main --oneline -5` y
  `test -f contracts/base/compose-services.ts`. Si no está, **parar y reportarlo**: no se escribe el
  contrato desde este slice ni se cambia ninguno de sus archivos salvo
  `compose-services.publisher.test.ts`, que CT.2 dejó explícitamente para BASE.1.
- **El contrato no se cambia.** Los nombres de servicio, los roles, los nombres de volumen y los
  refinamientos de `parseTopology` son de CT.2. Si el compose no cabe en ellos, el compose se
  adapta; si el contrato está mal, se anota como pregunta para Juan y se para.
- **R3:** toda imagen del compose va con versión exacta, nunca `:latest`, nunca sin tag.
- **R1:** Postgres (5432, 6543) no se publica en el host. Ningún servicio publica en `0.0.0.0`: lo
  que se publica va a `127.0.0.1` (en fase 1 se navega desde la misma máquina; BASE.2 trae el túnel
  saliente).
- **R2:** no se commitea ningún `.env` ni clave. El repo solo lleva `.env.example` con marcadores.
  `.gitignore:34-37` ya ignora `.env*` y hace la excepción de `.env.example`: se verifica, no se
  cambia.
- Identificadores, comentarios de código, YAML y SQL en inglés, como el resto del fork; este plan,
  los mensajes de commit y los cuerpos de PR en español.
- Verificación completa del repo (`.claude/avanzar-repo.yaml`): `npm ci`, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`. Verificación dirigida:
  `npx vitest run <archivos>`.
- `package.json` y `package-lock.json` son archivos calientes: se tocan una sola vez, en la Tarea 1
  de la Parte 1, y nada más.
- No se toca código del upstream: `src/`, `Dockerfile`, `supabase/migrations/`, `next.config.ts` y
  `eslint.config.mjs` quedan como están. Lo nuevo vive en `docker/`, `scripts/`, `.env.example`,
  `docker-compose.yml`, `docs/docker.md` y la prueba del publicador.
- Ningún mensaje de commit ni cuerpo de PR lleva atribución a Claude/Anthropic/IA.

## Review Focus

1. Un servicio nuevo que alguien agregue al compose con `image: supabase/x` (sin tag) o `:latest`
   debe hacer fallar `npm test`, no solo pasar desapercibido en el *review*. → Parte 1, Tarea 2,
   Paso 1 y Tarea 5, Paso 1.
2. Un `ports: - '5432:5432'` en **cualquier** servicio, o un `ports: - '15432:5432'` (Postgres en el
   lado del contenedor), debe hacer fallar la verificación del publicador. El lector tiene que
   resolver `${HOST_PORT:-3000}` para poder comparar números, o el puerto publicado pasaría como
   cadena sin validar. → Parte 1, Tarea 2, Pasos 1 y 5.
3. Un servicio al que le borren el `healthcheck`, o al que le pongan `healthcheck: {disable: true}`,
   debe hacer fallar la verificación: sin eso, `docker compose up --wait` da por bueno un
   contenedor que solo está *running*. → Parte 1, Tarea 2, Paso 1.
4. Un *bind mount* (`./supabase/migrations:/migrations:ro`) no es un volumen nombrado: si el lector
   lo contara, `parseTopology` rechazaría la topología por referenciar un volumen no declarado y la
   verificación del publicador fallaría por un motivo inventado. → Parte 1, Tarea 2, Paso 1.
5. La prueba de integración escribe un `.env` en la raíz del repo: si ya existe uno, tiene que
   negarse a correr en vez de pisar el `.env` de quien la ejecute, y tiene que borrar el suyo
   aunque el `up` falle. → Parte 1, Tarea 6, Paso 1.

## Decisiones tomadas sin Juan

1. **`.env.example` nuevo, `.env.local.example` intacto.** El slice pide `.env.example` y
   `.gitignore:37` ya lo tiene en la lista blanca. El stack completo necesita ~25 variables
   (Postgres, JWT, URLs, gotrue, storage) que no tienen nada que ver con el flujo `npm run dev` del
   upstream, así que se agrega `.env.example` como archivo del compose y `.env.local.example` se
   deja como está, para desarrollo sin Docker. `docs/docker.md` explica cuál es cuál.
2. **El compose lee `.env`, no `.env.local`.** El criterio dice `docker compose up`, sin banderas, y
   Compose solo lee `.env` por defecto para sustituir `${VAR}`. Hoy el repo exige
   `--env-file .env.local` (`docs/docker.md`), que con el criterio literal dejaría los
   `NEXT_PUBLIC_*` vacíos. Se pasa a `.env` y se documenta el cambio en `docs/docker.md`.
3. **Imágenes: el conjunto de la Parte 1, Tarea 3, Paso 2 se toma del `docker-compose.yml` oficial
   de self-hosting de Supabase**, no de la cabeza del implementador, y cada tag se comprueba con
   `docker manifest inspect` antes de commitear. Los tags del *stub* de CT.2 son *fixtures* y no
   obligan a nada.
4. **Sin `analytics`, `pooler`, `vector`, `imgproxy` ni `functions`.** CT.2 cierra la lista de
   servicios en once nombres y ninguno de esos está; wacrm no usa Edge Functions ni transformación
   de imágenes, y el *pooler* es justamente lo que publicaría 6543. `supabase-studio` queda fuera
   (es opcional en CT.2 y una comodidad de desarrollo, no parte del "healthy en máquina limpia").
5. **Las migraciones de wacrm no las corre el compose.** `supabase/migrations/001_initial_schema.sql`
   referencia `auth.users`, que lo crea gotrue al arrancar, así que no pueden ir en
   `/docker-entrypoint-initdb.d` (corre antes que gotrue). No hay servicio `migrate` posible: la
   lista de CT.2 es cerrada. Quedan como un comando documentado después del primer `up`
   (Parte 1, Tarea 4, Paso 3); el criterio del slice es *healthy*, que no depende de las tablas de
   wacrm. CFG.1 puede automatizarlo cuando defina el arranque por empresa.
6. **El servicio `cron` es BusyBox `crond` en una imagen propia pineada.** Instalar `curl` en el
   arranque dejaría el *healthy* dependiendo de la red; `docker/cron/Dockerfile` es
   `FROM alpine:<pineado>` con `curl` instalado en *build* y se etiqueta con `image:` además de
   `build:`, para que la topología vea una imagen pineada (CT.2 permite `image: null` en el rol
   `cron`, pero una imagen etiquetada es más fácil de auditar).
7. **El cron pega a los dos endpoints que ya existen**, `GET /api/automations/cron` y
   `GET /api/flows/cron`, con la cabecera `x-cron-secret`, cada 5 minutos por defecto
   (`CRON_SCHEDULE`). Son las "tareas programadas de wacrm" del slice: no hay otras en el fork
   (`docs/docker.md` las lista como lo único que el contenedor no agenda).
8. **"Máquina limpia" se mecaniza como un *runner* nuevo de GitHub Actions.** El criterio es `IT:`,
   así que tiene que ser automático; un *runner* `ubuntu-latest` es una máquina limpia con Docker y
   sin estado previo. La prueba vive en el repo y también corre a mano con `COMPOSE_IT=1`.
9. **La prueba de integración está apagada por defecto.** `npm test` no puede levantar Supabase en
   cada corrida ni en el CI de lint/typecheck/test/build. Se enciende con `COMPOSE_IT=1`
   (`describe.skipIf`), y el workflow nuevo la enciende.
10. **`js-yaml@^4.3.2` + `@types/js-yaml@^4.0.9` en `devDependencies`.** `js-yaml` 4.3.2 ya está
    resuelto en `package-lock.json` como dependencia transitiva, así que `npm install` dedupea;
    `@types/js-yaml` sí es nuevo. Es la dependencia que CT.2 dejó anotada como "de BASE.1".
11. **`NEXT_PUBLIC_SUPABASE_URL` queda apuntando a `http://localhost:8000`** (kong publicado en
    `127.0.0.1`) en `.env.example`. Es la única URL que sirve para el navegador en una máquina
    limpia sin dominio. Ver la pregunta para Juan de abajo: dentro del contenedor esa URL no
    resuelve, así que las llamadas de servidor a Supabase no funcionan hasta que BASE.2 ponga la URL
    pública del túnel. No afecta ningún criterio de BASE.1 y el criterio de mensaje en bandeja es de
    BASE.2.
12. **El plan se parte en dos PR operables.** Son ~24 archivos entre los dos; el límite del flujo es
    ~15 por PR. La Parte 1 deja Supabase y el fork en *healthy* con los tres criterios estáticos
    verificados; la Parte 2 agrega el `cron` y cierra los dos `it.todo` que faltan. Entre las dos,
    `contracts/base/compose-services.publisher.test.ts` nunca queda rojo: lo que falta sigue siendo
    `it.todo`, como lo dejó CT.2.
13. **Nombre del archivo del plan.** El loop pidió `docs/superpowers/plans/base.1-compose-healthy.md`
    y así se escribe, aunque la convención del repo (`2026-10-21-ct.2-…`) lleve fecha; el plan de
    CT.1 tampoco la lleva.

### Para confirmar con Juan

- **Una sola URL de Supabase para navegador y servidor.** El fork usa
  `NEXT_PUBLIC_SUPABASE_URL` tanto en el cliente como en el servidor
  (`src/lib/automations/admin-client.ts:11`), y con Supabase autoalojado esas dos no coinciden en
  fase 1: `http://localhost:8000` sirve en el navegador del host y no resuelve dentro del
  contenedor `app`. Las dos salidas son (a) la del PRD, usar la URL pública del túnel de BASE.2 en
  las dos, o (b) un cambio chico en el fork que haga que el lado servidor prefiera un
  `SUPABASE_INTERNAL_URL`. Este plan toma (a) por ahora, porque (b) es código del fork y no está en
  el `Entra` del slice. Si BASE.2 se retrasa, conviene (b).

## Verificación manual

El slice no tiene criterios `manual:` ni `espera_parcial`: los tres `IT:` quedan automatizados
(Parte 1, Tarea 6 y Parte 2, Tarea 3) y el `CDC:` corre en `npm test`.

Opcional, para Juan, no bloqueante: correr una vez el stack en su máquina
(`node scripts/supabase-keys.mjs >> .env && docker compose up -d --wait`), entrar a
`http://localhost:3000`, crear el primer usuario y confirmar que el dashboard carga después de
aplicar las migraciones con el comando de `docs/docker.md`.

---

# Parte 1 — Supabase autoalojado, el fork y la verificación estática del publicador

PR operable por sí sola: `docker compose up` deja ocho servicios en *healthy* y `npm test` verifica
nombres, volúmenes, pines de imagen, puertos de Postgres y healthchecks contra CT.2.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `package.json` / `package-lock.json` (modificar) | `js-yaml` y `@types/js-yaml` en `devDependencies`; script `keys`. |
| `vitest.config.ts` (modificar) | Agregar `scripts/**/*.test.ts` a `test.include`. |
| `scripts/compose/topology.ts` (crear) | Único lugar que sabe leer `docker-compose.yml` y traducirlo al `ComposeTopologyInput` de CT.2: roles por nombre, resolución de `${VAR:-def}`, puertos, volúmenes nombrados, healthchecks. |
| `scripts/compose/topology.test.ts` (crear) | Pruebas del lector con YAML en línea, incluidos los casos de *Review Focus* 1–4. |
| `scripts/supabase-keys.mjs` (crear) | Generador de `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `ENCRYPTION_KEY` para una máquina limpia. Sin dependencias. |
| `docker/supabase/db/init/01-roles.sql` (crear) | Contraseñas de los roles que usan auth, storage y postgrest. |
| `docker/supabase/db/init/02-realtime.sql` (crear) | Esquema `_realtime` que realtime espera encontrar. |
| `docker/supabase/kong/kong.yml` (crear) | Configuración declarativa de kong: rutas `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1` y los consumidores `anon` / `service_role`. |
| `.env.example` (crear) | Todas las variables del compose, con marcadores y sin un solo secreto real. |
| `docker-compose.yml` (modificar) | Los ocho servicios de la Parte 1, sus healthchecks, `depends_on` y los dos volúmenes nombrados. |
| `.dockerignore` (modificar) | Excluir `docker` y `scripts` del contexto de build del `app`. |
| `contracts/base/compose-services.publisher.test.ts` (modificar) | Convertir cinco de los siete `it.todo` de CT.2 en pruebas reales. |
| `scripts/compose/compose-up.it.test.ts` (crear) | Prueba de integración apagada por defecto: `docker compose up -d --wait` y los puertos publicados. |
| `.github/workflows/compose-it.yml` (crear) | Corre esa prueba en un *runner* nuevo. |
| `docs/docker.md` (modificar) | El arranque nuevo: `.env`, generador de llaves, migraciones, servicios y puertos. |

---

### Task 1: Dependencias, script de llaves y `vitest` viendo `scripts/`

**Files:**
- Modify: `package.json` (bloques `scripts` y `devDependencies`)
- Modify: `vitest.config.ts:8-10` (`test.include`)
- Create: `scripts/supabase-keys.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `node scripts/supabase-keys.mjs` imprime en `stdout`, una por línea y en formato
  `CLAVE=valor`, exactamente estas cinco: `POSTGRES_PASSWORD` (32 hex), `JWT_SECRET` (64 hex),
  `ANON_KEY` (JWT HS256 con `{"role":"anon","iss":"supabase"}`), `SERVICE_ROLE_KEY` (idem con
  `"role":"service_role"`), `ENCRYPTION_KEY` (64 hex, el formato que pide
  `.env.local.example:26`). `npm run keys` es su alias.

- [ ] **Step 1: Verificar la precondición de CT.2**

  Run: `git fetch origin && git log origin/main --oneline -3 && ls contracts/base/`
  Expected: existen `compose-services.ts` y `compose-services.stub.ts`. Si no, parar y reportar
  (ver *Global Constraints*).

- [ ] **Step 2: Agregar las dependencias y los includes**

  `npm install --save-dev js-yaml@^4.3.2 @types/js-yaml@^4.0.9`. En `package.json`, dentro de
  `scripts`, agregar `"keys": "node scripts/supabase-keys.mjs"`. En `vitest.config.ts`, dejar
  `include: ["src/**/*.test.ts", "src/**/*.test.tsx", "contracts/**/*.test.ts", "scripts/**/*.test.ts"]`.

- [ ] **Step 3: Escribir `scripts/supabase-keys.mjs`**

  Node puro (`node:crypto`), sin dependencias y sin tipos (`tsconfig.json` solo incluye `.ts`/`.mts`,
  así que no entra al `typecheck`). El único algoritmo que el nombre no determina es el JWT: HS256
  armado a mano, `base64url(header) + "." + base64url(payload) + "." + base64url(hmac)`, con
  `header = {"alg":"HS256","typ":"JWT"}` y
  `payload = { role, iss: "supabase", iat: ahoraEnSegundos, exp: iat + 315360000 }` (10 años, como
  las llaves que genera el self-hosting de Supabase). El secreto del HMAC es el `JWT_SECRET` que el
  propio script acaba de generar, para que las tres llaves sean consistentes entre sí.

- [ ] **Step 4: Comprobar que las llaves sirven**

  Run: `node scripts/supabase-keys.mjs`
  Expected: cinco líneas `CLAVE=valor`. Verificar a mano que el `ANON_KEY` decodifica a
  `{"role":"anon","iss":"supabase",...}`:
  `node -e 'const l=require("child_process").execSync("node scripts/supabase-keys.mjs","utf8");const k=l.match(/^ANON_KEY=(.*)$/m)[1];console.log(JSON.parse(Buffer.from(k.split(".")[1],"base64url")))'`

- [ ] **Step 5: Lint y commit**

  ```bash
  npx prettier --write package.json vitest.config.ts scripts
  npm run lint
  git add package.json package-lock.json vitest.config.ts scripts/supabase-keys.mjs
  git commit -m "chore(compose): js-yaml, include de scripts en vitest y generador de llaves de Supabase (BASE.1)"
  ```

---

### Task 2: Lector del compose hacia la topología de CT.2

**Files:**
- Create: `scripts/compose/topology.ts`
- Test: `scripts/compose/topology.test.ts`

**Interfaces:**
- Consumes: `ComposeTopologyInput`, `ServiceName`, `VolumeName`, `ServiceRole`, `SERVICE_NAMES`,
  `VOLUME_NAMES` de `@contracts/base/compose-services` (CT.2).
- Produces:
  ```ts
  export const SERVICE_ROLE_BY_NAME: Readonly<Record<ServiceName, ServiceRole>>;
  export const VOLUME_CONTENT_BY_NAME: Readonly<Record<VolumeName, "db" | "storage">>;
  export function resolveEnvRef(value: string, env?: Record<string, string | undefined>): string;
  export function parsePortMapping(entry: unknown, env?: Record<string, string | undefined>):
    { host: number; container: number };
  export function readComposeDocument(path?: string): unknown;   // default: docker-compose.yml de la raíz
  export function toTopologyInput(
    document: unknown,
    env?: Record<string, string | undefined>,
  ): ComposeTopologyInput;
  ```
  Mapa de roles (el que CT.2 refina: exactamente un `db` y exactamente un `cron`):
  `supabase-db`→`db`, `supabase-kong`→`gateway`, `supabase-storage`→`storage`, `app`→`app`,
  `cron`→`cron`, `tunnel`→`tunnel`, y `supabase-auth` / `supabase-rest` / `supabase-realtime` /
  `supabase-studio` / `supabase-meta`→`aux`.
  Mapa de contenido: `supabase-db-data`→`"db"`, `supabase-storage-data`→`"storage"`.

- [ ] **Step 1: Escribir las pruebas que fallan**

  En `scripts/compose/topology.test.ts`, con YAML en línea (`js-yaml`.`load`) para no depender del
  compose real:

  ```ts
  describe("resolveEnvRef", () => {
    it.each([
      ["${HOST_PORT:-3000}", {}, "3000"],
      ["${HOST_PORT:-3000}", { HOST_PORT: "8080" }, "8080"],
      ["${KONG_HTTP_PORT}", { KONG_HTTP_PORT: "8000" }, "8000"],
      ["5432", {}, "5432"],
    ])("resolves %s to %s", (value, env, expected) => {
      expect(resolveEnvRef(value, env)).toBe(expected);
    });

    it("throws on a variable with no value and no default", () => {
      expect(() => resolveEnvRef("${KONG_HTTP_PORT}", {})).toThrow(/KONG_HTTP_PORT/);
    });
  });

  describe("parsePortMapping", () => {
    it.each([
      ["3000:3000", { host: 3000, container: 3000 }],
      ["127.0.0.1:8000:8000", { host: 8000, container: 8000 }],
      ["127.0.0.1:${HOST_PORT:-3000}:3000", { host: 3000, container: 3000 }],
    ])("reads %s", (entry, expected) => {
      expect(parsePortMapping(entry)).toEqual(expected);
    });

    it("reads the long form", () => {
      expect(parsePortMapping({ published: "8000", target: 8000 })).toEqual({
        host: 8000, container: 8000,
      });
    });
  });

  describe("toTopologyInput", () => {
    // `doc(yaml)` es un helper local del archivo: js-yaml.load de un template string.
    it("maps a service to the contract shape", () => { /* name, role, image, healthcheck, publishedPorts, volumes */ });
    it("reports image null for a service that only builds", () => { /* build: context: . */ });
    it("keeps the image of a service that both builds and tags", () => { /* build + image: wacrm/cron:1.0.0 */ });
    it("counts only named volumes, not bind mounts", () => {
      // volumes: ["supabase-db-data:/var/lib/postgresql/data", "./supabase/migrations:/migrations:ro"]
      // => volumes: ["supabase-db-data"]
    });
    it("reports healthcheck false when there is none", () => { /* servicio sin healthcheck */ });
    it("reports healthcheck false when it is disabled", () => { /* healthcheck: { disable: true } */ });
    it("reports healthcheck false when it has no test", () => { /* healthcheck: { interval: 30s } */ });
    it("keeps an unpinned or :latest image verbatim so the contract can reject it", () => {
      // image: "kong:latest" => image: "kong:latest" (el lector no valida; valida el esquema)
    });
    it("throws on a service name the contract does not know", () => {
      expect(() => toTopologyInput(doc(`services:\n  db:\n    image: x:1\n`))).toThrow(/db/);
    });
    it("maps the declared volumes with their content and inBackup true", () => { /* volumes: {supabase-db-data: {}} */ });
    it("throws on a declared volume the contract does not know", () => { /* volumes: {pgdata: {}} */ });
  });
  ```

  Nota para el implementador: el lector **no valida** pines ni puertos de Postgres — los traduce.
  Quien rechaza es `ComposeServiceSchema` / `parseTopology` de CT.2, y eso se prueba en la Tarea 5.

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

  Run: `npx vitest run scripts/compose/topology.test.ts`
  Expected: FAIL, no resuelve `scripts/compose/topology`.

- [ ] **Step 3: Implementar `scripts/compose/topology.ts`**

  `resolveEnvRef` resuelve, en una cadena, toda ocurrencia de `${NAME}` y `${NAME:-default}` (el
  subconjunto de la interpolación de Compose que usa este repo); `env` por defecto es
  `process.env`. `readComposeDocument` es `yaml.load(readFileSync(path, "utf8"))` con
  `path = resolve(process.cwd(), "docker-compose.yml")` por defecto. `toTopologyInput` recorre
  `document.services` y `document.volumes`, usa los dos mapas para el rol y el contenido, lanza
  `Error` con el nombre ofensor cuando un nombre no está en `SERVICE_NAMES` / `VOLUME_NAMES`, filtra
  las entradas de `volumes` de cada servicio quedándose con las que, antes del primer `:`, están
  declaradas en `document.volumes`, y pone `healthcheck: Boolean(test) && disable !== true`. Devuelve
  `ComposeTopologyInput` (arreglos de `unknown`), no `ComposeTopology`: validar es de CT.2.

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

  Run: `npx vitest run scripts/compose/topology.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  npx prettier --write scripts
  git add scripts/compose/topology.ts scripts/compose/topology.test.ts
  git commit -m "feat(compose): lector del docker-compose.yml hacia la topología de CT.2 (BASE.1)"
  ```

---

### Task 3: Supabase autoalojado en el compose, con `.env.example`

**Files:**
- Create: `docker/supabase/db/init/01-roles.sql`
- Create: `docker/supabase/db/init/02-realtime.sql`
- Create: `docker/supabase/kong/kong.yml`
- Create: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: nada del código.
- Produces, para las tareas siguientes: los ocho servicios `supabase-db`, `supabase-kong`,
  `supabase-auth`, `supabase-rest`, `supabase-realtime`, `supabase-storage`, `supabase-meta`, `app`
  y los volúmenes `supabase-db-data`, `supabase-storage-data`. Puertos publicados, y solo estos:
  `app` → `127.0.0.1:${HOST_PORT:-3000}:3000`, `supabase-kong` →
  `127.0.0.1:${KONG_HTTP_PORT:-8000}:8000`.

- [ ] **Step 1: Fijar las variables en `.env.example`**

  Sin un solo valor real: los secretos llevan el marcador `<generar con: npm run keys>` y las URLs
  llevan el valor de máquina limpia. Grupos y variables, con un comentario por grupo:

  - Postgres: `POSTGRES_PASSWORD`, `POSTGRES_DB=postgres`, `POSTGRES_HOST=supabase-db`,
    `POSTGRES_PORT=5432`.
  - JWT: `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_EXPIRY=3600`.
  - URLs y puertos del host: `SITE_URL=http://localhost:3000`,
    `API_EXTERNAL_URL=http://localhost:8000`, `SUPABASE_PUBLIC_URL=http://localhost:8000`,
    `KONG_HTTP_PORT=8000`, `HOST_PORT=3000`.
  - Auth: `GOTRUE_DISABLE_SIGNUP=false` con el comentario «BASE.3 lo pone en `true`: el registro va
    solo por invitación», `GOTRUE_MAILER_AUTOCONFIRM=true` con el comentario de que así una máquina
    limpia crea el primer usuario sin SMTP, y `GOTRUE_SMTP_*` comentadas.
  - Storage: `STORAGE_BACKEND=file`, `FILE_SIZE_LIMIT=52428800`.
  - El fork: `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    (= `ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (= `SERVICE_ROLE_KEY`), `ENCRYPTION_KEY`,
    `META_APP_SECRET`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`,
    `NEXT_PUBLIC_APP_LOCALE=es`.

  Al lado de `NEXT_PUBLIC_SUPABASE_URL`, el comentario de la decisión 11: en fase 1 esa URL sirve
  para el navegador del host y no resuelve dentro del contenedor; BASE.2 la cambia por la URL
  pública del túnel.

- [ ] **Step 2: Elegir y comprobar los tags de las imágenes**

  Tomar los siete tags del `docker-compose.yml` oficial de self-hosting de Supabase (`supabase/supabase`,
  carpeta `docker/`) y anotar en un comentario al inicio de `docker-compose.yml` el commit de donde
  salieron. Comprobar cada uno antes de seguir:

  Run: `for i in <los siete tags>; do docker manifest inspect "$i" >/dev/null && echo "ok $i"; done`
  Expected: siete `ok`. Ninguno es `:latest` ni va sin tag.

- [ ] **Step 3: Escribir los dos SQL de init y `kong.yml`**

  `01-roles.sql`: `ALTER USER` con `:'POSTGRES_PASSWORD'` para `authenticator`,
  `supabase_auth_admin`, `supabase_storage_admin` y `supabase_admin` (los roles ya existen en la
  imagen `supabase/postgres`; lo que falta es la contraseña que cada servicio usa para conectarse).
  `02-realtime.sql`: `CREATE SCHEMA IF NOT EXISTS _realtime; ALTER SCHEMA _realtime OWNER TO supabase_admin;`.
  `kong.yml`: `_format_version: "2.1"`, los consumidores `anon` y `service_role` con
  `key-auth` sobre `ANON_KEY` / `SERVICE_ROLE_KEY`, y cuatro servicios con sus rutas —
  `/auth/v1` → `http://supabase-auth:9999`, `/rest/v1` → `http://supabase-rest:3000`,
  `/realtime/v1` → `http://supabase-realtime:4000/socket`,
  `/storage/v1` → `http://supabase-storage:5000` — copiando la estructura del `kong.yml` oficial y
  quitando las rutas de los servicios que no existen aquí (`analytics`, `functions`, `pg-meta`
  público, `studio`).

- [ ] **Step 4: Escribir el `docker-compose.yml`**

  Mantener `name: wacrm`. El servicio `app` conserva su `build` con los `args` de
  `NEXT_PUBLIC_*`, su `env_file` (ahora `.env`), su `environment: PORT: 3000` y su healthcheck
  actuales; lo que cambia es que publica en `127.0.0.1` y gana
  `depends_on: { supabase-kong: { condition: service_healthy } }`. Los siete de Supabase, con
  `restart: unless-stopped`, sin `ports` salvo kong, y `depends_on` sobre `supabase-db` healthy.
  `supabase-db` monta `supabase-db-data:/var/lib/postgresql/data`,
  `./docker/supabase/db/init:/docker-entrypoint-initdb.d:ro` y
  `./supabase/migrations:/migrations:ro` (para el comando documentado del Paso 3 de la Tarea 4);
  `supabase-storage` monta `supabase-storage-data:/var/lib/storage`. Healthchecks de arranque:

  | Servicio | `test` |
  |---|---|
  | `supabase-db` | `pg_isready -U postgres -h localhost` |
  | `supabase-kong` | `kong health` |
  | `supabase-auth` | `wget --no-verbose --tries=1 --spider http://localhost:9999/health` |
  | `supabase-realtime` | `curl -sSfL --head -o /dev/null http://localhost:4000/api/tenants/realtime-dev/health` |
  | `supabase-storage` | `wget --no-verbose --tries=1 --spider http://localhost:5000/status` |
  | `supabase-rest` | **por determinar — Paso 5** |
  | `supabase-meta` | **por determinar — Paso 5** |

  En `.dockerignore`, agregar `docker` y `scripts` para que editar el `crontab` o un SQL no invalide
  la caché de la imagen del `app`.

- [ ] **Step 5: Resolver el healthcheck de `supabase-rest` y `supabase-meta`**

  El compose oficial de Supabase no les pone healthcheck y CT.2 exige uno en cada servicio. Probar
  qué trae cada imagen:

  Run: `docker run --rm --entrypoint sh <imagen> -c 'command -v wget curl nc busybox; echo bash=$BASH_VERSION'`

  - Si hay `wget` o `curl`: usarlo contra `http://localhost:3001/ready` en postgrest
    (requiere `PGRST_ADMIN_SERVER_PORT=3001` en su `environment`) y contra
    `http://localhost:8080/health` en postgres-meta.
  - Si no hay ninguno y sí hay `bash`: `CMD-SHELL` con `/dev/tcp`.
  - Si no hay nada: envolver esa imagen en `docker/supabase/<servicio>/Dockerfile`
    (`FROM <imagen pineada>` + `COPY --from=busybox:<pineado> /bin/busybox /usr/local/bin/busybox`,
    sin `apk`/`apt` en *build*) y en el compose declarar `build:` **y** `image:` con un tag propio
    pineado, para que la topología siga viendo una imagen con versión exacta.

  Dejar anotado en un comentario del compose qué se eligió y por qué.

- [ ] **Step 6: Levantar el stack a mano y confirmar que todo queda healthy**

  ```bash
  cp .env.example .env && node scripts/supabase-keys.mjs >> .env
  # dejar una sola definición de cada clave: las generadas ganan
  docker compose up -d --wait --wait-timeout 600
  docker compose ps
  ```
  Expected: los ocho servicios en `healthy`. Si `app` queda *unhealthy* porque `/` falla con la
  URL de Supabase inalcanzable desde el contenedor, cambiar el `test` del healthcheck a
  `/favicon.ico`, que el matcher del middleware excluye (`src/middleware.ts:93-96`), y anotarlo en
  el comentario del healthcheck. Al terminar: `docker compose down -v && rm .env`.

- [ ] **Step 7: Confirmar que no se commitea ningún `.env`**

  Run: `git status --porcelain && git check-ignore -v .env`
  Expected: `.env` no aparece en `git status`; `check-ignore` lo reporta ignorado por
  `.gitignore:34`. No se modifica `.gitignore`.

- [ ] **Step 8: Commit**

  ```bash
  npx prettier --write docker-compose.yml
  git add docker-compose.yml .env.example .dockerignore docker/supabase
  git commit -m "feat(compose): Supabase autoalojado con healthchecks e imágenes pineadas (BASE.1)"
  ```

---

### Task 4: `docs/docker.md` al día

**Files:**
- Modify: `docs/docker.md`

**Interfaces:**
- Consumes: el compose de la Tarea 3.
- Produces: nada que importe otra tarea.

- [ ] **Step 1: Reescribir el arranque**

  Reemplazar la premisa de hoy («Supabase es external — no database container is included») por el
  stack real: una tabla de los servicios con su puerto interno y si publica o no, y el *quick start*
  en cuatro pasos — `cp .env.example .env`, `npm run keys >> .env` (dejando una definición por
  clave), `docker compose up -d --wait`, abrir `http://localhost:3000`. Decir explícitamente que ya
  no hace falta `--env-file`, que el compose lee `.env`, y que `.env.local.example` sigue siendo el
  del flujo `npm run dev` sin Docker.

- [ ] **Step 2: Documentar lo que no publica y por qué**

  Una nota con R1 y R3: Postgres no se publica (ni 5432 ni 6543), lo poco que se publica va a
  `127.0.0.1`, las imágenes van pineadas, y el acceso desde afuera llega en BASE.2 con el túnel
  saliente. Mencionar que `npm test` verifica esas tres cosas contra el contrato
  (`contracts/base/compose-services.publisher.test.ts`) y cómo correr la prueba de integración
  (`COMPOSE_IT=1 npx vitest run scripts/compose/compose-up.it.test.ts`).

- [ ] **Step 3: Documentar las migraciones después del primer `up`**

  El comando exacto, con el *bind mount* que ya declara el compose:

  ```bash
  docker compose exec -T supabase-db sh -c \
    'for f in /migrations/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f"; done'
  ```

  Con la razón en una línea: no van en `/docker-entrypoint-initdb.d` porque referencian
  `auth.users`, que gotrue crea al arrancar, después del init de Postgres.

- [ ] **Step 4: Commit**

  ```bash
  npx prettier --write docs/docker.md
  git add docs/docker.md
  git commit -m "docs(compose): arranque con Supabase autoalojado y migraciones (BASE.1)"
  ```

---

### Task 5: Verificación del publicador de CT.2 (los criterios estáticos)

**Files:**
- Modify: `contracts/base/compose-services.publisher.test.ts`

**Interfaces:**
- Consumes: `readComposeDocument`, `toTopologyInput` (Tarea 2); `ComposeServiceSchema`,
  `ComposeVolumeSchema`, `SERVICE_NAMES`, `OPTIONAL_SERVICE_NAMES`, `VOLUME_NAMES`,
  `POSTGRES_PORTS`, `parseTopology` de CT.2.
- Produces: nada que importe otra tarea. Cierra el criterio `CDC:` del slice salvo los dos `it.todo`
  que dependen del `cron` (Parte 2).

- [ ] **Step 1: Convertir cinco de los siete `it.todo` en pruebas reales**

  Respetar el comentario de cabecera que dejó CT.2 (los `it.todo` no se borran, se convierten) y
  dejar como `it.todo` solo los dos que necesitan el `cron`, con el motivo entre paréntesis:

  ```ts
  const input = toTopologyInput(readComposeDocument(), {});
  const services = input.services.map((s) => ComposeServiceSchema.parse(s));

  it("reads docker-compose.yml and builds a ComposeTopology from its services and volumes", () => {
    expect(services.map((s) => s.name)).toEqual([
      "supabase-db", "supabase-kong", "supabase-auth", "supabase-rest",
      "supabase-realtime", "supabase-storage", "supabase-meta", "app",
    ]);
    expect(input.volumes.map((v) => ComposeVolumeSchema.parse(v).name)).toEqual(VOLUME_NAMES);
  });

  it.todo("parses that topology with parseTopology without errors (Parte 2: falta el servicio cron)");
  it.todo("declares every required service of SERVICE_NAMES (Parte 2: falta el servicio cron)");

  it("declares every volume of VOLUME_NAMES", () => { /* set de nombres === set de VOLUME_NAMES */ });

  it("pins every image and uses :latest nowhere", () => {
    // ComposeServiceSchema ya rechaza :latest y las imágenes sin tag al parsear arriba;
    // aquí se asserta además que ningún servicio con rol distinto de app/cron trae image null,
    // y que el texto crudo del archivo no contiene ":latest".
  });

  it("publishes no Postgres port (5432, 6543) on the host", () => {
    for (const service of services) {
      for (const port of service.publishedPorts) {
        expect(POSTGRES_PORTS).not.toContain(port.host);
        expect(POSTGRES_PORTS).not.toContain(port.container);
      }
    }
  });

  it("gives every service a healthcheck", () => {
    expect(services.filter((s) => !s.healthcheck)).toEqual([]);
  });

  it("publishes only on the loopback interface", () => {
    // R1: ninguna entrada de `ports` del archivo empieza por "0.0.0.0:" ni omite la IP del host.
    // Lee el YAML crudo, no la topología: la IP no es parte del contrato.
  });
  ```

- [ ] **Step 2: Correr la prueba y confirmar que pasa**

  Run: `npx vitest run contracts/base/compose-services.publisher.test.ts`
  Expected: PASS, con `2 todo` en el resumen. Si `ComposeServiceSchema.parse` falla, el que está mal
  es el compose (una imagen sin tag, un healthcheck ausente, un rol sin imagen): se corrige el
  compose, nunca el contrato.

- [ ] **Step 3: Verificación completa del repo**

  Run, en orden: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  Expected: todo PASS. `npm test` incluye `contracts/**` y `scripts/**`; la prueba de integración de
  la Tarea 6 sale como *skipped*.

- [ ] **Step 4: Commit**

  ```bash
  npx prettier --write contracts
  git add contracts/base/compose-services.publisher.test.ts
  git commit -m "test(compose): verificación del publicador de CT.2 sobre el docker-compose.yml (BASE.1)"
  ```

---

### Task 6: `docker compose up` en healthy sobre una máquina limpia

**Files:**
- Create: `scripts/compose/compose-up.it.test.ts`
- Create: `.github/workflows/compose-it.yml`

**Interfaces:**
- Consumes: el compose de la Tarea 3 y `scripts/supabase-keys.mjs` (Tarea 1).
- Produces: nada que importe otra tarea. La Parte 2 extiende este archivo con el `cron`.

- [ ] **Step 1: Escribir la prueba de integración**

  Apagada por defecto y protegida contra pisar un `.env` ajeno:

  ```ts
  const enabled = process.env.COMPOSE_IT === "1";

  describe.skipIf(!enabled)("docker compose up on a clean machine", () => {
    beforeAll(() => {
      if (existsSync(ENV_PATH)) throw new Error(".env already exists — run this on a clean machine");
      writeFileSync(ENV_PATH, readFileSync(".env.example", "utf8") + "\n" + mintKeys());
    }, 30_000);

    afterAll(() => {
      try { execFileSync("docker", ["compose", "down", "-v", "--remove-orphans"]); }
      finally { rmSync(ENV_PATH, { force: true }); }
    }, 300_000);

    it("brings every service to healthy", () => {
      // docker compose up -d --wait --wait-timeout 600 — el comando ES la aserción:
      // `--wait` sale distinto de cero si algún servicio no llega a healthy.
      // Luego `docker compose ps --format json` y assert de que cada línea trae Health === "healthy".
    }, 900_000);

    it("publishes no Postgres port on the host", () => {
      // `docker compose ps --format json` → Publishers: ningún PublishedPort en (5432, 6543).
      // Y `docker compose port supabase-db 5432` debe fallar.
    }, 60_000);

    it("publishes nothing on a public interface", () => {
      // Publishers: toda URL publicada tiene URL "127.0.0.1" (R1).
    }, 60_000);
  });
  ```

  `mintKeys()` es un helper local del archivo: corre `node scripts/supabase-keys.mjs` y devuelve su
  `stdout`, más las líneas `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y
  `META_APP_SECRET` derivadas de él, para que las definiciones generadas ganen a las de
  `.env.example` (en un `env_file` la última definición es la que vale).

- [ ] **Step 2: Correrla y confirmar que pasa**

  Run: `COMPOSE_IT=1 npx vitest run scripts/compose/compose-up.it.test.ts`
  Expected: PASS. Sin `COMPOSE_IT`: `skipped`.

- [ ] **Step 3: Escribir el workflow**

  `.github/workflows/compose-it.yml`: nombre `Compose IT`, `on: pull_request` (con
  `paths: [docker-compose.yml, .env.example, docker/**, scripts/compose/**, Dockerfile, .dockerignore, .github/workflows/compose-it.yml]`)
  y `on: push: branches: [main]`; mismo bloque `concurrency` que `ci.yml`; un job
  `runs-on: ubuntu-latest` con `timeout-minutes: 30`, `actions/checkout@v7`,
  `actions/setup-node@v7` con `node-version: 22` y `cache: npm`, `npm ci`, y
  `COMPOSE_IT=1 npx vitest run scripts/compose/compose-up.it.test.ts`. Un paso final con
  `if: failure()` que corra `docker compose ps` y `docker compose logs --tail 200` para que una
  caída se pueda leer sin reproducirla.

- [ ] **Step 4: Commit**

  ```bash
  npx prettier --write scripts .github/workflows/compose-it.yml
  git add scripts/compose/compose-up.it.test.ts .github/workflows/compose-it.yml
  git commit -m "test(compose): integración de docker compose up --wait en máquina limpia (BASE.1)"
  ```

- [ ] **Step 5: Abrir la PR de la Parte 1**

  ```bash
  git push -u origin <rama>
  gh pr create -R juancadavidc/wacrm-tenant-template --base main \
    --title "BASE.1 (Parte 1): Supabase autoalojado y verificación del compose"
  ```
  El cuerpo cita el `Está hecho cuando` del slice, la ruta
  `prds/wacrm-tenant-repo-template/slices/BASE.1-compose-healthy.md`, qué criterios cierra esta
  parte y cuáles quedan para la Parte 2, y las decisiones tomadas sin Juan. Confirmar que el diff no
  trae ningún `.env`: `git diff --stat origin/main`.

---

# Parte 2 — El cron de tareas programadas de wacrm

PR operable por sí sola, sobre la Parte 1 ya mergeada: agrega el noveno servicio y cierra los dos
`it.todo` que quedaban, con lo que `parseTopology` valida el compose completo.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `docker/cron/Dockerfile` (crear) | Imagen propia pineada: `alpine` + `curl`, sin instalar nada en el arranque. |
| `docker/cron/crontab` (crear) | Las dos tareas programadas de wacrm, nada más. |
| `docker/cron/run-task.sh` (crear) | Pega al endpoint con la cabecera del secreto, registra el resultado y escribe el latido. |
| `docker/cron/healthcheck.sh` (crear) | `crond` vivo y latido reciente. |
| `docker/cron/entrypoint.sh` (crear) | Renderiza el `crontab` con `CRON_SCHEDULE`, escribe el latido inicial y arranca `crond` en primer plano. |
| `docker-compose.yml` (modificar) | El servicio `cron`. |
| `.env.example` (modificar) | `AUTOMATION_CRON_SECRET` y `CRON_SCHEDULE`. |
| `contracts/base/compose-services.publisher.test.ts` (modificar) | Los dos `it.todo` restantes. |
| `scripts/compose/compose-up.it.test.ts` (modificar) | El `cron` en healthy y una ejecución real. |
| `docs/docker.md` (modificar) | Qué agenda el cron y cómo se cambia. |

---

### Task 1: La imagen del cron y sus scripts

**Files:**
- Create: `docker/cron/Dockerfile`
- Create: `docker/cron/entrypoint.sh`
- Create: `docker/cron/crontab`
- Create: `docker/cron/run-task.sh`
- Create: `docker/cron/healthcheck.sh`

**Interfaces:**
- Consumes: `.env.example` y el compose de la Parte 1.
- Produces: una imagen que, con `APP_URL`, `AUTOMATION_CRON_SECRET` y `CRON_SCHEDULE` en el
  entorno, agenda `GET $APP_URL/api/automations/cron` y `GET $APP_URL/api/flows/cron` con la
  cabecera `x-cron-secret`, escribe cada corrida en `stdout` y el latido en
  `/var/run/cron/last-run`. Tag propio: `wacrm/cron:1.0.0`.

- [ ] **Step 1: Escribir el `Dockerfile` y los scripts**

  `FROM alpine:3.22` (comprobar el tag con `docker manifest inspect` antes de commitear),
  `RUN apk add --no-cache curl` en *build*, `COPY` de los cuatro `.sh`/`crontab` con `chmod +x`,
  `HEALTHCHECK` declarado en el compose (no en el `Dockerfile`, para que el lector de la Parte 1 lo
  vea). `entrypoint.sh`: sustituye `@SCHEDULE@` del `crontab` por `$CRON_SCHEDULE`, lo instala con
  `crontab -`, escribe `/var/run/cron/last-run` con la fecha de arranque y hace
  `exec crond -f -l 8`. `run-task.sh <ruta>`: `curl -sS -m 60 -o /tmp/out -w '%{http_code}'` con
  `-H "x-cron-secret: $AUTOMATION_CRON_SECRET"`, imprime `<ruta> <código>` y el cuerpo, escribe el
  latido, y sale distinto de cero si el código no es 2xx (para que quede en el log de `crond`).
  `healthcheck.sh`: `pgrep crond` y latido con menos de
  `$((CRON_HEARTBEAT_MAX_AGE:-900))` segundos de antigüedad.

- [ ] **Step 2: Probar la imagen suelta, sin compose**

  ```bash
  docker build -t wacrm/cron:1.0.0 docker/cron
  docker run --rm -e CRON_SCHEDULE='* * * * *' -e APP_URL=http://example.invalid \
    -e AUTOMATION_CRON_SECRET=x --entrypoint sh wacrm/cron:1.0.0 \
    -c '/entrypoint.sh & sleep 3; /healthcheck.sh && echo HEALTHY'
  ```
  Expected: `HEALTHY`. Y `docker run --rm wacrm/cron:1.0.0 -- sh -c 'command -v curl crond'`
  resuelve los dos.

- [ ] **Step 3: Commit**

  ```bash
  git add docker/cron
  git commit -m "feat(cron): imagen con crond y curl para las tareas programadas de wacrm (BASE.1)"
  ```

---

### Task 2: El servicio `cron` en el compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `contracts/base/compose-services.publisher.test.ts`

**Interfaces:**
- Consumes: la imagen de la Tarea 1; `parseTopology`, `SERVICE_NAMES`, `OPTIONAL_SERVICE_NAMES` de
  CT.2; `toTopologyInput`, `readComposeDocument` de la Parte 1.
- Produces: el compose completo, que `parseTopology` valida sin errores.

- [ ] **Step 1: Convertir los dos `it.todo` que quedan**

  ```ts
  it("parses that topology with parseTopology without errors", () => {
    expect(() => parseTopology(toTopologyInput(readComposeDocument(), {}))).not.toThrow();
  });

  it("declares every required service of SERVICE_NAMES", () => {
    const declared = new Set(parseTopology(toTopologyInput(readComposeDocument(), {}))
      .services.map((s) => s.name));
    const required = SERVICE_NAMES.filter((n) => !OPTIONAL_SERVICE_NAMES.includes(n));
    expect([...required].filter((n) => !declared.has(n))).toEqual([]);
  });
  ```

- [ ] **Step 2: Correrlas y confirmar que fallan**

  Run: `npx vitest run contracts/base/compose-services.publisher.test.ts`
  Expected: FAIL — falta el servicio con rol `cron`, y `parseTopology` lo reporta por nombre.

- [ ] **Step 3: Agregar el servicio y sus variables**

  En `docker-compose.yml`, el servicio `cron` con `build: ./docker/cron`, `image: wacrm/cron:1.0.0`
  (las dos, para que la topología vea una imagen pineada), `env_file: .env`,
  `environment: APP_URL: http://app:3000`, sin `ports`, sin volúmenes nombrados,
  `restart: unless-stopped`, `depends_on: { app: { condition: service_healthy } }` y
  `healthcheck: { test: ["CMD", "/healthcheck.sh"], interval: 60s, timeout: 10s, retries: 3, start_period: 30s }`.
  En `.env.example`, `AUTOMATION_CRON_SECRET` con el marcador de generado y `CRON_SCHEDULE=*/5 * * * *`
  con el comentario de qué agenda.

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

  Run: `npx vitest run contracts/base/compose-services.publisher.test.ts`
  Expected: PASS, `0 todo`. Ya no queda ninguna prueba pendiente del publicador de CT.2.

- [ ] **Step 5: Commit**

  ```bash
  npx prettier --write docker-compose.yml contracts
  git add docker-compose.yml .env.example contracts/base/compose-services.publisher.test.ts
  git commit -m "feat(compose): servicio cron y verificación completa del publicador de CT.2 (BASE.1)"
  ```

---

### Task 3: El cron dentro de la prueba de máquina limpia, y la documentación

**Files:**
- Modify: `scripts/compose/compose-up.it.test.ts`
- Modify: `docs/docker.md`

**Interfaces:**
- Consumes: la prueba de integración de la Parte 1 y el servicio `cron` de la Tarea 2.
- Produces: el criterio «todos los servicios en *healthy*» cerrado con los nueve servicios.

- [ ] **Step 1: Extender la prueba de integración**

  En la lista de servicios que deben quedar `healthy`, los nueve. Y un caso nuevo:

  ```ts
  it("runs the wacrm scheduled tasks from inside the compose network", () => {
    // CRON_SCHEDULE='* * * * *' en el .env que escribe beforeAll, y luego:
    // `docker compose logs cron` contiene "/api/automations/cron 200" y "/api/flows/cron 200"
    // antes de los 180 s. 200 y no 503 prueba que el secreto llegó.
  }, 300_000);
  ```

  `beforeAll` escribe `CRON_SCHEDULE=* * * * *` al final del `.env` para no esperar cinco minutos.

- [ ] **Step 2: Correrla y confirmar que pasa**

  Run: `COMPOSE_IT=1 npx vitest run scripts/compose/compose-up.it.test.ts`
  Expected: PASS, nueve servicios en `healthy`.

- [ ] **Step 3: Documentar el cron**

  En `docs/docker.md`, reemplazar la nota «Nothing inside the container is scheduled» por lo que
  hace el servicio `cron`: los dos endpoints, `CRON_SCHEDULE`, que `AUTOMATION_CRON_SECRET` es
  obligatoria (sin ella los endpoints responden 503), cómo ver sus corridas
  (`docker compose logs -f cron`) y que el backup diario de BAK.1 se agregará a este mismo cron.

- [ ] **Step 4: Verificación completa del repo**

  Run, en orden: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  Expected: todo PASS, sin `todo` pendientes en `contracts/base/compose-services.publisher.test.ts`.

- [ ] **Step 5: Commit y PR de la Parte 2**

  ```bash
  npx prettier --write scripts docs/docker.md
  git add scripts/compose/compose-up.it.test.ts docs/docker.md
  git commit -m "test(compose): el cron en la prueba de máquina limpia y su documentación (BASE.1)"
  git push -u origin <rama>
  gh pr create -R juancadavidc/wacrm-tenant-template --base main \
    --title "BASE.1 (Parte 2): cron de tareas programadas de wacrm"
  ```

---

## Mapa de criterios

| Criterio del slice | Dónde queda |
|---|---|
| IT: en una máquina limpia, `docker compose up` deja todos los servicios en *healthy* | Parte 1, Tarea 6 (`scripts/compose/compose-up.it.test.ts` + `.github/workflows/compose-it.yml`, ocho servicios) y Parte 2, Tarea 3 (los nueve) |
| IT: ningún puerto de Postgres queda publicado en el host | Parte 1, Tarea 5, Paso 1 (`publishes no Postgres port…`, contra el archivo) y Tarea 6, Paso 1 (contra el stack corriendo, incluido `docker compose port supabase-db 5432`) |
| IT: ninguna imagen del compose usa `:latest` | Parte 1, Tarea 5, Paso 1 (`pins every image…`, vía `ComposeServiceSchema`) y Tarea 2, Paso 1 (el lector no se come un tag inválido) |
| CDC: la prueba de verificación de CT.2 pasa | Parte 1, Tarea 5 (cinco `it.todo` convertidos) y Parte 2, Tarea 2 (los dos últimos) |
| `Entra`: `docker-compose.yml` con Supabase autoalojado, el fork y el cron | Parte 1, Tarea 3 + Parte 2, Tarea 2 |
| `Entra`: healthchecks de cada servicio | Parte 1, Tarea 3, Pasos 4–5; verificado en Tarea 5 (`gives every service a healthcheck`) |
| `Entra`: imágenes con versión exacta | Parte 1, Tarea 3, Paso 2 (`docker manifest inspect`) + Tarea 5 |
| `Entra`: Postgres (5432, 6543) sin publicar | Parte 1, Tarea 3, Paso 4 (`supabase-db` sin `ports`) |
| `Entra`: `.env.example` sin secretos | Parte 1, Tarea 3, Pasos 1 y 7 |
| `No entra`: túnel y webhook, backup, config por empresa | Ninguna tarea agrega `cloudflared`, líneas de backup al `crontab` ni `policies.yaml` |

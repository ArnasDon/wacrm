# BAK.1 · Backup diario fuera del equipo con aviso de fallo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la instalación respalde a diario, a las 3:00, la base y el storage con los nombres del
contrato `I2`, suba el respaldo al destino que la empresa configuró según `I1` y avise por webhook
cuando la subida falla.

**Architecture:** la lógica vive en `src/lib/backup/` como módulos puros con puertos inyectados
(ejecutar comando, subir, avisar, reloj), así los dos criterios `IT` se verifican con vitest sin
docker: `contrato.ts` traduce lo que BAK.1 le pide a CT.1 y CT.2 (config de la empresa y nombres de
servicios/volúmenes), `destino.ts` resuelve el subidor según el esquema de la URI, `aviso.ts` emite
el webhook de fallo y `tarea.ts` orquesta volcado → empaquetado → manifiesto → subida. El disparo
sigue el patrón que ya tiene el repo para tareas programadas: un route handler
`GET /api/backup/cron` protegido por `x-cron-secret`, que el cron del compose llama a las 3:00.

**Tech Stack:** TypeScript 6 (strict), Next 16 (route handler, runtime Node), zod 4, vitest 5,
Node 22, `pg_dump` + `tar` + `rclone` como binarios de la imagen.

**Spec:** `prd-hub` → `prds/wacrm-tenant-repo-template/slices/BAK.1-backup-diario.md`
(origen: `03-alcance#backups`, `05-reglas#r9`, `05-reglas#r11`).
Contratos que consume: `prds/.../slices/CT.1-contrato-config-empresa.md` →
`contracts/cfg/tenant-config.ts`; `prds/.../slices/CT.2-contrato-servicios-compose.md` →
`contracts/base/compose-services.ts`.
Slices vecinos: BASE.1 (escribe el compose y el servicio `cron`), CFG.1 (publica `I1`),
BAK.2 (restauración, fuera de este plan).

## Está hecho cuando (del slice, literal)

- `IT:` la tarea genera el backup de la base y el storage con los nombres de CT.2 y lo sube al
  destino configurado según CT.1 → Tareas 1, 2 y 5.
- `IT:` si la subida falla, se emite el aviso → Tareas 3 y 5.
- `CDC:` las pruebas contra los stubs de CT.1 y CT.2 pasan → Tareas 1, 5 y 6 (todas las pruebas de
  BAK.1 corren contra `stubTenantConfig()` y `BASE_TOPOLOGY`, nunca contra el publicador), más las
  CDC que ya traen los contratos (`contracts/cfg/tenant-config.cdc-bak.test.ts`,
  `contracts/base/cdc/bak.cdc.test.ts`).

## No entra (del slice, literal)

- Restauración (BAK.2) → este plan no escribe ningún script ni endpoint de restauración; el
  `manifiesto.json` solo describe lo que se subió.
- Alta disponibilidad → no se toca `docker-compose.yml`, ni réplicas, ni failover.

## Precondición (verificar antes de la Tarea 1)

El código de CT.1 y CT.2 tiene que estar en `main`. Hoy en `main` solo están **los planes** de los
dos contratos (`docs/superpowers/plans/ct.1-contrato-config-empresa.md` y
`docs/superpowers/plans/2026-10-21-ct.2-contrato-servicios-compose.md`), no los módulos. Antes de
empezar:

```bash
git fetch origin && git ls-tree -r --name-only origin/main | grep '^contracts/'
```

Deben aparecer `contracts/cfg/tenant-config.ts`, `contracts/cfg/tenant-config.stub.ts`,
`contracts/base/compose-services.ts` y `contracts/base/compose-services.stub.ts`. Si falta alguno,
**no se implementa BAK.1**: se reporta el bloqueo (BAK.1 consume esos contratos) y se espera a que
CT.1 y CT.2 estén mergeados. Los símbolos que este plan usa son exactamente los que esos dos planes
fijan en sus bloques *Produces*.

## Global Constraints

- Verificación completa del repo (de `.claude/avanzar-repo.yaml`): `npm ci`, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`. Verificación dirigida:
  `npx vitest run <archivos>`.
- Estilo del repo en `src/`: comillas simples, punto y coma, `printWidth` 80 (`.prettierrc`);
  identificadores y comentarios de `src/` en **inglés** como el resto del fork, salvo los nombres
  de dominio que ya fija el PRD. Este plan y los mensajes de commit, en español.
- La hora del backup es `03:00` y no es configurable (R9). La constante viene del contrato
  (`HORA_BACKUP` de CT.1); BAK.1 no la redefine.
- Si la subida falla, se avisa; nada falla en silencio (R11).
- Los nombres del archivo de la base y de los archivos del storage salen de los helpers de CT.2
  (`databaseServiceName`, `backupVolumeNames`), nunca de literales escritos en `src/`.
- El destino y la credencial salen de `BackupConfigSchema` de CT.1: esquemas aceptados `s3://`,
  `b2://`, `gs://`, `file://`; credencial no vacía; aviso con forma de URL.
- Ningún contrato se edita en este slice. Si algo del contrato estorba, se anota, no se cambia.
- Archivos calientes frente al upstream (`package.json`, `package-lock.json`): **no se tocan**; este
  plan no agrega dependencias npm.
- `docker-compose.yml` es de BASE.1: no se toca. Lo que BAK.1 necesita del compose queda escrito en
  `docs/backups.md` como requisito para BASE.1.
- Ningún mensaje de commit ni cuerpo de PR lleva atribución a Claude/Anthropic/IA.
- Nada de secretos en el repo: `.env.local.example` solo lleva ejemplos sin valor real.

## Review Focus

1. **Credencial en el log o en el disco.** `rclone` recibe la credencial por un archivo temporal con
   permisos `0600` que se borra siempre (incluso si el comando falla), y ni el error del comando ni
   el cuerpo del aviso incluyen la credencial. → Tarea 2, Paso 1 y Tarea 3, Paso 1.
2. **La subida falla pero el aviso también.** El webhook puede estar caído justo cuando se lo
   necesita: el fallo de la subida se reporta igual (código 500 en la ruta y mensaje en stderr) y el
   fallo del aviso no reemplaza al fallo original. → Tarea 3, Paso 1 y Tarea 5, Paso 1.
3. **Dos backups a la vez.** Si el cron se dispara dos veces (reintento del scheduler, cron mal
   puesto), el segundo no debe volcar la base en paralelo: la ruta responde 409 mientras hay uno en
   curso. → Tarea 5, Paso 1.
4. **El volcado se sube vacío o truncado.** Un `pg_dump` que termina con código 0 pero deja un
   archivo de 0 bytes no cuenta como backup: la tarea falla y avisa antes de subir. → Tarea 4,
   Paso 1.
5. **Nombres de servicio o volumen que cambiaron.** Si el compose renombró `supabase-db`, los
   helpers de CT.2 lanzan y el backup falla con el rol en el mensaje en vez de respaldar algo que no
   existe. → Tarea 1, Paso 1.

## Decisiones tomadas sin Juan

1. **El disparo es un route handler, no un script.** La imagen de runtime del `Dockerfile` es
   `.next/standalone`: no lleva `scripts/`, así que un script suelto no existiría en producción. El
   repo ya resuelve las tareas programadas con rutas protegidas por `x-cron-secret`
   (`/api/automations/cron`, `/api/flows/cron`, ver `docs/docker.md`), y BAK.1 sigue ese patrón:
   `GET /api/backup/cron`. El cron del compose solo agrega una línea que llama la ruta a las 3:00.
2. **Se reutiliza `AUTOMATION_CRON_SECRET`** en vez de inventar `BACKUP_CRON_SECRET`: CT.1 fija qué
   variables son de la empresa y un nombre nuevo quedaría fuera de `VARS_EMPRESA`. Es el mismo cron
   y el mismo secreto compartido.
3. **La conexión a la base se lee de `BACKUP_DB_URL`** (una sola variable, URL de Postgres
   completa). El host por defecto que documenta `.env.local.example` es el nombre del servicio de
   CT.2 (`supabase-db`), y la tarea verifica que el host de la URL sea ese nombre antes de volcar.
4. **Un solo subidor por esquema:** `file://` se implementa con `node:fs` (real, probado en un
   directorio temporal) y `s3://`/`b2://`/`gs://` con un único `rclone copyto`, ejecutado por el
   mismo puerto de comandos que `pg_dump` y `tar`. Tres SDK distintos para un slice de backup no se
   justifican y `rclone` cubre los tres esquemas que CT.1 acepta.
5. **`BACKUP_DESTINO_CREDENCIAL` es el cuerpo de un remoto de `rclone`** (líneas `clave = valor`,
   **sin** la cabecera de sección). BAK.1 escribe `[destino]` y le pega ese cuerpo. Queda
   documentado en `.env.local.example`.
6. **Layout en el destino:** `<destinoUri>/<marca de tiempo>/<archivo>`, con la marca
   `2026-10-21T03-00-00-000Z` (el `:` de ISO cambiado por `-`, seguro en claves de S3).
7. **Nombres de los archivos:** `<servicio de rol db>.dump` (formato `custom` de `pg_dump`, ya
   comprimido, por eso no lleva `.gz`) y `<volumen>.tar.gz` para cada volumen
   de `backupVolumeNames`, es decir `supabase-db.dump`, `supabase-db-data.tar.gz` y
   `supabase-storage-data.tar.gz` con los nombres de hoy del contrato. Más `manifiesto.json` con
   tamaño y `sha256` de cada archivo: es parte de *generar* el backup y es lo que BAK.2 necesitará
   para saber qué restaurar.
8. **El storage se respalda desde el volumen montado**, con la ruta fija `/var/lib/<volumen>` (sin
   variable de entorno nueva: el montaje lo fija la plantilla, no la empresa). Qué montar queda
   escrito en `docs/backups.md` para BASE.1.
9. **La topología que usa producción se declara en `src/lib/backup/contrato.ts`** y pasa por
   `parseTopology` del contrato; una prueba compara sus nombres con `BASE_TOPOLOGY` del stub de
   CT.2, así no puede desviarse en silencio. El contrato publica la topología canónica solo en el
   stub y un módulo de producción no debe importar un `.stub.ts`.
10. **Se avisa también si falla el volcado o el empaquetado**, no solo la subida: un volcado fallido
    deja igualmente a la empresa sin backup y R11 dice que nada falla en silencio. El criterio del
    slice (fallo de subida) queda cubierto como caso particular.
11. **El respaldo local se arma en un directorio temporal** (`fs.mkdtemp` en `os.tmpdir()`) y se
    borra después de subir: el backup vive "fuera del equipo", no dentro del contenedor.
12. **Sin rotación ni retención en el destino, y sin cifrado extra del archivo.** El slice no los
    pide; la `ENCRYPTION_KEY` y su respaldo son de BAK.2 (R15).
13. **El plan se parte en dos PR** (Parte 1 y Parte 2) porque toca 15 archivos: Parte 1 deja los
    módulos de contrato, destino y aviso con sus pruebas; Parte 2 los orquesta, los expone en el
    cron y ajusta imagen y documentación.

**Para confirmar con Juan:**

- `BACKUP_DB_URL` no está entre las variables que CT.1 declara de la empresa (`VARS_EMPRESA` lista
  `BACKUP_DESTINO_URI`, `BACKUP_DESTINO_CREDENCIAL` y `BACKUP_AVISO_WEBHOOK`), y es un secreto de la
  empresa. Agregarla a `VARS_EMPRESA` es un cambio de contrato de CT.1 que arrastra a CFG.1; aquí no
  se toca el contrato y la prueba de BAK.1 solo afirma lo que CT.1 ya declara.
- El formato de `BACKUP_DESTINO_CREDENCIAL` (cuerpo de remoto de `rclone`) y la dependencia de
  `rclone` + `postgresql-client` en la imagen.
- Que el backup corra dentro del contenedor `app` (y por lo tanto que `app` monte los volúmenes de
  datos en solo lectura), en vez de en un contenedor propio.

## Verificación manual

El `Está hecho cuando` de BAK.1 no tiene criterios `manual:`: los dos `IT` y el `CDC` se verifican
con `npm test`. Queda anotado, sin tarea en este plan, que una subida real a `s3://`/`b2://`/`gs://`
solo se puede comprobar con credenciales reales y que eso se verifica en el montaje de CFG.3 y en la
restauración de BAK.2.

## File Structure

| Archivo | Responsabilidad | Parte |
|---|---|---|
| `src/lib/backup/contrato.ts` (crear) | Todo lo que BAK.1 le pide a CT.1 y CT.2: `backupConfigFromEnv`, la topología de producción validada con `parseTopology`, `backupArtifacts` (nombres de los archivos) y `destinationFolder`. | 1 |
| `src/lib/backup/contrato.test.ts` (crear) | Pruebas contra los stubs de CT.1 y CT.2 de la lectura de config y de los nombres. | 1 |
| `src/lib/backup/destino.ts` (crear) | `createUploader`: subidor `file://` con `node:fs` y subidor `rclone` para `s3`/`b2`/`gs`, más los reintentos. | 1 |
| `src/lib/backup/destino.test.ts` (crear) | Subida real a un directorio temporal, comando de `rclone` esperado, manejo de la credencial y reintentos. | 1 |
| `src/lib/backup/aviso.ts` (crear) | `notifyFailure`: POST del aviso al webhook de CT.1, con tiempo límite y sin filtrar secretos. | 1 |
| `src/lib/backup/aviso.test.ts` (crear) | Cuerpo del aviso, tiempo límite y qué pasa si el webhook falla. | 1 |
| `src/lib/backup/comandos.ts` (crear) | `runCommand`: único adaptador real de `node:child_process` detrás del puerto `CommandRunner`. | 2 |
| `src/lib/backup/comandos.test.ts` (crear) | Código de salida, captura de stderr y tiempo límite con comandos de verdad. | 2 |
| `src/lib/backup/tarea.ts` (crear) | `runDailyBackup`: volcado, empaquetado, manifiesto, subida y aviso de fallo. | 2 |
| `src/lib/backup/tarea.test.ts` (crear) | Los dos criterios `IT` de punta a punta con puertos falsos y destino `file://`. | 2 |
| `src/app/api/backup/cron/route.ts` (crear) | `GET /api/backup/cron`: secreto compartido, cerrojo contra solapamiento y traducción del resultado a código HTTP. | 2 |
| `src/app/api/backup/cron/route.test.ts` (crear) | 401 sin secreto, 200 en éxito, 500 en fallo, 409 si ya corre uno. | 2 |
| `docs/backups.md` (crear) | Qué respalda, a dónde, a qué hora, qué variables pide y qué tiene que darle BASE.1 (montajes y línea de cron). | 2 |
| `.env.local.example` (modificar) | Bloque comentado de `BACKUP_DESTINO_URI`, `BACKUP_DESTINO_CREDENCIAL`, `BACKUP_AVISO_WEBHOOK` y `BACKUP_DB_URL`. | 2 |
| `Dockerfile` (modificar: etapa `runner`) | `postgresql-client` y `rclone` en la imagen de runtime. | 2 |

---

# Parte 1 — lo que BAK.1 le pide a los contratos, el destino y el aviso

PR operable por sí sola: tres módulos con sus pruebas, sin cambiar el comportamiento de la app.
Cubre el `CDC` del slice y deja listos los pedazos que la Parte 2 orquesta.

### Task 1: Config de la empresa y nombres del backup, contra los stubs

**Files:**
- Create: `src/lib/backup/contrato.ts`
- Test: `src/lib/backup/contrato.test.ts`
- Modify (solo si falta): `tsconfig.json` (`compilerOptions.paths`), `vitest.config.ts`
  (`test.include`)

**Interfaces:**
- Consumes, de `@contracts/cfg/tenant-config` (CT.1): `BackupConfigSchema`, `HORA_BACKUP`,
  `type TenantConfig`. De `@contracts/base/compose-services` (CT.2): `parseTopology`,
  `databaseServiceName`, `backupVolumeNames`, `type ComposeTopology`,
  `type ComposeTopologyInput`.
- Produces:
  ```ts
  export type BackupConfig = z.infer<typeof BackupConfigSchema>;
  export function backupConfigFromEnv(env: NodeJS.ProcessEnv): BackupConfig; // lanza z.ZodError
  export function databaseUrlFromEnv(env: NodeJS.ProcessEnv, topology: ComposeTopology): string;
  export const TEMPLATE_TOPOLOGY_INPUT: ComposeTopologyInput;
  export function templateTopology(): ComposeTopology; // parseTopology(TEMPLATE_TOPOLOGY_INPUT)
  export type BackupArtifact =
    | { kind: 'database'; service: string; fileName: string }
    | { kind: 'volume'; volume: string; sourcePath: string; fileName: string };
  export function backupArtifacts(topology: ComposeTopology): BackupArtifact[];
  export function destinationFolder(now: Date): string;
  export const VOLUME_MOUNT_ROOT = '/var/lib';
  ```

- [ ] **Step 1: Write the failing test** — `src/lib/backup/contrato.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { BASE_TOPOLOGY } from '@contracts/base/compose-services.stub';
import { HORA_BACKUP } from '@contracts/cfg/tenant-config';
import { stubTenantConfig } from '@contracts/cfg/tenant-config.stub';
import {
  backupArtifacts,
  backupConfigFromEnv,
  databaseUrlFromEnv,
  destinationFolder,
  templateTopology,
} from './contrato';

const env = {
  BACKUP_DESTINO_URI: 's3://backups-demo/empresa-demo',
  BACKUP_DESTINO_CREDENCIAL: 'type = s3\naccess_key_id = ak\nsecret_access_key = sk',
  BACKUP_AVISO_WEBHOOK: 'https://avisos.example.com/backup',
  BACKUP_DB_URL: 'postgresql://postgres:pw@supabase-db:5432/postgres',
};

describe('backupConfigFromEnv', () => {
  it('reads the tenant backup settings through the CT.1 schema', () => {
    const config = backupConfigFromEnv(env);
    expect(config.destinoUri).toBe('s3://backups-demo/empresa-demo');
    expect(config.credencial.length).toBeGreaterThan(0);
    expect(config.avisoWebhook).toBe('https://avisos.example.com/backup');
    expect(config.hora).toBe(HORA_BACKUP);
  });

  it('accepts every destination scheme the contract allows', () => {
    for (const uri of ['s3://b/p', 'b2://b/p', 'gs://b/p', 'file:///var/backups']) {
      expect(backupConfigFromEnv({ ...env, BACKUP_DESTINO_URI: uri }).destinoUri).toBe(uri);
    }
  });

  it.each([
    { BACKUP_DESTINO_URI: 'http://backups.example.com' },
    { BACKUP_DESTINO_CREDENCIAL: '' },
    { BACKUP_AVISO_WEBHOOK: 'avisame' },
    { BACKUP_DESTINO_URI: undefined },
  ])('refuses a tenant config the contract rejects: %o', (patch) => {
    expect(() => backupConfigFromEnv({ ...env, ...patch })).toThrow();
  });

  it('devuelve la misma forma que el stub de CT.1 le entrega a BAK', () => {
    expect(Object.keys(backupConfigFromEnv(env)).sort()).toEqual(
      Object.keys(stubTenantConfig().backup).sort(),
    );
  });
});

describe('databaseUrlFromEnv', () => {
  it('takes the url from the environment when it points at the contract service', () => {
    expect(databaseUrlFromEnv(env, BASE_TOPOLOGY)).toBe(env.BACKUP_DB_URL);
  });

  it('refuses a url whose host is not the service CT.2 names', () => {
    expect(() =>
      databaseUrlFromEnv({ ...env, BACKUP_DB_URL: 'postgresql://postgres:pw@db:5432/postgres' }, BASE_TOPOLOGY),
    ).toThrow(/supabase-db/);
  });

  it('refuses a missing or non-postgres url', () => {
    expect(() => databaseUrlFromEnv({ ...env, BACKUP_DB_URL: undefined }, BASE_TOPOLOGY)).toThrow();
    expect(() =>
      databaseUrlFromEnv({ ...env, BACKUP_DB_URL: 'mysql://supabase-db:3306/x' }, BASE_TOPOLOGY),
    ).toThrow();
  });
});

describe('templateTopology', () => {
  it('matches the names of the CT.2 stub, so it cannot drift from the contract', () => {
    expect(templateTopology().services.map((s) => s.name)).toEqual(
      BASE_TOPOLOGY.services.map((s) => s.name),
    );
    expect(templateTopology().volumes.map((v) => v.name)).toEqual(
      BASE_TOPOLOGY.volumes.map((v) => v.name),
    );
  });
});

describe('backupArtifacts', () => {
  it('names the database dump after the CT.2 db service', () => {
    const [first] = backupArtifacts(BASE_TOPOLOGY);
    expect(first).toEqual({
      kind: 'database',
      service: 'supabase-db',
      fileName: 'supabase-db.dump',
    });
  });

  it('names one archive per CT.2 backup volume, mounted under /var/lib', () => {
    expect(backupArtifacts(BASE_TOPOLOGY).slice(1)).toEqual([
      {
        kind: 'volume',
        volume: 'supabase-db-data',
        sourcePath: '/var/lib/supabase-db-data',
        fileName: 'supabase-db-data.tar.gz',
      },
      {
        kind: 'volume',
        volume: 'supabase-storage-data',
        sourcePath: '/var/lib/supabase-storage-data',
        fileName: 'supabase-storage-data.tar.gz',
      },
    ]);
  });

  it('fails loudly when the topology renamed the database service', () => {
    const renamed = {
      ...BASE_TOPOLOGY,
      services: BASE_TOPOLOGY.services.filter((s) => s.role !== 'db'),
    };
    expect(() => backupArtifacts(renamed)).toThrow();
  });
});

describe('destinationFolder', () => {
  it('is an S3-safe timestamp', () => {
    expect(destinationFolder(new Date('2026-10-21T03:00:00.000Z'))).toBe(
      '2026-10-21T03-00-00-000Z',
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/backup/contrato.test.ts`
Expected: FAIL — no resuelve `./contrato`. Si además no resuelve `@contracts/...`, agregar en
`tsconfig.json` → `compilerOptions.paths` la entrada `"@contracts/*": ["./contracts/*"]` y en
`vitest.config.ts` → `test.include` el patrón `"contracts/**/*.test.ts"` (los dos son cambios de una
línea que CT.2 ya debería haber dejado; se agregan solo si faltan).

- [ ] **Step 3: Implementar `src/lib/backup/contrato.ts`**

Firmas en el bloque *Interfaces*. Lo que las pruebas no determinan:

- `backupConfigFromEnv` arma `{ destinoUri, credencial, avisoWebhook }` desde
  `BACKUP_DESTINO_URI`, `BACKUP_DESTINO_CREDENCIAL` y `BACKUP_AVISO_WEBHOOK` y devuelve
  `BackupConfigSchema.parse(...)`, sin pasar `hora` (el contrato le pone el valor por defecto).
- `databaseUrlFromEnv` exige `BACKUP_DB_URL`, la parsea con `new URL`, acepta protocolos
  `postgres:`/`postgresql:` y exige que `hostname` sea `databaseServiceName(topology)`; el mensaje
  de error nombra el servicio esperado y **no** incluye la URL (lleva la contraseña).
- `TEMPLATE_TOPOLOGY_INPUT` declara los mismos nueve servicios de fase 1 y los dos volúmenes
  `inBackup: true` que describe el plan de CT.2 (`docs/superpowers/plans/2026-10-21-ct.2-contrato-servicios-compose.md`,
  Tarea 3, Paso 4); `templateTopology()` lo pasa por `parseTopology`.
- `backupArtifacts` devuelve primero el volcado de la base (`databaseServiceName`) y después un
  artefacto por volumen de `backupVolumeNames`, en el orden del contrato, con
  `sourcePath = \`${VOLUME_MOUNT_ROOT}/${volumen}\``.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/backup/contrato.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/backup
git add src/lib/backup/contrato.ts src/lib/backup/contrato.test.ts
# solo si el Paso 2 los tuvo que tocar:
# git add tsconfig.json vitest.config.ts
git commit -m "feat(backup): lee la config de la empresa y los nombres del backup de los contratos (BAK.1)"
```

---

### Task 2: Subida al destino configurado

**Files:**
- Create: `src/lib/backup/destino.ts`
- Test: `src/lib/backup/destino.test.ts`

**Interfaces:**
- Consumes: `BackupConfig` de la Tarea 1.
- Produces:
  ```ts
  export type CommandResult = { code: number; stdout: string; stderr: string };
  export type CommandRunner = (
    command: string,
    args: string[],
    options?: { timeoutMs?: number },
  ) => Promise<CommandResult>;
  export type Uploader = {
    scheme: 'file' | 's3' | 'b2' | 'gs';
    upload: (localPath: string, remoteName: string) => Promise<void>; // lanza Error si falla
  };
  export function createUploader(
    config: BackupConfig,
    folder: string,
    deps: { run: CommandRunner; attempts?: number; sleep?: (ms: number) => Promise<void> },
  ): Uploader;
  ```
  `attempts` por defecto 3 y `sleep` por defecto un `setTimeout` con espera 1 s y 4 s entre
  intentos.

- [ ] **Step 1: Write the failing test** — `src/lib/backup/destino.test.ts`

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createUploader, type CommandRunner } from './destino';

const base = {
  credencial: 'type = s3\naccess_key_id = ak\nsecret_access_key = sk',
  avisoWebhook: 'https://avisos.example.com/backup',
  hora: '03:00' as const,
};
const ok: CommandRunner = async () => ({ code: 0, stdout: '', stderr: '' });
const nap = async () => undefined;

async function localFile(contents = 'dump') {
  const dir = await mkdtemp(join(tmpdir(), 'bak1-'));
  const path = join(dir, 'supabase-db.dump');
  await writeFile(path, contents);
  return { dir, path };
}

describe('file:// uploader', () => {
  it('copies the artifact into <path>/<folder>/<name>, creating the folder', async () => {
    const { dir, path } = await localFile('contenido');
    const target = join(dir, 'destino');
    const uploader = createUploader(
      { ...base, destinoUri: `file://${target}` },
      '2026-10-21T03-00-00-000Z',
      { run: ok, sleep: nap },
    );
    await uploader.upload(path, 'supabase-db.dump');
    const copied = join(target, '2026-10-21T03-00-00-000Z', 'supabase-db.dump');
    expect(await readFile(copied, 'utf8')).toBe('contenido');
  });
});

describe('rclone uploader', () => {
  it('copies to <remote>:<bucket/prefix>/<folder>/<name> with a config file', async () => {
    const { path } = await localFile();
    const run = vi.fn(ok);
    const uploader = createUploader(
      { ...base, destinoUri: 's3://backups-demo/empresa-demo' },
      '2026-10-21T03-00-00-000Z',
      { run, sleep: nap },
    );
    await uploader.upload(path, 'supabase-db.dump');
    const [command, args] = run.mock.calls[0];
    expect(command).toBe('rclone');
    expect(args).toContain('copyto');
    expect(args).toContain(path);
    expect(args).toContain(
      'destino:backups-demo/empresa-demo/2026-10-21T03-00-00-000Z/supabase-db.dump',
    );
    const configPath = args[args.indexOf('--config') + 1];
    expect(configPath).toMatch(/\.conf$/);
  });

  it('writes the credential to a 0600 file under [destino] and deletes it afterwards', async () => {
    const { path } = await localFile();
    let seen = { mode: 0, body: '' };
    const run: CommandRunner = async (_c, args) => {
      const configPath = args[args.indexOf('--config') + 1];
      const { stat } = await import('node:fs/promises');
      seen = {
        mode: (await stat(configPath)).mode & 0o777,
        body: await readFile(configPath, 'utf8'),
      };
      return { code: 0, stdout: '', stderr: '' };
    };
    const uploader = createUploader({ ...base, destinoUri: 's3://b/p' }, 'f', { run, sleep: nap });
    await uploader.upload(path, 'x.gz');
    expect(seen.mode).toBe(0o600);
    expect(seen.body).toBe(`[destino]\n${base.credencial}\n`);
  });

  it('deletes the credential file even when the command fails', async () => {
    const { path } = await localFile();
    let configPath = '';
    const run: CommandRunner = async (_c, args) => {
      configPath = args[args.indexOf('--config') + 1];
      return { code: 1, stdout: '', stderr: 'boom' };
    };
    const uploader = createUploader({ ...base, destinoUri: 's3://b/p' }, 'f', {
      run,
      attempts: 1,
      sleep: nap,
    });
    await expect(uploader.upload(path, 'x.gz')).rejects.toThrow();
    const { access } = await import('node:fs/promises');
    await expect(access(configPath)).rejects.toThrow();
  });

  it('retries three times and reports the last stderr without the credential', async () => {
    const { path } = await localFile();
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'quota exceeded' }));
    const uploader = createUploader({ ...base, destinoUri: 's3://b/p' }, 'f', { run, sleep: nap });
    await expect(uploader.upload(path, 'x.gz')).rejects.toThrow(/quota exceeded/);
    expect(run).toHaveBeenCalledTimes(3);
    const message = await uploader.upload(path, 'x.gz').catch((e: Error) => e.message);
    expect(message).not.toContain('secret_access_key');
    expect(message).not.toContain('sk');
  });

  it('stops retrying as soon as one attempt succeeds', async () => {
    const { path } = await localFile();
    const run = vi
      .fn(async () => ({ code: 0, stdout: '', stderr: '' }))
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'timeout' });
    const uploader = createUploader({ ...base, destinoUri: 'gs://b/p' }, 'f', { run, sleep: nap });
    await expect(uploader.upload(path, 'x.gz')).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('createUploader', () => {
  it('reports the scheme it resolved', () => {
    const file = createUploader({ ...base, destinoUri: 'file:///tmp/x' }, 'f', { run: ok });
    const b2 = createUploader({ ...base, destinoUri: 'b2://b/p' }, 'f', { run: ok });
    expect([file.scheme, b2.scheme]).toEqual(['file', 'b2']);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/backup/destino.test.ts`
Expected: FAIL — no resuelve `./destino`.

- [ ] **Step 3: Implementar `src/lib/backup/destino.ts`**

Firmas en el bloque *Interfaces*. Lo que las pruebas no determinan:

- El esquema sale de `config.destinoUri.split('://')[0]`; `createUploader` lanza para cualquier otro
  (el contrato ya los filtra, es defensa en profundidad).
- `file://`: la ruta local es todo lo que sigue a `file://`; `mkdir` recursivo de
  `<ruta>/<folder>` y `copyFile`.
- `rclone`: el remoto se llama siempre `destino`; el archivo de config se crea con
  `mkdtemp` + `writeFile(..., { mode: 0o600 })` y se borra en un `finally`. Argumentos:
  `['--config', configPath, 'copyto', localPath, 'destino:<resto de la URI>/<folder>/<remoteName>']`.
- Reintentos: `attempts` intentos, `sleep(1000)` y `sleep(4000)` entre ellos; al agotarse lanza
  `Error` con el `stderr` del último intento recortado a 500 caracteres. Ni el mensaje ni los
  argumentos registrados llevan la credencial (va por archivo, nunca por `--env` ni por argumento).

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/backup/destino.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/backup
git add src/lib/backup/destino.ts src/lib/backup/destino.test.ts
git commit -m "feat(backup): subida del respaldo al destino de la empresa (BAK.1)"
```

---

### Task 3: Aviso de fallo por webhook

**Files:**
- Create: `src/lib/backup/aviso.ts`
- Test: `src/lib/backup/aviso.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  ```ts
  export type FailureNotice = {
    step: 'dump' | 'archive' | 'upload' | 'manifest';
    artifact: string | null;
    destinationScheme: string;
    folder: string;
    message: string;
    at: string; // ISO
  };
  export function notifyFailure(
    webhookUrl: string,
    notice: FailureNotice,
    deps?: { fetchFn?: typeof fetch; timeoutMs?: number },
  ): Promise<boolean>; // false si el aviso no se pudo entregar; nunca lanza
  ```

- [ ] **Step 1: Write the failing test** — `src/lib/backup/aviso.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { notifyFailure } from './aviso';

const notice = {
  step: 'upload' as const,
  artifact: 'supabase-db.dump',
  destinationScheme: 's3',
  folder: '2026-10-21T03-00-00-000Z',
  message: 'rclone exited with 1: quota exceeded',
  at: '2026-10-21T03:04:00.000Z',
};

describe('notifyFailure', () => {
  it('posts the notice as json to the tenant webhook', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(notifyFailure('https://avisos.example.com/backup', notice, { fetchFn })).resolves.toBe(
      true,
    );
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://avisos.example.com/backup');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({
      event: 'backup.failed',
      step: 'upload',
      artifact: 'supabase-db.dump',
      destinationScheme: 's3',
      folder: notice.folder,
      at: notice.at,
    });
  });

  it('never carries the destination uri or the credential', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    await notifyFailure('https://avisos.example.com/backup', notice, { fetchFn });
    const body = (fetchFn.mock.calls[0][1] as RequestInit).body as string;
    expect(body).not.toContain('secret_access_key');
    expect(body).not.toContain('://');
  });

  it('returns false when the webhook answers with an error status', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(notifyFailure('https://avisos.example.com/backup', notice, { fetchFn })).resolves.toBe(
      false,
    );
  });

  it('returns false instead of throwing when the webhook is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(notifyFailure('https://avisos.example.com/backup', notice, { fetchFn })).resolves.toBe(
      false,
    );
  });

  it('gives up on a webhook that never answers', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      notifyFailure('https://avisos.example.com/backup', notice, {
        fetchFn: fetchFn as unknown as typeof fetch,
        timeoutMs: 10,
      }),
    ).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/backup/aviso.test.ts`
Expected: FAIL — no resuelve `./aviso`.

- [ ] **Step 3: Implementar `src/lib/backup/aviso.ts`**

Firmas en el bloque *Interfaces*. Lo que las pruebas no determinan: el cuerpo es
`{ event: 'backup.failed', ...notice }`; el tiempo límite por defecto es 10 000 ms y se aplica con
`AbortSignal.timeout(timeoutMs)`; todo el cuerpo de la función va en un `try/catch` que devuelve
`false`, y `response.ok` decide el `true`. El `message` que llega ya viene saneado por quien lo
construye (Tareas 2 y 4): esta función no reinventa el saneado, solo no agrega nada nuevo.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/backup/aviso.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificación completa y PR de la Parte 1**

```bash
npx prettier --write src/lib/backup
npm run lint && npm run typecheck && npm test && npm run build
git add src/lib/backup/aviso.ts src/lib/backup/aviso.test.ts
git commit -m "feat(backup): aviso por webhook cuando el respaldo falla (BAK.1)"
```

---

# Parte 2 — la tarea, el disparo desde el cron, la imagen y la documentación

PR operable por sí sola sobre la Parte 1 ya mergeada: cierra los dos criterios `IT`.

### Task 4: Ejecutor real de comandos

**Files:**
- Create: `src/lib/backup/comandos.ts`
- Test: `src/lib/backup/comandos.test.ts`

**Interfaces:**
- Consumes: `type CommandRunner`, `type CommandResult` de `./destino` (Tarea 2).
- Produces:
  ```ts
  export const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
  export const runCommand: CommandRunner; // node:child_process.spawn, sin shell
  export async function fileSize(path: string): Promise<number>;
  export async function sha256(path: string): Promise<string>;
  ```

- [ ] **Step 1: Write the failing test** — `src/lib/backup/comandos.test.ts`

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSize, runCommand, sha256 } from './comandos';

describe('runCommand', () => {
  it('returns code 0 and stdout of a command that works', async () => {
    const result = await runCommand('node', ['-e', 'process.stdout.write("hola")']);
    expect(result).toMatchObject({ code: 0, stdout: 'hola' });
  });

  it('returns the exit code and stderr instead of throwing', async () => {
    const result = await runCommand('node', ['-e', 'process.stderr.write("mal");process.exit(3)']);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('mal');
  });

  it('gives up on a command that hangs past the timeout', async () => {
    const result = await runCommand('node', ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 50,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/timeout/i);
  });

  it('does not go through a shell', async () => {
    const result = await runCommand('node', ['-e', 'process.stdout.write(process.argv[1] ?? "")']);
    expect(result.stdout).not.toContain('sh');
  });
});

describe('fileSize / sha256', () => {
  it('measures and hashes a file', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'bak1-')), 'a.txt');
    await writeFile(path, 'abc');
    expect(await fileSize(path)).toBe(3);
    expect(await sha256(path)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/backup/comandos.test.ts`
Expected: FAIL — no resuelve `./comandos`.

- [ ] **Step 3: Implementar `src/lib/backup/comandos.ts`**

Firmas en el bloque *Interfaces*. Lo que las pruebas no determinan: `spawn(command, args, { shell: false })`,
`stdout`/`stderr` acumulados como texto, resolución en el evento `close`; al vencer el tiempo límite
se mata el proceso (`SIGKILL`) y se resuelve con `code: -1` y `stderr` que incluye la palabra
`timeout`. `fileSize` usa `stat`; `sha256` usa `createHash('sha256')` sobre un `createReadStream`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/backup/comandos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/backup
git add src/lib/backup/comandos.ts src/lib/backup/comandos.test.ts
git commit -m "feat(backup): ejecutor de comandos y huellas de archivo (BAK.1)"
```

---

### Task 5: La tarea diaria: volcado, empaquetado, subida y aviso

Cierra los dos criterios `IT` del slice.

**Files:**
- Create: `src/lib/backup/tarea.ts`
- Test: `src/lib/backup/tarea.test.ts`

**Interfaces:**
- Consumes: `backupArtifacts`, `backupConfigFromEnv`, `databaseUrlFromEnv`, `destinationFolder`,
  `templateTopology` (Tarea 1); `createUploader`, `type CommandRunner`, `type Uploader`
  (Tarea 2); `notifyFailure`, `type FailureNotice` (Tarea 3); `fileSize`, `sha256`, `runCommand`
  (Tarea 4).
- Produces:
  ```ts
  export type BackupOutcome =
    | { ok: true; folder: string; uploaded: string[] }
    | { ok: false; folder: string; uploaded: string[]; failure: FailureNotice; notified: boolean };
  export type BackupDeps = {
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    run?: CommandRunner;
    topology?: ReturnType<typeof templateTopology>;
    makeUploader?: typeof createUploader;
    notify?: typeof notifyFailure;
    workDir?: string;
  };
  export function runDailyBackup(deps?: BackupDeps): Promise<BackupOutcome>;
  export const MANIFEST_NAME = 'manifiesto.json';
  ```

- [ ] **Step 1: Write the failing test** — `src/lib/backup/tarea.test.ts`

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BASE_TOPOLOGY } from '@contracts/base/compose-services.stub';
import { MANIFEST_NAME, runDailyBackup } from './tarea';

const now = () => new Date('2026-10-21T03:00:00.000Z');
const folder = '2026-10-21T03-00-00-000Z';

async function destination() {
  return mkdtemp(join(tmpdir(), 'bak1-destino-'));
}

function env(target: string) {
  return {
    BACKUP_DESTINO_URI: `file://${target}`,
    BACKUP_DESTINO_CREDENCIAL: 'no-aplica',
    BACKUP_AVISO_WEBHOOK: 'https://avisos.example.com/backup',
    BACKUP_DB_URL: 'postgresql://postgres:pw@supabase-db:5432/postgres',
  };
}

// pg_dump y tar falsos: escriben el archivo que el comando real escribiría.
function fakeRun(contents = 'datos') {
  const calls: { command: string; args: string[] }[] = [];
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args });
    const out = args[args.indexOf('--file') + 1] ?? args[args.indexOf('-f') + 1];
    if (out) await writeFile(out, contents);
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('runDailyBackup · IT: genera el backup de la base y el storage y lo sube', () => {
  it('sube el volcado y un archivo por volumen, con los nombres de CT.2', async () => {
    const target = await destination();
    const { run, calls } = fakeRun();
    const outcome = await runDailyBackup({
      env: env(target),
      now,
      run,
      topology: BASE_TOPOLOGY,
      notify: async () => true,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.uploaded).toEqual([
      'supabase-db.dump',
      'supabase-db-data.tar.gz',
      'supabase-storage-data.tar.gz',
      MANIFEST_NAME,
    ]);
    for (const name of outcome.uploaded) {
      await expect(readFile(join(target, folder, name), 'utf8')).resolves.toBeTruthy();
    }
    expect(calls[0].command).toBe('pg_dump');
    expect(calls[0].args.join(' ')).toContain('supabase-db');
    expect(calls.slice(1).map((c) => c.command)).toEqual(['tar', 'tar']);
  });

  it('escribe un manifiesto con tamaño y sha256 de cada archivo', async () => {
    const target = await destination();
    const { run } = fakeRun('abc');
    await runDailyBackup({ env: env(target), now, run, topology: BASE_TOPOLOGY, notify: async () => true });
    const manifest = JSON.parse(await readFile(join(target, folder, MANIFEST_NAME), 'utf8'));
    expect(manifest.folder).toBe(folder);
    expect(manifest.files).toEqual([
      { name: 'supabase-db.dump', bytes: 3, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { name: 'supabase-db-data.tar.gz', bytes: 3, sha256: expect.any(String) },
      { name: 'supabase-storage-data.tar.gz', bytes: 3, sha256: expect.any(String) },
    ]);
  });

  it('no deja el respaldo dentro del contenedor', async () => {
    const target = await destination();
    const work = await mkdtemp(join(tmpdir(), 'bak1-trabajo-'));
    const { run } = fakeRun();
    await runDailyBackup({
      env: env(target),
      now,
      run,
      topology: BASE_TOPOLOGY,
      workDir: work,
      notify: async () => true,
    });
    const { readdir } = await import('node:fs/promises');
    await expect(readdir(work)).resolves.toEqual([]);
  });
});

describe('runDailyBackup · IT: si la subida falla, se emite el aviso', () => {
  it('avisa con el paso, el artefacto y el error, y devuelve ok: false', async () => {
    const { run } = fakeRun();
    const notify = vi.fn(async () => true);
    const outcome = await runDailyBackup({
      env: { ...env('/no-existe'), BACKUP_DESTINO_URI: 's3://b/p' },
      now,
      run: async (command, args) => (command === 'rclone' ? { code: 1, stdout: '', stderr: 'quota exceeded' } : run(command, args)),
      topology: BASE_TOPOLOGY,
      notify,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.notified).toBe(true);
    const [webhook, notice] = notify.mock.calls[0];
    expect(webhook).toBe('https://avisos.example.com/backup');
    expect(notice).toMatchObject({
      step: 'upload',
      artifact: 'supabase-db.dump',
      destinationScheme: 's3',
      folder,
    });
    expect(notice.message).toContain('quota exceeded');
  });

  it('avisa también cuando falla el volcado, y no sube nada', async () => {
    const target = await destination();
    const notify = vi.fn(async () => true);
    const outcome = await runDailyBackup({
      env: env(target),
      now,
      run: async () => ({ code: 1, stdout: '', stderr: 'pg_dump: connection refused' }),
      topology: BASE_TOPOLOGY,
      notify,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.uploaded).toEqual([]);
    expect(notify.mock.calls[0][1]).toMatchObject({ step: 'dump' });
  });

  it('trata un volcado de 0 bytes como fallo antes de subirlo', async () => {
    const target = await destination();
    const notify = vi.fn(async () => true);
    const outcome = await runDailyBackup({
      env: env(target),
      now,
      run: fakeRun('').run,
      topology: BASE_TOPOLOGY,
      notify,
    });
    expect(outcome.ok).toBe(false);
    expect(notify.mock.calls[0][1]).toMatchObject({ step: 'dump', artifact: 'supabase-db.dump' });
    const { readdir } = await import('node:fs/promises');
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('reporta el fallo igual cuando el aviso tampoco se pudo entregar', async () => {
    const target = await destination();
    const outcome = await runDailyBackup({
      env: env(target),
      now,
      run: async () => ({ code: 1, stdout: '', stderr: 'pg_dump: connection refused' }),
      topology: BASE_TOPOLOGY,
      notify: async () => false,
    });
    expect(outcome).toMatchObject({ ok: false, notified: false });
    if (outcome.ok) throw new Error('el backup no debía salir bien');
    expect(outcome.failure.step).toBe('dump');
  });

  it('no mete la credencial ni la url de la base en el aviso', async () => {
    const notify = vi.fn(async () => true);
    await runDailyBackup({
      env: {
        ...env('/no-existe'),
        BACKUP_DESTINO_URI: 's3://b/p',
        BACKUP_DESTINO_CREDENCIAL: 'secret_access_key = sk-super-secreta',
      },
      now,
      run: async () => ({ code: 1, stdout: '', stderr: 'pg_dump: connection refused' }),
      topology: BASE_TOPOLOGY,
      notify,
    });
    expect(JSON.stringify(notify.mock.calls[0][1])).not.toContain('sk-super-secreta');
    expect(JSON.stringify(notify.mock.calls[0][1])).not.toContain('pw@supabase-db');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/backup/tarea.test.ts`
Expected: FAIL — no resuelve `./tarea`.

- [ ] **Step 3: Implementar `src/lib/backup/tarea.ts`**

Firmas en el bloque *Interfaces*. Orden del algoritmo, que las pruebas no determinan por completo:

1. Resolver `config = backupConfigFromEnv(env)`, `topology = deps.topology ?? templateTopology()`,
   `folder = destinationFolder(now())`, `artifacts = backupArtifacts(topology)` y
   `uploader = makeUploader(config, folder, { run })`.
2. Crear el directorio de trabajo (`deps.workDir`, o `mkdtemp` en `os.tmpdir()`).
3. Todo lo que sigue va en un `try/finally`: el `finally` borra el contenido del directorio de
   trabajo (`rm` recursivo de cada archivo generado) pase lo que pase.
4. Para el artefacto `database`: `databaseUrlFromEnv(env, topology)` y
   `pg_dump --dbname <url> --format custom --compress 6 --file <trabajo>/<fileName>`; paso `'dump'`.
5. Para cada artefacto `volume`: `tar -c -z -f <trabajo>/<fileName> -C <sourcePath> .` (cada
   bandera por separado, para que `-f` se pueda leer de los argumentos); paso `'archive'`.
6. Después de cada comando: código distinto de 0 **o** `fileSize === 0` es fallo de ese paso.
7. Escribir `manifiesto.json` con `{ version: 'BAK.1.v1', folder, createdAt, files: [{ name, bytes, sha256 }] }`;
   paso `'manifest'`.
8. Subir en orden los archivos y después el manifiesto, acumulando `uploaded`; paso `'upload'`.
9. En el primer fallo: construir el `FailureNotice` (mensaje = `${command} salió con ${code}: ${stderr recortado}`,
   sin URL ni credencial; `destinationScheme = uploader.scheme`), llamar
   `notify(config.avisoWebhook, notice)` y devolver `{ ok: false, ... }`. No se sigue con los
   artefactos siguientes.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/backup/tarea.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/backup
git add src/lib/backup/tarea.ts src/lib/backup/tarea.test.ts
git commit -m "feat(backup): tarea diaria que respalda base y storage y avisa si falla (BAK.1)"
```

---

### Task 6: El disparo desde el cron del compose

**Files:**
- Create: `src/app/api/backup/cron/route.ts`
- Test: `src/app/api/backup/cron/route.test.ts`

**Interfaces:**
- Consumes: `runDailyBackup`, `type BackupOutcome` (Tarea 5).
- Produces:
  ```ts
  export async function GET(request: Request): Promise<Response>;
  export function __resetBackupLockForTests(): void;
  ```
  Contrato HTTP: 401 sin secreto correcto; 503 si no hay `AUTOMATION_CRON_SECRET`; 409 si ya hay un
  backup en curso; 500 si el backup falló (cuerpo con `step` y `notified`); 200 con
  `{ folder, uploaded }` si salió bien.

- [ ] **Step 1: Write the failing test** — `src/app/api/backup/cron/route.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ runDailyBackup: vi.fn() }));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));
vi.mock('@/lib/backup/tarea', () => ({ runDailyBackup: h.runDailyBackup, MANIFEST_NAME: 'manifiesto.json' }));

import { GET, __resetBackupLockForTests } from './route';

type Answer = { status: number; body: Record<string, unknown> };

function call(secret?: string) {
  return GET(
    new Request('http://t/api/backup/cron', {
      headers: secret === undefined ? {} : { 'x-cron-secret': secret },
    }),
  ) as unknown as Promise<Answer>;
}

beforeEach(() => {
  __resetBackupLockForTests();
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'un-secreto-largo');
  h.runDailyBackup.mockReset();
  h.runDailyBackup.mockResolvedValue({ ok: true, folder: 'f', uploaded: ['supabase-db.dump'] });
});

describe('GET /api/backup/cron', () => {
  it('runs the backup and answers 200 with what it uploaded', async () => {
    const answer = await call('un-secreto-largo');
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ folder: 'f', uploaded: ['supabase-db.dump'] });
    expect(h.runDailyBackup).toHaveBeenCalledTimes(1);
  });

  it('answers 401 and does not run the backup without the shared secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('otro')).status).toBe(401);
    expect(h.runDailyBackup).not.toHaveBeenCalled();
  });

  it('answers 503 when the cron secret is not configured', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect((await call('un-secreto-largo')).status).toBe(503);
    expect(h.runDailyBackup).not.toHaveBeenCalled();
  });

  it('answers 500 with the failed step when the backup failed', async () => {
    h.runDailyBackup.mockResolvedValue({
      ok: false,
      folder: 'f',
      uploaded: [],
      failure: { step: 'upload', artifact: 'supabase-db.dump', message: 'quota exceeded' },
      notified: true,
    });
    const answer = await call('un-secreto-largo');
    expect(answer.status).toBe(500);
    expect(answer.body).toMatchObject({ step: 'upload', notified: true });
  });

  it('answers 409 instead of dumping twice at the same time', async () => {
    let release: () => void = () => {};
    h.runDailyBackup.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ ok: true, folder: 'f', uploaded: [] });
      }),
    );
    const first = call('un-secreto-largo');
    expect((await call('un-secreto-largo')).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(h.runDailyBackup).toHaveBeenCalledTimes(1);
  });

  it('frees the lock after a backup that threw', async () => {
    h.runDailyBackup.mockRejectedValueOnce(new Error('boom'));
    expect((await call('un-secreto-largo')).status).toBe(500);
    expect((await call('un-secreto-largo')).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/api/backup/cron/route.test.ts`
Expected: FAIL — no resuelve `./route`.

- [ ] **Step 3: Implementar `src/app/api/backup/cron/route.ts`**

Se copia la forma de `src/app/api/automations/cron/route.ts`: comparación del secreto con
`timingSafeEqual` sobre buffers de igual longitud, 503 si la variable no está, `NextResponse.json`
para todas las respuestas. El cerrojo es una variable de módulo (`let running = false`) en un
`try/finally`; `__resetBackupLockForTests` la vuelve a `false`. El handler no captura los errores de
`runDailyBackup` para esconderlos: los convierte en 500 con el mensaje, y el cuerpo nunca lleva la
URI del destino.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/api/backup/cron/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/app/api/backup
git add src/app/api/backup/cron/route.ts src/app/api/backup/cron/route.test.ts
git commit -m "feat(backup): endpoint del cron que dispara el respaldo diario (BAK.1)"
```

---

### Task 7: Imagen, variables de la empresa y documentación

**Files:**
- Modify: `Dockerfile` (etapa `runner`, entre `WORKDIR /app` y el `addgroup`)
- Modify: `.env.local.example` (al final, junto al bloque de `AUTOMATION_CRON_SECRET`)
- Create: `docs/backups.md`

**Interfaces:**
- Consumes: todo lo anterior; no produce símbolos nuevos.

- [ ] **Step 1: Agregar los binarios a la imagen de runtime**

En la etapa `runner` del `Dockerfile`, una sola capa:
`RUN apk add --no-cache postgresql17-client rclone`. Un comentario de una línea explica que son los
binarios del respaldo diario (`src/lib/backup`) y que sin ellos `GET /api/backup/cron` falla y avisa.

- [ ] **Step 2: Documentar las variables de la empresa en `.env.local.example`**

Bloque comentado, con el estilo del archivo (comentario explicativo y la variable comentada):
`BACKUP_DESTINO_URI` (`s3://`, `b2://`, `gs://` o `file://`), `BACKUP_DESTINO_CREDENCIAL` (cuerpo de
un remoto de `rclone`, sin la cabecera de sección, en una sola línea con `\n`),
`BACKUP_AVISO_WEBHOOK` (URL a la que se avisa si el respaldo falla) y `BACKUP_DB_URL`
(`postgresql://postgres:<password>@supabase-db:5432/postgres`, con el host igual al nombre del
servicio del compose). Sin valores reales. Una línea dice que el respaldo corre a las 3:00 y que el
disparo usa el mismo `AUTOMATION_CRON_SECRET`.

- [ ] **Step 3: Escribir `docs/backups.md`**

Secciones, en inglés como el resto de `docs/`:
- **What gets backed up:** el volcado de `supabase-db` y un `tar.gz` por volumen de respaldo, con
  los nombres que fija la interfaz `I2` (`contracts/base/compose-services.ts`), más
  `manifiesto.json` con tamaño y `sha256`.
- **Where and when:** `<BACKUP_DESTINO_URI>/<marca de tiempo>/<archivo>`, a diario a las 3:00
  (R9, constante `HORA_BACKUP` del contrato, no configurable).
- **Configuration:** las cuatro variables del Paso 2 y de dónde salen (interfaz `I1`).
- **What the compose must provide (BASE.1):** el servicio `cron` llama
  `GET http://app:3000/api/backup/cron` con la cabecera `x-cron-secret` en la línea `0 3 * * *`; el
  servicio `app` monta `supabase-db-data` y `supabase-storage-data` en `/var/lib/<volumen>` en solo
  lectura.
- **When it fails:** se hace POST del aviso a `BACKUP_AVISO_WEBHOOK` con el paso que falló, la ruta
  responde 500 y nada se borra del destino (sin rotación en este slice).
- **Not here:** restauración → BAK.2.

- [ ] **Step 4: Verificación completa**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: todo PASS, incluidas las CDC que ya traen los contratos
(`contracts/cfg/tenant-config.cdc-bak.test.ts`, `contracts/base/cdc/bak.cdc.test.ts`).

- [ ] **Step 5: Commit y PR de la Parte 2**

```bash
npx prettier --write docs/backups.md
git add Dockerfile .env.local.example docs/backups.md
git commit -m "docs(backup): variables, binarios y requisitos del compose para el respaldo diario (BAK.1)"
```

---

## Cierre: criterio por tarea

| Criterio del `Está hecho cuando` | Dónde se cumple |
|---|---|
| `IT:` genera el backup de la base y el storage con los nombres de CT.2 y lo sube al destino configurado según CT.1 | Tarea 1 (nombres y config desde los contratos), Tarea 2 (subida), Tarea 5 (`runDailyBackup` de punta a punta contra un destino `file://` real) |
| `IT:` si la subida falla, se emite el aviso | Tarea 3 (`notifyFailure`), Tarea 5 (el `describe` del aviso), Tarea 6 (500 hacia el cron) |
| `CDC:` las pruebas contra los stubs de CT.1 y CT.2 pasan | Tareas 1 y 5 (`stubTenantConfig()` y `BASE_TOPOLOGY`), más las CDC de BAK que ya traen los dos contratos |
| `Entra:` tarea del cron a las 3:00 | Tarea 6 (endpoint) + Tarea 7 (línea de cron documentada para BASE.1; la hora es `HORA_BACKUP`) |
| `Entra:` subida fuera del equipo | Tarea 2 (`file://` y `rclone`) + Tarea 5 (el trabajo local se borra) |
| `Entra:` aviso cuando la subida falla | Tarea 3 + Tarea 5 |

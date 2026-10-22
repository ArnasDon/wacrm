# CT.1 · Contrato de configuración por empresa — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** publicar la interfaz `I1` como código verificable — esquemas zod de qué archivos y variables son de la empresa y cuáles del template, un stub derivado de esos esquemas y las pruebas CDC de BAK, UPD y MOD contra el stub.

**Architecture:** un módulo de contrato (`contracts/cfg/tenant-config.ts`) con los esquemas zod, las listas de rutas/variables de la empresa y dos helpers de clasificación (`esRutaDeEmpresa`, `esVariableDeEmpresa`); un stub (`contracts/cfg/tenant-config.stub.ts`) cuyas factorías pasan por `TenantConfigSchema.parse`, así que no puede desviarse del contrato; y un archivo de prueba por consumidor (BAK, UPD, MOD) que ejercita solo la parte del contrato que ese consumidor necesita. La implementación del publicador (CFG.1) y de los consumidores (BAK.1, UPD.1, MOD.1) **no** entra: su prueba de verificación queda marcada pendiente con `it.todo`.

**Tech Stack:** TypeScript 6 (strict), zod 4, vitest 5, Node 22.

**Spec:** `prd-hub` → `prds/wacrm-tenant-repo-template/slices/CT.1-contrato-config-empresa.md`
(origen `04-modulos#i1`; reglas que lo sostienen: `05-reglas#r5`, `#r6`, `#r9`, `#r11`, `#r13`, `#r14`;
alcance `03-alcance#config-por-empresa`, `03-alcance#backups`).
Consumidores del contrato: `slices/BAK.1-backup-diario.md`, `slices/UPD.1-flujo-actualizacion.md`,
`slices/MOD.1-mecanismo-modulos.md`. Publicador: `slices/CFG.1-separacion-config-empresa.md`.

## Está hecho cuando (del slice, literal)

- CDC: las pruebas de BAK, UPD y MOD pasan contra el stub → Tareas 3, 4 y 5.
- CDC: existe la prueba de verificación del publicador, marcada pendiente → Tarea 6.

## Global Constraints

- Todo el código nuevo vive bajo `contracts/cfg/`. **No** se toca `src/`, ni `supabase/`, ni `docker-compose.yml`: CT.1 es solo contrato (`## No entra`: implementación del publicador o de los consumidores).
- Nombres de símbolos y comentarios en español, como el resto de los PRDs; los nombres de variables de entorno en mayúsculas estilo `.env`.
- zod 4 (`^4.3.6`, la versión ya resuelta en `package-lock.json` como dependencia transitiva). Idiomas de v4: `z.strictObject({...})` en vez de `.strict()`, `z.url()` en vez de `z.string().url()`, `z.record(clave, valor)` con dos argumentos.
- La hora del backup es la constante `"03:00"` y no es configurable (R9).
- `ENCRYPTION_KEY` es de la empresa, se genera una vez y no se rota (R7): el contrato la lista como variable de empresa y nunca le pone valor por defecto.
- Verificación completa del repo (de `.claude/avanzar-repo.yaml`): `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Verificación dirigida: `npx vitest run <archivos>`.
- Archivos calientes (conflictúan fácil con upstream): `package.json`, `package-lock.json`. Se tocan una sola vez, en la Tarea 1.

## Review Focus

1. `.env.local.example` y `.env.example` son del **template**, no de la empresa: si `esRutaDeEmpresa` los reclama, una actualización del template nunca podría corregir el ejemplo (pinned en Tarea 1, Paso 1).
2. Rutas equivalentes escritas distinto (`./config/policies.yaml`, `config//policies.yaml`, `config/policies.yaml/`): deben clasificarse igual que la forma canónica (pinned en Tarea 1, Paso 1).
3. Mayúsculas en la ruta (`Config/policies.yaml`, `.ENV.local`): el chequeo de UPD corre en macOS (sistema de archivos insensible a mayúsculas) y en Linux; se decide comparar **sensible a mayúsculas** y que `Config/policies.yaml` sea del template, para que el comportamiento no dependa del sistema de archivos (pinned en Tarea 1, Paso 1).
4. Llave desconocida en la config de la empresa (un `backps:` mal escrito): `TenantConfigSchema` es estricto y falla en vez de ignorarla en silencio (pinned en Tarea 2, Paso 1).
5. `BACKUP_DESTINO_URI` con esquema no soportado (`http://`, ruta relativa) o `BACKUP_DESTINO_CREDENCIAL` vacía: el parseo falla antes de que BAK.1 crea que tiene destino (pinned en Tarea 3, Paso 1).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `contracts/cfg/tenant-config.ts` (crear) | El contrato `I1`: constantes de rutas y variables de la empresa, esquemas zod (`TenantConfigSchema`, `BackupConfigSchema`, `ModuloSwitchSchema`), helpers de clasificación y la versión del contrato. Sin dependencias del repo: solo zod. |
| `contracts/cfg/tenant-config.test.ts` (crear) | Pruebas propias del contrato: clasificación de rutas y variables. |
| `contracts/cfg/tenant-config.stub.ts` (crear) | Stub derivado del contrato: factorías que devuelven una config de empresa válida (parseada por el esquema) con overrides. |
| `contracts/cfg/tenant-config.stub.test.ts` (crear) | Prueba de que el stub satisface el contrato y de que los overrides siguen pasando por el esquema. |
| `contracts/cfg/tenant-config.cdc-bak.test.ts` (crear) | CDC de BAK.1 contra el stub: destino, credencial, aviso y hora del backup. |
| `contracts/cfg/tenant-config.cdc-upd.test.ts` (crear) | CDC de UPD.1 contra el stub: qué rutas no puede pisar una actualización del template. |
| `contracts/cfg/tenant-config.cdc-mod.test.ts` (crear) | CDC de MOD.1 contra el stub: lectura de interruptores y de la config opaca de un módulo. |
| `contracts/cfg/tenant-config.publicador.test.ts` (crear) | Prueba de verificación del publicador (CFG.1), marcada pendiente con `it.todo`. |
| `vitest.config.ts` (modificar: `test.include`) | Que vitest recoja `contracts/**/*.test.ts`; hoy solo mira `src/**`. |
| `package.json` + `package-lock.json` (modificar) | `zod` pasa de transitiva a dependencia directa. |

## Decisiones tomadas sin Juan

El PRD nombra los artefactos de configuración (`.env.example`, interruptores de módulos,
`policies.yaml`) pero no fija rutas ni nombres. Como el contrato es lo primero que se escribe, aquí
se fijan; CFG.1 los hereda:

1. **Rutas de la empresa:** cualquier archivo cuyo nombre empiece por `.env` (salvo `.env.example` y `.env.local.example`, que son del template) y todo lo que esté bajo `config/`, con `config/modules.yaml` (interruptores) y `config/policies.yaml` (políticas, R14) como obligatorios. Todo lo demás es del template (R5, R13).
2. **Interruptores de módulos:** viven en `config/modules.yaml` como `modulos: { <nombre>: { activo: bool, config: {...} } }`. La `config` de cada módulo es **opaca** en CT.1 (`Record<string, unknown>`): su esquema lo fija CT.3 (`I3`), para no invadir ese contrato.
3. **Backup:** destino, credencial y aviso son **variables de entorno** de la empresa (`BACKUP_DESTINO_URI`, `BACKUP_DESTINO_CREDENCIAL`, `BACKUP_AVISO_WEBHOOK`) porque llevan secretos; la hora es la constante `"03:00"` (R9). Esquemas de destino aceptados: `s3://`, `b2://`, `gs://`, `file://`.
4. **"Stub generado":** no hay generación de código en este repo, así que el stub es un módulo escrito a mano cuyas factorías **pasan por `TenantConfigSchema.parse`**. Si el contrato cambia y el stub queda inválido, su propia prueba falla; eso da la garantía que buscaría un generador, sin herramienta nueva.
5. **`TenantConfigSchema` es estricto** (`z.strictObject`): una llave desconocida falla en vez de ignorarse, porque la config de la empresa es la única fuente de esos datos (R13/R14).
6. **zod como dependencia directa** y `vitest.config.ts` ampliado a `contracts/`: CT.1 es el primer slice que crea `contracts/`, así que CT.2 y CT.3 heredan la convención (`contracts/<carril>/<nombre>.ts`, `*.stub.ts`, `*.cdc-<consumidor>.test.ts`, `*.publicador.test.ts`).
7. **No se crea `contracts/README.md`:** CT.2 (fase 1) y CT.3 (fase 4) tocarían el mismo archivo y chocarían. La convención queda en el comentario de cabecera de `tenant-config.ts` y en este plan.
8. **La prueba del publicador usa `it.todo`** (vitest la reporta como pendiente y no falla). CFG.1 la convierte en prueba real: su `Está hecho cuando` dice "la prueba de verificación de CT.1 pasa".

**Para confirmar con Juan:** los nombres exactos fijados en 1–3 (`config/modules.yaml`,
`config/policies.yaml`, `BACKUP_DESTINO_URI`, `BACKUP_DESTINO_CREDENCIAL`,
`BACKUP_AVISO_WEBHOOK`) y la lista de esquemas de destino de backup. Cambiarlos después es un
cambio de contrato que arrastra a CFG.1, BAK.1, UPD.1 y MOD.1.

## Verificación manual

El `Está hecho cuando` de CT.1 no tiene criterios `manual:`. Nada que hacer a mano.

---

### Task 1: El contrato y la clasificación de rutas y variables

**Files:**
- Create: `contracts/cfg/tenant-config.ts`
- Create: `contracts/cfg/tenant-config.test.ts`
- Modify: `vitest.config.ts` (campo `test.include`)
- Modify: `package.json` (`dependencies`), `package-lock.json`

**Interfaces:**
- Consumes: nada (primer archivo de `contracts/`).
- Produces:
  ```ts
  export const VERSION_CONTRATO = "I1.v1";
  export const HORA_BACKUP = "03:00";
  export const RUTAS_EMPRESA: readonly string[];        // ["config/modules.yaml", "config/policies.yaml"]
  export const PREFIJOS_EMPRESA: readonly string[];     // ["config/"]
  export const EJEMPLOS_TEMPLATE: readonly string[];    // [".env.example", ".env.local.example"]
  export const VARS_EMPRESA: readonly string[];
  export function esRutaDeEmpresa(ruta: string): boolean;
  export function esVariableDeEmpresa(nombre: string): boolean;
  ```

- [ ] **Step 1: Write the failing test** — `contracts/cfg/tenant-config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  EJEMPLOS_TEMPLATE,
  RUTAS_EMPRESA,
  VARS_EMPRESA,
  VERSION_CONTRATO,
  esRutaDeEmpresa,
  esVariableDeEmpresa,
} from "./tenant-config";

describe("esRutaDeEmpresa", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production.local",
    "config/modules.yaml",
    "config/policies.yaml",
    "config/extra/lo-que-sea.yaml",
    "./config/policies.yaml",
    "config//policies.yaml",
    "config/policies.yaml/",
  ])("reclama %s para la empresa", (ruta) => {
    expect(esRutaDeEmpresa(ruta)).toBe(true);
  });

  it.each([
    ".env.example",
    ".env.local.example",
    "src/app/page.tsx",
    "docker-compose.yml",
    "supabase/migrations/0001_init.sql",
    "package.json",
    "configuracion/policies.yaml",
    "Config/policies.yaml",
    ".ENV.local",
  ])("deja %s al template", (ruta) => {
    expect(esRutaDeEmpresa(ruta)).toBe(false);
  });
});

describe("esVariableDeEmpresa", () => {
  it.each([
    "ENCRYPTION_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "META_APP_SECRET",
    "BACKUP_DESTINO_URI",
    "BACKUP_DESTINO_CREDENCIAL",
    "BACKUP_AVISO_WEBHOOK",
  ])("reclama %s para la empresa", (nombre) => {
    expect(esVariableDeEmpresa(nombre)).toBe(true);
  });

  it.each(["NEXT_PUBLIC_APP_LOCALE", "NODE_ENV", "encryption_key"])(
    "deja %s al template",
    (nombre) => {
      expect(esVariableDeEmpresa(nombre)).toBe(false);
    },
  );
});

describe("el contrato se declara", () => {
  it("expone su versión", () => {
    expect(VERSION_CONTRATO).toBe("I1.v1");
  });

  it("obliga a modules.yaml y policies.yaml", () => {
    expect(RUTAS_EMPRESA).toEqual(["config/modules.yaml", "config/policies.yaml"]);
  });

  it("no mete los ejemplos del template entre las rutas de la empresa", () => {
    for (const ejemplo of EJEMPLOS_TEMPLATE) {
      expect(RUTAS_EMPRESA).not.toContain(ejemplo);
    }
  });

  it("lista ENCRYPTION_KEY sin valor por defecto en ningún lado", () => {
    expect(VARS_EMPRESA).toContain("ENCRYPTION_KEY");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run contracts/cfg/tenant-config.test.ts`
Expected: FAIL. Primero por "No test files found" (vitest aún solo mira `src/**`) — ese es el síntoma que arregla el Paso 3; luego por no resolverse `./tenant-config`.

- [ ] **Step 3: Dejar que vitest vea `contracts/` y poner zod como dependencia directa**

- En `vitest.config.ts`, `test.include` pasa a `["src/**/*.test.ts", "src/**/*.test.tsx", "contracts/**/*.test.ts"]`.
- `npm install --save zod@^4.3.6` (ya está resuelta en el lock como transitiva; esto solo la hace directa). Revisar que el diff de `package-lock.json` no mueva otras versiones; si las mueve, descartar y editar `package.json` a mano más `npm install --package-lock-only`.

- [ ] **Step 4: Implementar el contrato en `contracts/cfg/tenant-config.ts`**

Comentario de cabecera: qué interfaz publica (`I1`), de dónde sale (`prds/wacrm-tenant-repo-template/slices/CT.1-contrato-config-empresa.md`), quién la consume (BAK, UPD, MOD) y la convención de `contracts/` (`*.stub.ts`, `*.cdc-<consumidor>.test.ts`, `*.publicador.test.ts`).

Firmas del bloque **Produces**. Reglas que determinan el comportamiento:
- `esRutaDeEmpresa` normaliza antes de comparar: quita un `./` inicial, colapsa `/` repetidos y quita el `/` final. No cambia mayúsculas (decisión 3 de Review Focus).
- Devuelve `true` si la ruta normalizada está en `RUTAS_EMPRESA`, o empieza por alguno de `PREFIJOS_EMPRESA`, o su último segmento empieza por `.env` y no está en `EJEMPLOS_TEMPLATE`.
- `esVariableDeEmpresa` es pertenencia exacta a `VARS_EMPRESA` (sensible a mayúsculas).

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run contracts/cfg/tenant-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add contracts/cfg/tenant-config.ts contracts/cfg/tenant-config.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(contracts): contrato I1 de configuración por empresa (CT.1)"
```

---

### Task 2: Esquemas zod de la config de la empresa y el stub

**Files:**
- Modify: `contracts/cfg/tenant-config.ts` (agregar esquemas)
- Create: `contracts/cfg/tenant-config.stub.ts`
- Create: `contracts/cfg/tenant-config.stub.test.ts`

**Interfaces:**
- Consumes: Tarea 1 (`HORA_BACKUP`, `VERSION_CONTRATO`).
- Produces:
  ```ts
  export const BackupConfigSchema;   // { destinoUri, credencial, avisoWebhook, hora }
  export const ModuloSwitchSchema;   // { activo: boolean, config: Record<string, unknown> }
  export const ModulosSchema;        // Record<nombre, ModuloSwitch>
  export const TenantConfigSchema;   // strict: { empresa, backup, modulos, policiesPath }
  export type TenantConfig = z.infer<typeof TenantConfigSchema>;
  export type TenantConfigEntrada = z.input<typeof TenantConfigSchema>;
  export type ModuloSwitch = z.infer<typeof ModuloSwitchSchema>;
  export function moduloDe(config: TenantConfig, nombre: string): ModuloSwitch | undefined;
  // en tenant-config.stub.ts
  export type OverridesStub = {
    empresa?: Partial<TenantConfigEntrada["empresa"]>;
    backup?: Partial<Record<keyof TenantConfig["backup"], unknown>>;
    modulos?: Record<string, { activo?: boolean; config?: Record<string, unknown> }>;
  };
  export function stubTenantConfig(overrides?: OverridesStub): TenantConfig;
  export function stubRutasEmpresa(): readonly string[];
  ```
  Forma de los esquemas (valores fijados por el PRD, no negociables en la implementación):
  - `empresa`: `{ id: string /^[a-z][a-z0-9-]*$/, nombre: string min 1 }` (R6: una empresa, un repo, una base).
  - `backup`: `destinoUri` string que empieza por `s3://`, `b2://`, `gs://` o `file://`; `credencial` string min 1; `avisoWebhook` `z.url()` (R11); `hora` `z.literal(HORA_BACKUP).default(HORA_BACKUP)` (R9).
  - `modulos`: `z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), ModuloSwitchSchema).default({})`.
  - `policiesPath`: `z.literal("config/policies.yaml").default("config/policies.yaml")` (R14).
  - El objeto raíz es `z.strictObject`.

- [ ] **Step 1: Write the failing test** — `contracts/cfg/tenant-config.stub.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { HORA_BACKUP, RUTAS_EMPRESA, TenantConfigSchema, esRutaDeEmpresa } from "./tenant-config";
import { stubRutasEmpresa, stubTenantConfig } from "./tenant-config.stub";

describe("el stub sale del contrato", () => {
  it("devuelve una config que el esquema acepta", () => {
    expect(() => TenantConfigSchema.parse(stubTenantConfig())).not.toThrow();
  });

  it("aplica la hora fija del backup sin que nadie la pase", () => {
    expect(stubTenantConfig().backup.hora).toBe(HORA_BACKUP);
  });

  it("deja aplicar overrides parciales", () => {
    const config = stubTenantConfig({ empresa: { id: "baru" } });
    expect(config.empresa.id).toBe("baru");
    expect(config.empresa.nombre).not.toHaveLength(0);
  });

  it("hace fallar un override que rompe el contrato", () => {
    expect(() => stubTenantConfig({ backup: { destinoUri: "http://ejemplo.com" } })).toThrow();
  });

  it("rechaza una llave desconocida en vez de ignorarla", () => {
    expect(() => TenantConfigSchema.parse({ ...stubTenantConfig(), backps: {} })).toThrow();
  });

  it("expone las rutas de la empresa que el contrato clasifica como suyas", () => {
    expect(stubRutasEmpresa()).toEqual(expect.arrayContaining([...RUTAS_EMPRESA]));
    for (const ruta of stubRutasEmpresa()) {
      expect(esRutaDeEmpresa(ruta)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run contracts/cfg/tenant-config.stub.test.ts`
Expected: FAIL por no resolverse `./tenant-config.stub`.

- [ ] **Step 3: Agregar los esquemas a `contracts/cfg/tenant-config.ts`**

Las firmas y los valores están en el bloque **Interfaces**. `moduloDe` lee `config.modulos[nombre]`.

- [ ] **Step 4: Implementar el stub en `contracts/cfg/tenant-config.stub.ts`**

`stubTenantConfig` mezcla los `overrides` (un nivel por cada objeto del esquema: `empresa`, `backup`, `modulos`) sobre una base fija —`empresa.id` `"empresa-demo"`, destino `"s3://backups-demo/empresa-demo"`, un módulo `asignacion` apagado— y devuelve `TenantConfigSchema.parse(mezcla)`: el `parse` es lo que hace que el stub no pueda desviarse del contrato. `stubRutasEmpresa` devuelve `[...RUTAS_EMPRESA, ".env.local"]`.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run contracts/cfg/tenant-config.test.ts contracts/cfg/tenant-config.stub.test.ts`
Expected: PASS las dos.

- [ ] **Step 6: Commit**

```bash
git add contracts/cfg/tenant-config.ts contracts/cfg/tenant-config.stub.ts contracts/cfg/tenant-config.stub.test.ts
git commit -m "feat(contracts): esquemas y stub de la config por empresa (CT.1)"
```

---

### Task 3: CDC de BAK contra el stub

Cubre `Está hecho cuando` → "CDC: las pruebas de BAK … pasan contra el stub". Lo que BAK.1 le
pregunta al contrato: a dónde sube el backup, con qué credencial, a dónde avisa si falla (R11) y a
qué hora corre (R9).

**Files:**
- Create: `contracts/cfg/tenant-config.cdc-bak.test.ts`

**Interfaces:**
- Consumes: Tareas 1 y 2 (`BackupConfigSchema`, `HORA_BACKUP`, `VARS_EMPRESA`, `esVariableDeEmpresa`, `stubTenantConfig`).
- Produces: nada (archivo de prueba).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { BackupConfigSchema, HORA_BACKUP, esVariableDeEmpresa } from "./tenant-config";
import { stubTenantConfig } from "./tenant-config.stub";

describe("CDC BAK.1 · destino y aviso del backup", () => {
  it("lee destino, credencial y aviso de la config de la empresa", () => {
    const { backup } = stubTenantConfig();
    expect(backup.destinoUri).toMatch(/^(s3|b2|gs|file):\/\//);
    expect(backup.credencial.length).toBeGreaterThan(0);
    expect(backup.avisoWebhook).toMatch(/^https?:\/\//);
  });

  it("corre a las 3:00 y no deja cambiar la hora", () => {
    expect(stubTenantConfig().backup.hora).toBe(HORA_BACKUP);
    expect(() => stubTenantConfig({ backup: { hora: "04:00" } })).toThrow();
  });

  it.each(["http://ejemplo.com/backups", "backups/", "", "s3:/falta-una-barra"])(
    "rechaza el destino %s",
    (destinoUri) => {
      const { backup } = stubTenantConfig();
      expect(() => BackupConfigSchema.parse({ ...backup, destinoUri })).toThrow();
    },
  );

  it("rechaza credencial vacía y aviso que no es URL", () => {
    const { backup } = stubTenantConfig();
    expect(() => BackupConfigSchema.parse({ ...backup, credencial: "" })).toThrow();
    expect(() => BackupConfigSchema.parse({ ...backup, avisoWebhook: "avisame" })).toThrow();
  });

  it("deja los secretos del backup del lado de la empresa", () => {
    for (const nombre of ["BACKUP_DESTINO_URI", "BACKUP_DESTINO_CREDENCIAL", "BACKUP_AVISO_WEBHOOK"]) {
      expect(esVariableDeEmpresa(nombre)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it and verify it fails or passes for the right reason**

Run: `npx vitest run contracts/cfg/tenant-config.cdc-bak.test.ts`
Expected: PASS si las Tareas 1–2 quedaron completas. Si algo falla, el contrato está incompleto: corregirlo en `tenant-config.ts`, no aflojar la prueba.

- [ ] **Step 3: Commit**

```bash
git add contracts/cfg/tenant-config.cdc-bak.test.ts
git commit -m "test(contracts): CDC de BAK contra el stub de CT.1"
```

---

### Task 4: CDC de UPD contra el stub

Cubre `Está hecho cuando` → "CDC: las pruebas de … UPD … pasan contra el stub". Lo que UPD.1 le
pregunta al contrato: qué rutas no puede tocar una actualización del template (R5, R8, R13).

**Files:**
- Create: `contracts/cfg/tenant-config.cdc-upd.test.ts`

**Interfaces:**
- Consumes: Tareas 1 y 2 (`esRutaDeEmpresa`, `RUTAS_EMPRESA`, `EJEMPLOS_TEMPLATE`, `stubRutasEmpresa`).
- Produces: nada (archivo de prueba).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { EJEMPLOS_TEMPLATE, RUTAS_EMPRESA, esRutaDeEmpresa } from "./tenant-config";
import { stubRutasEmpresa } from "./tenant-config.stub";

// Lo que UPD.1 hará: por cada ruta del diff del merge del template, preguntar
// al contrato si es de la empresa; si alguna lo es, el chequeo falla.
function rutasBloqueadas(diff: readonly string[]) {
  return diff.filter((ruta) => esRutaDeEmpresa(ruta));
}

describe("CDC UPD.1 · el chequeo del merge del template", () => {
  it("rechaza un cambio del template que toca una ruta de la empresa", () => {
    const diff = ["src/app/page.tsx", "config/policies.yaml"];
    expect(rutasBloqueadas(diff)).toEqual(["config/policies.yaml"]);
  });

  it("deja pasar un cambio que solo toca archivos del template", () => {
    const diff = [
      "src/lib/whatsapp/client.ts",
      "docker-compose.yml",
      "supabase/migrations/0002_inbox.sql",
      "package.json",
      ...EJEMPLOS_TEMPLATE,
    ];
    expect(rutasBloqueadas(diff)).toEqual([]);
  });

  it("bloquea toda ruta que el stub declara de la empresa", () => {
    expect(rutasBloqueadas(stubRutasEmpresa())).toEqual([...stubRutasEmpresa()]);
  });

  it("bloquea las rutas obligatorias del contrato", () => {
    expect(rutasBloqueadas(RUTAS_EMPRESA)).toEqual([...RUTAS_EMPRESA]);
  });

  it("no se deja engañar por la forma de escribir la ruta", () => {
    expect(rutasBloqueadas(["./config/modules.yaml", "config//modules.yaml"])).toHaveLength(2);
  });

  it("no bloquea un diff vacío", () => {
    expect(rutasBloqueadas([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and verify it passes for the right reason**

Run: `npx vitest run contracts/cfg/tenant-config.cdc-upd.test.ts`
Expected: PASS. Cualquier fallo se arregla en el contrato.

- [ ] **Step 3: Commit**

```bash
git add contracts/cfg/tenant-config.cdc-upd.test.ts
git commit -m "test(contracts): CDC de UPD contra el stub de CT.1"
```

---

### Task 5: CDC de MOD contra el stub

Cubre `Está hecho cuando` → "CDC: las pruebas de … MOD pasan contra el stub". Lo que MOD.1 le
pregunta al contrato: cómo lee los interruptores y la config de un módulo (R16: un módulo apagado no
cambia nada). El esquema de la config de cada módulo es de CT.3, así que aquí se comprueba que CT.1
la trate como opaca.

**Files:**
- Create: `contracts/cfg/tenant-config.cdc-mod.test.ts`

**Interfaces:**
- Consumes: Tareas 1 y 2 (`ModulosSchema`, `moduloDe`, `stubTenantConfig`).
- Produces: nada (archivo de prueba).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ModulosSchema, moduloDe } from "./tenant-config";
import { stubTenantConfig } from "./tenant-config.stub";

describe("CDC MOD.1 · interruptores de módulos", () => {
  it("por defecto los módulos vienen apagados", () => {
    expect(moduloDe(stubTenantConfig(), "asignacion")?.activo).toBe(false);
  });

  it("lee un módulo encendido con su config", () => {
    const config = stubTenantConfig({
      modulos: { asignacion: { activo: true, config: { estrategia: "round-robin" } } },
    });
    const modulo = moduloDe(config, "asignacion");
    expect(modulo?.activo).toBe(true);
    expect(modulo?.config).toEqual({ estrategia: "round-robin" });
  });

  it("devuelve undefined para un módulo que la empresa no declaró", () => {
    expect(moduloDe(stubTenantConfig(), "visibilidad")).toBeUndefined();
  });

  it("no opina sobre la forma de la config de un módulo (eso es CT.3)", () => {
    expect(() =>
      ModulosSchema.parse({ visibilidad: { activo: true, config: { lo: { que: ["sea"] } } } }),
    ).not.toThrow();
  });

  it("exige el interruptor y rechaza un nombre de módulo inválido", () => {
    expect(() => ModulosSchema.parse({ asignacion: { config: {} } })).toThrow();
    expect(() => ModulosSchema.parse({ Asignacion: { activo: true } })).toThrow();
  });

  it("deja la config de un módulo en {} cuando no se pasa", () => {
    const config = stubTenantConfig({ modulos: { asignacion: { activo: true } } });
    expect(moduloDe(config, "asignacion")?.config).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and verify it passes for the right reason**

Run: `npx vitest run contracts/cfg/tenant-config.cdc-mod.test.ts`
Expected: PASS. Si `ModuloSwitchSchema` no pone `config` en `{}` por defecto, corregir el esquema.

- [ ] **Step 3: Commit**

```bash
git add contracts/cfg/tenant-config.cdc-mod.test.ts
git commit -m "test(contracts): CDC de MOD contra el stub de CT.1"
```

---

### Task 6: Prueba de verificación del publicador, marcada pendiente

Cubre `Está hecho cuando` → "CDC: existe la prueba de verificación del publicador, marcada
pendiente". Deja escrito qué tendrá que demostrar CFG.1 sobre el repo real, sin implementarlo.

**Files:**
- Create: `contracts/cfg/tenant-config.publicador.test.ts`

**Interfaces:**
- Consumes: Tarea 1 (`RUTAS_EMPRESA`, `VARS_EMPRESA`) solo en el comentario de cabecera; el archivo no importa nada todavía.
- Produces: nada (archivo de prueba).

- [ ] **Step 1: Escribir la prueba pendiente**

Comentario de cabecera: esta es la verificación del publicador de `I1`; la cierra CFG.1
(`prds/wacrm-tenant-repo-template/slices/CFG.1-separacion-config-empresa.md`), que debe convertir
cada `it.todo` en prueba real contra el repo hijo. Cuerpo:

```ts
import { describe, it } from "vitest";

describe("verificación del publicador de I1 (CFG.1)", () => {
  it.todo("el repo hijo trae todas las RUTAS_EMPRESA del contrato");
  it.todo("el .env.local.example del template declara todas las VARS_EMPRESA");
  it.todo("config/modules.yaml del repo hijo parsea con TenantConfigSchema");
  it.todo("ningún archivo del template cae en esRutaDeEmpresa");
  it.todo("el repo hijo arranca con su propio .env sin tocar archivos del template");
});
```

- [ ] **Step 2: Verificar que vitest la reporta pendiente y no falla**

Run: `npx vitest run contracts/cfg/tenant-config.publicador.test.ts`
Expected: PASS con 5 todo/skipped, 0 failed.

- [ ] **Step 3: Verificación completa del repo**

Run, en orden: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
Expected: todo en verde; `npm test` recoge los archivos de `contracts/cfg/` junto con los de `src/`.

- [ ] **Step 4: Commit**

```bash
git add contracts/cfg/tenant-config.publicador.test.ts
git commit -m "test(contracts): verificación pendiente del publicador de I1 (CT.1)"
```

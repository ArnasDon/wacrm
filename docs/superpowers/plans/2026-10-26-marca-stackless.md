# Marca Stackless + marca por empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** La plantilla se ve como "Powered by Stackless" y cada hijo puede traer su logo y color de marca, cargados al crear el hijo con `nueva-empresa.mjs`.

**Architecture:** La marca vive en `config/marca.yaml` + `config/marca/logo.<ext>` (de la empresa, montada solo-lectura, no la pisa un merge de la plantilla). Un módulo servidor `src/lib/marca` la lee en cada request (como `leerInterruptores`), el layout raíz inyecta los tokens de color y el título, una ruta `/marca/logo` sirve el logo y los componentes de UI lo pintan. Sin config, se ve la marca Stackless completa.

**Tech Stack:** Next.js 16 (App Router), Tailwind v4 tokens CSS, js-yaml, vitest.

**Spec:** diseño aprobado en la conversación del 2026-10-26 (sin documento aparte). Decisión de implementación: la marca NO va dentro de `config/empresa.yaml` porque `TenantConfigSchema` es `strictObject` y es el contrato I1 con consumidores BAK/UPD/MOD; va en `config/marca.yaml`, que ese contrato no lee.

## Global Constraints

- Logo: PNG, SVG o WebP, máximo 1 MB. Color: hex `#rrggbb`.
- Ambos opcionales. Sin ellos: logo completo de Stackless y color por defecto `#2f7bf5`.
- "Powered by Stackless" siempre visible (sidebar y login), sin interruptor de config.
- Título de pestaña = nombre de la empresa (por defecto "Stackless").
- No cambiar `contracts/cfg/tenant-config.ts`.

## Review Focus

- `config/marca.yaml` ausente, vacío o con YAML roto → marca por defecto, la app no cae.
- Logo con ruta que sale de `config/marca/` (`../`) → no se sirve.
- Color hex inválido en el yaml → se ignora y se usa el defecto.
- Color muy claro (ej. `#ffffcc`) → el texto sobre `--primary` sigue legible (foreground oscuro).
- Script con `--logo` inexistente o `--color` inválido → sale con error sin escribir nada.

---

### Task 1: Color de marca a tokens

**Files:** Create `src/lib/marca/color.ts`, `src/lib/marca/color.test.ts`

**Interfaces:**
- Produces: `esHexColor(v: string): boolean`; `tokensDeColor(hex: string): { primary: string; primaryForeground: string; hover: string; soft: string; soft2: string }` (valores `oklch(...)`).

- [ ] Test: `esHexColor('#2f7bf5')` true; `'2f7bf5'`, `'#fff'`, `'#gggggg'` false. `tokensDeColor('#2f7bf5').primary` empieza con `oklch(`; `primaryForeground` es claro para `#1d4ed8` y oscuro para `#ffffcc`.
- [ ] Run `npx vitest run src/lib/marca/color.test.ts` → FAIL.
- [ ] Implement sRGB→linear→OKLab→OKLCH sin dependencias; foreground oscuro (`oklch(0.16 0.02 L)`-estilo) si L > 0.72, si no `oklch(0.985 0 0)`; hover = L+0.07; soft/soft2 = mismo color con alpha 0.12 / 0.2.
- [ ] Run → PASS. Commit.

### Task 2: Leer la marca de la empresa

**Files:** Create `src/lib/marca/marca.ts`, `src/lib/marca/marca.test.ts`

**Interfaces:**
- Consumes: `dirConfigEmpresa()` de `@/modulos/interruptores`, `esHexColor`.
- Produces: `type Marca = { nombre: string; color: string; logoPropio: boolean; logoUrl: string; marcaUrl: string }`; `leerMarca(dir?: string): Marca`; `rutaLogoPropio(dir?: string): { ruta: string; tipo: string } | null`; `COLOR_DEFECTO = '#2f7bf5'`.
- `logoUrl` = `/marca/logo` si hay logo propio, si no `/stackless/logo.png`. `marcaUrl` = `/marca/logo` o `/stackless/mark.png` (isotipo para el sidebar).

- [ ] Tests (dir temporal): sin config → nombre `Stackless`, color defecto, `logoPropio` false; con `empresa.yaml` (`empresa.nombre`) + `marca.yaml` (`marca: {color, logo}`) + archivo → valores propios; yaml roto → defecto; color inválido → defecto; `logo: ../x.png` → `logoPropio` false; extensión no permitida → false.
- [ ] Run → FAIL. Implement leyendo `empresa.yaml` y `marca.yaml` de forma tolerante (try/catch por archivo). Run → PASS. Commit.

### Task 3: Ruta que sirve el logo

**Files:** Create `src/app/marca/logo/route.ts`, `src/app/marca/logo/route.test.ts`

**Interfaces:** Consumes `rutaLogoPropio`. Produces `GET /marca/logo` → bytes con `Content-Type` correcto y `Cache-Control: public, max-age=300`; 404 si no hay logo propio.

- [ ] Test: con `CONFIG_EMPRESA_DIR` apuntando a un dir temporal con logo → 200 y content-type `image/png`; sin logo → 404.
- [ ] Run → FAIL. Implement. Run → PASS. Commit.
- [ ] El middleware/proxy debe dejar pasar `/marca/*` sin sesión (login usa el logo): verificar `src/middleware.ts` y su test, ajustar el matcher/lista pública y cubrirlo en `src/middleware.test.ts`.

### Task 4: Identidad en el layout raíz

**Files:** Modify `src/app/layout.tsx`; Delete `src/app/icon.tsx`; Create `public/stackless/logo.png`, `public/stackless/mark.png`, `public/stackless/icon.png`

- [ ] Generar assets desde `/Users/Juan_Cadavid/Documents/stackless/logo.png` con `sips` (logo ~640px, isotipo recortado, icono 64px).
- [ ] `generateMetadata` usa `leerMarca()`: `title.default = nombre`, `template = "%s — nombre"`, `icons.icon = logoPropio ? '/marca/logo' : '/stackless/icon.png'`. Añadir `await connection()` o `dynamic = 'force-dynamic'` para leer config por request.
- [ ] En `<head>`, `<style>` con `html[data-theme][data-mode]{--primary:…;--primary-foreground:…;--primary-hover:…;--primary-soft:…;--primary-soft-2:…;--ring:…;--chart-1:…;--sidebar-primary:…;--sidebar-primary-foreground:…;--sidebar-ring:…}` (especificidad mayor que los bloques de acento).
- [ ] `npx tsc --noEmit` limpio. Commit.

### Task 5: UI — sidebar, login y "Powered by"

**Files:** Create `src/components/layout/marca-logo.tsx`, `src/components/layout/powered-by.tsx`; Modify `src/components/layout/sidebar.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/dashboard-shell.tsx`, `src/app/(auth)/login/page.tsx` (+ signup/forgot/reset si usan el mismo ícono), `messages/{es,en,pt,ko}.json`

**Interfaces:** `MarcaLogo({ marca: Pick<Marca,'nombre'|'marcaUrl'>, className? })`; `PoweredBy({ className? })` con texto traducido `Brand.poweredBy` ("Desarrollado por" / "Powered by"…) + isotipo `/stackless/mark.png`.

- [ ] El layout servidor del dashboard pasa `marca` como prop hasta `Sidebar` (client). Sidebar reemplaza el cuadro con `MessageSquare` + `t("title")` por `MarcaLogo` + nombre, y pone `PoweredBy` al pie.
- [ ] Login y demás pantallas de auth: logo/nombre de la empresa arriba, `PoweredBy` debajo de la tarjeta (el login es client: obtener `marca` con un layout servidor de `(auth)` que la pase por contexto, o con un componente servidor hijo).
- [ ] `npx tsc --noEmit` y `npm run lint` limpios. Verificar en `localhost:3100`: login y sidebar. Commit.

### Task 6: Script `nueva-empresa.mjs`

**Files:** Modify `scripts/empresa/nueva-empresa.mjs`, `scripts/empresa/nueva-empresa.test.ts`, `docs/` (nota de uso)

**Interfaces:** nuevos flags `--logo <ruta>` y `--color <#hex>` (opcionales). Escribe `config/marca/logo.<ext>` y `config/marca.yaml` (`marca:\n  color: "#…"\n  logo: logo.<ext>`) solo si se pasó alguno.

- [ ] Tests: con ambos flags → archivos creados y `leerMarca(hijo/config)` devuelve esos valores; `--color red` → exit ≠ 0 y sin `config/`; `--logo` inexistente, `.gif` o > 1 MB → exit ≠ 0 y sin escribir; sin flags → no crea `marca.yaml`.
- [ ] Run → FAIL. Implementar validando todo antes de escribir (patrón existente); duplicar regex/extensiones/límite con comentario y una prueba que las compare con `src/lib/marca`. Run → PASS.
- [ ] Documentar en `docs/` y en la salida "Siguientes pasos". Commit.

### Task 7: Verificación final

- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run format:check`: verdes (o diferencias preexistentes anotadas).
- [ ] Probar en `localhost:3100` con `CONFIG_EMPRESA_DIR` de prueba (logo + color propios) y sin él.

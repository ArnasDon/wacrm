@AGENTS.md

# Cómo funciona este fork

Fork de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), un CRM de
WhatsApp. Corre **solo en local**, contra un Supabase propio. Sin
WhatsApp conectado todavía.

## Piezas

| Pieza | Qué es |
| --- | --- |
| App | Next.js 16 + React 19, Node 26 |
| Base de datos | Supabase alojado (proyecto **WA CRM**, us-east-1) |
| Config | `.env.local` — no está en git |
| Contenedor | `wacrm-app-1`, proyecto compose `wacrm` |

## Correr la app

**Docker** (puerto 8080) — para usarla:

```bash
docker compose --env-file .env.local start   # prender
docker compose --env-file .env.local stop    # apagar
docker compose --env-file .env.local ps      # ver estado
```

Se enciende sola al abrir Docker Desktop (`restart: unless-stopped`),
salvo que la hayas parado con `stop`.

**Dev** (puerto 3000) — para tocar código, recarga al guardar:

```bash
npm run dev
```

Pueden convivir: son puertos distintos.

## Cambiar cosas

| Qué cambias | Qué hacer |
| --- | --- |
| Código | `up --build -d` (o nada, si usas `npm run dev`) |
| Variable `NEXT_PUBLIC_*` | `up --build -d` — se hornean en el bundle |
| Cualquier otro secreto | `restart` — se leen en runtime |
| Esquema de la BD | nueva migración en `supabase/migrations/` |

```bash
docker compose --env-file .env.local up --build -d
```

## Base de datos

39 migraciones aplicadas → 36 tablas, todas con RLS. Buckets de
Storage: `avatars`, `flow-media`, `chat-media`. Extensión `pgvector`.

Las migraciones **no** las corre el contenedor. Se aplican aparte
(CLI de Supabase o el MCP).

Modelo de permisos: cada usuario pertenece a una `account` con un rol
(`owner` > `admin` > `agent` > `viewer`). Todas las políticas RLS
cuelgan de la función `is_account_member(account_id, min_role)`.

## Autenticación

Registro abierto y **confirmación de correo desactivada**, para poder
crear cuentas en local sin depender del email. Al registrarse, el
trigger `handle_new_user` crea la `account` y el `profile` como
`owner`.

## Verificar

```bash
npm test        # 825 tests
npm run typecheck
npm run lint    # 37 warnings preexistentes, 0 errores
```

## Diferencias con el upstream

- Node 20 → 26 en CI, Docker y `package.json`; `.nvmrc` nuevo.
- Tests de `currency` y `date-utils` ya no dependen de la zona horaria
  ni del locale de la máquina.
- Esta sección y `docs/production-checklist.md`.

El remote `upstream` apunta al repo original, solo para traer cambios
con `git fetch upstream`.

## Pendiente

- **WhatsApp**: Meta no alcanza `localhost`. Hace falta un túnel
  (ngrok, Cloudflare Tunnel) o un deploy.
- **Producción**: hay dos ajustes de Auth relajados a propósito. Ver
  [docs/production-checklist.md](./docs/production-checklist.md) antes
  de exponer esto a nadie.

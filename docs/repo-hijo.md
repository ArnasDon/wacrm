# Repo hijo por empresa

Cada empresa tiene su propio repo, creado desde esta plantilla. El hijo solo agrega
configuración (R13); el código, el compose y los contratos son del template y se
actualizan por merge (R5, procedimiento de UPD.1). Cada empresa tiene además su propia
base de datos (R6): un proyecto de Compose y unos volúmenes por empresa.

Fuente de verdad de lo que es de la empresa: `contracts/cfg/tenant-config.ts`.

## Crear el repo hijo

1. En GitHub, "Use this template" (o `git clone`, luego
   `git remote rename origin plantilla` y `git remote add origin <repo-de-la-empresa>`).
2. `npm ci`
3. Crear la configuración y el `.env` de la empresa:

   ```bash
   node scripts/empresa/nueva-empresa.mjs --id baru --nombre "Griferías Barú" \
     --meta-app-secret <secreto> \
     --backup-destino s3://bucket/baru \
     --backup-credencial "<credencial>" \
     --backup-aviso https://avisos.example.com/baru
   ```

   El `--id` usa minúsculas, dígitos y guiones, y empieza por letra.

4. `docker compose up -d --wait`
5. Editar `config/policies.yaml` y aplicarlo a la base (con la base arriba y las migraciones
   aplicadas): ver [docs/policies.md](policies.md).
6. `git add config/ && git commit -m "config de la empresa"`

## El `.env` no se commitea

El `.env` se guarda fuera del repo (gestor de secretos). `ENCRYPTION_KEY` se genera una
sola vez por empresa y no se cambia (R7): `nueva-empresa` se niega a correr si ya existe
`.env` o `config/`, y no escribe nada en ese caso.

## Qué es de la empresa y qué del template

| De la empresa                   | Qué es                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `config/modules.yaml`           | Interruptores de módulos (ruta obligatoria)                                                          |
| `config/policies.yaml`          | Políticas de la empresa (ruta obligatoria; esquema y script en [policies.md](policies.md))                                       |
| `config/`                       | Todo lo que esté bajo este prefijo                                                                   |
| `config/empresa.yaml`           | Identidad de la empresa (`id`, `nombre`)                                                             |
| `.env*`                         | Todos los archivos de entorno, salvo los ejemplos del template                                       |
| `ENCRYPTION_KEY`                | Variable de entorno                                                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | Variable de entorno                                                                                  |
| `NEXT_PUBLIC_SUPABASE_URL`      | Variable de entorno                                                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Variable de entorno                                                                                  |
| `META_APP_SECRET`               | Variable de entorno                                                                                  |
| `BACKUP_DESTINO_URI`            | Variable de entorno                                                                                  |
| `BACKUP_DESTINO_CREDENCIAL`     | Variable de entorno                                                                                  |
| `BACKUP_AVISO_WEBHOOK`          | Variable de entorno                                                                                  |
| `COMPOSE_PROJECT_NAME`          | Variable de entorno de la empresa; vive en `.env`, así que una actualización del template no la pisa |

Ejemplos que son del template aunque empiecen por `.env`: `.env.example` y
`.env.local.example`. Los ejemplos de `config/` viven en `config.ejemplo/`, también del
template; el script los copia.

## Interruptores de módulos

`config/modules.yaml` tiene la forma `modulos: { <modulo>: { activo: true|false } }`.
Un archivo vacío significa sin módulos; una llave desconocida es un error. La `config` de
cada módulo la define CT.3.

## Varias empresas en una máquina

Cada empresa tiene su proyecto de Compose (`COMPOSE_PROJECT_NAME=wacrm-<id>`) y por eso
sus propios volúmenes, red y contenedores. Los puertos del host sí chocan: en el `.env`
de la segunda empresa cambia `HOST_PORT` y `KONG_HTTP_PORT` (y las URLs que los usan).

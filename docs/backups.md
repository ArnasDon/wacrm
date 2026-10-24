# Daily backup

Every day at 03:00 the installation backs up the database and the storage,
uploads the result outside the machine and raises a failure notice if anything
goes wrong. The hour is fixed (`HORA_BACKUP` in `contracts/cfg/tenant-config.ts`)
and is not configurable.

## What gets backed up

- A `pg_dump` (custom format, already compressed) of the db service, named
  `<db service>.dump` (`supabase-db.dump`).
- One `<volume>.tar.gz` per backup volume (`supabase-db-data.tar.gz`,
  `supabase-storage-data.tar.gz`).
- `manifiesto.json` with the size and `sha256` of each file (what restoration,
  BAK.2, will need to know).

File names come from the `I2` contract helpers
(`contracts/base/compose-services.ts`), never from literals.

## Where and when

`<BACKUP_DESTINO_URI>/<timestamp>/<file>`, with a timestamp like
`2026-10-21T03-00-00-000Z`. There is no rotation or retention on the
destination in this slice. The local copy lives in a temporary directory and is
deleted after the upload.

## Configuration

The three company variables come from the `I1` contract
(`BackupConfigSchema`); the fourth is read only by the backup task:

| Variable                    | Meaning                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `BACKUP_DESTINO_URI`        | `s3://`, `b2://`, `gs://` or `file://` destination         |
| `BACKUP_DESTINO_CREDENCIAL` | Body of an `rclone` remote, without the `[section]` header |
| `BACKUP_AVISO_WEBHOOK`      | URL that receives the failure notice                       |
| `BACKUP_DB_URL`             | Postgres URL; its host must be the db service name         |

`file://` is uploaded with `node:fs`; the other schemes with a single
`rclone copyto` (3 attempts, with backoff). The credential is handed to `rclone`
through a `0600` temporary file that is always removed.

## What the compose must provide (BASE.1)

- The `cron` service calls `GET http://app:3000/api/backup/cron` with the
  `x-cron-secret` header (`AUTOMATION_CRON_SECRET`) on a `0 3 * * *` schedule.
  Today `docker/cron/crontab` renders every task with a single
  `CRON_SCHEDULE` (every 5 minutes) and `run-task.sh` has a 60 s `curl`
  timeout, so the backup line needs its own fixed schedule and a longer
  timeout. A `409` answer means a backup is already running.
- The `app` service mounts `supabase-db-data` and `supabase-storage-data`
  read-only at `/var/lib/<volume>`. The process runs as `nextjs`, so it must be
  able to read each volume: for storage, the files must be readable by the
  `nextjs` uid or a group it belongs to; for the Postgres data directory
  (owner postgres, mode 0700 by default) initialize it with
  `--allow-group-access` (mode 0750) and add `nextjs` to that group
  (`group_add` in the compose). If that is not agreed with CT.2, say so there.
- The tar of the live Postgres data directory is an inconsistent copy and
  cannot be restored on its own: the `.dump` file is the source of truth for
  the database.
- The `app` environment includes `BACKUP_DB_URL` and the three company
  variables above.
- The runtime image carries `postgresql17-client` and `rclone` (done in the
  `Dockerfile`).

## When it fails

A failed dump, archive, manifest or upload sends a POST to
`BACKUP_AVISO_WEBHOOK` (`event: backup.failed`, with the failed step, the
artifact, the destination scheme and the message; never the credential or the
database URL). The route answers `500` with the step and whether the notice was
delivered. A dump that ends with exit code 0 but an empty file also counts as a
failure. Nothing is deleted from the destination.

## Not here

Restoration is BAK.2.

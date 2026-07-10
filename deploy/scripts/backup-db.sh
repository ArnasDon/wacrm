#!/usr/bin/env bash
# Criado em: 10/07/2026 00:40
# Modificado em: 10/07/2026 00:40
#
# Backup do Postgres (Supabase self-hosted) para o volume /backups.
# Executado pelo serviço db-backup (loop diário) ou manualmente:
#   docker compose exec db-backup /usr/local/bin/backup-db.sh
#
# Variáveis:
#   PGPASSWORD              — senha do postgres (vem do compose)
#   BACKUP_RETENTION_DAYS   — dias de retenção (padrão 7)

set -euo pipefail

BACKUP_DIR="/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILE="${BACKUP_DIR}/evolui-crm_${STAMP}.dump"

echo "[backup-db] iniciando pg_dump -> ${FILE}"
pg_dump \
  --host=supabase-db \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --format=custom \
  --file="${FILE}"

echo "[backup-db] concluído: $(du -h "${FILE}" | cut -f1)"

# Rotação: remove dumps mais antigos que a retenção.
find "${BACKUP_DIR}" -name 'evolui-crm_*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "[backup-db] rotação aplicada (retenção: ${RETENTION_DAYS} dias)"

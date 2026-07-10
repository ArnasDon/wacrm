#!/usr/bin/env bash
# Criado em: 10/07/2026 12:40
# Modificado em: 10/07/2026 12:50
#
# Aplica as migrations do CRM (supabase/migrations/*.sql) no Postgres
# self-hosted, em ordem alfabética (001_, 002_, ...), via psql dentro
# do container supabase-db (usuário supabase_admin = superuser).
#
# Idempotência: registra cada migration aplicada na tabela
# public._migrations e pula as já executadas — rodar de novo é seguro.
#
# Uso (na pasta deploy/):
#   ./scripts/apply-migrations.sh [caminho/para/migrations]
# Sem argumento, procura em: <repo>/supabase/migrations,
# deploy/migrations e deploy/supabase/migrations.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "${SCRIPT_DIR}")"
REPO_ROOT="$(dirname "${DEPLOY_DIR}")"

# Localiza as migrations: 1º argumento > variável MIGRATIONS_DIR >
# locais conhecidos (repo completo ou cópia junto ao deploy/).
MIGRATIONS_DIR="${1:-${MIGRATIONS_DIR:-}}"
if [[ -z "${MIGRATIONS_DIR}" ]]; then
  for candidato in \
    "${REPO_ROOT}/supabase/migrations" \
    "${DEPLOY_DIR}/migrations" \
    "${DEPLOY_DIR}/supabase/migrations"; do
    if [[ -d "${candidato}" ]]; then
      MIGRATIONS_DIR="${candidato}"
      break
    fi
  done
fi
if [[ -z "${MIGRATIONS_DIR}" || ! -d "${MIGRATIONS_DIR}" ]]; then
  echo "ERRO: pasta de migrations não encontrada." >&2
  echo "No servidor sem o repositório completo, copie a pasta antes:" >&2
  echo "  scp -r supabase/migrations usuario@servidor:<caminho>/deploy/migrations" >&2
  echo "Ou informe o caminho: ./scripts/apply-migrations.sh /caminho/para/migrations" >&2
  exit 1
fi
echo "==> Usando migrations de: ${MIGRATIONS_DIR}"

PSQL=(docker compose -f "${DEPLOY_DIR}/docker-compose.yml" exec -T supabase-db \
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --quiet)

echo "==> Criando tabela de controle (se não existir)"
"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS public._migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);"

aplicadas=0
puladas=0
for arquivo in "${MIGRATIONS_DIR}"/*.sql; do
  nome="$(basename "${arquivo}")"
  ja_existe="$("${PSQL[@]}" -tAc \
    "SELECT 1 FROM public._migrations WHERE name = '${nome}'")"
  if [[ "${ja_existe}" == "1" ]]; then
    puladas=$((puladas + 1))
    continue
  fi
  echo "==> Aplicando ${nome}"
  "${PSQL[@]}" -f - < "${arquivo}"
  "${PSQL[@]}" -c "INSERT INTO public._migrations (name) VALUES ('${nome}');"
  aplicadas=$((aplicadas + 1))
done

echo "==> Concluído: ${aplicadas} aplicadas, ${puladas} já existentes"
echo "==> Verificação rápida:"
"${PSQL[@]}" -c "SELECT count(*) AS tabelas FROM information_schema.tables
  WHERE table_schema = 'public';"

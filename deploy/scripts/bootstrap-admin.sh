#!/bin/sh
# Criado em: 13/07/2026 11:07
# Modificado em: 13/07/2026 11:07
#
# Bootstrap do usuário admin padrão — roda como serviço one-shot do
# docker compose (admin-bootstrap) no boot do stack.
#
# Cria o usuário via Admin API do GoTrue (POST /admin/users), direto no
# serviço supabase-auth pela rede interna (sem passar pelo Kong). A
# Admin API ignora GOTRUE_DISABLE_SIGNUP, e o trigger handle_new_user
# cria profile + conta pessoal + role 'owner' automaticamente.
#
# Idempotente: se o e-mail já existir, o GoTrue responde 422 e o script
# apenas loga e sai 0. Sem ADMIN_EMAIL/ADMIN_PASSWORD definidos, o
# bootstrap é considerado desativado (sai 0 sem erro).
#
# Credenciais SOMENTE via variáveis de ambiente (nunca em argv) e
# nunca ecoadas nos logs.

set -eu

AUTH_URL="${GOTRUE_INTERNAL_URL:-http://supabase-auth:9999}"

log() {
  echo "[bootstrap-admin] $1"
}

if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
  log "ADMIN_EMAIL/ADMIN_PASSWORD não definidos — bootstrap desativado."
  exit 0
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  log "ERRO: SUPABASE_SERVICE_ROLE_KEY não definido no ambiente."
  exit 1
fi

# Espera o GoTrue ficar saudável (até ~60s).
tentativa=0
until curl -fsS -o /dev/null "${AUTH_URL}/health"; do
  tentativa=$((tentativa + 1))
  if [ "${tentativa}" -ge 30 ]; then
    log "ERRO: GoTrue não respondeu em ${AUTH_URL}/health após 60s."
    exit 1
  fi
  log "aguardando GoTrue (${tentativa}/30)..."
  sleep 2
done

log "GoTrue disponível; criando usuário admin (e-mail mascarado: ${ADMIN_EMAIL%%@*}@***)..."

# Payload e header de autorização em arquivos temporários — nada de
# senha/token em argv (visível em /proc e em logs de processo).
PAYLOAD_FILE="$(mktemp)"
HEADER_FILE="$(mktemp)"
trap 'rm -f "${PAYLOAD_FILE}" "${HEADER_FILE}"' EXIT
cat > "${PAYLOAD_FILE}" <<EOF
{
  "email": "${ADMIN_EMAIL}",
  "password": "${ADMIN_PASSWORD}",
  "email_confirm": true,
  "user_metadata": { "full_name": "${ADMIN_FULL_NAME:-Administrador}" }
}
EOF
printf 'Authorization: Bearer %s\n' "${SUPABASE_SERVICE_ROLE_KEY}" > "${HEADER_FILE}"

HTTP_CODE="$(
  curl -sS -o /tmp/bootstrap-admin-response.json -w '%{http_code}' \
    -X POST "${AUTH_URL}/admin/users" \
    -H @"${HEADER_FILE}" \
    -H "Content-Type: application/json" \
    --data @"${PAYLOAD_FILE}"
)"

case "${HTTP_CODE}" in
  200|201)
    log "usuário admin criado com sucesso (HTTP ${HTTP_CODE})."
    ;;
  422)
    # E-mail já registrado — execução repetida do stack; nada a fazer.
    log "usuário já existe (HTTP 422) — nada a fazer."
    ;;
  *)
    log "ERRO: GoTrue respondeu HTTP ${HTTP_CODE}."
    # Resposta pode conter detalhes úteis e não contém a senha.
    cat /tmp/bootstrap-admin-response.json || true
    echo ""
    exit 1
    ;;
esac

log "bootstrap concluído."
exit 0

#!/usr/bin/env sh
# Create (or rotate) the listmonk API user that wacrm authenticates as,
# and print the token to paste into .env.
#
# Why a script and not a click-path: listmonk's API users live in its
# own database and are CACHED IN MEMORY AT BOOT, so creating one has
# two steps that are easy to get wrong in the wrong order — insert,
# then restart. Doing it by hand and forgetting the restart produces
# "invalid API credentials" with a correct-looking token.
#
# Usage (from the deploy/ directory):
#   sh setup-api-user.sh
#
# For the local stack, point it at that compose file — `docker compose`
# reads COMPOSE_FILE natively:
#   COMPOSE_FILE=docker-compose.local.yml sh setup-api-user.sh
set -eu

USER_NAME="${LISTMONK_API_USER:-wacrm_api}"

# 24 random bytes, hex. openssl is present in every image we use.
TOKEN="$(openssl rand -hex 24)"
HASH="$(printf '%s' "$TOKEN" | openssl dgst -sha256 | awk '{print $NF}')"

docker compose exec -T listmonk-db psql -U listmonk -d listmonk -v ON_ERROR_STOP=1 <<SQL
INSERT INTO users (username, password_login, password, email, name, type, user_role_id, status)
VALUES ('${USER_NAME}', false, '${HASH}', '${USER_NAME}@local', 'wacrm integration', 'api', 1, 'enabled')
ON CONFLICT (username) DO UPDATE SET password = '${HASH}', status = 'enabled';
SQL

# The cache is why this restart is mandatory, not tidiness.
docker compose restart listmonk >/dev/null

cat <<MSG

  API user ready.

  Put these in deploy/.env, then: docker compose up -d

    LISTMONK_API_USER=${USER_NAME}
    LISTMONK_API_TOKEN=${TOKEN}

  The token is shown once — listmonk stores only its SHA-256 hash.

MSG

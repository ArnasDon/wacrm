#!/usr/bin/env bash
# Criado em: 10/07/2026 01:10
# Modificado em: 10/07/2026 01:30
#
# Builda e publica a imagem do app no Docker Hub.
#   Imagem: adminvyadigital/enterprise-evolution-crm
#   Tags..: <versão> e latest
#
# A imagem é GENÉRICA — nenhum valor do .env entra no build. Toda a
# configuração (NEXT_PUBLIC_* inclusive) é injetada em runtime pelo
# docker-entrypoint.sh a partir do .env do compose.
#
# Uso:
#   docker login -u adminvyadigital        # uma vez, interativo
#   cd deploy && ./scripts/build-push.sh [versão]   # padrão: 0.0.1

set -euo pipefail

REGISTRY_USER="adminvyadigital"
IMAGE_NAME="enterprise-evoli-crm"
VERSION="${1:-0.0.2}"
IMAGE="${REGISTRY_USER}/${IMAGE_NAME}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "${SCRIPT_DIR}")"
REPO_ROOT="$(dirname "${DEPLOY_DIR}")"

echo "==> Buildando ${IMAGE}:${VERSION} (e latest)"
docker build \
  -f "${DEPLOY_DIR}/Dockerfile" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  "${REPO_ROOT}" --no-cache

echo "==> Publicando no Docker Hub"
docker push "${IMAGE}:${VERSION}"
docker push "${IMAGE}:latest"

echo "==> Concluído: ${IMAGE}:${VERSION} e ${IMAGE}:latest publicadas"

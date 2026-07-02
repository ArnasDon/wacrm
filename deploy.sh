#!/usr/bin/env bash
#
# Build local + deploy no Docker Swarm desta VPS.
# Uso:
#   ./deploy.sh
#
# Pré-requisitos (uma vez só):
#   - .env.local preenchido na raiz do projeto (Supabase, ENCRYPTION_KEY, etc.)
#   - rede overlay externa OrionNet existente (a que o Traefik observa)
#   - DNS de crm-docker.hiperfoco.net apontando para esta VPS
set -euo pipefail
cd "$(dirname "$0")"

STACK="wacrm"
IMAGE="wacrm:latest"

if [ ! -f .env.local ]; then
  echo "ERRO: .env.local não encontrado. Crie a partir de .env.local.example." >&2
  exit 1
fi

echo ">> Build da imagem ${IMAGE} ..."
docker build -t "${IMAGE}" .

echo ">> Deploy do stack ${STACK} no Swarm ..."
# --resolve-image=never: imagem é local, não tente puxar de um registry.
docker stack deploy -c docker-stack.yml --resolve-image=never "${STACK}"

# A imagem é sempre re-buildada com a MESMA tag (wacrm:latest). O Swarm, ao ver
# a tag inalterada, não recria a task — continuaria servindo o código antigo.
# O --force obriga a recriar a task com a wacrm:latest recém-buildada.
echo ">> Forçando recriação da task para subir a imagem nova ..."
docker service update --force "${STACK}_app"

echo ">> Pronto. Acompanhe a subida com:"
echo "     docker service logs -f ${STACK}_app"

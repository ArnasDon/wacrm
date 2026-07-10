#!/bin/sh
# Criado em: 10/07/2026 01:30
# Modificado em: 10/07/2026 01:30
#
# Entrypoint do container do app. A imagem é buildada com PLACEHOLDERS
# nas variáveis NEXT_PUBLIC_* (que o Next.js embute no bundle). Aqui,
# no start, substituímos os placeholders pelos valores reais vindos do
# ambiente (.env do compose) — a imagem fica genérica e o .env externo.

set -eu

: "${NEXT_PUBLIC_SUPABASE_URL:?defina NEXT_PUBLIC_SUPABASE_URL no ambiente}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?defina NEXT_PUBLIC_SUPABASE_ANON_KEY no ambiente}"
: "${NEXT_PUBLIC_SITE_URL:?defina NEXT_PUBLIC_SITE_URL no ambiente}"

PLACEHOLDER_URL="https://supabase-placeholder.invalid"
PLACEHOLDER_WSS="wss://supabase-placeholder.invalid"
PLACEHOLDER_ANON="NEXT_PUBLIC_SUPABASE_ANON_KEY_PLACEHOLDER"
PLACEHOLDER_SITE="https://site-placeholder.invalid"

RUNTIME_WSS="$(echo "${NEXT_PUBLIC_SUPABASE_URL}" | sed 's|^https:|wss:|; s|^http:|ws:|')"

echo "[entrypoint] injetando configuração de runtime no bundle..."
# Substitui em todos os arquivos de texto do build (JS, JSON, manifests).
find /app/.next /app/server.js -type f \( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.rsc' \) 2>/dev/null \
  | while read -r f; do
      if grep -ql -e "${PLACEHOLDER_URL}" -e "${PLACEHOLDER_ANON}" -e "${PLACEHOLDER_SITE}" "$f" 2>/dev/null; then
        sed -i \
          -e "s|${PLACEHOLDER_WSS}|${RUNTIME_WSS}|g" \
          -e "s|${PLACEHOLDER_URL}|${NEXT_PUBLIC_SUPABASE_URL}|g" \
          -e "s|${PLACEHOLDER_ANON}|${NEXT_PUBLIC_SUPABASE_ANON_KEY}|g" \
          -e "s|${PLACEHOLDER_SITE}|${NEXT_PUBLIC_SITE_URL}|g" \
          "$f"
      fi
    done

echo "[entrypoint] configuração aplicada; iniciando o servidor."
exec node /app/server.js

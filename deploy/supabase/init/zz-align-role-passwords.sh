#!/usr/bin/env bash
# Criado em: 10/07/2026 16:30
# Modificado em: 10/07/2026 16:30
#
# Executado pelo entrypoint do Postgres no PRIMEIRO boot (data dir
# vazio), via /docker-entrypoint-initdb.d/. Alinha as senhas dos roles
# internos do Supabase com POSTGRES_PASSWORD — sem isso, GoTrue,
# PostgREST e Storage não conectam (Bug 2 do report de 10/07/2026).
#
# Prefixo "zz-" garante execução DEPOIS dos init scripts da própria
# imagem supabase/postgres (que criam esses roles).

set -euo pipefail

echo "[init] alinhando senhas dos roles internos do Supabase..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
	ALTER USER supabase_auth_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
	ALTER USER authenticator WITH PASSWORD '${POSTGRES_PASSWORD}';
	ALTER USER supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
SQL
echo "[init] senhas alinhadas."

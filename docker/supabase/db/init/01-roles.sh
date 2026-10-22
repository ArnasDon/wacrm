#!/bin/bash
# Set passwords for the roles that gotrue, storage-api, and postgrest use.
# The roles already exist in supabase/postgres; this sets the password that
# matches POSTGRES_PASSWORD so each service can connect.
#
# Uses psql -v to pass the password as a client variable, which handles
# special characters correctly (: quoting in :'var' syntax).
set -e

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v "pg_password=${POSTGRES_PASSWORD}" <<-'EOSQL'
ALTER USER authenticator          WITH PASSWORD :'pg_password';
ALTER USER supabase_auth_admin    WITH PASSWORD :'pg_password';
ALTER USER supabase_storage_admin WITH PASSWORD :'pg_password';
ALTER USER supabase_admin         WITH PASSWORD :'pg_password';
EOSQL

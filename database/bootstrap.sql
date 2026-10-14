-- Run ONCE as postgres in the existing omni_connect database.
-- No database or existing data is dropped. Set passwords privately with
-- psql \password or pgAdmin role properties after running this script.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omni_owner') THEN CREATE ROLE omni_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omni_app') THEN CREATE ROLE omni_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omni_auth') THEN CREATE ROLE omni_auth LOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omni_worker') THEN CREATE ROLE omni_worker LOGIN NOSUPERUSER BYPASSRLS; END IF;
END $$;
GRANT CONNECT ON DATABASE omni_connect TO omni_owner, omni_app, omni_auth, omni_worker;
GRANT CREATE ON DATABASE omni_connect TO omni_owner;
GRANT USAGE, CREATE ON SCHEMA public TO omni_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

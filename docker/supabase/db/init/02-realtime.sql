-- Create the _realtime schema that supabase/realtime expects to find on boot.
-- Without it the realtime service fails its own internal checks and the
-- container never reaches healthy.

CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO supabase_admin;

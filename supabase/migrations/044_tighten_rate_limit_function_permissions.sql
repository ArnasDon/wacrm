-- Some projects grant function execution directly to API roles through
-- default privileges, so revoking PUBLIC alone is not sufficient.

REVOKE ALL ON FUNCTION public.claim_rate_limit_slot(text, integer, integer)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_rate_limit_slot(text, integer, integer)
  TO service_role;

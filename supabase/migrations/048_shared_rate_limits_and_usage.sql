-- Shared, atomic rate-limit buckets for multi-instance deployments.
-- Only the service role can consume buckets; browser clients cannot inspect
-- identifiers or manipulate counters.

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket_key TEXT,
  p_limit INTEGER,
  p_window_ms INTEGER
)
RETURNS TABLE (
  success BOOLEAN,
  remaining INTEGER,
  reset_at_ms BIGINT,
  applied_limit INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_reset_at TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_bucket_key IS NULL OR length(p_bucket_key) = 0 OR p_limit <= 0 OR p_window_ms <= 0 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  -- Serialize consumers of the same logical bucket even when the row does not
  -- exist yet. Different buckets remain fully concurrent.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_bucket_key, 0));

  SELECT b.request_count, b.reset_at
    INTO v_count, v_reset_at
    FROM public.rate_limit_buckets b
   WHERE b.bucket_key = p_bucket_key;

  IF NOT FOUND OR v_reset_at <= v_now THEN
    v_count := 1;
    v_reset_at := v_now + make_interval(secs => p_window_ms::double precision / 1000.0);
    INSERT INTO public.rate_limit_buckets (bucket_key, request_count, reset_at, updated_at)
    VALUES (p_bucket_key, v_count, v_reset_at, v_now)
    ON CONFLICT (bucket_key) DO UPDATE
      SET request_count = EXCLUDED.request_count,
          reset_at = EXCLUDED.reset_at,
          updated_at = EXCLUDED.updated_at;
  ELSIF v_count < p_limit THEN
    v_count := v_count + 1;
    UPDATE public.rate_limit_buckets
       SET request_count = v_count,
           updated_at = v_now
     WHERE bucket_key = p_bucket_key;
  END IF;

  RETURN QUERY SELECT
    v_count <= p_limit,
    GREATEST(p_limit - v_count, 0),
    floor(extract(epoch FROM v_reset_at) * 1000)::BIGINT,
    p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

COMMENT ON TABLE public.rate_limit_buckets IS
  'Atomic fixed-window counters shared by every Chat Sandia application instance.';

